import { type Database, deleteGonePushToken, type PushTarget, pushTargetsOf } from '@bali/db';
import type { FastifyInstance } from 'fastify';

import { captureFailure } from '../monitoring.js';
import type { ApnsClient, ApnsResult } from './apns.js';

/*
 * The "class started" doorbell (N5; ARCHITECTURE, "Push: a doorbell for
 * students"): after a Start commits, one visible alert to each token of the
 * students whose waiting tap that Start converted. Never the truth — the
 * phone, opened, reads it from the API — so a send is fired and forgotten:
 * it never fails or delays the Start, and its failures are only logged,
 * never with the token.
 */

/** How long a "has started" is worth delivering: later, it is no longer true. */
export const CLASS_STARTED_TTL_MS = 10 * 60_000;

/** The owner's words (ARCHITECTURE): the class's name and nothing else personal. */
export function classStartedPayload(className: string): object {
  return {
    aps: {
      alert: { title: `${className} has started`, body: 'Open Bali to lock your apps.' },
      sound: 'default',
      'interruption-level': 'time-sensitive',
    },
  };
}

export interface ClassStarted {
  sessionId: string;
  className: string;
  startedAt: Date;
  studentIds: readonly string[];
}

/** Sends a Start's alerts in the background; a no-op when push is off. */
export type NotifyClassStarted = (started: ClassStarted) => void;

/**
 * The notifier the Start route calls after its transaction commits. Each call's
 * sends are tracked until settled, and `app.close()` — the shutdown's — waits
 * them out (each bounded by the transport's timeout), then closes the client.
 */
export function classStartedNotifier(
  app: FastifyInstance,
  db: Database,
  client: ApnsClient | undefined,
): NotifyClassStarted {
  if (!client) {
    // Said once, at start: the deploy's log shows whether push is on.
    app.log.info('push is off: APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID are unset');
    return () => undefined;
  }
  app.log.info('push is on: "class started" alerts go to APNs');
  const inFlight = new Set<Promise<void>>();
  app.addHook('onClose', async () => {
    await Promise.allSettled([...inFlight]);
    client.close();
  });

  const sendTo = async (target: PushTarget, started: ClassStarted): Promise<void> => {
    let result: ApnsResult;
    try {
      result = await client.send({
        token: target.token,
        environment: target.environment,
        payload: classStartedPayload(started.className),
        collapseId: started.sessionId,
        expiresAt: new Date(started.startedAt.getTime() + CLASS_STARTED_TTL_MS),
      });
    } catch (err) {
      // A transport's own words never carry the token, but make sure.
      const failure = (err instanceof Error ? err.message : String(err)).replaceAll(
        target.token,
        '[token]',
      );
      app.log.warn({ studentId: target.userId, failure }, 'class-started push not sent');
      return;
    }
    if (result.outcome === 'delivered') return;
    const { status, reason } = result;
    app.log.warn({ studentId: target.userId, status, reason }, 'class-started push refused');
    if (result.gone) await deleteGonePushToken(db, target);
  };

  return (started) => {
    if (started.studentIds.length === 0) return;
    const sending = (async () => {
      const targets = await pushTargetsOf(db, started.studentIds);
      await Promise.all(targets.map((target) => sendTo(target, started)));
    })()
      .catch((err: unknown) => {
        // Our own failure (reading or deleting tokens), not APNs's: reported like a 500.
        app.log.error({ err }, 'class-started push failed');
        captureFailure(err, 'class-started push');
      })
      .finally(() => {
        inFlight.delete(sending);
      });
    inFlight.add(sending);
  };
}
