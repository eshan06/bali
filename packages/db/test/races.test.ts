import type { EventType } from '@bali/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { createBlock } from '../src/management.js';
import { findOrCreateStudent, findUserByCognitoId } from '../src/queries.js';
import {
  blocks,
  classes,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  checkIn,
  endEnrollment,
  endSession,
  expireDueSessions,
  markSilentParticipations,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
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

  it('an unlock racing endSession always commits the unlock event (ISSUES #2)', async () => {
    // The headline never-discard function under contention. unlock and endSession
    // both lock the session FOR UPDATE, so they serialize either way: unlock then
    // end flips the participation then ends it; end then unlock records
    // `after_session_end`. In both interleavings the unlock event must survive.
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId } = await seed(`race-unlock-end-${round}`);
      const session = await openSession(classId);
      await tapIn(db, {
        sessionId: session.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });

      await Promise.allSettled([
        unlock(db, {
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        }),
        endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' }),
      ]);

      const unlocks = await eventsOfType(session.id, 'unlock');
      expect(unlocks).toHaveLength(1);
      // Step 1's invariant still holds: no live participation in an ended session.
      const ended = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
      expect(ended.endedAt).not.toBeNull();
      expect(await liveParticipations(session.id)).toHaveLength(0);
    }
  });

  it('a mid-session removal racing endSession stays atomic (enrollment removed, participation ended once)', async () => {
    // Both endEnrollment and endSession lock the session FOR UPDATE, so they
    // serialize: whichever wins, the enrollment is removed and the participation
    // ends exactly once with a valid reason — never left live in an ended session.
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId } = await seed(`race-remove-end-${round}`);
      const session = await openSession(classId);
      await tapIn(db, {
        sessionId: session.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });
      const enr = one(
        await db
          .select()
          .from(enrollments)
          .where(
            and(
              eq(enrollments.classId, classId),
              eq(enrollments.studentId, studentId),
              isNull(enrollments.removedAt),
            ),
          ),
      );

      await Promise.allSettled([
        endEnrollment(db, { enrollmentId: enr.id, reason: 'removed_from_class', at: new Date() }),
        endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' }),
      ]);

      const removed = one(await db.select().from(enrollments).where(eq(enrollments.id, enr.id)));
      expect(removed.removedAt).not.toBeNull();
      const part = one(
        await db.select().from(participations).where(eq(participations.sessionId, session.id)),
      );
      expect(part.endedAt).not.toBeNull();
      expect(['removed_from_class', 'session_ended']).toContain(part.endedReason);
      expect(await liveParticipations(session.id)).toHaveLength(0);
    }
  });

  it('a removal racing a cross-class switch-tap is deadlock-free and consistent', async () => {
    // The dangerous interleaving: a student live in class C is removed from C at
    // the instant they tap into class D. endEnrollment (ending C's participation
    // under C's lock) and tapIn(D) -> endParticipationsElsewhere (ending the SAME
    // C participation under D's lock) can deadlock; both retry on 40P01, so both
    // succeed. Uses Promise.all — a leaked deadlock would reject and fail here.
    // Heavier setup per round (two classes/sessions) + real-PG latency + retries,
    // so it gets a generous timeout.
    for (let round = 0; round < 12; round += 1) {
      const tag = `race-switch-${round}`;
      const school = one(
        await db
          .insert(schools)
          .values({ name: `S ${tag}` })
          .returning(),
      );
      const teacher = one(
        await db
          .insert(users)
          .values({ cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id })
          .returning(),
      );
      const student = one(
        await db
          .insert(users)
          .values({ cognitoId: `s-${tag}`, role: 'student', schoolId: school.id })
          .returning(),
      );
      const classC = one(
        await db
          .insert(classes)
          .values({
            teacherId: teacher.id,
            schoolId: school.id,
            name: `C ${tag}`,
            joinCode: `C-${tag}`,
          })
          .returning(),
      );
      const classD = one(
        await db
          .insert(classes)
          .values({
            teacherId: teacher.id,
            schoolId: school.id,
            name: `D ${tag}`,
            joinCode: `D-${tag}`,
          })
          .returning(),
      );
      const enrC = one(
        await db
          .insert(enrollments)
          .values({ classId: classC.id, studentId: student.id })
          .returning(),
      );
      await db.insert(enrollments).values({ classId: classD.id, studentId: student.id });
      const now = Date.now();
      const win = { startedAt: new Date(now - 60_000), endsAt: new Date(now + 25 * 60_000) };
      const sessionC = (await startSession(db, { classId: classC.id, ...win })).session;
      const sessionD = (await startSession(db, { classId: classD.id, ...win })).session;
      await tapIn(db, {
        sessionId: sessionC.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });

      await Promise.all([
        endEnrollment(db, { enrollmentId: enrC.id, reason: 'removed_from_class', at: new Date() }),
        tapIn(db, {
          sessionId: sessionD.id,
          studentId: student.id,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        }),
      ]);

      const removed = one(await db.select().from(enrollments).where(eq(enrollments.id, enrC.id)));
      expect(removed.removedAt).not.toBeNull();
      expect(await liveParticipations(sessionC.id)).toHaveLength(0);
      // one-live-per-student AND the switch-tap was not dropped: the student ends
      // up with exactly one live participation, and it is the tap into D. Asserting
      // only `<= 1` would still pass if the removal stranded the student
      // live-nowhere — endEnrollment is class-C-scoped and must never touch D.
      const liveAll = await db
        .select()
        .from(participations)
        .where(and(eq(participations.studentId, student.id), isNull(participations.endedAt)));
      expect(liveAll).toHaveLength(1);
      expect(liveAll[0]!.sessionId).toBe(sessionD.id);
    }
  }, 20_000);

  // Block registration (Step 4). Not an engine mutation, but the active-tag
  // index is arbitrated the same way the join-code index is, so this proves the
  // ON CONFLICT DO NOTHING path is race-safe: two simultaneous claims of one tag
  // resolve to exactly one live block, never two and never a lost registration.
  it('two simultaneous registrations of the same tag yield exactly one live block', async () => {
    for (let round = 0; round < 20; round += 1) {
      const tag = `race-block-${round}`;
      const teacherA = one(
        await db
          .insert(users)
          .values({ cognitoId: `ta-${tag}`, role: 'teacher' })
          .returning(),
      );
      const teacherB = one(
        await db
          .insert(users)
          .values({ cognitoId: `tb-${tag}`, role: 'teacher' })
          .returning(),
      );
      const tagId = `TAG-RACE-${tag}`;

      const [ra, rb] = await Promise.all([
        createBlock(db, { teacherId: teacherA.id, tagId }),
        createBlock(db, { teacherId: teacherB.id, tagId }),
      ]);

      // Exactly one side registered; the other saw the tag as taken.
      expect([ra.outcome, rb.outcome].sort()).toEqual(['registered', 'tag_taken']);

      const live = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.tagId, tagId), isNull(blocks.removedAt)));
      expect(live).toHaveLength(1);
    }
  });

  // The silence sweep's exactly-once guarantee (decision 3) under real
  // contention: two minute-sweeps firing at once must open one episode per phone
  // — never two went_silent for the same student, never a missed one. The
  // guarded UPDATE (silent_since IS NULL) is what makes that hold.
  it('two sweeps racing open exactly one silence episode per phone', async () => {
    const tag = 'race-silence';
    const school = one(
      await db
        .insert(schools)
        .values({ name: `S ${tag}` })
        .returning(),
    );
    const teacher = one(
      await db
        .insert(users)
        .values({ cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id })
        .returning(),
    );
    const klass = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: `C ${tag}`,
          joinCode: `J-${tag}`,
        })
        .returning(),
    );
    const session = (
      await startSession(db, {
        classId: klass.id,
        startedAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      })
    ).session;
    const studentCount = 8;
    for (let i = 0; i < studentCount; i += 1) {
      const student = one(
        await db
          .insert(users)
          .values({ cognitoId: `s-${tag}-${i}`, role: 'student', schoolId: school.id })
          .returning(),
      );
      await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
      await tapIn(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });
    }
    // Everyone silent past the threshold.
    await db
      .update(participations)
      .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(participations.sessionId, session.id));

    const now = new Date();
    await Promise.all([markSilentParticipations(db, now), markSilentParticipations(db, now)]);

    const silent = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'went_silent')));
    expect(silent).toHaveLength(studentCount);
  });

  // The mirror of the sweep race, on the close side: two heartbeats landing at
  // once on one open episode must close it with exactly one came_back. The
  // guarded UPDATE (silent_since IS NOT NULL) in checkIn is what holds this.
  it('two concurrent check-ins closing one episode emit exactly one came_back', async () => {
    for (let round = 0; round < 12; round += 1) {
      const tag = `race-comeback-${round}`;
      const school = one(
        await db
          .insert(schools)
          .values({ name: `S ${tag}` })
          .returning(),
      );
      const teacher = one(
        await db
          .insert(users)
          .values({ cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id })
          .returning(),
      );
      const student = one(
        await db
          .insert(users)
          .values({ cognitoId: `s-${tag}`, role: 'student', schoolId: school.id })
          .returning(),
      );
      const klass = one(
        await db
          .insert(classes)
          .values({
            teacherId: teacher.id,
            schoolId: school.id,
            name: `C ${tag}`,
            joinCode: `J-${tag}`,
          })
          .returning(),
      );
      await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
      const session = (
        await startSession(db, {
          classId: klass.id,
          startedAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 25 * 60_000),
        })
      ).session;
      await tapIn(db, {
        sessionId: session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });
      // Open a silence episode for the student.
      await db
        .update(participations)
        .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })
        .where(eq(participations.sessionId, session.id));
      await markSilentParticipations(db, new Date());

      await Promise.all([
        checkIn(db, { sessionId: session.id, studentId: student.id, deviceTime: new Date() }),
        checkIn(db, { sessionId: session.id, studentId: student.id, deviceTime: new Date() }),
      ]);

      const comebacks = await db
        .select()
        .from(events)
        .where(and(eq(events.sessionId, session.id), eq(events.type, 'came_back')));
      expect(comebacks).toHaveLength(1);
      const participation = one(
        await db.select().from(participations).where(eq(participations.sessionId, session.id)),
      );
      expect(participation.silentSince).toBeNull();
    }
  });
});

