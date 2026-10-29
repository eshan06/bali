import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { eventSeqHandedOut, eventWriters } from '../src/queries.js';
import { events } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * The two reads a live stream's settled point is made of (apps/api/src/sse/settled.ts; ARCHITECTURE,
 * Live updates): the newest seq the events table's counter has given out, its row committed or not,
 * and the transactions writing events now. An insert takes the table's write lock before its row
 * gets a seq and keeps it to its commit, so once every transaction that held the lock just after
 * that seq was read has ended, no write can still show an event under it.
 */

const REAL_PG = Boolean(process.env.TEST_DATABASE_URL);

/** The postgres.js reserved-connection surface these tests drive (a tagged-template fn + release). */
type Reserved = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>) & {
  release: () => void;
};

let db: Database;
let closeDb: () => Promise<void>;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterEach(async () => {
  await closeDb();
});

/** An event of no session, class or student, as a retention run's is. */
const anEvent = () => ({
  eventId: newUuidV7(),
  type: 'retention_applied' as const,
  occurredAt: new Date(),
});

describe('the settled point’s reads', () => {
  it('read 0 before any seq is handed out, then the newest; and no write when none is open', async () => {
    expect(await eventSeqHandedOut(db)).toBe(0);
    const [first] = await db.insert(events).values(anEvent()).returning({ seq: events.seq });
    const [second] = await db.insert(events).values(anEvent()).returning({ seq: events.seq });
    expect(second!.seq).toBeGreaterThan(first!.seq);
    expect(await eventSeqHandedOut(db)).toBe(second!.seq);
    expect(await eventWriters(db)).toEqual([]);
  });
});

describe.runIf(REAL_PG)('the settled point’s reads (real Postgres)', () => {
  it('count a write’s seq before it commits, and name the write until it ends', async () => {
    const client = (db as unknown as { $client: { reserve: () => Promise<Reserved> } }).$client;
    const reserved = await client.reserve();
    try {
      await reserved`begin`;
      const [row] = (await reserved`insert into events (id, event_id, type, occurred_at)
        values (gen_random_uuid(), gen_random_uuid(), 'retention_applied', now())
        returning seq`) as { seq: string }[];
      // Not visible yet, and already handed out.
      expect(await db.select().from(events)).toEqual([]);
      expect(await eventSeqHandedOut(db)).toBe(Number(row!.seq));
      expect(await eventWriters(db)).toHaveLength(1);
      await reserved`commit`;
    } catch (err) {
      await reserved`rollback`.catch(() => {});
      throw err;
    } finally {
      reserved.release();
    }
    expect(await eventWriters(db)).toEqual([]);
  });
});
