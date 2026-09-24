import { MAX_SESSION_MINUTES, type UnlockReason } from '@bali/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import {
  armedTaps,
  classes,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  users,
} from '../src/schema.js';
import {
  armTap,
  checkIn,
  endEnrollment,
  endSession,
  expireDueSessions,
  extendSession,
  joinClassByCode,
  protectionOff,
  refocus,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  unlocksAwaitingTap,
  unlockUnderTap,
} from '../src/transitions.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

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

/** A class with two students enrolled, plus a helper to open a session on it. */
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
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `student-${tag}`, role: 'student', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: `Class ${tag}`,
        joinCode: `JOIN-${tag}`,
      })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  return { school, teacher, student, klass };
}

function window(fromISO: string, minutes = 25) {
  const startedAt = new Date(fromISO);
  return { startedAt, endsAt: new Date(startedAt.getTime() + minutes * 60_000) };
}

async function eventsFor(sessionId: string) {
  return db.select().from(events).where(eq(events.sessionId, sessionId)).orderBy(asc(events.seq));
}

describe('startSession', () => {
  it('creates a running session and a session_started event', async () => {
    const { klass } = await seedClass('start');
    const w = window('2026-01-01T09:00:00Z');
    const result = await startSession(db, { classId: klass.id, ...w });

    expect(result.outcome).toBe('created');
    expect(result.session.endedAt).toBeNull();
    const evs = await eventsFor(result.session.id);
    expect(evs.map((e) => e.type)).toEqual(['session_started']);
  });

  it('returns the already-running session instead of a duplicate', async () => {
    const { klass } = await seedClass('start-dup');
    const w = window('2026-01-01T09:00:00Z');
    const first = await startSession(db, { classId: klass.id, ...w });
    const again = await startSession(db, { classId: klass.id, ...window('2026-01-01T09:05:00Z') });

    expect(again.outcome).toBe('existing');
    expect(again.session.id).toBe(first.session.id);
  });
});

describe('tapIn', () => {
  it('joins a running session: focused participation + tap_in event', async () => {
    const { klass, student } = await seedClass('tap');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });

    const r = await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    expect(r.outcome).toBe('joined');
    expect(r.state).toBe('focused');
    const evs = await eventsFor(session.id);
    expect(evs.map((e) => e.type)).toEqual(['session_started', 'tap_in']);
  });

  it('is idempotent on event_id — a retried tap counts once', async () => {
    const { klass, student } = await seedClass('tap-retry');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const eventId = newUuidV7();
    const tap = {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    };

    const first = await tapIn(db, tap);
    const retry = await tapIn(db, tap);

    expect(first.outcome).toBe('joined');
    expect(retry.outcome).toBe('replay');
    expect(retry.participationId).toBe(first.participationId);
    const tapEvents = (await eventsFor(session.id)).filter((e) => e.type === 'tap_in');
    expect(tapEvents).toHaveLength(1);
    const parts = await db
      .select()
      .from(participations)
      .where(eq(participations.sessionId, session.id));
    expect(parts).toHaveLength(1);
  });

  it('clamps a bad device clock into the session window', async () => {
    const { klass, student } = await seedClass('tap-clamp');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });

    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T06:00:00Z'), // hours early
    });
    const tapEvent = one((await eventsFor(session.id)).filter((e) => e.type === 'tap_in'));
    expect(tapEvent.occurredAt.toISOString()).toBe(w.startedAt.toISOString());
  });

  it('switching sessions ends the first as left_for_other_session, atomically', async () => {
    const a = await seedClass('switch-a');
    const b = await seedClass('switch-b');
    // Enroll student A into class B too so the tap is legitimate.
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });
    const sessionA = (
      await startSession(db, { classId: a.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    const sessionB = (
      await startSession(db, { classId: b.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;

    await tapIn(db, {
      sessionId: sessionA.id,
      studentId: a.student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    const switched = await tapIn(db, {
      sessionId: sessionB.id,
      studentId: a.student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });

    expect(switched.outcome).toBe('switched');
    // Participation A ended with the right reason; B is live. One live row total.
    const partA = one(
      await db.select().from(participations).where(eq(participations.sessionId, sessionA.id)),
    );
    expect(partA.endedReason).toBe('left_for_other_session');
    expect(partA.endedAt).not.toBeNull();
    const live = await db
      .select()
      .from(participations)
      .where(and(eq(participations.studentId, a.student.id), isNull(participations.endedAt)));
    expect(live).toHaveLength(1);
    expect(live[0]!.sessionId).toBe(sessionB.id);
    // The switch produced a left_for_other_session event on session A, carrying
    // session A's class so it lands in that class's reports.
    const leftEvent = one(
      (await eventsFor(sessionA.id)).filter((e) => e.type === 'left_for_other_session'),
    );
    expect(leftEvent.classId).toBe(a.klass.id);
  });

  it('re-tapping a session the student left updates the same row, no duplicate', async () => {
    const { klass, student } = await seedClass('retap');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const p1 = await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    // End the participation directly (simulating a leave), then re-tap.
    await db
      .update(participations)
      .set({ endedAt: new Date('2026-01-01T09:05:00Z'), endedReason: 'left_class' })
      .where(eq(participations.id, p1.participationId!));

    const p2 = await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:06:00Z'),
    });
    expect(p2.participationId).toBe(p1.participationId);
    expect(p2.state).toBe('focused');
    const rows = await db
      .select()
      .from(participations)
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt).toBeNull();
  });

  it('refuses a tap into an ended session', async () => {
    const { klass, student } = await seedClass('tap-ended');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:25:00Z'),
      reason: 'ended',
    });

    await expect(
      tapIn(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date('2026-01-01T09:26:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
  });
});

describe('state changes', () => {
  async function joined(tag: string) {
    const { klass, student } = await seedClass(tag);
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    return { session, student };
  }

  it('unlock then refocus move the stored state and log both events', async () => {
    const { session, student } = await joined('unlock');
    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(u.state).toBe('unlocked');
    const r = await refocus(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:06:00Z'),
    });
    expect(r.state).toBe('focused');
    expect((await eventsFor(session.id)).map((e) => e.type)).toEqual([
      'session_started',
      'tap_in',
      'unlock',
      'refocus',
    ]);
  });

  it('protectionOff is its own state', async () => {
    const { session, student } = await joined('protoff');
    const p = await protectionOff(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(p.state).toBe('protection_off');
  });

  it('unlock is idempotent on event_id', async () => {
    const { session, student } = await joined('unlock-retry');
    const eventId = newUuidV7();
    const req = {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    };
    await unlock(db, req);
    const retry = await unlock(db, req);
    expect(retry.outcome).toBe('replay');
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(1);
  });

  it('records an unlock for a student with no live participation instead of discarding it (ISSUES #2)', async () => {
    const { klass, student } = await seedClass('unlock-none');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(u.outcome).toBe('recorded');
    expect(u.recordedAs).toBe('no_live_participation');
    expect(u.state).toBeNull();
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(1);
  });

  it('refocus still refuses for a student with no live participation', async () => {
    const { klass, student } = await seedClass('refocus-none');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await expect(
      refocus(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date('2026-01-01T09:05:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_PARTICIPATING' });
  });

  it('the response carries the session so the phone learns the end time', async () => {
    const { session, student } = await joined('unlock-window');
    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(u.session).not.toBeNull();
    expect(u.session?.endsAt.toISOString()).toBe(session.endsAt.toISOString());
  });

  it('records an unlock after the session has ended, clamped into the window (ISSUES #2)', async () => {
    const { session, student } = await joined('unlock-after-end');
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:25:00Z'),
      reason: 'ended',
    });
    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:30:00Z'),
    });
    expect(u.outcome).toBe('recorded');
    expect(u.recordedAs).toBe('after_session_end');
    const unlocks = (await eventsFor(session.id)).filter((e) => e.type === 'unlock');
    expect(unlocks).toHaveLength(1);
    // Rule 1: a device time past the bell is clamped back into the window.
    expect(unlocks[0]!.occurredAt.getTime()).toBeLessThanOrEqual(session.endsAt.getTime());
  });

  it('records an unlock for a student removed mid-session, and survives a replay (ISSUES #2)', async () => {
    const { session, student } = await joined('unlock-removed');
    // The student is removed from the class mid-session: their participation ends
    // while the session keeps running (the canonical ISSUES #2 scenario).
    await db
      .update(participations)
      .set({ endedAt: new Date('2026-01-01T09:04:00Z'), endedReason: 'removed_from_class' })
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );
    const eventId = newUuidV7();
    const req = {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    };
    const first = await unlock(db, req);
    expect(first.outcome).toBe('recorded');
    expect(first.recordedAs).toBe('no_live_participation');
    // A retry after a token refresh must not create a second record or throw.
    const replay = await unlock(db, req);
    expect(replay.outcome).toBe('replay');
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(1);
  });

  it('records an unlock against an unknown session as an orphan event (ISSUES #2)', async () => {
    const { student } = await seedClass('unlock-unknown');
    const bogusSessionId = newUuidV7();
    const u = await unlock(db, {
      sessionId: bogusSessionId,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(u.outcome).toBe('recorded');
    expect(u.recordedAs).toBe('unknown_session');
    expect(u.session).toBeNull();
    // Recorded with no session/class attached, carrying the claimed id in payload.
    const orphan = one(
      await db
        .select()
        .from(events)
        .where(and(eq(events.userId, student.id), eq(events.type, 'unlock'))),
    );
    expect(orphan.sessionId).toBeNull();
    expect(orphan.classId).toBeNull();
    expect(orphan.payload).toMatchObject({
      recorded_as: 'unknown_session',
      claimed_session_id: bogusSessionId,
    });
  });

  it("records a stranger's unlock as an orphan rather than writing into a session they have no standing in", async () => {
    // The victim: a real running session belonging to someone else's class.
    const { klass } = await seedClass('unlock-stranger-victim');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    // The attacker: a fully valid account at another school, holding a good
    // token, who has merely learned (or guessed) the session id.
    const { student: stranger } = await seedClass('unlock-stranger-other');

    const u = await unlock(db, {
      sessionId: session.id,
      studentId: stranger.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });

    // Still recorded — rule 6 means this can never be a refusal — but as an
    // orphan, and it hands back no session (so a stranger learns neither the
    // class id nor the bell window).
    expect(u.outcome).toBe('recorded');
    expect(u.recordedAs).toBe('not_enrolled');
    expect(u.session).toBeNull();
    expect(u.state).toBeNull();

    const orphan = one(
      await db
        .select()
        .from(events)
        .where(and(eq(events.userId, stranger.id), eq(events.type, 'unlock'))),
    );
    expect(orphan.sessionId).toBeNull();
    expect(orphan.classId).toBeNull();
    expect(orphan.payload).toMatchObject({
      recorded_as: 'not_enrolled',
      claimed_session_id: session.id,
    });

    // The victim's session history and live grid are untouched.
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(0);
  });

  it('refuses an unlock whose event_id already belongs to a different event, rather than swallowing it', async () => {
    // The sharpest version of v2's lost-unlock bug. insertEvent de-dupes on
    // event_id alone, so an unlock carrying an id the phone already spent on
    // its own tap_in used to no-op: outcome 'replay', which the unlock contract
    // counts as recorded, so the outbox deletes the record — an unshielded
    // phone with zero trace. A student's app is an adversary here, and this is
    // a one-line change on their side.
    const { session, student } = await joined('unlock-id-reuse');
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });

    await expect(
      unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId,
        deviceTime: new Date('2026-01-01T09:05:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    // Nothing recorded, and — critically — nothing claimed to be recorded.
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(0);
    const row = one(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    );
    expect(row.state).toBe('focused');
  });

  it('refuses a protection_off whose event_id already belongs to a different event', async () => {
    // Same hole through changeState: protection_off is an honesty record too,
    // and swallowing it leaves the grid green for an unshielded phone.
    const { session, student } = await joined('protoff-id-reuse');
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });
    await expect(
      protectionOff(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId,
        deviceTime: new Date('2026-01-01T09:05:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    expect((await eventsFor(session.id)).filter((e) => e.type === 'protection_off')).toHaveLength(
      0,
    );
  });

  it('an enrolled student who never tapped in still attaches their unlock to the session', async () => {
    // The enrollment check must not catch the ordinary case the ISSUES #2 note
    // is written for: enrolled, present, but no participation row yet.
    const { klass, student } = await seedClass('unlock-enrolled-no-tap');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(u.recordedAs).toBe('no_live_participation');
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(1);
  });

  it('a replay whose participation has since ended returns current truth, not an error', async () => {
    const { session, student } = await joined('unlock-replay-pended');
    const eventId = newUuidV7();
    await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    // The participation ends (e.g. the student left the class) while the session
    // keeps running; a stale retry of the unlock then arrives.
    await db
      .update(participations)
      .set({ endedAt: new Date('2026-01-01T09:06:00Z'), endedReason: 'left_class' })
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );

    const replay = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(replay.outcome).toBe('replay');
    expect(replay.state).toBe('unlocked');
  });

  it('a refocus replayed after its participation ended names no session, however it ended', async () => {
    /*
     * A4, the refocus half. The session still runs, so the bell's guard does
     * not catch this, and the ended row's last state is not the truth for a
     * student removed, gone from the class or switched away: answered WITH
     * the session (as it was until A4), `stateChangeDisposition` reads it as
     * `apply_session` and a refocus answer turns shields back on — pointing
     * the phone at a session it is no longer in. The outbox's superseded-
     * refocus rule keeps an honest client from sending it after a switch (a
     * later tap), but not after a removal, and a refocus already in flight
     * when the student switched still arrives. So the replay names no session
     * and no state: delete it, and re-read the truth.
     */
    for (const ending of ['removed_from_class', 'left_class', 'switched'] as const) {
      const { school, teacher, student, klass } = await seedClass(`refocus-replay-${ending}`);
      const { session } = await startSession(db, {
        classId: klass.id,
        ...window('2026-01-01T09:00:00Z'),
      });
      const at = (minute: number) => ({
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date(`2026-01-01T09:0${minute}:00Z`),
      });
      await tapIn(db, at(1));
      await unlock(db, at(2));
      const refocused = at(3);
      expect(await refocus(db, refocused)).toMatchObject({ outcome: 'applied', state: 'focused' });

      if (ending === 'switched') {
        const next = one(
          await db
            .insert(classes)
            .values({
              teacherId: teacher.id,
              schoolId: school.id,
              name: 'Next period',
              joinCode: `REFSW-${ending}`,
            })
            .returning(),
        );
        await db.insert(enrollments).values({ classId: next.id, studentId: student.id });
        const moved = await startSession(db, {
          classId: next.id,
          ...window('2026-01-01T09:00:00Z'),
        });
        expect((await tapIn(db, { ...at(4), sessionId: moved.session.id })).outcome).toBe(
          'switched',
        );
      } else {
        const enrollment = one(
          await db
            .select()
            .from(enrollments)
            .where(and(eq(enrollments.classId, klass.id), eq(enrollments.studentId, student.id))),
        );
        await endEnrollment(db, {
          enrollmentId: enrollment.id,
          reason: ending,
          at: new Date('2026-01-01T09:04:00Z'),
        });
      }

      expect(await refocus(db, refocused), ending).toMatchObject({
        outcome: 'replay',
        state: null,
        session: null,
      });
      // Recorded once, and the ended row is exactly as its ending left it.
      expect((await eventsFor(session.id)).filter((e) => e.type === 'refocus')).toHaveLength(1);
      const row = one(
        await db.select().from(participations).where(eq(participations.sessionId, session.id)),
      );
      expect(row.endedReason).toBe(ending === 'switched' ? 'left_for_other_session' : ending);
    }
  });

  it('an answer that names no session names no participation either (A5)', async () => {
    /*
     * #62's review: the two "recorded, but no longer current" replays
     * disagreed — a tap's named no participation, a refocus's the ended row.
     * One shape before the fixtures and BaliCore freeze it: wherever
     * `session` is null, so is `participationId` — A2c's late protection-off
     * included. (The tap's is pinned where its replays are.)
     */
    const at = (minute: number) => new Date(`2026-01-01T09:0${minute}:00Z`);
    const { session, student } = await joined('no-session-no-row');
    const change = (minute: number) => ({
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: at(minute),
    });
    await unlock(db, change(2));
    const refocused = change(3);
    expect((await refocus(db, refocused)).participationId).not.toBeNull();
    const enrollment = one(
      await db
        .select()
        .from(enrollments)
        .where(
          and(eq(enrollments.classId, session.classId), eq(enrollments.studentId, student.id)),
        ),
    );
    await endEnrollment(db, { enrollmentId: enrollment.id, reason: 'left_class', at: at(4) });
    expect(await refocus(db, refocused)).toEqual({
      outcome: 'replay',
      state: null,
      participationId: null,
      session: null,
    });

    const late = await joined('no-session-no-row-late');
    await endSession(db, { sessionId: late.session.id, at: at(5), reason: 'ended' });
    const report = {
      sessionId: late.session.id,
      studentId: late.student.id,
      eventId: newUuidV7(),
      deviceTime: at(6),
    };
    for (const outcome of ['recorded', 'replay']) {
      expect(await protectionOff(db, report)).toMatchObject({
        outcome,
        state: null,
        participationId: null,
        session: null,
      });
    }
  });

  describe('the optional reason', () => {
    const at = new Date('2026-01-01T09:05:00Z');

    it('records the reason the student gave on the unlock event', async () => {
      const { session, student } = await joined('reason-live');
      const u = await unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at,
        reason: 'bathroom',
      });
      expect(u.outcome).toBe('applied');
      expect(u.reason).toBe('bathroom');
      const recorded = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
      expect(recorded.payload).toEqual({ reason: 'bathroom' });
    });

    it('an unlock with no reason keeps the null payload unlocks always had', async () => {
      const { session, student } = await joined('reason-none');
      const u = await unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at,
      });
      expect(u.reason).toBeNull();
      const recorded = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
      expect(recorded.payload).toBeNull();
    });

    it('keeps the reason beside the note when there is nothing live to flip (ISSUES #2)', async () => {
      const { session, student } = await joined('reason-after-end');
      await endSession(db, {
        sessionId: session.id,
        at: new Date('2026-01-01T09:25:00Z'),
        reason: 'ended',
      });
      const u = await unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date('2026-01-01T09:30:00Z'),
        reason: 'nurse',
      });
      expect(u.outcome).toBe('recorded');
      expect(u.recordedAs).toBe('after_session_end');
      expect(u.reason).toBe('nurse');
      const recorded = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
      expect(recorded.payload).toEqual({ recorded_as: 'after_session_end', reason: 'nurse' });
    });

    it('keeps the reason on an orphan unlock, and a replay of it answers with that reason', async () => {
      const { student } = await seedClass('reason-orphan');
      const req = {
        sessionId: newUuidV7(),
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at,
      };
      const first = await unlock(db, { ...req, reason: 'other' });
      expect(first.recordedAs).toBe('unknown_session');
      expect(first.reason).toBe('other');
      const orphan = one(
        await db
          .select()
          .from(events)
          .where(and(eq(events.userId, student.id), eq(events.type, 'unlock'))),
      );
      expect(orphan.payload).toMatchObject({ recorded_as: 'unknown_session', reason: 'other' });

      const changed = await unlock(db, { ...req, reason: 'bathroom' });
      expect(changed.outcome).toBe('replay');
      expect(changed.reason).toBe('other');
      const dropped = await unlock(db, req);
      expect(dropped.reason).toBe('other');
    });

    it('only a known reason reaches the payload, whatever the caller passes', async () => {
      // The engine is the one writer of events and does not lean on the route
      // having validated: a caller that hands in anything else records none.
      const { session, student } = await joined('reason-untrusted');
      const u = await unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at,
        reason: 'skateboard' as unknown as UnlockReason,
      });
      expect(u.outcome).toBe('applied');
      expect(u.reason).toBeNull();
      const recorded = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
      expect(recorded.payload).toBeNull();
    });

    it('a replay answers with the reason on record, not the one the retry carries', async () => {
      // A phone that changed its answer between retries must learn which reason
      // the teacher sees — the recorded one (rule 4: a replay returns the truth).
      const { session, student } = await joined('reason-replay');
      const req = {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at,
      };
      await unlock(db, { ...req, reason: 'nurse' });
      // A later, separate unlock by the same student with another reason: the
      // replay below must read ITS OWN event, not this student's latest unlock.
      await unlock(db, { ...req, eventId: newUuidV7(), reason: 'bathroom' });

      const changed = await unlock(db, { ...req, reason: 'other' });
      expect(changed.outcome).toBe('replay');
      expect(changed.reason).toBe('nurse');
      const dropped = await unlock(db, req);
      expect(dropped.reason).toBe('nurse');

      const unlocks = (await eventsFor(session.id)).filter((e) => e.type === 'unlock');
      expect(unlocks.map((e) => e.payload)).toEqual([{ reason: 'nurse' }, { reason: 'bathroom' }]);
    });
  });

  describe('protection off', () => {
    const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);
    function change(session: { id: string }, student: { id: string }, minute: number) {
      return {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at(minute),
      };
    }
    async function stateOf(sessionId: string) {
      return one(
        await db.select().from(participations).where(eq(participations.sessionId, sessionId)),
      ).state;
    }

    it('refocus cannot leave it — nothing is recorded — and a re-tap can', async () => {
      // iOS dropped every shield when the permission went, so "focused" without a
      // re-tap would be a green chip over an unshielded phone.
      const { session, student } = await joined('protoff-refocus');
      await protectionOff(db, change(session, student, 5));

      await expect(refocus(db, change(session, student, 6))).rejects.toMatchObject({
        code: 'PROTECTION_OFF',
      });
      expect((await eventsFor(session.id)).map((e) => e.type)).toEqual([
        'session_started',
        'tap_in',
        'protection_off',
      ]);
      expect(await stateOf(session.id)).toBe('protection_off');

      const retap = await tapIn(db, change(session, student, 7));
      expect(retap.state).toBe('focused');
      expect(await stateOf(session.id)).toBe('focused');
    });

    it('a refocus recorded before protection went off still replays the current truth', async () => {
      // The refusal is for fresh changes only: a retry of a refocus that already
      // landed must re-read and answer, never 409 its own outbox record.
      const { session, student } = await joined('protoff-refocus-replay');
      await unlock(db, change(session, student, 5));
      const req = change(session, student, 6);
      expect((await refocus(db, req)).outcome).toBe('applied');
      await protectionOff(db, change(session, student, 7));

      const retry = await refocus(db, req);
      expect(retry.outcome).toBe('replay');
      expect(retry.state).toBe('protection_off');
    });

    it('an unlock never softens it: recorded, noted, the state left alone', async () => {
      const { session, student } = await joined('protoff-unlock');
      await protectionOff(db, change(session, student, 5));
      const req = { ...change(session, student, 6), reason: 'nurse' as const };

      const u = await unlock(db, req);
      expect(u).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'protection_off',
        state: 'protection_off',
        reason: 'nurse',
      });
      const recorded = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
      expect(recorded.payload).toEqual({ recorded_as: 'protection_off', reason: 'nurse' });
      expect(await stateOf(session.id)).toBe('protection_off');

      const replay = await unlock(db, req);
      expect(replay).toMatchObject({ outcome: 'replay', state: 'protection_off', reason: 'nurse' });
    });

    it('an unlock while protection is off still counts as contact', async () => {
      // Nothing flips, but the phone spoke to the server, so last contact
      // moves — the grid's "last seen" must not age over a phone that is here.
      const { session, student } = await joined('protoff-unlock-contact');
      await protectionOff(db, change(session, student, 5));
      const stale = new Date('2026-01-01T09:06:00Z');
      await db
        .update(participations)
        .set({ lastSeenAt: stale })
        .where(eq(participations.sessionId, session.id));

      await unlock(db, change(session, student, 7));
      const row = one(
        await db.select().from(participations).where(eq(participations.sessionId, session.id)),
      );
      expect(row.lastSeenAt!.getTime()).toBeGreaterThan(stale.getTime());
      // The server's clock, never the device's (rule 1): the unlock claimed 09:07.
      expect(Math.abs(Date.now() - row.lastSeenAt!.getTime())).toBeLessThan(60_000);
    });

    it('an unlock while protection is off closes an open silence episode', async () => {
      // Defensive: nothing leaves an episode open on a protection-off row today
      // (the sweep marks only focused rows, protectionOff closes any episode it
      // finds, and when the two race, the sweep queues behind it or one side
      // loses a deadlock and retries into one of those cases), so the test
      // plants one. Contact must still close it if a future path does.
      const { session, student } = await joined('protoff-unlock-silence');
      await protectionOff(db, change(session, student, 5));
      await db
        .update(participations)
        .set({ silentSince: at(6) })
        .where(eq(participations.sessionId, session.id));

      await unlock(db, change(session, student, 8));
      const row = one(
        await db.select().from(participations).where(eq(participations.sessionId, session.id)),
      );
      expect(row.silentSince).toBeNull();
      expect(row.state).toBe('protection_off');
      expect((await eventsFor(session.id)).filter((e) => e.type === 'came_back')).toHaveLength(1);
    });

    it('a change retried after the bell is refused, never replayed with the ended session', async () => {
      // A replay would carry the session's window, and the teacher ended this
      // one EARLY, so its endsAt is still ahead: a refocus answer would tell
      // the phone to shield to a bell that already rang (rule 4's forbidden
      // 200). The refusal costs nothing — the phone drops a refused change and
      // re-reads the truth. The report landed while the session ran, so owner
      // decision 10 — a report FIRST reaching the server after the end is
      // recorded — does not cover its retry: it is on record, and keeps this.
      const { session, student } = await joined('protoff-after-bell');
      await unlock(db, change(session, student, 4));
      const refocused = change(session, student, 5);
      await refocus(db, refocused);
      const reported = change(session, student, 6);
      await protectionOff(db, reported);
      await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });

      await expect(refocus(db, refocused)).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
      await expect(protectionOff(db, reported)).rejects.toMatchObject({
        code: 'SESSION_NOT_RUNNING',
      });
      const types = (await eventsFor(session.id)).map((e) => e.type);
      expect(types.filter((t) => t === 'refocus')).toHaveLength(1);
      expect(types.filter((t) => t === 'protection_off')).toHaveLength(1);
    });

    describe('a report that first reaches the server after the session ended (owner decision 10)', () => {
      /** The bell is the sweep's own call (expireDueSessions -> endSession 'expired'). */
      function end(session: { id: string }, how: 'bell' | 'early') {
        return endSession(db, {
          sessionId: session.id,
          at: at(10),
          reason: how === 'bell' ? 'expired' : 'ended',
        });
      }
      async function reports(sessionId: string) {
        return (await eventsFor(sessionId)).filter((e) => e.type === 'protection_off');
      }
      async function rowOf(sessionId: string, studentId: string) {
        return one(
          await db
            .select()
            .from(participations)
            .where(
              and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)),
            ),
        );
      }

      it('is recorded with a note and marks nothing, at the bell or an early end', async () => {
        for (const how of ['bell', 'early'] as const) {
          const { session, student } = await joined(`protoff-late-${how}`);
          await end(session, how);
          const before = await rowOf(session.id, student.id);
          // The phone claims 09:40, past the scheduled end: rule 1 clamps it.
          const report = change(session, student, 40);

          // Saved like a late unlock, and answered with no session and no
          // state: after an early end endsAt is still ahead, and an answer
          // carrying it would hand the phone a window to shield to.
          expect(await protectionOff(db, report)).toMatchObject({
            outcome: 'recorded',
            recordedAs: 'after_session_end',
            state: null,
            session: null,
          });
          const [recorded] = await reports(session.id);
          expect(recorded?.payload).toEqual({ recorded_as: 'after_session_end' });
          expect(recorded?.occurredAt).toEqual(session.endsAt);
          // Nothing marked: the ended row is exactly as the end left it.
          expect(await rowOf(session.id, student.id)).toEqual(before);

          // A retry replays, still with no window, and records nothing twice.
          expect(await protectionOff(db, report)).toMatchObject({
            outcome: 'replay',
            recordedAs: null,
            state: null,
            session: null,
          });
          expect(await reports(session.id)).toHaveLength(1);

          // Refocus is untouched: refused after the end, and records nothing.
          await expect(refocus(db, change(session, student, 11))).rejects.toMatchObject({
            code: 'SESSION_NOT_RUNNING',
          });
          expect((await eventsFor(session.id)).some((e) => e.type === 'refocus')).toBe(false);
        }
      });

      it('an id already spent on another event is still refused, never recorded or replayed', async () => {
        // The same hole insertEvent closes for every writer: answering this as
        // a replay would tell the phone its report is safe while none exists.
        const { session, student } = await joined('protoff-late-id-reuse');
        const tapId = newUuidV7();
        await tapIn(db, { ...change(session, student, 2), eventId: tapId });
        await end(session, 'bell');

        await expect(
          protectionOff(db, { ...change(session, student, 11), eventId: tapId }),
        ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
        expect(await reports(session.id)).toHaveLength(0);
      });

      it('anyone who was not in the session when it ended keeps the refusal, and nothing is recorded', async () => {
        // The ruling covers a student who was in the session at its end.
        // Everyone else keeps the answer they had: a participation that ended
        // first (removed, left the class, switched away), none at all (never
        // tapped in), or no standing here (an outsider, the teacher) — so no
        // one writes into a session they were not in at its end.
        const { school, teacher, student: stayed, klass } = await seedClass('protoff-late-who');
        const { session } = await startSession(db, {
          classId: klass.id,
          ...window('2026-01-01T09:00:00Z'),
        });
        const elsewhere = await seedClass('protoff-late-who-elsewhere');
        const next = (
          await startSession(db, {
            classId: elsewhere.klass.id,
            ...window('2026-01-01T09:00:00Z'),
          })
        ).session;
        const [removed, left, switched, absent] = await db
          .insert(users)
          .values(
            ['removed', 'left', 'switched', 'absent'].map((who) => ({
              cognitoId: `student-protoff-late-${who}`,
              role: 'student' as const,
              schoolId: school.id,
            })),
          )
          .returning();
        const enrolled = await db
          .insert(enrollments)
          .values(
            [removed!, left!, switched!, absent!].map((s) => ({
              classId: klass.id,
              studentId: s.id,
            })),
          )
          .returning();
        await db
          .insert(enrollments)
          .values({ classId: elsewhere.klass.id, studentId: switched!.id });
        for (const s of [stayed, removed!, left!, switched!])
          await tapIn(db, change(session, s, 2));
        const enrollmentOf = (id: string) => enrolled.find((e) => e.studentId === id)!.id;
        await endEnrollment(db, {
          enrollmentId: enrollmentOf(removed!.id),
          reason: 'removed_from_class',
          at: at(5),
        });
        await endEnrollment(db, {
          enrollmentId: enrollmentOf(left!.id),
          reason: 'left_class',
          at: at(5),
        });
        await tapIn(db, change(next, switched!, 5));
        await end(session, 'bell');

        const notCovered = {
          removed: removed!,
          left: left!,
          switched: switched!,
          absent: absent!,
          outsider: elsewhere.student,
          teacher,
        };
        for (const [who, caller] of Object.entries(notCovered)) {
          await expect(protectionOff(db, change(session, caller, 11)), who).rejects.toMatchObject({
            code: 'SESSION_NOT_RUNNING',
          });
        }
        expect(await reports(session.id)).toHaveLength(0);
        // The control: the one student the end itself closed is recorded.
        expect((await protectionOff(db, change(session, stayed, 11))).outcome).toBe('recorded');
        expect(await reports(session.id)).toHaveLength(1);
      });
    });

    it('a report replayed after the student was removed mid-session is refused, not answered as focused', async () => {
      // The session still runs, so the bell's guard does not catch this, and
      // the ended row's last state ("focused", after a re-tap) is not the truth
      // for a removed student: a 200 naming this session would point their
      // phone back at it. Refocus answers the same replay with no session and
      // no state instead (A4) — neither names the session.
      const { session, student } = await joined('protoff-removed-replay');
      await unlock(db, change(session, student, 3));
      const refocused = change(session, student, 4);
      await refocus(db, refocused);
      const reported = change(session, student, 5);
      await protectionOff(db, reported);
      await tapIn(db, change(session, student, 6));
      const enrollment = one(
        await db
          .select()
          .from(enrollments)
          .where(
            and(eq(enrollments.classId, session.classId), eq(enrollments.studentId, student.id)),
          ),
      );
      await endEnrollment(db, {
        enrollmentId: enrollment.id,
        reason: 'removed_from_class',
        at: at(7),
      });

      await expect(protectionOff(db, reported)).rejects.toMatchObject({
        code: 'NOT_PARTICIPATING',
      });
      expect(await refocus(db, refocused)).toMatchObject({
        outcome: 'replay',
        state: null,
        session: null,
      });
      const types = (await eventsFor(session.id)).map((e) => e.type);
      expect(types.filter((t) => t === 'protection_off')).toHaveLength(1);
    });

    it('an unlock after a protection-off participation ended is noted as not live, not as protection off', async () => {
      // `protection_off` as a note means the student was LIVE and nothing
      // flipped; once the participation has ended the unlock is recorded like
      // any other that found no one live here.
      for (const ending of ['removed', 'bell'] as const) {
        const { session, student } = await joined(`protoff-ended-unlock-${ending}`);
        await protectionOff(db, change(session, student, 5));
        if (ending === 'removed') {
          const enrollment = one(
            await db
              .select()
              .from(enrollments)
              .where(
                and(
                  eq(enrollments.classId, session.classId),
                  eq(enrollments.studentId, student.id),
                ),
              ),
          );
          await endEnrollment(db, {
            enrollmentId: enrollment.id,
            reason: 'removed_from_class',
            at: at(6),
          });
        } else {
          await endSession(db, { sessionId: session.id, at: at(6), reason: 'ended' });
        }

        const note = ending === 'removed' ? 'no_live_participation' : 'after_session_end';
        expect(await unlock(db, change(session, student, 7))).toMatchObject({
          outcome: 'recorded',
          recordedAs: note,
          state: null,
        });
        const recorded = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
        expect(recorded.payload).toEqual({ recorded_as: note });
      }
    });

    it('takes over from an unlocked student', async () => {
      const { session, student } = await joined('protoff-after-unlock');
      await unlock(db, change(session, student, 5));
      const p = await protectionOff(db, change(session, student, 6));
      expect(p.outcome).toBe('applied');
      expect(await stateOf(session.id)).toBe('protection_off');
    });
  });

  it('a replay of an unlock for a never-participating student returns replay, not a refusal (ISSUES #2)', async () => {
    const { klass, student } = await seedClass('unlock-norow-replay');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const eventId = newUuidV7();
    const req = {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    };
    const first = await unlock(db, req);
    expect(first.outcome).toBe('recorded');
    // The student never had a participation row, so the replay path sees no row.
    // The old changeState threw NOT_PARTICIPATING here — it must now return replay.
    const replay = await unlock(db, req);
    expect(replay.outcome).toBe('replay');
    expect(replay.state).toBeNull();
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(1);
  });
});

