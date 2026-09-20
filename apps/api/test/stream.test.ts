import { type Database, enrollments, events, startSession, tapIn, users } from '@bali/db';
import { EVENT_RESUME_OVERLAP, type FeedEvent } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer } from './helpers/test-issuer.js';

/** The postgres.js reserved-connection surface this test drives (a tagged-template fn + release). */
type Reserved = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>) & {
  release: () => void;
};

// The stream needs a real socket (inject() can't read an unending response) and
// real Postgres (NOTIFY fan-out + genuine concurrency), so — like the engine
// race tests — it runs only when TEST_DATABASE_URL is set.
const REAL_PG = Boolean(process.env.TEST_DATABASE_URL);

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let port: number;
let issuer: Awaited<ReturnType<typeof makeTestIssuer>>;
let tokenFor: (sub: string) => Promise<string>;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  tokenFor = (sub) => issuer.sign({ sub });
  // Short re-poll so delivery is deterministic even if a NOTIFY is missed.
  app = buildApp(testEnv, {
    db,
    verifyToken: issuer.verifier,
    stream: { repollMs: 80, heartbeatMs: 1000, maxPerTeacher: 3 },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  port = address.port;
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

interface Stream {
  events: FeedEvent[];
  status: number;
  waitFor: (pred: (evts: FeedEvent[]) => boolean, ms?: number) => Promise<void>;
  close: () => void;
}

async function openStream(sessionId: string, token: string, after?: number): Promise<Stream> {
  const controller = new AbortController();
  const url =
    `http://127.0.0.1:${port}/v1/sessions/${sessionId}/stream` +
    (after !== undefined ? `?after=${after}` : '');
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const collected: FeedEvent[] = [];
  if (res.status === 200 && res.body) {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (dataLine) collected.push(JSON.parse(dataLine.slice(6)) as FeedEvent);
          }
        }
      } catch {
        // aborted on close — expected
      }
    })();
  }
  return {
    events: collected,
    status: res.status,
    close: () => controller.abort(),
    waitFor: async (pred, ms = 3000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (pred(collected)) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`waitFor timed out; got ${collected.length} events`);
    },
  };
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

