import { type Database, events, participations, sessions, startSession, tapIn } from '@bali/db';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeShutdown } from '../src/shutdown.js';
import { SWEEP_INTERVAL_MS, startSweeping, sweep } from '../src/sweep.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

/*
 * The sweep the API runs itself every minute (hosting decision 3, amended by
 * A15): Railway's cron runs at most every five minutes, and a session must end
 * at its bell. Only the interval is faked — the ticks are the thing under test
 * — so Fastify's close, pino and the databases run on real time.
 */

const fakeTheInterval = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

interface LogLine {
  level: number;
  msg: string;
  err?: { message?: string; stack?: string };
}

/** An app whose log lines are kept, as pino wrote them, for the assertions. */
function loggedApp(): { app: FastifyInstance; logs: LogLine[] } {
  const logs: LogLine[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(JSON.parse(chunk.toString('utf8')) as LogLine);
      done();
    },
  });
  return { app: Fastify({ logger: { level: 'info', stream } }), logs };
}

/** A run that stays in flight until `finish` is called. */
function slowRun() {
  let finish: () => void = () => undefined;
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  return { run, finish: () => finish() };
}

const WARN = 40;
const ERROR = 50;

describe('startSweeping', () => {
  beforeEach(() => {
    fakeTheInterval();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps once a minute', async () => {
    const { app } = loggedApp();
    const run = vi.fn(() => Promise.resolve());
    startSweeping(app, run);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(SWEEP_INTERVAL_MS).toBe(60_000);

    await app.close();
  });

  it('skips a tick while the last run is still going, and says so: runs never stack', async () => {
    const { app, logs } = loggedApp();
    const { run, finish } = slowRun();
    startSweeping(app, run);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    const skipped = logs.filter((line) => line.level === WARN);
    expect(skipped.map((line) => line.msg)).toEqual([
      'sweep still running; this tick skipped',
      'sweep still running; this tick skipped',
    ]);

    finish();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);

    finish();
    await app.close();
  });

  it('logs a failed run at error with its cause, never throws it, and runs the next tick as usual', async () => {
    const { app, logs } = loggedApp();
    const refused = new Error('connect ECONNREFUSED 10.0.0.7:5432');
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('the expiry pass failed', { cause: refused }))
      // A throw before any promise exists must not escape the timer either.
      .mockImplementationOnce(() => {
        throw new Error('thrown before a promise');
      })
      .mockResolvedValue(undefined);
    startSweeping(app, run);

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);

    expect(run).toHaveBeenCalledTimes(3);
    const failures = logs.filter((line) => line.level === ERROR);
    expect(failures.map((line) => line.msg)).toEqual([
      'sweep failed; the next tick tries again',
      'sweep failed; the next tick tries again',
    ]);
    // pino's error serializer carries the cause chain: the reason, not just the symptom.
    expect(failures[0]?.err?.message).toContain('ECONNREFUSED');
    expect(failures[0]?.err?.stack).toContain('caused by');
    expect(failures[1]?.err?.message).toBe('thrown before a promise');

    await app.close();
  });

  it('stops at shutdown: waits out the run in flight before exiting, and starts none after', async () => {
    const { app } = loggedApp();
    const { run, finish } = slowRun();
    startSweeping(app, run);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);

    const exit = vi.fn();
    makeShutdown(app, { deadlineMs: 8000, exit })('SIGTERM');
    // Real time for Fastify's close to reach its onClose hooks — it does not
    // finish while the sweep runs, so the process never exits under a write.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exit).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));

    // With the run over, a ticker still armed would start the next one here.
    await vi.advanceTimersByTimeAsync(5 * SWEEP_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('the API sweeping by itself', () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ db, close: closeDb } = await makeTestDb());
    app = buildApp(testEnv, { db, verifyToken: () => Promise.reject(new Error('unused')) });
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Waits out a sweep in flight, so the database never closes under one.
    await app.close();
    await closeDb();
  });

  it('ends a session past its end time within the minute, with no call to /internal/sweep', async () => {
    const { klass, student } = await seedClassroom(db, 'ticker');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60 * 60_000),
      endsAt: new Date(Date.now() - 30 * 60_000),
    });
    // A phone in it gone quiet, past the silence threshold: the sweep expires
    // first, which ends its row, so no silence episode opens on a phone the
    // bell already sent home.
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await db
      .update(participations)
      .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(participations.sessionId, session.id));

    const endedAt = async () =>
      (await db.select().from(sessions).where(eq(sessions.id, session.id)))[0]?.endedAt;
    const eventsOf = (type: 'session_expired' | 'went_silent') =>
      db
        .select()
        .from(events)
        .where(and(eq(events.sessionId, session.id), eq(events.type, type)));

    fakeTheInterval();
    startSweeping(app, () => sweep(db));
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS - 1);
    expect(await endedAt()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    await vi.waitFor(async () => expect(await endedAt()).not.toBeNull());
    expect(await eventsOf('session_expired')).toHaveLength(1);
    expect(await eventsOf('went_silent')).toHaveLength(0);
  });
});
