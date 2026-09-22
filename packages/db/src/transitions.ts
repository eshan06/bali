import type {
  EventType,
  ParticipationEndedReason,
  ParticipationState,
  UnlockRecordedAs,
  UnlockRecordedOutcome,
} from '@bali/shared';
import { clampToWindow, SILENCE_THRESHOLD_MS } from '@bali/shared';
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';

import { newUuidV7 } from './ids.js';
import { armedTaps, classes, enrollments, events, participations, sessions } from './schema.js';
import { isDeadlock, isUniqueViolation } from './sql-errors.js';
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

  let converted = 0;
  for (const tap of waiting) {
    const occurredAt = clampToWindow(tap.deviceTime, session.startedAt, session.endsAt);

    // A waiting tap can carry an event id that is ALREADY on record as a
    // `tap_in`, and when it does the tap is not a fresh pre-bell tap at all.
    // The phone mints one id per PHYSICAL tap, so a spent id can only be a
    // retry of one that already landed: it went into an earlier session, the
    // response was lost, and the retry — finding nothing of this teacher's
    // running — armed the same id, because `armTap` de-dupes against
    // `armed_taps.event_id` and never against `events`.
    //
    // Converting it is wrong in both directions. Under the spent id,
    // `insertEvent` refuses and rolls back this whole Start; since `waiting`
    // is selected by TEACHER, that teacher cannot open ANY class the student
    // is in until end of day. Under a fresh id — which is what shipped first —
    // the Start survives but the student is joined and SHIELDED in a class
    // they never tapped into, possibly hours later: a 09:00 tap whose response
    // was lost puts them in period 5. Both reproduced.
    //
    // So it is consumed and skipped. Decision 5's "a tap is a tap" is about a
    // tap that has not been honoured yet; this one already was, in the session
    // that recorded it. The student is not standing here, and if they are,
    // their next physical tap carries an id of its own.
    //
    // Caught rather than pre-checked, deliberately. An `events` pre-read would
    // be a read, not a lock — rows cannot be locked before they exist — so an
    // id can become spent between such a read and this insert: the phone's
    // POST /v1/taps times out client-side after arming, its retry reaches
    // another teacher's running session, and that tapIn commits while this
    // Start sits in its loop. The pre-read misses it and the Start rolls back
    // anyway, the same symptom through a narrower door. The refusal itself has
    // no such window. Safe to catch inside the transaction: insertEvent's ON
    // CONFLICT DO NOTHING succeeds at the SQL level and the conflict is a
    // TransitionError raised afterwards in JS, so nothing is poisoned.
    let spent = false;
    try {
      await insertEvent(tx, {
        eventId: tap.eventId,
        type: 'tap_in',
        sessionId: session.id,
        classId: session.classId,
        userId: tap.studentId,
        occurredAt,
      });
    } catch (err) {
      if (!(err instanceof TransitionError) || err.code !== 'EVENT_ID_CONFLICT') throw err;
      spent = true;
    }
    if (spent) {
      // Consumed, not left standing: it is spent, and a waiting row that
      // cannot convert would be retried at every Start until end of day.
      await tx
        .update(armedTaps)
        .set({ consumedAt: session.startedAt })
        .where(eq(armedTaps.id, tap.id));
      continue;
    }

    // Decision 4: a student armed here may already be live in another session
    // (they tapped a different teacher's running block after arming). End that
    // first, or the insert below would violate one-live-per-student and roll
    // back the whole Start.
    //
    // Note the ordering the `spent` catch above forces, because it is a real
    // change and not just a refactor: the `tap_in` is minted BEFORE this, so
    // within one Start a converted tap's `tap_in` now carries a LOWER `seq`
    // than the `left_for_other_session` it causes, where it used to carry a
    // higher one. It has to be this way round — a skipped tap must leave
    // nothing behind, and ending the other participation first would leave a
    // student unshielded everywhere off a row that is then discarded. Both
    // rows still carry the same `occurred_at`, and every feed read in
    // queries.ts is scoped to one session, so nothing today sees them in one
    // stream. One thing will: `events_user_seq_idx` on (user_id, seq) exists
    // for the student's own timeline, which is cross-session and seq-ordered
    // by construction, and it would show them joining period 2 before leaving
    // period 1. Order that timeline by `occurred_at` — identical on both rows,
    // because the engine stamps one `occurredAt` for the pair — rather than by
    // `seq`.
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
  /**
   * The waiting row this answer is about — absent only on the one `replay`
   * that has no row: an id already recorded in `events`, where the tap landed
   * in a session and nothing is waiting for it.
   */
  armedTapId?: string;
}

/**
 * Who holds `eventId` in `armed_taps` right now — the answer both 23505
 * recoveries in `armTap` need, and scoped the same way the `exact` select at
 * the top of `armTap` is.
 *
 * `'conflict'` rather than `'replay'` for a stranger's id: answering replay
 * would hand this phone's outbox someone else's row and tell it the tap is
 * durably recorded, so it drops a tap that was never armed. `'gone'` means the
 * rival rolled back or was swept between the violation and this read, which is
 * a retry rather than an answer.
 */