describe('a late unlock: the student came back to focus after it (A10)', () => {
  // The owner's ruling (2026-09-24): an unlock stuck on the phone (B3a's bound)
  // while the student's own refocus or tap went ahead of it is recorded — never
  // lost — but flips nothing: the return stands.
  const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);
  function move(session: { id: string }, student: { id: string }, deviceTime: Date) {
    return { sessionId: session.id, studentId: student.id, eventId: newUuidV7(), deviceTime };
  }
  /** A student in a 09:00–09:25 lesson, tapped in at 09:01. */
  async function lesson(tag: string) {
    const { klass, student } = await seedClass(tag);
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, move(session, student, at(1)));
    return { session, student };
  }
  async function rowOf(sessionId: string, studentId: string) {
    return one(
      await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)),
        ),
    );
  }
  async function unlocksIn(sessionId: string) {
    return (await eventsFor(sessionId)).filter((e) => e.type === 'unlock');
  }

  it('is recorded with a note, the focus a later refocus returned to left alone', async () => {
    const { session, student } = await lesson('late-refocus');
    await unlock(db, move(session, student, at(5)));
    await refocus(db, move(session, student, at(8)));
    const late = { ...move(session, student, at(3)), reason: 'nurse' as const };

    const row = await rowOf(session.id, student.id);
    expect(await unlock(db, late)).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'superseded',
      state: 'focused',
      participationId: row.id,
      session: { id: session.id },
      reason: 'nurse',
    });
    expect((await rowOf(session.id, student.id)).state).toBe('focused');
    const recorded = (await unlocksIn(session.id)).find((e) => e.eventId === late.eventId);
    expect(recorded?.payload).toEqual({ recorded_as: 'superseded', reason: 'nurse' });
    expect(recorded?.occurredAt).toEqual(at(3));

    // Its retry replays the truth now, and records nothing twice.
    expect(await unlock(db, late)).toMatchObject({
      outcome: 'replay',
      state: 'focused',
      reason: 'nurse',
    });
    expect(await unlocksIn(session.id)).toHaveLength(2);
  });

  it('is recorded with a note after a re-tap too, and keeps a newer unlock as it is', async () => {
    const { session, student } = await lesson('late-retap');
    await tapIn(db, move(session, student, at(6)));
    expect(await unlock(db, move(session, student, at(4)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'superseded',
      state: 'focused',
    });

    // The student unlocked again since: the late one leaves that unlock alone.
    await unlock(db, move(session, student, at(9)));
    expect(await unlock(db, move(session, student, at(5)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'superseded',
      state: 'unlocked',
    });
    expect((await rowOf(session.id, student.id)).state).toBe('unlocked');
  });

  it('flips whichever lands first of the same pair, and ends in the return either way', async () => {
    // An unlock at 09:04 and the refocus at 09:06, in both arrival orders.
    for (const unlockFirst of [true, false]) {
      const { session, student } = await lesson(`late-order-${unlockFirst}`);
      const theUnlock = () => unlock(db, move(session, student, at(4)));
      const theRefocus = () => refocus(db, move(session, student, at(6)));
      if (unlockFirst) {
        expect((await theUnlock()).outcome).toBe('applied');
        expect((await theRefocus()).state).toBe('focused');
      } else {
        expect((await theRefocus()).state).toBe('focused');
        expect((await theUnlock()).recordedAs).toBe('superseded');
      }
      expect((await rowOf(session.id, student.id)).state).toBe('focused');
      expect(await unlocksIn(session.id)).toHaveLength(1);
    }
  });

  it('flips an unlock after the return, or at the same instant', async () => {
    for (const minute of [7, 6]) {
      const { session, student } = await lesson(`late-not-${minute}`);
      await unlock(db, move(session, student, at(4)));
      await refocus(db, move(session, student, at(6)));
      expect(await unlock(db, move(session, student, at(minute)))).toMatchObject({
        outcome: 'applied',
        recordedAs: null,
        state: 'unlocked',
      });
      expect((await rowOf(session.id, student.id)).state).toBe('unlocked');
    }
  });

  it('only counts the student’s own return: a classmate’s, or their own unlock, is none', async () => {
    const { session, student } = await lesson('late-whose');
    const classmate = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-late-whose-classmate', role: 'student' })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: session.classId, studentId: classmate.id });
    await tapIn(db, move(session, classmate, at(8)));
    await unlock(db, move(session, student, at(9)));

    // Nothing of the student's own came back to focus after 09:04.
    expect(await unlock(db, move(session, student, at(4)))).toMatchObject({
      outcome: 'applied',
      recordedAs: null,
    });
  });

  it('only counts a return in the unlock’s own session', async () => {
    // A tap into another class claiming 09:20 lands first; the tap back into
    // this one claims 09:05. Nothing here came back to focus after 09:10.
    const { session, student } = await lesson('late-where');
    const elsewhere = await seedClass('late-where-elsewhere');
    await db.insert(enrollments).values({ classId: elsewhere.klass.id, studentId: student.id });
    const other = (
      await startSession(db, { classId: elsewhere.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    await tapIn(db, move(other, student, at(20)));
    await tapIn(db, move(session, student, at(5)));

    expect(await unlock(db, move(session, student, at(10)))).toMatchObject({
      outcome: 'applied',
      state: 'unlocked',
    });
  });

  it('counts a return in a later stint of the same session', async () => {
    // Stuck in the first stint; the student switched away and tapped back in.
    const { session, student } = await lesson('late-stint');
    const elsewhere = await seedClass('late-stint-elsewhere');
    await db.insert(enrollments).values({ classId: elsewhere.klass.id, studentId: student.id });
    const other = (
      await startSession(db, { classId: elsewhere.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    await tapIn(db, move(other, student, at(5)));
    await tapIn(db, move(session, student, at(7)));

    expect(await unlock(db, move(session, student, at(3)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'superseded',
      state: 'focused',
    });
  });

  it('is still late once the student has left the session: noted, with no state to name (#76)', async () => {
    // Stuck on the phone from 09:03 while the student came back to focus at
    // 09:08 and was shielded when they left — at the bell, or removed. Read as
    // no live participation it would paint "Left · unlocked" over them.
    for (const leaves of ['bell', 'removal'] as const) {
      const { session, student } = await lesson(`late-left-${leaves}`);
      await unlock(db, move(session, student, at(5)));
      await refocus(db, move(session, student, at(8)));
      if (leaves === 'bell') {
        await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });
      } else {
        const [enrollment] = await db
          .select()
          .from(enrollments)
          .where(eq(enrollments.studentId, student.id));
        await endEnrollment(db, {
          enrollmentId: enrollment!.id,
          reason: 'removed_from_class',
          at: at(12),
        });
      }

      const late = { ...move(session, student, at(3)), reason: 'nurse' as const };
      expect(await unlock(db, late), leaves).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'superseded',
        state: null,
        participationId: null,
        session: { id: session.id },
        reason: 'nurse',
      });
      const row = await rowOf(session.id, student.id);
      expect(row.state, leaves).toBe('focused');
      expect(row.endedAt, leaves).not.toBeNull();
      const recorded = (await unlocksIn(session.id)).find((e) => e.eventId === late.eventId);
      expect(recorded?.payload, leaves).toEqual({ recorded_as: 'superseded', reason: 'nurse' });
    }
  });

  it('with no return after it, an unlock landing once the student has left keeps its note', async () => {
    // The unlock the student left on: "Left · unlocked" is the truth.
    const { session, student } = await lesson('late-left-unlocked');
    await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });
    expect(await unlock(db, move(session, student, at(9)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'after_session_end',
      state: null,
    });
  });

  it('protection off comes first: the state an unlock never softens', async () => {
    const { session, student } = await lesson('late-protoff');
    await tapIn(db, move(session, student, at(4)));
    await protectionOff(db, move(session, student, at(6)));
    expect(await unlock(db, move(session, student, at(2)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'protection_off',
      state: 'protection_off',
    });
  });

  it('is contact: last contact moves on the server clock, and an open silence episode closes', async () => {
    const { session, student } = await lesson('late-contact');
    await refocus(db, move(session, student, at(6)));
    const stale = at(7);
    await db
      .update(participations)
      .set({ lastSeenAt: stale, silentSince: stale })
      .where(eq(participations.sessionId, session.id));

    expect((await unlock(db, move(session, student, at(3)))).recordedAs).toBe('superseded');
    const row = await rowOf(session.id, student.id);
    expect(row.silentSince).toBeNull();
    expect(Math.abs(Date.now() - row.lastSeenAt!.getTime())).toBeLessThan(60_000);
    expect((await eventsFor(session.id)).filter((e) => e.type === 'came_back')).toHaveLength(1);
  });

  describe('a device clock cannot hide a real unlock', () => {
    it('one running behind all lesson clamps every claim to the start, and a tie flips', async () => {
      // Rule 1's v2 bug: a phone an hour behind. Every claim is before the
      // session began, so each clamps to 09:00 — the tap, the refocus and the
      // unlocks after them alike — and the unlock still flips every time.
      const { klass, student } = await seedClass('late-clock-behind');
      const { session } = await startSession(db, {
        classId: klass.id,
        ...window('2026-01-01T09:00:00Z'),
      });
      const behind = (minute: number) => new Date(at(minute).getTime() - 60 * 60_000);
      await tapIn(db, move(session, student, behind(1)));
      expect((await unlock(db, move(session, student, behind(5)))).outcome).toBe('applied');
      expect((await refocus(db, move(session, student, behind(7)))).state).toBe('focused');
      expect((await unlock(db, move(session, student, behind(10)))).outcome).toBe('applied');
      const clamped = (await eventsFor(session.id)).filter((e) => e.type !== 'session_started');
      expect(new Set(clamped.map((e) => e.occurredAt.getTime()))).toEqual(
        new Set([at(0).getTime()]),
      );
    });

    it('one running fast at the return never outranks the real unlock after it', async () => {
      // A phone two hours fast taps in, or refocuses: its claim clamps to the
      // bell, and without a bound every honest unlock that follows it would
      // read as older. A return is never later than the server recorded it.
      for (const fastAt of ['tap', 'refocus'] as const) {
        const { klass, student } = await seedClass(`late-clock-fast-${fastAt}`);
        const { session } = await startSession(db, {
          classId: klass.id,
          startedAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 25 * 60_000),
        });
        const fast = () => new Date(Date.now() + 2 * 60 * 60_000);
        const honest = () => new Date(Date.now() + 1_000);
        if (fastAt === 'tap') {
          await tapIn(db, move(session, student, fast()));
        } else {
          await tapIn(db, move(session, student, new Date()));
          await unlock(db, move(session, student, honest()));
          await refocus(db, move(session, student, fast()));
        }
        const returned = (await eventsFor(session.id)).at(-1)!;
        expect(returned.occurredAt).toEqual(session.endsAt);

        // Its clock corrected, the phone unlocks for real a moment later.
        expect(await unlock(db, move(session, student, honest())), fastAt).toMatchObject({
          outcome: 'applied',
          state: 'unlocked',
        });
      }
    });

    it('one turned back between the return and the unlock: recorded, and answered with the focus the phone shields to', async () => {
      // The one case a clock decides: turned back after the tap, the unlock
      // claims to come before it, and the server cannot tell it from a stuck
      // one. It is still on record, reason and all — and its answer names
      // the session and the focus, which the phone applies to its shields:
      // the grid's green is never over an unshielded phone.
      const { session, student } = await lesson('late-clock-back');
      await tapIn(db, move(session, student, at(10)));
      const turnedBack = { ...move(session, student, at(4)), reason: 'bathroom' as const };

      expect(await unlock(db, turnedBack)).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'superseded',
        state: 'focused',
        session: { id: session.id, endsAt: session.endsAt },
      });
      expect((await rowOf(session.id, student.id)).state).toBe('focused');
      const recorded = one(await unlocksIn(session.id));
      expect(recorded.payload).toEqual({ recorded_as: 'superseded', reason: 'bathroom' });
    });
  });
});

