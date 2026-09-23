import type { EventType } from '@bali/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { createBlock } from '../src/management.js';
import { findOrCreateStudent, findUserByCognitoId } from '../src/queries.js';
import {
  armedTaps,
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
  armTap,
  checkIn,
  endEnrollment,
  endSession,
  expireDueSessions,
  extendSession,
  markSilentParticipations,
  protectionOff,
  refocus,
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

  it('protection off racing an unlock or a refocus always ends in protection off', async () => {
    // Both of A2's rules rest on the session FOR UPDATE lock serialising the
    // pair, and either order must end the same way. Unlock first flips to
    // unlocked and protection off then takes over; protection off first and
    // the unlock is recorded without softening it. Refocus first returns to
    // focus and protection off takes over; protection off first and the
    // refocus is refused. So: protection off every time, the unlock always
    // recorded, and never a refocus after the protection_off it would undo.
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['unlock', 'refocus'] as const) {
        const { classId, studentId } = await seed(`race-protoff-${rival}-${round}`);
        const session = await openSession(classId);
        const change = () => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        });
        await tapIn(db, change());
        if (rival === 'refocus') await unlock(db, change());

        const [reported, other] = await Promise.allSettled([
          protectionOff(db, change()),
          rival === 'unlock' ? unlock(db, change()) : refocus(db, change()),
        ]);

        // Each racer ended the way one of the two orders allows — so an
        // unrelated failure cannot pass itself off as the refusal.
        expect(reported.status).toBe('fulfilled');
        if (rival === 'unlock') {
          expect(other.status).toBe('fulfilled');
          if (other.status === 'fulfilled') {
            expect(['applied', 'recorded']).toContain(other.value.outcome);
          }
        } else if (other.status === 'rejected') {
          expect(other.reason).toMatchObject({ code: 'PROTECTION_OFF' });
        }

        expect(one(await liveParticipations(session.id)).state).toBe('protection_off');
        const types = (
          await db
            .select({ type: events.type })
            .from(events)
            .where(eq(events.sessionId, session.id))
            .orderBy(asc(events.seq))
        ).map((e) => e.type);
        const off = types.indexOf('protection_off');
        expect(off).toBeGreaterThan(-1);
        expect(types.slice(off + 1)).not.toContain('refocus');
        if (rival === 'unlock') expect(types.filter((t) => t === 'unlock')).toHaveLength(1);
      }
    }
  });

  it('unlock, refocus and protection off racing the silence sweep never fail on a deadlock', async () => {
    // Opposite lock orders: the sweep's per-phone transaction takes the
    // participation row first (its guarded UPDATE), then the session's
    // key-share lock for its went_silent event; unlock and the state changes
    // take the session lock first, then the row. Postgres aborts one side with
    // 40P01 — as a 500 to the phone, before both sides retried it (an unlock
    // lost 83 races in 100). Every round races one change against a sweep that
    // is due to mark the phone silent; both must settle, in either order.
    const stale = new Date(Date.now() - 5 * 60_000);
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['unlock', 'refocus', 'protection_off'] as const) {
        const { classId, studentId } = await seed(`race-sweep-${rival}-${round}`);
        const session = await openSession(classId);
        const change = () => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        });
        await tapIn(db, change());
        await db
          .update(participations)
          .set({ lastSeenAt: stale })
          .where(eq(participations.sessionId, session.id));

        const move =
          rival === 'unlock'
            ? unlock(db, change())
            : rival === 'refocus'
              ? refocus(db, change())
              : protectionOff(db, change());
        await Promise.all([markSilentParticipations(db, new Date()), move]);

        const row = one(await liveParticipations(session.id));
        expect(row.state).toBe(
          rival === 'unlock' ? 'unlocked' : rival === 'refocus' ? 'focused' : 'protection_off',
        );
        // Whichever order won, the change was contact: it closed any episode
        // the sweep opened, and every went_silent has its came_back.
        expect(row.silentSince).toBeNull();
        const wentSilent = await eventsOfType(session.id, 'went_silent');
        expect(await eventsOfType(session.id, 'came_back')).toHaveLength(wentSilent.length);
      }
    }
  }, 120_000);

  it('unlock and protection off racing a switch away never fail on a deadlock', async () => {
    // A tap into another session, or an armed tap converting at another
    // class's Start, ends this participation while holding THAT session's
    // lock, then records the leave here (key-share on this session). Unlock
    // and protection off hold this session's lock and want the row: the same
    // opposite orders as the sweep. The switching side already retried; now
    // both do, so each racer ends the way one of the two orders allows.
    for (let round = 0; round < 12; round += 1) {
      for (const via of ['tap', 'armed_start'] as const) {
        for (const rival of ['unlock', 'protection_off'] as const) {
          const tag = `race-leave-${via}-${rival}-${round}`;
          const school = one(
            await db
              .insert(schools)
              .values({ name: `S ${tag}` })
              .returning(),
          );
          const [teacher, otherTeacher, student] = await db
            .insert(users)
            .values([
              { cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id },
              { cognitoId: `t2-${tag}`, role: 'teacher', schoolId: school.id },
              { cognitoId: `s-${tag}`, role: 'student', schoolId: school.id },
            ])
            .returning();
          const here = one(
            await db
              .insert(classes)
              .values({
                teacherId: teacher!.id,
                schoolId: school.id,
                name: `C ${tag}`,
                joinCode: `C-${tag}`,
              })
              .returning(),
          );
          // A switching tap goes to the same teacher's other class; an armed
          // tap waits for another teacher's, converted when that class starts.
          const there = one(
            await db
              .insert(classes)
              .values({
                teacherId: via === 'tap' ? teacher!.id : otherTeacher!.id,
                schoolId: school.id,
                name: `D ${tag}`,
                joinCode: `D-${tag}`,
              })
              .returning(),
          );
          await db.insert(enrollments).values([
            { classId: here.id, studentId: student!.id },
            { classId: there.id, studentId: student!.id },
          ]);
          const now = Date.now();
          const win = { startedAt: new Date(now - 60_000), endsAt: new Date(now + 25 * 60_000) };
          const session = (await startSession(db, { classId: here.id, ...win })).session;
          const change = (sessionId: string) => ({
            sessionId,
            studentId: student!.id,
            eventId: newUuidV7(),
            deviceTime: new Date(),
          });
          await tapIn(db, change(session.id));

          let leave: () => Promise<unknown>;
          if (via === 'tap') {
            const next = (await startSession(db, { classId: there.id, ...win })).session;
            leave = () => tapIn(db, change(next.id));
          } else {
            await armTap(db, {
              studentId: student!.id,
              teacherId: otherTeacher!.id,
              eventId: newUuidV7(),
              deviceTime: new Date(),
              expiresAt: new Date(now + 3_600_000),
            });
            leave = () => startSession(db, { classId: there.id, ...win });
          }

          const [moved, left] = await Promise.allSettled([
            rival === 'unlock'
              ? unlock(db, change(session.id))
              : protectionOff(db, change(session.id)),
            leave(),
          ]);

          expect(left.status).toBe('fulfilled');
          if (rival === 'unlock') {
            // Never refused (ISSUES #2): applied here, or recorded after the leave.
            expect(moved.status).toBe('fulfilled');
            expect(await eventsOfType(session.id, 'unlock')).toHaveLength(1);
          } else if (moved.status === 'rejected') {
            // The leave landed first, leaving nothing here to mark — a refusal,
            // never a deadlock.
            expect(moved.reason).toMatchObject({ code: 'NOT_PARTICIPATING' });
          }
          // Either way the student ends up live only where they went.
          expect(await liveParticipations(session.id)).toHaveLength(0);
          const live = await db
            .select()
            .from(participations)
            .where(and(eq(participations.studentId, student!.id), isNull(participations.endedAt)));
          expect(live).toHaveLength(1);
        }
      }
    }
  }, 240_000);

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
  }, 60_000);

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

  it('a registration racing its own retry answers both with the one block', async () => {
    // The same teacher twice at once — a request and the retry of its lost
    // response, crossing. The index arbitrates which insert wins; the loser
    // must re-read and hand back the winner's block, not a 409 about a tag
    // the caller already holds.
    for (let round = 0; round < 20; round += 1) {
      const tag = `race-block-own-${round}`;
      const teacher = one(
        await db
          .insert(users)
          .values({ cognitoId: `t-${tag}`, role: 'teacher' })
          .returning(),
      );
      const tagId = `TAG-RACE-${tag}`;

      const results = await Promise.all([
        createBlock(db, { teacherId: teacher.id, tagId }),
        createBlock(db, { teacherId: teacher.id, tagId }),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual(['already_registered', 'registered']);

      const live = one(
        await db
          .select()
          .from(blocks)
          .where(and(eq(blocks.tagId, tagId), isNull(blocks.removedAt))),
      );
      for (const r of results) {
        if (r.outcome === 'tag_taken') throw new Error('unreachable');
        expect(r.block.id).toBe(live.id);
      }
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
  /*
   * Rounds, because one pair of calls can simply fail to race. As first
   * written, each race ran once, and with the block run on its own, removing
   * the fill's NULL re-check or the loser's re-read left it green. With fifteen
   * rounds, removing either — or the fill on the insert path, or on an existing
   * row — turns it red in 3 runs of 3. The warm-up is the file's usual one (see
   * the armed-tap block below): a cold second connection serialises round 0.
   */
  beforeAll(async () => {
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
  });

  it('two sign-ins filling a missing name at once agree on the one that won', async () => {
    // The race the fill introduces: both callers read the same NULL, both try
    // the UPDATE, and the NULL re-check in its WHERE lets exactly one through.
    // The loser must re-read rather than report back the NULL it started with —
    // its /v1/me would answer no name for a row that now has one.
    for (let round = 0; round < 15; round += 1) {
      const cognitoId = `race-fill-${round}-${newUuidV7()}`;
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
    }
  });

  it('a nameless first sign-in racing a named one still ends with the name', async () => {
    // The insert path's own fill. When both calls miss the row and the nameless
    // INSERT wins, the named INSERT does nothing and its re-select finds NULL:
    // without the fill there, the name it carried is dropped.
    for (let round = 0; round < 15; round += 1) {
      const cognitoId = `race-first-${round}-${newUuidV7()}`;

      const [, named] = await Promise.all([
        findOrCreateStudent(db, cognitoId),
        findOrCreateStudent(db, cognitoId, 'Ana Reyes'),
      ]);

      expect(named.displayName).toBe('Ana Reyes');
      expect((await findUserByCognitoId(db, cognitoId))?.displayName).toBe('Ana Reyes');
    }
  });

  it('two first sign-ins at once still make exactly one row', async () => {
    for (let round = 0; round < 15; round += 1) {
      const cognitoId = `race-provision-${round}-${newUuidV7()}`;

      const [a, b] = await Promise.all([
        findOrCreateStudent(db, cognitoId, 'Ana Reyes'),
        findOrCreateStudent(db, cognitoId, 'Ana Reyes'),
      ]);

      expect(await db.select().from(users).where(eq(users.cognitoId, cognitoId))).toHaveLength(1);
      expect(a.id).toBe(b.id);
      expect(a.displayName).toBe('Ana Reyes');
      expect(b.displayName).toBe('Ana Reyes');
    }
  });

  it('a name arriving beside one already stored never replaces it', async () => {
    for (let round = 0; round < 15; round += 1) {
      const cognitoId = `race-keep-${round}-${newUuidV7()}`;
      await findOrCreateStudent(db, cognitoId, 'Ana Reyes');

      await Promise.all([
        findOrCreateStudent(db, cognitoId, 'demo-ana@example.test'),
        findOrCreateStudent(db, cognitoId, 'demo-other@example.test'),
      ]);

      expect((await findUserByCognitoId(db, cognitoId))?.displayName).toBe('Ana Reyes');
    }
  });
});

describe.runIf(REAL_PG)('engine idempotency under contention (real Postgres)', () => {
  it('two taps crossing in opposite directions never deadlock', async () => {
    /*
     * What the cross-session read's lock choice is worth, on the lane that can
     * actually show it. tapIn holds FOR UPDATE on the session it resolved to,
     * then reads the OTHER session — the one that recorded a replayed tap —
     * WITHOUT a lock. That is deliberate: lock it and two taps crossing in
     * opposite directions order B-then-A against A-then-B, which is a genuine
     * deadlock, and withDeadlockRetry would paper over it rather than fix it.
     *
     * So this pins the choice from the outside. Student X's spent id lives in
     * session B and Y's in session A; X taps A while Y taps B, repeatedly.
     *
     * TWO assertions, because the obvious one is not enough on its own, and
     * that is the whole lesson here. `tapIn` wraps its transaction in
     * `withDeadlockRetry`, so a reintroduced deadlock is caught, retried, and
     * usually wins on the retry — no rejection ever reaches the loop below.
     * Measured: with `for update` added to that read, the per-result check
     * never fires and the test dies on the vitest budget instead, naming
     * nothing. So the real assertion is Postgres's own counter, which records
     * a deadlock whether or not the error escaped; the per-result check stays
     * as the faster, clearer signal for one that does escape.
     *
     * On a database of its OWN, not the file's. `pg_stat_database.deadlocks`
     * is database-wide, and the file's database is shared with "a removal
     * racing a cross-class switch-tap", which provokes 40P01 deliberately —
     * see `deadlockCount`. A delta almost covers that; a late stats flush from
     * another backend defeats it.
     */
    const { db: iso, close: closeIso } = await makeTestDb();
    try {
      await crossingTapsRound(iso);
    } finally {
      await closeIso();
    }
  }, 60_000);
});

/** The body of the crossing-taps test, on a database nothing else touches. */
async function crossingTapsRound(db: Database): Promise<void> {
  const school = one(await db.insert(schools).values({ name: 'Cross' }).returning());
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: 'cross-teacher', role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const mkClass = async (name: string, code: string) =>
    one(
      await db
        .insert(classes)
        .values({ teacherId: teacher.id, schoolId: school.id, name, joinCode: code })
        .returning(),
    );
  const a = await mkClass('A', 'CROSSA');
  const b = await mkClass('B', 'CROSSB');
  const mkStudent = async (tag: string) => {
    const u = one(
      await db
        .insert(users)
        .values({ cognitoId: `cross-${tag}`, role: 'student', schoolId: school.id })
        .returning(),
    );
    await db.insert(enrollments).values([
      { classId: a.id, studentId: u.id },
      { classId: b.id, studentId: u.id },
    ]);
    return u;
  };
  const x = await mkStudent('x');
  const y = await mkStudent('y');

  for (let round = 0; round < 8; round += 1) {
    const at = new Date(Date.now() + round * 1000);
    const sa = (
      await startSession(db, {
        classId: a.id,
        startedAt: at,
        endsAt: new Date(at.getTime() + 45 * 60_000),
      })
    ).session;
    const sb = (
      await startSession(db, {
        classId: b.id,
        startedAt: at,
        endsAt: new Date(at.getTime() + 45 * 60_000),
      })
    ).session;

    // Each student's id is spent in the session the OTHER one is tapping,
    // so both replays have to reach across.
    const ex = newUuidV7();
    const ey = newUuidV7();
    await tapIn(db, { sessionId: sb.id, studentId: x.id, eventId: ex, deviceTime: at });
    await tapIn(db, { sessionId: sa.id, studentId: y.id, eventId: ey, deviceTime: at });

    const results = await Promise.allSettled([
      tapIn(db, { sessionId: sa.id, studentId: x.id, eventId: ex, deviceTime: at }),
      tapIn(db, { sessionId: sb.id, studentId: y.id, eventId: ey, deviceTime: at }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        const err = r.reason as Error & { cause?: { code?: string } };
        expect(
          err.cause?.code,
          `round ${round}: a tap failed with ${err.message} — a 40P01 here means the cross-session read took a lock`,
        ).not.toBe('40P01');
      }
    }
    await endSession(db, {
      sessionId: sa.id,
      at: new Date(at.getTime() + 1000),
      reason: 'ended',
    });
    await endSession(db, {
      sessionId: sb.id,
      at: new Date(at.getTime() + 1000),
      reason: 'ended',
    });
  }

  // The one that survives withDeadlockRetry. Absolute, not a delta: this
  // database is this test's alone, so anything above zero is ours.
  expect(
    await deadlockCount(db),
    'Postgres broke a deadlock in this database — the cross-session read took a lock, ' +
      'and the retry wrapper hid it',
  ).toBe(0);
}

describe.runIf(REAL_PG)('concurrent extends (real Postgres)', () => {
  it('two simultaneous +10s extends both land, and the session gains both', async () => {
    /*
     * Finding 7. The route reads the session, does the arithmetic, and hands
     * the engine an absolute newEndsAt. Two taps of "add time" read the same
     * current end, compute the same target, and the loser's value is no
     * longer later than what the winner committed — so the engine refuses it
     * as INVALID_EXTENSION and the teacher's second press silently does
     * nothing. Doing the arithmetic inside the locked read fixes it: each
     * extend adds to whatever it finds.
     */
    for (let round = 0; round < 8; round += 1) {
      const { classId } = await seed(`race-extend-${round}`);
      const session = await openSession(classId);
      const before = session.endsAt.getTime();

      const results = await Promise.allSettled([
        extendSession(db, {
          sessionId: session.id,
          durationMinutes: 10,
          at: new Date(),
          eventId: newUuidV7(),
        }),
        extendSession(db, {
          sessionId: session.id,
          durationMinutes: 10,
          at: new Date(),
          eventId: newUuidV7(),
        }),
      ]);

      const refused = results.filter((r) => r.status === 'rejected');
      expect(refused.map((r) => String(r.reason))).toEqual([]);

      // Two distinct presses, two distinct event ids: both must count.
      const after = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
      expect(after.endsAt.getTime()).toBe(before + 20 * 60_000);
      expect(await eventsOfType(session.id, 'session_extended')).toHaveLength(2);
    }
  });
});

/**
 * Deadlocks Postgres has broken in the database `on` is connected to.
 *
 * The only honest way to see a deadlock that `withDeadlockRetry` handled:
 * Postgres counts it whether or not the loser's error ever escaped.
 *
 * MUST be given a database nothing else is using, and the first version of
 * this was wrong about that. It read the file-level `db`, whose database is
 * shared by all three describes here — including "a removal racing a
 * cross-class switch-tap", which deliberately provokes 40P01 and says so. A
 * before/after delta covers most of that, but not all: `pg_stat_clear_snapshot()`
 * drops only the READING backend's cached snapshot, and other backends flush
 * their pending stats on their own schedule (at transaction end, at most every
 * PGSTAT_MIN_INTERVAL). A deadlock from an earlier test, still pending when
 * the `before` read happens and flushed before the `after` one, lands in the
 * delta and reddens CI over code that is correct.
 *
 * So the caller hands it a database of its own. Then the counter really does
 * start at 0 and nothing else can contribute.
 */
async function deadlockCount(on: Database): Promise<number> {
  await on.execute(sql`select pg_stat_clear_snapshot()`);
  const rows = (await on.execute(
    sql`select deadlocks::int as n from pg_stat_database where datname = current_database()`,
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Backends currently parked on a lock in this database. */
async function lockWaiters(): Promise<number> {
  const rows = (await db.execute(
    sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Wait until some OTHER backend is actively running a statement against
 * `armed_taps` — i.e. the conversion has reached its armed-tap stage.
 *
 * Aims a racing call at that window by observation rather than by clock. A
 * fixed sleep is a guess about how long `startSession`'s preamble takes on the
 * runner of the day (a class-row lock, the running-session lookup, the session
 * insert, its event, the class read, the enrollment read), and both ways of
 * guessing wrong are bad: too short and the racer lands before the conversion
 * takes any armed-tap lock, too long and the conversion has already committed.
 *
 * RETURNS rather than throws when it never sees one, and that is deliberate:
 * this runs INSIDE the racing call, so a throw rejects it, and the caller then
 * reads a missed window as a failed race. Measured the hard way — under a full
 * real-PG suite it threw about 1 run in 8, and the test went red with
 * `expected 'rejected' to be 'fulfilled'`, which names nothing. A missed aim
 * is a round to run again; the caller's retry handles it and the gate after
 * the race is what reports.
 *
 * `state = 'active'` is load-bearing: pg_stat_activity keeps the last query
 * text on idle backends too, and the pool ran plenty of armed-tap statements
 * during setup.
 */
async function waitForBackendOnArmedTaps(timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await db.execute(
      sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and state = 'active'
            and query like ${'%armed_taps%'}`,
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((r) => setTimeout(r, 2));
  }
}

/**
 * Fail rather than proceed if nothing ever blocks — the staging must be real.
 *
 * Held-transaction tests that gate on the 5 s default carry an explicit 20 s
 * budget, and must: this package has no vitest config, so the test budget is
 * vitest's own 5 s, and a round that never staged died as "Test timed out" —
 * naming nothing — before the gate could throw the error that says what went
 * wrong. Measured, with the gate forced to miss.
 */
async function waitForBlockedBackend(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await lockWaiters()) > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no backend ever blocked on the row lock — the interleaving was not staged');
}

/**
 * One staged round of the conversion-gap race: seed a cohort under a fresh
 * teacher, start the session, and fire a refresh aimed into the conversion's
 * armed-tap work. Asserts the invariant unconditionally and REPORTS whether
 * the two actually met, so the caller can retry a round that missed rather
 * than redden a sound engine — see the call site.
 */
async function conversionGapRound(tag: string): Promise<boolean> {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `Gap ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `gap-teacher-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: `Gap ${tag}`,
        joinCode: `GAP${tag}`,
      })
      .returning(),
  );
  const boundary = new Date(Date.now() + 400);
  const students: string[] = [];
  const armedIds: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    const s = one(
      await db
        .insert(users)
        .values({ cognitoId: `gap-s-${tag}-${i}`, role: 'student', schoolId: school.id })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: klass.id, studentId: s.id });
    const armed = await armTap(db, {
      studentId: s.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      expiresAt: boundary,
      now: new Date(boundary.getTime() - 60_000),
    });
    students.push(s.id);
    // `armedTapId` is optional only for the `replay` that has no row; every
    // arm in this loop is a fresh one, so a missing id means the seeding
    // itself went wrong and the race below would be staged against nothing.
    expect(armed.armedTapId, `seeding student ${i} did not arm a row`).toBeDefined();
    armedIds.push(armed.armedTapId!);
  }

  const conversion = startSession(db, {
    classId: klass.id,
    startedAt: new Date(boundary.getTime() - 1_000),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  const refresh = (async () => {
    // Land inside the conversion loop, aimed by watching for it rather than
    // by sleeping a fixed 12 ms and hoping.
    await waitForBackendOnArmedTaps();
    return armTap(db, {
      studentId: students[40]!,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      now: new Date(boundary.getTime() + 1_000),
    });
  })();

  // Did the two actually meet? REPORTED, not asserted, because a round that
  // missed is a round to run again rather than a verdict — see the caller.
  //
  // It is a staging signal, not a mutation kill, and worth being exact
  // about: it observes that a backend parked on A lock, not WHICH one, and
  // with the FOR UPDATE removed the refresh can still park on the row lock
  // the conversion takes writing consumed_at. What actually catches that
  // mutation is the invariant below — measured over the retried rounds, red
  // 6 runs out of 6, and every time with "names event … which no tap_in
  // recorded" rather than with this gate.
  //
  // 2 s, not the helper's 5 s default: three rounds of a 5 s wait would
  // outlive the test budget and report "Test timed out", which says nothing.
  //
  // Settled first, so a rejection from either side is observed while the
  // gate runs rather than surfacing as an unhandled rejection.
  const settled = Promise.allSettled([conversion, refresh]);
  let contended = true;
  try {
    await waitForBlockedBackend(2_000);
  } catch {
    contended = false;
  }
  const [started, refreshed] = await settled;
  // Name the reason, on BOTH sides. A bare `expected 'rejected' to be
  // 'fulfilled'` tells the next person nothing about which throw fired, and
  // several are reachable from each. Dropping the conversion's was worse
  // still: a Start that threw surfaced further down as
  // `expected 0 to be greater than 0`, which names nothing at all.
  if (started.status === 'rejected') {
    throw new Error(`the conversion rejected: ${String(started.reason)}`, {
      cause: started.reason,
    });
  }
  if (refreshed.status === 'rejected') {
    throw new Error(`the refresh rejected: ${String(refreshed.reason)}`, {
      cause: refreshed.reason,
    });
  }

  const consumed = await db
    .select()
    .from(armedTaps)
    .where(and(eq(armedTaps.teacherId, teacher.id), isNotNull(armedTaps.consumedAt)));
  expect(consumed.length).toBeGreaterThan(0);
  // The invariant is that a consumed row names an event that EXISTS — not
  // specifically a `tap_in`. The narrower version was true when every
  // consumed tap was a converted one, and this branch broke that: a spent tap
  // is consumed and SKIPPED, minting nothing under its own id (its skip is
  // recorded under a fresh one), so the event under that id is whatever
  // recorded it first. No tap in this cohort carries a spent id
  // today, so the narrow form still passed — it would just have reddened one
  // day for a reason that is not a bug, and the message would have lied about
  // which one. The orphan this test exists for is unaffected: a refresh that
  // slipped inside the conversion leaves the row naming an id that appears in
  // NO event at all, so both forms of this assertion catch it identically —
  // measured across the two, red 9 runs out of 10, the tenth being a round
  // where the retry landed outside the window rather than a missed orphan.
  for (const row of consumed) {
    const recorded = await db
      .select({ eventId: events.eventId })
      .from(events)
      .where(eq(events.eventId, row.eventId));
    expect(
      recorded,
      `consumed armed tap ${row.id} names event ${row.eventId}, which no event recorded`,
    ).toHaveLength(1);
  }

  // Conditional on purpose: whether the conversion or the refresh reached
  // row 40 first is a race, and BOTH orders are correct. Asserting one of
  // them unconditionally would turn a sound engine red on a slow runner.
  // What is not negotiable is the pairing — if the conversion took the row,
  // the refresh must have started a fresh one rather than recycling it.
  if (consumed.some((row) => row.id === armedIds[40]) && refreshed.status === 'fulfilled') {
    expect(refreshed.value.armedTapId).not.toBe(armedIds[40]);
  }
  return contended;
}

describe.runIf(REAL_PG)('armed taps under contention (real Postgres)', () => {
  /*
   * Both races below need a WARM pool. A cold second connection spends its TCP
   * handshake while the first transaction runs to completion, which serialises
   * the pair and hides the race entirely — measured: with the fix reverted and
   * this warm-up removed, round 0 passes.
   *
   * That is why the warm-up is here, not why the bug survived: before these
   * tests there was no armed-tap coverage in this file at all.
   */
  beforeAll(async () => {
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
  });

  it('two simultaneous pre-bell taps leave one waiting tap and no raw unique violation', async () => {
    for (let round = 0; round < 15; round += 1) {
      const { classId, studentId } = await seed(`race-arm-${round}`);
      const teacherId = one(
        await db.select({ id: classes.teacherId }).from(classes).where(eq(classes.id, classId)),
      ).id;
      const tap = () =>
        armTap(db, {
          studentId,
          teacherId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        });

      const results = await Promise.allSettled([tap(), tap()]);

      // The index arbitrates, so the loser reads the winner's tap back instead
      // of surfacing 23505 as a 500 to a student's phone.
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.map((r) => String(r.reason))).toEqual([]);
      const outcomes = results
        .map((r) => (r.status === 'fulfilled' ? r.value.outcome : 'rejected'))
        .sort();
      expect(outcomes).toEqual(['already_armed', 'armed']);

      // Decision 5: "nobody taps twice" — one waiting row per student+teacher.
      const waiting = await db
        .select()
        .from(armedTaps)
        .where(and(eq(armedTaps.studentId, studentId), isNull(armedTaps.consumedAt)));
      expect(waiting).toHaveLength(1);
    }
  });

  it('two Starts racing over one spent waiting tap record exactly one skip', async () => {
    /*
     * Two classes of one teacher start at the same moment, and the student
     * holds one waiting tap whose id already landed — so both Starts select
     * it. `armed_tap_skipped` is history, and history must say it once: the
     * Start that locks the row first consumes it and records the skip, and
     * the other's FOR UPDATE waits, re-checks `consumed_at`, and drops the
     * row. Read without the lock, both see it waiting and both record a skip
     * for one tap.
     */
    for (let round = 0; round < 20; round += 1) {
      const tag = `race-skip-${round}`;
      const { classId, studentId } = await seed(tag);
      const cls = one(await db.select().from(classes).where(eq(classes.id, classId)));
      const other = one(
        await db
          .insert(classes)
          .values({
            teacherId: cls.teacherId,
            schoolId: cls.schoolId,
            name: `Other ${tag}`,
            joinCode: `${tag}-b`,
          })
          .returning(),
      );
      await db.insert(enrollments).values({ classId: other.id, studentId });

      // The tap lands in an earlier session, which ends; its id is then left
      // waiting — written directly, since armTap refuses a spent id.
      const earlier = await openSession(classId);
      const spent = newUuidV7();
      await tapIn(db, { sessionId: earlier.id, studentId, eventId: spent, deviceTime: new Date() });
      await endSession(db, { sessionId: earlier.id, at: new Date(), reason: 'ended' });
      await db.insert(armedTaps).values({
        studentId,
        teacherId: cls.teacherId,
        eventId: spent,
        deviceTime: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      const started = await Promise.all([openSession(classId), openSession(other.id)]);

      const skips = await db
        .select()
        .from(events)
        .where(and(eq(events.type, 'armed_tap_skipped'), eq(events.userId, studentId)));
      expect(skips, `round ${round}: one tap, one skip`).toHaveLength(1);
      for (const s of started) expect(await liveParticipations(s.id)).toHaveLength(0);
      const row = one(await db.select().from(armedTaps).where(eq(armedTaps.eventId, spent)));
      expect(row.consumedAt).not.toBeNull();
    }
  });

  it('a refresh landing inside a conversion cannot orphan its event id', async () => {
    /*
     * The other half of the same invariant, and the one a row guard cannot
     * reach. convertArmedTaps reads its waiting taps, then consumes them
     * several statements later. A refresh landing in that gap sees consumed_at
     * still NULL, so the guard passes, it writes its own event id onto the
     * row — and the conversion then records tap_in with the id it read BEFORE
     * the refresh. The armed tap is left naming an event no tap_in recorded.
     *
     * Closed by convertArmedTaps taking FOR UPDATE on the taps it reads, so
     * the refresh waits and its guard then correctly fails. Staged with a
     * large cohort so the conversion loop is long enough to land inside.
     *
     * The staging is checked, not hoped for — and it took three goes to get
     * that check right, which is worth leaving written down.
     *
     * v1 fired both sides on a bare 12 ms sleep and asserted only the
     * invariant: on a loaded runner the refresh lands after the conversion has
     * committed, the plain-insert path is taken, every consumed row still
     * names its original id, and the whole thing passes with FOR UPDATE
     * removed. v2 added a gate that FAILED when nothing contended — which
     * closed the false pass and opened a false failure, because a missed
     * window is not a bug. That bit for real: adding a query to the front of
     * `armTap` gave the refresh one more round-trip to make, and the gate
     * started reddening a sound engine. v3, here, retries the round instead.
     *
     * Each round asserts the invariant regardless, so the bug is caught by a
     * round that ran; the gate only has to succeed once for "these two never
     * met" to be ruled out. It still does not prove WHICH lock was contended
     * (with FOR UPDATE removed the refresh can park on the consumed_at row
     * lock instead), so this is a better test, not a proof by construction.
     */
    // Retried rather than asserted on the first attempt, and that is the whole
    // difference between this and a flake. The round below only stages if the
    // refresh's UPDATE arrives while the conversion still holds its FOR UPDATE
    // set, and the refresh needs four round-trips to get there (two event-id
    // lookups, the waiting read, the update). On a loaded runner — or after
    // any change that adds a query ahead of it, which is exactly what happened
    // here — the conversion can commit first, nothing blocks, and a sound
    // engine reads as red. Seen once, for real.
    //
    // Each round asserts the invariant regardless, so a bad engine is caught
    // by the round that ran, not by the gate. The gate only has to succeed
    // ONCE across the rounds for "these two never met" to be ruled out, which
    // is all it was ever there to rule out.
    let contended = false;
    for (let round = 0; round < 3 && !contended; round += 1) {
      contended = await conversionGapRound(`r${round}`);
    }
    expect(
      contended,
      'three rounds and the refresh never once waited on a lock, though each ran while the ' +
        'conversion was inside its armed-tap work — the conversion is not holding the rows ' +
        'it converts',
    ).toBe(true);
    // Explicit budget: up to three rounds, each seeding 60 students, starting a
    // session and staging a race inside it. The default 5 s leaves no room for
    // the assertion above to report, which is the failure worth reading.
    //
    // 20 s and not more, which review has now read as tight twice — so here
    // is the measurement rather than the arithmetic. Both waits above are
    // polling loops that return on first success, not sleeps, so their 1.5 s
    // and 2 s are CEILINGS paid only by a round that misses. Seven passing
    // runs on the real lane: 459 ms in a full suite, then 636/677/680/703/742
    // ms isolated — and one at 2949 ms, which is what a retried round costs.
    // So a pass is usually one round under a second, and sometimes two under
    // three. The worst case, all three rounds missing, was staged by
    // poisoning both poll predicates and measured at 7.2 s, ending on the
    // assertion above rather than on the clock — the property that matters.
    // (Adding the ceilings up gives ~12 s. That is derived and wrong: the two
    // waits overlap in wall clock. The numbers above are not derived.)
  }, 20_000);

  it('a delivery that loses the event_id index is answered as a replay, not a 500', async () => {
    /*
     * `armed_taps` has TWO unique indexes and `armTap`'s ON CONFLICT names
     * only one of them. The arbiter is (student, teacher) WHERE consumed_at
     * IS NULL; `event_id` carries its own, and that one is reachable: a
     * concurrent delivery of the SAME tap can be invisible to the `exact`
     * select (uncommitted) and yet already CONSUMED by the time the insert
     * runs — so it is outside the partial index, the arbiter finds nothing to
     * arbitrate, and the insert lands on armed_taps_event_id_unique. Escaping,
     * that is a raw 23505 out of POST /v1/taps: the same 500 on a pre-bell tap
     * the ON CONFLICT was added to remove, through the other index.
     *
     * Staged, not hoped for, and the holder is what makes the `exact` select
     * miss: an open transaction inserts the rival row and sits on it, so
     * armTap sees nothing, reaches its insert, and parks on the unique index.
     * Releasing the holder lets it resume into the conflict this test is about.
     * The row is inserted already-consumed so the partial index cannot be what
     * it collides with.
     */
    const { classId, studentId } = await seed('race-arm-eventid');
    const teacherId = one(
      await db.select({ id: classes.teacherId }).from(classes).where(eq(classes.id, classId)),
    ).id;
    const eventId = newUuidV7();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const hasRow = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    let rivalId = '';
    const rival = db.transaction(async (tx) => {
      const row = one(
        await tx
          .insert(armedTaps)
          .values({
            studentId,
            teacherId,
            eventId,
            deviceTime: new Date(),
            expiresAt: new Date(Date.now() + 3_600_000),
            // Consumed, so the waiting partial index is NOT what collides.
            consumedAt: new Date(),
          })
          .returning(),
      );
      rivalId = row.id;
      inserted(); // uncommitted: invisible to armTap's `exact` select
      await held;
    });

    await hasRow;
    const arming = armTap(db, {
      studentId,
      teacherId,
      eventId,
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      now: new Date(),
    });
    // It must genuinely park on the index, not merely be slow: without the
    // block, armTap's insert would have succeeded and this would be testing
    // the ordinary arming path.
    //
    // Released in a finally: a gate that times out must not leave the holder
    // sitting on an uncommitted row forever, with `arming` parked behind it,
    // never awaited and never settled — that wedges the whole real-PG suite
    // rather than failing this one test.
    let unstaged: Error | null = null;
    try {
      await waitForBlockedBackend();
    } catch (err) {
      unstaged = err instanceof Error ? err : new Error(String(err));
    } finally {
      release();
    }
    await rival;
    const settled = await Promise.allSettled([arming]);
    if (unstaged !== null) throw unstaged;
    if (settled[0].status === 'rejected') throw settled[0].reason as Error;
    const result = settled[0].value;
    expect(result.outcome).toBe('replay');
    expect(result.armedTapId).toBe(rivalId);
    // And exactly one row owns the id — nothing was written twice.
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.eventId, eventId));
    expect(rows).toHaveLength(1);
  }, 20_000);

  it('a spent row that wins the slot late is still taken over, not reported back', async () => {
    /*
     * The fallback door into the same failure the standing-row check closes.
     *
     * `armTap` reads the waiting row before it inserts, and that read cannot
     * see an uncommitted rival — so a row it missed can win the
     * (student, teacher) partial index and turn up only in the re-read after
     * the ON CONFLICT. If that row carries a SPENT id, answering
     * `already_armed` about it drops this physical tap, and the conversion
     * then skips the row at Start: told "armed", joined never. Exactly what
     * the standing-row branch was fixed for, one door further in.
     *
     * Staged the way the sibling tests stage theirs: a held transaction owns
     * the row, so `armTap`'s read misses it and its insert parks on the
     * index; releasing the holder lets it resume into the re-read.
     */
    const { classId, studentId } = await seed('race-arm-late-spent');
    const teacherId = one(
      await db.select({ id: classes.teacherId }).from(classes).where(eq(classes.id, classId)),
    ).id;

    // A genuinely spent id: it landed as a tap_in, and that session is over.
    const spentId = newUuidV7();
    const past = await openSession(classId);
    await tapIn(db, { sessionId: past.id, studentId, eventId: spentId, deviceTime: new Date() });
    await endSession(db, { sessionId: past.id, at: new Date(), reason: 'ended' });

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const hasRow = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    let rivalId = '';
    const rival = db.transaction(async (tx) => {
      const row = one(
        await tx
          .insert(armedTaps)
          .values({
            studentId,
            teacherId,
            eventId: spentId,
            deviceTime: new Date(),
            expiresAt: new Date(Date.now() + 3_600_000), // NOT expired: spent is the only staleness
          })
          .returning(),
      );
      rivalId = row.id;
      inserted(); // uncommitted: invisible to armTap's waiting read
      await held;
    });

    await hasRow;
    const freshId = newUuidV7();
    const arming = armTap(db, {
      studentId,
      teacherId,
      eventId: freshId,
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      now: new Date(),
    });
    let unstaged: Error | null = null;
    try {
      await waitForBlockedBackend();
    } catch (err) {
      unstaged = err instanceof Error ? err : new Error(String(err));
    } finally {
      release();
    }
    await rival;
    const settled = await Promise.allSettled([arming]);
    if (unstaged !== null) throw unstaged;
    if (settled[0].status === 'rejected') {
      throw new Error(`arming rejected: ${String(settled[0].reason)}`, {
        cause: settled[0].reason,
      });
    }
    const result = settled[0].value;

    // The fresh tap takes the slot. Reporting `already_armed` about the
    // rival's spent row would lose it.
    expect(result.outcome).toBe('armed');
    expect(result.armedTapId).toBe(rivalId); // the row is recycled, not duplicated
    const rows = await db
      .select()
      .from(armedTaps)
      .where(and(eq(armedTaps.teacherId, teacherId), isNull(armedTaps.consumedAt)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId, 'the waiting row carries the fresh id now').toBe(freshId);
  }, 20_000);

  it('a refresh that loses the event_id index is answered, not a raw 23505', async () => {
    /*
     * The sibling of the test above, on the OTHER write. `armTap` has two ways
     * to put `input.eventId` into `armed_taps`: the insert below, and the
     * refresh that recycles a stale standing row. Both write a column carrying
     * its own unique index after the same non-locking `exact` read, so both
     * can lose that index to an uncommitted rival — and the stale check this
     * branch added widened the refresh path from "expired rows only" to every
     * standing row whose id is already spent, so it is taken far more often
     * than it used to be. Unguarded, that 23505 aborts the whole transaction
     * and POST /v1/taps answers 500 on a pre-bell tap: the exact failure the
     * insert's savepoint exists to remove, reached through the other write.
     *
     * Staged the same way: a held transaction owns the id, invisible to
     * `exact`, so the refresh parks on the index and resumes into the
     * conflict. The rival is inserted already-consumed so the WAITING partial
     * index cannot be what it collides with, and the standing row is expired
     * so the refresh path is the one taken.
     */
    const { classId, studentId } = await seed('race-arm-refresh-eventid');
    const teacherId = one(
      await db.select({ id: classes.teacherId }).from(classes).where(eq(classes.id, classId)),
    ).id;
    const eventId = newUuidV7();
    const standingEventId = newUuidV7();

    // The stale standing row the refresh will try to recycle.
    const standing = one(
      await db
        .insert(armedTaps)
        .values({
          studentId,
          teacherId,
          eventId: standingEventId,
          deviceTime: new Date(),
          expiresAt: new Date(Date.now() - 1_000), // expired: stale, so it is refreshed
        })
        .returning(),
    );

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const hasRow = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    let rivalId = '';
    const rival = db.transaction(async (tx) => {
      const row = one(
        await tx
          .insert(armedTaps)
          .values({
            studentId,
            teacherId,
            eventId,
            deviceTime: new Date(),
            expiresAt: new Date(Date.now() + 3_600_000),
            consumedAt: new Date(), // outside the waiting partial index
          })
          .returning(),
      );
      rivalId = row.id;
      inserted(); // uncommitted: invisible to armTap's `exact` select
      await held;
    });

    await hasRow;
    const arming = armTap(db, {
      studentId,
      teacherId,
      eventId,
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      now: new Date(),
    });
    // Released in a finally, for the reason the sibling test documents: a gate
    // that times out must not leave the holder on an uncommitted row with
    // `arming` parked behind it and never awaited.
    let unstaged: Error | null = null;
    try {
      await waitForBlockedBackend();
    } catch (err) {
      unstaged = err instanceof Error ? err : new Error(String(err));
    } finally {
      release();
    }
    await rival;
    const settled = await Promise.allSettled([arming]);
    if (unstaged !== null) throw unstaged;
    if (settled[0].status === 'rejected') throw settled[0].reason as Error;
    const result = settled[0].value;
    expect(result.outcome).toBe('replay');
    expect(result.armedTapId).toBe(rivalId);

    // The savepoint rolled back only the refresh: the standing row still
    // carries its original id, and the outer transaction stayed usable long
    // enough to read the owner and answer.
    const after = one(await db.select().from(armedTaps).where(eq(armedTaps.id, standing.id)));
    expect(after.eventId).toBe(standingEventId);
    expect(after.consumedAt).toBeNull();
    const rows = await db.select().from(armedTaps).where(eq(armedTaps.eventId, eventId));
    expect(rows).toHaveLength(1);
  }, 20_000);

  it('a refresh never writes its event id onto a tap consumed under it', async () => {
    /*
     * The narrow window: a session that began just before the school-day
     * expiry boundary consumes a waiting tap at the same moment a fresh tap
     * judges that tap stale and recycles it. Unguarded, the refresh writes its
     * event id onto the row the conversion just consumed — the armed tap then
     * claims an id no tap_in ever recorded, and the phone is told "armed"
     * while the student is in the session.
     *
     * Staged rather than hoped for. The interleaving needs the consuming write
     * to land BETWEEN the refresh's select and its update, which a plain
     * Promise.all almost never produces (startSession does its class lock and
     * two inserts first, so armTap finishes long before it). So a held
     * transaction takes the row lock and releases it on cue: armTap's select
     * sees the tap unconsumed, its update then blocks on that lock, and it
     * resumes to find the row consumed — exactly the state the guard is for.
     * The test writes armed_taps directly, which is allowed: it is the
     * transient table, not participations or events.
     */
    const { classId, studentId } = await seed('race-arm-consumed');
    const teacherId = one(
      await db.select({ id: classes.teacherId }).from(classes).where(eq(classes.id, classId)),
    ).id;
    const expiresAt = new Date(Date.now() - 1_000); // already stale
    const originalEventId = newUuidV7();
    await armTap(db, {
      studentId,
      teacherId,
      eventId: originalEventId,
      deviceTime: new Date(),
      expiresAt,
      now: new Date(expiresAt.getTime() - 60_000),
    });
    const tap = one(await db.select().from(armedTaps).where(eq(armedTaps.studentId, studentId)));

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const consuming = db.transaction(async (tx) => {
      await tx.update(armedTaps).set({ consumedAt: new Date() }).where(eq(armedTaps.id, tap.id));
      locked(); // the row lock is ours now, and held until `release`
      await held;
    });

    await hasLock;
    const refreshEventId = newUuidV7();
    const refreshing = armTap(db, {
      studentId,
      teacherId,
      eventId: refreshEventId,
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      now: new Date(),
    });
    // Wait for armTap to actually BLOCK on the row lock, rather than sleeping
    // and hoping. With a fixed sleep this test has a silent false-pass: on a
    // loaded box armTap may not have reached its update yet, the holder
    // commits first, armTap's select then sees consumed_at already set and
    // takes the plain-insert path — every assertion below still holds, with
    // the bug present. Failing to observe the block fails the test instead.
    //
    // Released in a finally, like the tests above: a gate that times out must
    // not leave the holder on its row lock with `refreshing` parked behind it.
    let unstaged: Error | null = null;
    try {
      await waitForBlockedBackend();
    } catch (err) {
      unstaged = err instanceof Error ? err : new Error(String(err));
    } finally {
      release();
    }
    await consuming;
    const settled = await Promise.allSettled([refreshing]);
    if (unstaged !== null) throw unstaged;
    if (settled[0].status === 'rejected') throw settled[0].reason as Error;
    const result = settled[0].value;

    // The consumed row is untouched: it still names the event its conversion
    // would have recorded, not the tap that arrived afterwards.
    const after = one(await db.select().from(armedTaps).where(eq(armedTaps.id, tap.id)));
    expect(after.consumedAt).not.toBeNull();
    expect(after.eventId).toBe(originalEventId);

    // And the late tap is recorded honestly, as its own waiting row.
    expect(result.outcome).toBe('armed');
    expect(result.armedTapId).toBeDefined();
    expect(result.armedTapId).not.toBe(tap.id);
    const fresh = one(
      await db.select().from(armedTaps).where(eq(armedTaps.id, result.armedTapId!)),
    );
    expect(fresh.eventId).toBe(refreshEventId);
    expect(fresh.consumedAt).toBeNull();
  }, 20_000);
});
