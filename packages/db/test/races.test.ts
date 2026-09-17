import type { EventType } from '@bali/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import {
  classes,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import { endSession, expireDueSessions, startSession, tapIn } from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * The concurrency guarantees Phase 1 could only verify by reasoning: PGlite is
 * single-connection, so the FOR UPDATE serialization in the transition engine
 * never actually contends there. These tests fire genuinely simultaneous
 * transactions on separate connections, so they only mean anything on a real
 * Postgres — they are skipped on the PGlite lane and run when TEST_DATABASE_URL
 * is set. Each asserts an invariant the honesty rules depend on holding no
 * matter how the two transactions interleave.
 */

const REAL_PG = Boolean(process.env.TEST_DATABASE_URL);

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

/** A school, teacher, enrolled student, and class — the minimum for a session. */
async function seed(tag: string) {
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
      .values({ teacherId: teacher.id, schoolId: school.id, name: `Class ${tag}`, joinCode: tag })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  return { classId: klass.id, studentId: student.id };
}

/** Open a session on the class. `due` puts its window in the past so the sweep ends it. */
async function openSession(classId: string, opts: { due?: boolean } = {}) {
  const now = Date.now();
  const startedAt = new Date(now - 60_000);
  const endsAt = opts.due ? new Date(now - 30_000) : new Date(now + 25 * 60_000);
  const result = await startSession(db, { classId, startedAt, endsAt });
  return result.session;
}

function eventsOfType(sessionId: string, type: EventType) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, type)))
    .orderBy(asc(events.seq));
}

function liveParticipations(sessionId: string) {
  return db
    .select()
    .from(participations)
    .where(and(eq(participations.sessionId, sessionId), isNull(participations.endedAt)));
}

describe.runIf(REAL_PG)('engine concurrency (real Postgres)', () => {
  it('two identical taps at once produce one event and one participation', async () => {
    const { classId, studentId } = await seed('race-tap');
    const session = await openSession(classId);
    const eventId = newUuidV7();
    const deviceTime = new Date();

    const results = await Promise.all([
      tapIn(db, { sessionId: session.id, studentId, eventId, deviceTime }),
      tapIn(db, { sessionId: session.id, studentId, eventId, deviceTime }),
    ]);

    // The events.eventId unique constraint is the dedupe: the loser's insert
    // no-ops (onConflictDoNothing), so exactly one tap applies and the other
    // replays, under any interleaving. (The session FOR UPDATE lock is what
    // races 3 and 4 exercise — for two identical taps the unique constraint
    // alone serializes them, so this race does not depend on the lock.)
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['joined', 'replay']);

    const taps = await eventsOfType(session.id, 'tap_in');
    expect(taps).toHaveLength(1);

    const live = await liveParticipations(session.id);
    expect(live).toHaveLength(1);
    expect(one(live).state).toBe('focused');
  });

  it('two concurrent starts create one session and both callers get it', async () => {
    // Looped, like the tap/end race below: a single shot could pass against a
    // missing class-row lock if the scheduler happened to serialize the two
    // starts, so several rounds drive that miss probability down.
    for (let round = 0; round < 10; round += 1) {
      const { classId } = await seed(`race-start-${round}`);
      const now = Date.now();
      const window = { startedAt: new Date(now), endsAt: new Date(now + 25 * 60_000) };

      const [a, b] = await Promise.all([
        startSession(db, { classId, ...window }),
        startSession(db, { classId, ...window }),
      ]);

      // One creates, the other finds the running one — never a duplicate (the
      // class-row lock plus the one-running-per-class partial unique index).
      expect([a.outcome, b.outcome].sort()).toEqual(['created', 'existing']);
      expect(a.session.id).toBe(b.session.id);

      const running = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.classId, classId), isNull(sessions.endedAt)));
      expect(running).toHaveLength(1);

      const started = await eventsOfType(a.session.id, 'session_started');
      expect(started).toHaveLength(1);
    }
  });

  it('a tap racing endSession never leaves a live participation in an ended session', async () => {
    // Run several rounds so both interleavings (tap-then-end, end-then-tap) get
    // exercised; the invariant must hold for either.
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId } = await seed(`race-tap-end-${round}`);
      const session = await openSession(classId);

      await Promise.allSettled([
        tapIn(db, {
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        }),
        endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' }),
      ]);

      const ended = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
      expect(ended.endedAt).not.toBeNull();
      // The whole point: an ended session may hold ended participations, never a
      // live one (that was v2's "phone locked in a dead session").
      const live = await liveParticipations(session.id);
      expect(live).toHaveLength(0);
    }
  });

  it('two concurrent expiry sweeps emit one session_expired per session', async () => {
    // Looped for the same reason as the two races above, and it matters most
    // here: "one session_expired per session" has no DB-constraint backstop (a
    // fresh event id each time), so this race is the sole guardian of that
    // guarantee — a single serialized shot must not be its only exercise.
    for (let round = 0; round < 10; round += 1) {
      const { classId } = await seed(`race-expire-${round}`);
      const session = await openSession(classId, { due: true });
      const now = new Date();

      const [first, second] = await Promise.all([
        expireDueSessions(db, now),
        expireDueSessions(db, now),
      ]);

      // Between the two runs the session is ended exactly once; the loser's
      // endSession is an idempotent no-op (decision 6). Scoped to this round's
      // session, so the global sweep touching nothing else stays irrelevant.
      const bothEnded = [...first, ...second].filter((id) => id === session.id);
      expect(bothEnded).toHaveLength(1);

      const expired = await eventsOfType(session.id, 'session_expired');
      expect(expired).toHaveLength(1);
    }
  });
});
