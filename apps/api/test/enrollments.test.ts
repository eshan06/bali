import {
  classes,
  type Database,
  enrollments,
  findUserByCognitoId,
  startSession,
  users,
} from '@bali/db';
import type {
  ClassDetail,
  EndEnrollmentResponse,
  EnrollmentJoinResponse,
  JoinCodePreviewResponse,
  RosterResponse,
} from '@bali/shared';
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

/** GET /v1/join-codes/:code — `code` goes into the path as given, so a test can encode it. */
function preview(token: string | null, code: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/v1/join-codes/${code}`,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

/** A join by `joinCode`, with a fresh id and the phone's clock. */
function joinBy(token: string, joinCode: string) {
  return join(token, { joinCode, eventId: randomUUID(), deviceTime: new Date().toISOString() });
}

const noClass = {
  error: { code: 'not_found', reason: 'class_not_found', message: 'no class with that join code' },
};

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

describe('GET /v1/join-codes/:code', () => {
  it('shows what a code opens — the class and its teacher — and writes nothing', async () => {
    const { klass, teacher } = await seedClassroom(db, 'preview');
    await db.update(users).set({ displayName: 'Ms. Rivera' }).where(eq(users.id, teacher.id));
    const newcomer = await ctx.tokenFor('preview-newcomer');

    const res = await preview(newcomer, klass.joinCode);
    expect(res.statusCode).toBe(200);
    expect(res.json<JoinCodePreviewResponse>()).toEqual({
      class: { id: klass.id, name: klass.name },
      teacher: { displayName: 'Ms. Rivera' },
      alreadyEnrolled: false,
    });
    // A read: a first-time caller gets no row from it (the join makes one).
    expect(await findUserByCognitoId(db, 'preview-newcomer')).toBeUndefined();
    expect((await joinBy(newcomer, klass.joinCode)).json<EnrollmentJoinResponse>().outcome).toBe(
      'joined',
    );
  });

  it('says when the caller is in the class already, and not once they have left', async () => {
    const { klass, student } = await seedClassroom(db, 'preview-member');
    const token = await ctx.tokenFor(student.cognitoId);

    const member = await preview(token, klass.joinCode);
    expect(member.statusCode).toBe(200);
    // This teacher's account carries no name: the screen says "your teacher".
    expect(member.json<JoinCodePreviewResponse>()).toEqual({
      class: { id: klass.id, name: klass.name },
      teacher: { displayName: null },
      alreadyEnrolled: true,
    });
    await del(token, await activeEnrollmentId(klass.id, student.id));
    const left = await preview(token, klass.joinCode);
    expect(left.json<JoinCodePreviewResponse>().alreadyEnrolled).toBe(false);
  });

  it('matches a code as the join does: case and surrounding spaces are noise', async () => {
    const { klass } = await seedClassroom(db, 'preview-typed');
    const token = await ctx.tokenFor('preview-typist');
    const typed = ` ${klass.joinCode.toLowerCase()}\n`;

    const res = await preview(token, encodeURIComponent(typed));
    expect(res.statusCode).toBe(200);
    expect(res.json<JoinCodePreviewResponse>().class.id).toBe(klass.id);
    const joined = await joinBy(token, typed);
    expect(joined.statusCode).toBe(200);
    expect(joined.json<EnrollmentJoinResponse>().class.id).toBe(klass.id);
  });

  it('refuses a code no class holds with the join’s 404, reason and all', async () => {
    await seedClassroom(db, 'preview-unknown');
    const token = await ctx.tokenFor('preview-guesser');
    for (const res of [await preview(token, 'NO-SUCH-CODE'), await joinBy(token, 'NO-SUCH-CODE')]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(noClass);
    }
  });

  it('refuses an archived class’s code as the join does, and names the live class reusing it', async () => {
    const { klass, teacher, school } = await seedClassroom(db, 'preview-archived');
    await db.update(classes).set({ removedAt: new Date() }).where(eq(classes.id, klass.id));
    const token = await ctx.tokenFor('preview-late');
    for (const res of [await preview(token, klass.joinCode), await joinBy(token, klass.joinCode)]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(noClass);
    }

    // Only live classes hold a code, so the archived one frees it for another.
    const [reuse] = await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: 'Next year',
        joinCode: klass.joinCode,
      })
      .returning();
    const previewed = await preview(token, klass.joinCode);
    expect(previewed.json<JoinCodePreviewResponse>().class).toEqual({
      id: reuse!.id,
      name: 'Next year',
    });
    const joined = await joinBy(token, klass.joinCode);
    expect(joined.json<EnrollmentJoinResponse>().class.id).toBe(reuse!.id);
  });

  it('refuses a regenerated class’s old code as the join does; the new one opens it', async () => {
    const { klass, teacher } = await seedClassroom(db, 'preview-regen');
    const regen = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/classes/${klass.id}`,
      headers: { authorization: `Bearer ${await ctx.tokenFor(teacher.cognitoId)}` },
      payload: { regenerateCode: true },
    });
    const fresh = regen.json<ClassDetail>().joinCode;
    expect(fresh).not.toBe(klass.joinCode);
    const token = await ctx.tokenFor('preview-stale');

    for (const res of [await preview(token, klass.joinCode), await joinBy(token, klass.joinCode)]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(noClass);
    }
    expect((await preview(token, fresh)).json<JoinCodePreviewResponse>().class.id).toBe(klass.id);
  });

  it('is a 400 for an empty code; a blank one names no class, as the join has always said', async () => {
    const token = await ctx.tokenFor('preview-blank');
    const empty = await preview(token, '');
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: { code: 'bad_input' } });
    // Checked as sent, before trimming (`JoinCode`): normalising only ever
    // turns a join's 404 into a join, never its 404 into a 400.
    for (const res of [await preview(token, '%20%20'), await joinBy(token, '  ')]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(noClass);
    }
  });

  it('requires authentication', async () => {
    const { klass } = await seedClassroom(db, 'preview-anon');
    const res = await preview(null, klass.joinCode);
    expect(res.statusCode).toBe(401);
  });

  it('a teacher cannot preview joining a class (403), as they cannot join one', async () => {
    const { klass, teacher } = await seedClassroom(db, 'preview-teacher');
    const token = await ctx.tokenFor(teacher.cognitoId);
    for (const res of [await preview(token, klass.joinCode), await joinBy(token, klass.joinCode)]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: { code: 'forbidden', message: 'teachers cannot join a class as a student' },
      });
    }
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

  const notYours = {
    error: {
      code: 'forbidden',
      reason: 'enrollment_not_yours',
      message: 'not allowed to remove this enrollment',
    },
  };

  it("a different student cannot remove someone else's enrollment (403)", async () => {
    const { klass, student } = await seedClassroom(db, 'remove-idor');
    const other = await seedClassroom(db, 'remove-idor-other');
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);
    const res = await del(await ctx.tokenFor(other.student.cognitoId), enrollmentId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(notYours);
  });

  it('a teacher who does not own the class cannot remove its enrollment (403)', async () => {
    const { klass, student } = await seedClassroom(db, 'remove-crossteacher');
    const other = await seedClassroom(db, 'remove-crossteacher-other');
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);
    // other.teacher is a real teacher, just not of THIS class — must be 403, not
    // 200 (a role-only check instead of ownership would wrongly allow this).
    const res = await del(await ctx.tokenFor(other.teacher.cognitoId), enrollmentId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(notYours);
  });

  it('a caller with no account here yet is refused as unknown (403), told apart by reason', async () => {
    const { klass, student } = await seedClassroom(db, 'remove-stranger');
    const enrollmentId = await activeEnrollmentId(klass.id, student.id);
    const res = await del(await ctx.tokenFor('never-signed-in'), enrollmentId);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'forbidden', reason: 'unknown_user', message: 'unknown user' },
    });
  });

  it('is a 404 for an unknown enrollment', async () => {
    const { teacher } = await seedClassroom(db, 'remove-404');
    const res = await del(await ctx.tokenFor(teacher.cognitoId), randomUUID());
    expect(res.statusCode).toBe(404);
    // The route's own check answers with the engine's refusal for the same
    // condition, reason and all (A5).
    expect(res.json()).toEqual({
      error: { code: 'not_found', reason: 'enrollment_not_found', message: 'enrollment not found' },
    });
  });
});
