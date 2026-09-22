import type {
  EventType,
  ParticipationEndedReason,
  ParticipationState,
  UnlockRecordedAs,
  UnlockRecordedOutcome,
} from '@bali/shared';
import { clampToWindow, MAX_SESSION_MINUTES, SILENCE_THRESHOLD_MS } from '@bali/shared';
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';

import { newUuidV7 } from './ids.js';
import { armedTaps, classes, enrollments, events, participations, sessions } from './schema.js';
import { isDeadlock } from './sql-errors.js';
import type { Database } from './types.js';

/*
 * The transition engine (data-model decision 1). This module is the ONLY code
 * allowed to write `participations` and `events`, and it always writes both
 * together in one transaction, so the current picture and the permanent
 * history can never disagree — v2's most common bug. Every operation here:
 *
 *   - runs in a single transaction (both writes land, or neither);
 *   - is idempotent on the client's event_id, so a retried tap counts once
 *     (rule 4) — the events unique constraint is the dedupe, and a replay
 *     re-reads and returns the current truth without re-applying. "Current"
 *     is the operative word on the tap path: a retry answers 200 only while
 *     what it recorded is still true, and refuses when it is not, because a
 *     tap response drives a shield and a stale one would lock a student into
 *     a session that is over or that they have left (see `tapIn`);
 *   - clamps any device timestamp into the session window (rule 1);
 *   - returns the resulting state, which is the phone's reconciliation channel.
 *
 * State derivation for display lives in @bali/shared (rule 2); this is the
 * write side.
 *
 * One cost worth knowing rather than re-deriving, and worth stating where it
 * LANDS rather than as a total: `tapIn` reads `events` by event_id on every
 * tap, before the join — and that read is inside the session's `FOR UPDATE`
 * window, so taps into one session serialise behind it. "A few hundred extra
 * indexed reads spread over a minute" was the wrong way to describe it: the
 * relevant number is what it adds to the held lock, per tap, because that is
 * what a queue at a bell waits on.
 *
 * Measured on the real-Postgres lane, 29 sequential taps into one session:
 * ~5.0 ms per tap with the read, ~4.8 ms without — so roughly 0.2 ms, about
 * 4% of the window. Fine at a school's scale, and now a number rather than an
 * adjective.
 */

export type TransitionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_RUNNING'
  | 'NOT_PARTICIPATING'
  | 'INVALID_EXTENSION'
  | 'EVENT_ID_CONFLICT'
  | 'CLASS_NOT_FOUND'
  | 'ENROLLMENT_NOT_FOUND';

/** A refusal the engine can produce; endpoints (step 7) map these to the error shape. */
export class TransitionError extends Error {
  constructor(
    readonly code: TransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

type SessionRow = typeof sessions.$inferSelect;
type ParticipationRow = typeof participations.$inferSelect;
type ClassRow = typeof classes.$inferSelect;

function firstOrUndefined<T>(rows: T[]): T | undefined {
  return rows[0];
}

/**
 * When the server last heard from a phone — always the server's own clock,
 * never the device's (even clamped).
 *
 * `last_seen_at` is not a record of when something happened; it is the input to
 * liveness. The sweep asks `coalesce(last_seen_at, joined_at) < now - 90s` and
 * `deriveDisplayState` asks the same question at render, so a device-supplied
 * value hands a student control of whether they appear present. A clock running
 * fast clamps to `endsAt` — a time in the future — and `now - last_seen_at`
 * stays negative for the rest of the lesson: the phone never goes silent and the
 * grid shows a solid green chip for a phone that is gone, which is precisely
 * rule 3's v2 bug. A clock running slow clamps to `startedAt` and flaps the
 * episode open and shut against decision 7's "exactly once per episode".
 *
 * Rule 1 is unchanged and still does its job: the device's claim orders the
 * action through the event's clamped `occurred_at`. Liveness is the server's
 * observation, so the server stamps it.
 */
function heardNow(): Date {
  return new Date();
}

/**
 * Retry a transaction that Postgres aborts with a deadlock (40P01). A
 * session-scoped participation-ender (endEnrollment) and a cross-session switch
 * (tapIn -> endParticipationsElsewhere) can both reach the same participation row
 * while holding different session locks, and Postgres aborts one side. Every
 * engine mutation is idempotent (event_id / removed_at), so re-running the loser
 * is safe and converges. PGlite is single-connection and never deadlocks, so this
 * is a no-op there.
 */
async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isDeadlock(err) || i >= attempts - 1) throw err;
      // Jittered backoff so two mutually-deadlocking transactions don't retry in
      // lockstep and collide again.
      await new Promise((resolve) => setTimeout(resolve, 10 * (i + 1) + Math.random() * 10));
    }
  }
}

/**
 * Insert an event idempotently. Returns true if this write is new, false if an
 * event with this id already exists (a replay). The unique constraint on
 * event_id does the deduping; ON CONFLICT DO NOTHING turns the loser into a
 * no-op instead of an error.
 */
