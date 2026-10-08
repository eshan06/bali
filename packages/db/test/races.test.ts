import type { EventType } from '@bali/shared';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordAgeCheck, type RecordAgeCheckResult } from '../src/age-checks.js';
import { registerPushToken } from '../src/device-tokens.js';
import { newUuidV7 } from '../src/ids.js';
import { createBlock, createClass } from '../src/management.js';
import { findOrCreateStudent, findUserByCognitoId } from '../src/queries.js';
import { hasSqlState } from '../src/sql-errors.js';
import {
  ageChecks,
  armedTaps,
  blocks,
  classes,
  deviceTokens,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  teacherInvites,
  users,
} from '../src/schema.js';
import {
  createSchool,
  type MintInviteResult,
  mintTeacherInvite,
  recordAgreement,
  type RedeemInviteResult,
  redeemTeacherInvite,
} from '../src/schools.js';
import { makeTestDb } from '../src/testing.js';
import {
  applyRetention,
  armTap,
  changeUnlockReason,
  checkIn,
  deleteAccount,
  disposeSchool,
  endEnrollment,
  endSession,
  expireDueSessions,
  extendSession,
  joinClassByCode,
  markSilentParticipations,
  protectionOff,
  protectionOn,
  refocus,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  unlockUnderTap,
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
  return { classId: klass.id, studentId: student.id, teacherId: teacher.id };
}

/**
 * A student in three teachers' classes (A14): A and B running, Y not started,
 * so a tap of Y's block waits for its Start.
 */
async function rooms(tag: string) {
  const a = await seed(`${tag}-a`);
  const b = await seed(`${tag}-b`);
  const y = await seed(`${tag}-y`);
  await db.insert(enrollments).values([
    { classId: b.classId, studentId: a.studentId },
    { classId: y.classId, studentId: a.studentId },
  ]);
  const [sa, sb] = [await openSession(a.classId), await openSession(b.classId)];
  return { studentId: a.studentId, sa, sb, y };
}

