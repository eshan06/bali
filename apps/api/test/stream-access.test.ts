import { classes, type Database, startSession, tapIn, users } from '@bali/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  createStreamHub,
  type StreamHub,
  type StreamHubOptions,
  type SubscribeInput,
} from '../src/sse/hub.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

/*
 * A teacher's live stream lasts no longer than the access that opened it: it ends at its token's
 * expiry (ARCHITECTURE, Auth decision 2), and on the re-poll after its caller stops being the
 * session's teacher by the rule the route opened it under. The portal's stream client then
 * reconnects, as after any drop, and gets the 401 or 403 any other request with that token gets.
 *
 * Real sockets, and no NOTIFY needed (the re-poll drives every check), so this runs on both lanes.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** `promise`'s value, or a failure naming `what` once `ms` have passed without one. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe('a live stream ends with its access', () => {
  const REPOLL_MS = 300;
  /** What a loaded machine adds to the re-poll's own wait: the check's reads, the end's trip. */
  const SLACK_MS = 700;

  let db: Database;
  let closeDb: () => Promise<void>;
  let app: FastifyInstance;
  let port: number;
  let issuer: TestIssuer;
  /** Every stream a test opens, aborted in teardown: one still open would hold `app.close()`. */
  const opened: AbortController[] = [];

  beforeEach(async () => {
    ({ db, close: closeDb } = await makeTestDb());
    issuer = await makeTestIssuer();
    app = buildApp(testEnv, {
      db,
      verifyToken: issuer.verifier,
      // Heartbeats an hour apart: only the re-poll and the token's expiry act on a stream here.
      stream: { repollMs: REPOLL_MS, heartbeatMs: 3_600_000, maxPerTeacher: 3 },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    port = address.port;
  });

  afterEach(async () => {
    for (const controller of opened) controller.abort();
    opened.length = 0;
    await app.close();
    await closeDb();
  });

  interface OpenStream {
    status: number;
    /** Everything the stream has sent so far. */
    received: () => string;
    /** Whether the reader has reported done: the server ended the stream. */
    isEnded: () => boolean;
    /** When the reader reported done. */
    ended: Promise<number>;
  }

  async function openStream(sessionId: string, token: string): Promise<OpenStream> {
    const controller = new AbortController();
    opened.push(controller);
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions/${sessionId}/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel();
      const at = Date.now();
      return {
        status: res.status,
        received: () => '',
        isEnded: () => true,
        ended: Promise.resolve(at),
      };
    }
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    let endedAt: number | null = null;
    const ended = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return (endedAt = Date.now());
        text += decoder.decode(value, { stream: true });
      }
    })();
    ended.catch(() => {}); // the teardown's abort
    return { status: 200, received: () => text, isEnded: () => endedAt !== null, ended };
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

  /** A stream from `token`, live: subscribed, its first read delivered. */
  async function openLive(sessionId: string, token: string): Promise<OpenStream> {
    const stream = await openStream(sessionId, token);
    expect(stream.status).toBe(200);
    await until(
      () => stream.received().includes('"type":"session_started"'),
      3000,
      "the stream's first event",
    );
    return stream;
  }

  it('ends within one re-poll of its teacher no longer being a teacher', async () => {
    const { teacher, student, session } = await seedRunning('access-role');
    const token = await issuer.sign({ sub: teacher.cognitoId });
    const stream = await openLive(session.id, token);

    // Two re-polls on, still the class's teacher: open, and still delivering.
    await sleep(2 * REPOLL_MS + 100);
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await until(() => stream.received().includes('"type":"tap_in"'), 3000, 'the tap');
    expect(stream.isEnded()).toBe(false);

    await db.update(users).set({ role: 'student' }).where(eq(users.id, teacher.id));
    const changedAt = Date.now();
    const endedAt = await within(stream.ended, REPOLL_MS + SLACK_MS, 'the stream to end');
    expect(endedAt - changedAt).toBeLessThanOrEqual(REPOLL_MS + SLACK_MS);

    // The reconnect gets what every other request with that token now gets.
    expect((await openStream(session.id, token)).status).toBe(403);
  });

  it('ends within one re-poll of its class moving to another teacher', async () => {
    const { teacher, klass, session } = await seedRunning('access-class');
    const other = await seedClassroom(db, 'access-class-other');
    const token = await issuer.sign({ sub: teacher.cognitoId });
    const stream = await openLive(session.id, token);

    await sleep(2 * REPOLL_MS + 100);
    expect(stream.isEnded()).toBe(false);

    await db.update(classes).set({ teacherId: other.teacher.id }).where(eq(classes.id, klass.id));
    const changedAt = Date.now();
    const endedAt = await within(stream.ended, REPOLL_MS + SLACK_MS, 'the stream to end');
    expect(endedAt - changedAt).toBeLessThanOrEqual(REPOLL_MS + SLACK_MS);

    expect((await openStream(session.id, token)).status).toBe(403);
  });

  it("ends at its token's expiry", async () => {
    const { teacher, session } = await seedRunning('access-expiry');
    // `exp` is whole seconds: this token expires between two and three seconds from now.
    const token = await issuer.sign({ sub: teacher.cognitoId, expiresInSeconds: 3 });
    const expiresAt = decodeJwt(token).exp! * 1000;
    const stream = await openLive(session.id, token);

    const endedAt = await within(
      stream.ended,
      expiresAt - Date.now() + SLACK_MS,
      'the stream to end at the expiry',
    );
    // Not before it: until then the token is good for every request.
    expect(endedAt).toBeGreaterThanOrEqual(expiresAt);
    expect(endedAt - expiresAt).toBeLessThanOrEqual(SLACK_MS);

    // Past it, the reconnect is the 401 that sends the portal to sign in.
    expect((await openStream(session.id, token)).status).toBe(401);
  });
});