describe('an unlock sent under its tap (decision 11)', () => {
  // The phone taps with no signal and shields at once; the student unlocks
  // before the tap's answer comes, so the phone sends the unlock under the
  // tap's id. It is filed wherever that tap landed — or kept unattached with a
  // note when the tap has no session to file it in. Never refused, never lost.
  const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);
  /** A class in a 09:00–09:25 lesson; its student has not tapped in. */
  async function lesson(tag: string) {
    const c = await seedClass(tag);
    const w = window('2026-01-01T09:00:00Z');
    return { ...c, session: (await startSession(db, { classId: c.klass.id, ...w })).session };
  }
  const tapped = (session: { id: string }, studentId: string, eventId: string, deviceTime: Date) =>
    tapIn(db, { sessionId: session.id, studentId, eventId, deviceTime });
  const underTap = (studentId: string, tapEventId: string, deviceTime: Date, reason?: 'nurse') => ({
    tapEventId,
    studentId,
    eventId: newUuidV7(),
    deviceTime,
    ...(reason && { reason }),
  });
  const stateOf = async (sessionId: string, studentId: string) =>
    one(
      await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)),
        ),
    ).state;
  const unlocksOf = (studentId: string) =>
    db
      .select()
      .from(events)
      .where(and(eq(events.userId, studentId), eq(events.type, 'unlock')))
      .orderBy(asc(events.seq));

  it('is filed in the session its tap landed in, by its rules, clamped to its window', async () => {
    const { session, student } = await lesson('tap-unlock-filed');
    const tap = newUuidV7();
    await tapped(session, student.id, tap, at(1));
    // A clock running fast: clamped into the window it is filed in (rule 1).
    const sent = underTap(student.id, tap, at(40), 'nurse');
    expect(await unlockUnderTap(db, sent)).toMatchObject({
      outcome: 'applied',
      recordedAs: null,
      state: 'unlocked',
      session: { id: session.id },
      reason: 'nurse',
    });
    expect(await stateOf(session.id, student.id)).toBe('unlocked');
    expect(one(await unlocksOf(student.id))).toMatchObject({
      eventId: sent.eventId,
      sessionId: session.id,
      classId: session.classId,
      occurredAt: session.endsAt,
      payload: { tap_event_id: tap, reason: 'nurse' },
    });
  });

  it('is filed where the tap switched the student to, never where the phone was before', async () => {
    const { session: before, student } = await lesson('tap-unlock-switch');
    const other = await seedClass('tap-unlock-switch-to');
    await db.insert(enrollments).values({ classId: other.klass.id, studentId: student.id });
    const w = window('2026-01-01T09:00:00Z');
    const after = (await startSession(db, { classId: other.klass.id, ...w })).session;
    await tapped(before, student.id, newUuidV7(), at(1));
    const tap = newUuidV7();
    await tapped(after, student.id, tap, at(5));

    expect(await unlockUnderTap(db, underTap(student.id, tap, at(6)))).toMatchObject({
      outcome: 'applied',
      session: { id: after.id },
    });
    expect(await stateOf(after.id, student.id)).toBe('unlocked');
    expect((await unlocksOf(student.id)).map((e) => e.sessionId)).toEqual([after.id]);
  });

  it('meets the rest of that session’s rules: late, protection off, after the end', async () => {
    const { session, student } = await lesson('tap-unlock-rules');
    const tap = newUuidV7();
    await tapped(session, student.id, tap, at(1));
    // The student's own re-tap at 09:06 went ahead of an unlock made at 09:04 (A10).
    await tapped(session, student.id, newUuidV7(), at(6));
    expect(await unlockUnderTap(db, underTap(student.id, tap, at(4)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'superseded',
      state: 'focused',
    });
    await protectionOff(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: at(8),
    });
    expect(await unlockUnderTap(db, underTap(student.id, tap, at(9)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'protection_off',
      state: 'protection_off',
    });
    await endSession(db, { sessionId: session.id, at: at(20), reason: 'ended' });
    expect(await unlockUnderTap(db, underTap(student.id, tap, at(21)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'after_session_end',
      state: null,
      session: { id: session.id },
    });
  });

  it('is kept unattached, noted, when its tap was only armed — and the Start joins without it', async () => {
    const { teacher, student, klass } = await seedClass('tap-unlock-armed');
    const tap = newUuidV7();
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: tap,
      deviceTime: new Date('2026-01-01T08:57:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T08:57:00Z'),
    });
    const sent = underTap(student.id, tap, new Date('2026-01-01T08:58:00Z'), 'nurse');
    expect(await unlockUnderTap(db, sent)).toEqual({
      outcome: 'recorded',
      recordedAs: 'tap_armed',
      state: null,
      participationId: null,
      session: null,
      reason: 'nurse',
    });
    expect(one(await unlocksOf(student.id))).toMatchObject({
      sessionId: null,
      classId: null,
      payload: {
        recorded_as: 'tap_armed',
        claimed_tap_event_id: tap,
        device_time: sent.deviceTime.toISOString(),
        reason: 'nurse',
      },
    });

    // The unlock came before any session did: the Start joins the student, as
    // their tap asked, and files nothing.
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    expect(await stateOf(session.id, student.id)).toBe('focused');
    expect(await unlocksOf(student.id)).toHaveLength(1);

    // One reaching the server after the Start finds the tap landed: filed there.
    expect(await unlockUnderTap(db, underTap(student.id, tap, at(2)))).toMatchObject({
      outcome: 'applied',
      session: { id: session.id },
    });
    expect(await stateOf(session.id, student.id)).toBe('unlocked');
  });

  it('one kept while its tap was armed stays unattached when that tap lands by a retry', async () => {
    // Armed, then a Start of the teacher's other class — the student joins it
    // only afterwards, so the retry of the tap is what lands there.
    const { teacher, student, school } = await seedClass('tap-unlock-armed-retry');
    const tap = newUuidV7();
    const morning = new Date('2026-01-01T08:57:00Z');
    const expiresAt = new Date('2026-01-01T23:59:59Z');
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: tap,
      deviceTime: morning,
      expiresAt,
      now: morning,
    });
    const sent = underTap(student.id, tap, new Date('2026-01-01T08:58:00Z'));
    expect((await unlockUnderTap(db, sent)).recordedAs).toBe('tap_armed');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Other class',
          joinCode: 'JOIN-tuar-2',
        })
        .returning(),
    );
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: other.id, ...w });
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    expect(await tapped(session, student.id, tap, morning)).toMatchObject({ state: 'focused' });
    expect(await unlocksOf(student.id)).toHaveLength(1);
  });

  it('one kept before its tap arrived stays unattached when that tap arms: the Start joins without it (#77)', async () => {
    // The unlock reached the server first, with no tap of the student's on
    // record: `unknown_tap`. The tap then arrives with nothing running and
    // arms. Only a tap landing in a running session files a kept unlock; the
    // Start converts the armed tap and joins the student focused, as the
    // owner ruled for `tap_armed` — the record stays in no class.
    const { teacher, student, klass } = await seedClass('tap-unlock-unknown-then-armed');
    const tap = newUuidV7();
    const morning = new Date('2026-01-01T08:57:00Z');
    const sent = underTap(student.id, tap, new Date('2026-01-01T08:58:00Z'), 'nurse');
    expect((await unlockUnderTap(db, sent)).recordedAs).toBe('unknown_tap');
    const armed = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: tap,
      deviceTime: morning,
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: morning,
    });
    expect(armed.outcome).toBe('armed');

    const w = window('2026-01-01T09:00:00Z');
    const { session, armedConverted } = await startSession(db, { classId: klass.id, ...w });
    expect(armedConverted).toBe(1);
    expect(await stateOf(session.id, student.id)).toBe('focused');
    expect(one(await unlocksOf(student.id))).toMatchObject({
      eventId: sent.eventId,
      sessionId: null,
      classId: null,
      payload: { recorded_as: 'unknown_tap', claimed_tap_event_id: tap },
    });
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(0);
  });

  it('is kept unattached, noted, when no tap of the caller’s has that id — never in another’s session', async () => {
    const { session, student } = await lesson('tap-unlock-unknown');
    const classmate = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-tap-unlock-unknown-classmate', role: 'student' })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: session.classId, studentId: classmate.id });
    const theirs = newUuidV7();
    await tapped(session, classmate.id, theirs, at(1));

    for (const tap of [newUuidV7(), theirs]) {
      const sent = underTap(student.id, tap, at(3));
      expect(await unlockUnderTap(db, sent)).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'unknown_tap',
        state: null,
        session: null,
      });
      const kept = (await unlocksOf(student.id)).find((e) => e.eventId === sent.eventId);
      expect(kept).toMatchObject({ sessionId: null, payload: { claimed_tap_event_id: tap } });
    }
    expect(await stateOf(session.id, classmate.id)).toBe('focused');
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(0);
  });

  it('a tap landing after its unlock files it there: both arrival orders end alike', async () => {
    // The phone sends in order, but a tap stuck at its retry bound (B3a) steps
    // aside for the unlock behind it. Either way the student tapped at 09:02
    // and unlocked at 09:04, and that is what the session says — or, their
    // clock turned back between the two, unlocked "at 09:01": late (A10) in
    // both orders alike.
    for (const [minute, ends] of [
      [4, 'unlocked'],
      [1, 'focused'],
    ] as const) {
      for (const unlockFirst of [true, false]) {
        const { session, student } = await lesson(`tap-unlock-order-${minute}-${unlockFirst}`);
        const tap = newUuidV7();
        const sent = underTap(student.id, tap, at(minute), 'nurse');
        const theTap = () => tapped(session, student.id, tap, at(2));
        const late = ends === 'focused' ? { recorded_as: 'superseded' } : {};
        if (unlockFirst) {
          expect(await unlockUnderTap(db, sent)).toMatchObject({ recordedAs: 'unknown_tap' });
          expect(await theTap()).toMatchObject({ outcome: 'joined', state: ends });
        } else {
          expect(await theTap()).toMatchObject({ outcome: 'joined', state: 'focused' });
          expect(await unlockUnderTap(db, sent)).toMatchObject({ state: ends });
        }

        expect(await stateOf(session.id, student.id)).toBe(ends);
        const filed = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
        expect(filed.occurredAt).toEqual(at(minute));
        expect(filed.payload).toEqual({
          tap_event_id: tap,
          ...(unlockFirst && { unattached_event_id: sent.eventId }),
          ...late,
          reason: 'nurse',
        });
        // Each retry answers the truth now, and nothing is filed twice.
        expect(await theTap()).toMatchObject({ outcome: 'replay', state: ends });
        expect(await unlockUnderTap(db, sent)).toMatchObject({
          outcome: 'replay',
          reason: 'nurse',
          session: unlockFirst ? null : { id: session.id },
        });
        expect(await unlocksOf(student.id)).toHaveLength(unlockFirst ? 2 : 1);
      }
    }
  });

  it('a late tap files its unlock by the session’s rules: late when a later return went ahead', async () => {
    const { session, student } = await lesson('tap-unlock-late-tap');
    const tap = newUuidV7();
    const sent = underTap(student.id, tap, at(4));
    await unlockUnderTap(db, sent);
    // The student's re-tap at 09:06 lands before the 09:02 tap it came after.
    await tapped(session, student.id, newUuidV7(), at(6));
    expect(await tapped(session, student.id, tap, at(2))).toMatchObject({ state: 'focused' });
    const filed = one((await eventsFor(session.id)).filter((e) => e.type === 'unlock'));
    expect(filed.payload).toEqual({
      tap_event_id: tap,
      unattached_event_id: sent.eventId,
      recorded_as: 'superseded',
    });
  });

  it('a tap files only the unlocks its own student sent under it', async () => {
    const { session, student } = await lesson('tap-unlock-own');
    const tap = newUuidV7();
    await unlockUnderTap(db, underTap(student.id, tap, at(4)));
    // Another of the student's taps files nothing, nor a stranger reusing the id.
    await tapped(session, student.id, newUuidV7(), at(6));
    const stranger = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-tap-unlock-own-stranger', role: 'student' })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: session.classId, studentId: stranger.id });
    expect(await tapped(session, stranger.id, tap, at(7))).toMatchObject({ state: 'focused' });
    expect(await stateOf(session.id, student.id)).toBe('focused');
    expect((await eventsFor(session.id)).filter((e) => e.type === 'unlock')).toHaveLength(0);
  });

  it('is refused as any unlock is when its id is another event’s — its own tap’s, or a classmate’s', async () => {
    const { session, student } = await lesson('tap-unlock-conflict');
    const tap = newUuidV7();
    await tapped(session, student.id, tap, at(1));
    const classmate = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-tap-unlock-conflict-classmate', role: 'student' })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: session.classId, studentId: classmate.id });
    const theirs = newUuidV7();
    await tapped(session, classmate.id, newUuidV7(), at(1));
    await unlock(db, {
      sessionId: session.id,
      studentId: classmate.id,
      eventId: theirs,
      deviceTime: at(2),
    });

    for (const eventId of [tap, theirs]) {
      await expect(
        unlockUnderTap(db, { ...underTap(student.id, tap, at(3)), eventId }),
      ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    }
    expect(await unlocksOf(student.id)).toHaveLength(0);
    expect(await stateOf(session.id, student.id)).toBe('focused');
  });

  it('every tap’s look for them is one probe of their index', async () => {
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const result = await tx.execute(
        sql`explain ${unlocksAwaitingTap(tx, newUuidV7(), newUuidV7())}`,
      );
      const rows = (
        Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
      ) as Record<string, string>[];
      return rows.map((row) => Object.values(row).join(' ')).join('\n');
    });
    expect(plan, plan).toContain('events_unattached_tap_idx');
  });
});

