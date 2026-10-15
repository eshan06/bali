import {
  changeUnlockReason,
  checkIn,
  classes,
  type Database,
  deleteAccount,
  endEnrollment,
  endSession,
  enrollments,
  events,
  extendSession,
  markSilentParticipations,
  newUuidV7,
  openQuestion,
  protectionOff,
  protectionOn,
  refocus,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import { backdateLastSeen } from '@bali/db/testing';
import {
  ACTIVITY_LIMIT,
  type ActionOrder,
  type ActivityResponse,
  type ApiErrorBody,
  type SessionReportResponse,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { joinCodeFor, makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * PV3 — GET /v1/me/activity: a teacher's Recent activity, Home's. The three kinds the owner OK'd
 * (2026-10-12) from today's sessions of the teacher's own live classes, newest first, four at
 * most; its unlocks and protection offs those each session's report lists (R2), named as it
 * names them.
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** The server's clock, as the app reads it: each test sets it. */
let now: Date;

/** `hour:minute` on January `day`, 2026, in this process's zone: the server's (hosting decision 5). */
const on = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute);
/** `hour:minute` on the 5th, the school day the tests run on. */
const at = (hour: number, minute = 0) => on(5, hour, minute);

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  now = at(12);
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

/** Another student of the classroom's school, enrolled in `classId` now. */
async function classmate(c: Classroom, classId: string, tag: string) {
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `student-${tag}`, role: 'student', schoolId: c.school.id })
      .returning(),
  );
  const enrollment = one(
    await db.insert(enrollments).values({ classId, studentId: student.id }).returning(),
  );
  return { ...student, enrollmentId: enrollment.id };
}

/** The teacher's own second class. */
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

/** A 25-minute lesson of the class from `from`. */
async function lesson(classId: string, from: Date) {
  const endsAt = new Date(from.getTime() + 25 * 60_000);
  return (await startSession(db, { classId, startedAt: from, endsAt })).session;
}

/** The student's move in the session, made at `when` and heard then (A17). */
function move(sessionId: string, studentId: string, when: Date, order: ActionOrder | null = null) {
  return { sessionId, studentId, eventId: randomUUID(), deviceTime: when, order, now: when };
}

/** The session's `session_started`, which the engine mints. */
async function startOf(sessionId: string) {
  const started = and(eq(events.sessionId, sessionId), eq(events.type, 'session_started'));
  return one(await db.select({ eventId: events.eventId }).from(events).where(started)).eventId;
}

/** Every type of event the session holds: what a test really recorded. */
async function typesIn(sessionId: string) {
  const rows = await db
    .select({ type: events.type })
    .from(events)
    .where(eq(events.sessionId, sessionId));
  return rows.map((r) => r.type);
}

async function activityAs(cognitoId: string, query = '') {
  return authedInject(ctx.app, await ctx.tokenFor(cognitoId), {
    method: 'GET',
    url: `/v1/me/activity${query}`,
  });
}

async function activityOf(c: Classroom) {
  const res = await activityAs(c.teacher.cognitoId);
  expect(res.statusCode).toBe(200);
  return res.json<ActivityResponse>();
}

async function reportOf(c: Classroom, sessionId: string) {
  const res = await authedInject(ctx.app, await ctx.tokenFor(c.teacher.cognitoId), {
    method: 'GET',
    url: `/v1/classes/${c.klass.id}/reports/sessions/${sessionId}`,
  });
  return res.json<SessionReportResponse>();
}

type Listed = { eventId: string; student: unknown; occurredAt: string };
const listing = ({ eventId, student, occurredAt }: Listed) => ({ eventId, student, occurredAt });

/** A report's unlocks and protection offs, newest first: each one's id, student and time. */
const listedIn = (report: SessionReportResponse) =>
  [...report.unlocks, ...report.protectionOffs]
    .map(listing)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

/** Recent activity's moments but its starts, as `listedIn` gives a report's. */
const listedBy = (activity: ActivityResponse) =>
  activity.events.filter((e) => e.type !== 'session_started').map(listing);