describe("the hub's own end of a stream's access", () => {
  let reads = 0;
  /** Just enough drizzle for a stream's reads to come back empty, counted. */
  const noRows = {
    select: () => noRows,
    from: () => noRows,
    where: () => noRows,
    orderBy: () => noRows,
    limit: () => {
      reads += 1;
      return Promise.resolve([]);
    },
  };
  const db = noRows as unknown as Database;
  /** And a settled point that never moves: nothing is writing. */
  const settled = { now: () => Promise.resolve(0), fresh: () => Promise.resolve(0) };
  const teacherId = '22222222-2222-4222-8222-222222222222';

  function input(overrides: Partial<SubscribeInput>): SubscribeInput {
    return {
      sessionId: '11111111-1111-4111-8111-111111111111',
      teacherId,
      after: 0,
      expiresAtMs: null,
      stillAllowed: () => Promise.resolve(true),
      write: () => {},
      onClose: () => {},
      ...overrides,
    };
  }

  /** Every hub a test makes, closed in teardown: one a failed test left running reads no more. */
  const hubs: StreamHub[] = [];
  function hubWith(options: StreamHubOptions): StreamHub {
    const hub = createStreamHub(db, { settled, ...options });
    hubs.push(hub);
    return hub;
  }

  beforeEach(() => {
    reads = 0;
  });

  afterEach(async () => {
    for (const hub of hubs) await hub.close();
    hubs.length = 0;
    vi.useRealTimers();
  });

  it("ends the stream, before its next read, when the re-check finds its caller's access gone", async () => {
    const hub = hubWith({ repollMs: 20, heartbeatMs: 3_600_000 });
    let closes = 0;
    hub.subscribe(
      input({
        stillAllowed: () => Promise.resolve(false),
        onClose: () => {
          closes += 1;
        },
      }),
    );
    await until(() => closes > 0, 2000, 'the stream to end');
    await sleep(100); // several re-polls on
    expect(closes).toBe(1);
    expect(reads, 'only the first read, before any re-poll').toBe(1);
    expect(hub.countForTeacher(teacherId)).toBe(0);
  });

  it("ends the stream when the re-check of its caller's access cannot be read", async () => {
    const hub = hubWith({ repollMs: 20, heartbeatMs: 3_600_000 });
    let closes = 0;
    hub.subscribe(
      input({
        stillAllowed: () => Promise.reject(new Error('the database is out of reach')),
        onClose: () => {
          closes += 1;
        },
      }),
    );
    await until(() => closes > 0, 2000, 'the stream to end');
    await sleep(100);
    expect(closes).toBe(1);
    expect(reads, 'only the first read, before any re-poll').toBe(1);
    expect(hub.countForTeacher(teacherId)).toBe(0);
  });

  it('ends a stream whose token expired before it subscribed, with no read', async () => {
    const hub = hubWith({ repollMs: 3_600_000, heartbeatMs: 3_600_000 });
    let closes = 0;
    const writes: string[] = [];
    hub.subscribe(
      input({
        expiresAtMs: Date.now() - 1,
        write: (chunk) => writes.push(chunk),
        onClose: () => {
          closes += 1;
        },
      }),
    );
    await sleep(50);
    expect(closes).toBe(1);
    expect(reads).toBe(0);
    expect(writes).toEqual([]);
    expect(hub.countForTeacher(teacherId)).toBe(0);
  });

  it("waits out an expiry past a timer's 32-bit limit instead of ending at once", async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T15:00:00Z') });
    // A Node timer holds at most 2^31 - 1 ms (about 24.8 days); a longer delay fires at once.
    const thirtyDays = 30 * 24 * 3_600_000;
    const hub = hubWith({ repollMs: 1_000_000_000, heartbeatMs: 1_000_000_000 });
    let closes = 0;
    hub.subscribe(
      input({
        expiresAtMs: Date.now() + thirtyDays,
        onClose: () => {
          closes += 1;
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(thirtyDays - 1);
    expect(closes, 'ended before its token expired').toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(closes, 'still open past its expiry').toBe(1);
  });

  it("leaves no timer behind once a client's disconnect or the shutdown ends a stream", async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T15:00:00Z') });
    const hub = hubWith({ repollMs: 20_000, heartbeatMs: 20_000 });
    const expiresAtMs = Date.now() + 12 * 3_600_000;

    const left = hub.subscribe(input({ expiresAtMs }));
    expect(vi.getTimerCount(), "a stream's re-poll, heartbeat and expiry").toBe(3);
    left.close(); // what the route does when the client goes away
    expect(vi.getTimerCount()).toBe(0);

    hub.subscribe(input({ expiresAtMs }));
    hub.subscribe(input({ expiresAtMs }));
    expect(vi.getTimerCount()).toBe(6);
    await hub.close(); // the server's shutdown
    expect(vi.getTimerCount()).toBe(0);
    expect(hub.countForTeacher(teacherId)).toBe(0);
  });
});
