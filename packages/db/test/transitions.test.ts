import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import * as schema from '../src/schema.js';
import {
  armedTaps,
  classes,
  enrollments,
  events,
  participations,
  schools,
  users,
} from '../src/schema.js';
import {
  armTap,
  checkIn,
  endSession,
  expireDueSessions,
  extendSession,
  protectionOff,
  refocus,
  startSession,
  tapIn,
  TransitionError,
  unlock,
} from '../src/transitions.js';

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
});

afterAll(async () => {
  await pg.close();
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

  it('refuses a state change for a student who is not participating', async () => {
    const { klass, student } = await seedClass('unlock-none');
    const { session } = await startSession(db, {
      classId: klass.id,
      ...window('2026-01-01T09:00:00Z'),
    });
    await expect(
      unlock(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date('2026-01-01T09:05:00Z'),
      }),
    ).rejects.toBeInstanceOf(TransitionError);
  });

  it('the response carries the session so the phone learns the end time', async () => {
    const { session, student } = await joined('unlock-window');
    const u = await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date('2026-01-01T09:05:00Z'),
    });
    expect(u.session.endsAt.toISOString()).toBe(session.endsAt.toISOString());
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
    expect(live.lastSeenAt?.toISOString()).toBe('2026-01-01T09:02:00.000Z');
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
      newEndsAt: newEnd,
      at: new Date('2026-01-01T09:20:00Z'),
    });
    expect(updated.endsAt.toISOString()).toBe(newEnd.toISOString());
    expect((await eventsFor(session.id)).some((e) => e.type === 'session_extended')).toBe(true);
  });

  it('refuses an extension that is not later than the current end', async () => {
    const { klass } = await seedClass('extend-bad');
    const w = window('2026-01-01T09:00:00Z');
    const { session } = await startSession(db, { classId: klass.id, ...w });
    await expect(
      extendSession(db, {
        sessionId: session.id,
        newEndsAt: w.endsAt,
        at: new Date('2026-01-01T09:10:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
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
      newEndsAt: new Date('2026-01-01T10:00:00Z'),
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
