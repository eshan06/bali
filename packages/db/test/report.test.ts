import { sessionReport, type ActionOrder, type ReportEvent } from '@bali/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import {
  armedTaps,
  classes,
  enrollments,
  events,
  schools,
  sessions,
  users,
} from '../src/schema.js';
import { backdateLastSeen, makeTestDb } from '../src/testing.js';
import {
  armTap,
  changeUnlockReason,
  checkIn,
  endEnrollment,
  endSession,
  markSilentParticipations,
  protectionOff,
  protectionOn,
  refocus,
  startSession,
  tapIn,
  unlock,
  unlockUnderTap,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * R1 against what the engine really stores: each counting rule of PLAN.md's
 * reports row, driven through the transition engine, and the events it wrote
 * fed to `sessionReport`. The function's own tests (packages/shared) pin the
 * same rules on events built by hand.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 9, 0) + minute * 60_000);
/** The server's clock as each report is read: long after every lesson here. */
const LATER = at(600);

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** A class, its teacher, and one student enrolled in it. */
async function seedClass(tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `School ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({ teacherId: teacher.id, schoolId: school.id, name: tag, joinCode: `R1-${tag}` })
      .returning(),
  );
  const student = await enrol(klass, `${tag}-1`);
  return { teacher, klass, student };
}

/** Another student, enrolled in the class. */
async function enrol(klass: { id: string; schoolId: string }, name: string) {
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `student-${name}`, role: 'student', schoolId: klass.schoolId })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  return student;
}

/** A 25-minute lesson for the class, from 09:00 unless said. */
async function lesson(klass: { id: string }, from = at(0)) {
  const endsAt = new Date(from.getTime() + 25 * 60_000);
  return (await startSession(db, { classId: klass.id, startedAt: from, endsAt })).session;
}

/** The student's move in the session, made at `minute` and heard then (A17). */
function move(
  session: { id: string },
  student: { id: string },
  minute: number,
  order: ActionOrder | null = null,
) {
  return {
    sessionId: session.id,
    studentId: student.id,
    eventId: newUuidV7(),
    deviceTime: at(minute),
    order,
    now: at(minute),
  };
}

/** A phone's outbox counter (A12): its install, and each record's place in it. */
function phone() {
  const install = newUuidV7();
  return (seq: number): ActionOrder => ({ install, seq });
}

/** The report of a session: its row and every event the engine stored in it, and `kept`. */
async function reportOf(sessionId: string, kept: ReportEvent[] = []) {
  const session = one(await db.select().from(sessions).where(eq(sessions.id, sessionId)));
  const stored = await db.select().from(events).where(eq(events.sessionId, sessionId));
  return sessionReport(session, [...stored, ...kept], LATER);
}

const typesIn = async (sessionId: string) =>
  (await db.select().from(events).where(eq(events.sessionId, sessionId))).map((e) => e.type);

/** The student's unlocks the engine kept with no session: in no class. */
const keptUnlocksOf = (studentId: string) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.userId, studentId), isNull(events.sessionId), eq(events.type, 'unlock')));

describe('sessionReport over what the engine stores', () => {
  it('counts each joined student’s focus to the bell, and averages it over who joined', async () => {
    const { klass, student: ana } = await seedClass('base');
    const ben = await enrol(klass, 'base-2');
    const session = await lesson(klass);
    await tapIn(db, move(session, ana, 1));
    // Ben never tapped in; his unlock is on record all the same.
    const benUnlock = { ...move(session, ben, 5), reason: 'bathroom' as const };
    await unlock(db, benUnlock);
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    expect(await reportOf(session.id)).toEqual({
      joined: [ana.id],
      focusMinutes: 24,
      averageFocusMinutes: 24,
      silentMinutes: 0,
      unlocks: [
        {
          eventId: benUnlock.eventId,
          studentId: ben.id,
          occurredAt: at(5),
          reason: 'bathroom',
          recordedAs: 'no_live_participation',
        },
      ],
      protectionOffs: [],
    });
  });

  it('never counts past ended_at: an unlock and a protection off after an early end add nothing', async () => {
    const { klass, student } = await seedClass('after-end');
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1));
    await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });
    // Both reach the server after the end, their claims clamped past it.
    const lateUnlock = move(session, student, 20);
    expect((await unlock(db, lateUnlock)).recordedAs).toBe('after_session_end');
    expect((await protectionOff(db, move(session, student, 22))).recordedAs).toBe(
      'after_session_end',
    );

    const report = await reportOf(session.id);
    expect(report.focusMinutes).toBe(9);
    expect(report.unlocks).toMatchObject([
      { eventId: lateUnlock.eventId, occurredAt: at(20), recordedAs: 'after_session_end' },
    ]);
    expect(report.protectionOffs).toMatchObject([
      { occurredAt: at(22), recordedAs: 'after_session_end' },
    ]);
  });

  it('never counts past the bell: a session the sweep has not ended counts to its bell', async () => {
    const { klass, student } = await seedClass('past-bell');
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1));
    expect(session.endedAt).toBeNull();
    expect((await reportOf(session.id)).focusMinutes).toBe(24);
  });

  it('an unlock noted superseded never ends focus, after the end included', async () => {
    // Unlocked (#2) and stuck there while a re-tap (#3) went ahead; it lands
    // after the teacher ended the class early.
    const { klass, student } = await seedClass('late-unlock');
    const n = phone();
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1, n(1)));
    const stuck = move(session, student, 5, n(2));
    await tapIn(db, move(session, student, 8, n(3)));
    await endSession(db, { sessionId: session.id, at: at(20), reason: 'ended' });
    expect((await unlock(db, stuck)).recordedAs).toBe('superseded');

    const report = await reportOf(session.id);
    expect(report.focusMinutes).toBe(19);
    expect(report.unlocks).toMatchObject([{ eventId: stuck.eventId, recordedAs: 'superseded' }]);
  });

  it('a return noted superseded never starts focus (A13)', async () => {
    const { klass, student: ana } = await seedClass('late-return');
    const ben = await enrol(klass, 'late-return-2');
    const session = await lesson(klass);
    // Ana's re-tap (#2) was stuck while her unlock (#3) went ahead.
    const a = phone();
    await tapIn(db, move(session, ana, 1, a(1)));
    const stuckTap = move(session, ana, 4, a(2));
    await unlock(db, move(session, ana, 6, a(3)));
    await tapIn(db, stuckTap);
    // Ben's refocus (#3) outlived its request while his next unlock (#4) went ahead.
    const b = phone();
    await tapIn(db, move(session, ben, 1, b(1)));
    await unlock(db, move(session, ben, 4, b(2)));
    const slow = move(session, ben, 6, b(3));
    await unlock(db, move(session, ben, 8, b(4)));
    await refocus(db, slow);
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    const notes = (await db.select().from(events).where(eq(events.sessionId, session.id)))
      .filter((e) => e.eventId === stuckTap.eventId || e.eventId === slow.eventId)
      .map((e) => e.payload);
    expect(notes).toEqual([{ recorded_as: 'superseded' }, { recorded_as: 'superseded' }]);
    // Ana 09:01–09:06, Ben 09:01–09:04: neither late return starts focus again.
    expect(await reportOf(session.id)).toMatchObject({ joined: [ana.id, ben.id], focusMinutes: 8 });
  });

  it('orders a student’s own unlock and return as the engine did, never by the times alone (A12)', async () => {
    // Back at 09:08 (#3); then the clock went back five minutes, and the real
    // unlock (#4) claims 09:03. The engine applied it, by the phone's order:
    // she stays unlocked. By the times, she was focused from 09:08 to the bell.
    const { klass, student } = await seedClass('order');
    const n = phone();
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1, n(1)));
    await unlock(db, move(session, student, 5, n(2)));
    await refocus(db, move(session, student, 8, n(3)));
    const real = move(session, student, 3, n(4));
    expect((await unlock(db, real)).outcome).toBe('applied');
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    const report = await reportOf(session.id);
    expect(report.unlocks.map((u) => u.occurredAt)).toEqual([at(3), at(5)]);
    expect(report.focusMinutes).toBe(4);
  });

  it('left_for_other_session ends focus and is never an unlock (decision 4)', async () => {
    const { klass: first, student } = await seedClass('switch-a');
    const { klass: second } = await seedClass('switch-b');
    await db.insert(enrollments).values({ classId: second.id, studentId: student.id });
    const a = await lesson(first);
    const b = await lesson(second);
    await tapIn(db, move(a, student, 1));
    expect((await tapIn(db, move(b, student, 10))).outcome).toBe('switched');

    expect(await typesIn(a.id)).toContain('left_for_other_session');
    expect(await reportOf(a.id)).toMatchObject({
      joined: [student.id],
      focusMinutes: 9,
      unlocks: [],
    });
    expect(await reportOf(b.id)).toMatchObject({ joined: [student.id], focusMinutes: 15 });
  });

  it('an unlock kept with no class is in none, and the one its tap files counts once (decision 11)', async () => {
    const { klass, student } = await seedClass('kept');
    const session = await lesson(klass);
    // Sent to a session the server does not know.
    await unlock(db, { ...move({ id: newUuidV7() }, student, 2) });
    // Sent under a tap the server has not heard yet, which then lands and files it.
    const tap = move(session, student, 2);
    const under = {
      tapEventId: tap.eventId,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: at(3),
      reason: 'nurse' as const,
    };
    expect((await unlockUnderTap(db, under)).recordedAs).toBe('unknown_tap');
    await tapIn(db, tap);
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    const kept = await keptUnlocksOf(student.id);
    expect(kept.map((e) => (e.payload as { recorded_as: string }).recorded_as).sort()).toEqual([
      'unknown_session',
      'unknown_tap',
    ]);
    const report = await reportOf(session.id, kept);
    expect(report.unlocks).toHaveLength(1);
    const filed = one(report.unlocks);
    expect(filed).toMatchObject({ occurredAt: at(3), reason: 'nurse', recordedAs: null });
    expect(filed.eventId).not.toBe(under.eventId);
    expect(report.focusMinutes).toBe(1);
  });

  it('one kept under a tap that only armed stays in no class: the Start joins without it', async () => {
    const { teacher, klass, student } = await seedClass('kept-armed');
    const tapId = newUuidV7();
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: tapId,
      deviceTime: at(-5),
      expiresAt: LATER,
      now: at(-5),
    });
    const under = { tapEventId: tapId, studentId: student.id, eventId: newUuidV7() };
    expect((await unlockUnderTap(db, { ...under, deviceTime: at(-4) })).recordedAs).toBe(
      'tap_armed',
    );
    const session = await lesson(klass);

    expect(await reportOf(session.id, await keptUnlocksOf(student.id))).toMatchObject({
      joined: [student.id],
      focusMinutes: 25,
      unlocks: [],
    });
  });

  it('a tap a Start declined is never a join: armed_tap_skipped, or one a later tap went ahead of (A14)', async () => {
    // Declined because it already landed: its waiting row is one an older
    // deploy armed — the engine refuses to arm a landed tap now — so it is
    // staged directly (armed_taps is not the engine's history).
    const { teacher, klass, student } = await seedClass('skipped');
    const first = await lesson(klass);
    const landed = move(first, student, 1);
    await tapIn(db, landed);
    await endSession(db, { sessionId: first.id, at: at(10), reason: 'ended' });
    await db.insert(armedTaps).values({
      studentId: student.id,
      teacherId: teacher.id,
      eventId: landed.eventId,
      deviceTime: at(1),
      expiresAt: LATER,
    });
    const second = await lesson(klass, at(60));
    expect(await typesIn(second.id)).toContain('armed_tap_skipped');
    expect(await reportOf(second.id)).toMatchObject({
      joined: [],
      focusMinutes: 0,
      averageFocusMinutes: null,
    });

    // Late: tapped at Y's block (#1) while nothing ran there, then into B (#2).
    const { klass: b, student: cy } = await seedClass('late-tap-b');
    const { teacher: yTeacher, klass: y } = await seedClass('late-tap-y');
    await db.insert(enrollments).values({ classId: y.id, studentId: cy.id });
    const n = phone();
    const inB = await lesson(b);
    const waiting = {
      studentId: cy.id,
      teacherId: yTeacher.id,
      eventId: newUuidV7(),
      deviceTime: at(1),
      order: n(1),
      expiresAt: LATER,
      now: at(1),
    };
    expect((await armTap(db, waiting)).outcome).toBe('armed');
    await tapIn(db, move(inB, cy, 4, n(2)));
    const inY = await lesson(y, at(10));

    const declined = one(await db.select().from(events).where(eq(events.eventId, waiting.eventId)));
    expect(declined).toMatchObject({ type: 'tap_in', sessionId: inY.id });
    expect(declined.payload).toEqual({ recorded_as: 'superseded' });
    expect(await reportOf(inY.id)).toMatchObject({ joined: [], averageFocusMinutes: null });
  });

  it('protection off ends focus as an unlock does; Screen Time back on returns to the state before it', async () => {
    const { klass, student: ana } = await seedClass('protection');
    const ben = await enrol(klass, 'protection-2');
    const session = await lesson(klass);
    await tapIn(db, move(session, ana, 1));
    await protectionOff(db, move(session, ana, 5));
    expect((await protectionOn(db, move(session, ana, 9))).state).toBe('focused');
    await tapIn(db, move(session, ben, 1));
    await unlock(db, move(session, ben, 3));
    await protectionOff(db, move(session, ben, 5));
    expect((await protectionOn(db, move(session, ben, 9))).state).toBe('unlocked');
    // Cy's late unlock (#2), stuck while her re-tap (#3) went ahead, is no
    // turn: back on returns her to that re-tap, focused.
    const cy = await enrol(klass, 'protection-3');
    const n = phone();
    await tapIn(db, move(session, cy, 1, n(1)));
    const stuck = move(session, cy, 2, n(2));
    await tapIn(db, move(session, cy, 4, n(3)));
    expect((await unlock(db, stuck)).recordedAs).toBe('superseded');
    await protectionOff(db, move(session, cy, 5));
    expect((await protectionOn(db, move(session, cy, 9))).state).toBe('focused');
    // Di's unlock while it was off changed nothing then, and stands once it is back on.
    const di = await enrol(klass, 'protection-4');
    await tapIn(db, move(session, di, 1));
    await protectionOff(db, move(session, di, 5));
    expect((await unlock(db, move(session, di, 7))).recordedAs).toBe('protection_off');
    expect((await protectionOn(db, move(session, di, 9))).state).toBe('unlocked');
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    const report = await reportOf(session.id);
    // Ana 4 + 16, Ben 2, Cy 4 + 16, Di 4.
    expect(report.focusMinutes).toBe(46);
    expect(report.protectionOffs.map((off) => [off.studentId, off.occurredAt])).toEqual([
      [ana.id, at(5)],
      [ben.id, at(5)],
      [cy.id, at(5)],
      [di.id, at(5)],
    ]);
  });

  it('silence is never focus: counted apart, from went_silent to came_back', async () => {
    const { klass, student } = await seedClass('silence');
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1));
    await backdateLastSeen(db, { sessionId: session.id, studentId: student.id }, at(1));
    expect(await markSilentParticipations(db, at(5))).toBe(1);
    await checkIn(db, { sessionId: session.id, studentId: student.id, deviceTime: at(8) });
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });

    expect(await typesIn(session.id)).toEqual(expect.arrayContaining(['went_silent', 'came_back']));
    expect(await reportOf(session.id)).toMatchObject({ focusMinutes: 21, silentMinutes: 3 });
  });

  it('an unlock shows its reason now: its latest change’s (A20)', async () => {
    const { klass, student } = await seedClass('reason');
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1));
    const sent = { ...move(session, student, 3), reason: 'bathroom' as const };
    await unlock(db, sent);
    await changeUnlockReason(db, {
      unlockEventId: sent.eventId,
      studentId: student.id,
      eventId: newUuidV7(),
      reason: 'nurse',
      now: at(4),
    });

    expect((await reportOf(session.id)).unlocks).toMatchObject([
      { eventId: sent.eventId, reason: 'nurse' },
    ]);
  });

  it('a removal mid-session ends focus, and an unlock after it is listed with its note', async () => {
    const { klass, student } = await seedClass('removed');
    const session = await lesson(klass);
    await tapIn(db, move(session, student, 1));
    const enrollment = one(
      await db.select().from(enrollments).where(eq(enrollments.studentId, student.id)),
    );
    await endEnrollment(db, {
      enrollmentId: enrollment.id,
      reason: 'removed_from_class',
      at: at(10),
    });
    await unlock(db, move(session, student, 12));

    expect(await reportOf(session.id)).toMatchObject({
      joined: [student.id],
      focusMinutes: 9,
      unlocks: [{ occurredAt: at(12), recordedAs: 'no_live_participation' }],
    });
  });
});
