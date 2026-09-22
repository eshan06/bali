import type { Database } from '@bali/db';
import { describe, expect, it } from 'vitest';

import { createStreamHub } from '../src/sse/hub.js';

/*
 * What `await hub.close()` promises: the LISTEN this hub started is settled and
 * unlistened by the time it returns.
 *
 * `ensureListening()` fires `client.listen('bali_events', …)` without awaiting
 * it, and `unlisten` is only assigned once that RESOLVES. So a close during
 * setup — every short-lived stream, and every server shutdown that follows one
 * — used to await nothing and return with the LISTEN still in flight. Whatever
 * tore the pool down next (a test's closeDb, the server exiting after
 * `app.close()`) did so underneath that query, and postgres.js reported `write
 * CONNECTION_ENDED` as an unhandled rejection: 5 runs out of 5 on the
 * real-Postgres lane, failing the run with every test green.
 *
 * That end-to-end symptom is NOT what this test asserts. Isolating the two
 * halves of the fix showed the rejection is only reliably about the second one
 * (see the note in hub.ts), and staging it needs a real pool torn down inside a
 * window that reproduced 1 run in 3 — a test that catches a regression a third
 * of the time is worse than none. So this pins the contract instead, with a
 * `listen` the test resolves by hand: deterministic, both halves discriminated,
 * and it runs on the PGlite lane too, where the real-pool version could not run
 * at all.
 */

/** Just enough drizzle for the subscriber's initial read to come back empty. */
const noRows = {
  select: () => noRows,
  from: () => noRows,
  where: () => noRows,
  orderBy: () => noRows,
  limit: () => Promise.resolve([]),
};

/** Flush the microtask queue and one turn of the event loop. */
const settle = () => new Promise((r) => setImmediate(r));

describe('the stream hub settles its LISTEN before close() returns', () => {
  it('waits for a listen that is still being established, and for its unlisten', async () => {
    let startListen!: (handle: unknown) => void;
    let listenCalled = false;
    let unlistenCalled = false;
    let finishUnlisten!: () => void;
    const unlistenDone = new Promise<void>((r) => {
      finishUnlisten = r;
    });

    const db = {
      ...noRows,
      $client: {
        listen: () => {
          listenCalled = true;
          return new Promise<unknown>((resolve) => {
            startListen = resolve;
          });
        },
      },
    } as unknown as Database;

    const hub = createStreamHub(db, { repollMs: 60_000, heartbeatMs: 60_000 });
    hub.subscribe({
      sessionId: '11111111-1111-4111-8111-111111111111',
      teacherId: '22222222-2222-4222-8222-222222222222',
      after: 0,
      write: () => {},
      onClose: () => {},
    });
    expect(listenCalled, 'the first subscriber opens the LISTEN').toBe(true);

    // Close while `listen` is still in flight: `unlisten` is null, so the only
    // handle on the query is the setup promise.
    let settled = false;
    const closing = hub.close().then(() => {
      settled = true;
    });
    await settle();
    expect(settled, 'close() returned with the LISTEN still in flight').toBe(false);

    // Let the LISTEN land. The hub must now issue the unlisten it skipped on
    // the way in — and wait for THAT too, or it is handing the caller the same
    // "safe to tear the pool down" answer one query earlier.
    startListen({
      unlisten: () => {
        unlistenCalled = true;
        return unlistenDone;
      },
    });
    await settle();
    expect(unlistenCalled, 'a LISTEN that lands after close() is unlistened').toBe(true);
    expect(settled, 'close() returned before its own unlisten completed').toBe(false);

    finishUnlisten();
    await closing;
    expect(settled).toBe(true);
  });
});
