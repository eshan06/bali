import type {
  EventType,
  ParticipationEndedReason,
  ParticipationState,
  UnlockRecordedAs,
  UnlockRecordedOutcome,
} from '@bali/shared';
import { clampToWindow } from '@bali/shared';
import { and, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';

import { newUuidV7 } from './ids.js';
import { armedTaps, classes, enrollments, events, participations, sessions } from './schema.js';
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
 *     re-reads and returns the current truth without re-applying;
 *   - clamps any device timestamp into the session window (rule 1);
 *   - returns the resulting state, which is the phone's reconciliation channel.
 *
 * State derivation for display lives in @bali/shared (rule 2); this is the
 * write side.
 */

export type TransitionErrorCode =
  'SESSION_NOT_FOUND' | 'SESSION_NOT_RUNNING' | 'NOT_PARTICIPATING' | 'INVALID_EXTENSION';

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

function firstOrUndefined<T>(rows: T[]): T | undefined {
  return rows[0];
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
  return inserted.length > 0;
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
        lastSeenAt: occurredAt,
      })
      .onConflictDoUpdate({
        target: [participations.sessionId, participations.studentId],
        set: {
          state: 'focused',
          joinedAt: occurredAt,
          lastSeenAt: occurredAt,
          endedAt: null,
          endedReason: null,
        },
      });
    await insertEvent(tx, {
      eventId: tap.eventId,
      type: 'tap_in',
      sessionId: session.id,
      classId: session.classId,
      userId: tap.studentId,
      occurredAt,
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
  return db.transaction(async (tx) => {
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
  });
}

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
      await tx
        .update(armedTaps)
        .set({
          blockId: input.blockId ?? null,
          eventId: input.eventId,
          deviceTime: input.deviceTime,
          expiresAt: input.expiresAt,
        })
        .where(eq(armedTaps.id, waiting.id));
      return { outcome: 'armed', armedTapId: waiting.id };
    }

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
        .returning(),
    );
    if (!row) throw new Error('armTap: insert returned no row');
    return { outcome: 'armed', armedTapId: row.id };
  });
}

export interface ExtendSessionInput {
  sessionId: string;
  newEndsAt: Date;
  at: Date;
}

/** Move a running session's end time forward (teacher "add time"). */
export async function extendSession(db: Database, input: ExtendSessionInput): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId, { forUpdate: true });
    if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');
    if (session.endedAt) throw new TransitionError('SESSION_NOT_RUNNING', 'session has ended');
    if (input.newEndsAt.getTime() <= session.endsAt.getTime()) {
      throw new TransitionError(
        'INVALID_EXTENSION',
        'new end time must be later than the current one',
      );
    }

    const updated = firstOrUndefined(
      await tx
        .update(sessions)
        .set({ endsAt: input.newEndsAt })
        .where(eq(sessions.id, session.id))
        .returning(),
    );
    if (!updated) throw new Error('extendSession: update returned no row');

    await insertEvent(tx, {
      eventId: newUuidV7(),
      type: 'session_extended',
      sessionId: session.id,
      classId: session.classId,
      occurredAt: clampToWindow(input.at, session.startedAt, input.newEndsAt),
      payload: {
        previousEndsAt: session.endsAt.toISOString(),
        newEndsAt: input.newEndsAt.toISOString(),
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
  return db.transaction(async (tx) => {
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
  });
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
  for (const { id } of due) {
    const result = await endSession(db, { sessionId: id, at: now, reason: 'expired' });
    if (result.ended) ended.push(id);
  }
  return ended;
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
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId, { forUpdate: true });
    if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');
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
      // Replay: the tap already landed. Return the current truth (the row for
      // this session and student, even if it has since ended), never a 4xx.
      const current = await loadParticipation(tx, session.id, input.studentId);
      if (!current)
        throw new TransitionError('NOT_PARTICIPATING', 'replayed tap has no participation');
      return { outcome: 'replay', state: current.state, participationId: current.id, session };
    }

    // Decision 4: end any live participation in a DIFFERENT session first, so
    // the one-live-per-student rule holds before we open this one.
    const switched = await endParticipationsElsewhere(tx, input.studentId, session.id, occurredAt);
    const outcome: 'joined' | 'switched' = switched > 0 ? 'switched' : 'joined';

    const upserted = firstOrUndefined(
      await tx
        .insert(participations)
        .values({
          sessionId: session.id,
          studentId: input.studentId,
          state: 'focused',
          joinedAt: occurredAt,
          lastSeenAt: occurredAt,
        })
        .onConflictDoUpdate({
          target: [participations.sessionId, participations.studentId],
          set: {
            state: 'focused',
            joinedAt: occurredAt,
            lastSeenAt: occurredAt,
            endedAt: null,
            endedReason: null,
          },
        })
        .returning(),
    );
    if (!upserted) throw new Error('tapIn: upsert returned no row');
    return { outcome, state: 'focused', participationId: upserted.id, session };
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

    await tx
      .update(participations)
      .set({ state: nextState, lastSeenAt: occurredAt })
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
 * their row), and `deviceTime` must be a finite Date (a NaN date passes straight
 * through clampToWindow into the NOT NULL occurred_at and throws in the driver,
 * so the endpoint rejects an unparseable deviceTime with 400 first). Clamp note:
 * for a session ended early, occurredAt clamps to the scheduled endsAt, which can
 * land after the real endedAt but stays inside the window.
 */
export async function unlock(db: Database, input: StateChangeInput): Promise<UnlockResult> {
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId, { forUpdate: true });

    if (!session) {
      // Unknown session: nothing to clamp to or attach, but the record must
      // still survive — save an orphan event carrying the claimed id.
      const isNew = await insertEvent(tx, {
        eventId: input.eventId,
        type: 'unlock',
        sessionId: null,
        classId: null,
        userId: input.studentId,
        occurredAt: input.deviceTime,
        payload: { recorded_as: 'unknown_session', claimed_session_id: input.sessionId },
      });
      return {
        outcome: isNew ? 'recorded' : 'replay',
        recordedAs: isNew ? 'unknown_session' : null,
        state: null,
        participationId: null,
        session: null,
      };
    }

    const occurredAt = clampToWindow(input.deviceTime, session.startedAt, session.endsAt);
    const row = await loadParticipation(tx, session.id, input.studentId);
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
      await tx
        .update(participations)
        .set({ state: 'unlocked', lastSeenAt: occurredAt })
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
  await db.update(participations).set({ lastSeenAt: seenAt }).where(eq(participations.id, live.id));
  return { status: 'live', state: live.state, session };
}