async function insertEvent(
  tx: Database,
  e: {
    eventId: string;
    type: EventType;
    sessionId?: string | null;
    classId?: string | null;
    userId?: string | null;
    occurredAt: Date;
    payload?: unknown;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(events)
    .values({
      eventId: e.eventId,
      type: e.type,
      sessionId: e.sessionId ?? null,
      classId: e.classId ?? null,
      userId: e.userId ?? null,
      occurredAt: e.occurredAt,
      payload: e.payload ?? null,
    })
    .onConflictDoNothing({ target: events.eventId })
    .returning({ id: events.id });
  const isNew = inserted.length > 0;

  // The id was taken — but that is a *replay* only if it names the same event.
  // An id reused for a different event is a client bug, and calling it a replay
  // silently drops this write. On the unlock path that is v2's lost-unlock bug
  // exactly: 'replay' is a recorded outcome, so the phone's outbox is told the
  // record is safe to delete while no unlock row was ever written — an
  // unshielded phone with zero trace. A student's app is an adversary here, and
  // reusing its own tap_in id is a one-line change. So refuse loudly instead:
  // the unlock contract turns a non-401 4xx into "keep the record, retry, and
  // surface", which loses nothing. Checked here, at the single chokepoint, so
  // no writer can forget it.
  if (!isNew) {
    const prior = firstOrUndefined(
      await tx
        .select({ type: events.type, sessionId: events.sessionId, userId: events.userId })
        .from(events)
        .where(eq(events.eventId, e.eventId))
        .limit(1),
    );
    if (
      prior === undefined ||
      prior.type !== e.type ||
      prior.sessionId !== (e.sessionId ?? null) ||
      prior.userId !== (e.userId ?? null)
    ) {
      throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another event');
    }
  }

  // The live-updates doorbell (decision 2): ping listeners for this session so a
  // stream re-reads the events table (the only source of truth) immediately
  // instead of waiting for its slow re-poll. insertEvent is the single chokepoint
  // for writing an event, so no writer can forget to ring it. It fires inside the
  // transaction, so Postgres delivers it on commit (never for a rolled-back
  // event), and only for a genuinely new event that belongs to a session. On
  // PGlite (tests) there is no cross-connection listener, so it is a harmless
  // no-op — correctness never depends on it (the re-poll does).
  if (isNew && e.sessionId) {
    await tx.execute(sql`select pg_notify('bali_events', ${e.sessionId})`);
  }
  return isNew;
}

/**
 * Load a session, optionally locking the row FOR UPDATE. Every operation that
 * mutates a session or its participations locks it first, so concurrent
 * transactions serialize on the session: a tap can't slip a live participation
 * into a session another transaction is ending (which would leave the two
 * tables disagreeing — decision 1), and two end/expiry runs can't both emit an
 * end event (decision 6's idempotent sweep). Read-only callers skip the lock.
 * (PGlite is single-connection, so the tests can't stage the race; the lock is
 * verified by reasoning and belongs in a real-Postgres integration test once a
 * live database exists — the hosting step.)
 */
async function loadSession(
  tx: Database,
  sessionId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<SessionRow | undefined> {
  const query = tx.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return firstOrUndefined(await (opts.forUpdate ? query.for('update') : query));
}

async function loadParticipation(
  tx: Database,
  sessionId: string,
  studentId: string,
): Promise<ParticipationRow | undefined> {
  return firstOrUndefined(
    await tx
      .select()
      .from(participations)
      .where(and(eq(participations.sessionId, sessionId), eq(participations.studentId, studentId)))
      .limit(1),
  );
}

async function loadLiveParticipation(
  tx: Database,
  sessionId: string,
  studentId: string,
): Promise<ParticipationRow | undefined> {
  return firstOrUndefined(
    await tx
      .select()
      .from(participations)
      .where(
        and(
          eq(participations.sessionId, sessionId),
          eq(participations.studentId, studentId),
          isNull(participations.endedAt),
        ),
      )
      .limit(1),
  );
}

/**
 * End every live participation this student has in a session OTHER than
 * `exceptSessionId`, as `left_for_other_session` (decision 4), emitting the
 * switch-out event on each. Returns how many were ended. Both `tapIn` and the
 * armed-tap conversion call this so the one-live-per-student rule always holds
 * before a new focused participation is opened.
 */
async function endParticipationsElsewhere(
  tx: Database,
  studentId: string,
  exceptSessionId: string,
  occurredAt: Date,
): Promise<number> {
  const elsewhere = await tx
    .select({
      id: participations.id,
      sessionId: participations.sessionId,
      classId: sessions.classId,
    })
    .from(participations)
    .innerJoin(sessions, eq(participations.sessionId, sessions.id))
    .where(
      and(
        eq(participations.studentId, studentId),
        isNull(participations.endedAt),
        ne(participations.sessionId, exceptSessionId),
      ),
    );
  let ended = 0;
  for (const other of elsewhere) {
    // Guard on ended_at IS NULL: if that session ended between the select and
    // here, this no-ops rather than overwriting its end reason, and we skip
    // the switch-out event.
    const done = await tx
      .update(participations)
      .set({ endedAt: occurredAt, endedReason: 'left_for_other_session' })
      .where(and(eq(participations.id, other.id), isNull(participations.endedAt)))
      .returning({ id: participations.id });
    if (done.length === 0) continue;
    await insertEvent(tx, {
      eventId: newUuidV7(),
      type: 'left_for_other_session',
      sessionId: other.sessionId,
      classId: other.classId,
      userId: studentId,
      occurredAt,
    });
    ended += 1;
  }
  return ended;
}

export interface StartSessionInput {
  classId: string;
  startedAt: Date;
  endsAt: Date;
}
export interface StartSessionResult {
  /** 'created' for a new session; 'existing' when one was already running (no duplicate). */
  outcome: 'created' | 'existing';
  session: SessionRow;
  /** How many waiting armed taps became participations at this start (decision 5). */
  armedConverted: number;
}

/**
 * Convert this class's waiting armed taps into participations. Called inside the
 * start transaction: a tap the student made before the bell (saved as
 * student+teacher, decision 5) becomes a focused participation the moment the
 * teacher presses Start, emitting the deferred tap_in event with the armed
 * tap's original id so a later phone retry dedupes. Returns the count converted.
 */
async function convertArmedTaps(tx: Database, session: SessionRow): Promise<number> {
  const cls = firstOrUndefined(
    await tx.select().from(classes).where(eq(classes.id, session.classId)).limit(1),
  );
  if (!cls) return 0;

  const enrolled = await tx
    .select({ studentId: enrollments.studentId })
    .from(enrollments)
    .where(and(eq(enrollments.classId, cls.id), isNull(enrollments.removedAt)));
  if (enrolled.length === 0) return 0;
  const enrolledIds = enrolled.map((e) => e.studentId);

  // This teacher's still-waiting, unexpired taps from students in this class.
  //
  // Locked, not just read. The rows are read here and consumed several
  // statements later, and `armTap`'s expired-tap refresh can land in that gap:
  // it finds `consumed_at` still NULL, so its own guard passes, it writes its
  // event id onto the row, and this loop then records `tap_in` with the id it
  // read BEFORE the refresh. The armed tap is left naming an event no `tap_in`
  // ever recorded — the same integrity break the refresh guard exists to stop,
  // reached from the other side. FOR UPDATE makes the refresh wait; when it
  // resumes, `consumed_at` is set, its guard fails, and it falls through to
  // recording a fresh waiting tap instead. This is the only lock the two paths
  // share: `armTap` is keyed on student+teacher and never learns the class, so
  // it cannot take the class lock this transaction holds.
  const waiting = await tx
    .select()
    .from(armedTaps)
    .where(
      and(
        eq(armedTaps.teacherId, cls.teacherId),
        isNull(armedTaps.consumedAt),
        gt(armedTaps.expiresAt, session.startedAt),
        inArray(armedTaps.studentId, enrolledIds),
      ),
    )
    .for('update');

  // A waiting tap can carry an event id that is ALREADY on record as a
  // `tap_in`: the student's tap landed in an earlier session, its response was
  // lost, and the retry — finding nothing of this teacher's running — armed
  // the same id, because `armTap` de-dupes against `armed_taps.event_id` and
  // never against `events`. Converting under that id makes `insertEvent`
  // refuse it as another event's, and since this runs inside `startSession`'s
  // transaction the whole Start rolls back, leaving the tap unconsumed. The
  // teacher then cannot open ANY class that student is in — `waiting` is
  // selected by TEACHER, not by class — until the tap expires at end of day.
  // Reproduced end to end; pinned by "a spent event id never wedges the next
  // Start".
  //
  // A tap is still a tap (decision 5) and the student is still standing there,
  // so the conversion goes ahead under a fresh id, with the spent one kept in
  // the payload so the history still shows which tap it came from. Nothing is
  // weakened: that id exists to de-dupe ARMING, and this conversion is already
  // exactly-once — the row is consumed in this same transaction.
  const spent =
    waiting.length === 0
      ? new Set<string>()
      : new Set(
          (
            await tx
              .select({ eventId: events.eventId })
              .from(events)
              .where(
                inArray(
                  events.eventId,
                  waiting.map((t) => t.eventId),
                ),
              )
          ).map((row) => row.eventId),
        );

  let converted = 0;
  for (const tap of waiting) {
    const occurredAt = clampToWindow(tap.deviceTime, session.startedAt, session.endsAt);
    // Decision 4: a student armed here may already be live in another session
    // (they tapped a different teacher's running block after arming). End that
    // first, or the insert below would violate one-live-per-student and roll
    // back the whole Start.
    await endParticipationsElsewhere(tx, tap.studentId, session.id, occurredAt);
    await tx
      .insert(participations)
      .values({
        sessionId: session.id,
        studentId: tap.studentId,
        state: 'focused',
        joinedAt: occurredAt,
        lastSeenAt: heardNow(),
      })
      .onConflictDoUpdate({
        target: [participations.sessionId, participations.studentId],
        set: {
          state: 'focused',
          joinedAt: occurredAt,
          lastSeenAt: heardNow(),
          endedAt: null,
          endedReason: null,
          // A silence marker must never outlive the participation that opened
          // it: reviving the row starts a fresh stint, so a stale silent_since
          // would either fire a came_back for an episode that no longer exists
          // or suppress the next went_silent forever (decision 7's pairing).
          silentSince: null,
        },
      });
    const reused = spent.has(tap.eventId);
    await insertEvent(tx, {
      eventId: reused ? newUuidV7() : tap.eventId,
      type: 'tap_in',
      sessionId: session.id,
      classId: session.classId,
      userId: tap.studentId,
      occurredAt,
      payload: reused ? { armed_tap_event_id: tap.eventId } : undefined,
    });
    await tx
      .update(armedTaps)
      .set({ consumedAt: session.startedAt })
      .where(eq(armedTaps.id, tap.id));
    converted += 1;
  }
  return converted;
}

/**
 * Start a focus session for a class. If one is already running, return it
 * rather than creating a duplicate (API-surface decision). Every armed tap
 * waiting for this class's teacher becomes a focused participation (decision 5).
 */
export async function startSession(
  db: Database,
  input: StartSessionInput,
): Promise<StartSessionResult> {
  // Retry on deadlock: converting armed taps ends those students' live
  // participations in OTHER sessions row by row, while endSession and the
  // sweep update a session's participations as one set-based statement — the
  // two can take the same row locks in opposite order, so either side can be
  // the victim. Idempotent (a re-run returns the running session), so retrying
  // is safe, and a 40P01 here would otherwise be a 500 at the bell.
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      // Lock the class row so two simultaneous starts serialize: the loser waits,
      // then sees the running session and returns it rather than hitting the
      // one-running-per-class index with a raw unique violation (the doc's
      // "from a phone and a laptop at once" promise).
      await tx
        .select({ id: classes.id })
        .from(classes)
        .where(eq(classes.id, input.classId))
        .for('update');

      const existing = firstOrUndefined(
        await tx
          .select()
          .from(sessions)
          .where(and(eq(sessions.classId, input.classId), isNull(sessions.endedAt)))
          .limit(1),
      );
      if (existing) return { outcome: 'existing', session: existing, armedConverted: 0 };

      const session = firstOrUndefined(
        await tx
          .insert(sessions)
          .values({ classId: input.classId, startedAt: input.startedAt, endsAt: input.endsAt })
          .returning(),
      );
      if (!session) throw new Error('startSession: insert returned no row');

      await insertEvent(tx, {
        eventId: newUuidV7(),
        type: 'session_started',
        sessionId: session.id,
        classId: session.classId,
        occurredAt: session.startedAt,
      });

      const armedConverted = await convertArmedTaps(tx, session);
      return { outcome: 'created', session, armedConverted };
    }),
  );
}