/** A tap into `sessionId`, the phone's order on it. */
function aTap(
  sessionId: string,
  studentId: string,
  deviceTime: Date,
  order: { install: string; seq: number },
) {
  return { sessionId, studentId, eventId: newUuidV7(), deviceTime, order };
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

/** A student's live participations, wherever they are. */
function liveOf(studentId: string) {
  return db
    .select()
    .from(participations)
    .where(and(eq(participations.studentId, studentId), isNull(participations.endedAt)));
}

async function eventOf(eventId: string) {
  return one(await db.select().from(events).where(eq(events.eventId, eventId)));
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

  it('an expiry racing another sweep’s silence pass ends the session once, never failing on a deadlock', async () => {
    // A15: every API process sweeps each minute and Railway's cron is its
    // backup, each on its own phase, so one run's expiry can meet another
    // run's silence pass on the same session — a run whose clock found the
    // session not yet due goes straight to that pass. Opposite lock orders:
    // the expiry (endSession) locks the session, then its participations; the
    // silence pass locks a participation, then the session's key-share for its
    // went_silent. Postgres aborts one side with 40P01, and both retry it.
    // Whichever wins, the session ends once, every row with it, and the phone
    // goes silent at most once.
    const stale = new Date(Date.now() - 5 * 60_000);
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId } = await seed(`race-sweeps-${round}`);
      const session = await openSession(classId, { due: true });
      await tapIn(db, {
        sessionId: session.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        now: session.startedAt, // heard while it ran (A17)
      });
      await db
        .update(participations)
        .set({ lastSeenAt: stale })
        .where(eq(participations.sessionId, session.id));

      const now = new Date();
      const [ended] = await Promise.all([
        expireDueSessions(db, now),
        markSilentParticipations(db, now),
      ]);

      // A lost expiry is swallowed by the pass (logged, retried next minute),
      // so "ended" is what shows it retried rather than gave up.
      expect(ended).toContain(session.id);
      expect(await eventsOfType(session.id, 'session_expired')).toHaveLength(1);
      expect(await liveParticipations(session.id)).toHaveLength(0);
      expect((await eventsOfType(session.id, 'went_silent')).length).toBeLessThanOrEqual(1);
    }
  }, 120_000);

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

  it('a late unlock racing the return that went ahead of it always ends in the return (A10)', async () => {
    // An unlock stuck on the phone lands as the student's own later refocus or
    // re-tap does. Both lock the session FOR UPDATE, and the unlock judges
    // "after" under that lock, so either order ends in focus: unlock first
    // flips (nothing has returned since it yet) and the return then takes
    // over; the return first, and the unlock is recorded as superseded,
    // flipping nothing. Never an unlock left standing over the return, and
    // the unlock always recorded.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['refocus', 'tap'] as const) {
        const { classId, studentId } = await seed(`race-late-unlock-${rival}-${round}`);
        const session = await openSession(classId);
        const change = (deviceTime: Date) => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime,
        });
        await tapIn(db, change(ago(50)));
        if (rival === 'refocus') await unlock(db, change(ago(40)));

        // Odd rounds give the return a head start, so both orders get exercised.
        const lateUnlock = () => unlock(db, change(ago(45)));
        const [late, back] = await Promise.allSettled([
          round % 2 === 1
            ? new Promise((resolve) => setTimeout(resolve, 10)).then(lateUnlock)
            : lateUnlock(),
          rival === 'refocus' ? refocus(db, change(ago(30))) : tapIn(db, change(ago(30))),
        ]);

        if (late.status === 'rejected') throw late.reason;
        if (back.status === 'rejected') throw back.reason;
        expect(one(await liveParticipations(session.id)).state).toBe('focused');
        const lateEvent = (await eventsOfType(session.id, 'unlock')).at(-1)!;
        const returned = (
          await eventsOfType(session.id, rival === 'tap' ? 'tap_in' : 'refocus')
        ).at(-1)!;
        // Superseded exactly when the return committed first.
        if (returned.seq < lateEvent.seq) {
          expect(late.value).toMatchObject({ outcome: 'recorded', recordedAs: 'superseded' });
          expect(lateEvent.payload).toEqual({ recorded_as: 'superseded' });
        } else {
          expect(late.value).toMatchObject({ outcome: 'applied', recordedAs: null });
          expect(lateEvent.payload).toBeNull();
        }
        expect(await eventsOfType(session.id, 'unlock')).toHaveLength(rival === 'refocus' ? 2 : 1);
      }
    }
  }, 120_000);

  it('a late unlock racing the return that went ahead of it ends in the return by the phone’s order, whatever its clock (A12)', async () => {
    // A10's race, on a clock turned back between the two: the return claims
    // to be older than the stuck unlock it went ahead of, so only the phone's
    // order says which came last — and the unlock reads it under the session
    // lock the return takes too. The return first: the unlock is late by the
    // order (by the times it would flip, the grid "Unlocked" over a phone back
    // in focus). The unlock first: it flips, and the return takes over. Focus
    // either way, and the unlock always recorded.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    const install = newUuidV7();
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['refocus', 'tap'] as const) {
        const { classId, studentId } = await seed(`race-order-${rival}-${round}`);
        const session = await openSession(classId);
        const change = (deviceTime: Date, seq: number) => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime,
          order: { install, seq },
        });
        await tapIn(db, change(ago(50), 1));
        if (rival === 'refocus') await unlock(db, change(ago(40), 2));

        // The phone's #3, stuck; its #4 a return made after it, timed before.
        const lateUnlock = () => unlock(db, change(ago(30), 3));
        const back = change(ago(45), 4);
        const [late, returned] = await Promise.allSettled([
          round % 2 === 1
            ? new Promise((resolve) => setTimeout(resolve, 10)).then(lateUnlock)
            : lateUnlock(),
          rival === 'refocus' ? refocus(db, back) : tapIn(db, back),
        ]);

        if (late.status === 'rejected') throw late.reason;
        if (returned.status === 'rejected') throw returned.reason;
        expect(one(await liveParticipations(session.id)).state).toBe('focused');
        const lateEvent = (await eventsOfType(session.id, 'unlock')).at(-1)!;
        const backEvent = one(
          await db.select().from(events).where(eq(events.eventId, back.eventId)),
        );
        // Late exactly when the return committed first.
        if (backEvent.seq < lateEvent.seq) {
          expect(late.value).toMatchObject({ outcome: 'recorded', recordedAs: 'superseded' });
        } else {
          expect(late.value).toMatchObject({ outcome: 'applied', recordedAs: null });
        }
        expect(lateEvent).toMatchObject({ orderInstall: install, orderSeq: 3 });
        expect(await eventsOfType(session.id, 'unlock')).toHaveLength(rival === 'refocus' ? 2 : 1);
      }
    }
  }, 120_000);

  it('a late return racing the unlock the phone made after it ends unlocked, whichever lands first (A13)', async () => {
    // A refocus or re-tap (#3) whose request outlived the phone's wait, or
    // whose tap was stuck, and the Emergency Unlock (#4) made after it. Both
    // lock the session FOR UPDATE, and the return judges "late" under that
    // lock. The unlock first: the return is recorded, never applied. The
    // return first: it applies, and the unlock — after it by the order — then
    // flips it. Unlocked either way, and each recorded once.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    const install = newUuidV7();
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['refocus', 'tap'] as const) {
        const { classId, studentId } = await seed(`race-late-return-${rival}-${round}`);
        const session = await openSession(classId);
        const change = (deviceTime: Date, seq: number) => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime,
          order: { install, seq },
        });
        await tapIn(db, change(ago(50), 1));
        await unlock(db, change(ago(45), 2));

        const back = change(ago(40), 3);
        const theReturn = () => (rival === 'refocus' ? refocus(db, back) : tapIn(db, back));
        const newer = change(ago(30), 4);
        const theUnlock = () => unlock(db, newer);
        // Each round gives one side a head start, so both orders get exercised:
        // left alone, the unlock nearly always wins a tap, which locks its id first.
        const later = (fn: () => Promise<unknown>) =>
          new Promise((resolve) => setTimeout(resolve, 10)).then(fn);
        const [returned, unlocked] = await Promise.allSettled([
          round % 2 === 1 ? later(theReturn) : theReturn(),
          round % 2 === 0 ? later(theUnlock) : theUnlock(),
        ]);

        if (returned.status === 'rejected') throw returned.reason;
        if (unlocked.status === 'rejected') throw unlocked.reason;
        expect(one(await liveParticipations(session.id)).state).toBe('unlocked');
        const eventOf = async (eventId: string) =>
          one(await db.select().from(events).where(eq(events.eventId, eventId)));
        const [backEvent, newerEvent] = [await eventOf(back.eventId), await eventOf(newer.eventId)];
        // Late exactly when the unlock committed first.
        if (newerEvent.seq < backEvent.seq) {
          expect(returned.value).toMatchObject({ outcome: 'replay', state: 'unlocked' });
          expect(backEvent.payload).toEqual({ recorded_as: 'superseded' });
        } else {
          expect(returned.value).toMatchObject({ state: 'focused' });
          expect(backEvent.payload).toBeNull();
          expect(unlocked.value).toMatchObject({ outcome: 'applied', recordedAs: null });
        }
        expect(await eventsOfType(session.id, rival === 'tap' ? 'tap_in' : 'refocus')).toHaveLength(
          rival === 'tap' ? 2 : 1,
        );
      }
    }
  }, 120_000);

  it('a tap older than one into another class, racing it, ends in the later one’s class (A14)', async () => {
    // Into A (#1), the request slow, then into B (#2). Each takes the
    // student's lock before its session's and judges late under it. B's
    // first: A's is recorded, never applied. A's first: it joins A, and B's
    // then switches. In B either way, and each tap recorded once.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    const install = newUuidV7();
    for (let round = 0; round < 12; round += 1) {
      const { studentId, sa, sb } = await rooms(`race-a14-${round}`);
      const older = aTap(sa.id, studentId, ago(20), { install, seq: 1 });
      const newer = aTap(sb.id, studentId, ago(10), { install, seq: 2 });
      // Each round gives one side a head start, so both orders get exercised.
      const later = (fn: () => Promise<unknown>) =>
        new Promise((resolve) => setTimeout(resolve, 10)).then(fn);
      const [olderTap, newerTap] = await Promise.allSettled([
        round % 2 === 1 ? later(() => tapIn(db, older)) : tapIn(db, older),
        round % 2 === 0 ? later(() => tapIn(db, newer)) : tapIn(db, newer),
      ]);
      if (olderTap.status === 'rejected') throw olderTap.reason;
      if (newerTap.status === 'rejected') throw newerTap.reason;

      expect(one(await liveOf(studentId)).sessionId).toBe(sb.id);
      const [olderEvent, newerEvent] = [await eventOf(older.eventId), await eventOf(newer.eventId)];
      if (newerEvent.seq < olderEvent.seq) {
        expect(olderTap.value).toMatchObject({ outcome: 'replay', session: null });
        expect(olderEvent.payload).toEqual({ recorded_as: 'superseded' });
      } else {
        expect(olderTap.value).toMatchObject({ outcome: 'joined' });
        expect(newerTap.value).toMatchObject({ outcome: 'switched' });
      }
    }
  }, 120_000);

  it('a tap that judged itself before a later one committed never switches the student back after it (A14)', async () => {
    // The interleaving `lockStudentTaps` exists for, staged: the older tap
    // judges itself not late, then parks — a holder owns its id on the events
    // index — while the later tap runs. Without the lock the later tap
    // commits the student into B, and the older one then switches them back
    // to A. With it the later tap waits, and switches them to B last.
    const { studentId, sa, sb } = await rooms('race-a14-staged');
    const install = newUuidV7();
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    const older = aTap(sa.id, studentId, ago(20), { install, seq: 1 });
    const newer = aTap(sb.id, studentId, ago(10), { install, seq: 2 });
    const [parked, raced] = await behindHolder(
      older.eventId,
      studentId,
      () => tapIn(db, older),
      () => tapIn(db, newer),
    );

    expect(parked).toMatchObject({ outcome: 'joined', session: { id: sa.id } });
    expect(raced).toMatchObject({ outcome: 'switched', session: { id: sb.id } });
    expect(one(await liveOf(studentId)).sessionId).toBe(sb.id);
  }, 20_000);

  it('a waiting tap older than a tap into another class, racing its Start, ends in the later one’s class (A14)', async () => {
    // Y's block (#1), waiting; into B (#2). The Start takes the student's
    // lock before it judges the waiting tap: the tap first, and the Start
    // declines it; the Start first, and it converts it — then the tap, after
    // it by the order, switches the student to B.
    const install = newUuidV7();
    for (let round = 0; round < 12; round += 1) {
      const { studentId, sb, y } = await rooms(`race-a14-start-${round}`);
      const armed = newUuidV7();
      await armTap(db, {
        studentId,
        teacherId: y.teacherId,
        eventId: armed,
        deviceTime: new Date(Date.now() - 20_000),
        order: { install, seq: 1 },
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const newer = aTap(sb.id, studentId, new Date(), { install, seq: 2 });
      const start = () =>
        startSession(db, {
          classId: y.classId,
          startedAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 25 * 60_000),
        });
      const later = (fn: () => Promise<unknown>) =>
        new Promise((resolve) => setTimeout(resolve, 10)).then(fn);
      const [started, tapped] = await Promise.allSettled([
        round % 2 === 1 ? later(start) : start(),
        round % 2 === 0 ? later(() => tapIn(db, newer)) : tapIn(db, newer),
      ]);
      if (started.status === 'rejected') throw started.reason;
      if (tapped.status === 'rejected') throw tapped.reason;

      expect(one(await liveOf(studentId)).sessionId).toBe(sb.id);
      const converted = await eventOf(armed);
      if (converted.seq > (await eventOf(newer.eventId)).seq) {
        expect(converted.payload).toEqual({ recorded_as: 'superseded' });
      } else {
        expect(converted.payload).toBeNull();
        expect(tapped.value).toMatchObject({ outcome: 'switched' });
      }
    }
  }, 120_000);

  it('an arm racing a later tap into another class, then its Start, ends in the later one’s class (A14)', async () => {
    // Y's block (#1) and B's (#2) at once. `armTap` takes no student lock, so
    // it may miss the tap still in flight and arm; then the Start judges it
    // again, under the lock, and declines it. Arm late, and it never waits.
    // In B either way, and never joined into Y.
    const install = newUuidV7();
    for (let round = 0; round < 12; round += 1) {
      const { studentId, sb, y } = await rooms(`race-a14-arm-${round}`);
      const armed = newUuidV7();
      const arm = () =>
        armTap(db, {
          studentId,
          teacherId: y.teacherId,
          eventId: armed,
          deviceTime: new Date(Date.now() - 20_000),
          order: { install, seq: 1 },
          expiresAt: new Date(Date.now() + 3_600_000),
        });
      const newer = aTap(sb.id, studentId, new Date(), { install, seq: 2 });
      const later = (fn: () => Promise<unknown>) =>
        new Promise((resolve) => setTimeout(resolve, 10)).then(fn);
      const [armedTap, tapped] = await Promise.allSettled([
        round % 2 === 1 ? later(arm) : arm(),
        round % 2 === 0 ? later(() => tapIn(db, newer)) : tapIn(db, newer),
      ]);
      if (armedTap.status === 'rejected') throw armedTap.reason;
      if (tapped.status === 'rejected') throw tapped.reason;
      expect(tapped.value).toMatchObject({ outcome: 'joined' });
      expect(['armed', 'replay']).toContain((armedTap.value as { outcome: string }).outcome);

      const { session, armedConverted } = await startSession(db, {
        classId: y.classId,
        startedAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      });
      expect(armedConverted).toBe(0);
      expect(one(await liveOf(studentId)).sessionId).toBe(sb.id);
      expect(await liveParticipations(session.id)).toHaveLength(0);
    }
  }, 120_000);

  it('a Start that judged its waiting tap before a later tap committed never switches the student back (A14)', async () => {
    // The same interleaving at a Start: it judges the waiting tap not late,
    // then parks on its `tap_in` — a holder owns the tap's id — while the
    // later tap runs. Without the Start's lock the tap commits the student
    // into B, and the conversion then switches them back into Y's session.
    const { studentId, sb, y } = await rooms('race-a14-start-staged');
    const install = newUuidV7();
    const armed = newUuidV7();
    await armTap(db, {
      studentId,
      teacherId: y.teacherId,
      eventId: armed,
      deviceTime: new Date(Date.now() - 20_000),
      order: { install, seq: 1 },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const newer = aTap(sb.id, studentId, new Date(), { install, seq: 2 });
    const [started, tapped] = await behindHolder(
      armed,
      studentId,
      () =>
        startSession(db, {
          classId: y.classId,
          startedAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 25 * 60_000),
        }),
      () => tapIn(db, newer),
    );

    expect(started).toMatchObject({ outcome: 'created', armedConverted: 1 });
    expect(tapped).toMatchObject({ outcome: 'switched', session: { id: sb.id } });
    expect(one(await liveOf(studentId)).sessionId).toBe(sb.id);
  }, 20_000);

  it('an unlock sent under a tap racing that tap ends unlocked, filed once, whichever lands first (decision 11)', async () => {
    // The phone sends in order, but a tap stuck at its retry bound steps aside
    // for the unlock behind it, and a request the phone gave up on may still
    // be running on the server. Tap first: the unlock is filed in its session.
    // Unlock first: it is kept unattached, and the tap then files it. Both
    // lock the tap first (`lockTap`), so one always sees the other.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId } = await seed(`race-tap-unlock-${round}`);
      const session = await openSession(classId);
      const tapId = newUuidV7();
      const theTap = () =>
        tapIn(db, { sessionId: session.id, studentId, eventId: tapId, deviceTime: ago(20) });
      const unlockId = newUuidV7();
      const theUnlock = () =>
        unlockUnderTap(db, {
          tapEventId: tapId,
          studentId,
          eventId: unlockId,
          deviceTime: ago(10),
        });

      // Even rounds give the unlock a head start, so both orders get exercised.
      const [tapped, unlocked] = await Promise.allSettled([
        round % 2 === 0 ? new Promise((resolve) => setTimeout(resolve, 10)).then(theTap) : theTap(),
        theUnlock(),
      ]);
      if (tapped.status === 'rejected') throw tapped.reason;
      if (unlocked.status === 'rejected') throw unlocked.reason;

      expect(one(await liveParticipations(session.id)).state).toBe('unlocked');
      const filed = one(await eventsOfType(session.id, 'unlock'));
      if (unlocked.value.recordedAs === 'unknown_tap') {
        expect(tapped.value.state).toBe('unlocked');
        expect(filed.payload).toEqual({ tap_event_id: tapId, unattached_event_id: unlockId });
      } else {
        expect(unlocked.value).toMatchObject({ outcome: 'applied', state: 'unlocked' });
        expect(filed.eventId).toBe(unlockId);
      }
    }
  }, 120_000);

  it('a tap and its unlock landing at once never both miss the other (decision 11)', async () => {
    // The interleaving `lockTap` exists for, staged: the unlock looks for its
    // tap before the tap has committed, and the tap looks for unlocks kept
    // under it before the unlock has. A holder owning the unlock's id parks
    // the unlock on the index right after its look, so the tap arrives while
    // the unlock is still uncommitted. Without the lock the tap commits
    // focused and the unlock then commits unattached — neither filed, the
    // grid green over a phone its student unlocked. With it the tap waits,
    // and files the unlock once it lands.
    const { classId, studentId } = await seed('race-tap-unlock-staged');
    const session = await openSession(classId);
    const tapId = newUuidV7();
    const unlockId = newUuidV7();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const hasRow = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const holder = db
      .transaction(async (tx) => {
        await tx
          .insert(events)
          .values({ eventId: unlockId, type: 'unlock', userId: studentId, occurredAt: new Date() });
        inserted();
        await held;
        throw new Error('rolled back on purpose');
      })
      .catch(() => undefined);
    await hasRow;

    // Tapped at -20 s, unlocked at -10 s, as the phone did them.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    const unlocking = unlockUnderTap(db, {
      tapEventId: tapId,
      studentId,
      eventId: unlockId,
      deviceTime: ago(10),
    });
    let tapping: ReturnType<typeof tapIn> | undefined;
    let unstaged: Error | null = null;
    try {
      await waitForBlockedBackend();
      tapping = tapIn(db, {
        sessionId: session.id,
        studentId,
        eventId: tapId,
        deviceTime: ago(20),
      });
      // Wait for the tap to park behind the unlock, or — without the lock —
      // to finish without it.
      let done = false;
      const finish = () => {
        done = true;
      };
      tapping.then(finish, finish);
      const deadline = Date.now() + 5_000;
      while (!done && (await lockWaiters()) < 2 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
    } catch (err) {
      unstaged = err instanceof Error ? err : new Error(String(err));
    } finally {
      release();
    }
    await holder;
    const settled = await Promise.allSettled([unlocking, tapping ?? Promise.resolve(undefined)]);
    if (unstaged !== null) throw unstaged;
    for (const s of settled) if (s.status === 'rejected') throw s.reason as Error;

    expect(settled[0]).toMatchObject({ value: { outcome: 'recorded', recordedAs: 'unknown_tap' } });
    expect(settled[1]).toMatchObject({ value: { outcome: 'joined', state: 'unlocked' } });
    expect(one(await liveParticipations(session.id)).state).toBe('unlocked');
    const filed = one(await eventsOfType(session.id, 'unlock'));
    expect(filed.payload).toEqual({ tap_event_id: tapId, unattached_event_id: unlockId });
  }, 20_000);

  it('a reason change racing a return, a re-tap or another unlock is never recorded after it (A20)', async () => {
    // A change is for the unlock the grid shows, and a return, a re-tap or a
    // new unlock ends that. All take the session FOR UPDATE, so either order
    // is whole: the change first, recorded before the rival; the rival first,
    // the change refused. Never a change recorded after what ended its unlock.
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['refocus', 'tap', 'unlock'] as const) {
        const { classId, studentId } = await seed(`race-reason-${rival}-${round}`);
        const session = await openSession(classId);
        const act = () => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        });
        await tapIn(db, act());
        const unlockId = newUuidV7();
        await unlock(db, { ...act(), eventId: unlockId, reason: 'bathroom' });

        const reasonChange = () =>
          changeUnlockReason(db, {
            unlockEventId: unlockId,
            studentId,
            eventId: newUuidV7(),
            reason: 'nurse',
          });
        // Odd rounds give the rival a head start, so both orders get exercised.
        const [changed, other] = await Promise.allSettled([
          round % 2 === 1
            ? new Promise((resolve) => setTimeout(resolve, 10)).then(reasonChange)
            : reasonChange(),
          rival === 'refocus'
            ? refocus(db, act())
            : rival === 'tap'
              ? tapIn(db, act())
              : unlock(db, act()),
        ]);

        if (other.status === 'rejected') throw other.reason;
        const type = rival === 'tap' ? 'tap_in' : rival;
        const ended = (await eventsOfType(session.id, type)).at(-1)!;
        const changes = await eventsOfType(session.id, 'unlock_reason_changed');
        if (changed.status === 'fulfilled') {
          expect(changed.value).toEqual({ outcome: 'applied', reason: 'nurse' });
          expect(one(changes).seq).toBeLessThan(ended.seq);
        } else {
          expect(changed.reason).toMatchObject({ code: 'UNLOCK_SUPERSEDED' });
          expect(changes).toHaveLength(0);
        }
        expect(one(await liveParticipations(session.id)).state).toBe(
          rival === 'unlock' ? 'unlocked' : 'focused',
        );
      }
    }
  }, 120_000);

  it('protection off racing the end of the session is recorded exactly once, whichever lands first', async () => {
    // Owner decision 10: a report that reaches a session already over is
    // recorded with a note instead of refused, so this race has no losing
    // order. Report first: applied, and the end then closes the row. End
    // first: recorded after the end, with no session to shield to. Both lock
    // the session FOR UPDATE and serialise — for a teacher's early end and for
    // the sweep at the bell alike. Never a refusal, never a 500, never lost.
    for (let round = 0; round < 12; round += 1) {
      for (const via of ['end', 'sweep'] as const) {
        const { classId, studentId } = await seed(`race-protoff-${via}-${round}`);
        const session = await openSession(classId, { due: via === 'sweep' });
        const change = () => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        });
        await tapIn(db, { ...change(), now: session.startedAt }); // heard while it ran (A17)

        // Odd rounds give the end a head start, so both orders get exercised:
        // the sweep scans before it locks, and the report otherwise wins it.
        const report = () => protectionOff(db, change());
        const [reported, ended] = await Promise.allSettled([
          round % 2 === 1
            ? new Promise((resolve) => setTimeout(resolve, 10)).then(report)
            : report(),
          via === 'end'
            ? endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' })
            : expireDueSessions(db, new Date()),
        ]);

        expect(ended.status).toBe('fulfilled');
        if (reported.status === 'rejected') throw reported.reason;
        const recorded = await eventsOfType(session.id, 'protection_off');
        expect(recorded).toHaveLength(1);
        if (reported.value.outcome === 'applied') {
          expect(recorded[0]!.payload).toBeNull();
        } else {
          expect(reported.value).toMatchObject({
            outcome: 'recorded',
            recordedAs: 'after_session_end',
            session: null,
          });
          expect(recorded[0]!.payload).toEqual({ recorded_as: 'after_session_end' });
        }
        const over = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
        expect(over.endedAt).not.toBeNull();
        expect(await liveParticipations(session.id)).toHaveLength(0);
      }
    }
  }, 120_000);

  it('Screen Time back on racing an unlock, a late unlock, a re-tap or the end of the session ends the same, whichever lands first (#167)', async () => {
    // Back on locks the session FOR UPDATE, as each rival does, so the pair
    // serialises and either order must end the same way. An unlock: back on
    // first returns to focus and the unlock flips it; the unlock first is
    // recorded under protection off, and back on returns to it — unlocked
    // either way, the unlock recorded once. A late unlock, made before the tap
    // (A10): focused either way, noted late whichever lands first — never
    // returned to (#167's review). A re-tap: focused either way, back on
    // refused after it, protection being on again. The end — a teacher's, or
    // the sweep at the bell — first, and back on is refused as after it; back
    // on first, and the end closes the row. Never a 500, never two.
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['unlock', 'late', 'retap', 'end', 'sweep'] as const) {
        const { classId, studentId } = await seed(`race-on-${rival}-${round}`);
        const session = await openSession(classId, { due: rival === 'sweep' });
        const change = () => ({
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
          now: session.startedAt, // heard while it ran (A17)
        });
        await tapIn(db, change());
        await protectionOff(db, change());

        // Odd rounds give the rival a head start, so both orders get exercised.
        const back = () => protectionOn(db, change());
        const [turned, other] = await Promise.allSettled([
          round % 2 === 1 ? new Promise((resolve) => setTimeout(resolve, 10)).then(back) : back(),
          rival === 'unlock'
            ? unlock(db, change())
            : rival === 'late'
              ? unlock(db, { ...change(), deviceTime: session.startedAt })
              : rival === 'retap'
                ? tapIn(db, change())
                : rival === 'end'
                  ? endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' })
                  : expireDueSessions(db, new Date()),
        ]);

        expect(other.status).toBe('fulfilled');
        const turnedOn = await eventsOfType(session.id, 'protection_on');
        if (turned.status === 'fulfilled') {
          expect(turned.value.outcome).toBe('applied');
          expect(turnedOn).toHaveLength(1);
        } else {
          // Refused only where its rival went first: a refusal records nothing.
          expect(['retap', 'end', 'sweep']).toContain(rival);
          expect(turned.reason).toMatchObject({
            code: rival === 'retap' ? 'PROTECTION_NOT_OFF' : 'SESSION_NOT_RUNNING',
          });
          expect(turnedOn).toHaveLength(0);
        }
        if (rival === 'unlock' || rival === 'late' || rival === 'retap') {
          const row = one(await liveParticipations(session.id));
          expect(row.state).toBe(rival === 'unlock' ? 'unlocked' : 'focused');
          if (rival !== 'retap') {
            const [recorded, ...more] = await eventsOfType(session.id, 'unlock');
            expect(more).toHaveLength(0);
            // The late one is noted late whichever landed first; the other,
            // protection off when it landed first, else nothing (it flipped).
            const notes =
              rival === 'late'
                ? [{ recorded_as: 'superseded' }]
                : [{ recorded_as: 'protection_off' }, null];
            expect(notes).toContainEqual(recorded?.payload ?? null);
          }
        } else {
          expect(await liveParticipations(session.id)).toHaveLength(0);
        }
      }
    }
  }, 120_000);

  it('a retried tap racing the end of its session or a removal never names a session it is not in', async () => {
    // A4: the retry of a tap that landed is answered with its session only
    // while it is still true, and `replay` with no session once it is not.
    // The end — a teacher's early end, or the sweep at the bell — and a
    // removal from the class each lock the session FOR UPDATE, as the retry
    // does, so they serialise: retry first, it names the session, running and
    // the student live in it; end or removal first, it names none. Never the
    // 409 the second order got before A4 (SESSION_NOT_RUNNING,
    // NOT_PARTICIPATING), never a 500, and never a session read as over.
    for (let round = 0; round < 12; round += 1) {
      for (const via of ['end', 'sweep', 'removal'] as const) {
        const { classId, studentId } = await seed(`race-retry-${via}-${round}`);
        const session = await openSession(classId, { due: via === 'sweep' });
        // Heard while the lesson ran, the retry too: one reaching the server
        // past the bell names no session whoever wins (A17).
        const tap = {
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
          now: session.startedAt,
        };
        expect((await tapIn(db, tap)).outcome).toBe('joined');
        const enrollment = one(
          await db
            .select()
            .from(enrollments)
            .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId))),
        );

        // Odd rounds give the rival a head start, so both orders get exercised.
        const retry = () => tapIn(db, tap);
        const [retried, rival] = await Promise.allSettled([
          round % 2 === 1 ? new Promise((resolve) => setTimeout(resolve, 10)).then(retry) : retry(),
          via === 'end'
            ? endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' })
            : via === 'sweep'
              ? expireDueSessions(db, new Date())
              : endEnrollment(db, {
                  enrollmentId: enrollment.id,
                  reason: 'removed_from_class',
                  at: new Date(),
                }),
        ]);

        expect(rival.status).toBe('fulfilled');
        if (retried.status === 'rejected') throw retried.reason;
        const answer = retried.value;
        expect(answer.outcome).toBe('replay');
        if (answer.session === null) {
          expect(answer).toEqual({
            outcome: 'replay',
            state: null,
            participationId: null,
            session: null,
          });
        } else {
          // Named only while true: the row it read under the lock was running.
          expect(answer.session.id).toBe(session.id);
          expect(answer.session.endedAt).toBeNull();
          expect(answer.state).toBe('focused');
        }
        // A replay writes nothing, and whichever landed first, the student is
        // live nowhere in this session now.
        expect(await eventsOfType(session.id, 'tap_in')).toHaveLength(1);
        expect(await liveParticipations(session.id)).toHaveLength(0);
      }
    }
  }, 120_000);

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

  it('a check-in closing a silence episode racing unlock, refocus or protection off never fails on a deadlock', async () => {
    // The close side of the race above. A check-in that finds an episode open
    // closes it in a transaction that takes the participation row first (its
    // guarded UPDATE), then the session's key-share lock for its came_back
    // event; a state change sent as the phone comes back — its outbox draining
    // beside the check-in — locks the session first. Postgres aborted one side
    // with 40P01, and it was almost always the check-in (15, 20 and 16 of 20),
    // which reached the phone as a 500.
    const stale = new Date(Date.now() - 5 * 60_000);
    for (let round = 0; round < 12; round += 1) {
      for (const rival of ['unlock', 'refocus', 'protection_off'] as const) {
        const { classId, studentId } = await seed(`race-back-${rival}-${round}`);
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
        await markSilentParticipations(db, new Date());
        // The premise: an episode is open, so the check-in takes its closing
        // transaction rather than the plain heartbeat.
        expect(one(await liveParticipations(session.id)).silentSince).not.toBeNull();

        const move =
          rival === 'unlock'
            ? unlock(db, change())
            : rival === 'refocus'
              ? refocus(db, change())
              : protectionOff(db, change());
        const [back] = await Promise.all([
          checkIn(db, { sessionId: session.id, studentId, deviceTime: new Date() }),
          move,
        ]);

        expect(back.status).toBe('live');
        const row = one(await liveParticipations(session.id));
        expect(row.state).toBe(
          rival === 'unlock' ? 'unlocked' : rival === 'refocus' ? 'focused' : 'protection_off',
        );
        // One episode, closed exactly once, by whichever contact won.
        expect(row.silentSince).toBeNull();
        expect(await eventsOfType(session.id, 'went_silent')).toHaveLength(1);
        expect(await eventsOfType(session.id, 'came_back')).toHaveLength(1);
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
            // never a deadlock — and the refusal recorded nothing.
            expect(moved.reason).toMatchObject({ code: 'NOT_PARTICIPATING' });
            expect(await eventsOfType(session.id, 'protection_off')).toHaveLength(0);
          } else {
            // It landed first: applied here, and then the leave ended the row.
            expect(moved.value).toMatchObject({ outcome: 'applied', state: 'protection_off' });
            expect(await eventsOfType(session.id, 'protection_off')).toHaveLength(1);
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

  it('a leave or a removal racing a Start never leaves the student in a class they are out of (A19)', async () => {
    // The student's tap waits for the Start (decision 5), so a Start that
    // misses the leave joins them. Both take the class shared and the Start
    // exclusively, so they serialise. A leave: Start first, it finds the class
    // in session and is refused, and the student stays, joined; the leave
    // first, the Start finds them gone and joins nobody. A removal: Start
    // first, it ends the participation the Start made; the removal first, the
    // Start joins nobody. Never both — out of the class and live in its
    // lesson — which one judging the session before the Start committed, and
    // committing after it, would be (santa's round 1: the removal's half).
    for (let round = 0; round < 24; round += 1) {
      const reason = round < 12 ? 'left_class' : 'removed_from_class';
      const { classId, studentId, teacherId } = await seed(`race-leave-start-${round}`);
      await armTap(db, {
        studentId,
        teacherId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const enrollment = one(
        await db
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId))),
      );

      // Odd rounds give the leave a head start, so both orders get exercised.
      const start = () => openSession(classId);
      const [left, started] = await Promise.allSettled([
        endEnrollment(db, { enrollmentId: enrollment.id, reason, at: new Date() }),
        round % 2 === 1 ? new Promise((resolve) => setTimeout(resolve, 10)).then(start) : start(),
      ]);

      if (started.status === 'rejected') throw started.reason;
      const live = await liveParticipations(started.value.id);
      const removedAt = one(
        await db.select().from(enrollments).where(eq(enrollments.id, enrollment.id)),
      ).removedAt;
      if (left.status === 'fulfilled') {
        expect(left.value.outcome).toBe('ended');
        expect(removedAt).not.toBeNull();
        expect(live).toHaveLength(0);
      } else {
        expect(reason).toBe('left_class');
        expect(left.reason).toMatchObject({ code: 'CLASS_IN_SESSION' });
        expect(removedAt).toBeNull();
        expect(live).toHaveLength(1);
      }
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

describe.runIf(REAL_PG)('account deletion under contention (real Postgres, C3)', () => {
  it('a deletion racing an unlock, a rename, a join and the end of the lesson loses no unlock and leaves no name', async () => {
    // The deletion takes the student's row first, as a rename and a join do,
    // so those serialise with it: before it, the rename's names are emptied
    // and the join's class left; after it, each is refused ACCOUNT_DELETED.
    // The unlock and the end lock the lesson, as the deletion's leave does:
    // the unlock is recorded whichever lands first (ISSUES #2), and the
    // participation ends exactly once. Never a deadlock, never a 500.
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId } = await seed(`race-delete-${round}`);
      await seed(`race-delete-other-${round}`); // a class whose code the join uses
      const session = await openSession(classId);
      await tapIn(db, {
        sessionId: session.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });
      const unlockId = newUuidV7();
      const deletion = () =>
        deleteAccount(db, { userId: studentId, eventId: newUuidV7(), at: new Date() });

      const [deleted, unlocked, renamed, joined, ended, tapped] = await Promise.allSettled([
        round % 2 === 1
          ? new Promise((resolve) => setTimeout(resolve, 10)).then(deletion)
          : deletion(),
        unlock(db, { sessionId: session.id, studentId, eventId: unlockId, deviceTime: new Date() }),
        renameStudent(db, { studentId, displayName: `Late ${round}`, eventId: newUuidV7() }),
        joinClassByCode(db, {
          studentId,
          joinCode: `race-delete-other-${round}`,
          eventId: newUuidV7(),
          occurredAt: new Date(),
        }),
        endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' }),
        // A second tap, its route past the class lookup: replayed, refused
        // over, or refused deleted — never a lesson joined as no one.
        tapIn(db, {
          sessionId: session.id,
          studentId,
          eventId: newUuidV7(),
          deviceTime: new Date(),
        }),
      ]);

      if (deleted.status === 'rejected') throw deleted.reason;
      expect(deleted.value.outcome).toBe('deleted');
      if (unlocked.status === 'rejected') throw unlocked.reason;
      expect(ended.status).toBe('fulfilled');
      for (const late of [renamed, joined]) {
        if (late.status === 'rejected')
          expect(late.reason).toMatchObject({ code: 'ACCOUNT_DELETED' });
      }
      if (tapped.status === 'rejected') {
        expect(['ACCOUNT_DELETED', 'SESSION_NOT_RUNNING']).toContain(
          (tapped.reason as { code?: string }).code,
        );
      }

      expect(await eventOf(unlockId)).toMatchObject({ userId: studentId, type: 'unlock' });
      const row = one(await db.select().from(users).where(eq(users.id, studentId)));
      expect(row.displayName).toBeNull();
      const renames = await db
        .select()
        .from(events)
        .where(and(eq(events.userId, studentId), eq(events.type, 'display_name_changed')));
      expect(renames.every((e) => e.payload === null)).toBe(true);
      const stillIn = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.removedAt)));
      expect(stillIn).toHaveLength(0);
      expect(await liveOf(studentId)).toHaveLength(0);
    }
  }, 60_000);

  it('a deletion racing a Start that would take the student’s waiting tap leaves it consumed and them in no lesson', async () => {
    // The Start locks its armed rows, then the student's tap lock; the deletion
    // takes that lock, then the armed rows. A deadlock between them is refused
    // by the database and retried; whichever order wins, the tap is consumed
    // and the student ends in no lesson: converted and then left, or never taken.
    for (let round = 0; round < 12; round += 1) {
      const { classId, studentId, teacherId } = await seed(`race-delete-armed-${round}`);
      await armTap(db, {
        studentId,
        teacherId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const deletion = () =>
        deleteAccount(db, { userId: studentId, eventId: newUuidV7(), at: new Date() });
      const [deleted, started] = await Promise.allSettled([
        round % 2 === 1
          ? new Promise((resolve) => setTimeout(resolve, 5)).then(deletion)
          : deletion(),
        openSession(classId),
      ]);
      if (deleted.status === 'rejected') throw deleted.reason;
      if (started.status === 'rejected') throw started.reason;
      expect(deleted.value.outcome).toBe('deleted');

      const armed = one(
        await db.select().from(armedTaps).where(eq(armedTaps.studentId, studentId)),
      );
      expect(armed.consumedAt).not.toBeNull();
      expect(await liveOf(studentId)).toHaveLength(0);
    }
  }, 60_000);
});

/**
 * Run `deleteAccount` for `userId` in a transaction held open until the
 * returned `release` is called, then committed: what a call racing a deletion
 * meets mid-flight (C3).
 */
async function heldDeletion(userId: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran!: () => void;
  const deleted = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const committed = db.transaction(async (tx) => {
    await deleteAccount(tx, { userId, eventId: newUuidV7(), at: new Date() });
    ran();
    await held;
  });
  await deleted;
  return { release, committed };
}

describe.runIf(REAL_PG)('a deletion staged against an arm and a create (real Postgres, C3)', () => {
  it('a tap reaching the arm path behind a deletion is refused, and arms nothing', async () => {
    // The tap's route found the caller and no lesson (the deletion left its
    // classes), so it arms. The deletion holds the student's row; the arm
    // path reads it FOR SHARE, so it waits, then finds the row removed.
    // Without that it never waits (the armed row's foreign key takes only
    // KEY SHARE, which the deletion's NO KEY UPDATE allows) and arms for no one.
    const { studentId, teacherId } = await seed('race-delete-arm');
    const { release, committed } = await heldDeletion(studentId);
    const arming = armTap(db, {
      studentId,
      teacherId,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    arming.catch(() => undefined);
    try {
      await waitForBlockedBackend();
    } finally {
      release();
      await committed;
    }
    await expect(arming).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
    expect(
      await db.select().from(armedTaps).where(eq(armedTaps.studentId, studentId)),
    ).toHaveLength(0);
  });

  it('a class or a block made behind a teacher’s deletion is refused, and none is owned by no one', async () => {
    // The deletion found no class and no block, so it goes ahead. A create
    // holds the teacher's row FOR SHARE, which waits for the deletion's NO KEY
    // UPDATE and then reads the row removed.
    const school = one(
      await db.insert(schools).values({ name: 'race-delete-teacher' }).returning(),
    );
    const teacher = one(
      await db
        .insert(users)
        .values({ cognitoId: 'race-delete-teacher', role: 'teacher', schoolId: school.id })
        .returning(),
    );
    const { release, committed } = await heldDeletion(teacher.id);
    const creating = createClass(db, { teacherId: teacher.id, schoolId: school.id, name: 'late' });
    const registering = createBlock(db, { teacherId: teacher.id, tagId: 'race-delete-tag' });
    creating.catch(() => undefined);
    registering.catch(() => undefined);
    try {
      await waitForBlockedBackend(5_000, 2);
    } finally {
      release();
      await committed;
    }
    await expect(creating).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
    await expect(registering).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
    expect(await db.select().from(classes).where(eq(classes.teacherId, teacher.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(blocks).where(eq(blocks.teacherId, teacher.id))).toHaveLength(0);
  });
});

describe.runIf(REAL_PG)('school disposal under contention (real Postgres, C6a)', () => {
  it('a disposal racing a Start, a join, an arm, a rename, a redeem and an unlock in the school loses no unlock and leaves no one named', async () => {
    // The disposal takes the school, then its people, then its classes, then
    // its lessons — a redeem waits on the school, a join, a rename and an arm
    // on the person's row, a Start and a join on the class — so each lands
    // before it (and is disposed of with the rest) or after it (and is
    // refused). A Start that wins leaves a lesson running, and the disposal is
    // refused whole. The unlock is recorded whichever lands first (ISSUES #2).
    // Never a deadlock, never a 500.
    for (let round = 0; round < 12; round += 1) {
      const tag = `race-dispose-${round}`;
      const { classId, studentId, teacherId } = await seed(tag);
      const schoolId = one(
        await db.select({ id: classes.schoolId }).from(classes).where(eq(classes.id, classId)),
      ).id;
      const lesson = await openSession(classId);
      await tapIn(db, {
        sessionId: lesson.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });
      await endSession(db, { sessionId: lesson.id, at: new Date(), reason: 'ended' });
      const stranger = await findOrCreateStudent(db, `stranger-${tag}`, `Stranger ${round}`);
      await recordAgreement(db, { schoolId, signedOn: '2026-09-01' });
      const invite = await mintTeacherInvite(db, { schoolId });
      if (invite.outcome !== 'minted') throw new Error('mint');
      const newcomer = await findOrCreateStudent(db, `newcomer-${tag}`, `Newcomer ${round}`);
      const unlockId = newUuidV7();
      const disposal = () =>
        disposeSchool(db, { schoolId, at: new Date(), confirmName: `School ${tag}` });
      // Later and later, so some calls land before the disposal and some behind it.
      const later = <T>(ms: number, call: () => Promise<T>) =>
        new Promise((resolve) => setTimeout(resolve, ms)).then(call);
      const lag = (round % 3) * 12;

      const [disposed, started, joined, armed, renamed, redeemed, unlocked, created] =
        await Promise.allSettled([
          round % 2 === 1
            ? new Promise((resolve) => setTimeout(resolve, 5)).then(disposal)
            : disposal(),
          later((round % 4) * 8, () => openSession(classId)),
          later(lag, () =>
            joinClassByCode(db, {
              studentId: stranger.id,
              joinCode: tag,
              eventId: newUuidV7(),
              occurredAt: new Date(),
            }),
          ),
          later(lag, () =>
            armTap(db, {
              studentId,
              teacherId,
              eventId: newUuidV7(),
              deviceTime: new Date(),
              expiresAt: new Date(Date.now() + 3_600_000),
            }),
          ),
          later(lag, () =>
            renameStudent(db, { studentId, displayName: `Late ${round}`, eventId: newUuidV7() }),
          ),
          later(lag, () =>
            redeemTeacherInvite(db, {
              userId: newcomer.id,
              code: invite.code,
              eventId: newUuidV7(),
            }),
          ),
          unlock(db, {
            sessionId: lesson.id,
            studentId,
            eventId: unlockId,
            deviceTime: new Date(),
          }),
          // The school before the teacher, as the disposal takes them: never a deadlock.
          later(lag, () => createClass(db, { teacherId, schoolId, name: `Late ${round}` })),
        ]);

      if (disposed.status === 'rejected') throw disposed.reason;
      if (unlocked.status === 'rejected') throw unlocked.reason;
      if (redeemed.status === 'rejected') throw redeemed.reason;
      // Before the disposal, or after it: the school's invites went with it.
      expect(['redeemed', 'invite_not_found']).toContain(redeemed.value.outcome);
      expect(await eventOf(unlockId)).toMatchObject({ userId: studentId, type: 'unlock' });
      if (started.status === 'rejected') {
        expect(started.reason).toMatchObject({ code: 'CLASS_NOT_FOUND' });
      }
      if (joined.status === 'rejected') {
        expect(joined.reason).toMatchObject({ code: 'CLASS_NOT_FOUND' });
      }
      for (const late of [armed, renamed, created]) {
        if (late.status === 'rejected') {
          expect(late.reason).toMatchObject({ code: 'ACCOUNT_DELETED' });
        }
      }

      if (disposed.value.outcome === 'in_session') {
        // The Start won: the lesson it made runs, and nothing was disposed of.
        expect(started.status).toBe('fulfilled');
        expect(one(await db.select().from(schools).where(eq(schools.id, schoolId))).removedAt).toBe(
          null,
        );
        continue;
      }
      expect(disposed.value.outcome).toBe('disposed');
      const running = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.classId, classId), isNull(sessions.endedAt)));
      expect(running).toHaveLength(0);
      // A class made ahead of it went with the rest.
      expect(
        await db
          .select()
          .from(classes)
          .where(and(eq(classes.schoolId, schoolId), isNull(classes.removedAt))),
      ).toHaveLength(0);
      const stillIn = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.classId, classId), isNull(enrollments.removedAt)));
      expect(stillIn).toHaveLength(0);
      // Everyone the class ever held names no one now: the stranger too, if they got in.
      const held = await db
        .select({ displayName: users.displayName, removedAt: users.removedAt })
        .from(users)
        .innerJoin(enrollments, eq(enrollments.studentId, users.id))
        .where(eq(enrollments.classId, classId));
      expect(held.every((u) => u.displayName === null && u.removedAt !== null)).toBe(true);
      const renames = await db
        .select()
        .from(events)
        .where(and(eq(events.userId, studentId), eq(events.type, 'display_name_changed')));
      expect(renames.every((e) => e.payload === null)).toBe(true);
      expect(
        await db.select().from(armedTaps).where(eq(armedTaps.teacherId, teacherId)),
      ).toHaveLength(0);
      // A teacher who came in by the invite is one of its people, de-identified;
      // one refused is untouched, and no teacher of it.
      const after = one(await db.select().from(users).where(eq(users.id, newcomer.id)));
      if (redeemed.value.outcome === 'redeemed') {
        expect(after.displayName).toBeNull();
        expect(after.removedAt).not.toBeNull();
      } else {
        expect(after).toMatchObject({
          role: 'student',
          schoolId: null,
          displayName: `Newcomer ${round}`,
          removedAt: null,
        });
      }
    }
  }, 60_000);

  it('a redeem behind a disposal finds no invite, and one ahead of it is disposed of with the school', async () => {
    // Staged both ways, each transaction held open while the other waits on
    // the school's row: the disposal's FOR UPDATE, the redeem's FOR SHARE.
    async function staged(tag: string) {
      const { classId } = await seed(tag);
      const schoolId = one(
        await db.select({ id: classes.schoolId }).from(classes).where(eq(classes.id, classId)),
      ).id;
      await recordAgreement(db, { schoolId, signedOn: '2026-09-01' });
      const invite = await mintTeacherInvite(db, { schoolId });
      if (invite.outcome !== 'minted') throw new Error('mint');
      const newcomer = await findOrCreateStudent(db, `newcomer-${tag}`, `Newcomer ${tag}`);
      const redeem = (on: Database) =>
        redeemTeacherInvite(on, { userId: newcomer.id, code: invite.code, eventId: newUuidV7() });
      const dispose = (on: Database) =>
        disposeSchool(on, { schoolId, at: new Date(), confirmName: `School ${tag}` });
      const account = async () =>
        one(await db.select().from(users).where(eq(users.id, newcomer.id)));
      return { redeem, dispose, account };
    }
    async function holding<T>(first: (tx: Database) => Promise<T>) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ran!: (value: T) => void;
      const result = new Promise<T>((resolve) => {
        ran = resolve;
      });
      const committed = db.transaction(async (tx) => {
        ran(await first(tx));
        await held;
      });
      return { result: await result, release, committed };
    }

    // The disposal first: the redeem waits on the school, then finds it gone.
    const behind = await staged('race-dispose-redeem-behind');
    const disposal = await holding(behind.dispose);
    expect(disposal.result.outcome).toBe('disposed');
    const late = behind.redeem(db);
    late.catch(() => undefined);
    try {
      await waitForBlockedBackend();
    } finally {
      disposal.release();
      await disposal.committed;
    }
    expect(await late).toEqual({ outcome: 'invite_not_found' });
    expect(await behind.account()).toMatchObject({
      role: 'student',
      schoolId: null,
      displayName: 'Newcomer race-dispose-redeem-behind',
      removedAt: null,
    });

    // The redeem first: the disposal waits on the school, then reads the new
    // teacher as one of its people.
    const ahead = await staged('race-dispose-redeem-ahead');
    const redeem = await holding(ahead.redeem);
    expect(redeem.result.outcome).toBe('redeemed');
    const disposing = ahead.dispose(db);
    disposing.catch(() => undefined);
    try {
      await waitForBlockedBackend();
    } finally {
      redeem.release();
      await redeem.committed;
    }
    expect(await disposing).toMatchObject({ outcome: 'disposed', counts: { teachers: 2 } });
    const teacher = await ahead.account();
    expect(teacher).toMatchObject({ role: 'teacher', displayName: null });
    expect(teacher.removedAt).not.toBeNull();
  });
});

