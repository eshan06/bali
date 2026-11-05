import {
  type Database,
  endSession,
  enrollments,
  newUuidV7,
  parseSchoolCommand,
  renameStudent,
  sessions,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import type { SessionReportResponse, StartSessionResponse } from '@bali/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyticsConfig, createAnalytics, ownerEnds } from '../src/analytics.js';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

/*
 * PostHog, the server's half (A2): a class's totals when a session starts, ends or is extended,
 * through a fake fetch, so nothing leaves the process.
 */

const KEY = 'phc_testProjectKey0123456789';
const on: Env = { ...testEnv, LOG_LEVEL: 'info', POSTHOG_KEY: KEY };
const MIN = 60_000;

/**
 * What a server event's properties may hold, pinned here apart from the code that builds them: a
 * property added there fails these tests until it is added here, on purpose (ARCHITECTURE,
 * "Analytics (PostHog)").
 */
const ALLOWED = [
  'environment',
  'students_enrolled',
  'students_tapped_in',
  'planned_minutes',
  'session_minutes',
  'focus_minutes',
  'unlocks',
  'ended_by',
];

interface Posted {
  url: string;
  body: {
    api_key: string;
    event: string;
    distinct_id: string;
    timestamp: string;
    properties: Record<string, unknown>;
  };
}

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let issuer: TestIssuer;
let posted: Posted[];
let answer: () => Promise<Response>;
let lines: string[];
/**
 * The server's clock: a minute's start, so whole minutes count exactly, one to two minutes ahead
 * of the machine's, so every row a test writes (the database stamps it) was made before it.
 */
let now: Date;

// As analytics.ts sends: the endpoint as a string, the event as JSON text.
const posthogFetch = ((url: string, init: RequestInit & { body: string }) => {
  posted.push({ url, body: JSON.parse(init.body) as Posted['body'] });
  // As the real fetch does, a send stops at its signal's abort: its timeout.
  return new Promise<Response>((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
    answer().then(resolve, reject);
  });
}) as typeof fetch;

/** The sender alone, on the test's database, fetch and clock. */
const sender = () =>
  createAnalytics(
    analyticsConfig(on),
    db,
    { warn: () => undefined, error: () => undefined },
    { fetch: posthogFetch, clock: () => now },
  );

function build(env: Env): FastifyInstance {
  lines = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return buildApp(env, {
    db,
    verifyToken: issuer.verifier,
    logStream,
    posthogFetch,
    clock: () => now,
  });
}

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  posted = [];
  answer = () => Promise.resolve(new Response(null, { status: 200 }));
  now = new Date(Math.floor(Date.now() / MIN) * MIN + 2 * MIN);
  app = build(on);
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

async function as(sub: string, url: string, payload: object = {}) {
  const authorization = `Bearer ${await issuer.sign({ sub })}`;
  return app.inject({ method: 'POST', url, headers: { authorization }, payload });
}

async function start(sub: string, classId: string) {
  const res = await as(sub, `/v1/classes/${classId}/sessions`, { durationMinutes: 25 });
  expect(res.statusCode).toBe(200);
  return res.json<StartSessionResponse>();
}

/** Wait out the background sends: app.close() drains them, as the shutdown does. */
const settle = () => app.close();

const events = () => posted.map((p) => p.body.event);

describe('off until its key is set', () => {
  it('sends nothing at all while POSTHOG_KEY is unset, and says so once', async () => {
    await app.close();
    app = build({ ...testEnv, LOG_LEVEL: 'info' });
    const room = await seedClassroom(db, 'a2-off');
    const started = await start(room.teacher.cognitoId, room.klass.id);
    const session = `/v1/sessions/${started.session.id}`;
    const extend = { durationMinutes: 5, eventId: newUuidV7() };
    expect((await as(room.teacher.cognitoId, `${session}/extend`, extend)).statusCode).toBe(200);
    expect((await as(room.teacher.cognitoId, `${session}/end`)).statusCode).toBe(200);
    await startSession(db, {
      classId: room.klass.id,
      startedAt: new Date(now.getTime() - 30 * MIN),
      endsAt: new Date(now.getTime() - 5 * MIN),
    });
    expect((await app.sweep(now)).expired).toBe(1);
    await settle();

    expect(posted).toEqual([]);
    expect(lines.filter((line) => line.includes('analytics is off'))).toHaveLength(1);
    expect(lines.join('')).not.toContain('analytics is on');
  });

  it('says it is on, once, and never the key', async () => {
    const room = await seedClassroom(db, 'a2-on');
    await start(room.teacher.cognitoId, room.klass.id);
    await settle();
    expect(lines.filter((line) => line.includes('analytics is on'))).toHaveLength(1);
    expect(lines.join('')).not.toContain(KEY);
    // The key is in the body PostHog's capture endpoint reads, and nowhere else.
    expect(posted).toMatchObject([
      { url: 'https://us.i.posthog.com/i/v0/e/', body: { api_key: KEY } },
    ]);
  });
});

describe('one event each, as the teacher, at the server’s clock', () => {
  it('a Start, an extend and an End send one each, and their replays none', async () => {
    const room = await seedClassroom(db, 'a2-each');
    const teacher = room.teacher.cognitoId;
    const started = await start(teacher, room.klass.id);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toEqual({
      api_key: KEY,
      event: 'session_started',
      distinct_id: room.teacher.id,
      timestamp: now.toISOString(),
      properties: {
        environment: 'test',
        students_enrolled: 1,
        students_tapped_in: 0,
        planned_minutes: 25,
        session_minutes: 0,
        focus_minutes: 0,
        unlocks: 0,
      },
    });
    // The resent Start finds its session running: nothing changed, nothing counted.
    expect((await start(teacher, room.klass.id)).outcome).toBe('existing');

    now = new Date(now.getTime() + 5 * MIN);
    const session = `/v1/sessions/${started.session.id}`;
    const extend = { durationMinutes: 10, eventId: newUuidV7() };
    expect((await as(teacher, `${session}/extend`, extend)).statusCode).toBe(200);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.body).toMatchObject({
      event: 'session_extended',
      distinct_id: room.teacher.id,
      timestamp: now.toISOString(),
      properties: { planned_minutes: 35, session_minutes: 5 },
    });
    expect(posted[1]!.body.properties).not.toHaveProperty('ended_by');
    // The same press again, after a lost answer: a replay, not another extend.
    expect((await as(teacher, `${session}/extend`, extend)).statusCode).toBe(200);

    const ended = await as(teacher, `${session}/end`);
    expect(ended.json()).toMatchObject({ outcome: 'ended' });
    await vi.waitFor(() => expect(posted).toHaveLength(3));
    const [row] = await db.select().from(sessions).where(eq(sessions.id, started.session.id));
    expect(posted[2]!.body).toMatchObject({
      event: 'session_ended',
      distinct_id: room.teacher.id,
      // When the server recorded the end.
      timestamp: row!.endedAt!.toISOString(),
      properties: { ended_by: 'teacher', planned_minutes: 35 },
    });
    expect((await as(teacher, `${session}/end`)).json()).toMatchObject({
      outcome: 'already_ended',
    });

    await settle();
    expect(events()).toEqual(['session_started', 'session_extended', 'session_ended']);
  });

  it('the sweep sends one for each session it ended, by the bell, and none on its next run', async () => {
    const room = await seedClassroom(db, 'a2-sweep');
    await start(room.teacher.cognitoId, room.klass.id);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const bell = new Date(now.getTime() + 25 * MIN);

    expect((await app.sweep(new Date(bell.getTime() + 5 * MIN))).expired).toBe(1);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.body).toMatchObject({
      event: 'session_ended',
      distinct_id: room.teacher.id,
      timestamp: bell.toISOString(),
      properties: { ended_by: 'bell', planned_minutes: 25, session_minutes: 25 },
    });

    expect((await app.sweep(new Date(bell.getTime() + 6 * MIN))).expired).toBe(0);
    await settle();
    expect(events()).toEqual(['session_started', 'session_ended']);
  });

  it('a Start past the bell counts the old session’s end, by the bell, and its own start (A18)', async () => {
    const room = await seedClassroom(db, 'a2-past-bell');
    const old = await startSession(db, {
      classId: room.klass.id,
      startedAt: new Date(now.getTime() - 50 * MIN),
      endsAt: new Date(now.getTime() - 10 * MIN),
    });
    const started = await start(room.teacher.cognitoId, room.klass.id);
    expect(started.session.id).not.toBe(old.session.id);
    await settle();

    expect(posted.map((p) => p.body).sort((a, b) => a.event.localeCompare(b.event))).toMatchObject([
      {
        event: 'session_ended',
        timestamp: old.session.endsAt.toISOString(),
        properties: { ended_by: 'bell', planned_minutes: 40, session_minutes: 40 },
      },
      {
        event: 'session_started',
        timestamp: now.toISOString(),
        properties: { planned_minutes: 25 },
      },
    ]);
  });
});

