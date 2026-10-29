import { type Database, events, startSession, tapIn } from '@bali/db';
import { EVENT_PAGE_LIMIT, EVENT_RESUME_OVERLAP, type FeedEvent } from '@bali/shared';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createStreamHub, type StreamHub } from '../src/sse/hub.js';
import type { SettledCursor } from '../src/sse/settled.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * Where a live stream re-reads from (ARCHITECTURE, Live updates): never past its settled point, a
 * seq every write handed one at or below it has finished. A row gets its seq as its insert runs and
 * shows only when its transaction commits, and a Start's one transaction can take a seq and then a
 * great many more before that. Here the settled point is the test's to move, as an open write would
 * hold it, and the late row goes in under the seq that write took: what a late commit looks like to
 * any reader. No NOTIFY (the re-poll reads), so this runs on both lanes; stream.test.ts holds a
 * real write open on real Postgres.
 */

let db: Database;
let closeDb: () => Promise<void>;
const hubs: StreamHub[] = [];

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close();
  await closeDb();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A settled point the test moves, as the writes it stands for finish. */
function heldAt(seq: number): SettledCursor & { seq: number } {
  const cursor = {
    seq,
    now: () => Promise.resolve(cursor.seq),
    fresh: () => Promise.resolve(cursor.seq),
  };
  return cursor;
}

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : (result as { rows: T[] }).rows;
}

/** Take the next seq as a write would, leaving no row under it yet. */
async function takeSeq(): Promise<number> {
  const [row] = rowsOf<{ seq: string }>(
    await db.execute(sql`select nextval(pg_get_serial_sequence('events', 'seq'))::text as seq`),
  );
  return Number(row!.seq);
}

/** Hand out seqs up to `seq`, as other writes would. */
async function skipTo(seq: number): Promise<void> {
  await db.execute(sql`select setval(pg_get_serial_sequence('events', 'seq'), ${seq})`);
}

/** The row a write holding `seq` shows when it commits. */
async function commitLate(seq: number, sessionId: string, userId: string): Promise<string> {
  const eventId = randomUUID();
  await db.execute(sql`insert into events (id, seq, event_id, type, session_id, user_id, occurred_at)
    overriding system value
    values (gen_random_uuid(), ${seq}, ${eventId}, 'left_for_other_session', ${sessionId}, ${userId}, now())`);
  return eventId;
}

async function seedRunning(tag: string) {
  const c = await seedClassroom(db, tag);
  const session = (
    await startSession(db, {
      classId: c.klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    })
  ).session;
  return { ...c, session };
}

/** A stream of the session from `after`, its frames kept: the events, and every chunk as sent. */
function open(sessionId: string, teacherId: string, settled: SettledCursor, after = 0) {
  const hub = createStreamHub(db, { repollMs: 20, heartbeatMs: 3_600_000, settled });
  hubs.push(hub);
  const chunks: string[] = [];
  const delivered: FeedEvent[] = [];
  hub.subscribe({
    sessionId,
    teacherId,
    after,
    expiresAtMs: null,
    stillAllowed: () => Promise.resolve(true),
    write: (chunk) => {
      chunks.push(chunk);
      const data = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (data) delivered.push(JSON.parse(data.slice(6)) as FeedEvent);
    },
    onClose: () => {},
  });
  return { chunks, delivered };
}

describe('a live stream re-reads from below its settled point', () => {
  it('delivers a late-committing event once, however far past it the seqs it sent have moved', async () => {
    const { teacher, student, session } = await seedRunning('resume-late');
    // A write takes its seq and stays open, and more than the overlap of seqs go out after it.
    const late = await takeSeq();
    await skipTo(late + EVENT_RESUME_OVERLAP + 10);
    const cursor = heldAt(late - 1);
    const stream = open(session.id, teacher.id, cursor);

    // A higher seq of the session commits and is sent.
    const fast = randomUUID();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: fast,
      deviceTime: new Date(),
    });
    await until(() => stream.delivered.some((e) => e.eventId === fast), 'the higher seq');
    expect(stream.delivered.find((e) => e.eventId === fast)!.seq).toBeGreaterThan(
      late + EVENT_RESUME_OVERLAP,
    );

    // The open write commits.
    const leave = await commitLate(late, session.id, student.id);
    await until(() => stream.delivered.some((e) => e.eventId === leave), 'the late event');
    cursor.seq = late + EVENT_RESUME_OVERLAP + 20;
    await sleep(150); // several re-polls, the settled point held and then moved past both
    expect(stream.delivered.filter((e) => e.eventId === leave)).toHaveLength(1);
    expect(stream.delivered.filter((e) => e.eventId === fast)).toHaveLength(1);
  });

  it('says its settled point as it rises, once each, and never one at or below where it began', async () => {
    const { teacher, student, session } = await seedRunning('resume-says');
    const cursor = heldAt(0);
    const stream = open(session.id, teacher.id, cursor);
    await until(() => stream.delivered.length > 0, 'the session_started event');
    await sleep(60);
    expect(stream.chunks.filter((c) => c.startsWith(': settled'))).toEqual([]);

    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await until(() => stream.delivered.length === 2, 'the tap');
    const top = Math.max(...stream.delivered.map((e) => e.seq));
    cursor.seq = top;
    await until(() => stream.chunks.includes(`: settled ${top}\n\n`), 'the settled point');
    await sleep(100);
    expect(stream.chunks.filter((c) => c.startsWith(': settled'))).toEqual([
      `: settled ${top}\n\n`,
    ]);
    // Said after the events at or below it, never before them.
    const said = stream.chunks.indexOf(`: settled ${top}\n\n`);
    const lastEvent = stream.chunks.findLastIndex((c) => c.includes('data: '));
    expect(said).toBeGreaterThan(lastEvent);
  });

  it('reads a backlog above a held settled point page by page, each event once, and keeps going', async () => {
    const { teacher, student, session } = await seedRunning('resume-backlog');
    const cursor = heldAt(0);
    const stream = open(session.id, teacher.id, cursor);
    const backlog = EVENT_PAGE_LIMIT + 50;
    await db.execute(sql`insert into ${events} (id, event_id, type, session_id, user_id, occurred_at)
      select gen_random_uuid(), gen_random_uuid(), 'came_back', ${session.id}, ${student.id}, now()
      from generate_series(1, ${backlog})`);
    await until(() => stream.delivered.length === backlog + 1, 'the backlog', 10_000);
    await sleep(150); // several re-polls over the whole backlog again
    expect(new Set(stream.delivered.map((e) => e.eventId)).size).toBe(stream.delivered.length);

    const after = randomUUID();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: after,
      deviceTime: new Date(),
    });
    await until(
      () => stream.delivered.some((e) => e.eventId === after),
      'an event after the backlog',
    );
    expect(stream.delivered).toHaveLength(backlog + 2);
  });
});