describe.runIf(REAL_PG)('a retention run under contention (real Postgres, C6b)', () => {
  it('a retention run racing a tap, a join, an arm, a rename and an unlock leaves no one half kept', async () => {
    // The run takes the school, then each person's taps and row, as a deletion
    // does (C3): a tap, join, rename or arm behind it finds the account deleted;
    // one ahead of it is read. A tap into the lesson still running is a record
    // after the year, so a student whose tap wins is kept named and in it; one
    // whose tap loses is de-identified and in nothing. The unlock is recorded
    // whichever lands first (ISSUES #2). Never a deadlock, never a 500.
    for (let round = 0; round < 12; round += 1) {
      const tag = `race-retain-${round}`;
      const { classId, studentId, teacherId } = await seed(tag);
      const { schoolId } = one(
        await db
          .select({ schoolId: classes.schoolId })
          .from(classes)
          .where(eq(classes.id, classId)),
      );
      const two = (n: number) => String(n).padStart(2, '0');
      const tomorrow = new Date(Date.now() + 86_400_000);
      await db
        .update(schools)
        .set({
          schoolYearEndsOn: `${tomorrow.getFullYear()}-${two(tomorrow.getMonth() + 1)}-${two(tomorrow.getDate())}`,
        })
        .where(eq(schools.id, schoolId));
      const past = await openSession(classId);
      await tapIn(db, {
        sessionId: past.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      });
      await endSession(db, { sessionId: past.id, at: new Date(), reason: 'ended' });
      const { classId: otherClass } = await seed(`${tag}-other`);
      await db.update(classes).set({ schoolId }).where(eq(classes.id, otherClass));
      const running = await openSession(classId);
      const unlockId = newUuidV7();
      const later = <T>(ms: number, call: () => Promise<T>) =>
        new Promise((resolve) => setTimeout(resolve, ms)).then(call);
      const lag = (round % 3) * 12;

      const [retained, tapped, joined, armed, renamed, unlocked] = await Promise.allSettled([
        later((round % 2) * 5, () =>
          applyRetention(db, {
            schoolId,
            at: new Date(Date.now() + 3 * 86_400_000),
            confirmName: `School ${tag}`,
          }),
        ),
        later(lag, () =>
          tapIn(db, {
            sessionId: running.id,
            studentId,
            eventId: newUuidV7(),
            deviceTime: new Date(),
          }),
        ),
        later(lag, () =>
          joinClassByCode(db, {
            studentId,
            joinCode: `${tag}-other`,
            eventId: newUuidV7(),
            occurredAt: new Date(),
          }),
        ),
        later(lag, () =>
          armTap(db, {
            studentId,
            teacherId,
            eventId: newUuidV7(),
            deviceTime: new Date(),
            expiresAt: new Date(Date.now() + 3_600_000),
          }),
        ),
        later(lag, () =>
          renameStudent(db, { studentId, displayName: `Late ${round}`, eventId: newUuidV7() }),
        ),
        unlock(db, { sessionId: past.id, studentId, eventId: unlockId, deviceTime: new Date() }),
      ]);

      if (retained.status === 'rejected') throw retained.reason;
      if (unlocked.status === 'rejected') throw unlocked.reason;
      expect(retained.value.outcome).toBe('applied');
      expect(await eventOf(unlockId)).toMatchObject({ userId: studentId, type: 'unlock' });
      for (const late of [tapped, joined, armed, renamed]) {
        if (late.status === 'rejected') {
          expect(late.reason).toMatchObject({ code: 'ACCOUNT_DELETED' });
        }
      }
      const student = one(await db.select().from(users).where(eq(users.id, studentId)));
      const inLesson = await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, running.id), eq(participations.studentId, studentId)),
        );
      if (student.removedAt === null) {
        // Kept: only a tap into the running lesson, ahead of the run, keeps them.
        expect(tapped.status).toBe('fulfilled');
        expect(inLesson).toHaveLength(1);
        continue;
      }
      // De-identified: in no class, no lesson, no waiting tap, and no name anywhere.
      expect(student.displayName).toBeNull();
      expect(inLesson.filter((p) => p.endedAt === null)).toHaveLength(0);
      expect(
        await db
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.removedAt))),
      ).toHaveLength(0);
      expect(
        await db.select().from(armedTaps).where(eq(armedTaps.studentId, studentId)),
      ).toHaveLength(0);
      const renames = await db
        .select()
        .from(events)
        .where(and(eq(events.userId, studentId), eq(events.type, 'display_name_changed')));
      expect(renames.every((e) => e.payload === null)).toBe(true);
    }
  }, 60_000);
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

  it('an extend racing the sweep: the first to take the session wins, and the extend says so truly (A16)', async () => {
    /*
     * The sweep picks due sessions with an unlocked scan, then expires each
     * under its lock. Staged both ways round: a holder takes the session's
     * row, the first caller parks on it and the second behind it, the sweep's
     * scan having run before either lands — so it always finds the session
     * due. The press is stamped a second before the bell, as a teacher's last
     * moment "add time" is. Extend first: it lands, and the sweep, judging
     * the expiry again under the lock, leaves the session running; without
     * that it ended the class the teacher had just been told was extended.
     * Sweep first: the session ends, and the extend is refused
     * SESSION_NOT_RUNNING.
     */
    for (const first of ['extend', 'sweep'] as const) {
      const { classId, studentId } = await seed(`race-extend-sweep-${first}`);
      const session = await openSession(classId, { due: true });
      await tapIn(db, {
        sessionId: session.id,
        studentId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        now: session.startedAt, // heard while it ran (A17)
      });

      const release = await holdSession(session.id);
      const now = new Date();
      const press = {
        sessionId: session.id,
        durationMinutes: 10,
        at: new Date(session.endsAt.getTime() - 1_000),
        eventId: newUuidV7(),
      };
      let extending: ReturnType<typeof extendSession> | undefined;
      let sweeping: ReturnType<typeof expireDueSessions> | undefined;
      let unstaged: Error | null = null;
      try {
        if (first === 'extend') extending = extendSession(db, press);
        else sweeping = expireDueSessions(db, now);
        await waitForBlockedBackend();
        if (first === 'extend') sweeping = expireDueSessions(db, now);
        else extending = extendSession(db, press);
        await waitForBlockedBackend(5_000, 2);
      } catch (err) {
        unstaged = err instanceof Error ? err : new Error(String(err));
      } finally {
        await release();
      }
      const [extended, swept] = await Promise.allSettled([extending, sweeping]);
      if (unstaged !== null) throw unstaged;
      if (swept.status === 'rejected') throw swept.reason;

      const row = one(await db.select().from(sessions).where(eq(sessions.id, session.id)));
      if (first === 'extend') {
        if (extended.status === 'rejected') throw extended.reason;
        expect(swept.value, first).not.toContain(session.id);
        expect(row.endedAt, first).toBeNull();
        expect(row.endsAt, first).toEqual(extended.value?.endsAt);
        expect(await eventsOfType(session.id, 'session_expired'), first).toHaveLength(0);
        expect(await liveParticipations(session.id), first).toHaveLength(1);
      } else {
        expect(extended, first).toMatchObject({
          status: 'rejected',
          reason: { code: 'SESSION_NOT_RUNNING' },
        });
        expect(swept.value, first).toContain(session.id);
        expect(row.endedAt, first).not.toBeNull();
        expect(row.endsAt, first).toEqual(session.endsAt);
        expect(await eventsOfType(session.id, 'session_expired'), first).toHaveLength(1);
        expect(await eventsOfType(session.id, 'session_extended'), first).toHaveLength(0);
        expect(await liveParticipations(session.id), first).toHaveLength(0);
      }
    }
  }, 30_000);
});