/**
 * How many times armTap will re-try its insert/re-read pair before giving up.
 * Each pass costs two statements and only repeats when a Start consumed the
 * conflicting tap in between, so two spare passes is generous.
 */
const ARM_TAP_ATTEMPTS = 3;

export interface ArmTapInput {
  studentId: string;
  teacherId: string;
  blockId?: string;
  eventId: string;
  deviceTime: Date;
  /** End of the school day; the tap is ignored at conversion if this has passed. */
  expiresAt: Date;
  /** Server clock for the expiry comparison; defaults to now. */
  now?: Date;
}
export interface ArmTapResult {
  /** 'armed' new/refreshed; 'already_armed' a live waiting tap stands; 'replay' this exact tap again. */
  outcome: 'armed' | 'already_armed' | 'replay';
  armedTapId: string;
}

/**
 * Save a tap that arrived before any session was running (decision 5). Stored as
 * student+teacher; it waits until the teacher presses Start. Idempotent on the
 * client's event_id, and at most one waiting tap per student+teacher stands.
 * `now` decides whether an existing waiting tap is still valid; a stale
 * (expired-but-unconsumed) one is refreshed in place rather than blocking the
 * new tap — until the expiry sweep lands, that stale row is the only thing that
 * could otherwise swallow a fresh pre-bell tap.
 */
export async function armTap(db: Database, input: ArmTapInput): Promise<ArmTapResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const exact = firstOrUndefined(
      await tx.select().from(armedTaps).where(eq(armedTaps.eventId, input.eventId)).limit(1),
    );
    if (exact) return { outcome: 'replay', armedTapId: exact.id };

    const waiting = firstOrUndefined(
      await tx
        .select()
        .from(armedTaps)
        .where(
          and(
            eq(armedTaps.studentId, input.studentId),
            eq(armedTaps.teacherId, input.teacherId),
            isNull(armedTaps.consumedAt),
          ),
        )
        .limit(1),
    );
    if (waiting) {
      if (waiting.expiresAt.getTime() > now.getTime()) {
        return { outcome: 'already_armed', armedTapId: waiting.id };
      }
      // The existing waiting tap has expired: replace it with this fresh one
      // (the partial unique index allows only one unconsumed row per pair).
      //
      // Guarded on consumed_at IS NULL, because a concurrent startSession can
      // consume this row between the select above and here — a session that
      // began just before the expiry boundary still converts a tap this branch
      // has already judged stale. Unguarded, the update writes a new event id
      // onto the row the conversion just consumed, and that armed tap now
      // names an event no tap_in ever recorded: the transient table and the
      // permanent history disagree about which tap was converted. (The guard
      // is only half of it — convertArmedTaps locks the taps it reads so this
      // cannot be reached from the other side either.)
      const refreshed = firstOrUndefined(
        await tx
          .update(armedTaps)
          .set({
            blockId: input.blockId ?? null,
            eventId: input.eventId,
            deviceTime: input.deviceTime,
            expiresAt: input.expiresAt,
          })
          .where(and(eq(armedTaps.id, waiting.id), isNull(armedTaps.consumedAt)))
          .returning({ id: armedTaps.id }),
      );
      if (refreshed) return { outcome: 'armed', armedTapId: refreshed.id };
      // Consumed under us. That frees the partial index, so fall through and
      // record this tap as a fresh waiting one rather than reporting a row
      // that no longer belongs to it. Residual, accepted: the student is now
      // focused in the session that just started AND holds a waiting tap, so
      // the teacher's NEXT session that day converts them without a fresh tap.
      // Decision 5 says a tap is a tap — they did physically tap the block —
      // and end-of-day expiry bounds it.
    }

    // ON CONFLICT on the waiting-tap index, not a bare insert: two pre-bell
    // taps from the same phone can both pass the selects above (neither is a
    // replay — each carries its own event id — and neither sees a waiting
    // row), and the loser would otherwise surface a raw 23505 as a 500 to a
    // student walking to their seat. The index arbitrates, the way insertEvent
    // lets it rather than racing a read.
    //
    // Bounded, because insert and re-read can chase each other: ON CONFLICT DO
    // NOTHING takes no lock on the row it conflicted with, so a Start can
    // consume that row before the re-read sees it, leaving neither a row from
    // the insert nor a standing tap to report. The slot is free again by then,
    // so another pass takes it. Looping beats throwing — a 500 on a pre-bell
    // tap is the exact symptom this function is being fixed for.
    for (let attempt = 0; attempt < ARM_TAP_ATTEMPTS; attempt += 1) {
      const row = firstOrUndefined(
        await tx
          .insert(armedTaps)
          .values({
            studentId: input.studentId,
            teacherId: input.teacherId,
            blockId: input.blockId ?? null,
            eventId: input.eventId,
            deviceTime: input.deviceTime,
            expiresAt: input.expiresAt,
          })
          .onConflictDoNothing({
            target: [armedTaps.studentId, armedTaps.teacherId],
            where: sql`${armedTaps.consumedAt} is null`,
          })
          .returning(),
      );
      if (row) return { outcome: 'armed', armedTapId: row.id };

      // Another tap won the slot. Report what is standing, which is the truth
      // this phone needs: a tap of theirs is already waiting.
      const standing = firstOrUndefined(
        await tx
          .select()
          .from(armedTaps)
          .where(
            and(
              eq(armedTaps.studentId, input.studentId),
              eq(armedTaps.teacherId, input.teacherId),
              isNull(armedTaps.consumedAt),
            ),
          )
          .limit(1),
      );
      if (standing) return { outcome: 'already_armed', armedTapId: standing.id };
    }
    throw new Error('armTap: could not arm or read a standing tap');
  });
}

export interface ExtendSessionInput {
  sessionId: string;
  /**
   * Minutes to add. Deliberately a duration, not an absolute end: the caller
   * used to read the session, do the arithmetic and hand over a fixed time,
   * so two simultaneous "add time" presses computed the same target from the
   * same starting point and the loser's value was no longer later than what
   * the winner had already committed — refused as INVALID_EXTENSION, and the
   * teacher's second press silently did nothing. Applied inside the locked
   * read below, each press adds to whatever it finds.
   */
  durationMinutes: number;
  at: Date;
  /**
   * Client-minted id that makes the extend idempotent (rule 4). The new end is
   * computed relative to the current one, so a retry after a lost response
   * would add the time a second time and shield the class past the bell. When
   * this id is already recorded the session is returned unchanged.
   */
  eventId?: string;
}

