import {
  classes,
  type Database,
  endEnrollment,
  endSession,
  enrollments,
  protectionOff,
  refocus,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import type { ActionOrder, ApiErrorBody, SessionReportResponse } from '@bali/shared';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { joinCodeFor, makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * R2 — GET /v1/classes/:id/reports/sessions/:sessionId: one session's report,
 * for the class's own teacher, from what the engine really stores. What it
 * counts is R1's, pinned rule by rule (packages/shared/src/report.test.ts,
 * packages/db/test/report.test.ts); here, what the route adds: the names, the
 * rounding, a session not over yet, and who may read it.
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** The server's clock, as the app reads it: each test sets it. */
let now: Date;

/** 09:00 on a school day, `minute` and `second` on. */
const at = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 0, 5, 9, 0, second) + minute * 60_000);

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  now = at(60);
  ctx = await makeAuthedApp(db, () => now);
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

type Classroom = Awaited<ReturnType<typeof seedClassroom>>;

/** Another student of the classroom's class, enrolled now. */
async function classmate(c: Classroom, tag: string) {
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `student-${tag}`, role: 'student', schoolId: c.school.id })
      .returning(),
  );
  const enrollment = one(
    await db.insert(enrollments).values({ classId: c.klass.id, studentId: student.id }).returning(),
  );
  return { ...student, enrollmentId: enrollment.id };
}

/** A 09:00–09:25 lesson for the class. */
async function lesson(classId: string) {
  return (await startSession(db, { classId, startedAt: at(0), endsAt: at(25) })).session;
}

/** The student's move in the session, made at `when` and heard then (A17). */
function move(sessionId: string, studentId: string, when: Date, order: ActionOrder | null = null) {
  return { sessionId, studentId, eventId: randomUUID(), deviceTime: when, order, now: when };
}

async function reportAs(cognitoId: string, classId: string, sessionId: string) {
  return authedInject(ctx.app, await ctx.tokenFor(cognitoId), {
    method: 'GET',
    url: `/v1/classes/${classId}/reports/sessions/${sessionId}`,
  });
}

/** A student as the report names them. */
const named = (student: { id: string }, displayName: string | null) => ({
  id: student.id,
  displayName,
});

