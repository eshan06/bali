import { type Database, enrollments, startSession, tapIn, users } from '@bali/db';
import type { EventsPage, SessionSnapshot } from '@bali/shared';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
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

function get(token: string, url: string) {
  return authedInject(ctx.app, token, { method: 'GET', url });
}

describe('GET /v1/sessions/:id (snapshot)', () => {
  it('the owning teacher gets the session, roster, and latest seq', async () => {
    const { teacher, student, session } = await seedRunning('snap');
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    const res = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json<SessionSnapshot>();
    expect(body.session.id).toBe(session.id);
    expect(body.ended).toBe(false);
    expect(body.latestSeq).toBeGreaterThan(0);
    expect(body.students).toHaveLength(1);
    expect(body.students[0]!.state).toBe('focused');
    expect(body.students[0]!.joinedAt).not.toBeNull();
  });

  it('an enrolled student who has not tapped in shows null participation', async () => {
    const { teacher, school, klass, session } = await seedRunning('snap-null');
    const other = one(
      await db
        .insert(users)
        .values({ cognitoId: 'snap-null-2', role: 'student', schoolId: school.id })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: klass.id, studentId: other.id });

    const body = (
      await get(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${session.id}`)
    ).json<SessionSnapshot>();
    const entry = body.students.find((s) => s.studentId === other.id);
    expect(entry?.state).toBeNull();
    expect(entry?.joinedAt).toBeNull();
    expect(entry?.lastSeenAt).toBeNull();
  });

  it('another teacher cannot read it (403)', async () => {
    const { session } = await seedRunning('snap-owner');
    const other = await seedClassroom(db, 'snap-other');
    const res = await get(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}`,
    );
    expect(res.statusCode).toBe(403);
  });

  it('a student cannot read it (403)', async () => {
    const { student, session } = await seedRunning('snap-student');
    const res = await get(await ctx.tokenFor(student.cognitoId), `/v1/sessions/${session.id}`);
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'snap-404');
    const res = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/sessions/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('snap-auth');
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/sessions/${session.id}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/sessions/:id/events', () => {
  it('returns the session events in seq order, and after= filters', async () => {
    const { teacher, student, session } = await seedRunning('events');
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    const token = await ctx.tokenFor(teacher.cognitoId);

    const all = (await get(token, `/v1/sessions/${session.id}/events`)).json<EventsPage>();
    const types = all.events.map((e) => e.type);
    expect(types).toContain('session_started');
    expect(types).toContain('tap_in');
    const seqs = all.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(all.nextAfter).toBe(seqs[seqs.length - 1]);

    const after = (
      await get(token, `/v1/sessions/${session.id}/events?after=${all.events[0]!.seq}`)
    ).json<EventsPage>();
    expect(after.events.every((e) => e.seq > all.events[0]!.seq)).toBe(true);
  });

  it('another teacher cannot read the events (403)', async () => {
    const { session } = await seedRunning('events-owner');
    const other = await seedClassroom(db, 'events-other');
    const res = await get(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/events`,
    );
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'events-404');
    const res = await get(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${randomUUID()}/events`,
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-numeric after (400)', async () => {
    const { teacher, session } = await seedRunning('events-badafter');
    const res = await get(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/events?after=nope`,
    );
    expect(res.statusCode).toBe(400);
  });
});