describe.runIf(REAL_PG)('a Start past the bell (real Postgres, A18)', () => {
  /** Until `n` of `calls` are parked on a lock or answered — a caller that never parks counts once it answers. */
  async function parked(n: number, calls: Promise<unknown>[]): Promise<void> {
    let answered = 0;
    const done = () => {
      answered += 1;
    };
    for (const call of calls) void call.then(done, done);
    const deadline = Date.now() + 5_000;
    while (answered + (await lockWaiters()) < n) {
      if (Date.now() > deadline) throw new Error(`fewer than ${n} caller(s) ever parked`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it(
    'a Start racing the sweep over a session past its bell: one end, one new session, either order',
    () =>
      onOwnDatabase(async () => {
        /*
         * Both take the old session's row before ending it (the Start after the
         * class's), so they serialise. Sweep first: it ends the session, and the
         * Start, reading it again under the lock, finds it over and starts the new
         * one. Start first: it ends the session as the sweep would, starts the new
         * one, and the sweep finds nothing left to end. Staged both ways round
         * with a holder on the old session's row.
         */
        for (const first of ['start', 'sweep'] as const) {
          const { classId } = await seed(`race-start-sweep-${first}`);
          const old = await openSession(classId, { due: true });
          const release = await holdSession(old.id);
          const now = new Date();
          const press = { classId, startedAt: now, endsAt: new Date(now.getTime() + 25 * 60_000) };
          const calls: Promise<unknown>[] = [];
          let starting: ReturnType<typeof startSession> | undefined;
          let sweeping: ReturnType<typeof expireDueSessions> | undefined;
          const call = (which: 'start' | 'sweep') => {
            if (which === 'start') calls.push((starting = startSession(db, press)));
            else calls.push((sweeping = expireDueSessions(db, now)));
          };
          try {
            call(first);
            await parked(1, calls);
            call(first === 'start' ? 'sweep' : 'start');
            await parked(2, calls);
          } finally {
            await release();
          }
          const [started, swept] = await Promise.all([starting, sweeping]);
          expect(started?.outcome, first).toBe('created');
          expect(started?.session.id, first).not.toBe(old.id);
          expect(swept, first).toEqual(first === 'sweep' ? [old.id] : []);
          expect(await eventsOfType(old.id, 'session_expired'), first).toHaveLength(1);
          const all = await db.select().from(sessions).where(eq(sessions.classId, classId));
          expect(all, first).toHaveLength(2);
          expect(
            all.filter((s) => s.endedAt === null).map((s) => s.id),
            first,
          ).toEqual([started?.session.id]);
        }
        // Not a deadlock a retry hid: the class row's NO KEY UPDATE leaves the
        // sweep's event its key-share (with FOR UPDATE, 4 runs in 6 deadlocked).
        expect(await deadlockCount(db), 'Postgres broke a deadlock — a retry hid it').toBe(0);
      }),
    30_000,
  );

  it(
    'a Start ending a class past its bell, against a re-tap by a student whose tap waits: no deadlock',
    () =>
      onOwnDatabase(async () => {
        /*
         * A14's lock order, kept by a Start that ends a class (#133's round 1):
         * it takes its waiting taps and their students' locks before the old
         * session's row, so a tap — its student's lock, then the session's row —
         * never holds what the Start then waits on. Staged with a holder on the
         * waiting tap's row: out of that order, the Start parked there holding
         * the old session's row while the re-tap parked on that row holding the
         * student's lock, and Postgres broke the cycle.
         */
        const { classId, studentId, teacherId } = await seed('race-start-retap');
        const old = await openSession(classId, { due: true });
        const now = new Date();
        const armed = await armTap(db, {
          studentId,
          teacherId,
          eventId: newUuidV7(),
          deviceTime: now,
          expiresAt: new Date(now.getTime() + 3_600_000),
          now,
        });
        const release = await holdArmedTap(armed.armedTapId!);
        const calls: Promise<unknown>[] = [];
        let starting: ReturnType<typeof startSession> | undefined;
        let retapping: ReturnType<typeof tapIn> | undefined;
        try {
          const press = { classId, startedAt: now, endsAt: new Date(now.getTime() + 25 * 60_000) };
          calls.push((starting = startSession(db, press)));
          await parked(1, calls);
          const retap = {
            sessionId: old.id,
            studentId,
            eventId: newUuidV7(),
            deviceTime: now,
            now,
          };
          calls.push((retapping = tapIn(db, retap)));
          await parked(2, calls);
        } finally {
          await release();
        }
        const [started, retapped] = await Promise.allSettled([starting, retapping]);
        expect(started).toMatchObject({
          status: 'fulfilled',
          value: { outcome: 'created', armedConverted: 1 },
        });
        expect(retapped).toMatchObject({
          status: 'rejected',
          reason: { code: 'SESSION_NOT_RUNNING' },
        });
        expect(await deadlockCount(db), 'Postgres broke a deadlock — a retry hid it').toBe(0);
      }),
    30_000,
  );
});

describe.runIf(REAL_PG)('a tap at the bell (real Postgres, A17)', () => {
  it('an arm waits out the same tap still landing in a session, and answers as its replay', async () => {
    /*
     * A tap's retry reaching the server past the bell takes the arm path while
     * the tap itself may still be landing in the session, its `tap_in` not yet
     * committed — so `armTap`'s look for it finds nothing. Armed there, the id
     * is spent a moment later by the landing, the next Start skips the row as
     * spent, and a phone told "armed" waits for a Start that never joins it.
     * `armTap` takes the tap's own lock, as the landing does, so it waits the
     * landing out and answers as its replay. Staged: a holder parks the
     * landing on the session's row while it holds the tap's lock.
     */
    const { classId, studentId, teacherId } = await seed('race-arm-landing');
    const session = await openSession(classId);
    const eventId = newUuidV7();
    const release = await holdSession(session.id);
    const landing = tapIn(db, {
      sessionId: session.id,
      studentId,
      eventId,
      deviceTime: new Date(),
    });
    let arming: ReturnType<typeof armTap> | undefined;
    let settled = false;
    try {
      await waitForBlockedBackend();
      arming = armTap(db, {
        studentId,
        teacherId,
        eventId,
        deviceTime: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const done = () => {
        settled = true;
      };
      void arming.then(done, done);
      // Parked behind the landing on the tap's lock — or, without it, answered already.
      const deadline = Date.now() + 5_000;
      while (!settled && (await lockWaiters()) < 2 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      await release();
    }
    expect((await landing).outcome).toBe('joined');
    expect(await arming).toEqual({ outcome: 'replay' });
    expect(await db.select().from(armedTaps).where(eq(armedTaps.eventId, eventId))).toEqual([]);
  }, 20_000);
});

/**
 * Run `body` with this file's helpers on a database nothing else touches, so
 * `deadlockCount` reads this test's deadlocks alone (see it). Tests in a file
 * run one at a time, so the shared handle is put back before the next.
 */
async function onOwnDatabase(body: () => Promise<void>): Promise<void> {
  const shared = db;
  const own = await makeTestDb();
  db = own.db;
  try {
    await body();
  } finally {
    db = shared;
    await own.close();
  }
}

/** Take a waiting tap's `armed_taps` row and hold it, as `holdSession` holds a session's. */
async function holdArmedTap(armedTapId: string): Promise<() => Promise<void>> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = db
    .transaction(async (tx) => {
      await tx.select().from(armedTaps).where(eq(armedTaps.id, armedTapId)).for('update');
      locked();
      await held;
      throw new Error('rolled back on purpose');
    })
    .catch(() => undefined);
  await hasLock;
  return async () => {
    release();
    await holder;
  };
}

/**
 * Take `sessionId`'s row lock and hold it. Whatever locks the row meanwhile
 * parks, and goes through in the order it parked once the returned release
 * rolls the holder back.
 */
async function holdSession(sessionId: string): Promise<() => Promise<void>> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = db
    .transaction(async (tx) => {
      await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
      locked();
      await held;
      throw new Error('rolled back on purpose');
    })
    .catch(() => undefined);
  await hasLock;
  return async () => {
    release();
    await holder;
  };
}

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
 * Wait until some backend is parked on a lock while running a statement whose
 * text contains `fragment`; true when one is, false when `stop` says to give
 * up or 5 s pass. Names WHICH statement waits, where `lockWaiters` counts any.
 */
async function waitForLockWaiter(fragment: string, stop = () => false): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = (await db.execute(
      sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query like ${`%${fragment}%`}`,
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) > 0) return true;
    if (stop()) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

/**
 * Stage the interleaving a student's lock exists for (A14): a holder owns
 * `eventId` on the events index, so `parkFirst`, which records it, parks there
 * after its judgment; `thenRace` runs meanwhile and parks behind the student's
 * lock — or, without the lock, finishes first. Then the holder rolls back.
 * Returns both answers.
 */
async function behindHolder<P, R>(
  eventId: string,
  userId: string,
  parkFirst: () => Promise<P>,
  thenRace: () => Promise<R>,
): Promise<[P, R]> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inserted!: () => void;
  const hasRow = new Promise<void>((resolve) => {
    inserted = resolve;
  });
  const holder = db
    .transaction(async (tx) => {
      await tx.insert(events).values({ eventId, type: 'unlock', userId, occurredAt: new Date() });
      inserted();
      await held;
      throw new Error('rolled back on purpose');
    })
    .catch(() => undefined);
  await hasRow;

  const parked = parkFirst();
  let racing: Promise<R> | undefined;
  let unstaged: Error | null = null;
  try {
    await waitForBlockedBackend();
    racing = thenRace();
    // Wait for it to park behind the lock, or — without one — to finish.
    let done = false;
    const finish = () => {
      done = true;
    };
    racing.then(finish, finish);
    const deadline = Date.now() + 5_000;
    while (!done && (await lockWaiters()) < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
  } catch (err) {
    unstaged = err instanceof Error ? err : new Error(String(err));
  } finally {
    release();
  }
  await holder;
  const settled = await Promise.allSettled([parked, racing ?? Promise.resolve(undefined)]);
  if (unstaged !== null) throw unstaged;
  const [first, second] = settled;
  if (first.status === 'rejected') throw first.reason as Error;
  if (second.status === 'rejected') throw second.reason as Error;
  return [first.value, second.value as R];
}

/**
 * Fail rather than proceed if fewer than `waiters` backends ever block at
 * once — the staging must be real.
 *
 * Held-transaction tests that gate on the 5 s default carry an explicit 20 s
 * budget, and must: under vitest's own 5 s test budget a round that never
 * staged died as "Test timed out" — naming nothing — before the gate could
 * throw the error that says what went wrong (measured, with the gate forced to
 * miss). The package's vitest.config.ts now allows 60 s; the explicit 20 s
 * overrides it, so a stuck round still fails in 20 s.
 */
async function waitForBlockedBackend(timeoutMs = 5_000, waiters = 1): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await lockWaiters()) >= waiters) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `fewer than ${waiters} backend(s) ever blocked on the row lock — the interleaving was not staged`,
  );
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
     * Closed by lockWaitingTaps taking FOR UPDATE on the taps it reads, so
     * the refresh waits and its guard then correctly fails.
     *
     * Staged by construction, not by timing. A holder inserts — and sits on —
     * a running session for the class, so the Start parks on
     * sessions_one_running_per_class: AFTER lockWaitingTaps has locked the
     * tap, BEFORE the conversion consumes it. Only then is the refresh fired,
     * so it lands in the gap on every run. The version before this aimed by
     * polling pg_stat_activity for one of the conversion's brief armed_taps
     * statements and fired a few round-trips later; a poll that latched a late
     * statement, or none within its ceiling, fired after the commit, and on a
     * loaded runner all three retried rounds missed (main, run 37350621890).
     *
     * With the FOR UPDATE removed nothing parks the refresh: it rewrites the
     * row while the Start is held, the Start then records tap_in under the old
     * id, and both the invariant and the gate below go red (measured).
     */
    const { classId, studentId, teacherId } = await seed('race-conversion-gap');
    const boundary = new Date(Date.now() + 400);
    const armed = await armTap(db, {
      studentId,
      teacherId,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      expiresAt: boundary,
      now: new Date(boundary.getTime() - 60_000),
    });
    expect(armed.armedTapId, 'seeding did not arm a row').toBeDefined();
    const armedId = armed.armedTapId!;

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const hasRow = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const holder = db
      .transaction(async (tx) => {
        await tx
          .insert(sessions)
          .values({ classId, startedAt: new Date(), endsAt: new Date(Date.now() + 60_000) });
        inserted();
        await held;
        throw new Error('rolled back on purpose');
      })
      .catch(() => undefined);
    await hasRow;

    const conversion = startSession(db, {
      classId,
      startedAt: new Date(boundary.getTime() - 1_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const fireRefresh = () =>
      armTap(db, {
        studentId,
        teacherId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(boundary.getTime() + 1_000),
      });
    let refresh: ReturnType<typeof fireRefresh> | undefined;
    let contended = false;
    let unstaged: Error | null = null;
    try {
      // The Start parked on the holder's session: its tap locked, unconsumed.
      if (!(await waitForLockWaiter('insert into "sessions"'))) {
        throw new Error('the Start never parked on the held session — the gap was not staged');
      }
      refresh = fireRefresh();
      let done = false;
      const finish = () => {
        done = true;
      };
      refresh.then(finish, finish);
      // Parks on the Start's row lock — or, with none, simply finishes.
      contended = await waitForLockWaiter('"armed_taps"', () => done);
    } catch (err) {
      unstaged = err instanceof Error ? err : new Error(String(err));
    } finally {
      release();
    }
    await holder;
    const [started, refreshed] = await Promise.allSettled([
      conversion,
      refresh ?? Promise.resolve(undefined),
    ]);
    if (unstaged !== null) throw unstaged;
    // Name the reason, on BOTH sides: several throws are reachable from each,
    // and a bare `expected 'rejected' to be 'fulfilled'` names none of them.
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

    // The invariant: a consumed row names an event that EXISTS — not
    // specifically a `tap_in`, since a spent tap is consumed and skipped under
    // a fresh id. The orphan this test exists for names an id in NO event.
    const row = one(await db.select().from(armedTaps).where(eq(armedTaps.id, armedId)));
    expect(row.consumedAt, 'the Start did not consume the armed tap').not.toBeNull();
    const recorded = await db
      .select({ eventId: events.eventId })
      .from(events)
      .where(eq(events.eventId, row.eventId));
    expect(
      recorded,
      `consumed armed tap ${row.id} names event ${row.eventId}, which no event recorded`,
    ).toHaveLength(1);
    expect(
      contended,
      'the refresh never waited on a lock, though it ran while the conversion held its ' +
        'armed tap — the conversion is not holding the rows it converts',
    ).toBe(true);
    // The Start held the row first, so the refresh found it consumed and
    // recorded a fresh waiting tap rather than recycling the converted one.
    expect(refreshed.value?.armedTapId).toBeDefined();
    expect(refreshed.value?.armedTapId).not.toBe(armedId);
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

describe.runIf(REAL_PG)('display names under contention (real Postgres)', () => {
  /*
   * Owner decision 8 — a name unique within each class — is a read-then-write:
   * look at the classmates' names, then take one. Two classmates doing it at
   * once each see the other's old name, so without the class locks in
   * `renameStudent` both win. Rounds and a warm pool, as the blocks above: one
   * pair can simply fail to overlap.
   */
  beforeAll(async () => {
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
  });

  /** A school, `classCount` classes, and `students` students each in the classes listed for them. */
  async function roster(tag: string, classCount: number, students: number[][]) {
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
    const classIds: string[] = [];
    for (let i = 0; i < classCount; i += 1) {
      const klass = one(
        await db
          .insert(classes)
          .values({
            teacherId: teacher.id,
            schoolId: school.id,
            name: `C${i}`,
            joinCode: `${tag}-${i}`,
          })
          .returning(),
      );
      classIds.push(klass.id);
    }
    const studentIds: string[] = [];
    for (const [n, taking] of students.entries()) {
      const student = one(
        await db
          .insert(users)
          .values({ cognitoId: `student-${tag}-${n}`, role: 'student', schoolId: school.id })
          .returning(),
      );
      for (const i of taking) {
        await db.insert(enrollments).values({ classId: classIds[i]!, studentId: student.id });
      }
      studentIds.push(student.id);
    }
    return { classIds, studentIds };
  }

  const nameOf = async (userId: string) =>
    one(await db.select().from(users).where(eq(users.id, userId))).displayName;

  it('two classmates taking one name at once: exactly one gets it', async () => {
    // Two classes they share, joined in opposite orders.
    for (let round = 0; round < 20; round += 1) {
      const {
        studentIds: [a, b],
      } = await roster(`race-name-${round}`, 2, [
        [0, 1],
        [1, 0],
      ]);

      const settled = await Promise.allSettled([
        renameStudent(db, { studentId: a!, displayName: 'Ana Reyes', eventId: newUuidV7() }),
        renameStudent(db, { studentId: b!, displayName: 'ANA REYES', eventId: newUuidV7() }),
      ]);

      const refused = settled.filter((r) => r.status === 'rejected');
      expect(refused, `round ${round}`).toHaveLength(1);
      expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'DISPLAY_NAME_TAKEN',
      });
      const names = [await nameOf(a!), await nameOf(b!)];
      expect(
        names.filter((name) => name !== null),
        `round ${round}`,
      ).toHaveLength(1);
    }
  });

  /**
   * Hold `classIds` in an open transaction until `release` — so a rename parks
   * on the first of them it locks — and resolve once they are held.
   */
  async function holdClasses(classIds: string[]) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const done = db.transaction(async (tx) => {
      await tx
        .select({ id: classes.id })
        .from(classes)
        .where(inArray(classes.id, classIds))
        .for('no key update');
      locked();
      await held;
    });
    await holding;
    return { release, done };
  }

  /**
   * Wait until `n` backends are parked on a lock, then run `meanwhile`, and
   * release the holder whatever happens — a missed staging must fail the test,
   * never wedge the suite behind the holder (as the held-transaction tests above).
   */
  async function whileParked(
    n: number,
    holder: { release: () => void; done: Promise<void> },
    meanwhile: () => Promise<void> = async () => {},
  ) {
    try {
      const deadline = Date.now() + 5_000;
      while ((await lockWaiters()) < n) {
        if (Date.now() > deadline) throw new Error(`fewer than ${n} renames parked on a class`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await meanwhile();
    } finally {
      holder.release();
      await holder.done;
    }
  }

  it('takes a student’s classes in one order: the first held while it waits on the next', async () => {
    // The order is what keeps renames from deadlocking one another (next
    // test). A holder takes the student's later class by id, so the rename
    // parks on it — and must by then hold the earlier one, which a NOWAIT
    // probe finds taken. Taken the other way round, it parks holding nothing.
    for (let round = 0; round < 10; round += 1) {
      const {
        classIds,
        studentIds: [a],
      } = await roster(`race-order-${round}`, 2, [[1, 0]]);
      // Postgres compares uuids byte by byte, as this compares lower-case hex.
      const [earlier, later] = [...classIds].sort();
      const holder = await holdClasses([later!]);

      const renaming = renameStudent(db, {
        studentId: a!,
        displayName: 'Ana',
        eventId: newUuidV7(),
      });
      let probe = '';
      await whileParked(1, holder, async () => {
        try {
          await db
            .select({ id: classes.id })
            .from(classes)
            .where(eq(classes.id, earlier!))
            .for('no key update', { noWait: true });
          probe = 'free';
        } catch (err) {
          // 55P03: lock_not_available — someone holds the row.
          if (!hasSqlState(err, '55P03')) throw err;
          probe = 'held';
        }
      });

      expect(probe, `round ${round}`).toBe('held');
      expect((await renaming).outcome).toBe('applied');
    }
  }, 20_000);

  it('renames across classes shared in a ring never deadlock', async () => {
    /*
     * A is in C0 and C1, B in C1 and C2, C in C2 and C0. Each locks its two
     * classes, so in any order but one for all, each can end up holding one
     * class and waiting on another's: a cycle, and Postgres aborts one rename.
     * Staged, not hoped for — the gap between one statement's two row locks is
     * too short to interleave by chance: a holder takes all three classes, so
     * each rename parks on the first class it locks, then lets go of them at
     * once. Measured with the order made random: a deadlock in four runs of
     * six — the waiters re-race for the rows on waking, so not every round
     * closes the cycle, which is why the test above pins the order itself.
     */
    for (let round = 0; round < 30; round += 1) {
      const { classIds, studentIds } = await roster(`race-ring-${round}`, 3, [
        [0, 1],
        [1, 2],
        [2, 0],
      ]);
      const holder = await holdClasses(classIds);

      const renames = studentIds.map((studentId, n) =>
        renameStudent(db, { studentId, displayName: `Student ${n}`, eventId: newUuidV7() }),
      );
      await whileParked(3, holder);
      const settled = await Promise.allSettled(renames);

      expect(
        settled.map((r) => (r.status === 'fulfilled' ? r.value.outcome : String(r.reason))),
        `round ${round}`,
      ).toEqual(['applied', 'applied', 'applied']);
    }
  }, 60_000);

  it('a rename racing its own retry is answered as its replay', async () => {
    // In no class, so no class lock orders the pair: the student's own row does.
    for (let round = 0; round < 15; round += 1) {
      const {
        studentIds: [a],
      } = await roster(`race-name-retry-${round}`, 0, [[]]);
      const input = { studentId: a!, displayName: 'Ana Reyes', eventId: newUuidV7() };

      const results = await Promise.all([renameStudent(db, input), renameStudent(db, input)]);

      expect(results.map((r) => r.outcome).sort()).toEqual(['applied', 'replay']);
      expect(results.map((r) => r.user.displayName)).toEqual(['Ana Reyes', 'Ana Reyes']);
      const recorded = await db.select().from(events).where(eq(events.eventId, input.eventId));
      expect(recorded).toHaveLength(1);
    }
  });

  it('a sign-in’s fill racing a rename never overwrites the name the student set', async () => {
    for (let round = 0; round < 15; round += 1) {
      const cognitoId = `race-fill-rename-${round}-${newUuidV7()}`;
      const created = await findOrCreateStudent(db, cognitoId);
      expect(created.displayName).toBeNull();

      await Promise.all([
        findOrCreateStudent(db, cognitoId, 'demo-ana@example.test'),
        renameStudent(db, { studentId: created.id, displayName: 'Ana', eventId: newUuidV7() }),
      ]);

      expect(await nameOf(created.id)).toBe('Ana');
    }
  });
});

describe.runIf(REAL_PG)(
  'school agreements and invites under contention (real Postgres, T1a)',
  () => {
    beforeAll(async () => {
      await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
    });

    it('two agreements recorded at once each say the day their own write replaced', async () => {
      // The row is locked from its read to its write. Without the lock both runs
      // read the same day and both say they replaced it, though one replaced the
      // other's.
      for (let round = 0; round < 15; round += 1) {
        const school = await createSchool(db, { name: `Race agreement ${round}` });
        const [a, b] = await Promise.all([
          recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-01' }),
          recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-02' }),
        ]);
        if (a.outcome !== 'recorded' || b.outcome !== 'recorded') {
          throw new Error('both runs found the school');
        }
        const [first, second] = a.before === null ? [a, b] : [b, a];
        expect(first.before).toBeNull();
        expect(second.before).toBe(first.school.agreementSignedAt);
        const [row] = await db.select().from(schools).where(eq(schools.id, school.id));
        expect(row?.agreementSignedAt).toBe(second.school.agreementSignedAt);
      }
    });

    it('a mint reads its school’s agreement after a change holding the row, never before', async () => {
      // Nothing takes an agreement back yet; a step that does will hold the
      // school's row while it writes, as this transaction does. The mint holds
      // the row from its read to its write (FOR SHARE), so it waits, then reads
      // the agreement gone. Without that, it reads the old row unblocked and mints.
      const school = await createSchool(db, { name: 'Race revoke' });
      await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-01' });
      let minting: Promise<MintInviteResult> | undefined;
      await db.transaction(async (tx) => {
        await tx.update(schools).set({ agreementSignedAt: null }).where(eq(schools.id, school.id));
        minting = mintTeacherInvite(db, { schoolId: school.id });
        await waitForBlockedBackend();
      });
      expect((await minting)?.outcome).toBe('no_agreement');
      const invites = await db
        .select()
        .from(teacherInvites)
        .where(eq(teacherInvites.schoolId, school.id));
      expect(invites).toHaveLength(0);
    }, 20_000);
  },
);

describe.runIf(REAL_PG)('teacher invites redeemed under contention (real Postgres, T1b)', () => {
  beforeAll(async () => {
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select 1`)));
  });

  /** A code minted for a school with its agreement on record: its symbols, and its invite's id. */
  async function code(tag: string) {
    const school = await createSchool(db, { name: `Race invite ${tag}` });
    await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-01' });
    const minted = await mintTeacherInvite(db, { schoolId: school.id });
    if (minted.outcome !== 'minted') throw new Error(`no invite: ${minted.outcome}`);
    return { code: minted.code, inviteId: minted.invite.id, schoolId: school.id };
  }

  const student = async (tag: string) =>
    one(
      await db
        .insert(users)
        .values({ cognitoId: `race-invite-${tag}-${newUuidV7()}`, role: 'student' })
        .returning(),
    );

  /**
   * `redeems`, started while a transaction holds `lock`'s rows, each parked behind it — so every
   * one has read what it reads first before any can write — then let go together.
   */
  async function parkedBehind(
    lock: (tx: Database) => Promise<unknown>,
    redeems: (() => Promise<RedeemInviteResult>)[],
  ): Promise<RedeemInviteResult[]> {
    let started: Promise<RedeemInviteResult>[] = [];
    await db.transaction(async (tx) => {
      await lock(tx);
      started = redeems.map((redeem) => redeem());
      await waitForBlockedBackend(5_000, redeems.length);
    });
    return Promise.all(started);
  }

  it('two accounts redeeming one code at once: exactly one becomes a teacher', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { code: symbols, inviteId, schoolId } = await code(`one-${round}`);
      const [a, b] = [await student(`a-${round}`), await student(`b-${round}`)];
      const redeem = (userId: string) => () =>
        redeemTeacherInvite(db, { userId, code: symbols, eventId: newUuidV7() });

      // Both read the invite free, then meet at the guarded UPDATE: the second finds it taken.
      const results = await parkedBehind(
        (tx) =>
          tx.select().from(teacherInvites).where(eq(teacherInvites.id, inviteId)).for('update'),
        [redeem(a.id), redeem(b.id)],
      );

      expect(results.map((r) => r.outcome).sort(), `round ${round}`).toEqual([
        'invite_used',
        'redeemed',
      ]);
      const winner = results[0]?.outcome === 'redeemed' ? a : b;
      const loser = winner === a ? b : a;
      const [invite] = await db
        .select()
        .from(teacherInvites)
        .where(eq(teacherInvites.id, inviteId));
      expect(invite?.redeemedBy).toBe(winner.id);
      const accounts = await db
        .select()
        .from(users)
        .where(inArray(users.id, [a.id, b.id]));
      const byId = new Map(accounts.map((u) => [u.id, u]));
      expect(byId.get(winner.id)).toMatchObject({ role: 'teacher', schoolId });
      expect(byId.get(loser.id)).toMatchObject({ role: 'student', schoolId: null });
    }
  }, 30_000);

  it('one account redeeming two codes at once takes one: its row is held, so the second finds a teacher', async () => {
    for (let round = 0; round < 5; round += 1) {
      const [first, second] = [await code(`two-a-${round}`), await code(`two-b-${round}`)];
      const account = await student(`two-${round}`);
      const redeem = (symbols: string) => () =>
        redeemTeacherInvite(db, { userId: account.id, code: symbols, eventId: newUuidV7() });

      const results = await parkedBehind(
        (tx) => tx.select().from(users).where(eq(users.id, account.id)).for('update'),
        [redeem(first.code), redeem(second.code)],
      );

      expect(results.map((r) => r.outcome).sort(), `round ${round}`).toEqual([
        'already_teacher',
        'redeemed',
      ]);
      const taken = await db
        .select()
        .from(teacherInvites)
        .where(
          and(
            inArray(teacherInvites.id, [first.inviteId, second.inviteId]),
            isNotNull(teacherInvites.redeemedAt),
          ),
        );
      expect(taken).toHaveLength(1);
      const [row] = await db.select().from(users).where(eq(users.id, account.id));
      expect(row?.schoolId).toBe(taken[0]?.schoolId);
    }
  }, 30_000);

  it('two accounts sending one eventId at once: one redeems, the other is told it is taken', async () => {
    for (let round = 0; round < 5; round += 1) {
      const [first, second] = [await code(`id-a-${round}`), await code(`id-b-${round}`)];
      const [a, b] = [await student(`id-a-${round}`), await student(`id-b-${round}`)];
      const eventId = newUuidV7();

      // Each reads the eventId free, then meets the other at its unique index.
      const results = await parkedBehind(
        (tx) =>
          tx
            .select()
            .from(teacherInvites)
            .where(inArray(teacherInvites.id, [first.inviteId, second.inviteId]))
            .for('update'),
        [
          () => redeemTeacherInvite(db, { userId: a.id, code: first.code, eventId }),
          () => redeemTeacherInvite(db, { userId: b.id, code: second.code, eventId }),
        ],
      );

      expect(results.map((r) => r.outcome).sort(), `round ${round}`).toEqual([
        'event_id_conflict',
        'redeemed',
      ]);
      const taken = await db
        .select()
        .from(teacherInvites)
        .where(eq(teacherInvites.redeemEventId, eventId));
      expect(taken).toHaveLength(1);
    }
  }, 30_000);
});