/** Move a running session's end time forward (teacher "add time"). */
export async function extendSession(db: Database, input: ExtendSessionInput): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId, { forUpdate: true });
    if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');

    // Replay first — ahead of BOTH guards below. A retry carries the same event
    // id and the same DURATION (the route stopped computing an end time when
    // the arithmetic moved in here), and a duration is always valid, so without
    // this the retry would read as a fresh extension and add the time twice —
    // shielding the class past a bell the teacher only pushed once. And once
    // the session has ended, a retry of an extend that did commit must still
    // re-read and return the current truth (rule 4) rather than 409.
    if (input.eventId) {
      const prior = firstOrUndefined(
        await tx
          .select({ type: events.type, sessionId: events.sessionId })
          .from(events)
          .where(eq(events.eventId, input.eventId))
          .limit(1),
      );
      if (prior) {
        // This session's own extend: a genuine replay, so return current truth.
        if (prior.type === 'session_extended' && prior.sessionId === session.id) return session;
        // A different event already owns this id. Carrying on would move the
        // end time while insertEvent de-duped the matching event row away,
        // leaving the session and its history disagreeing — the one thing this
        // engine exists to prevent. Refuse loudly rather than answer "extended"
        // for a write that did not happen (rule 5).
        throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another event');
      }
    }

    if (session.endedAt) throw new TransitionError('SESSION_NOT_RUNNING', 'session has ended');

    // Bounded at both ends, and the upper one is the same number the route's
    // zod cap uses. Refusing only what overflows the Date range is a guard at
    // the year 275760: `1e6` minutes clears it and ends the lesson in 2028,
    // which is not a duration any school could mean. If the engine is going to
    // distrust its caller here — and it should, since `/v1` is not the only
    // possible one — the bound has to be a real one.
    if (
      !Number.isFinite(input.durationMinutes) ||
      input.durationMinutes <= 0 ||
      input.durationMinutes > MAX_SESSION_MINUTES
    ) {
      throw new TransitionError(
        'INVALID_EXTENSION',
        `duration must be a positive number of minutes, at most ${MAX_SESSION_MINUTES}`,
      );
    }

    // Add to whichever is later: the current end (extend the remaining time)
    // or now (a session already past its end but not yet swept gets a fresh
    // window rather than a new end still in the past). Computed HERE, under
    // the same FOR UPDATE that loaded the session, so a concurrent extend has
    // either already committed and is included, or is waiting behind this one.
    const base = Math.max(input.at.getTime(), session.endsAt.getTime());
    const newEndsAt = new Date(base + input.durationMinutes * 60_000);
    // Kept even though MAX_SESSION_MINUTES now forecloses the way this used to
    // be reached (1e15 minutes): `base` comes from the stored session, so a row
    // whose end is already near the Date boundary still overflows on a
    // perfectly ordinary ten-minute press. An Invalid Date turns the
    // toISOString() below into a bare RangeError — an unmapped 500, where the
    // point of these guards is that the engine refuses its caller in its own
    // vocabulary. Pinned by "refuses an extension that would push the end past
    // the Date range", which writes that stored end through raw SQL because
    // the driver cannot serialise one: a JS Date past year 9999 goes out as
    // `+275760-...` and Postgres rejects the extended year (22009), though it
    // reads the same instant back as a valid Date quite happily.
    if (Number.isNaN(newEndsAt.getTime())) {
      throw new TransitionError('INVALID_EXTENSION', 'extension is out of range');
    }

    const updated = firstOrUndefined(
      await tx
        .update(sessions)
        .set({ endsAt: newEndsAt })
        .where(eq(sessions.id, session.id))
        .returning(),
    );
    if (!updated) throw new Error('extendSession: update returned no row');

    await insertEvent(tx, {
      eventId: input.eventId ?? newUuidV7(),
      type: 'session_extended',
      sessionId: session.id,
      classId: session.classId,
      occurredAt: clampToWindow(input.at, session.startedAt, newEndsAt),
      payload: {
        previousEndsAt: session.endsAt.toISOString(),
        newEndsAt: newEndsAt.toISOString(),
      },
    });
    return updated;
  });
}

export interface EndSessionInput {
  sessionId: string;
  at: Date;
  reason: 'ended' | 'expired';
}
export interface EndSessionResult {
  /** false when the session was already ended (idempotent no-op). */
  ended: boolean;
  endedParticipations: number;
}

/**
 * End a session and every live participation in it, in one transaction
 * (decision 6). Idempotent: ending an already-ended session is a no-op, so the
 * expiry sweep can double-fire harmlessly.
 */
export async function endSession(db: Database, input: EndSessionInput): Promise<EndSessionResult> {
  // Wrapped like startSession/tapIn/endEnrollment: this ends every participation
  // in the session set-wise while convertArmedTaps and endParticipationsElsewhere
  // touch the same rows one at a time, so either side can be the deadlock victim.
  // Ending a session is idempotent (the endedAt guard below), so re-running the
  // loser converges.
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const session = await loadSession(tx, input.sessionId, { forUpdate: true });
      if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');
      if (session.endedAt) return { ended: false, endedParticipations: 0 };

      const endedAt = clampToWindow(input.at, session.startedAt, session.endsAt);
      await tx.update(sessions).set({ endedAt }).where(eq(sessions.id, session.id));

      const participationReason: ParticipationEndedReason =
        input.reason === 'expired' ? 'session_expired' : 'session_ended';
      const endedRows = await tx
        .update(participations)
        .set({ endedAt, endedReason: participationReason })
        .where(and(eq(participations.sessionId, session.id), isNull(participations.endedAt)))
        .returning({ id: participations.id });

      await insertEvent(tx, {
        eventId: newUuidV7(),
        type: input.reason === 'expired' ? 'session_expired' : 'session_ended',
        sessionId: session.id,
        classId: session.classId,
        occurredAt: endedAt,
      });
      return { ended: true, endedParticipations: endedRows.length };
    }),
  );
}

/**
 * The expiry sweep (decision 6): end every session past its end time that
 * hasn't been ended yet. Idempotent — safe to run on a schedule and safe to
 * double-run. Returns the ids it ended.
 */
export async function expireDueSessions(db: Database, now: Date): Promise<string[]> {
  const due = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(isNull(sessions.endedAt), lte(sessions.endsAt, now)));

  const ended: string[] = [];
  const failed: string[] = [];
  for (const { id } of due) {
    // Per session, so one failure cannot abort the pass and leave the rest of
    // this minute's due sessions running — a session that never ends blocks the
    // next class and shows a live grid for a lesson that is over. Each expiry is
    // idempotent, so whatever failed is simply retried on the next tick.
    try {
      const result = await endSession(db, { sessionId: id, at: now, reason: 'expired' });
      if (result.ended) ended.push(id);
    } catch {
      failed.push(id);
    }
  }
  // Silence is not an option (rule 5): the caller logs this, and the next tick
  // retries. Throwing here would undo the point of the per-session guard.
  if (failed.length > 0) {
    console.warn(`expireDueSessions: ${failed.length} session(s) failed to expire`, failed);
  }
  return ended;
}

/**
 * The silence sweep (decision 3), the sweep's second duty. Open a silence
 * episode for every live, FOCUSED participation whose last contact
 * (`last_seen_at`, else `joined_at`) is older than SILENCE_THRESHOLD_MS and that
 * has no episode open. Only `focused` counts — `unlocked`/`protection_off` are
 * already not-green and stand regardless of contact, mirroring
 * deriveDisplayState. Each opening sets `silent_since` and emits one
 * `went_silent`.
 *
 * The per-candidate guarded UPDATE re-checks every mutable condition
 * (silent_since / ended_at / state / threshold) at write time, so it is
 * exactly-once even when two sweeps run at once — the loser marks nothing and
 * emits nothing — and it never opens an episode on a participation that a racing
 * check-in, unlock, or session-end changed after the scan. Idempotent and safe
 * to double-run. Returns how many episodes opened.
 */