async function ownerOfEventId(
  tx: Database,
  eventId: string,
  studentId: string,
  teacherId: string,
): Promise<{ kind: 'replay'; armedTapId: string } | { kind: 'conflict' } | { kind: 'gone' }> {
  const owner = firstOrUndefined(
    await tx.select().from(armedTaps).where(eq(armedTaps.eventId, eventId)).limit(1),
  );
  if (!owner) return { kind: 'gone' };
  if (owner.studentId !== studentId || owner.teacherId !== teacherId) return { kind: 'conflict' };
  return { kind: 'replay', armedTapId: owner.id };
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
    // An id already in `events` is a tap that LANDED, so there is nothing to
    // arm and the honest answer is `replay`.
    //
    // Without this, the retry of a lost 200 arms a row the next Start is
    // guaranteed to throw away — the skip in convertArmedTaps consumes it,
    // emits no event and counts nothing — and the phone was told `armed` on
    // the way in. Told "ready", joined never, absent from the grid with
    // nothing in `events` to say why. No race and no second tap needed: tap at
    // 09:01, response lost, bell, outbox retries at 09:30 with nothing
    // running, 10:00 Start. The standing-row branch below already refuses to
    // let a SPENT id sit in a waiting row; this refuses to put one there.
    //
    // Scoped to the CALLER, like every other event-id lookup here. An id that
    // belongs to someone else's tap is not this phone's replay: answering
    // `replay` would tell this outbox the tap is durably recorded, so it drops
    // a tap that was never armed and never converts. `insertEvent` refuses the
    // same class of reuse for the same reason ("a student's app is an
    // adversary here"), and this holds that line: a non-401 4xx keeps the
    // record, retries, and surfaces, which loses nothing.
    const recorded = firstOrUndefined(
      await tx
        .select({ type: events.type, userId: events.userId })
        .from(events)
        .where(eq(events.eventId, input.eventId))
        .limit(1),
    );
    if (recorded) {
      // TYPE as well as caller, which is `insertEvent`'s standard and the
      // reason this comment invokes it. Matching on the student alone would
      // read a phone's own reused id — an `unlock` id sent again as a tap —
      // as this tap's replay: no armed row, no tap_in, and an outbox told the
      // tap is durably recorded, so it deletes it. Which is the silent lost
      // tap this whole check exists to stop, arrived by the other door.
      if (recorded.type !== 'tap_in' || recorded.userId !== input.studentId) {
        throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another event');
      }
      return { outcome: 'replay' };
    }

    // Same rule, one table over: a row in `armed_taps` under this id is this
    // phone's own waiting tap, or a stranger's and therefore not a replay.
    // Scoped to the teacher as well — a row of this student's for teacher X is
    // not the answer to a tap on teacher Y's block, and handing it back would
    // arm nothing for Y while telling the outbox it was recorded.
    const exact = firstOrUndefined(
      await tx.select().from(armedTaps).where(eq(armedTaps.eventId, input.eventId)).limit(1),
    );
    if (exact) {
      if (exact.studentId !== input.studentId || exact.teacherId !== input.teacherId) {
        throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another event');
      }
      return { outcome: 'replay', armedTapId: exact.id };
    }

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
      // Two ways a standing row is stale, and both hand the slot to this tap.
      //
      // The obvious one is expiry. The other is an id already on record: the
      // conversion at Start SKIPS such a row, because a spent id can only be
      // the retry of a tap that already landed — so leaving it standing would
      // let it swallow this physical tap with `already_armed`, and then
      // convert nothing. The student would be told "armed" twice and joined
      // never, absent from the grid with nothing in `events` to say why.
      // Reproduced before this check existed; pinned by "a fresh tap takes
      // over a standing row whose id is already spent".
      const spent =
        firstOrUndefined(
          await tx
            .select({ eventId: events.eventId })
            .from(events)
            .where(eq(events.eventId, waiting.eventId))
            .limit(1),
        ) !== undefined;
      if (waiting.expiresAt.getTime() > now.getTime() && !spent) {
        return { outcome: 'already_armed', armedTapId: waiting.id };
      }
      // The existing waiting tap is stale: replace it with this fresh one
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
      //
      // In a SAVEPOINT for the same reason the insert below is, and this PR is
      // what makes it matter: the refresh writes `input.eventId` into a column
      // carrying its OWN unique index, after a non-locking `exact` read that
      // cannot see an uncommitted rival — and the stale check above widened
      // this path from "expired rows only" to every standing row whose id is
      // spent. Unguarded, that 23505 aborts the whole transaction and
      // `POST /v1/taps` answers 500: exactly the pre-bell failure the insert's
      // savepoint was added to remove, reached through the other write.
      // Answered the same way too, so the two paths cannot drift.
      let refreshed: { id: string } | undefined;
      let consumedUnderUs = false;
      let lastRefreshViolation: unknown;
      for (let attempt = 0; attempt < ARM_TAP_ATTEMPTS; attempt += 1) {
        try {
          refreshed = firstOrUndefined(
            await tx.transaction(async (sp) =>
              sp
                .update(armedTaps)
                .set({
                  blockId: input.blockId ?? null,
                  eventId: input.eventId,
                  deviceTime: input.deviceTime,
                  expiresAt: input.expiresAt,
                })
                .where(and(eq(armedTaps.id, waiting.id), isNull(armedTaps.consumedAt)))
                .returning({ id: armedTaps.id }),
            ),
          );
          consumedUnderUs = refreshed === undefined;
          break;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          // Kept for the give-up below: a bare Error there would discard the
          // constraint name, and it ships as a 500 on a pre-bell tap.
          lastRefreshViolation = err;
          const owner = await ownerOfEventId(tx, input.eventId, input.studentId, input.teacherId);
          if (owner.kind === 'conflict') {
            throw new TransitionError(
              'EVENT_ID_CONFLICT',
              'event_id already used by another event',
            );
          }
          if (owner.kind === 'replay') return { outcome: 'replay', armedTapId: owner.armedTapId };
          // Gone again — the rival rolled back, so the id is free and the
          // refresh can land. The attempt bound covers the chase.
        }
      }
      if (refreshed) return { outcome: 'armed', armedTapId: refreshed.id };
      if (!consumedUnderUs) {
        // Three violations and the owner gone every time. Falling through to
        // the insert would answer `already_armed` about the very row this
        // branch just judged stale, which is the lie the stale check exists to
        // stop, so say what happened instead.
        throw new Error('armTap: could not refresh a stale standing tap', {
          cause: lastRefreshViolation,
        });
      }
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
    let lastUniqueViolation: unknown;
    for (let attempt = 0; attempt < ARM_TAP_ATTEMPTS; attempt += 1) {
      // In a SAVEPOINT, because the arbiter above covers only ONE of this
      // table's two unique indexes. `event_id` carries its own, and it is
      // reachable: the `exact` select at the top of this function can miss a
      // concurrent delivery of this same tap that has not committed yet, and
      // by the time this insert runs that row can be committed AND consumed by
      // a Start — so it is outside the waiting partial index, the arbiter does
      // not match, and the insert lands on `armed_taps_event_id_unique`
      // instead. Measured: a raw 23505 out of a statement built exactly like
      // this one. Unhandled, it is the 500 on a pre-bell tap that this whole
      // function is being fixed for, just reached by the other index.
      //
      // Pinned, and this sentence used to say the opposite — it claimed
      // nothing went red if the recovery were removed, in the same commit that
      // added the test which does. Left uncorrected it is an invitation to
      // delete the savepoint as dead weight. "a delivery that loses the
      // event_id index is answered as a replay, not a 500" stages the
      // interleaving with a held transaction, on the real-Postgres lane CI
      // runs; rethrowing instead of recovering, or dropping the savepoint,
      // each turns it red.
      let row: typeof armedTaps.$inferSelect | undefined;
      let idAlreadyTaken = false;
      try {
        row = firstOrUndefined(
          await tx.transaction(async (sp) =>
            sp
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
          ),
        );
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // A 23505 here is read as `event_id`, because that is the only unique
        // index on this table the arbiter above does not cover. Keep the
        // driver's own error anyway: if a third one is ever added, the owner
        // lookup below finds nothing, the attempts burn, and the throw at the
        // end of this loop would otherwise discard the constraint name that
        // says what actually happened.
        lastUniqueViolation = err;
        idAlreadyTaken = true;
      }
      if (row) return { outcome: 'armed', armedTapId: row.id };

      if (idAlreadyTaken) {
        // Another delivery of THIS tap got there first — a replay, the same
        // answer the `exact` select above would have given had it seen the
        // row, and scoped the same way for the same reason.
        const owner = await ownerOfEventId(tx, input.eventId, input.studentId, input.teacherId);
        if (owner.kind === 'conflict') {
          throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another event');
        }
        if (owner.kind === 'replay') return { outcome: 'replay', armedTapId: owner.armedTapId };
        continue; // gone again; the attempt bound covers the chase
      }

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
    throw new Error('armTap: could not arm or read a standing tap', {
      cause: lastUniqueViolation,
    });
  });
}

export interface ExtendSessionInput {
  sessionId: string;
  newEndsAt: Date;
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
    // id but a newEndsAt recomputed from the already-extended end, so it would
    // otherwise read as a fresh, valid extension; and once the session has
    // ended, a retry of an extend that did commit must still re-read and return
    // the current truth (rule 4) rather than 409.
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
      eventId: input.eventId ?? newUuidV7(),
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