describe.runIf(REAL_PG)('device tokens registered under contention (real Postgres, N3)', () => {
  const student = async (tag: string) =>
    one(
      await db
        .insert(users)
        .values({ cognitoId: `race-push-${tag}-${newUuidV7()}`, role: 'student' })
        .returning(),
    );
  const token = () => newUuidV7().replace(/-/g, '').repeat(2);

  it('two accounts sending one eventId at once: one registers, the other is told it is taken', async () => {
    for (let round = 0; round < 10; round += 1) {
      const [a, b] = [await student(`a-${round}`), await student(`b-${round}`)];
      const eventId = newUuidV7();
      // Both may read the eventId free; the later then meets the earlier at its unique index,
      // and is answered on a second read — never a 23505.
      const results = await Promise.all(
        [a, b].map((s) =>
          registerPushToken(db, { userId: s.id, token: token(), environment: 'sandbox', eventId }),
        ),
      );
      expect(results.map((r) => r.outcome).sort(), `round ${round}`).toEqual([
        'event_id_conflict',
        'registered',
      ]);
      const rows = await db.select().from(deviceTokens).where(eq(deviceTokens.eventId, eventId));
      expect(rows).toHaveLength(1);
    }
  }, 30_000);

  it('an older and a newer register of one token at once: the newer always holds it (N4)', async () => {
    for (let round = 0; round < 10; round += 1) {
      const [a, b] = [await student(`old-${round}`), await student(`new-${round}`)];
      const shared = token();
      const olderId = newUuidV7();
      const newerId = newUuidV7();
      const [older, newer] = await Promise.all([
        registerPushToken(db, {
          userId: a.id,
          token: shared,
          environment: 'sandbox',
          eventId: olderId,
        }),
        registerPushToken(db, {
          userId: b.id,
          token: shared,
          environment: 'production',
          eventId: newerId,
        }),
      ]);
      // Whichever lands first, the newer register writes; the older one either
      // wrote before it or is answered as a replay of the newer's truth.
      expect(newer, `round ${round}`).toEqual({ outcome: 'registered', environment: 'production' });
      expect(['registered', 'replay'], `round ${round}`).toContain(older.outcome);
      const row = one(await db.select().from(deviceTokens).where(eq(deviceTokens.token, shared)));
      expect(row, `round ${round}`).toMatchObject({ userId: b.id, eventId: newerId });
    }
  }, 30_000);
});