export async function markSilentParticipations(db: Database, now: Date): Promise<number> {
  // Bind the cutoff as an ISO string with an explicit cast: a raw Date param
  // inside a bare sql template has no column type to guide the driver, and
  // postgres.js then can't serialize it (PGlite tolerates it, so casting keeps
  // both lanes identical).
  const cutoff = new Date(now.getTime() - SILENCE_THRESHOLD_MS).toISOString();
  const silent = sql`coalesce(${participations.lastSeenAt}, ${participations.joinedAt}) < ${cutoff}::timestamptz`;

  const candidates = await db
    .select({
      participationId: participations.id,
      sessionId: sessions.id,
      classId: sessions.classId,
      startedAt: sessions.startedAt,
      endsAt: sessions.endsAt,
      studentId: participations.studentId,
    })
    .from(participations)
    .innerJoin(sessions, eq(participations.sessionId, sessions.id))
    .where(
      and(
        isNull(participations.endedAt),
        isNull(participations.silentSince),
        eq(participations.state, 'focused'),
        isNull(sessions.endedAt),
        silent,
      ),
    );

  let opened = 0;
  for (const c of candidates) {
    const didOpen = await db.transaction(async (tx) => {
      const marked = await tx
        .update(participations)
        .set({ silentSince: now })
        .where(
          and(
            eq(participations.id, c.participationId),
            isNull(participations.silentSince),
            isNull(participations.endedAt),
            eq(participations.state, 'focused'),
            silent,
          ),
        )
        .returning({ id: participations.id });
      if (marked.length === 0) return false; // a racing sweep or a state change won
      await insertEvent(tx, {
        eventId: newUuidV7(),
        type: 'went_silent',
        sessionId: c.sessionId,
        classId: c.classId,
        userId: c.studentId,
        occurredAt: clampToWindow(now, c.startedAt, c.endsAt),
      });
      return true;
    });
    if (didOpen) opened += 1;
  }
  return opened;
}

export interface TapInput {
  sessionId: string;
  studentId: string;
  /** The client's idempotency key for this tap (rule 4). */
  eventId: string;
  /** The device's clock; clamped into the session window (rule 1). */
  deviceTime: Date;
}
export interface TapResult {
  outcome: 'joined' | 'switched' | 'replay';
  state: ParticipationState;
  participationId: string;
  session: SessionRow;
}

/**
 * A tap into a running session. If the student is live in another session,
 * that participation is ended as `left_for_other_session` first (decision 4),
 * so switching classes is never counted as an emergency unlock. Reactivating a
 * participation in a session the student previously left updates the existing
 * row (there is one row per student per session), never a duplicate.
 */
export async function tapIn(db: Database, input: TapInput): Promise<TapResult> {
  // Retry on deadlock: a cross-session switch-tap ends the student's other-session
  // participation while a concurrent endEnrollment reaches for the same row, so
  // either side can be the deadlock victim. Idempotent on event_id — safe to retry.
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const session = await loadSession(tx, input.sessionId, { forUpdate: true });
      if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');

      // Replay first — ahead of the ended-session guard, the placement
      // extendSession uses and for the same reason: a tap that DID land must
      // re-read and return the truth that was recorded (rule 4), never a 409
      // the phone reads as "keep retrying".
      //
      // The phone mints one id per physical tap and retries until it gets an
      // answer; the SERVER decides which session that tap means, picking the
      // newest RUNNING session of the tapped block's teacher that the student
      // is enrolled in. So a retry can resolve somewhere new — after that
      // teacher started a second session the student is also in — and
      // insertEvent would see the id against a different session and refuse
      // it. It can also resolve at a session that ends between that unlocked
      // lookup and this locked read, which at the bell is a burst of taps
      // meeting the per-minute expiry sweep.
      //
      // BOUNDED TO WHAT IS STILL TRUE, and that bound is the whole safety of
      // this branch: recorded truth is only a replay while it is also current
      // truth. TapResponse hands the phone {id, classId, endsAt} and cannot
      // say "that one is over" or "you have left it", so a stale answer here
      // is not a small inaccuracy — it is a shield:
      //   - an ENDED session keeps its original endsAt when the teacher ends
      //     it early, so replaying one points the phone at a window that has
      //     not closed yet. A foregrounded app heals inside one ~30s
      //     check-in (it answers `gone`), but enforcement deliberately does
      //     not need the network: the DeviceActivity monitor holds the shield
      //     to the window it was given, so a backgrounded phone stays locked
      //     to a bell that already rang, in a grid no teacher is watching and
      //     which no unlock can reach;
      //   - a participation the student LEFT (they tapped into the teacher's
      //     other session for real, decision 4) still reads `focused`, so
      //     replaying it points the phone at the session it left while the
      //     grid shows them green in the one they are in. Its next check-in
      //     there answers `gone` and unshields. That is the phone/grid drift
      //     the engine exists to prevent.
      // Declining costs a 409 — EVENT_ID_CONFLICT when the retry re-resolved
      // somewhere new, NOT_PARTICIPATING when it came back to the session that
      // recorded it with the student's row since ended, SESSION_NOT_RUNNING
      // when that session has itself ended. All three are loud: a non-401 4xx
      // is "keep the record, retry, and surface".
      //
      // Measured reach: deleting `!current.endedAt` turns "refuses to replay a
      // participation the student has since left" red. `!recorded.endedAt`
      // survives that check on its own, because ending a session ends every
      // live participation in it in the same transaction (both endSession and
      // expireDueSessions, each with its own test) — it is kept so this branch
      // does not silently depend on reading the session BEFORE the
      // participation, which is what makes that implication hold under READ
      // COMMITTED.
      //
      // What this gives up, since the server cannot tell a retry from a
      // deliberate reuse: a student's app resending a spent id for a second
      // physical tap into another session is answered as a replay, and that
      // join is suppressed. No privilege comes with it — the same student can
      // simply not tap, and the grid shows them absent either way — but it is
      // given up, not preserved. insertEvent's conflict check is untouched and
      // still fires for an id reused for a genuinely DIFFERENT event, which is
      // what the unlock path depends on (ISSUES #2).
      const prior = firstOrUndefined(
        await tx
          .select({ type: events.type, sessionId: events.sessionId, userId: events.userId })
          .from(events)
          .where(eq(events.eventId, input.eventId))
          .limit(1),
      );
      if (
        prior?.type === 'tap_in' &&
        prior.userId === input.studentId &&
        prior.sessionId !== null
      ) {
        // Reuse the locked row when the tap resolved back to its own session,
        // so the liveness check reads the authoritative copy rather than a
        // second unlocked snapshot of it. Reasoned, not pinned: replacing this
        // with an unconditional unlocked load leaves both lanes green, because
        // it only differs under an interleaving no test stages.
        //
        // The cross-session read stays UNLOCKED on purpose, and that one IS
        // measured: with `for update` on the other session, two taps crossing
        // in opposite directions order locks B-then-A against A-then-B and
        // deadlock for real (40P01 at Postgres's 1s deadlock_timeout), which
        // withDeadlockRetry would paper over rather than fix. Unlocked: no
        // deadlock, tens of milliseconds.
        //
        // What that leaves is narrow and self-healing: the recorded session
        // can end, or a concurrent tap into another session can end `current`
        // via endParticipationsElsewhere while holding only that session's
        // lock, just after both reads here — and the phone's next check-in
        // answers `gone`. Reading the session BEFORE the participation is what
        // keeps a concurrent end visible to at least the second read under
        // READ COMMITTED (staged and confirmed: the replay is refused).
        const recorded =
          prior.sessionId === session.id ? session : await loadSession(tx, prior.sessionId);
        const current = await loadParticipation(tx, prior.sessionId, input.studentId);
        if (recorded && !recorded.endedAt && current && !current.endedAt) {
          return {
            outcome: 'replay',
            state: current.state,
            participationId: current.id,
            session: recorded,
          };
        }
      }

      if (session.endedAt) throw new TransitionError('SESSION_NOT_RUNNING', 'session has ended');

      const occurredAt = clampToWindow(input.deviceTime, session.startedAt, session.endsAt);

      const isNew = await insertEvent(tx, {
        eventId: input.eventId,
        type: 'tap_in',
        sessionId: session.id,
        classId: session.classId,
        userId: input.studentId,
        occurredAt,
      });
      if (!isNew) {
        // The tap is on record for exactly this session and student —
        // insertEvent reports "not new" only for that — but the branch above
        // declined to replay it, and by this line the session is running, so
        // what it declined on was the PARTICIPATION: the row exists and has
        // ended. The engine writes that routinely (the student left for the
        // teacher's other session, or their enrollment was removed), so this
        // is an ordinary case and not the "event with no row behind it" it
        // may look like.
        //
        // Re-joining them here would be a fresh join wearing a spent id, and
        // answering 200 would tell the phone it is focused where it is not —
        // main did exactly that, reporting the stale `focused` off an ended
        // row. Refuse, and say the true thing: they are not in this session.
        // Pinned by "refuses a stale retry once the student has left the
        // session that recorded it".
        //
        // The cost is real and recorded in PLAN.md for the owner: a 409 is
        // "keep the record, retry, and surface", so this outbox record never
        // clears, and a later retry that finds nothing running arms the spent
        // id. Until a tap has a "recorded, and no longer current" answer,
        // there is no response here that is both honest and final.
        throw new TransitionError(
          'NOT_PARTICIPATING',
          // Says only what this branch knows. `loadParticipation` returning
          // nothing lands here too, and nothing in the engine deletes a
          // participation (decision 3), so that is unreachable today — but a
          // message claiming the row "has ended" would misdirect the first
          // person who ever does hit it.
          'this tap is on record, but you are no longer in this session',
        );
      }

      // Decision 4: end any live participation in a DIFFERENT session first, so
      // the one-live-per-student rule holds before we open this one.
      const switched = await endParticipationsElsewhere(
        tx,
        input.studentId,
        session.id,
        occurredAt,
      );
      const outcome: 'joined' | 'switched' = switched > 0 ? 'switched' : 'joined';

      // A tap on a row that is STILL LIVE with an open episode is contact, so it
      // closes that episode properly (one came_back) before the upsert below
      // clears the marker. Without this the episode never closes in the event
      // log and a silence report over-counts by the rest of the session. The
      // ended-stint case is different and already right: closeOpenSilence's
      // ended_at IS NULL guard skips it, and the upsert clears the stale marker
      // without a came_back, because that episode ended with the stint.
      const priorStint = await loadParticipation(tx, session.id, input.studentId);
      if (priorStint) {
        await closeOpenSilence(
          tx,
          {
            id: priorStint.id,
            sessionId: session.id,
            classId: session.classId,
            studentId: input.studentId,
          },
          occurredAt,
        );
      }

      const upserted = firstOrUndefined(
        await tx
          .insert(participations)
          .values({
            sessionId: session.id,
            studentId: input.studentId,
            state: 'focused',
            joinedAt: occurredAt,
            lastSeenAt: heardNow(),
          })
          .onConflictDoUpdate({
            target: [participations.sessionId, participations.studentId],
            set: {
              state: 'focused',
              joinedAt: occurredAt,
              lastSeenAt: heardNow(),
              endedAt: null,
              endedReason: null,
              // See convertArmedTaps: a revived row starts a fresh stint, so
              // the previous episode's marker must not survive it.
              silentSince: null,
            },
          })
          .returning(),
      );
      if (!upserted) throw new Error('tapIn: upsert returned no row');
      return { outcome, state: 'focused', participationId: upserted.id, session };
    }),
  );
}

