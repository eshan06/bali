import { MAX_SESSION_MINUTES } from '@bali/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  startSession,
  tapIn,
  unlock,
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
      .where(eq(participations.id, p1.participationId));

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
    // same bound as the route's zod cap, only `/v1` refused them. 1e15 is the
    // shape beyond that: it overflows the Date range, so without the range
    // guard the engine hands an Invalid Date to toISOString() and the caller
    // gets a bare RangeError, a 500, instead of a refusal it can read.
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
  it('arms a tap when no session is running, idempotent on eventId', async () => {
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
    const retry = await armTap(db, req);
    expect(retry.outcome).toBe('replay');
    expect(retry.armedTapId).toBe(first.armedTapId);
    // A different eventId for the same student+teacher doesn't pile up.
    const second = await armTap(db, { ...req, eventId: newUuidV7() });
    expect(second.outcome).toBe('already_armed');
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.studentId, student.id));
    expect(rows).toHaveLength(1);
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

  it('a spent event id never wedges the next Start', async () => {
    /*
     * The worst thing in this area, and it needs no race to reach. A tap lands
     * in a session, its response is lost, the bell ends the session, and the
     * phone's outbox retries. Nothing of that teacher's is running, so the
     * route ARMS the retry — `armTap` de-dupes against `armed_taps.event_id`
     * and never against `events`, so a spent id is accepted.
     *
     * The next Start then converts it, `insertEvent` sees the id against a
     * different session and refuses, and because conversion runs inside
     * `startSession`'s transaction the whole Start rolls back with the tap
     * still unconsumed. Waiting taps are selected by TEACHER, so this blocks
     * every class that student is in, every period, until end of day. The
     * teacher cannot start a lesson.
     *
     * The student is still standing there, so the conversion goes ahead under
     * a fresh event id, with the spent one kept in the payload.
     */
    const { teacher, student, klass, school } = await seedClass('arm-spent');
    const other = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'ARMSPENT2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: other.id, studentId: student.id });

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
      at: new Date('2026-01-01T09:25:00Z'),
      reason: 'expired',
    });

    // The outbox retry, arriving with nothing running: the route arms it.
    const armed = await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: spent,
      deviceTime: new Date('2026-01-01T09:01:00Z'),
      expiresAt: new Date('2026-01-01T23:59:59Z'),
    });
    expect(armed.outcome).toBe('armed');

    // Next period, and the period after, both open normally.
    const second = await startSession(db, { classId: klass.id, ...window('2026-01-01T10:00:00Z') });
    expect(second.armedConverted).toBe(1);
    const third = await startSession(db, { classId: other.id, ...window('2026-01-01T11:00:00Z') });
    expect(third.outcome).toBe('created');

    // The student joined under a fresh id, and the spent one still points at
    // the session that really recorded it.
    const joined = one((await eventsFor(second.session.id)).filter((e) => e.type === 'tap_in'));
    expect(joined.eventId).not.toBe(spent);
    expect(joined.payload).toEqual({ armed_tap_event_id: spent });
    const original = one(await db.select().from(events).where(eq(events.eventId, spent)));
    expect(original.sessionId).toBe(first.session.id);

    // And the tap is consumed, so it cannot come back tomorrow.
    const left = await db
      .select()
      .from(armedTaps)
      .where(and(eq(armedTaps.studentId, student.id), isNull(armedTaps.consumedAt)));
    expect(left).toHaveLength(0);
  });
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
    expect(retry.session.id).toBe(first.session.id);
    expect(retry.participationId).toBe(landed.participationId);

    // And nothing was written twice.
    const taps = await db
      .select()
      .from(events)
      .where(and(eq(events.type, 'tap_in'), eq(events.userId, student.id)));
    expect(taps).toHaveLength(1);
  });

  it('refuses to replay a tap recorded in a session that has ended', async () => {
    /*
     * The bound that makes the replay above safe. TapResponse hands the phone
     * {id, classId, endsAt} and has no way to say "that session is over", and
     * a session the teacher ended EARLY keeps its original endsAt — so a
     * "replay" naming an ended session tells the phone to shield the student
     * until a bell that already rang, in a session whose grid no teacher is
     * watching and which no unlock can reach. Nothing would be surfaced
     * anywhere: per ARCHITECTURE step 10 the phone deletes its outbox record
     * on 200 and stops asking.
     *
     * So the engine refuses instead. EVENT_ID_CONFLICT is loud — a non-401 4xx
     * is "keep the record, retry, and surface" — and the student's next
     * physical tap carries a fresh id and joins the running session normally.
     *
     * Measured, so the name is not read as a claim about which line holds it
     * up: NEITHER guard is pinned by this test on its own. Ending a session
     * ends its live participations in the same transaction, so by the time the
     * session is gone the row is too, and each condition is independently
     * sufficient here — delete either one alone and this stays green; delete
     * both and it goes red. `!current.endedAt` has its own test in the two
     * cases above; `!recorded.endedAt` is kept for read-order safety rather
     * than because anything would catch its removal (see the branch comment).
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
    await expect(
      tapIn(db, {
        sessionId: second.session.id,
        studentId: student.id,
        eventId,
        deviceTime: new Date('2026-01-01T09:01:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
  });

  it('refuses to replay a participation the student has since left', async () => {
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
     * longer the current truth, so it is not a replay.
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

    await expect(
      tapIn(db, {
        sessionId: second.session.id,
        studentId: student.id,
        eventId: stale,
        deviceTime: new Date('2026-01-01T09:01:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

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
    expect(retry.session.id).toBe(recorded.session.id);
    expect(retry.session.endedAt).toBeNull();
    expect(retry.participationId).toBe(landed.participationId);
  });

  it('refuses a stale retry once the student has left the session that recorded it', async () => {
    /*
     * The same bound seen from the other side, and the case the `!isNew`
     * refusal below the branch actually serves. Here the retry resolves back
     * to the session that recorded it — still running — but the student's row
     * in it has ended, because they tapped the teacher's other session for
     * real. main answered 200 with that ended row's stale `focused`, which is
     * the drift this PR exists to kill.
     *
     * NOT_PARTICIPATING, not EVENT_ID_CONFLICT: the id is not in conflict, it
     * names this very tap. What is no longer true is the participation.
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

    await expect(
      tapIn(db, {
        sessionId: recorded.session.id,
        studentId: student.id,
        eventId: stale,
        deviceTime: new Date('2026-01-01T09:01:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_PARTICIPATING' });
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
        .where(eq(participations.id, p.participationId)),
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