describe('GET /v1/classes/:id/reports/sessions/:sessionId', () => {
  it('reports who joined, the class’s minutes, and every unlock and protection off, by name', async () => {
    const c = await seedClassroom(db, 'report');
    const ana = c.student;
    const ben = await classmate(c, 'report-ben');
    const cy = await classmate(c, 'report-cy');
    await renameStudent(db, { studentId: ana.id, displayName: 'Ana', eventId: randomUUID() });
    const session = await lesson(c.klass.id);

    // Ana: focused at 09:01, unlocked for the bathroom at 09:05, back at 09:08.
    await tapIn(db, move(session.id, ana.id, at(1)));
    const anaUnlock = { ...move(session.id, ana.id, at(5)), reason: 'bathroom' as const };
    await unlock(db, anaUnlock);
    await refocus(db, move(session.id, ana.id, at(8)));
    // Ben: focused at 09:02 until his Screen Time went off at 09:10.
    await tapIn(db, move(session.id, ben.id, at(2)));
    const benOff = move(session.id, ben.id, at(10));
    await protectionOff(db, benOff);
    // Cy: an unlock (#2) stuck on her phone while her re-tap (#3) went ahead.
    const install = randomUUID();
    await tapIn(db, move(session.id, cy.id, at(3), { install, seq: 1 }));
    const stuck = move(session.id, cy.id, at(6), { install, seq: 2 });
    await tapIn(db, move(session.id, cy.id, at(7), { install, seq: 3 }));
    expect((await unlock(db, stuck)).recordedAs).toBe('superseded');
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });
    // Since: Ben removed from the class, and a name of his own.
    await endEnrollment(db, {
      enrollmentId: ben.enrollmentId,
      reason: 'removed_from_class',
      at: at(30),
    });
    await renameStudent(db, { studentId: ben.id, displayName: 'Ben R.', eventId: randomUUID() });

    const res = await reportAs(c.teacher.cognitoId, c.klass.id, session.id);
    expect(res.statusCode).toBe(200);
    // Ana 4 + 17, Ben 8, Cy 22: the late unlock never ended her focus.
    expect(res.json<SessionReportResponse>()).toEqual({
      ended: true,
      joined: [named(ana, 'Ana'), named(ben, 'Ben R.'), named(cy, null)],
      focusMinutes: 51,
      averageFocusMinutes: 17,
      silentMinutes: 0,
      unlocks: [
        {
          eventId: anaUnlock.eventId,
          student: named(ana, 'Ana'),
          occurredAt: at(5).toISOString(),
          reason: 'bathroom',
          recordedAs: null,
        },
        {
          eventId: stuck.eventId,
          student: named(cy, null),
          occurredAt: at(6).toISOString(),
          reason: null,
          recordedAs: 'superseded',
        },
      ],
      protectionOffs: [
        {
          eventId: benOff.eventId,
          student: named(ben, 'Ben R.'),
          occurredAt: at(10).toISOString(),
          recordedAs: null,
        },
      ],
    });
  });

  it('rounds each figure from its exact minutes: the total is never a sum of rounded parts', async () => {
    // Ana and Ben each focused 12.3 minutes, 09:12:42 to the bell: 24.6 in all.
    // Rounded one by one and summed, 24; the average of a rounded total, 13.
    const c = await seedClassroom(db, 'rounding');
    const ben = await classmate(c, 'rounding-ben');
    const session = await lesson(c.klass.id);
    await tapIn(db, move(session.id, c.student.id, at(12, 42)));
    await tapIn(db, move(session.id, ben.id, at(12, 42)));
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    const res = await reportAs(c.teacher.cognitoId, c.klass.id, session.id);
    expect(res.json<SessionReportResponse>()).toMatchObject({
      focusMinutes: 25,
      averageFocusMinutes: 12,
    });
  });

  it('answers a session not over yet: to now while it runs, to its bell past it, ended once swept', async () => {
    const c = await seedClassroom(db, 'running');
    const session = await lesson(c.klass.id);
    await tapIn(db, move(session.id, c.student.id, at(1)));
    const read = async () =>
      (await reportAs(c.teacher.cognitoId, c.klass.id, session.id)).json<SessionReportResponse>();

    now = at(10);
    expect(await read()).toMatchObject({
      ended: false,
      joined: [named(c.student, null)],
      focusMinutes: 9,
      averageFocusMinutes: 9,
    });
    // Past its bell, before the sweep marks it: counted to the bell, not marked over yet.
    now = at(40);
    expect(await read()).toMatchObject({ ended: false, focusMinutes: 24 });
    await endSession(db, { sessionId: session.id, at: now, reason: 'expired' });
    expect(await read()).toMatchObject({ ended: true, focusMinutes: 24 });
  });

  it('reports a session no one joined: no average, never zero', async () => {
    const c = await seedClassroom(db, 'empty');
    const session = await lesson(c.klass.id);

    const res = await reportAs(c.teacher.cognitoId, c.klass.id, session.id);
    expect(res.json<SessionReportResponse>()).toEqual({
      ended: false,
      joined: [],
      focusMinutes: 0,
      averageFocusMinutes: null,
      silentMinutes: 0,
      unlocks: [],
      protectionOffs: [],
    });
  });

  it('refuses another teacher, and any student, the class’s own included (403)', async () => {
    const c = await seedClassroom(db, 'authz');
    const other = await seedClassroom(db, 'authz-other');
    const session = await lesson(c.klass.id);
    await tapIn(db, move(session.id, c.student.id, at(1)));

    for (const caller of [other.teacher, c.student, other.student]) {
      const res = await reportAs(caller.cognitoId, c.klass.id, session.id);
      expect(res.statusCode).toBe(403);
      expect(res.json<ApiErrorBody>().error.code).toBe('forbidden');
      expect(res.body).not.toContain(c.student.id);
    }
  });

  it('requires a sign-in (401)', async () => {
    const c = await seedClassroom(db, 'no-token');
    const session = await lesson(c.klass.id);
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/classes/${c.klass.id}/reports/sessions/${session.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a malformed id (400) in the one error shape', async () => {
    const c = await seedClassroom(db, 'malformed');
    const session = await lesson(c.klass.id);

    for (const [classId, sessionId] of [
      ['not-a-uuid', session.id],
      [c.klass.id, 'not-a-uuid'],
    ] as const) {
      const res = await reportAs(c.teacher.cognitoId, classId, sessionId);
      expect(res.statusCode).toBe(400);
      expect(res.json<ApiErrorBody>()).toMatchObject({
        error: { code: 'bad_input', message: 'invalid request' },
      });
    }
  });

  it('answers a session in another class as an unknown one, and an unknown class (404)', async () => {
    const c = await seedClassroom(db, 'scope');
    const other = await seedClassroom(db, 'scope-other');
    // The teacher's own second class, and another teacher's: neither session is this class's.
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: c.teacher.id,
          schoolId: c.school.id,
          name: 'Second',
          joinCode: joinCodeFor('scope-second'),
        })
        .returning(),
    );
    const mine = await lesson(second.id);
    const theirs = await lesson(other.klass.id);
    await tapIn(db, move(theirs.id, other.student.id, at(1)));

    for (const sessionId of [mine.id, theirs.id, randomUUID()]) {
      const res = await reportAs(c.teacher.cognitoId, c.klass.id, sessionId);
      expect(res.statusCode).toBe(404);
      expect(res.json<ApiErrorBody>().error).toMatchObject({
        code: 'not_found',
        reason: 'session_not_found',
      });
      expect(res.body).not.toContain(other.student.id);
    }
    const unknown = await reportAs(c.teacher.cognitoId, randomUUID(), mine.id);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().error).toMatchObject({
      code: 'not_found',
      reason: 'class_not_found',
    });
  });
});