/**
 * Contact from a phone closes any open silence episode: clear the marker and
 * record the one `came_back` it earns. Without this the marker outlives the
 * silence it recorded, and the sweep's `isNull(silent_since)` guard suppresses
 * that phone's NEXT went_silent forever (decision 7 promises the pair fires
 * exactly once per episode). The guarded UPDATE keeps it to one event even if
 * two contacts race; `ended_at IS NULL` keeps it to a live participation, like
 * the sweep and checkIn.
 */
async function closeOpenSilence(
  tx: Database,
  p: { id: string; sessionId: string; classId: string; studentId: string },
  at: Date,
): Promise<void> {
  const closed = await tx
    .update(participations)
    .set({ silentSince: null })
    .where(
      and(
        eq(participations.id, p.id),
        isNotNull(participations.silentSince),
        isNull(participations.endedAt),
      ),
    )
    .returning({ id: participations.id });
  if (closed.length === 0) return;
  await insertEvent(tx, {
    eventId: newUuidV7(),
    type: 'came_back',
    sessionId: p.sessionId,
    classId: p.classId,
    userId: p.studentId,
    occurredAt: at,
  });
}

export interface StateChangeInput {
  sessionId: string;
  studentId: string;
  eventId: string;
  deviceTime: Date;
}
export interface StateChangeResult {
  outcome: 'applied' | 'replay';
  state: ParticipationState;
  participationId: string;
  /** The current session, so the response carries the end time for reconciliation. */
  session: SessionRow;
}

/**
 * Shared body for the strict in-session state changes (refocus / protection
 * off): they need a live participation to move and refuse otherwise. Emergency
 * unlock does NOT use this — it must never refuse in a way that discards a
 * record (ISSUES.md #2), so it has its own body below.
 */
async function changeState(
  db: Database,
  input: StateChangeInput,
  eventType: EventType,
  nextState: ParticipationState,
): Promise<StateChangeResult> {
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId, { forUpdate: true });
    if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');
    if (session.endedAt) throw new TransitionError('SESSION_NOT_RUNNING', 'session has ended');

    const occurredAt = clampToWindow(input.deviceTime, session.startedAt, session.endsAt);

    const isNew = await insertEvent(tx, {
      eventId: input.eventId,
      type: eventType,
      sessionId: session.id,
      classId: session.classId,
      userId: input.studentId,
      occurredAt,
    });

    const row = await loadParticipation(tx, session.id, input.studentId);

    if (!isNew) {
      // Replay: return the current truth even if the participation has ended.
      if (!row)
        throw new TransitionError('NOT_PARTICIPATING', 'replayed change has no participation');
      return { outcome: 'replay', state: row.state, participationId: row.id, session };
    }

    // A fresh change needs a live participation to move.
    if (!row || row.endedAt !== null) {
      throw new TransitionError('NOT_PARTICIPATING', 'no live participation to change');
    }

    await closeOpenSilence(
      tx,
      {
        id: row.id,
        sessionId: session.id,
        classId: session.classId,
        studentId: input.studentId,
      },
      occurredAt,
    );
    await tx
      .update(participations)
      .set({ state: nextState, lastSeenAt: heardNow() })
      .where(eq(participations.id, row.id));
    return { outcome: 'applied', state: nextState, participationId: row.id, session };
  });
}

export interface UnlockResult {
  /** From @bali/shared's UNLOCK_RECORDED_OUTCOMES — all three mean the record is durably saved: 'applied' flipped a live participation, 'recorded' saved the note with none to flip, 'replay' the event already existed. */
  outcome: UnlockRecordedOutcome;
  /** Why nothing was flipped, on a fresh 'recorded' unlock; null for 'applied' and 'replay'. */
  recordedAs: UnlockRecordedAs | null;
  /** 'unlocked' when a live participation flipped; the participation's current state on a replay; null when nothing is participating. */
  state: ParticipationState | null;
  participationId: string | null;
  /** The session, so the response can carry the end time for reconciliation; null only when the session id was unknown. */
  session: SessionRow | null;
}

/**
 * Record an unlock that must survive but must NOT attach to a session — an
 * unknown session id, or a caller with no standing in the session they named.
 * Rule 6 forbids a refusal (the phone would read one as "discard"), so the
 * claim is kept as an orphan event instead: no session, no class, the claimed
 * id in the payload. There is no window to clamp to, so rule 1 applies the only
 * way it can — the server's clock stamps the row and the device's claim is
 * preserved beside it, so a wrong or hostile phone clock cannot write a 2099
 * unlock into permanent history.
 */
