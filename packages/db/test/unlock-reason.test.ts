import type { UnlockReason } from '@bali/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { getHistoryPage, getSessionRoster } from '../src/queries.js';
import { classes, enrollments, events, schools, users } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  changeUnlockReason,
  endSession,
  protectionOff,
  refocus,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * A20 (the owner's ruling, 2026-09-30): the student changes the reason of
 * their own unlock while it stands, and the teacher sees the latest. Recorded
 * as an event of its own — the unlock's is never rewritten — and refused for
 * an unlock a later return, tap or unlock has ended, or once the class is over.
 * The race against a return to focus is in races.test.ts.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** 09:mm on the lesson's day: its window is 09:00–09:25, so 09:10 is mid-lesson. */
const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);

/** A student in a 09:00–09:25 lesson, tapped in at 09:01 and unlocked at 09:05. */
async function unlocked(tag: string, reason: UnlockReason | null = null) {
  const [school] = await db
    .insert(schools)
    .values({ name: `School ${tag}` })
    .returning();
  const [teacher, student] = await db
    .insert(users)
    .values([
      { cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school!.id },
      { cognitoId: `student-${tag}`, role: 'student', schoolId: school!.id },
    ])
    .returning();
  const [klass] = await db
    .insert(classes)
    .values({ teacherId: teacher!.id, schoolId: school!.id, name: tag, joinCode: tag })
    .returning();
  await db.insert(enrollments).values({ classId: klass!.id, studentId: student!.id });
  const { session } = await startSession(db, {
    classId: klass!.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  const act = (minute: number) => ({
    sessionId: session.id,
    studentId: student!.id,
    eventId: newUuidV7(),
    deviceTime: at(minute),
    now: at(minute),
  });
  await tapIn(db, act(1));
  const unlockId = newUuidV7();
  await unlock(db, { ...act(5), eventId: unlockId, reason });
  return { session, klass: klass!, student: student!, unlockId, act };
}

/** A change of `unlockEventId`'s reason, heard at 09:10 unless said. */
const change = (
  unlockEventId: string,
  studentId: string,
  reason: UnlockReason,
  eventId = newUuidV7(),
  now = at(10),
) => changeUnlockReason(db, { unlockEventId, studentId, eventId, reason, now });

const changesOf = (sessionId: string) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, 'unlock_reason_changed')))
    .orderBy(asc(events.seq));

/** The reason the teacher's grid shows for the student, from its snapshot read. */
async function gridReason(sessionId: string, classId: string, studentId: string) {
  const rows = await getSessionRoster(db, sessionId, classId);
  return rows.find((r) => r.studentId === studentId)?.unlock?.reason;
}