describe('the phone’s own order decides its unlock against its return (A12)', () => {
  // The owner's ruling (2026-09-24): "The phone numbers its own actions with a
  // counter, not the clock, and the server orders a student's own unlock and
  // refocus by that counter. A tampered clock can then never undo a real
  // unlock." Compared only when both carry one from the same install; any other
  // pair keeps A10's time rule.
  const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);
  const phone = newUuidV7();
  const n = (seq: number, install = phone) => ({ install, seq });
  type Order = ReturnType<typeof n> | null;
  function move(session: { id: string }, student: { id: string }, deviceTime: Date, order: Order) {
    return {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime,
      order,
    };
  }
  /** A 09:00–09:25 lesson whose student has not tapped in. */
  async function room(tag: string) {
    const { klass, student } = await seedClass(tag);
    const w = window('2026-01-01T09:00:00Z');
    return { student, session: (await startSession(db, { classId: klass.id, ...w })).session };
  }
  /** The same, tapped in at 09:01 as the phone's #1 — or, `null`, an old build's tap. */
  async function lesson(tag: string, tapOrder: Order = n(1)) {
    const { session, student } = await room(tag);
    await tapIn(db, move(session, student, at(1), tapOrder));
    return { session, student };
  }
  async function stateOf(sessionId: string, studentId: string) {
    return one(
      await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)),
        ),
    ).state;
  }
  async function orderOf(eventId: string) {
    const row = one(
      await db
        .select({ install: events.orderInstall, seq: events.orderSeq })
        .from(events)
        .where(eq(events.eventId, eventId)),
    );
    return row.install === null ? null : row;
  }
  const unlocksIn = async (sessionId: string) =>
    (await eventsFor(sessionId)).filter((e) => e.type === 'unlock');

  it('a clock turned back between the return and a real unlock: the unlock applies', async () => {
    // A10's one clock case, closed. The phone refocused or re-tapped (#3) at
    // 09:08, then its clock went back five minutes, and its real unlock (#4)
    // claims 09:03. By the clamped times it is older than the return and would
    // be recorded as late, the phone shielded again; by its order it came last.
    for (const back of ['refocus', 'tap'] as const) {
      const { session, student } = await lesson(`order-clock-back-${back}`);
      await unlock(db, move(session, student, at(5), n(2)));
      const returned = move(session, student, at(8), n(3));
      await (back === 'refocus' ? refocus(db, returned) : tapIn(db, returned));
      const real = { ...move(session, student, at(3), n(4)), reason: 'nurse' as const };

      expect(await unlock(db, real), back).toMatchObject({
        outcome: 'applied',
        recordedAs: null,
        state: 'unlocked',
        session: { id: session.id },
        reason: 'nurse',
      });
      expect(await stateOf(session.id, student.id), back).toBe('unlocked');
      // Its time is still its clamped claim (rule 1): the order decides only
      // which of the student's two actions came last.
      const recorded = (await unlocksIn(session.id)).find((e) => e.eventId === real.eventId);
      expect(recorded, back).toMatchObject({
        occurredAt: at(3),
        payload: { reason: 'nurse' },
        orderInstall: phone,
        orderSeq: 4,
      });
    }
  });

  it('a stuck unlock older than the return by the order is late, even when its clock reads later', async () => {
    // Unlocked (#2) on a clock running five minutes fast and stuck there; the
    // phone, its clock put right, unlocked again and refocused, or re-tapped,
    // by 09:08. The stuck one lands last claiming 09:10: after the return by
    // the times — it would flip a student the phone holds in focus — and
    // before it by the order.
    for (const back of ['refocus', 'tap'] as const) {
      const { session, student } = await lesson(`order-stuck-${back}`);
      const stuck = move(session, student, at(10), n(2));
      if (back === 'refocus') {
        await unlock(db, move(session, student, at(6), n(3)));
        await refocus(db, move(session, student, at(8), n(4)));
      } else {
        await tapIn(db, move(session, student, at(8), n(3)));
      }

      expect(await unlock(db, stuck), back).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'superseded',
        state: 'focused',
      });
      expect(await stateOf(session.id, student.id), back).toBe('focused');
    }
  });

  it('another install’s return is judged by the time rule, both ways', async () => {
    // A reinstall, or another phone, starts a counter of its own: its seq says
    // nothing about this phone's, so the pair keeps A10's rule.
    const other = newUuidV7();
    // After by the times, though its seq is lower: late.
    const late = await lesson('order-installs-late');
    await unlock(db, move(late.session, late.student, at(5), n(2)));
    await refocus(db, move(late.session, late.student, at(8), n(1, other)));
    expect(await unlock(db, move(late.session, late.student, at(3), n(3)))).toMatchObject({
      recordedAs: 'superseded',
      state: 'focused',
    });
    // Before by the times, though its seq is higher: applied.
    const real = await lesson('order-installs-real');
    await unlock(db, move(real.session, real.student, at(5), n(2)));
    await refocus(db, move(real.session, real.student, at(8), n(50, other)));
    expect(await unlock(db, move(real.session, real.student, at(10), n(3)))).toMatchObject({
      outcome: 'applied',
      state: 'unlocked',
    });
  });

  it('an order on one side only: the time rule', async () => {
    // An old build's returns and a new build's unlock, or the reverse.
    for (const bare of ['returns', 'unlock'] as const) {
      const ours = (seq: number) => (bare === 'returns' ? null : n(seq));
      const unlocks = (seq: number) => (bare === 'unlock' ? null : n(seq));
      const { session, student } = await lesson(`order-one-side-${bare}`, ours(1));
      await unlock(db, move(session, student, at(5), ours(2)));
      await refocus(db, move(session, student, at(8), ours(3)));

      expect(await unlock(db, move(session, student, at(3), unlocks(9))), bare).toMatchObject({
        recordedAs: 'superseded',
        state: 'focused',
      });
      expect(await unlock(db, move(session, student, at(10), unlocks(10))), bare).toMatchObject({
        outcome: 'applied',
        state: 'unlocked',
      });
    }
  });

  it('the ended row follows the same order: late by it once the student has left, and not by the clock alone', async () => {
    const leave = async (session: { id: string }, student: { id: string }, how: string) => {
      if (how === 'bell') {
        await endSession(db, { sessionId: session.id, at: at(25), reason: 'expired' });
        return;
      }
      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(eq(enrollments.studentId, student.id));
      await endEnrollment(db, {
        enrollmentId: enrollment!.id,
        reason: 'removed_from_class',
        at: at(12),
      });
    };
    for (const how of ['bell', 'removal'] as const) {
      // Stuck (#2, claiming 09:10) while the phone re-tapped (#3) at 09:08 and
      // was shielded when it left: late by the order, whatever its clock says.
      const stuck = await lesson(`order-left-stuck-${how}`);
      const old = move(stuck.session, stuck.student, at(10), n(2));
      await tapIn(db, move(stuck.session, stuck.student, at(8), n(3)));
      await leave(stuck.session, stuck.student, how);
      expect(await unlock(db, old), how).toMatchObject({
        outcome: 'recorded',
        recordedAs: 'superseded',
        state: null,
        participationId: null,
      });

      // Re-tapped (#2) at 09:08, then the clock went back: a real unlock (#3)
      // claiming 09:03 reaches the server only after the student left. It is
      // the unlock they left on, and its note says so — not late.
      const real = await lesson(`order-left-real-${how}`);
      await tapIn(db, move(real.session, real.student, at(8), n(2)));
      await leave(real.session, real.student, how);
      expect(await unlock(db, move(real.session, real.student, at(3), n(3))), how).toMatchObject({
        outcome: 'recorded',
        recordedAs: how === 'bell' ? 'after_session_end' : 'no_live_participation',
        state: null,
      });
    }
  });

  it('protection off still comes first', async () => {
    const { session, student } = await lesson('order-protoff');
    await protectionOff(db, move(session, student, at(6), n(2)));
    // Last by the order, and still never a softening of protection off.
    expect(await unlock(db, move(session, student, at(3), n(3)))).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'protection_off',
      state: 'protection_off',
    });
  });

  it('an unlock sent under its tap on a clock turned back since: applied in both arrival orders', async () => {
    // Tapped (#1) at 09:02 with no answer yet; the clock went back, and the
    // unlock under the tap (#2) claims 09:01. By the times the tap came after
    // it — late in both orders (A11's own test); by the order it came last.
    for (const unlockFirst of [true, false]) {
      const { session, student } = await room(`order-tap-unlock-${unlockFirst}`);
      const tap = newUuidV7();
      const theTap = () =>
        tapIn(db, {
          sessionId: session.id,
          studentId: student.id,
          eventId: tap,
          deviceTime: at(2),
          order: n(1),
        });
      const sent = {
        tapEventId: tap,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at(1),
        order: n(2),
      };
      if (unlockFirst) {
        expect(await unlockUnderTap(db, sent)).toMatchObject({ recordedAs: 'unknown_tap' });
        // Kept with its order, for the tap that files it.
        expect(await orderOf(sent.eventId)).toEqual(n(2));
        expect(await theTap()).toMatchObject({ outcome: 'joined', state: 'unlocked' });
      } else {
        expect(await theTap()).toMatchObject({ outcome: 'joined', state: 'focused' });
        expect(await unlockUnderTap(db, sent)).toMatchObject({
          outcome: 'applied',
          state: 'unlocked',
        });
      }

      expect(await stateOf(session.id, student.id)).toBe('unlocked');
      const filed = one(await unlocksIn(session.id));
      expect(filed).toMatchObject({ occurredAt: at(1), orderInstall: phone, orderSeq: 2 });
      expect(filed.payload).toEqual({
        tap_event_id: tap,
        ...(unlockFirst && { unattached_event_id: sent.eventId }),
      });
    }
  });

  it('a tap filing its kept unlock finds it late when a later return went ahead by the order', async () => {
    // Tapped (#1) at 09:02, unlocked under it (#2) at 09:04, re-tapped (#3) on
    // a clock turned back to 09:03 — and the first tap lands last. By the
    // times nothing came back after 09:04; by the order the re-tap did.
    const { session, student } = await room('order-late-tap');
    const tap = newUuidV7();
    const kept = { tapEventId: tap, studentId: student.id, eventId: newUuidV7(), order: n(2) };
    await unlockUnderTap(db, { ...kept, deviceTime: at(4) });
    await tapIn(db, move(session, student, at(3), n(3)));
    const late = { ...move(session, student, at(2), n(1)), eventId: tap };

    expect(await tapIn(db, late)).toMatchObject({ outcome: 'joined', state: 'focused' });
    expect(one(await unlocksIn(session.id)).payload).toEqual({
      tap_event_id: tap,
      unattached_event_id: kept.eventId,
      recorded_as: 'superseded',
    });
  });

  it('an armed tap keeps its order, and the Start converts it with it', async () => {
    // Tapped before the bell (#1) on a clock running fast — it claims 09:03 for
    // a 09:00 Start; the clock then went back past the Start, and a real unlock
    // (#2) claims 08:50, clamped to 09:00. By the times the converted tap came
    // after it; by the order it did not.
    const { teacher, student, klass } = await seedClass('order-armed');
    const arm = (eventId: string, seq: number, now: string, expiresAt: string) =>
      armTap(db, {
        studentId: student.id,
        teacherId: teacher.id,
        eventId,
        deviceTime: at(3),
        order: n(seq),
        expiresAt: new Date(expiresAt),
        now: new Date(now),
      });
    // A waiting tap gone stale is taken over by the next, order and all.
    await arm(newUuidV7(), 1, '2026-01-01T07:00:00Z', '2026-01-01T08:00:00Z');
    const tap = newUuidV7();
    const taken = await arm(tap, 2, '2026-01-01T08:58:00Z', '2026-01-01T23:59:59Z');
    expect(taken.outcome).toBe('armed');

    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    expect(await orderOf(tap)).toEqual(n(2));
    const real = move(session, student, new Date('2026-01-01T08:50:00Z'), n(3));
    expect(await unlock(db, real)).toMatchObject({ outcome: 'applied', state: 'unlocked' });
  });

  it('a retry is answered where it was recorded, and its order is not written again', async () => {
    const { session, student } = await lesson('order-replay');
    await tapIn(db, move(session, student, at(8), n(2)));
    const real = move(session, student, at(3), n(3));
    expect((await unlock(db, real)).outcome).toBe('applied');

    for (const order of [n(1), null]) {
      expect(await unlock(db, { ...real, order })).toMatchObject({
        outcome: 'replay',
        state: 'unlocked',
      });
    }
    expect(await orderOf(real.eventId)).toEqual(n(3));
    expect(await unlocksIn(session.id)).toHaveLength(1);
  });

  it('is kept with every event the phone numbered, and one the engine cannot compare as none', async () => {
    const { session, student } = await lesson('order-kept');
    const refocused = move(session, student, at(4), n(2));
    await refocus(db, refocused);
    const reported = move(session, student, at(5), n(3));
    await protectionOff(db, reported);
    const [tapped] = (await eventsFor(session.id)).filter((e) => e.type === 'tap_in');
    expect(await orderOf(tapped!.eventId)).toEqual(n(1));
    expect(await orderOf(refocused.eventId)).toEqual(n(2));
    expect(await orderOf(reported.eventId)).toEqual(n(3));

    // Recorded all the same, with no order: an unlock is never refused for one.
    for (const odd of [
      { install: 'phone', seq: 4 },
      { install: phone, seq: 0 },
      { install: phone, seq: 2 ** 53 },
      { install: phone, seq: '5' },
    ]) {
      const sent = move(session, student, at(6), odd as never);
      expect((await unlock(db, sent)).outcome, JSON.stringify(odd)).toBe('recorded');
      expect(await orderOf(sent.eventId), JSON.stringify(odd)).toBeNull();
    }
  });
});

