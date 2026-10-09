import {
  claimCognitoDeletions,
  type CognitoDeletion,
  type Database,
  finishCognitoDeletion,
} from '@bali/db';
import type { FastifyInstance } from 'fastify';

import { captureFailure } from '../monitoring.js';
import type { DeleteSignIn, Outcome } from './admin.js';

/*
 * A deleted account's Cognito sign-in, deleted by the API (2026-10-09): queued with the deletion,
 * tried by a pass at once after the commit, then by each sweep while due (`claimCognitoDeletions`).
 * The phone's own DeleteUser (C4) stays a first try. A log line names a row by its id, never the person.
 */

/** Rows one pass tries at once: each try is bounded, so a pass never holds a bell up for long. */
export const PASS_LIMIT = 10;
/** How long one try, a read and a delete, may take: inside the 8 s shutdown deadline. */
export const SIGN_IN_DELETION_TIMEOUT_MS = 5_000;
/** From this many tries failed in a row, a failure is logged at error and reported. */
export const PERSISTENT_FAILURE_TRIES = 3;

export interface SignInDeletions {
  /** After a deletion commits: a pass at once, in the background. */
  now(): void;
  /** The sweep's pass: every row due at `now`, tried together. */
  due(now: Date): Promise<void>;
}

export function signInDeletions(
  app: FastifyInstance,
  db: Database,
  deleteSignIn: DeleteSignIn | undefined,
  issuer: string,
  clock: () => Date,
): SignInDeletions {
  if (!deleteSignIn) {
    // Said once, at start: the deploy's log shows the queue is only kept.
    app.log.warn(
      'Cognito sign-in deletion is off: COGNITO_DELETER_ACCESS_KEY_ID and COGNITO_DELETER_SECRET_ACCESS_KEY are unset, so deleted accounts’ sign-ins wait in the queue',
    );
    return { now: () => undefined, due: () => Promise.resolve() };
  }
  app.log.info('Cognito sign-in deletion is on: a deleted account’s sign-in is deleted');

  /** One claimed row, tried. A failure of Cognito's is said here; one of ours rejects. */
  const attempt = async (row: CognitoDeletion): Promise<void> => {
    let outcome: Outcome;
    try {
      outcome = await deleteSignIn(row, AbortSignal.timeout(SIGN_IN_DELETION_TIMEOUT_MS));
    } catch (err) {
      // Its words name no one: a CognitoError carries Cognito's type and status, never its message.
      const persistent = row.attempts >= PERSISTENT_FAILURE_TRIES;
      app.log[persistent ? 'error' : 'warn'](
        { err, deletion: row.id, attempts: row.attempts },
        'Cognito sign-in deletion failed; it is tried again later',
      );
      if (persistent) captureFailure(err, 'cognito sign-in deletion');
      return;
    }
    await finishCognitoDeletion(db, row.id);
    const done = { deletion: row.id, attempts: row.attempts, outcome };
    app.log.info(done, 'Cognito sign-in deletion done');
  };

  const pass = async (now: Date): Promise<void> => {
    const rows = await claimCognitoDeletions(db, { issuer, now, limit: PASS_LIMIT });
    // Settled, every one: a pass never ends with a try still running.
    for (const tried of await Promise.allSettled(rows.map(attempt))) {
      if (tried.status === 'rejected') throw tried.reason;
    }
  };

  const inFlight = new Set<Promise<void>>();
  app.addHook('onClose', async () => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
  });

  return {
    now() {
      const trying = pass(clock())
        .catch((err: unknown) => {
          // Ours (the database), not Cognito's: reported like a 500. The sweep tries the row again.
          app.log.error({ err }, 'Cognito sign-in deletion failed');
          captureFailure(err, 'cognito sign-in deletion');
        })
        .finally(() => {
          inFlight.delete(trying);
        });
      inFlight.add(trying);
    },
    due: (now) => pass(now),
  };
}