describe.runIf(REAL_PG)('GET /v1/sessions/:id/stream (SSE, real Postgres)', () => {
  it('rejects a non-owner teacher before streaming (403)', async () => {
    const { session } = await seedRunning('stream-authz');
    const other = await seedClassroom(db, 'stream-authz-other');
    const s = await openStream(session.id, await tokenFor(other.teacher.cognitoId));
    expect(s.status).toBe(403);
    s.close();
  });

  it('mirrors CORS (ACAO + Vary: Origin) onto the hijacked stream when configured', async () => {
    // The stream hijacks the reply, bypassing Fastify's header flush — so the
    // cors plugin's Access-Control-Allow-Origin must be copied onto the raw
    // response by hand, or the browser silently blocks the live grid even though
    // the snapshot/events routes (non-hijacked) work. Pin that copy.
    const { teacher, session } = await seedRunning('stream-cors');
    const corsApp = buildApp(
      { ...testEnv, CORS_ORIGINS: 'http://localhost:3000' },
      {
        db,
        verifyToken: issuer.verifier,
        stream: { repollMs: 80, heartbeatMs: 1000, maxPerTeacher: 3 },
      },
    );
    await corsApp.listen({ port: 0, host: '127.0.0.1' });
    try {
      const addr = corsApp.server.address();
      if (addr === null || typeof addr === 'string') throw new Error('no port');
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/sessions/${session.id}/stream`, {
        headers: {
          authorization: `Bearer ${await tokenFor(teacher.cognitoId)}`,
          origin: 'http://localhost:3000',
        },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect((res.headers.get('vary') ?? '').toLowerCase()).toContain('origin');
      controller.abort();
    } finally {
      await corsApp.close();
    }
  });

  it('adds no CORS header to the stream when CORS is unset (the default app)', async () => {
    // The beforeEach app has no CORS_ORIGINS, so even a browser-looking request
    // (with an Origin) gets no ACAO — today's native-app behavior, unchanged.
    const { teacher, session } = await seedRunning('stream-nocors');
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions/${session.id}/stream`, {
      headers: {
        authorization: `Bearer ${await tokenFor(teacher.cognitoId)}`,
        origin: 'http://localhost:3000',
      },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    controller.abort();
  });

  it('delivers every event from concurrent writers to one stream', async () => {
    const { teacher, klass, school, session } = await seedRunning('stream-fanout');
    // Several enrolled students who will tap in at once.
    const studentIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const [u] = await db
        .insert(users)
        .values({ cognitoId: `fanout-${i}`, role: 'student', schoolId: school.id })
        .returning();
      await db.insert(enrollments).values({ classId: klass.id, studentId: u!.id });
      studentIds.push(u!.id);
    }
    const stream = await openStream(session.id, await tokenFor(teacher.cognitoId));
    expect(stream.status).toBe(200);

    // Fire all taps concurrently.
    await Promise.all(
      studentIds.map((studentId) =>
        tapIn(db, {
          sessionId: session.id,
          studentId,
          eventId: randomUUID(),
          deviceTime: new Date(),
        }),
      ),
    );

    await stream.waitFor((e) => e.filter((x) => x.type === 'tap_in').length >= 6);
    const tapIds = new Set(stream.events.filter((e) => e.type === 'tap_in').map((e) => e.eventId));
    expect(tapIds.size).toBe(6);
    stream.close();
  });

  it('a reconnect with the overlap window delivers every event exactly once after dedupe', async () => {
    const { teacher, student, session } = await seedRunning('stream-reconnect');
    const token = await tokenFor(teacher.cognitoId);

    const first = await openStream(session.id, token, 0);
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await first.waitFor((e) => e.some((x) => x.type === 'tap_in'));
    const seen = new Map<string, FeedEvent>();
    for (const e of first.events) seen.set(e.eventId, e);
    const lastSeq = Math.max(...first.events.map((e) => e.seq));
    first.close();

    // More events land while disconnected.
    await new Promise((r) => setTimeout(r, 30));
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });

    // Reconnect with the overlap window and dedupe by event id (decision 2).
    const second = await openStream(session.id, token, Math.max(0, lastSeq - EVENT_RESUME_OVERLAP));
    await second.waitFor((e) => e.some((x) => x.seq > lastSeq));
    // Give the re-poll several cycles: a broken dedupe would re-deliver the
    // window each cycle, so the no-duplicate check must outlast a few of them.
    await new Promise((r) => setTimeout(r, 300));
    for (const e of second.events) seen.set(e.eventId, e);

    // Within the reconnected stream, no event id is delivered twice (its own
    // overlap dedupe), and across both streams the union is a clean, gapless seq
    // run covering session_started + both taps — nothing missed at the boundary.
    const secondIds = second.events.map((e) => e.eventId);
    expect(new Set(secondIds).size).toBe(secondIds.length);
    second.close();

    const seqs = [...seen.values()].map((e) => e.seq).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('delivers a late-committing lower seq even after a higher seq was sent (overlap re-read)', async () => {
    const { teacher, session } = await seedRunning('stream-slowwriter');
    const stream = await openStream(session.id, await tokenFor(teacher.cognitoId));
    expect(stream.status).toBe(200);

    // Hold a transaction open that has inserted a low-seq event but not committed,
    // then commit a higher-seq event first on another connection.
    const client = (db as unknown as { $client: { reserve: () => Promise<Reserved> } }).$client;
    const reserved = await client.reserve();
    const slowId = randomUUID();
    const fastId = randomUUID();
    try {
      await reserved`begin`;
      // seq N (assigned now, visible only on commit). `id` has an app-level
      // default (Drizzle), not a DB default, so a raw insert must supply it.
      await reserved`insert into events (id, event_id, type, session_id, occurred_at)
        values (gen_random_uuid(), ${slowId}, 'unlock', ${session.id}, now())`;

      // seq N+1 commits first on the pool, so the stream sees it before N.
      await db.insert(events).values({
        eventId: fastId,
        type: 'refocus',
        sessionId: session.id,
        occurredAt: new Date(),
      });
      await stream.waitFor((e) => e.some((x) => x.eventId === fastId));

      // Now the slow, lower-seq event finally commits.
      await reserved`commit`;
    } finally {
      reserved.release();
    }

    // The overlap re-read must still deliver the late, lower-seq event.
    await stream.waitFor((e) => e.some((x) => x.eventId === slowId));
    // Let several re-poll cycles pass: a broken dedupe would re-deliver it, so
    // "exactly one" only means something once the re-reads have had their chance.
    await new Promise((r) => setTimeout(r, 300));
    const delivered = stream.events.filter((e) => e.eventId === slowId);
    expect(delivered).toHaveLength(1);
    stream.close();
  });

  it('caps live streams per teacher (429)', async () => {
    const { teacher, session } = await seedRunning('stream-cap');
    const token = await tokenFor(teacher.cognitoId);
    const open: Stream[] = [];
    for (let i = 0; i < 3; i += 1) open.push(await openStream(session.id, token));
    expect(open.every((s) => s.status === 200)).toBe(true);
    // The 4th (cap is 3) is refused.
    const overflow = await openStream(session.id, token);
    expect(overflow.status).toBe(429);
    overflow.close();

    // Closing a stream frees its slot: after the server sees the disconnect, a
    // new stream is admitted again (teardown decrements the per-teacher count).
    open[0]!.close();
    await new Promise((r) => setTimeout(r, 200));
    const readmitted = await openStream(session.id, token);
    expect(readmitted.status).toBe(200);
    readmitted.close();
    for (const s of open.slice(1)) s.close();
  });
});