describe('checkIn', () => {
  it('updates last_seen_at without adding an event (decision 7)', async () => {
    const { klass, student } = await seedClass('checkin');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    const before = (await eventsFor(session.id)).length;

    const r = await checkIn(db, {
      sessionId: session.id,
      studentId: student.id,
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });
    expect(r.status).toBe('live');
    expect(r.state).toBe('focused');
    expect((await eventsFor(session.id)).length).toBe(before);
    const live = one(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    );
    // last_seen_at is the server's observation, never the device's claim: the
    // heartbeat carries a 2026-01-01 device time and the row still records when
    // this process actually heard from the phone.
    expect(live.lastSeenAt).not.toBeNull();
    expect(live.lastSeenAt!.getTime()).toBeGreaterThan(new Date('2026-01-02T00:00:00Z').getTime());
    expect(Math.abs(Date.now() - live.lastSeenAt!.getTime())).toBeLessThan(60_000);
  });

  it('reports gone when there is no live participation', async () => {
    const { klass, student } = await seedClass('checkin-gone');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const r = await checkIn(db, {
      sessionId: session.id,
      studentId: student.id,
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });
    expect(r.status).toBe('gone');
  });
});

describe('extendSession', () => {
  it('moves the end time forward and logs session_extended', async () => {
    const { klass } = await seedClass('extend');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    const newEnd = new Date(w.endsAt.getTime() + 10 * 60_000);

    const updated = await extendSession(db, {
      sessionId: session.id,
      durationMinutes: 10,
      at: new Date('2026-01-01T09:20:00Z'),
    });
    expect(updated.endsAt.toISOString()).toBe(newEnd.toISOString());
    expect((await eventsFor(session.id)).some((e) => e.type === 'session_extended')).toBe(true);
  });

  it('gives a session past its end but not yet swept a window starting from now', async () => {
    // The other half of `base = max(at, endsAt)`, which moved from the route
    // into the locked read with this change. The expiry sweep runs once a
    // minute, so a teacher can press "add time" on a session whose end has
    // just passed. Adding to the stale end would hand back a new end that is
    // STILL in the past — the shield never comes back and the press looks
    // like it did nothing.
    const { klass } = await seedClass('extend-late');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });

    const at = new Date('2026-01-01T09:25:30Z'); // 30s past the 09:25 end
    const updated = await extendSession(db, { sessionId: session.id, durationMinutes: 10, at });

    expect(updated.endsAt.toISOString()).toBe(new Date(at.getTime() + 10 * 60_000).toISOString());
    expect(updated.endsAt.getTime()).toBeGreaterThan(at.getTime());
  });

  it('refuses an extension that would not move the end forward', async () => {
    // Taking a duration instead of an absolute end makes "not later than the
    // current end" unreachable for any positive number of minutes, which is
    // the point. What remains reachable is a caller passing a non-positive
    // or non-finite duration, and the engine still refuses that rather than
    // trusting it.
    const { klass } = await seedClass('extend-bad');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    // Four shapes, and the middle one is the point. 0 and -10 are not
    // durations; NaN and Infinity are not numbers. `MAX_SESSION_MINUTES + 1`
    // and 1e6 are both perfectly finite, positive minutes that no school could
    // mean — 1e6 ends the lesson in 2028 — and before the engine carried the
    // same bound as the route's zod cap, only `/v1` refused them. 1e15 used to
    // be the shape past even that, reaching the Date-range guard; the bound
    // now rejects it two lines earlier, so it is kept here only as the
    // largest absurd value, and the range guard has its own test above.
    for (const durationMinutes of [
      0,
      -10,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_SESSION_MINUTES + 1,
      1e6,
      1e15,
    ]) {
      await expect(
        extendSession(db, {
          sessionId: session.id,
          durationMinutes,
          at: new Date('2026-01-01T09:10:00Z'),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
    }
    // And the end really did not move.
    const after = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(after.endsAt.toISOString()).toBe(w.endsAt.toISOString());
  });

  it('refuses an extension that would push the end past the Date range', async () => {
    /*
     * The guard that MAX_SESSION_MINUTES made unreachable from the direction
     * its old test came at it: `1e15` minutes used to land here, and now the
     * duration check two lines above rejects it first. What still reaches it
     * is the case the guard was really for — `base` is `max(at, endsAt)` and
     * `endsAt` comes from the STORED session, so a row already near the JS
     * `Date` boundary overflows on a perfectly legal ten-minute press.
     * Unguarded, `newEndsAt` is an Invalid Date and `toISOString()` throws a
     * bare `RangeError`: an unmapped 500, where the point of these checks is
     * that the engine refuses its caller in its own vocabulary.
     *
     * The near-boundary end goes in through raw SQL, and it has to. A JS
     * `Date` past year 9999 serialises as `+275760-09-12T23:59:00.000Z`, and
     * Postgres rejects the `+`-prefixed extended year outright (22009,
     * DateTimeParseError) — so the driver can READ such a value back as a
     * valid Date but cannot write one. Writing `sessions` directly is fine
     * here; the engine-only rule covers `participations` and `events`.
     */
    const { klass } = await seedClass('extend-overflow');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await db.execute(
      sql`update sessions set ends_at = '275760-09-12 23:59:00+00' where id = ${session.id}`,
    );
    const nearMax = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
    // One minute below Date's max, and still a valid Date — assert it, or a
    // driver change that returns a string here would make the refusal below
    // pass for the wrong reason.
    expect(nearMax.endsAt.getTime()).toBe(8_640_000_000_000_000 - 60_000);

    await expect(
      extendSession(db, {
        sessionId: session.id,
        durationMinutes: 10, // well inside MAX_SESSION_MINUTES
        at: new Date('2026-01-01T09:10:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EXTENSION' });

    const after = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(after.endsAt.getTime()).toBe(nearMax.endsAt.getTime());
  });

  it('a replay after the session has ended returns current truth, not SESSION_NOT_RUNNING', async () => {
    // A lost 200 on an extend that did commit: the phone retries, and by then
    // the bell has rung. Rule 4 says re-read and answer with the truth — the
    // old ordering threw 409 here and left the client unable to tell whether
    // its extend had landed.
    const { klass } = await seedClass('extend-replay-ended');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    const newEnd = new Date(w.endsAt.getTime() + 10 * 60_000);
    const eventId = newUuidV7();
    await extendSession(db, {
      sessionId: session.id,
      durationMinutes: 10,
      at: new Date('2026-01-01T09:20:00Z'),
      eventId,
    });
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:35:00Z'),
      reason: 'ended',
    });

    const replay = await extendSession(db, {
      sessionId: session.id,
      durationMinutes: 10,
      at: new Date('2026-01-01T09:36:00Z'),
      eventId,
    });
    expect(replay.endsAt.toISOString()).toBe(newEnd.toISOString());
    expect((await eventsFor(session.id)).filter((e) => e.type === 'session_extended')).toHaveLength(
      1,
    );
  });

  it('refuses an event_id already spent on a different event instead of reporting a phantom extend', async () => {
    // insertEvent de-dupes on event_id, so treating a foreign id as a replay
    // (or carrying on past it) would move the end time with no matching event
    // row — the session and its history disagreeing, which is the one thing
    // this engine exists to prevent. It must be a loud refusal (rule 5).
    const { klass, student } = await seedClass('extend-id-reuse');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    await expect(
      extendSession(db, {
        sessionId: session.id,
        durationMinutes: 10,
        at: new Date('2026-01-01T09:20:00Z'),
        eventId,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    // The end time did not move, and no session_extended row was written.
    const after = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
    expect(after.endsAt.toISOString()).toBe(w.endsAt.toISOString());
    expect((await eventsFor(session.id)).filter((e) => e.type === 'session_extended')).toHaveLength(
      0,
    );
  });
});

describe('endSession & expiry', () => {
  it('ends the session and all live participations in one go', async () => {
    const { klass, student } = await seedClass('end');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    const result = await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:25:00Z'),
      reason: 'ended',
    });
    expect(result.ended).toBe(true);
    expect(result.endedParticipations).toBe(1);
    const part = one(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    );
    expect(part.endedReason).toBe('session_ended');
    expect((await eventsFor(session.id)).some((e) => e.type === 'session_ended')).toBe(true);
  });

  it('ending an already-ended session is a no-op (idempotent)', async () => {
    const { klass } = await seedClass('end-twice');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:25:00Z'),
      reason: 'ended',
    });
    const second = await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:26:00Z'),
      reason: 'ended',
    });
    expect(second.ended).toBe(false);
    expect((await eventsFor(session.id)).filter((e) => e.type === 'session_ended')).toHaveLength(1);
  });

  it('expireDueSessions ends only sessions past their end time, and is idempotent', async () => {
    const due = await seedClass('expire-due');
    const notDue = await seedClass('expire-open');
    const sessionDue = (
      await startSession(db, { classId: due.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    const sessionOpen = (
      await startSession(db, { classId: notDue.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    // A student in the due session, so the expiry path's participation reason is pinned.
    await tapIn(db, {
      sessionId: sessionDue.id,
      studentId: due.student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    const now = new Date('2026-01-01T09:30:00Z'); // past sessionDue's 09:25 end, but both share it...
    // Give the open one a later window so it isn't due.
    await extendSession(db, {
      sessionId: sessionOpen.id,
      durationMinutes: 35, // 09:25 -> 10:00
      at: new Date('2026-01-01T09:10:00Z'),
    });

    const endedIds = await expireDueSessions(db, now);
    expect(endedIds).toContain(sessionDue.id);
    expect(endedIds).not.toContain(sessionOpen.id);

    // Running again ends nothing new.
    const again = await expireDueSessions(db, now);
    expect(again).not.toContain(sessionDue.id);
    const expiredEvents = (await eventsFor(sessionDue.id)).filter(
      (e) => e.type === 'session_expired',
    );
    expect(expiredEvents).toHaveLength(1);
    // The child participation ended as session_expired (not session_ended) —
    // reports branch on this.
    const part = one(
      await db.select().from(participations).where(eq(participations.sessionId, sessionDue.id)),
    );
    expect(part.endedReason).toBe('session_expired');
  });
});

describe('armed taps', () => {
  it('arms a tap when no session is running, and its retry says it still waits', async () => {
    const { teacher, student } = await seedClass('arm');
    const eventId = newUuidV7();
    const req = {
      studentId: student.id,
      teacherId: teacher.id,
      eventId,
      deviceTime: new Date('2026-01-01T07:58:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T08:00:00Z'), // the waiting tap is still valid
    };
    const first = await armTap(db, req);
    expect(first.outcome).toBe('armed');
    // Idempotent, and answered as armed (A4): a phone that lost the first
    // answer learns it waits for Start. `replay` told it only "recorded", and
    // the truth it then re-reads (`GET /v1/me`) cannot say it is waiting.
    const retry = await armTap(db, req);
    expect(retry.outcome).toBe('already_armed');
    expect(retry.armedTapId).toBe(first.armedTapId);
    // A different eventId for the same student+teacher doesn't pile up.
    const second = await armTap(db, { ...req, eventId: newUuidV7() });
    expect(second.outcome).toBe('already_armed');
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.studentId, student.id));
    expect(rows).toHaveLength(1);
  });

  it('the retry of an armed tap past its school day is only a replay: nothing waits for it', async () => {
    // `already_armed` is for a tap that will still convert. An expired row
    // never does (convertArmedTaps skips it), so answering it as armed would
    // show "waiting for your teacher" for a tap no Start will honour.
    const { teacher, student } = await seedClass('arm-retry-expired');
    const req = {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T07:58:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T08:00:00Z'),
    };
    const first = await armTap(db, req);
    expect(first.outcome).toBe('armed');

    // The phone was offline overnight; the retry arrives the next morning.
    const retry = await armTap(db, { ...req, now: new Date('2026-01-02T08:00:00Z') });
    expect(retry).toEqual({ outcome: 'replay', armedTapId: first.armedTapId });
  });

  it('the retry of an armed tap whose id landed meanwhile is only a replay: no Start will honour it', async () => {
    /*
     * From #62's review. The tap arms (the student is not in the running
     * class yet) and its answer is lost; the student joins the class, and the
     * next delivery of the same id resolves to the running session and lands
     * as a `tap_in`; that session ends. The waiting row still stands under the
     * id — unconsumed, unexpired — but the next Start skips it
     * (`armed_tap_skipped`), so answering `already_armed` would show "waiting
     * for your teacher" for a tap no Start will join. It must stay `replay`,
     * and the phone re-reads the truth.
     *
     * Answered by armTap's `events` lookup, which runs before the `exact`
     * read; `answerOwnArmedTap` asks `rowIsStale` as well, for the same id
     * recorded between those two reads — a race nothing can stage.
     */
    const { teacher, student, klass } = await seedClass('arm-retry-landed');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const tap = {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T09:01:00Z'),
    };
    const armed = await armTap(db, tap);
    expect(armed.outcome).toBe('armed');
    expect(
      (
        await tapIn(db, {
          sessionId: session.id,
          studentId: student.id,
          eventId: tap.eventId,
          deviceTime: tap.deviceTime,
        })
      ).outcome,
    ).toBe('joined');
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'ended',
    });

    expect(await armTap(db, { ...tap, now: new Date('2026-01-01T09:30:00Z') })).toEqual({
      outcome: 'replay',
    });
    // The row still stands, and the next Start skips it rather than join.
    const next = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T10:00:00Z'),
    });
    expect(next.armedConverted).toBe(0);
    const skipped = one(
      (await eventsFor(next.session.id)).filter((e) => e.type === 'armed_tap_skipped'),
    );
    expect(skipped.payload).toEqual({ armed_tap_event_id: tap.eventId });
  });

  it('a waiting tap becomes a focused participation at session start (decision 5)', async () => {
    const { teacher, student, klass } = await seedClass('arm-convert');
    const armEventId = newUuidV7();
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: armEventId,
      deviceTime: new Date('2026-01-01T08:58:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
    });

    const { session, armedConverted } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    expect(armedConverted).toBe(1);

    // A focused participation exists, and the deferred tap_in carries the armed
    // tap's event id (so a later phone retry dedupes), clamped into the window.
    const part = one(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    );
    expect(part.state).toBe('focused');
    expect(part.studentId).toBe(student.id);
    const tapEvent = one((await eventsFor(session.id)).filter((e) => e.type === 'tap_in'));
    expect(tapEvent.eventId).toBe(armEventId);
    expect(tapEvent.occurredAt.toISOString()).toBe('2026-01-01T09:00:00.000Z'); // clamped to start
    // The armed tap is consumed and won't convert again.
    const consumed = one(
      await db.select().from(armedTaps).where(eq(armedTaps.eventId, armEventId)),
    );
    expect(consumed.consumedAt).not.toBeNull();
    // A tap that converts is a join, not a skip: `armed_tap_skipped` is only
    // for a tap declined because it had already landed.
    expect((await eventsFor(session.id)).map((e) => e.type)).not.toContain('armed_tap_skipped');
  });

  it('a refreshed arm replaces an expired waiting tap instead of swallowing it', async () => {
    const { teacher, student } = await seedClass('arm-refresh');
    const stale = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T07:00:00Z'),
      expiresAt: new Date('2026-01-01T07:30:00Z'),
      now: new Date('2026-01-01T07:00:00Z'),
    });
    // Next day's tap, after the stale one has expired.
    const fresh = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-02T07:58:00Z'),
      expiresAt: new Date('2026-01-02T23:59:59Z'),
      now: new Date('2026-01-02T07:58:00Z'),
    });
    expect(fresh.outcome).toBe('armed');
    expect(fresh.armedTapId).toBe(stale.armedTapId); // same row, refreshed in place
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.studentId, student.id));
    expect(rows).toHaveLength(1);
    expect(one(rows).expiresAt.toISOString()).toBe('2026-01-02T23:59:59.000Z');
  });

  it('conversion ends a student who is live in another session (decision 4, no crash)', async () => {
    // Student armed for teacher B, then joined teacher A's running session. When
    // B starts, the conversion must end the A participation, not violate the
    // one-live-per-student index and 500 the whole Start.
    const a = await seedClass('arm-cross-a');
    const b = await seedClass('arm-cross-b');
    // The A student is also enrolled in B's class and taps B's block early.
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });
    await armTap(db, {
      studentId: a.student.id,
      teacherId: b.teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T08:58:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
    });
    // Then A starts and the student joins A's session.
    const sessionA = (
      await startSession(db, { classId: a.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    await tapIn(db, {
      sessionId: sessionA.id,
      studentId: a.student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    // B starts: converting the armed tap must succeed and end the A participation.
    const startB = await startSession(db, {
      classId: b.klass.id,
      ...window('2026-01-01T09:05:00Z'),
    });
    expect(startB.armedConverted).toBe(1);
    const live = await db
      .select()
      .from(participations)
      .where(and(eq(participations.studentId, a.student.id), isNull(participations.endedAt)));
    expect(live).toHaveLength(1);
    expect(one(live).sessionId).toBe(startB.session.id);
    const partA = one(
      await db.select().from(participations).where(eq(participations.sessionId, sessionA.id)),
    );
    expect(partA.endedReason).toBe('left_for_other_session');
    // A switch is still a join: no `armed_tap_skipped` for a tap that converts.
    expect((await eventsFor(startB.session.id)).map((e) => e.type)).not.toContain(
      'armed_tap_skipped',
    );
  });

  it('mints a converted tap_in BEFORE the leave it causes, and both at one stamp', async () => {
    /*
     * Written down in four places and asserted in none, until this. Inside one
     * Start, `convertArmedTaps` mints the `tap_in` before
     * `endParticipationsElsewhere`, so the join carries a LOWER `seq` than the
     * `left_for_other_session` it causes. That order is forced rather than
     * incidental — a skipped tap must never end a participation, so the event
     * is minted first and the skip decided on it.
     *
     * It is also the whole reason the student's cross-session timeline cannot
     * be ordered by either column alone: `seq` is inverted here, and
     * `occurred_at` ties, because the engine stamps ONE value on the pair.
     * Both halves are asserted below, since the second is what makes the first
     * unfixable by the obvious tiebreak.
     *
     * Unpinned, this shape could have drifted, and the note on
     * `events_user_occurred_idx` would describe an ordering that no longer
     * held — which is how every other stale claim in this audit happened.
     * `GET /v1/me/history` (A7) now orders the pair by an explicit tiebreak
     * that holds whichever way `seq` runs; its tests pin the order a student
     * sees.
     */
    const a = await seedClass('seq-order-a');
    const b = await seedClass('seq-order-b');
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });
    await armTap(db, {
      studentId: a.student.id,
      teacherId: b.teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T08:58:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
    });
    const sessionA = (
      await startSession(db, { classId: a.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    await tapIn(db, {
      sessionId: sessionA.id,
      studentId: a.student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    const startB = await startSession(db, {
      classId: b.klass.id,
      ...window('2026-01-01T09:05:00Z'),
    });
    expect(startB.armedConverted).toBe(1);

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.userId, a.student.id))
      .orderBy(asc(events.seq));
    const joined = one(
      rows.filter((e) => e.type === 'tap_in' && e.sessionId === startB.session.id),
    );
    const left = one(rows.filter((e) => e.type === 'left_for_other_session'));

    expect(
      joined.seq,
      'the converted tap_in must carry a LOWER seq than the left_for_other_session it ' +
        'causes: convertArmedTaps mints the event first so a skipped tap never ends a ' +
        'participation. If this flipped, the note on events_user_occurred_idx is describing the ' +
        'wrong shape',
    ).toBeLessThan(left.seq);

    expect(
      joined.occurredAt.toISOString(),
      'the pair must share one occurred_at — that tie is why seq cannot simply be the ' +
        'tiebreak for the cross-session timeline',
    ).toBe(left.occurredAt.toISOString());
  });

  it("refuses to arm under another student's event id", async () => {
    /*
     * The id identifies one tap by one student. Answering `replay` for a
     * stranger's id would hand back their row and tell this phone's outbox the
     * tap is durably recorded — so it drops a tap that was never armed, never
     * converts, and the student is silently absent from the grid at Start.
     * `insertEvent` refuses the same class of reuse ("a student's app is an
     * adversary here"); arming holds the same line.
     */
    const { teacher, student, school } = await seedClass('arm-other-id');
    const classmate = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-arm-other-id-2', role: 'student', schoolId: school.id })
        .returning(),
    );
    const theirs = newUuidV7();
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: theirs,
      deviceTime: new Date('2026-01-01T08:50:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
    });

    await expect(
      armTap(db, {
        studentId: classmate.id,
        teacherId: teacher.id,
        eventId: theirs,
        deviceTime: new Date('2026-01-01T08:51:00Z'),
        expiresAt: new Date('2026-01-01T23:59:59Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    // And nothing of the classmate's was written.
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.studentId, classmate.id));
    expect(rows).toHaveLength(0);
  });

  it('does not arm an id that already landed — it says the tap was recorded', async () => {
    /*
     * The half the standing-row check does not reach, and it needs no race and
     * no second tap.
     *
     * 09:01 the student taps into period 1; `tap_in` E commits and the 200 is
     * lost, so the outbox keeps E. The bell ends the session. 09:30 the outbox
     * retries, nothing of that teacher's is running, so the route arms — and
     * before this check there was no armed row under E and no standing row, so
     * the insert landed and the phone was answered `armed`. At the 10:00 Start
     * the conversion declines that row (its id is spent) and joins nobody.
     * Told "ready", joined never.
     *
     * The tap DID land, so the honest answer is `replay` and no waiting row.
     */
    const { klass, teacher, student } = await seedClass('arm-spent-incoming');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'ended',
    });

    const retry = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T09:30:00Z'),
    });
    expect(retry.outcome).toBe('replay');
    expect(retry.armedTapId).toBeUndefined();

    // Nothing waiting, so the next Start has nothing to throw away.
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.studentId, student.id));
    expect(rows).toHaveLength(0);
  });

  it('refuses to arm under an id already recorded for another student', async () => {
    // Same rule as the armed_taps lookup, one table over: an id on record
    // against someone else is not this phone's replay, and answering one would
    // tell this outbox a tap it never made is durably recorded.
    const { klass, teacher, student, school } = await seedClass('arm-spent-other');
    const classmate = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-arm-spent-other-2', role: 'student', schoolId: school.id })
        .returning(),
    );
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    await expect(
      armTap(db, {
        studentId: classmate.id,
        teacherId: teacher.id,
        eventId,
        deviceTime: new Date('2026-01-01T09:02:00Z'),
        expiresAt: new Date('2026-01-01T23:59:59Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.studentId, classmate.id));
    expect(rows).toHaveLength(0);
  });

  it('will not launder an unlock id into an arming replay', async () => {
    /*
     * The `events` guard matches on TYPE as well as caller, which is what
     * `insertEvent` does and what its comment ("a student's app is an
     * adversary here") is about. On the student alone, a phone reusing one of
     * its OWN ids across actions — an `unlock` id sent again as a tap — reads
     * as this tap's replay: no armed row, no `tap_in`, and an outbox told the
     * tap is durably recorded, so it deletes it. The silent lost tap this
     * guard exists to stop, arrived by the other door.
     */
    const { klass, teacher, student } = await seedClass('arm-unlock-id');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    const unlockId = newUuidV7();
    await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: unlockId,
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    await endSession(db, {
      sessionId: session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'ended',
    });

    await expect(
      armTap(db, {
        studentId: student.id,
        teacherId: teacher.id,
        eventId: unlockId,
        deviceTime: new Date('2026-01-01T09:30:00Z'),
        expiresAt: new Date('2026-01-01T23:59:59Z'),
        now: new Date('2026-01-01T09:30:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.eventId, unlockId));
    expect(rows).toHaveLength(0);
  });

  it("will not answer a tap on one teacher's block with a row held for another", async () => {
    /*
     * Two readings, one behaviour, and this pins it for both. The benign one
     * is a block that moved: blocks are reassignable by design, so a retry
     * after the move is the student's OWN id for their own tap and this 409
     * is wrong for it — unreachable today, disclosed at the call site, and
     * fixed with the endpoint that makes blocks movable. The one it was added
     * for follows.
     *
     * The `armed_taps` event-id lookup was scoped to the student but not the
     * teacher. A student holding a waiting row for teacher X under id E who
     * then taps
     * teacher Y's block carrying E was handed X's row back as `replay`: the
     * outbox is told the tap is durably recorded, nothing is armed for Y, and
     * Y's Start converts nothing. Same "hand back a row that is not this tap"
     * failure the student scoping closes, one axis over.
     */
    const { teacher, student, school } = await seedClass('arm-other-teacher');
    const otherTeacher = one(
      await db
        .insert(users)
        .values({ cognitoId: 'teacher-arm-other-teacher-2', role: 'teacher', schoolId: school.id })
        .returning(),
    );
    const eventId = newUuidV7();
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId,
      deviceTime: new Date('2026-01-01T08:50:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
    });

    await expect(
      armTap(db, {
        studentId: student.id,
        teacherId: otherTeacher.id,
        eventId,
        deviceTime: new Date('2026-01-01T08:51:00Z'),
        expiresAt: new Date('2026-01-01T23:59:59Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    // And the row that does exist still belongs to the teacher it was for.
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.teacherId).toBe(teacher.id);
  });

  it('refuses an id spent under another teacher, as tapIn does', async () => {
    /*
     * The `events` lookup is scoped to the teacher as well as the student and
     * the type (item 5 of the 2026-09-22 ruling), like the `armed_taps` lookup
     * below it. Before, an id already recorded as this student's `tap_in`
     * under teacher A read as this phone's replay whoever's block it arrived
     * on: teacher B armed nothing, the outbox was told the tap was durably
     * recorded and deleted it, and B's Start converted nobody while the
     * student stood at B's block — a rule 5 silent drop.
     *
     * It was also looser than `insertEvent`'s replay key (type + session +
     * user), so one reuse got two answers on nothing the client controls: a
     * 409 when B had a session running that the student is enrolled in (the
     * tap routes to `tapIn`, which refuses the spent id — asserted below), a
     * silent 200 here in every other shape. Once the first session is over,
     * as here, both answers are the 409 now and the outbox keeps the record.
     * While it is still live, `tapIn` replays it instead (its replay is keyed
     * on student and type — tap step 10) and this path still refuses: the one
     * split left, recorded in PLAN.md. A4 keeps the 409 here on both paths: a
     * tap recorded but no longer current replays with no session only under
     * the teacher it was recorded with. Under another it is not this tap's
     * retry (tap step 9), and a 200 would drop a physical tap at B's block —
     * so `tapIn`'s half goes red if its teacher check is removed.
     *
     * Only the cross-teacher half. The SAME teacher, an id spent in an earlier
     * session of theirs, still answers `replay` here — "does not arm an id
     * that already landed" pins it — because that is also exactly what the
     * honest retry of a lost 200 looks like, and telling the two apart needs a
     * session scope `armTap` does not have: no session the student can join is
     * running, which is why the call reached it.
     */
    const { student, klass, school } = await seedClass('arm-spent-cross');
    const otherTeacher = one(
      await db
        .insert(users)
        .values({ cognitoId: 'teacher-arm-spent-cross-2', role: 'teacher', schoolId: school.id })
        .returning(),
    );
    const otherClass = one(
      await db
        .insert(classes)
        .values({
          teacherId: otherTeacher.id,
          schoolId: school.id,
          name: 'Class arm-spent-cross-2',
          joinCode: 'JOIN-ARMX2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: otherClass.id, studentId: student.id });

    // 09:01, the tap lands in teacher A's period and the 200 is lost.
    const first = await startSession(db, { classId: klass.id, ...window('2026-01-01T09:00:00Z') });
    const spent = newUuidV7();
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: spent,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    await endSession(db, {
      sessionId: first.session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'ended',
    });

    // 09:55, teacher B's block, nothing of B's running, under the spent id.
    await expect(
      armTap(db, {
        studentId: student.id,
        teacherId: otherTeacher.id,
        eventId: spent,
        deviceTime: new Date('2026-01-01T09:55:00Z'),
        expiresAt: new Date('2026-01-01T23:59:59Z'),
        now: new Date('2026-01-01T09:55:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    const waiting = await db.select().from(armedTaps).where(eq(armedTaps.studentId, student.id));
    expect(waiting).toHaveLength(0);

    // And the other door gives the same answer: at 10:00 B is running a
    // session the student is enrolled in, so the tap routes to `tapIn`.
    const running = await startSession(db, {
      classId: otherClass.id,
      ...window('2026-01-01T10:00:00Z'),
    });
    await expect(
      tapIn(db, {
        sessionId: running.session.id,
        studentId: student.id,
        eventId: spent,
        deviceTime: new Date('2026-01-01T10:01:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
  });

  it('refuses an id recorded with no class at all, rather than arming it', async () => {
    /*
     * Why the teacher scope is a LEFT join. `events` has no teacher column, so
     * the lookup reaches `classes.teacher_id` through `events.class_id` — and
     * that column is nullable. An orphan unlock (an unlock claiming a session
     * that does not exist) records with no session and no class. An INNER
     * join drops that row, the lookup reads "id unused", and the phone's own
     * unlock id is armed as a tap: told `armed`, and the next Start converts
     * it under a fresh id. The same laundering "will not launder an unlock id
     * into an arming replay" stops, through the join.
     */
    const { teacher, student } = await seedClass('arm-classless');
    const orphanId = newUuidV7();
    const orphan = await unlock(db, {
      sessionId: newUuidV7(),
      studentId: student.id,
      eventId: orphanId,
      deviceTime: new Date('2026-01-01T08:40:00Z'),
    });
    expect(orphan.outcome).toBe('recorded');
    const recorded = one(await db.select().from(events).where(eq(events.eventId, orphanId)));
    expect(recorded.classId).toBeNull();

    await expect(
      armTap(db, {
        studentId: student.id,
        teacherId: teacher.id,
        eventId: orphanId,
        deviceTime: new Date('2026-01-01T08:50:00Z'),
        expiresAt: new Date('2026-01-01T23:59:59Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.eventId, orphanId));
    expect(rows).toHaveLength(0);
  });

  it('a fresh tap takes over a standing row whose id is already spent', async () => {
    /*
     * The other half of skipping a spent armed tap, and without it the skip is
     * a silent failure on the path decision 5 exists to protect.
     *
     * Alice taps into period 1; the 200 is lost, so her outbox keeps the id.
     * Between periods the retry arms that spent id. She then physically taps
     * again for period 2 with a fresh id — and the standing row swallowed it:
     * `already_armed`, the new id dropped on the floor, and at Start the
     * conversion skipped the spent row. Told "armed" twice, joined never, and
     * the fresh tap recorded nowhere. Reproduced.
     *
     * A standing row whose id is spent is stale for the same reason an expired
     * one is — the conversion will not honour it — so the fresh tap takes the
     * slot.
     */
    const { teacher, student, klass, school } = await seedClass('arm-superseded');
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Period 2',
          joinCode: 'ARMSUP2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: second.id, studentId: student.id });

    const first = await startSession(db, { classId: klass.id, ...window('2026-01-01T09:00:00Z') });
    const spent = newUuidV7();
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: spent,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    await endSession(db, {
      sessionId: first.session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'ended',
    });
    // The stale retry's row, written directly — and that IS this test, not a
    // shortcut around it. It used to stage through `armTap`, but the
    // incoming-id guard added in this same PR answers that call `replay` and
    // writes no row at all: the standing row this test is named for stopped
    // existing, the retap below took the ordinary empty-slot path, and every
    // assertion still passed with `rowIsStale`'s spent branch deleted.
    // Measured, on the lane that matters — under that mutation the whole
    // PGlite suite stayed green, so this branch had no cover there at all.
    //
    // Direct is also the honest staging: a row like this is one an older
    // deploy against the same database left behind, or one armed before that
    // guard shipped, which is the entire population the staleness rule is for.
    // Writing `armed_taps` here is allowed — transient table, not
    // participations or events.
    one(
      await db
        .insert(armedTaps)
        .values({
          studentId: student.id,
          teacherId: teacher.id,
          eventId: spent,
          deviceTime: new Date('2026-01-01T09:01:00Z'),
          expiresAt: new Date('2026-01-01T23:59:59Z'),
        })
        .returning(),
    );

    // She taps the block again, for real, well before the row would expire.
    const fresh = newUuidV7();
    const retap = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: fresh,
      deviceTime: new Date('2026-01-01T09:55:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T09:55:00Z'),
    });
    expect(retap.outcome).toBe('armed');

    const next = await startSession(db, { classId: second.id, ...window('2026-01-01T10:00:00Z') });
    expect(next.armedConverted).toBe(1);
    const joined = one(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, next.session.id),
            eq(participations.studentId, student.id),
          ),
        ),
    );
    expect(joined.state).toBe('focused');
    // Joined under the tap she actually made, not the spent one.
    const tapIns = (await eventsFor(next.session.id)).filter((e) => e.type === 'tap_in');
    expect(tapIns.map((e) => e.eventId)).toEqual([fresh]);
  });

  it('does not convert an expired armed tap', async () => {
    const { teacher, student, klass } = await seedClass('arm-expired');
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T08:00:00Z'),
      expiresAt: new Date('2026-01-01T08:30:00Z'), // already past by session start
    });
    const { armedConverted } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    expect(armedConverted).toBe(0);
  });

  it('a spent event id never wedges the next Start, and never joins a later one', async () => {
    /*
     * The worst thing in this area, and it needed no race to reach. A tap
     * lands in a session, its response is lost, the bell ends the session,
     * and the phone's outbox retries. Nothing of that teacher's is running,
     * so the route ARMED the retry — `armTap` de-duped only against
     * `armed_taps.event_id`, so a spent id was accepted. It refuses one now
     * (below), which is why the row is staged directly.
     *
     * Converting it is wrong both ways, and both were reproduced. Under the
     * spent id, `insertEvent` refuses inside `startSession`'s transaction and
     * the whole Start rolls back; waiting taps are selected by TEACHER, so
     * every class that student is in is blocked, every period, until end of
     * day. Under a FRESH id — the first shape of this fix — the Start
     * survives, but the student is joined and shielded in a class they never
     * tapped into: here, period 5 at 13:00 off a 09:00 tap.
     *
     * The id is spent because the tap already landed, so the waiting row is a
     * stale retry and not a tap owed anything. It is consumed, skipped, and
     * recorded as `armed_tap_skipped` (decision 5, ruled 2026-09-22).
     */
    const { teacher, student, klass, school } = await seedClass('arm-spent');
    const later = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Period 5',
          joinCode: 'ARMSPENT2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: later.id, studentId: student.id });

    const first = await startSession(db, { classId: klass.id, ...window('2026-01-01T09:00:00Z') });
    const spent = newUuidV7();
    // The phone's clock runs fast: it stamps the 09:01 tap 10:10. Session 1
    // clamps that to its own end (rule 1). It matters below, at period 2's
    // Start: 10:10 falls INSIDE that window, so the clamp does not collapse
    // the claim onto the Start's own time, and the skip's stamp is tested.
    const fastClaim = new Date('2026-01-01T10:10:00Z');
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: spent,
      deviceTime: fastClaim,
    });
    await endSession(db, {
      sessionId: first.session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'ended',
    });

    // The outbox retry, arriving with nothing running. `armTap` refuses to
    // put a spent id in a waiting row at all now — it says the tap landed.
    const retry = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: spent,
      deviceTime: fastClaim,
      expiresAt: new Date('2026-01-01T23:59:59Z'),
      now: new Date('2026-01-01T09:30:00Z'),
    });
    expect(retry.outcome).toBe('replay');

    // So the row is written directly for the rest of this test, which is the
    // honest staging: the conversion's skip is defence in depth for rows that
    // ALREADY exist — armed before that refusal shipped, or by an older
    // deploy still running against this database. Writing `armed_taps` here is
    // allowed; it is the transient table, not participations or events.
    one(
      await db
        .insert(armedTaps)
        .values({
          studentId: student.id,
          teacherId: teacher.id,
          eventId: spent,
          deviceTime: fastClaim,
          expiresAt: new Date('2026-01-01T23:59:59Z'),
        })
        .returning(),
    );

    // Next period, and a different class hours later, both open normally...
    const second = await startSession(db, { classId: klass.id, ...window('2026-01-01T10:00:00Z') });
    expect(second.outcome).toBe('created');
    const fifth = await startSession(db, { classId: later.id, ...window('2026-01-01T13:00:00Z') });
    expect(fifth.outcome).toBe('created');

    // ...and neither joined the student off a tap that had already landed.
    expect(second.armedConverted).toBe(0);
    expect(fifth.armedConverted).toBe(0);
    for (const s of [second, fifth]) {
      const joined = await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, s.session.id), eq(participations.studentId, student.id)),
        );
      expect(joined).toHaveLength(0);
    }

    // The original tap still points at the session that really recorded it,
    // and the armed row is consumed, so it cannot come back tomorrow.
    const original = one(await db.select().from(events).where(eq(events.eventId, spent)));
    expect(original.sessionId).toBe(first.session.id);
    const left = await db
      .select()
      .from(armedTaps)
      .where(and(eq(armedTaps.studentId, student.id), isNull(armedTaps.consumedAt)));
    expect(left).toHaveLength(0);

    // And the skip is on the record, in the Start that made it (decision 5,
    // ruled 2026-09-22). The grid is unchanged by it — it shows this enrolled
    // student as absent either way, and ignores the event (pinned in
    // grid-state.test.ts) — but the permanent history now says WHY they are
    // absent, for the feed and for reports. Under an id of its own (the
    // armed one is the tap_in's), naming the tap it declined, and stamped
    // with the Start's clock — not the device's 10:10 claim, which the clamp
    // would have kept. Once: the row is consumed, so period 5 has nothing
    // left to skip.
    const skipsIn = async (sessionId: string) =>
      (await eventsFor(sessionId)).filter((e) => e.type === 'armed_tap_skipped');
    const skipped = one(await skipsIn(second.session.id));
    expect(skipped.userId).toBe(student.id);
    expect(skipped.classId).toBe(klass.id);
    expect(skipped.eventId).not.toBe(spent);
    expect(skipped.payload).toEqual({ armed_tap_event_id: spent });
    expect(skipped.occurredAt).toEqual(second.session.startedAt);
    expect(await skipsIn(fifth.session.id)).toHaveLength(0);
  });

  it('skips a waiting tap whose id landed under ANOTHER teacher, and leaves that session alone', async () => {
    /*
     * The skip is keyed on the student and the type, not the teacher, unlike
     * `armTap`'s lookup of the same id — and on purpose: a `tap_in` of this
     * student's under teacher A is a tap that landed, whoever's Start later
     * finds its id waiting. Reaching it needs an id reused across teachers or
     * a block that moved, so the row is written directly.
     *
     * Scoping it to the teacher, to match `armTap`, is the refactor this
     * pins against: the row would convert under a fresh id, end the student's
     * LIVE participation in A (decision 4), and join and shield them in B — a
     * session they never tapped into, which is what the skip exists to stop.
     * And the skip is recorded in the session that declined it: B's, a
     * different class from the one the tap landed in.
     */
    const a = await seedClass('arm-skip-xa');
    const b = await seedClass('arm-skip-xb');
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });

    const sessionA = (
      await startSession(db, { classId: a.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    const spent = newUuidV7();
    await tapIn(db, {
      sessionId: sessionA.id,
      studentId: a.student.id,
      eventId: spent,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    one(
      await db
        .insert(armedTaps)
        .values({
          studentId: a.student.id,
          teacherId: b.teacher.id,
          eventId: spent,
          deviceTime: new Date('2026-01-01T09:01:00Z'),
          expiresAt: new Date('2026-01-01T23:59:59Z'),
        })
        .returning(),
    );

    const startB = await startSession(db, {
      classId: b.klass.id,
      ...window('2026-01-01T09:05:00Z'),
    });
    expect(startB.armedConverted).toBe(0);

    // Still live in A, and nowhere in B.
    const live = one(
      await db
        .select()
        .from(participations)
        .where(and(eq(participations.studentId, a.student.id), isNull(participations.endedAt))),
    );
    expect(live.sessionId).toBe(sessionA.id);
    expect(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, startB.session.id),
            eq(participations.studentId, a.student.id),
          ),
        ),
    ).toHaveLength(0);

    const skipped = one(
      (await eventsFor(startB.session.id)).filter((e) => e.type === 'armed_tap_skipped'),
    );
    expect(skipped.userId).toBe(a.student.id);
    expect(skipped.classId).toBe(b.klass.id);
    expect(skipped.payload).toEqual({ armed_tap_event_id: spent });
  });

  it.each([
    ['an unlock of their own', 'own-unlock'],
    ["another student's tap_in", 'other-tap'],
  ] as const)(
    'a waiting tap whose id is on record as %s is still converted, under a fresh id',
    async (_label, shape) => {
      /*
       * The skip above is sound only when the id is on record as THIS
       * student's `tap_in`: that is the one shape where the tap already
       * landed. `insertEvent` also refuses an id held by another event type or
       * another user, and neither of those means this tap was honoured. It is
       * a genuine pre-bell tap whose id collided, so decision 5 applies: it
       * becomes a participation under a fresh id, with the armed id in the
       * payload — exactly as `main` converts it. Skipping it would drop a real
       * tap, and record it as one that had already landed.
       *
       * Written straight into `armed_taps` after the colliding event, which is
       * the simplest honest staging of the end state. The shape is reachable
       * in either order: `armTap` refuses an id already in `events`, but only
       * as of arming — `tapIn` and `unlock` never consult `armed_taps`, so an
       * id armed first can be taken by another event before the Start.
       */
      const { teacher, student, klass, school } = await seedClass(`arm-foreign-${shape}`);
      const first = await startSession(db, {
        classId: klass.id,
        ...window('2026-01-01T09:00:00Z'),
      });
      const collided = newUuidV7();
      if (shape === 'own-unlock') {
        await tapIn(db, {
          sessionId: first.session.id,
          studentId: student.id,
          eventId: newUuidV7(),
          deviceTime: new Date('2026-01-01T09:01:00Z'),
        });
        await unlock(db, {
          sessionId: first.session.id,
          studentId: student.id,
          eventId: collided,
          deviceTime: new Date('2026-01-01T09:05:00Z'),
        });
      } else {
        const other = one(
          await db
            .insert(users)
            .values({ cognitoId: `student-arm-foreign-b`, role: 'student', schoolId: school.id })
            .returning(),
        );
        await db.insert(enrollments).values({ classId: klass.id, studentId: other.id });
        await tapIn(db, {
          sessionId: first.session.id,
          studentId: other.id,
          eventId: collided,
          deviceTime: new Date('2026-01-01T09:01:00Z'),
        });
      }
      await endSession(db, {
        sessionId: first.session.id,
        at: new Date('2026-01-01T09:20:00Z'),
        reason: 'ended',
      });
      const recordedBefore = one(
        await db.select().from(events).where(eq(events.eventId, collided)),
      );

      one(
        await db
          .insert(armedTaps)
          .values({
            studentId: student.id,
            teacherId: teacher.id,
            eventId: collided,
            deviceTime: new Date('2026-01-01T09:55:00Z'),
            expiresAt: new Date('2026-01-01T23:59:59Z'),
          })
          .returning(),
      );

      const second = await startSession(db, {
        classId: klass.id,
        ...window('2026-01-01T10:00:00Z'),
      });
      expect(second.outcome).toBe('created');
      expect(second.armedConverted).toBe(1);

      const joined = one(
        await db
          .select()
          .from(participations)
          .where(
            and(
              eq(participations.sessionId, second.session.id),
              eq(participations.studentId, student.id),
            ),
          ),
      );
      expect(joined.state).toBe('focused');

      // The join is recorded, under an id of its own, and the event that
      // really owns the collided id is untouched.
      const tapInHere = (await eventsFor(second.session.id)).filter(
        (e) => e.type === 'tap_in' && e.userId === student.id,
      );
      expect(tapInHere).toHaveLength(1);
      expect(one(tapInHere).eventId).not.toBe(collided);
      expect(one(tapInHere).payload).toEqual({ armed_tap_event_id: collided });
      // Converted, so not recorded as a skip — the collided id says nothing
      // about this tap having landed.
      expect((await eventsFor(second.session.id)).map((e) => e.type)).not.toContain(
        'armed_tap_skipped',
      );
      expect(one(await db.select().from(events).where(eq(events.eventId, collided)))).toEqual(
        recordedBefore,
      );
    },
  );
});

describe('a retried tap the server re-resolves elsewhere', () => {
  it('replays against the session it actually recorded, instead of 409ing', async () => {
    /*
     * Finding 4. The phone mints one event id for one physical tap and
     * retries until it gets an answer. The SERVER, not the phone, decides
     * which session that tap means — resolveTapTarget picks the newest
     * running session the student is enrolled in — so a retry after the
     * teacher has started a second session resolves somewhere new. insertEvent
     * then sees the id attached to a different session and refuses it as
     * EVENT_ID_CONFLICT.
     *
     * That is the opposite of rule 4: the tap DID land, so the retry must
     * re-read and return the truth that was recorded, not a 409 the phone
     * reads as "keep retrying". The id identifies one tap by one student; the
     * conflict check is there for an id reused for a DIFFERENT event, which
     * this is not.
     */
    const { klass, student, school, teacher } = await seedClass('tap-resolve');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPRE2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    const first = await startSession(db, { classId: klass.id, ...window('2026-01-01T09:00:00Z') });
    const eventId = newUuidV7();
    const landed = await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    expect(landed.outcome).toBe('joined');

    // The same teacher starts a second session the student is also in; the
    // phone, never having seen a response, retries the identical tap.
    const second = await startSession(db, {
      classId: other.id,
      ...window('2026-01-01T10:00:00Z'),
    });
    const retry = await tapIn(db, {
      sessionId: second.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    expect(retry.outcome).toBe('replay');
    // The truth is the session the tap was actually recorded against.
    expect(retry.session?.id).toBe(first.session.id);
    expect(retry.participationId).toBe(landed.participationId);

    // And nothing was written twice.
    const taps = await db
      .select()
      .from(events)
      .where(and(eq(events.type, 'tap_in'), eq(events.userId, student.id)));
    expect(taps).toHaveLength(1);
  });

  it("suppresses a genuine join when a phone reuses its own id on ANOTHER teacher's block", async () => {
    /*
     * The tradeoff this branch gives up, pinned rather than only described.
     *
     * The replay keys on (event_id, type = 'tap_in', user_id), and the server
     * cannot tell a retry from a deliberate reuse — the phone is supposed to
     * mint one id per physical tap. So an app that reuses a spent id while the
     * student physically taps a DIFFERENT teacher's block is answered
     * `200 replay` naming the FIRST teacher's still-running session: the phone
     * shields to that window, teacher A's grid shows the student green, and
     * teacher B — in whose room the student is standing — sees them absent
     * until the next check-in.
     *
     * Deliberate, documented at the branch and in PLAN.md, and no privilege
     * comes with it: the same student could simply not tap, and B's grid shows
     * them absent either way. The owner ruled on it (2026-09-22) and it
     * stays; pinned because it is the join half of the split PLAN.md records
     * (the arm path refuses the same reuse), and a decision nothing tests can
     * change by accident. A4's "recorded, but no longer current" answer left
     * it as it is: this tap IS current — the participation in A is live, its
     * session running — so the replay still names A. Once it is not current,
     * a tap recorded under another teacher is refused on both paths ("refuses
     * an id spent under another teacher, as tapIn does").
     */
    const a = await seedClass('reuse-teacher-a');
    const b = await seedClass('reuse-teacher-b');
    // One student, enrolled with both teachers.
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });

    const sessionA = (
      await startSession(db, { classId: a.klass.id, ...window('2026-01-01T09:00:00Z') })
    ).session;
    const eventId = newUuidV7();
    const joined = await tapIn(db, {
      sessionId: sessionA.id,
      studentId: a.student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    expect(joined.outcome).toBe('joined');

    // A real, separate physical tap on teacher B's block — carrying the id the
    // buggy app never retired.
    const sessionB = (
      await startSession(db, { classId: b.klass.id, ...window('2026-01-01T10:00:00Z') })
    ).session;
    const reused = await tapIn(db, {
      sessionId: sessionB.id,
      studentId: a.student.id,
      eventId,
      deviceTime: new Date('2026-01-01T10:01:00Z'),
    });

    // Answered as a replay of teacher A's tap, not as the join it really was.
    expect(reused.outcome).toBe('replay');
    expect(reused.session?.id).toBe(sessionA.id);
    expect(reused.participationId).toBe(joined.participationId);

    // Teacher B's grid: nothing. The student is standing in that room.
    const inB = await db
      .select()
      .from(participations)
      .where(
        and(eq(participations.sessionId, sessionB.id), eq(participations.studentId, a.student.id)),
      );
    expect(inB, 'teacher B has no record of a student who did tap their block').toHaveLength(0);

    // And teacher A still shows them green, which is the other half of the drift.
    const inA = one(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, sessionA.id),
            eq(participations.studentId, a.student.id),
          ),
        ),
    );
    expect(inA.endedAt).toBeNull();
    expect(inA.state).toBe('focused');
  });

  it('replays a tap recorded in a session that has ended with no session, never naming it', async () => {
    /*
     * The bound that makes the replay above safe. A session the teacher ended
     * EARLY keeps its original endsAt, so a replay NAMING it tells the phone
     * to shield the student until a bell that already rang, in a session whose
     * grid no teacher is watching and which no unlock can reach — and per
     * ARCHITECTURE step 10 the phone deletes its outbox record on 200 and
     * stops asking.
     *
     * So the replay names no session (A4): recorded, with no window, which
     * `tapDisposition` reads as "delete it and re-read the truth". Until A4 it
     * was a 409 EVENT_ID_CONFLICT, which the tap outbox keeps and retries
     * forever — a record the server did keep, never allowed to clear. The
     * student's next physical tap carries a fresh id and joins normally.
     *
     * Measured, so the name is not read as a claim about which line holds it
     * up: NEITHER guard is pinned by this test on its own. Ending a session
     * ends its live participations in the same transaction, so by the time the
     * session is gone the row is too, and each condition is independently
     * sufficient here — delete either one alone and this stays green; delete
     * both and it goes red. `!current.endedAt` has its own tests below;
     * `!recorded.endedAt` is kept for read-order safety rather than because
     * anything would catch its removal (see the branch comment).
     */
    const { klass, student, school, teacher } = await seedClass('tap-replay-ended');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPEND2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    const first = await startSession(db, { classId: klass.id, ...window('2026-01-01T09:00:00Z') });
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    // Ended EARLY: endsAt stays 09:25, so a replay would hand the phone a
    // window that is still open on its own clock.
    await endSession(db, {
      sessionId: first.session.id,
      at: new Date('2026-01-01T09:05:00Z'),
      reason: 'ended',
    });

    const second = await startSession(db, {
      classId: other.id,
      ...window('2026-01-01T09:10:00Z'),
    });
    const retry = await tapIn(db, {
      sessionId: second.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    expect(retry).toEqual({ outcome: 'replay', state: null, participationId: null, session: null });

    // A replay writes nothing: no second tap_in, and no join into the session
    // the retry re-resolved to.
    const taps = await db
      .select()
      .from(events)
      .where(and(eq(events.type, 'tap_in'), eq(events.userId, student.id)));
    expect(taps).toHaveLength(1);
    const inSecond = await db
      .select()
      .from(participations)
      .where(eq(participations.sessionId, second.session.id));
    expect(inSecond).toHaveLength(0);
  });

  it('replays a participation the student has since left with no session', async () => {
    /*
     * The other half of the same bound, and the sharper one, because BOTH
     * sessions are running. The first tap lands in A and its response is lost;
     * the student then taps B for real, which ends their A row as
     * `left_for_other_session` (decision 4); the stale outbox record for the
     * first tap finally retries and resolves to B.
     *
     * Answering that with "replay: focused in A" is the phone/grid drift the
     * engine exists to prevent: the phone shields for A and its next check-in
     * against A comes back `gone` — the unshield signal — while the teacher's
     * grid correctly shows the student green in B. The recorded truth is no
     * longer the current truth, so the replay names no session (A4, a 409
     * before it) and the phone re-reads the truth, which is B.
     */
    const { klass, student, school, teacher } = await seedClass('tap-left');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPLEFT2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    const first = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z', 60),
    });
    const stale = newUuidV7();
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: stale,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    const second = await startSession(db, {
      classId: other.id,
      ...window('2026-01-01T09:05:00Z', 60),
    });
    const moved = await tapIn(db, {
      sessionId: second.session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:06:00Z'),
    });
    expect(moved.outcome).toBe('switched');

    const retry = await tapIn(db, {
      sessionId: second.session.id,
      studentId: student.id,
      eventId: stale,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    expect(retry).toEqual({ outcome: 'replay', state: null, participationId: null, session: null });

    // And the student is still where they actually are.
    const left = one(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, first.session.id),
            eq(participations.studentId, student.id),
          ),
        ),
    );
    expect(left.endedReason).toBe('left_for_other_session');
    const live = one(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, second.session.id),
            eq(participations.studentId, student.id),
          ),
        ),
    );
    expect(live.endedAt).toBeNull();
  });

  it('replays when the session it resolved to ended in the gap', async () => {
    /*
     * Why the lookup sits AHEAD of the ended-session guard. resolveTapTarget
     * filters on isNull(endedAt) outside the transaction, so the session it
     * picks can end before the engine's locked read — at the bell, where the
     * per-minute expiry sweep meets a burst of taps. Behind the guard, a tap
     * that DID land is answered 409 SESSION_NOT_RUNNING, which restarts the
     * infinite retry loop this branch exists to end. Ahead of it, the still-
     * running session that actually recorded the tap comes back.
     */
    const { klass, student, school, teacher } = await seedClass('tap-gap');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPGAP2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    const recorded = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z', 60),
    });
    const eventId = newUuidV7();
    const landed = await tapIn(db, {
      sessionId: recorded.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    // The newer session resolveTapTarget would have picked, gone by the time
    // the engine locks it.
    const resolved = await startSession(db, {
      classId: other.id,
      ...window('2026-01-01T09:10:00Z'),
    });
    await endSession(db, {
      sessionId: resolved.session.id,
      at: new Date('2026-01-01T09:11:00Z'),
      reason: 'expired',
    });

    const retry = await tapIn(db, {
      sessionId: resolved.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    expect(retry.outcome).toBe('replay');
    expect(retry.session?.id).toBe(recorded.session.id);
    expect(retry.session?.endedAt).toBeNull();
    expect(retry.participationId).toBe(landed.participationId);
  });

  it('replays a stale retry with no session once the student has left the session that recorded it', async () => {
    /*
     * The same bound seen from the other side. Here the retry resolves back
     * to the session that recorded it — still running — but the student's row
     * in it has ended, because they tapped the teacher's other session for
     * real. Before #28 it was answered 200 with that ended row's stale
     * `focused`, naming this session: the drift the bound exists to kill.
     * Then a 409 NOT_PARTICIPATING, kept and retried forever. Since A4, a
     * replay with no session: the id is not in conflict — it names this very
     * tap — and what is no longer true is the participation.
     */
    const { klass, student, school, teacher } = await seedClass('tap-left-same');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPLEFTS2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    const recorded = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z', 60),
    });
    const stale = newUuidV7();
    await tapIn(db, {
      sessionId: recorded.session.id,
      studentId: student.id,
      eventId: stale,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    const second = await startSession(db, {
      classId: other.id,
      ...window('2026-01-01T09:05:00Z'),
    });
    await tapIn(db, {
      sessionId: second.session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:06:00Z'),
    });
    // Second period is over; the stale retry resolves back to the first
    // session, which is still running.
    await endSession(db, {
      sessionId: second.session.id,
      at: new Date('2026-01-01T09:30:00Z'),
      reason: 'ended',
    });

    const retry = await tapIn(db, {
      sessionId: recorded.session.id,
      studentId: student.id,
      eventId: stale,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    expect(retry).toEqual({ outcome: 'replay', state: null, participationId: null, session: null });
    // Not re-joined under the spent id: the row the switch ended stays ended.
    const row = one(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, recorded.session.id),
            eq(participations.studentId, student.id),
          ),
        ),
    );
    expect(row.endedReason).toBe('left_for_other_session');
  });

  it('replays a retry with no session after the student was removed from, or left, the class', async () => {
    /*
     * The removal half of A4, and the retry that races one (see the real-
     * Postgres race). The tap lands and its answer is lost; the teacher
     * removes the student (or they leave the class) while the session runs;
     * the retry, resolved before the removal, reaches the session that
     * recorded it. The id names this very tap, so it is no conflict — but the
     * student is no longer in this session, so no answer may name it. Before
     * A4 this was a 409 NOT_PARTICIPATING.
     */
    for (const reason of ['removed_from_class', 'left_class'] as const) {
      const { klass, student } = await seedClass(`tap-retry-${reason}`);
      const { session } = await startSession(db, {
        classId: klass.id,
        ...window('2026-01-01T09:00:00Z'),
      });
      const tap = {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date('2026-01-01T09:01:00Z'),
      };
      expect((await tapIn(db, tap)).outcome).toBe('joined');
      const enrollment = one(
        await db
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.classId, klass.id), eq(enrollments.studentId, student.id))),
      );
      await endEnrollment(db, {
        enrollmentId: enrollment.id,
        reason,
        at: new Date('2026-01-01T09:05:00Z'),
      });

      expect(await tapIn(db, tap), reason).toEqual({
        outcome: 'replay',
        state: null,
        participationId: null,
        session: null,
      });
      const row = one(
        await db.select().from(participations).where(eq(participations.sessionId, session.id)),
      );
      expect(row.endedReason, reason).toBe(reason);
    }
  });

  it('replays a stale retry with no session when the session it resolved to ended in the gap', async () => {
    /*
     * The ordering the branch relies on: the replay lookup sits AHEAD of the
     * ended-session guard, so a stale retry whose resolved session ended
     * between resolveTapTarget and the engine's lock (the bell, meeting a
     * burst of retries) is still answered as the tap it is. Before A4 it fell
     * through to that guard as a 409 SESSION_NOT_RUNNING. Both shapes: the
     * retry resolved back to the session that recorded it, or to the
     * teacher's other session.
     */
    const { klass, student, school, teacher } = await seedClass('tap-gap-stale');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPGAPS2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

    const recorded = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: recorded.session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    await endSession(db, {
      sessionId: recorded.session.id,
      at: new Date('2026-01-01T09:20:00Z'),
      reason: 'expired',
    });
    const resolved = await startSession(db, {
      classId: other.id,
      ...window('2026-01-01T09:30:00Z'),
    });
    await endSession(db, {
      sessionId: resolved.session.id,
      at: new Date('2026-01-01T09:31:00Z'),
      reason: 'ended',
    });

    for (const sessionId of [recorded.session.id, resolved.session.id]) {
      const retry = await tapIn(db, {
        sessionId,
        studentId: student.id,
        eventId,
        deviceTime: new Date('2026-01-01T09:01:00Z'),
      });
      expect(retry).toEqual({
        outcome: 'replay',
        state: null,
        participationId: null,
        session: null,
      });
    }
  });

  it("refuses a tap_in carrying another student's spent id, and does not eat their join", async () => {
    /*
     * The identity half of the branch's guard, which nothing else pins: with
     * `prior.userId === input.studentId` deleted, a student replaying someone
     * else's spent id while they are themselves live in that session gets a
     * 200 'replay' off their OWN row — and their real join into the resolved
     * session is silently suppressed. No data crosses (loadParticipation keys
     * on the caller), but a student who tapped would be missing from the grid
     * with nothing surfaced.
     */
    const { klass, student, school, teacher } = await seedClass('tap-other-id');
    const classmate = one(
      await db
        .insert(users)
        .values({ cognitoId: 'student-tap-other-id-2', role: 'student', schoolId: school.id })
        .returning(),
    );
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPOTHER2',
        })
        .returning(),
    );
    await db.insert(enrollments).values([
      { classId: klass.id, studentId: classmate.id },
      { classId: second.id, studentId: classmate.id },
    ]);

    const first = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z', 60),
    });
    const theirs = newUuidV7();
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: theirs,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    // The classmate is live in that same session, so a branch that skipped the
    // identity check would find a row of theirs to hand back.
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: classmate.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });

    const later = await startSession(db, {
      classId: second.id,
      ...window('2026-01-01T09:10:00Z'),
    });
    await expect(
      tapIn(db, {
        sessionId: later.session.id,
        studentId: classmate.id,
        eventId: theirs,
        deviceTime: new Date('2026-01-01T09:11:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    // Refused, so nothing of theirs was written into the second session.
    const joined = await db
      .select()
      .from(participations)
      .where(
        and(
          eq(participations.sessionId, later.session.id),
          eq(participations.studentId, classmate.id),
        ),
      );
    expect(joined).toHaveLength(0);
  });

  it("will not launder an unlock's id into a tap replay", async () => {
    /*
     * The type half of the same guard, and the direction the sibling test
     * below does not cover. With `prior?.type === 'tap_in'` dropped, a tap
     * carrying an UNLOCK's id comes back as a 200 replay reporting the
     * unlocked row — the tap is silently dropped, and the phone is told a
     * join happened. ISSUES #2 runs the other way, but the same one-line
     * change opens both.
     */
    const { klass, student, school, teacher } = await seedClass('tap-unlock-id');
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'TAPUNL2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: second.id, studentId: student.id });

    const first = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z', 60),
    });
    await tapIn(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    const unlockId = newUuidV7();
    await unlock(db, {
      sessionId: first.session.id,
      studentId: student.id,
      eventId: unlockId,
      deviceTime: new Date('2026-01-01T09:02:00Z'),
    });

    const later = await startSession(db, {
      classId: second.id,
      ...window('2026-01-01T09:10:00Z'),
    });
    await expect(
      tapIn(db, {
        sessionId: later.session.id,
        studentId: student.id,
        eventId: unlockId,
        deviceTime: new Date('2026-01-01T09:11:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
  });

  it('still refuses an id reused for a genuinely different event', async () => {
    // The guard this must not weaken: a student reusing their tap_in id for
    // an unlock is a client bug, and calling it a replay would silently drop
    // an unlock the phone then deletes from its outbox (ISSUES #2).
    const { klass, student } = await seedClass('tap-reuse');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });

    await expect(
      unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId,
        deviceTime: new Date('2026-01-01T09:02:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
  });
});

describe('the ended-consistency check constraint', () => {
  it('refuses an ended_at without an ended_reason', async () => {
    const { klass, student } = await seedClass('check');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    const p = await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    await expect(
      db
        .update(participations)
        .set({ endedAt: new Date('2026-01-01T09:05:00Z') })
        .where(eq(participations.id, p.participationId!)),
    ).rejects.toThrow();
  });
});

describe('enrollment lifecycle', () => {
  async function freshStudent(tag: string, schoolId: string) {
    return one(
      await db
        .insert(users)
        .values({ cognitoId: `newstudent-${tag}`, role: 'student', schoolId })
        .returning(),
    );
  }

  function activeEnrollment(classId: string, studentId: string) {
    return db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.classId, classId),
          eq(enrollments.studentId, studentId),
          isNull(enrollments.removedAt),
        ),
      );
  }

  function enrollmentEvents(
    type: 'enrollment_joined' | 'enrollment_left' | 'enrollment_removed',
    userId: string,
  ) {
    return db
      .select()
      .from(events)
      .where(and(eq(events.type, type), eq(events.userId, userId)));
  }

  it('joins a class by code and records enrollment_joined', async () => {
    const { klass, school } = await seedClass('join');
    const newbie = await freshStudent('join', school.id);
    const result = await joinClassByCode(db, {
      studentId: newbie.id,
      joinCode: klass.joinCode,
      eventId: newUuidV7(),
      occurredAt: new Date('2026-01-01T08:00:00Z'),
    });
    expect(result.outcome).toBe('joined');
    expect(await activeEnrollment(klass.id, newbie.id)).toHaveLength(1);
    const joined = one(await enrollmentEvents('enrollment_joined', newbie.id));
    expect(joined.classId).toBe(klass.id);
    expect(joined.sessionId).toBeNull();
  });

  it('joining a class you are already in is a no-op, not an error or a duplicate', async () => {
    const { klass, student } = await seedClass('join-dup');
    const result = await joinClassByCode(db, {
      studentId: student.id,
      joinCode: klass.joinCode,
      eventId: newUuidV7(),
      occurredAt: new Date('2026-01-01T08:00:00Z'),
    });
    expect(result.outcome).toBe('already_enrolled');
    expect(await activeEnrollment(klass.id, student.id)).toHaveLength(1);
    expect(await enrollmentEvents('enrollment_joined', student.id)).toHaveLength(0);
  });

  it('rejects an unknown join code', async () => {
    const { school } = await seedClass('join-bad');
    const newbie = await freshStudent('bad', school.id);
    await expect(
      joinClassByCode(db, {
        studentId: newbie.id,
        joinCode: 'NOPE-NONEXISTENT',
        eventId: newUuidV7(),
        occurredAt: new Date('2026-01-01T08:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_FOUND' });
  });

  it('re-joining after removal adds a fresh enrollment and keeps the removed one as history', async () => {
    const { klass, student } = await seedClass('rejoin');
    const enr = one(await activeEnrollment(klass.id, student.id));
    await endEnrollment(db, {
      enrollmentId: enr.id,
      reason: 'left_class',
      at: new Date('2026-01-01T08:00:00Z'),
    });
    const result = await joinClassByCode(db, {
      studentId: student.id,
      joinCode: klass.joinCode,
      eventId: newUuidV7(),
      occurredAt: new Date('2026-01-01T09:00:00Z'),
    });
    expect(result.outcome).toBe('joined');
    const all = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.classId, klass.id), eq(enrollments.studentId, student.id)));
    expect(all).toHaveLength(2);
    expect(all.filter((e) => e.removedAt === null)).toHaveLength(1);
  });

  it('a mid-session removal ends the live participation and records it on the session feed (one transaction)', async () => {
    const { klass, student } = await seedClass('remove-mid');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    const enr = one(await activeEnrollment(klass.id, student.id));

    const result = await endEnrollment(db, {
      enrollmentId: enr.id,
      reason: 'removed_from_class',
      at: new Date('2026-01-01T09:05:00Z'),
    });
    expect(result.outcome).toBe('ended');
    expect(result.endedParticipation).toBe(true);

    const removed = one(await db.select().from(enrollments).where(eq(enrollments.id, enr.id)));
    expect(removed.removedAt).not.toBeNull();
    const part = one(
      await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
        ),
    );
    expect(part.endedAt).not.toBeNull();
    expect(part.endedReason).toBe('removed_from_class');
    // The event carries the session id so the grid's session feed surfaces it.
    const ev = one(await enrollmentEvents('enrollment_removed', student.id));
    expect(ev.sessionId).toBe(session.id);
    expect(ev.classId).toBe(klass.id);
  });

  it('after a mid-session removal the check-in reads gone and a later unlock is still recorded (ISSUES #2)', async () => {
    const { klass, student } = await seedClass('remove-then-unlock');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    const enr = one(await activeEnrollment(klass.id, student.id));
    await endEnrollment(db, {
      enrollmentId: enr.id,
      reason: 'removed_from_class',
      at: new Date('2026-01-01T09:05:00Z'),
    });

    const checkin = await checkIn(db, {
      sessionId: session.id,
      studentId: student.id,
      deviceTime: new Date('2026-01-01T09:06:00Z'),
    });
    expect(checkin.status).toBe('gone');

    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:07:00Z'),
    });
    expect(u.outcome).toBe('recorded');
    expect(u.recordedAs).toBe('no_live_participation');
  });

  it('a student leaving with no running session records an enrollment-level event', async () => {
    const { klass, student } = await seedClass('leave-nosession');
    const enr = one(await activeEnrollment(klass.id, student.id));
    const result = await endEnrollment(db, {
      enrollmentId: enr.id,
      reason: 'left_class',
      at: new Date('2026-01-01T08:00:00Z'),
    });
    expect(result.outcome).toBe('ended');
    expect(result.endedParticipation).toBe(false);
    const ev = one(await enrollmentEvents('enrollment_left', student.id));
    expect(ev.sessionId).toBeNull();
  });

  it('removing an already-removed enrollment is a no-op', async () => {
    const { klass, student } = await seedClass('remove-twice');
    const enr = one(await activeEnrollment(klass.id, student.id));
    await endEnrollment(db, { enrollmentId: enr.id, reason: 'removed_from_class', at: new Date() });
    const again = await endEnrollment(db, {
      enrollmentId: enr.id,
      reason: 'removed_from_class',
      at: new Date(),
    });
    expect(again.outcome).toBe('already_removed');
    expect(await enrollmentEvents('enrollment_removed', student.id)).toHaveLength(1);
  });

  it('rejects removing an unknown enrollment', async () => {
    await expect(
      endEnrollment(db, { enrollmentId: newUuidV7(), reason: 'left_class', at: new Date() }),
    ).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_FOUND' });
  });

  it('removing a student from one class leaves their live participation in another class untouched', async () => {
    const c = await seedClass('scope-c');
    const d = await seedClass('scope-d');
    // Enroll c's student into d too, start a session in d, and go live there.
    await db.insert(enrollments).values({ classId: d.klass.id, studentId: c.student.id });
    const { session: sessionD } = await startSession(db, {
      classId: d.klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await tapIn(db, {
      sessionId: sessionD.id,
      studentId: c.student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:01:00Z'),
    });
    // Remove the student from class C (which has no running session).
    const enrC = one(await activeEnrollment(c.klass.id, c.student.id));
    const result = await endEnrollment(db, {
      enrollmentId: enrC.id,
      reason: 'removed_from_class',
      at: new Date('2026-01-01T09:05:00Z'),
    });
    expect(result.endedParticipation).toBe(false);
    // The student's class-D participation is untouched — removal is scoped to C.
    const liveD = one(
      await db
        .select()
        .from(participations)
        .where(
          and(
            eq(participations.sessionId, sessionD.id),
            eq(participations.studentId, c.student.id),
          ),
        ),
    );
    expect(liveD.endedAt).toBeNull();
  });
});

