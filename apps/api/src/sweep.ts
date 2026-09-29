import { type Database, expireDueSessions, markSilentParticipations } from '@bali/db';
import type { FastifyInstance } from 'fastify';

/** How often the API sweeps by itself: every minute (hosting decision 3). */
export const SWEEP_INTERVAL_MS = 60_000;

/**
 * The sweep, the minute-tick that keeps derived truth honest: it ends every
 * session past its end time (decision 6), then opens a silence episode for
 * every focused phone gone quiet (decision 7). Both duties are idempotent, so
 * any number may run at once — each API process's own, every minute, and the
 * Railway cron's backup call to `/internal/sweep` (hosting decision 3).
 */
export async function sweep(db: Database): Promise<{ expired: number; wentSilent: number }> {
  const now = new Date();
  // Expire first: a session ending here also ends its live participations, so
  // the silence pass never opens an episode on a phone that just left.
  const expired = await expireDueSessions(db, now);
  const wentSilent = await markSilentParticipations(db, now);
  return { expired: expired.length, wentSilent };
}

/**
 * Runs `run` — the sweep, bound to the database — every minute in this process
 * (hosting decision 3): Railway's cron runs at most every five minutes, and not
 * to the minute, while a session must end at its bell. Started by the process
 * entry, never by `buildApp`, so a test's app sweeps only when it asks.
 *
 * A run still in flight makes the next tick skip, said at warn — runs never
 * stack, and a sweep that hangs is seen. A failed run is logged at error with
 * its cause and never thrown (rule 5): the process stays up and the next tick
 * runs as usual. `app.close()` — the shutdown's — stops the ticks and waits
 * out a run in flight, so the process never exits under one and none starts
 * after. Unref'd, so the ticker never holds a finished process open.
 */
export function startSweeping(app: FastifyInstance, run: () => Promise<unknown>): void {
  let inFlight: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (inFlight) {
      app.log.warn('sweep still running; this tick skipped');
      return;
    }
    // Through a resolved promise, so even a throw before `run` returns one is
    // a rejection handled here, never an exception out of the timer.
    inFlight = Promise.resolve()
      .then(run)
      .then(
        () => undefined,
        (err: unknown) => app.log.error({ err }, 'sweep failed; the next tick tries again'),
      )
      .finally(() => {
        inFlight = undefined;
      });
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    await inFlight;
  });
}