describe.runIf(REAL_PG)('the 13+ yes beside a deletion (real Postgres, C7-server)', () => {
  const student = async (tag: string) =>
    one(
      await db
        .insert(users)
        .values({ cognitoId: `race-age-${tag}-${newUuidV7()}`, role: 'student' })
        .returning(),
    );
  const checksOf = (userId: string) =>
    db.select().from(ageChecks).where(eq(ageChecks.userId, userId));

  it('a yes behind a deletion is refused and records nothing; one ahead of it goes with the account', async () => {
    // Behind: the deletion holds the row (NO KEY UPDATE), so the yes's FOR SHARE
    // waits, then reads it removed.
    const late = await student('behind');
    const deletion = await heldDeletion(late.id);
    const behind = recordAgeCheck(db, { userId: late.id, eventId: newUuidV7() });
    behind.catch(() => undefined);
    try {
      await waitForBlockedBackend();
    } finally {
      deletion.release();
      await deletion.committed;
    }
    expect(await behind).toBe('account_deleted');
    expect(await checksOf(late.id)).toEqual([]);

    // Ahead: the yes holds the row FOR SHARE until it commits, so the deletion
    // waits, then deletes the yes it finds.
    const early = await student('ahead');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ran!: (result: RecordAgeCheckResult) => void;
    const recorded = new Promise<RecordAgeCheckResult>((resolve) => {
      ran = resolve;
    });
    const committed = db.transaction(async (tx) => {
      ran(await recordAgeCheck(tx, { userId: early.id, eventId: newUuidV7() }));
      await held;
    });
    expect(await recorded).toBe('passed');
    const deleting = deleteAccount(db, { userId: early.id, eventId: newUuidV7(), at: new Date() });
    deleting.catch(() => undefined);
    try {
      await waitForBlockedBackend();
    } finally {
      release();
      await committed;
    }
    expect(await deleting).toEqual({ outcome: 'deleted' });
    expect(await checksOf(early.id)).toEqual([]);
  });
});