describe('renameStudent', () => {
  /** A student in `classId`, named `displayName`. */
  async function classmate(tag: string, displayName: string | null, classId: string) {
    const row = one(
      await db
        .insert(users)
        .values({ cognitoId: `classmate-${tag}`, role: 'student', displayName })
        .returning(),
    );
    await db.insert(enrollments).values({ classId, studentId: row.id });
    return row;
  }
  const rename = (studentId: string, displayName: string, eventId = newUuidV7()) =>
    renameStudent(db, { studentId, displayName, eventId });

  it('sets the name and records it, beside the name it replaced, in no session or class', async () => {
    const { student } = await seedClass('rename-record');
    await rename(student.id, 'Ana');
    const eventId = newUuidV7();

    const result = await rename(student.id, 'Ana Reyes', eventId);

    expect(result.outcome).toBe('applied');
    expect(result.user.displayName).toBe('Ana Reyes');
    const recorded = one(await db.select().from(events).where(eq(events.eventId, eventId)));
    expect(recorded).toMatchObject({
      type: 'display_name_changed',
      userId: student.id,
      sessionId: null,
      classId: null,
      payload: { display_name: 'Ana Reyes', previous_display_name: 'Ana' },
    });
  });

  it('retries a transaction Postgres aborts as a deadlock, as every engine mutation does', async () => {
    // No cycle is known to reach a rename, so no race can stage one: this pins
    // the retry itself. The first attempt is aborted the way Postgres aborts a
    // deadlock's loser (40P01, wrapped as drizzle wraps it); the second runs.
    const { student } = await seedClass('rename-deadlock');
    const deadlock = new Error('Failed query', {
      cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    });
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => Promise.reject(deadlock));
    try {
      const result = await rename(student.id, 'Ana');

      expect(result.outcome).toBe('applied');
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('compares names as a reader would: case, spacing and compatibility forms aside', async () => {
    const { student, klass } = await seedClass('rename-key');
    await classmate('rename-key-1', 'Strauß', klass.id);
    await classmate('rename-key-2', 'Ｂｅａ  Ortiz', klass.id);
    await classmate('rename-key-3', 'Zoe\u0308', klass.id);

    for (const name of [
      'STRAUSS',
      'bea ortiz',
      'Zo\u00eb',
      // Characters that draw nothing cannot make a name another: a joiner, a
      // variation selector, a Hangul filler; nor can a blank that looks like
      // a space, the blank braille cell.
      'Bea\u200d Ortiz',
      'Bea\ufe0f Ortiz',
      'Bea Ortiz\u3164',
      'Bea\u2800Ortiz',
    ]) {
      await expect(rename(student.id, name), name).rejects.toMatchObject({
        code: 'DISPLAY_NAME_TAKEN',
      });
    }
    // Look-alikes from another script are another name (a Cyrillic а).
    expect((await rename(student.id, 'Be\u0430 Ortiz')).outcome).toBe('applied');
  });

  it('compares with live classes only: an archived one is no longer shared', async () => {
    const { student, klass } = await seedClass('rename-archived');
    await classmate('rename-archived-1', 'Bea', klass.id);
    await db.update(classes).set({ removedAt: new Date() }).where(eq(classes.id, klass.id));

    expect((await rename(student.id, 'Bea')).outcome).toBe('applied');
  });

  it('replays a recorded id with the name now, and refuses an id another event holds', async () => {
    const { student } = await seedClass('rename-replay');
    const other = await seedClass('rename-replay-other');
    const first = newUuidV7();
    await rename(student.id, 'Ana', first);
    await rename(student.id, 'Bea');

    const replay = await rename(student.id, 'Ana', first);

    expect(replay.outcome).toBe('replay');
    expect(replay.user.displayName).toBe('Bea');
    await expect(rename(other.student.id, 'Cal', first)).rejects.toMatchObject({
      code: 'EVENT_ID_CONFLICT',
    });
  });
});