async function recordOrphanUnlock(
  tx: Database,
  input: StateChangeInput,
  recordedAs: Extract<UnlockRecordedAs, 'unknown_session' | 'not_enrolled'>,
): Promise<UnlockResult> {
  const isNew = await insertEvent(tx, {
    eventId: input.eventId,
    type: 'unlock',
    sessionId: null,
    classId: null,
    userId: input.studentId,
    occurredAt: new Date(),
    payload: {
      recorded_as: recordedAs,
      claimed_session_id: input.sessionId,
      device_time: input.deviceTime.toISOString(),
    },
  });
  return {
    outcome: isNew ? 'recorded' : 'replay',
    recordedAs: isNew ? recordedAs : null,
    state: null,
    participationId: null,
    session: null,
  };
}

/**
 * Emergency unlock — rule 5 and ISSUES.md #2: ALWAYS recorded, never discarded.
 * The v2 bug this kills: a student removed from a class mid-session hit Emergency
 * Unlock, the server answered "not in this class", and the app threw the record
 * away — an unshielded phone with no trace. So this never refuses in a way that
 * could mean "discard":
 *
 *   - a live participation flips to `unlocked` (the normal case, outcome 'applied');
 *   - no live participation (removed mid-session, or the participation already
 *     ended) still commits the event with a `payload.recorded_as` note and
 *     returns 'recorded' — the record stands though there is no state to move;
 *   - an already-ended session records with `after_session_end` rather than the
 *     old SESSION_NOT_RUNNING refusal;
 *   - even an unknown session id records an orphan event (no session/class) with
 *     `unknown_session`, so a bad id can't become a lost record either.
 *
 * Idempotent on event_id: a retried unlock re-reads and returns the current
 * truth as 'replay'. The response is the phone's signal to stop retrying
 * (@bali/shared unlockDisposition); every other result means "keep the record
 * and try again", never "discard".
 *
 * Two caller preconditions the endpoint must enforce, or a rollback loses the
 * record: `studentId` must be a real users row (events.userId is a NO-ACTION FK
 * — the verified Cognito principal satisfies it, and a soft-removed student keeps
 * their row), and `deviceTime` must be a finite Date (a NaN date reaches the NOT
 * NULL occurred_at — through clampToWindow on a known session, or raw on an
 * unknown one — and throws in the driver, so the endpoint rejects an unparseable
 * deviceTime with 400 first). Clamp note:
 * for a session ended early, occurredAt clamps to the scheduled endsAt, which can
 * land after the real endedAt but stays inside the window.
 */
export async function unlock(db: Database, input: StateChangeInput): Promise<UnlockResult> {
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId, { forUpdate: true });

    if (!session) {
      // Nothing to attach to — the record still survives, unattached.
      return recordOrphanUnlock(tx, input, 'unknown_session');
    }

    const occurredAt = clampToWindow(input.deviceTime, session.startedAt, session.endsAt);
    const row = await loadParticipation(tx, session.id, input.studentId);

    // The only authorization this endpoint has — and it can never be a refusal.
    // Without it any account holding a valid token could POST an unlock for a
    // session id it merely guessed and write permanent rows into a stranger's
    // class history, live grid and unlock reports. A caller with no
    // participation row here AND no active enrollment in the class has no
    // standing in this session, so the record is kept as an orphan (rule 6 —
    // never discarded) rather than attached to someone else's session.
    //
    // This does not weaken ISSUES #2: a student removed mid-session still has
    // their (now ended) participation row, so they keep attaching to the
    // session and their unlock is recorded against it exactly as before.
    if (row === undefined) {
      const enrolled = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.classId, session.classId),
            eq(enrollments.studentId, input.studentId),
            isNull(enrollments.removedAt),
          ),
        )
        .limit(1);
      if (enrolled.length === 0) return recordOrphanUnlock(tx, input, 'not_enrolled');
    }

    const live = row !== undefined && row.endedAt === null ? row : undefined;

    // The note when there's nothing live to flip: an ended session dominates
    // (the whole session is over), otherwise it's a student with no live
    // participation — removed from the class mid-session, the ISSUES #2 case.
    const note: UnlockRecordedAs = session.endedAt ? 'after_session_end' : 'no_live_participation';

    const isNew = await insertEvent(tx, {
      eventId: input.eventId,
      type: 'unlock',
      sessionId: session.id,
      classId: session.classId,
      userId: input.studentId,
      occurredAt,
      payload: live ? null : { recorded_as: note },
    });

    if (!isNew) {
      // Replay: return the current truth — the stored state if a participation
      // row exists at all (live or since-ended), never a refusal.
      return {
        outcome: 'replay',
        recordedAs: null,
        state: row?.state ?? null,
        participationId: row?.id ?? null,
        session,
      };
    }

    if (live) {
      await closeOpenSilence(
        tx,
        {
          id: live.id,
          sessionId: session.id,
          classId: session.classId,
          studentId: input.studentId,
        },
        occurredAt,
      );
      await tx
        .update(participations)
        .set({ state: 'unlocked', lastSeenAt: heardNow() })
        .where(eq(participations.id, live.id));
      return {
        outcome: 'applied',
        recordedAs: null,
        state: 'unlocked',
        participationId: live.id,
        session,
      };
    }

    // No live participation: the committed event is itself the record.
    return { outcome: 'recorded', recordedAs: note, state: null, participationId: null, session };
  });
}

/** Return to focus after an unlock. */
export function refocus(db: Database, input: StateChangeInput): Promise<StateChangeResult> {
  return changeState(db, input, 'refocus', 'focused');
}

/** Screen Time permission was turned off — its own state, never green, never an unlock. */
export function protectionOff(db: Database, input: StateChangeInput): Promise<StateChangeResult> {
  return changeState(db, input, 'protection_off', 'protection_off');
}

export interface CheckInInput {
  sessionId: string;
  studentId: string;
  deviceTime: Date;
}
export interface CheckInResult {
  /** 'live' with the current state, or 'gone' when there's no live participation to touch. */
  status: 'live' | 'gone';
  state: ParticipationState | null;
  /** The current session — carries the end time the phone reconciles against (decision 6 / API surface). */
  session: SessionRow;
}

/**
 * The ~30s heartbeat (decision 7). Overwrites `last_seen_at` only — it never
 * adds an events row, because nothing changed. The response carries the
 * current session (its end time, so a phone that missed an extension learns
 * of it) and the stored state; silence is derived from `last_seen_at` on read,
 * not stored here.
 */
export async function checkIn(db: Database, input: CheckInInput): Promise<CheckInResult> {
  const session = await loadSession(db, input.sessionId);
  if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');

  const live = await loadLiveParticipation(db, input.sessionId, input.studentId);
  if (!live) return { status: 'gone', state: null, session };

  const seenAt = clampToWindow(input.deviceTime, session.startedAt, session.endsAt);

  // The common heartbeat: no silence episode open, so a single cheap UPDATE and
  // no events row (decision 7 — a heartbeat that changes nothing writes no
  // history).
  if (live.silentSince === null) {
    await db
      .update(participations)
      .set({ lastSeenAt: heardNow() })
      .where(eq(participations.id, live.id));
    return { status: 'live', state: live.state, session };
  }

  // Closing a silence episode IS a change, so it earns a `came_back` event. The
  // guarded UPDATE (silent_since IS NOT NULL) emits exactly one per episode even
  // if two check-ins race — the loser just records its heartbeat. (If a sweep
  // opens an episode between the read above and here, the next check-in closes
  // it: a one-heartbeat lag, never a lost or duplicated `came_back`.)
  return db.transaction(async (tx) => {
    const closed = await tx
      .update(participations)
      .set({ lastSeenAt: heardNow(), silentSince: null })
      // `ended_at IS NULL` (like the sweep's guard) keeps `came_back` on a live
      // participation only: a check-in racing endSession then records no
      // came_back on the just-ended row (it falls through to the heartbeat below).
      .where(
        and(
          eq(participations.id, live.id),
          isNotNull(participations.silentSince),
          isNull(participations.endedAt),
        ),
      )
      .returning({ id: participations.id });
    if (closed.length === 0) {
      await tx
        .update(participations)
        .set({ lastSeenAt: heardNow() })
        .where(eq(participations.id, live.id));
      return { status: 'live', state: live.state, session };
    }
    await insertEvent(tx, {
      eventId: newUuidV7(),
      type: 'came_back',
      sessionId: session.id,
      classId: session.classId,
      userId: input.studentId,
      occurredAt: seenAt,
    });
    return { status: 'live', state: live.state, session };
  });
}