describe('changing an unlock’s reason (A20)', () => {
  it('is recorded as its own event, the unlock left as it was, and the teacher sees the latest', async () => {
    const { session, klass, student, unlockId } = await unlocked('reason-change', 'bathroom');
    const eventId = newUuidV7();

    expect(await change(unlockId, student.id, 'nurse', eventId)).toEqual({
      outcome: 'applied',
      reason: 'nurse',
    });

    expect(one(await changesOf(session.id))).toMatchObject({
      eventId,
      sessionId: session.id,
      classId: klass.id,
      userId: student.id,
      occurredAt: at(10),
      payload: { unlock_event_id: unlockId, reason: 'nurse' },
    });
    const original = one(await db.select().from(events).where(eq(events.eventId, unlockId)));
    expect(original.payload).toEqual({ reason: 'bathroom' });
    expect(await gridReason(session.id, klass.id, student.id)).toBe('nurse');

    // Changed again: the latest, wherever it is read.
    await change(unlockId, student.id, 'other');
    expect(await gridReason(session.id, klass.id, student.id)).toBe('other');
    const page = await getHistoryPage(db, student.id, { limit: 10 });
    expect(page?.events.find((e) => e.eventId === unlockId)?.reason).toBe('other');
  });

  it('names the unlock as stored, whatever the case of the id sent (santa’s round 1)', async () => {
    const { session, klass, student, unlockId } = await unlocked('reason-case', 'bathroom');
    const loud = unlockId.toUpperCase();
    const first = newUuidV7();

    expect((await change(loud, student.id, 'nurse', first)).outcome).toBe('applied');
    expect(one(await changesOf(session.id)).payload).toEqual({
      unlock_event_id: unlockId,
      reason: 'nurse',
    });
    expect(await gridReason(session.id, klass.id, student.id)).toBe('nurse');
    expect(await change(loud, student.id, 'other', first)).toEqual({
      outcome: 'replay',
      reason: 'nurse',
    });
  });

  it('gives a reason to an unlock that went without one', async () => {
    const { session, klass, student, unlockId } = await unlocked('reason-first', null);
    expect(await gridReason(session.id, klass.id, student.id)).toBeNull();

    expect((await change(unlockId, student.id, 'bathroom')).outcome).toBe('applied');
    expect(await gridReason(session.id, klass.id, student.id)).toBe('bathroom');
  });

  it('answers a retry as its replay with the reason now — past the bell too — recording nothing', async () => {
    const { session, student, unlockId, act } = await unlocked('reason-replay', 'bathroom');
    const first = newUuidV7();
    await change(unlockId, student.id, 'nurse', first);
    await change(unlockId, student.id, 'other');

    expect(await change(unlockId, student.id, 'nurse', first)).toEqual({
      outcome: 'replay',
      reason: 'other',
    });
    await endSession(db, { sessionId: session.id, at: at(20), reason: 'ended' });
    expect(await change(unlockId, student.id, 'nurse', first, at(30))).toEqual({
      outcome: 'replay',
      reason: 'other',
    });
    expect(await changesOf(session.id)).toHaveLength(2);
    // The unlock's own retry answers the reason now, not the one it carried (rule 4).
    const retried = await unlock(db, { ...act(5), eventId: unlockId, reason: 'bathroom' });
    expect(retried).toMatchObject({ outcome: 'replay', reason: 'other' });
  });

  it('is refused once a return to focus, a re-tap or another unlock came since', async () => {
    for (const since of ['refocus', 'tap', 'unlock'] as const) {
      const { session, klass, student, unlockId, act } = await unlocked(
        `reason-over-${since}`,
        'bathroom',
      );
      if (since === 'refocus') await refocus(db, act(7));
      else if (since === 'tap') await tapIn(db, act(7));
      else await unlock(db, { ...act(7), reason: 'other' });

      await expect(change(unlockId, student.id, 'nurse')).rejects.toMatchObject({
        code: 'UNLOCK_SUPERSEDED',
      });
      expect(await changesOf(session.id)).toHaveLength(0);
      if (since === 'unlock') {
        expect(await gridReason(session.id, klass.id, student.id)).toBe('other');
      }
    }
  });

  it('is refused for a late unlock, which no chip shows (A10)', async () => {
    const { session, student, act } = await unlocked('reason-late', 'bathroom');
    await refocus(db, act(8));
    const lateId = newUuidV7();
    const late = await unlock(db, { ...act(6), eventId: lateId, reason: 'nurse' });
    expect(late.recordedAs).toBe('superseded');

    await expect(change(lateId, student.id, 'other')).rejects.toMatchObject({
      code: 'UNLOCK_SUPERSEDED',
    });
    expect(await changesOf(session.id)).toHaveLength(0);
  });

  it('stays open for the unlock on a protection-off chip, and past a late return (A13)', async () => {
    const off = await unlocked('reason-protection-off');
    await protectionOff(db, off.act(6));
    const notedId = newUuidV7();
    const noted = await unlock(db, { ...off.act(7), eventId: notedId, reason: 'nurse' });
    expect(noted.recordedAs).toBe('protection_off');
    expect((await change(notedId, off.student.id, 'other')).outcome).toBe('applied');
    expect(await gridReason(off.session.id, off.klass.id, off.student.id)).toBe('other');

    // A refocus the phone made before its unlock, landing after it: late, so
    // the unlock stands, and its reason still changes.
    const { student, act } = await unlocked('reason-late-return');
    const install = newUuidV7();
    const unlockId = newUuidV7();
    await unlock(db, { ...act(9), eventId: unlockId, order: { install, seq: 3 } });
    const back = await refocus(db, { ...act(8), order: { install, seq: 2 } });
    expect(back.outcome).toBe('replay');
    expect((await change(unlockId, student.id, 'nurse')).outcome).toBe('applied');
  });

  it('is refused once the class is over by the server’s clock, swept or not', async () => {
    const { session, student, unlockId } = await unlocked('reason-bell', 'bathroom');
    await expect(change(unlockId, student.id, 'nurse', newUuidV7(), at(25))).rejects.toMatchObject({
      code: 'SESSION_NOT_RUNNING',
    });
    await endSession(db, { sessionId: session.id, at: at(12), reason: 'ended' });
    await expect(change(unlockId, student.id, 'nurse')).rejects.toMatchObject({
      code: 'SESSION_NOT_RUNNING',
    });
    expect(await changesOf(session.id)).toHaveLength(0);
  });

  it('names only an unlock of the caller’s own, filed in a session', async () => {
    const { session, student, unlockId, act } = await unlocked('reason-own', 'bathroom');
    const other = await unlocked('reason-own-other', 'nurse');
    const orphanId = newUuidV7();
    await unlock(db, { ...act(6), sessionId: newUuidV7(), eventId: orphanId });
    const tapId = newUuidV7();
    await tapIn(db, { ...other.act(11), eventId: tapId });

    for (const [unlockEventId, by] of [
      [unlockId, other.student.id],
      [orphanId, student.id],
      [tapId, other.student.id],
      [newUuidV7(), student.id],
    ] as const) {
      await expect(change(unlockEventId, by, 'other')).rejects.toMatchObject({
        code: 'UNLOCK_NOT_FOUND',
      });
    }
    expect(await changesOf(session.id)).toHaveLength(0);
    expect(await changesOf(other.session.id)).toHaveLength(0);
  });

  it('refuses an id another event holds, recording nothing', async () => {
    const { session, student, unlockId, act } = await unlocked('reason-conflict', 'bathroom');
    const other = await unlocked('reason-conflict-other', 'nurse');
    const theirs = newUuidV7();
    await change(other.unlockId, other.student.id, 'other', theirs);

    for (const eventId of [unlockId, theirs]) {
      await expect(change(unlockId, student.id, 'nurse', eventId)).rejects.toMatchObject({
        code: 'EVENT_ID_CONFLICT',
      });
    }
    expect(await changesOf(session.id)).toHaveLength(0);

    // Their own change of another unlock of theirs is no replay of this one.
    const mine = newUuidV7();
    await change(unlockId, student.id, 'nurse', mine);
    const againId = newUuidV7();
    await unlock(db, { ...act(12), eventId: againId });
    await expect(change(againId, student.id, 'other', mine)).rejects.toMatchObject({
      code: 'EVENT_ID_CONFLICT',
    });
    expect(await changesOf(session.id)).toHaveLength(1);
  });

  it('stores only a known reason, whatever its caller passes', async () => {
    const { session, student, unlockId } = await unlocked('reason-untrusted', 'bathroom');
    await expect(
      change(unlockId, student.id, 'skateboard' as unknown as UnlockReason),
    ).rejects.toThrow('not a known reason');
    expect(await changesOf(session.id)).toHaveLength(0);
  });
});
