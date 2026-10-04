import {
  checkIn,
  classes,
  type Database,
  endEnrollment,
  endSession,
  enrollments,
  markSilentParticipations,
  protectionOff,
  refocus,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import { backdateLastSeen } from '@bali/db/testing';
import {
  type ActionOrder,
  type ApiErrorBody,
  SESSION_REPORTS_PAGE_LIMIT,
  type SessionReportResponse,
  type SessionReportsPage,
} from '@bali/shared';
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
 *
 * R3 — GET /v1/classes/:id/reports/sessions: the class's sessions, newest
 * first, a page at a time, each with its totals — R2's, figure for figure.
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
  return lessonFrom(classId, 0);
}

/** A 25-minute lesson for the class, `from` minutes past 09:00. */
async function lessonFrom(classId: string, from: number) {
  return (await startSession(db, { classId, startedAt: at(from), endsAt: at(from + 25) })).session;
}

/** The teacher's own second class: none of its sessions are the first's. */
async function secondClass(c: Classroom, tag: string) {
  return one(
    await db
      .insert(classes)
      .values({
        teacherId: c.teacher.id,
        schoolId: c.school.id,
        name: 'Second',
        joinCode: joinCodeFor(tag),
      })
      .returning(),
  );
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

async function listAs(cognitoId: string, classId: string, query = '') {
  return authedInject(ctx.app, await ctx.tokenFor(cognitoId), {
    method: 'GET',
    url: `/v1/classes/${classId}/reports/sessions${query}`,
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
    const second = await secondClass(c, 'scope-second');
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

describe('GET /v1/classes/:id/reports/sessions', () => {
  it('lists the class’s sessions newest first, each with its totals — the one running too', async () => {
    const c = await seedClassroom(db, 'list');
    const ana = c.student;
    const ben = await classmate(c, 'list-ben');
    // 09:00–09:25, swept at the bell: Ana 4 + 17 around a bathroom unlock, Ben 23.
    const first = await lessonFrom(c.klass.id, 0);
    await tapIn(db, move(first.id, ana.id, at(1)));
    await unlock(db, { ...move(first.id, ana.id, at(5)), reason: 'bathroom' });
    await refocus(db, move(first.id, ana.id, at(8)));
    await tapIn(db, move(first.id, ben.id, at(2)));
    await endSession(db, { sessionId: first.id, at: at(25), reason: 'expired' });
    // 10:00–10:25, ended by the teacher at 10:20: Ben 9, until his Screen Time went off.
    const second = await lessonFrom(c.klass.id, 60);
    await tapIn(db, move(second.id, ben.id, at(61)));
    await protectionOff(db, move(second.id, ben.id, at(70)));
    await endSession(db, { sessionId: second.id, at: at(80), reason: 'ended' });
    // 11:00–11:25, running at 11:10: Ana 9 so far.
    const third = await lessonFrom(c.klass.id, 120);
    await tapIn(db, move(third.id, ana.id, at(121)));
    // Not this class's: the teacher's own other class, and another teacher's.
    await lessonFrom((await secondClass(c, 'list-second')).id, 120);
    await lessonFrom((await seedClassroom(db, 'list-other')).klass.id, 120);
    now = at(130);

    const res = await listAs(c.teacher.cognitoId, c.klass.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<SessionReportsPage>()).toEqual({
      sessions: [
        {
          id: third.id,
          startedAt: at(120).toISOString(),
          endsAt: at(145).toISOString(),
          endedAt: null,
          ended: false,
          joinedCount: 1,
          focusMinutes: 9,
          averageFocusMinutes: 9,
          silentMinutes: 0,
          unlockCount: 0,
          protectionOffCount: 0,
        },
        {
          id: second.id,
          startedAt: at(60).toISOString(),
          endsAt: at(85).toISOString(),
          endedAt: at(80).toISOString(),
          ended: true,
          joinedCount: 1,
          focusMinutes: 9,
          averageFocusMinutes: 9,
          silentMinutes: 0,
          unlockCount: 0,
          protectionOffCount: 1,
        },
        {
          id: first.id,
          startedAt: at(0).toISOString(),
          endsAt: at(25).toISOString(),
          endedAt: at(25).toISOString(),
          ended: true,
          joinedCount: 2,
          focusMinutes: 44,
          averageFocusMinutes: 22,
          silentMinutes: 0,
          unlockCount: 1,
          protectionOffCount: 0,
        },
      ],
      nextBefore: null,
    });
  });

  it('answers a class with no sessions yet with an empty page', async () => {
    const c = await seedClassroom(db, 'list-none');
    const res = await listAs(c.teacher.cognitoId, c.klass.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<SessionReportsPage>()).toEqual({ sessions: [], nextBefore: null });
  });

  it('agrees with each session’s own report, figure for figure (R2)', async () => {
    const c = await seedClassroom(db, 'agree');
    const ana = c.student;
    const ben = await classmate(c, 'agree-ben');
    // Ana and Ben each 12.3 minutes: 25 in all, an average of 12 (R2's rounding).
    const rounding = await lessonFrom(c.klass.id, 0);
    await tapIn(db, move(rounding.id, ana.id, at(12, 42)));
    await tapIn(db, move(rounding.id, ben.id, at(12, 42)));
    await endSession(db, { sessionId: rounding.id, at: at(25), reason: 'expired' });
    // Ana silent 10:05 to 10:08:30; Ben's unlock late behind his re-tap, then Screen Time off.
    const eventful = await lessonFrom(c.klass.id, 60);
    const install = randomUUID();
    await tapIn(db, move(eventful.id, ana.id, at(61)));
    await tapIn(db, move(eventful.id, ben.id, at(62), { install, seq: 1 }));
    await backdateLastSeen(db, { sessionId: eventful.id, studentId: ana.id }, at(61));
    expect(await markSilentParticipations(db, at(65))).toBe(1);
    const stuck = move(eventful.id, ben.id, at(66), { install, seq: 2 });
    await tapIn(db, move(eventful.id, ben.id, at(67), { install, seq: 3 }));
    expect((await unlock(db, stuck)).recordedAs).toBe('superseded');
    await checkIn(db, { sessionId: eventful.id, studentId: ana.id, deviceTime: at(68, 30) });
    await protectionOff(db, move(eventful.id, ben.id, at(77, 20)));
    await endSession(db, { sessionId: eventful.id, at: at(85), reason: 'expired' });
    // No one joined.
    const empty = await lessonFrom(c.klass.id, 120);
    await endSession(db, { sessionId: empty.id, at: at(145), reason: 'expired' });
    // Past its bell, not swept yet: counted to the bell, not marked over.
    const unswept = await lessonFrom(c.klass.id, 180);
    await tapIn(db, move(unswept.id, ana.id, at(190, 50)));
    now = at(230);

    const page = (await listAs(c.teacher.cognitoId, c.klass.id)).json<SessionReportsPage>();
    for (const row of page.sessions) {
      const res = await reportAs(c.teacher.cognitoId, c.klass.id, row.id);
      const report = res.json<SessionReportResponse>();
      expect(row, row.id).toMatchObject({
        ended: report.ended,
        joinedCount: report.joined.length,
        focusMinutes: report.focusMinutes,
        averageFocusMinutes: report.averageFocusMinutes,
        silentMinutes: report.silentMinutes,
        unlockCount: report.unlocks.length,
        protectionOffCount: report.protectionOffs.length,
      });
    }
    // What they agree on: Ana 4 + 16.5 and 3.5 silent, Ben 15⅓ — 35⅚ in all, a half up to 4 silent.
    const totals = (row: SessionReportsPage['sessions'][number]) => [
      row.id,
      row.ended,
      row.joinedCount,
      row.focusMinutes,
      row.averageFocusMinutes,
      row.silentMinutes,
      row.unlockCount,
      row.protectionOffCount,
    ];
    expect(page.sessions.map(totals)).toEqual([
      [unswept.id, false, 1, 14, 14, 0, 0, 0],
      [empty.id, true, 0, 0, null, 0, 0, 0],
      [eventful.id, true, 2, 36, 18, 4, 1, 1],
      [rounding.id, true, 2, 25, 12, 0, 0, 0],
    ]);
  });

  it('pages by a cursor that names a session: none skipped or repeated, a tie at one start included', async () => {
    const c = await seedClassroom(db, 'paging');
    const lessons = [];
    for (const from of [0, 30, 60, 90]) {
      const session = await lessonFrom(c.klass.id, from);
      // The fourth ends as it begins, and the fifth starts that same instant.
      const end = from === 90 ? at(90) : at(from + 25);
      await endSession(db, { sessionId: session.id, at: end, reason: 'ended' });
      lessons.push(session);
    }
    lessons.push(await lessonFrom(c.klass.id, 90));
    const newestFirst = lessons.map((s) => s.id).reverse();
    expect(newestFirst[0]! > newestFirst[1]!).toBe(true); // the tie, broken by id

    const pageOf = async (query: string) =>
      (await listAs(c.teacher.cognitoId, c.klass.id, query)).json<SessionReportsPage>();
    for (const limit of [1, 2, 3]) {
      const seen: string[] = [];
      let page = await pageOf(`?limit=${limit}`);
      for (;;) {
        expect(page.sessions.length).toBeLessThanOrEqual(limit);
        seen.push(...page.sessions.map((s) => s.id));
        if (page.nextBefore === null) break;
        expect(page.nextBefore).toBe(seen[seen.length - 1]);
        page = await pageOf(`?limit=${limit}&before=${page.nextBefore}`);
      }
      expect(seen, `limit ${limit}`).toEqual(newestFirst);
    }

    // A session started between two reads never shifts the next page.
    const firstPage = await pageOf('?limit=2');
    now = at(200);
    await endSession(db, { sessionId: lessons[4]!.id, at: at(115), reason: 'expired' });
    await lessonFrom(c.klass.id, 150);
    const next = await pageOf(`?limit=2&before=${firstPage.nextBefore}`);
    expect(next.sessions.map((s) => s.id)).toEqual(newestFirst.slice(2, 4));
  });

  it(`holds a page to ${SESSION_REPORTS_PAGE_LIMIT} sessions`, async () => {
    const c = await seedClassroom(db, 'page-size');
    const ids: string[] = [];
    for (let i = 0; i <= SESSION_REPORTS_PAGE_LIMIT; i += 1) {
      const session = await lessonFrom(c.klass.id, i * 30);
      await endSession(db, { sessionId: session.id, at: at(i * 30 + 25), reason: 'expired' });
      ids.unshift(session.id);
    }
    now = at(SESSION_REPORTS_PAGE_LIMIT * 30 + 60);

    const first = (await listAs(c.teacher.cognitoId, c.klass.id)).json<SessionReportsPage>();
    expect(first.sessions.map((s) => s.id)).toEqual(ids.slice(0, SESSION_REPORTS_PAGE_LIMIT));
    expect(first.nextBefore).toBe(ids[SESSION_REPORTS_PAGE_LIMIT - 1]);
    const rest = (
      await listAs(c.teacher.cognitoId, c.klass.id, `?before=${first.nextBefore}`)
    ).json<SessionReportsPage>();
    expect(rest).toMatchObject({ nextBefore: null });
    expect(rest.sessions.map((s) => s.id)).toEqual(ids.slice(SESSION_REPORTS_PAGE_LIMIT));
  });

  it('refuses a cursor the class doesn’t hold (400 unknown_cursor) and a malformed request (400 invalid_request)', async () => {
    const c = await seedClassroom(db, 'cursor');
    await lessonFrom(c.klass.id, 0);
    // The teacher's own other class's session, another teacher's, and none at all.
    const mine = await lessonFrom((await secondClass(c, 'cursor-second')).id, 0);
    const theirs = await lessonFrom((await seedClassroom(db, 'cursor-other')).klass.id, 0);
    for (const before of [mine.id, theirs.id, randomUUID()]) {
      const res = await listAs(c.teacher.cognitoId, c.klass.id, `?before=${before}`);
      expect(res.statusCode).toBe(400);
      expect(res.json<ApiErrorBody>().error).toMatchObject({
        code: 'bad_input',
        reason: 'unknown_cursor',
      });
    }

    const tooMany = `?limit=${SESSION_REPORTS_PAGE_LIMIT + 1}`;
    for (const query of ['?before=not-a-uuid', '?limit=0', tooMany, '?limit=2.5', '?limit=all']) {
      const res = await listAs(c.teacher.cognitoId, c.klass.id, query);
      expect(res.statusCode, query).toBe(400);
      expect(res.json<ApiErrorBody>().error, query).toMatchObject({
        code: 'bad_input',
        reason: 'invalid_request',
      });
    }
    const malformed = await listAs(c.teacher.cognitoId, 'not-a-uuid');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<ApiErrorBody>().error).toMatchObject({
      code: 'bad_input',
      reason: 'invalid_request',
    });
  });

  it('is the class’s own teacher’s: another teacher and any student 403, no sign-in 401, an unknown class 404', async () => {
    const c = await seedClassroom(db, 'list-authz');
    const other = await seedClassroom(db, 'list-authz-other');
    const session = await lessonFrom(c.klass.id, 0);
    await tapIn(db, move(session.id, c.student.id, at(1)));

    for (const caller of [other.teacher, c.student, other.student]) {
      // A cursor of the class's own changes nothing: who may read it comes first.
      for (const query of ['', `?before=${session.id}`]) {
        const res = await listAs(caller.cognitoId, c.klass.id, query);
        expect(res.statusCode).toBe(403);
        expect(res.json<ApiErrorBody>().error.code).toBe('forbidden');
        expect(res.body).not.toContain(session.id);
      }
    }
    const anonymous = await ctx.app.inject({
      method: 'GET',
      url: `/v1/classes/${c.klass.id}/reports/sessions`,
    });
    expect(anonymous.statusCode).toBe(401);
    const unknown = await listAs(c.teacher.cognitoId, randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().error).toMatchObject({
      code: 'not_found',
      reason: 'class_not_found',
    });
  });
});