export interface JoinClassInput {
  studentId: string;
  joinCode: string;
  /** The client's idempotency key for the enrollment_joined event (rule 4). */
  eventId: string;
  occurredAt: Date;
}
export interface JoinClassResult {
  /** 'joined' created a new enrollment; 'already_enrolled' the student was already in (no-op). */
  outcome: 'joined' | 'already_enrolled';
  enrollmentId: string;
  class: ClassRow;
}

/**
 * Join a class by its code (auth decision 3). Locks the class row so concurrent
 * joins serialize, enrolls the student if they are not already actively enrolled,
 * and records an `enrollment_joined` event. Joining a class you are already in is
 * a no-op ('already_enrolled'), not an error. A prior removed enrollment is left
 * as history (decision 3): a re-join adds a fresh active row, so "who was in this
 * class in March" stays answerable rather than being rewritten.
 */
export async function joinClassByCode(
  db: Database,
  input: JoinClassInput,
): Promise<JoinClassResult> {
  return db.transaction(async (tx) => {
    const cls = firstOrUndefined(
      await tx
        .select()
        .from(classes)
        .where(and(eq(classes.joinCode, input.joinCode), isNull(classes.removedAt)))
        .limit(1)
        .for('update'),
    );
    if (!cls) throw new TransitionError('CLASS_NOT_FOUND', 'no active class with that join code');

    const active = firstOrUndefined(
      await tx
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.classId, cls.id),
            eq(enrollments.studentId, input.studentId),
            isNull(enrollments.removedAt),
          ),
        )
        .limit(1),
    );
    if (active) return { outcome: 'already_enrolled', enrollmentId: active.id, class: cls };

    const enrollment = firstOrUndefined(
      await tx
        .insert(enrollments)
        .values({ classId: cls.id, studentId: input.studentId })
        .returning(),
    );
    if (!enrollment) throw new Error('joinClassByCode: insert returned no row');

    // Idempotency here is the active-enrollment check above, not the event id: a
    // realistic re-join carries a fresh event id, and joins aren't offline-queued
    // like taps. (A replay of the original join's event id after a removal would
    // add a fresh enrollment while this event dedupes — narrow and benign.)
    await insertEvent(tx, {
      eventId: input.eventId,
      type: 'enrollment_joined',
      classId: cls.id,
      userId: input.studentId,
      // Rule 1 — the server owns the clock. A join has no session window to
      // clamp to, so it is stamped server-side and the phone's claim is kept in
      // the payload. events is append-only: a 2099 row from a wrong or hostile
      // device clock could never be corrected, and would skew every history
      // read that orders on occurred_at.
      occurredAt: new Date(),
      payload: { device_time: input.occurredAt.toISOString() },
    });
    return { outcome: 'joined', enrollmentId: enrollment.id, class: cls };
  });
}

export interface EndEnrollmentInput {
  enrollmentId: string;
  /** 'left_class' when the student leaves their own; 'removed_from_class' when the teacher removes them. */
  reason: 'left_class' | 'removed_from_class';
  at: Date;
}
export interface EndEnrollmentResult {
  /** 'ended' this call removed it; 'already_removed' it was gone (idempotent no-op). */
  outcome: 'ended' | 'already_removed';
  /** True when a live participation in this class's running session was ended too. */
  endedParticipation: boolean;
  classId: string;
  studentId: string;
}

/**
 * End an enrollment — a student leaving ('left_class') or a teacher removing them
 * ('removed_from_class'). The doc's canonical one-transaction case ("changes that
 * touch several tables happen in one transaction"): set removed_at, end the
 * student's live participation in this class's running session (if any) with the
 * matching reason, and record the event — all together or not at all. So the grid
 * learns via the session feed (the event carries the session id), the phone's
 * next check-in reads 'gone' and unshields, and a later emergency unlock still
 * lands (ISSUES #2 / step 2). Idempotent: an already-removed enrollment no-ops.
 */
export async function endEnrollment(
  db: Database,
  input: EndEnrollmentInput,
): Promise<EndEnrollmentResult> {
  const eventType: EventType =
    input.reason === 'left_class' ? 'enrollment_left' : 'enrollment_removed';
  const participationReason: ParticipationEndedReason = input.reason;
  // Retry on deadlock: a concurrent cross-session tapIn (the student switching
  // classes at the instant of removal) ends this same participation while holding
  // a different session's lock, so the two can deadlock on the participations row.
  // Idempotent on removed_at, so re-running is safe.
  return withDeadlockRetry(() =>
    db.transaction(async (tx) => {
      const enrollment = firstOrUndefined(
        await tx
          .select()
          .from(enrollments)
          .where(eq(enrollments.id, input.enrollmentId))
          .limit(1)
          .for('update'),
      );
      if (!enrollment) throw new TransitionError('ENROLLMENT_NOT_FOUND', 'no such enrollment');
      if (enrollment.removedAt !== null) {
        return {
          outcome: 'already_removed',
          endedParticipation: false,
          classId: enrollment.classId,
          studentId: enrollment.studentId,
        };
      }

      // This class's running session, locked so a concurrent tap/end into THIS
      // class serializes (a removal can't leave a live participation stranded in
      // an ended session, and endSession can't re-end this participation under a
      // wrong reason).
      const session = firstOrUndefined(
        await tx
          .select()
          .from(sessions)
          .where(and(eq(sessions.classId, enrollment.classId), isNull(sessions.endedAt)))
          .limit(1)
          .for('update'),
      );

      await tx
        .update(enrollments)
        .set({ removedAt: input.at })
        .where(eq(enrollments.id, enrollment.id));

      if (session) {
        // End the student's live participation with ONE guarded set-based UPDATE,
        // matching endSession — no read-then-update-by-id (that pattern, held
        // under two locks, made a cross-session tapIn deadlock near-certain). The
        // isNull guard means a participation ended by a racing switch-tap is left
        // as-is rather than overwritten.
        const occurredAt = clampToWindow(input.at, session.startedAt, session.endsAt);
        const ended = await tx
          .update(participations)
          .set({ endedAt: occurredAt, endedReason: participationReason })
          .where(
            and(
              eq(participations.sessionId, session.id),
              eq(participations.studentId, enrollment.studentId),
              isNull(participations.endedAt),
            ),
          )
          .returning({ id: participations.id });
        if (ended.length > 0) {
          // A live participation was ended — record it on the session feed so the
          // teacher's grid learns.
          await insertEvent(tx, {
            eventId: newUuidV7(),
            type: eventType,
            sessionId: session.id,
            classId: enrollment.classId,
            userId: enrollment.studentId,
            occurredAt,
          });
          return {
            outcome: 'ended',
            endedParticipation: true,
            classId: enrollment.classId,
            studentId: enrollment.studentId,
          };
        }
      }

      // No live participation to end (no running session, or the student was not
      // in it) — an enrollment-level event with no session.
      await insertEvent(tx, {
        eventId: newUuidV7(),
        type: eventType,
        sessionId: null,
        classId: enrollment.classId,
        userId: enrollment.studentId,
        occurredAt: input.at,
      });
      return {
        outcome: 'ended',
        endedParticipation: false,
        classId: enrollment.classId,
        studentId: enrollment.studentId,
      };
    }),
  );
}
