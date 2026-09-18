import { type Database, enrollments, startSession } from '@bali/db';
import type { EndEnrollmentResponse, EnrollmentJoinResponse, RosterResponse } from '@bali/shared';
import { and, eq, isNull } from 'drizzle-orm';
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

async function activeEnrollmentId(classId: string, studentId: string): Promise<string> {
  const rows = await db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.classId, classId),
        eq(enrollments.studentId, studentId),
        isNull(enrollments.removedAt),
      ),
    );
  const row = rows[0];
  if (!row) throw new Error('no active enrollment');
  return row.id;
}

function join(token: string, body: object) {
  return authedInject(ctx.app, token, { method: 'POST', url: '/v1/enrollments', payload: body });
}

function del(token: string, enrollmentId: string) {
  return ctx.app.inject({
    method: 'DELETE',
    url: `/v1/enrollments/${enrollmentId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('POST /v1/enrollments', () => {
  it('a new student joins a class by its code', async () => {
    const { klass } = await seedClassroom(db, 'join');
    const res = await join(await ctx.tokenFor('newcomer'), {
      joinCode: klass.joinCode,
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<EnrollmentJoinResponse>();
    expect(body.outcome).toBe('joined');
    expect(body.class.id).toBe(klass.id);
  });

  it('joining again is a no-op (already_enrolled), not an error', async () => {
    const { klass, student } = await seedClassroom(db, 'join-dup');
    const res = await join(await ctx.tokenFor(student.cognitoId), {
      joinCode: klass.joinCode,
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<EnrollmentJoinResponse>().outcome).toBe('already_enrolled');
  });

  it('is a 404 for an unknown join code', async () => {
    await seedClassroom(db, 'join-bad');
    const res = await join(await ctx.tokenFor('someone'), {
      joinCode: 'NO-SUCH-CODE',
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('is a 400 for a malformed body', async () => {
    const res = await join(await ctx.tokenFor('someone'), { joinCode: '', eventId: 'nope' });
    expect(res.statusCode).toBe(400);
  });

  it('a teacher cannot join a class as a student (403)', async () => {
    const { teacher, klass } = await seedClassroom(db, 'join-teacher');
    const res = await join(await ctx.tokenFor(teacher.cognitoId), {
      joinCode: klass.joinCode,
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/enrollments', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/classes/:id/roster', () => {
  it('the class teacher sees the active roster', async () => {
    const { teacher, klass, student } = await seedClassroom(db, 'roster');
    const res = await authedInject(ctx.app, await ctx.tokenFor(teacher.cognitoId), {
      method: 'GET',
      url: `/v1/classes/${klass.id}/roster`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<RosterResponse>();
    expect(body.students).toHaveLength(1);
    expect(body.students[0]!.studentId).toBe(student.id);
  });

  it('a student cannot view the roster (403)', async () => {
    const { klass, student } = await seedClassroom(db, 'roster-student');
    const res = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'GET',
      url: `/v1/classes/${klass.id}/roster`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("another teacher cannot view someone else's roster (403)", async () => {
    const { klass } = await seedClassroom(db, 'roster-a');
    const other = await seedClassroom(db, 'roster-b');
    const res = await authedInject(ctx.app, await ctx.tokenFor(other.teacher.cognitoId), {
      method: 'GET',
      url: `/v1/classes/${klass.id}/roster`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /v1/enrollments/:id', () => {
  it('a student leaves their own class (left_class)', async () => {
    const { klass, student } = await seedClassroom(db, 'leave');
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);
    const res = await del(await ctx.tokenFor(student.cognitoId), enrollmentId);
    expect(res.statusCode).toBe(200);
    const body = res.json<EndEnrollmentResponse>();
    expect(body.outcome).toBe('ended');
    expect(body.reason).toBe('left_class');
  });

  it('the teacher removes a student mid-session, ending their participation (removed_from_class)', async () => {
    const { teacher, klass, student, block } = await seedClassroom(db, 'remove');
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    // Tap the student into the running session.
    await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: '/v1/taps',
      payload: { tagId: block.tagId, eventId: randomUUID(), deviceTime: new Date().toISOString() },
    });
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);

    const res = await del(await ctx.tokenFor(teacher.cognitoId), enrollmentId);
    expect(res.statusCode).toBe(200);
    const body = res.json<EndEnrollmentResponse>();
    expect(body.reason).toBe('removed_from_class');
    expect(body.endedParticipation).toBe(true);
  });

  it("a different student cannot remove someone else's enrollment (403)", async () => {
    const { klass, student } = await seedClassroom(db, 'remove-idor');
    const other = await seedClassroom(db, 'remove-idor-other');
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);
    const res = await del(await ctx.tokenFor(other.student.cognitoId), enrollmentId);
    expect(res.statusCode).toBe(403);
  });

  it('a teacher who does not own the class cannot remove its enrollment (403)', async () => {
    const { klass, student } = await seedClassroom(db, 'remove-crossteacher');
    const other = await seedClassroom(db, 'remove-crossteacher-other');
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);
    // other.teacher is a real teacher, just not of THIS class — must be 403, not
    // 200 (a role-only check instead of ownership would wrongly allow this).
    const res = await del(await ctx.tokenFor(other.teacher.cognitoId), enrollmentId);
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown enrollment', async () => {
    const { teacher } = await seedClassroom(db, 'remove-404');
    const res = await del(await ctx.tokenFor(teacher.cognitoId), randomUUID());
    expect(res.statusCode).toBe(404);
  });
});