describe('GET /v1/me/activity', () => {
  it('gives today’s unlocks, protection offs and starts across the teacher’s classes, newest first, four at most', async () => {
    const c = await seedClassroom(db, 'activity');
    const ana = c.student;
    const ben = await classmate(c, c.klass.id, 'activity-ben');
    const second = await secondClass(c, 'activity-second');
    const cy = await classmate(c, second.id, 'activity-cy');
    await renameStudent(db, { studentId: ana.id, displayName: 'Ana', eventId: randomUUID() });

    // 09:00–09:25: Ana unlocks for the bathroom at 09:05, then makes it the nurse; Ben's Screen
    // Time goes off at 09:10.
    const first = await lesson(c.klass.id, at(9));
    await tapIn(db, move(first.id, ana.id, at(9, 1)));
    await tapIn(db, move(first.id, ben.id, at(9, 2)));
    const anaUnlock = { ...move(first.id, ana.id, at(9, 5)), reason: 'bathroom' as const };
    await unlock(db, anaUnlock);
    const nurse = { unlockEventId: anaUnlock.eventId, studentId: ana.id, eventId: randomUUID() };
    await changeUnlockReason(db, { ...nurse, reason: 'nurse', now: at(9, 6) });
    const benOff = move(first.id, ben.id, at(9, 10));
    await protectionOff(db, benOff);
    await endSession(db, { sessionId: first.id, at: at(9, 25), reason: 'expired' });
    // The second class, 10:00–10:25: Cy unlocks at 10:03, with no reason.
    const later = await lesson(second.id, at(10));
    await tapIn(db, move(later.id, cy.id, at(10, 1)));
    const cyUnlock = move(later.id, cy.id, at(10, 3));
    await unlock(db, cyUnlock);
    now = at(10, 30);

    const own = { id: c.klass.id, name: c.klass.name };
    const other = { id: second.id, name: 'Second' };
    // 09:00's start is the fifth: not given.
    expect(await activityOf(c)).toEqual({
      events: [
        {
          eventId: cyUnlock.eventId,
          type: 'unlock',
          occurredAt: at(10, 3).toISOString(),
          class: other,
          student: { id: cy.id, displayName: null },
          reason: null,
        },
        {
          eventId: await startOf(later.id),
          type: 'session_started',
          occurredAt: at(10).toISOString(),
          class: other,
          student: null,
          reason: null,
        },
        {
          eventId: benOff.eventId,
          type: 'protection_off',
          occurredAt: at(9, 10).toISOString(),
          class: own,
          student: { id: ben.id, displayName: null },
          reason: null,
        },
        {
          eventId: anaUnlock.eventId,
          type: 'unlock',
          occurredAt: at(9, 5).toISOString(),
          class: own,
          student: { id: ana.id, displayName: 'Ana' },
          reason: 'nurse',
        },
      ],
    });
  });

  it('gives nothing but those three: no tap-in, return, silence, Screen Time back on, removal, extension, question or end', async () => {
    const c = await seedClassroom(db, 'kinds');
    const ana = c.student;
    const ben = await classmate(c, c.klass.id, 'kinds-ben');
    const cy = await classmate(c, c.klass.id, 'kinds-cy');
    const session = await lesson(c.klass.id, at(9));
    // Ana: in, an unlock and back, then Screen Time off and on again.
    await tapIn(db, move(session.id, ana.id, at(9, 1)));
    const anaUnlock = move(session.id, ana.id, at(9, 3));
    await unlock(db, anaUnlock);
    await refocus(db, move(session.id, ana.id, at(9, 4)));
    const anaOff = move(session.id, ana.id, at(9, 5));
    await protectionOff(db, anaOff);
    await protectionOn(db, move(session.id, ana.id, at(9, 6)));
    // Ben: in, then silent, then back.
    await tapIn(db, move(session.id, ben.id, at(9, 2)));
    await backdateLastSeen(db, { sessionId: session.id, studentId: ben.id }, at(9, 2));
    expect(await markSilentParticipations(db, at(9, 7))).toBe(1);
    await checkIn(db, { sessionId: session.id, studentId: ben.id, now: at(9, 8) });
    // Cy: in, then removed; time added, a question asked, and the lesson ended early.
    await tapIn(db, move(session.id, cy.id, at(9, 2)));
    const removal = { enrollmentId: cy.enrollmentId, at: at(9, 9) };
    await endEnrollment(db, { ...removal, reason: 'removed_from_class' });
    const added = { sessionId: session.id, durationMinutes: 5, eventId: randomUUID() };
    await extendSession(db, { ...added, at: at(9, 10) });
    const question = { prompt: 'Which?', options: ['a', 'b'], eventId: newUuidV7() };
    const asked = { ...question, sessionId: session.id, teacherId: c.teacher.id };
    await openQuestion(db, { ...asked, now: at(9, 11) });
    await endSession(db, { sessionId: session.id, at: at(9, 20), reason: 'ended' });
    now = at(9, 30);

    // All of those were recorded in the session.
    expect(await typesIn(session.id)).toEqual(
      expect.arrayContaining([
        'tap_in',
        'refocus',
        'protection_on',
        'went_silent',
        'came_back',
        'enrollment_removed',
        'session_extended',
        'question_opened',
        'question_closed',
        'session_ended',
      ]),
    );
    const { events: shown } = await activityOf(c);
    expect(shown.map((e) => [e.type, e.eventId])).toEqual([
      ['protection_off', anaOff.eventId],
      ['unlock', anaUnlock.eventId],
      ['session_started', await startOf(session.id)],
    ]);
  });

  it('is the caller’s own live classes only: never another teacher’s, nor a class removed since', async () => {
    const c = await seedClassroom(db, 'own');
    const other = await seedClassroom(db, 'own-other');
    const archived = await secondClass(c, 'own-archived');
    const mine = await lesson(c.klass.id, at(9));
    const theirs = await lesson(other.klass.id, at(9));
    await tapIn(db, move(theirs.id, other.student.id, at(9, 1)));
    const theirUnlock = move(theirs.id, other.student.id, at(9, 2));
    await unlock(db, theirUnlock);
    // The teacher's other class ran today, then was removed (as a school's disposal removes one).
    const gone = await lesson(archived.id, at(10));
    await endSession(db, { sessionId: gone.id, at: at(10, 25), reason: 'expired' });
    await db
      .update(classes)
      .set({ removedAt: at(10, 30) })
      .where(eq(classes.id, archived.id));
    now = at(11);

    const res = await activityAs(c.teacher.cognitoId);
    expect(res.json<ActivityResponse>().events.map((e) => e.eventId)).toEqual([
      await startOf(mine.id),
    ]);
    for (const id of [other.student.id, other.klass.id, theirs.id, archived.id]) {
      expect(res.body).not.toContain(id);
    }
    // The other teacher is given theirs, never the caller's.
    const theirsRes = await activityAs(other.teacher.cognitoId);
    expect(theirsRes.json<ActivityResponse>().events.map((e) => e.eventId)).toEqual([
      theirUnlock.eventId,
      await startOf(theirs.id),
    ]);
    expect(theirsRes.body).not.toContain(c.klass.id);
  });

  it('is today’s sessions by the server’s clock: never yesterday’s, and none the next day', async () => {
    const c = await seedClassroom(db, 'today');
    // Yesterday 23:30–23:55, an unlock in it; today from 00:05.
    const yesterday = await lesson(c.klass.id, on(4, 23, 30));
    await tapIn(db, move(yesterday.id, c.student.id, on(4, 23, 31)));
    await unlock(db, move(yesterday.id, c.student.id, on(4, 23, 40)));
    await endSession(db, { sessionId: yesterday.id, at: on(4, 23, 55), reason: 'expired' });
    const today = await lesson(c.klass.id, on(5, 0, 5));
    await endSession(db, { sessionId: today.id, at: on(5, 0, 30), reason: 'expired' });

    now = on(5, 9);
    expect((await activityOf(c)).events.map((e) => e.eventId)).toEqual([await startOf(today.id)]);
    now = on(6, 8);
    expect(await activityOf(c)).toEqual({ events: [] });
  });

  it('orders newest first, the later record first at one instant, and gives four whatever it is asked', async () => {
    const c = await seedClassroom(db, 'order');
    const ana = c.student;
    const ben = await classmate(c, c.klass.id, 'order-ben');
    const cy = await classmate(c, c.klass.id, 'order-cy');
    const dee = await classmate(c, c.klass.id, 'order-dee');
    const session = await lesson(c.klass.id, at(9));
    // Ana's phone clock is behind: her unlock is held to 09:00, the start's own instant.
    await tapIn(db, move(session.id, ana.id, at(9)));
    const early = move(session.id, ana.id, at(8, 55));
    await unlock(db, early);
    // Ben's Screen Time off at 09:10; Cy's unlock at 09:20 lands before Dee's at 09:15.
    await tapIn(db, move(session.id, ben.id, at(9, 1)));
    await tapIn(db, move(session.id, cy.id, at(9, 2)));
    await tapIn(db, move(session.id, dee.id, at(9, 3)));
    const benOff = move(session.id, ben.id, at(9, 10));
    await protectionOff(db, benOff);
    const cyUnlock = move(session.id, cy.id, at(9, 20));
    await unlock(db, cyUnlock);
    const deeUnlock = move(session.id, dee.id, at(9, 15));
    await unlock(db, deeUnlock);
    now = at(9, 30);

    // The start, at Ana's instant but recorded before her unlock, is the fifth. It takes no
    // query: one asking for more, or for a page, changes nothing.
    for (const query of ['', '?limit=50', `?before=${randomUUID()}`, '?limit=x']) {
      const res = await activityAs(c.teacher.cognitoId, query);
      expect(res.statusCode, query).toBe(200);
      const { events: shown } = res.json<ActivityResponse>();
      expect(shown, query).toHaveLength(ACTIVITY_LIMIT);
      expect(shown.map((e) => e.eventId)).toEqual([
        cyUnlock.eventId,
        deeUnlock.eventId,
        benOff.eventId,
        early.eventId,
      ]);
      expect(shown[3]!.occurredAt).toBe(at(9).toISOString());
    }
  });

  it('lists what the session’s report lists: a late unlock, one while protection was off, never one kept with no class', async () => {
    const c = await seedClassroom(db, 'late');
    const stranger = await seedClassroom(db, 'late-stranger');
    const ana = c.student;
    const ben = await classmate(c, c.klass.id, 'late-ben');
    const session = await lesson(c.klass.id, at(9));
    // Ana's unlock (#2) stuck on her phone while her re-tap (#3) went ahead: late.
    const install = randomUUID();
    await tapIn(db, move(session.id, ana.id, at(9, 1), { install, seq: 1 }));
    const stuck = move(session.id, ana.id, at(9, 3), { install, seq: 2 });
    await tapIn(db, move(session.id, ana.id, at(9, 4), { install, seq: 3 }));
    expect((await unlock(db, stuck)).recordedAs).toBe('superseded');
    // Ben's Screen Time off, then an unlock recorded while it was.
    await tapIn(db, move(session.id, ben.id, at(9, 2)));
    await protectionOff(db, move(session.id, ben.id, at(9, 5)));
    expect((await unlock(db, move(session.id, ben.id, at(9, 6)))).recordedAs).toBe(
      'protection_off',
    );
    // A student of another class naming this session: kept with no class, in neither.
    const orphan = move(session.id, stranger.student.id, at(9, 7));
    expect((await unlock(db, orphan)).recordedAs).toBe('not_enrolled');
    now = at(9, 10);

    const report = await reportOf(c, session.id);
    expect(report.unlocks.map((u) => u.recordedAs)).toEqual(['superseded', 'protection_off']);
    const activity = await activityOf(c);
    expect(listedBy(activity)).toEqual(listedIn(report));
    expect(activity.events).toHaveLength(4);
    expect(JSON.stringify(activity)).not.toContain(orphan.eventId);
  });

  it('lists what the report lists after the bell too: records that reached Bali after it, and an unlock with nothing live', async () => {
    const c = await seedClassroom(db, 'after');
    const ana = c.student;
    const ben = await classmate(c, c.klass.id, 'after-ben');
    const session = await lesson(c.klass.id, at(9));
    await tapIn(db, move(session.id, ana.id, at(9, 1)));
    // Ben, in the class but never tapped in, unlocks.
    await unlock(db, move(session.id, ben.id, at(9, 5)));
    await endSession(db, { sessionId: session.id, at: at(9, 25), reason: 'expired' });
    // Ana's unlock and Screen Time off, made in class, reach Bali after the bell.
    expect((await unlock(db, move(session.id, ana.id, at(9, 20)))).recordedAs).toBe(
      'after_session_end',
    );
    const off = await protectionOff(db, move(session.id, ana.id, at(9, 21)));
    expect(off.recordedAs).toBe('after_session_end');
    now = at(9, 40);

    const report = await reportOf(c, session.id);
    expect(report.unlocks.map((u) => u.recordedAs)).toEqual([
      'no_live_participation',
      'after_session_end',
    ]);
    expect(report.protectionOffs.map((p) => p.recordedAs)).toEqual(['after_session_end']);
    expect(listedBy(await activityOf(c))).toEqual(listedIn(report));
  });

  it('names each student as the report does: their name now, none for a deleted account, and one removed since', async () => {
    const c = await seedClassroom(db, 'names');
    const ana = c.student;
    const ben = await classmate(c, c.klass.id, 'names-ben');
    const cy = await classmate(c, c.klass.id, 'names-cy');
    for (const [student, displayName] of [
      [ana, 'Ana'],
      [ben, 'Ben'],
      [cy, 'Cy'],
    ] as const) {
      await renameStudent(db, { studentId: student.id, displayName, eventId: randomUUID() });
    }
    const session = await lesson(c.klass.id, at(9));
    for (const [student, minute] of [
      [ana, 5],
      [ben, 6],
      [cy, 7],
    ] as const) {
      await tapIn(db, move(session.id, student.id, at(9, 1)));
      await unlock(db, move(session.id, student.id, at(9, minute)));
    }
    await endSession(db, { sessionId: session.id, at: at(9, 25), reason: 'expired' });
    // Since: Ana renamed, Ben's account deleted (de-identified), Cy removed from the class.
    await renameStudent(db, { studentId: ana.id, displayName: 'Ana B.', eventId: randomUUID() });
    await deleteAccount(db, { userId: ben.id, eventId: randomUUID(), at: at(9, 30) });
    await endEnrollment(db, {
      enrollmentId: cy.enrollmentId,
      reason: 'removed_from_class',
      at: at(9, 31),
    });
    now = at(9, 40);

    const activity = await activityOf(c);
    expect(activity.events.map((e) => e.student)).toEqual([
      { id: cy.id, displayName: 'Cy' },
      { id: ben.id, displayName: null },
      { id: ana.id, displayName: 'Ana B.' },
      null,
    ]);
    expect(listedBy(activity)).toEqual(listedIn(await reportOf(c, session.id)));
  });

  it('is a teacher’s: a student is refused, and a sign-in with no account here, which it never makes (403)', async () => {
    const c = await seedClassroom(db, 'authz');
    await lesson(c.klass.id, at(9));
    for (const sub of [c.student.cognitoId, 'nobody-here']) {
      const res = await activityAs(sub);
      expect(res.statusCode).toBe(403);
      expect(res.json<ApiErrorBody>().error.code).toBe('forbidden');
    }
    expect(await db.select().from(users).where(eq(users.cognitoId, 'nobody-here'))).toEqual([]);
  });

  it('requires a sign-in (401)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/activity' });
    expect(res.statusCode).toBe(401);
  });
});
