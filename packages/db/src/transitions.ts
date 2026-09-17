import type { EventType, ParticipationEndedReason, ParticipationState } from '@bali/shared';
import { clampToWindow } from '@bali/shared';
import { and, eq, isNull, lte, ne, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import { newUuidV7 } from './ids.js';
import * as schema from './schema.js';
import { events, participations, sessions } from './schema.js';

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

// A handle that is either the pool or an open transaction — both satisfy this,
// so the internal helpers work whether called at top level or inside tx.
type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

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

async function loadSession(tx: Database, sessionId: string): Promise<SessionRow | undefined> {
  return firstOrUndefined(
    await tx.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1),
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

export interface StartSessionInput {
  classId: string;
  startedAt: Date;
  endsAt: Date;
}
export interface StartSessionResult {
  /** 'created' for a new session; 'existing' when one was already running (no duplicate). */
  outcome: 'created' | 'existing';
  session: SessionRow;
}

/**
 * Start a focus session for a class. If one is already running, return it
 * rather than creating a duplicate (API-surface decision). Waiting "armed"
 * taps becoming participations is deferred to the taps endpoint step, where
 * armed-tap storage is decided; students join a running session via `tapIn`.
 */
export async function startSession(
  db: Database,
  input: StartSessionInput,
): Promise<StartSessionResult> {
  return db.transaction(async (tx) => {
    const existing = firstOrUndefined(
      await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.classId, input.classId), isNull(sessions.endedAt)))
        .limit(1),
    );
    if (existing) return { outcome: 'existing', session: existing };

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
    return { outcome: 'created', session };
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
    const session = await loadSession(tx, input.sessionId);
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
    const session = await loadSession(tx, input.sessionId);
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
    const session = await loadSession(tx, input.sessionId);
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
      // Replay: the tap already landed. Return the current truth, unchanged.
      const current = await loadLiveParticipation(tx, session.id, input.studentId);
      if (!current)
        throw new TransitionError('NOT_PARTICIPATING', 'replayed tap has no live participation');
      return { outcome: 'replay', state: current.state, participationId: current.id, session };
    }

    // Decision 4: end any live participation in a DIFFERENT session first, so
    // the one-live-per-student rule holds before we open this one.
    const elsewhere = await tx
      .select()
      .from(participations)
      .where(
        and(
          eq(participations.studentId, input.studentId),
          isNull(participations.endedAt),
          ne(participations.sessionId, session.id),
        ),
      );
    let outcome: 'joined' | 'switched' = 'joined';
    for (const other of elsewhere) {
      await tx
        .update(participations)
        .set({ endedAt: occurredAt, endedReason: 'left_for_other_session' })
        .where(eq(participations.id, other.id));
      await insertEvent(tx, {
        eventId: newUuidV7(),
        type: 'left_for_other_session',
        sessionId: other.sessionId,
        userId: input.studentId,
        occurredAt,
      });
      outcome = 'switched';
    }

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
}

/** Shared body for the in-session state changes (unlock / refocus / protection off). */
async function changeState(
  db: Database,
  input: StateChangeInput,
  eventType: EventType,
  nextState: ParticipationState,
): Promise<StateChangeResult> {
  return db.transaction(async (tx) => {
    const session = await loadSession(tx, input.sessionId);
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

    const live = await loadLiveParticipation(tx, session.id, input.studentId);
    if (!live) throw new TransitionError('NOT_PARTICIPATING', 'no live participation to change');

    if (!isNew) return { outcome: 'replay', state: live.state, participationId: live.id };

    await tx
      .update(participations)
      .set({ state: nextState, lastSeenAt: occurredAt })
      .where(eq(participations.id, live.id));
    return { outcome: 'applied', state: nextState, participationId: live.id };
  });
}

/** Emergency unlock (rule 5: always recorded). */
export function unlock(db: Database, input: StateChangeInput): Promise<StateChangeResult> {
  return changeState(db, input, 'unlock', 'unlocked');
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
}

/**
 * The ~30s heartbeat (decision 7). Overwrites `last_seen_at` only — it never
 * adds an events row, because nothing changed. The response carries the
 * current stored state so the phone can reconcile; silence is derived from
 * `last_seen_at` on read, not stored here.
 */
export async function checkIn(db: Database, input: CheckInInput): Promise<CheckInResult> {
  const session = await loadSession(db, input.sessionId);
  if (!session) throw new TransitionError('SESSION_NOT_FOUND', 'no such session');

  const live = await loadLiveParticipation(db, input.sessionId, input.studentId);
  if (!live) return { status: 'gone', state: null };

  const seenAt = clampToWindow(input.deviceTime, session.startedAt, session.endsAt);
  await db.update(participations).set({ lastSeenAt: seenAt }).where(eq(participations.id, live.id));
  return { status: 'live', state: live.state };
}