describe.runIf(REAL_PG)('provisioning concurrency (real Postgres)', () => {
  it('two sign-ins filling a missing name at once agree on the one that won', async () => {
    // The race the fill introduces: both callers read the same NULL, both try
    // the UPDATE, and the NULL re-check in its WHERE lets exactly one through.
    // The loser must re-read rather than report back the NULL it started with —
    // the portal would show a UUID prefix for a row that now has a name.
    const cognitoId = `race-fill-${newUuidV7()}`;
    const created = await findOrCreateStudent(db, cognitoId);
    expect(created.displayName).toBeNull();

    const [a, b] = await Promise.all([
      findOrCreateStudent(db, cognitoId, 'Ana Reyes'),
      findOrCreateStudent(db, cognitoId, 'demo-ana@example.test'),
    ]);

    const rows = await db.select().from(users).where(eq(users.cognitoId, cognitoId));
    expect(rows).toHaveLength(1);
    const stored = one(rows).displayName;
    expect(stored).not.toBeNull();
    expect(['Ana Reyes', 'demo-ana@example.test']).toContain(stored);
    expect(a.displayName).toBe(stored);
    expect(b.displayName).toBe(stored);
    expect(a.id).toBe(created.id);
    expect(b.id).toBe(created.id);
  });

  it('two first sign-ins at once still make exactly one row', async () => {
    const cognitoId = `race-provision-${newUuidV7()}`;

    const [a, b] = await Promise.all([
      findOrCreateStudent(db, cognitoId, 'Ana Reyes'),
      findOrCreateStudent(db, cognitoId, 'Ana Reyes'),
    ]);

    expect(await db.select().from(users).where(eq(users.cognitoId, cognitoId))).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(a.displayName).toBe('Ana Reyes');
    expect(b.displayName).toBe('Ana Reyes');
  });

  it('a name arriving beside one already stored never replaces it', async () => {
    const cognitoId = `race-keep-${newUuidV7()}`;
    await findOrCreateStudent(db, cognitoId, 'Ana Reyes');

    await Promise.all([
      findOrCreateStudent(db, cognitoId, 'demo-ana@example.test'),
      findOrCreateStudent(db, cognitoId, 'demo-other@example.test'),
    ]);

    expect((await findUserByCognitoId(db, cognitoId))?.displayName).toBe('Ana Reyes');
  });
});