describe('what an event carries', () => {
  it('the allow-list alone, the teacher by Bali’s id, and nothing of a student, a class or a school', async () => {
    const room = await seedClassroom(db, 'a2-pii');
    await db.update(users).set({ displayName: 'Ms Rivera' }).where(eq(users.id, room.teacher.id));
    await renameStudent(db, {
      studentId: room.student.id,
      displayName: 'Ana Ruiz',
      eventId: newUuidV7(),
    });
    const [other] = await db
      .insert(users)
      .values({
        cognitoId: 'ben.okafor@vanderbilt.edu',
        role: 'student',
        schoolId: room.school.id,
        displayName: 'Ben Okafor',
      })
      .returning();
    await db.insert(enrollments).values({ classId: room.klass.id, studentId: other!.id });

    const teacher = room.teacher.cognitoId;
    const started = await start(teacher, room.klass.id);
    const lesson = started.session.id;
    await tapIn(db, {
      sessionId: lesson,
      studentId: room.student.id,
      eventId: newUuidV7(),
      deviceTime: now,
      now,
    });
    await unlock(db, {
      sessionId: lesson,
      studentId: room.student.id,
      eventId: newUuidV7(),
      deviceTime: now,
      reason: 'nurse',
    });
    const extend = { durationMinutes: 5, eventId: newUuidV7() };
    expect((await as(teacher, `/v1/sessions/${lesson}/extend`, extend)).statusCode).toBe(200);
    expect((await as(teacher, `/v1/sessions/${lesson}/end`)).statusCode).toBe(200);
    await settle();

    expect(events().sort()).toEqual(['session_ended', 'session_extended', 'session_started']);
    const never = [
      room.student.id,
      room.student.cognitoId,
      'Ana Ruiz',
      other!.id,
      'ben.okafor@vanderbilt.edu',
      'Ben Okafor',
      room.teacher.cognitoId,
      'Ms Rivera',
      room.klass.name,
      room.klass.joinCode,
      room.school.name,
      room.school.id,
      room.block.tagId,
      lesson,
      'nurse',
    ];
    for (const { body } of posted) {
      expect(Object.keys(body).sort()).toEqual([
        'api_key',
        'distinct_id',
        'event',
        'properties',
        'timestamp',
      ]);
      expect(body.distinct_id).toBe(room.teacher.id);
      for (const key of Object.keys(body.properties)) expect(ALLOWED, key).toContain(key);
      for (const value of Object.values(body.properties)) {
        expect(['number', 'string'], String(value)).toContain(typeof value);
      }
      const text = JSON.stringify(body);
      for (const word of never) expect(text, word).not.toContain(word);
    }
    expect(posted.find((p) => p.body.event === 'session_ended')!.body.properties).toEqual({
      environment: 'test',
      students_enrolled: 2,
      students_tapped_in: 1,
      planned_minutes: 30,
      session_minutes: expect.any(Number) as number,
      focus_minutes: 0,
      // One number, never by reason.
      unlocks: 1,
      ended_by: 'teacher',
    });
  });

  it('counts as the session’s report counts', async () => {
    const room = await seedClassroom(db, 'a2-report');
    const at = (minutes: number) => new Date(now.getTime() + minutes * MIN);
    const { session } = await startSession(db, {
      classId: room.klass.id,
      startedAt: at(-20),
      endsAt: at(5),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: room.student.id,
      eventId: newUuidV7(),
      deviceTime: at(-19),
      now: at(-19),
    });
    await unlock(db, {
      sessionId: session.id,
      studentId: room.student.id,
      eventId: newUuidV7(),
      deviceTime: at(-10),
    });
    const teacher = await issuer.sign({ sub: room.teacher.cognitoId });
    const ended = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/end`,
      headers: { authorization: `Bearer ${teacher}` },
    });
    expect(ended.statusCode).toBe(200);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const report = (
      await app.inject({
        method: 'GET',
        url: `/v1/classes/${room.klass.id}/reports/sessions/${session.id}`,
        headers: { authorization: `Bearer ${teacher}` },
      })
    ).json<SessionReportResponse>();
    expect(report.focusMinutes).toBe(9);

    expect(posted[0]!.body.properties).toMatchObject({
      students_enrolled: 1,
      students_tapped_in: report.joined.length,
      focus_minutes: report.focusMinutes,
      unlocks: report.unlocks.length,
      planned_minutes: 25,
    });
  });

  it('counts the class as enrolled at the session’s end, whatever came after it', async () => {
    const room = await seedClassroom(db, 'a2-enrolled');
    const at = (minutes: number) => new Date(now.getTime() + minutes * MIN);
    const { session } = await startSession(db, {
      classId: room.klass.id,
      startedAt: at(-50),
      endsAt: at(-10),
    });
    await endSession(db, { sessionId: session.id, at: at(-20), reason: 'ended' });
    const enroll = async (sub: string, createdAt: Date, removedAt: Date | null) => {
      const [student] = await db
        .insert(users)
        .values({ cognitoId: sub, role: 'student', schoolId: room.school.id })
        .returning();
      await db
        .insert(enrollments)
        .values({ classId: room.klass.id, studentId: student!.id, createdAt, removedAt });
    };
    // In the class at the end: the seed's student, and one who left after it.
    await db
      .update(enrollments)
      .set({ createdAt: at(-60) })
      .where(eq(enrollments.studentId, room.student.id));
    await enroll('a2-left-after', at(-60), at(-15));
    // Not in it: one who left before the end, and one who joined after it.
    await enroll('a2-left-before', at(-60), at(-30));
    await enroll('a2-joined-after', at(-5), null);

    const analytics = sender();
    analytics.track('session_ended', session.id, 'teacher');
    await analytics.settled();
    expect(posted).toMatchObject([
      { body: { event: 'session_ended', properties: { students_enrolled: 2 } } },
    ]);
  });

  it('the owner’s commands count each lesson they end, a disposal’s with the class it ended', async () => {
    // Two classes of one school: a lesson running in the first, one past its bell in the second.
    const room = await seedClassroom(db, 'a2-dispose');
    const next = await seedClassroom(db, 'a2-dispose-2', room.school);
    const running = await startSession(db, {
      classId: room.klass.id,
      startedAt: new Date(now.getTime() - 10 * MIN),
      endsAt: new Date(now.getTime() + 20 * MIN),
    });
    const past = await startSession(db, {
      classId: next.klass.id,
      startedAt: new Date(now.getTime() - 50 * MIN),
      endsAt: new Date(now.getTime() - 10 * MIN),
    });
    // Its student joined the second class before that lesson began.
    await db
      .update(enrollments)
      .set({ createdAt: new Date(now.getTime() - 60 * MIN) })
      .where(eq(enrollments.studentId, next.student.id));

    const analytics = sender();
    const dispose = ['dispose', room.school.id, '--confirm', room.school.name, '--end-lessons'];
    await parseSchoolCommand(dispose)!({ db, print: () => undefined, ended: ownerEnds(analytics) });
    await analytics.settled();

    // The disposal ends each enrollment with the lessons; each still counts the class it ended.
    const ends = posted.map((p) => p.body).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    expect(ends).toMatchObject([
      {
        event: 'session_ended',
        distinct_id: next.teacher.id,
        timestamp: past.session.endsAt.toISOString(),
        properties: { ended_by: 'bell', students_enrolled: 1 },
      },
      {
        event: 'session_ended',
        distinct_id: room.teacher.id,
        properties: { ended_by: 'owner', students_enrolled: 1 },
      },
    ]);
    const [over] = await db.select().from(sessions).where(eq(sessions.id, running.session.id));
    expect(ends[1]!.timestamp).toBe(over!.endedAt!.toISOString());
  });
});

describe('never in the way', () => {
  it('a refused or failed send never fails a Start, an extend, an End or the sweep, and is logged with nothing personal', async () => {
    const room = await seedClassroom(db, 'a2-fails');
    await renameStudent(db, {
      studentId: room.student.id,
      displayName: 'Ana Ruiz',
      eventId: newUuidV7(),
    });
    let sends = 0;
    answer = () =>
      (sends += 1) % 2 === 1
        ? Promise.reject(new Error(`connect ECONNREFUSED, sent ${KEY}`))
        : Promise.resolve(new Response('{"error":"bad"}', { status: 503 }));

    const teacher = room.teacher.cognitoId;
    const started = await start(teacher, room.klass.id);
    const session = `/v1/sessions/${started.session.id}`;
    const extend = { durationMinutes: 5, eventId: newUuidV7() };
    expect((await as(teacher, `${session}/extend`, extend)).statusCode).toBe(200);
    expect((await as(teacher, `${session}/end`)).statusCode).toBe(200);
    await startSession(db, {
      classId: room.klass.id,
      startedAt: new Date(now.getTime() - 30 * MIN),
      endsAt: new Date(now.getTime() - 5 * MIN),
    });
    expect((await app.sweep(now)).expired).toBe(1);
    await settle();

    expect(posted).toHaveLength(4);
    const log = lines.join('');
    expect(log).toContain('analytics event not sent');
    expect(log).toContain('[key]');
    expect(log).toContain('analytics event refused');
    expect(log).toContain('"status":503');
    for (const word of [KEY, room.student.id, room.teacher.id, 'Ana Ruiz', room.klass.name]) {
      expect(log, word).not.toContain(word);
    }
  });

  it('a send that hangs delays none of them: each answers while it waits', async () => {
    const room = await seedClassroom(db, 'a2-hangs');
    let release!: () => void;
    const hung = new Promise<void>((resolve) => (release = resolve));
    answer = () => hung.then(() => new Response(null, { status: 200 }));

    const teacher = room.teacher.cognitoId;
    const started = await start(teacher, room.klass.id);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const session = `/v1/sessions/${started.session.id}`;
    const extend = { durationMinutes: 5, eventId: newUuidV7() };
    expect((await as(teacher, `${session}/extend`, extend)).statusCode).toBe(200);
    expect((await as(teacher, `${session}/end`)).statusCode).toBe(200);
    await startSession(db, {
      classId: room.klass.id,
      startedAt: new Date(now.getTime() - 30 * MIN),
      endsAt: new Date(now.getTime() - 5 * MIN),
    });
    expect((await app.sweep(now)).expired).toBe(1);
    await vi.waitFor(() => expect(posted).toHaveLength(4));
    // Every answer is in, and every send still waits on PostHog.
    release();
    await settle();
    expect(events().sort()).toEqual([
      'session_ended',
      'session_ended',
      'session_extended',
      'session_started',
    ]);
  });

  it('gives a send up at its timeout, and says so', async () => {
    const room = await seedClassroom(db, 'a2-timeout');
    const { session } = await startSession(db, {
      classId: room.klass.id,
      startedAt: now,
      endsAt: new Date(now.getTime() + 25 * MIN),
    });
    const warned: [object, string][] = [];
    const untilAborted = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      })) as typeof fetch;
    const analytics = createAnalytics(
      analyticsConfig(on),
      db,
      { warn: (details, message) => warned.push([details, message]), error: () => undefined },
      { fetch: untilAborted, clock: () => now, timeoutMs: 20 },
    );

    analytics.track('session_started', session.id);
    await analytics.settled();
    expect(warned).toEqual([
      [
        {
          event: 'session_started',
          sessionId: session.id,
          failure: expect.stringMatching(/timeout/i) as string,
        },
        'analytics event not sent',
      ],
    ]);
  });
});

describe('its configuration', () => {
  it('is off without a key, blank included, and on with one, to PostHog’s US cloud by default', () => {
    expect(analyticsConfig({ NODE_ENV: 'production' })).toBeUndefined();
    expect(analyticsConfig({ POSTHOG_KEY: '', NODE_ENV: 'production' })).toBeUndefined();
    expect(analyticsConfig({ POSTHOG_KEY: KEY, NODE_ENV: 'production' })).toEqual({
      key: KEY,
      url: 'https://us.i.posthog.com/i/v0/e/',
      environment: 'production',
    });
  });

  it('takes a host, its trailing slash dropped, and the environment Sentry files under', () => {
    expect(
      analyticsConfig({
        POSTHOG_KEY: KEY,
        POSTHOG_HOST: 'https://eu.i.posthog.com/',
        SENTRY_ENVIRONMENT: 'dev',
        NODE_ENV: 'production',
      }),
    ).toEqual({ key: KEY, url: 'https://eu.i.posthog.com/i/v0/e/', environment: 'dev' });
  });
});
