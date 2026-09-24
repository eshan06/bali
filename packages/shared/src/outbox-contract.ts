import type { ProtectionOffResponse, RefocusResponse, TapOutcome } from './api.js';

/*
 * The outbox contracts for a tap and for a state change (refocus, protection
 * off) — the siblings of the unlock's (`unlock-contract.ts`). The phone writes
 * each one to its outbox, acts on it at once, and sends it; after one send
 * attempt these typed tables say what the outbox does with the record and
 * what the phone does next, so the Phase 3 iOS client (BaliCore mirrors them,
 * B1; the outbox is built on them, B3) implements against an explicit rule
 * instead of a guess. Each is a pure function of the HTTP status — or
 * 'network_error' when there was no response — and the body. The last export
 * is the reconcile rule: which answers may overwrite the phone's state.
 */

/** A table's keys are its whole outcome union, so a new outcome cannot compile until it is placed. */
function isOutcomeIn<K extends string>(table: Record<K, unknown>, outcome: unknown): outcome is K {
  return typeof outcome === 'string' && Object.hasOwn(table, outcome);
}

/** Whether an answer names a session — the only thing that ever gives a phone a window to shield to. */
function namesSession(body: { session?: unknown } | undefined): boolean {
  return typeof body?.session === 'object' && body.session !== null;
}

/** What the outbox does with a queued tap after one send attempt, and what the phone does next. */
export type TapDisposition =
  /**
   * Recorded, in a running session the answer names (`joined`, `switched`, or
   * the `replay` of a tap still live): delete the record and reconcile to the
   * answer. `session.endsAt` replaces decision 7's 50-minute cap; `state` is
   * the current truth — a replay's can be `unlocked` or `protection_off` — so
   * the phone is shielded only while it is `focused`.
   */
  | 'apply_session'
  /**
   * Armed (decision 5), or `already_armed` — a waiting tap of this student's
   * for this teacher already stands and covers this one: delete the record.
   * The tap joined nothing, so it gives the phone no window: show "Ready —
   * waiting for your teacher". A session the phone is already in is untouched
   * (arming ends nothing; only a join switches, decision 4). How the phone
   * learns of the Start is open decision 6.
   */
  | 'wait_for_start'
  /**
   * Recorded, but the answer names no running session: delete the record,
   * shield to nothing it says, and re-read the truth (`GET /v1/me`), which
   * says whether the phone is in a session at all. Today this is the `replay`
   * of a tap retried with nothing running: one that landed in a session since
   * over, or one still armed — its waiting row stands, so deleting is right,
   * but the answer does not say it waits. After A4 it is also every retry
   * recorded but no longer current.
   */
  | 'reread'
  /**
   * Not answered — no response, 408, 429, any 5xx, or a 2xx without a known
   * outcome: keep the record and retry with backoff. The phone keeps what it
   * did on its own; decision 7's cap still bounds the tap's shield.
   */
  | 'retry'
  /** The token was rejected: refresh it, then retry (keep the record). */
  | 'reauth'
  /**
   * Refused — any other 4xx: keep the record and keep retrying, because only
   * a 2xx lets the phone delete a tap and a 409 is either a tap the server
   * never kept or one no longer current (ARCHITECTURE, tap steps 9–10). Also
   * surface it (rule 5: no silent retry) and re-read the truth: the answer
   * carries no window, so the tap's own shield must not outlive it. A record
   * kept this way never holds up the records behind it.
   */
  | 'retry_and_surface';

/** Every outcome `POST /v1/taps` answers with (`TapResponse.outcome`). */
export const TAP_OUTCOMES = [
  'joined',
  'switched',
  'armed',
  'already_armed',
  'replay',
] as const satisfies readonly TapOutcome[];

/**
 * Where a recorded tap leaves the phone, by outcome. A join or a replay
 * shields only to a session the answer names; an armed tap never does, even
 * if an answer ever carried one — arming joins nothing.
 */
const TAP_RECORDED: Record<TapOutcome, 'joins' | 'waits'> = {
  joined: 'joins',
  switched: 'joins',
  replay: 'joins',
  armed: 'waits',
  already_armed: 'waits',
};

/**
 * The tap outbox's decision from one send attempt (`result` is the status, or
 * 'network_error'):
 *
 *   - a 2xx with a known outcome deletes the record — 'wait_for_start' when
 *     armed, 'apply_session' when it names a session, 'reread' when it names
 *     none. The session, not the outcome's name, decides whether there is a
 *     window, so `replay` with no session means "recorded — nothing to shield
 *     to, re-read the truth" today and after A4 alike.
 *   - 401 -> 'reauth'. No response, 408, 429, any 5xx, or a 2xx without a
 *     known outcome -> 'retry'.
 *   - any other 4xx -> 'retry_and_surface'. What `/v1/taps` refuses: 400 (a
 *     malformed tap; 413 and 415 are Fastify's), 404 (not a registered
 *     block), and 409 — `conflict`, told apart only by message (A5 decides
 *     whether errors get a machine-readable code). Today's 409s:
 *       - `EVENT_ID_CONFLICT`: the id is held by a different event — another
 *         student's, another kind, this student's tap under another teacher —
 *         or a retry the server re-resolved to another running session after
 *         the one that recorded it ended or the student left it;
 *       - `NOT_PARTICIPATING`: a retry that resolved back to its own session
 *         after the student left it;
 *       - `SESSION_NOT_RUNNING`: a fresh tap whose session ended between the
 *         server resolving the block and locking the session (the bell), or
 *         the retry of one recorded there.
 *     A4 answers every retry recorded but no longer current with `200 replay`
 *     and no session ('reread'). What stays a 409 after it: an id held by a
 *     different event, which never lands (a client bug — the student taps
 *     again, which mints a new id), and a fresh tap that raced its session's
 *     end, whose retry resolves afresh.
 */
export function tapDisposition(
  result: number | 'network_error',
  body?: { outcome?: string | null; session?: unknown },
): TapDisposition {
  if (result === 'network_error') return 'retry';
  if (result === 401) return 'reauth';
  if (result === 408 || result === 429) return 'retry';
  if (result >= 200 && result < 300) {
    const outcome = body?.outcome;
    if (!isOutcomeIn(TAP_RECORDED, outcome)) return 'retry';
    if (TAP_RECORDED[outcome] === 'waits') return 'wait_for_start';
    return namesSession(body) ? 'apply_session' : 'reread';
  }
  if (result >= 400 && result < 500) return 'retry_and_surface';
  return 'retry';
}

/** What the outbox does with a queued refocus or protection-off report after one send attempt. */
export type StateChangeDisposition =
  /**
   * Applied, or a replay while the session runs: delete the record and
   * reconcile to `session` and `state` (a replay answers the current state).
   */
  | 'apply_session'
  /**
   * Recorded with no session — a protection-off report that first reached
   * the server after its session ended (A2c), and its replay; both carry a
   * null `session` and `state`: delete the record; there is no window to
   * shield to, so re-read the truth (`GET /v1/me`).
   */
  | 'reread'
  /**
   * Refused — any 4xx but 401, 408 and 429: delete the record and never send
   * its id again (a refused change is final for its `event_id`), re-read the
   * truth, and show the refusal (rule 5).
   */
  | 'drop'
  /** Not answered — no response, 408, 429, any 5xx, or a 2xx without a known outcome: keep it and retry with backoff. */
  | 'retry'
  /** The token was rejected: refresh it, then retry (keep the record). */
  | 'reauth';

/** Every outcome refocus or protection off answers with. */
export type StateChangeOutcome = RefocusResponse['outcome'] | ProtectionOffResponse['outcome'];

/** Every outcome in `StateChangeOutcome`. */
export const STATE_CHANGE_OUTCOMES = [
  'applied',
  'recorded',
  'replay',
] as const satisfies readonly StateChangeOutcome[];

/** `recorded` means the session is over, so it never shields — even if an answer ever carried a session. */
const STATE_CHANGE_RECORDED: Record<StateChangeOutcome, 'running' | 'over'> = {
  applied: 'running',
  replay: 'running',
  recorded: 'over',
};

/**
 * The state-change outbox's decision from one send attempt, for
 * `POST /v1/sessions/{id}/refocus` and `…/protection-off` alike:
 *
 *   - a 2xx with a known outcome deletes the record — 'apply_session' when it
 *     names the running session, 'reread' when it names none (`recorded`, and
 *     its replay).
 *   - 401 -> 'reauth'. No response, 408, 429, any 5xx, or a 2xx without a
 *     known outcome -> 'retry'. 408 and 429 are the transport's, not a
 *     refusal: a change the server never decided on is never dropped.
 *   - any other 4xx -> 'drop'. The refusals: `409 session has ended` (any
 *     refocus after the end; a protection-off report after it from anyone not
 *     in the session at its end, or the retry of one that landed while it
 *     ran), `409 not in this session` (nothing live to change, or a report
 *     retried after the student left the running session), the 409 for a
 *     refocus out of protection off (only a re-tap returns), `409` for an id
 *     held by another event, 404 for an unknown session, 400 for a malformed
 *     body.
 *
 * Why a refusal is final: a refused change records nothing, so the server
 * treats its id as unused and a late resend would land as new — a refocus
 * refused out of protection off, resent after a re-tap and a fresh unlock,
 * would turn an unlocked phone green (A2's decision-log entry).
 *
 * Two outbox rules this table cannot express (the same entry):
 *   - a refocus a later tap or unlock has superseded is never sent — drop it
 *     unsent: it could only make the phone's truth older;
 *   - protection off is reported once per revocation — and again after any
 *     tap or join made while it is still revoked, since each returns the row
 *     to focused (a new report, under a new id).
 *
 * One answer this table cannot make safe on its own, until A4: a refocus
 * replayed after its participation ended while the session runs — the
 * student was removed or left the class; a switch is a later tap, covered
 * above — answers that ended row's last state with the running session,
 * which reads as 'apply_session'. A4 settles it on the server, before a phone
 * ships.
 */
export function stateChangeDisposition(
  result: number | 'network_error',
  body?: { outcome?: string | null; session?: unknown },
): StateChangeDisposition {
  if (result === 'network_error') return 'retry';
  if (result === 401) return 'reauth';
  if (result === 408 || result === 429) return 'retry';
  if (result >= 200 && result < 300) {
    const outcome = body?.outcome;
    if (!isOutcomeIn(STATE_CHANGE_RECORDED, outcome)) return 'retry';
    if (STATE_CHANGE_RECORDED[outcome] === 'over') return 'reread';
    return namesSession(body) ? 'apply_session' : 'reread';
  }
  if (result >= 400 && result < 500) return 'drop';
  return 'retry';
}

/**
 * The phone's count of its own state changes, taken when it sends a read of
 * the truth — a check-in, or `GET /v1/me` — and again when the answer comes.
 */
export interface ReconcileStamp {
  /**
   * Bumped each time the phone makes a state change — a tap, an unlock, a
   * refocus, a protection-off report, each acted on at once and written to
   * the outbox — and each time one is answered: its disposition is anything
   * but 'retry' or 'reauth'.
   */
  changes: number;
  /**
   * The phone's state changes still waiting for that answer. An unlock waits
   * until it is `recorded`: no read may put shields back over an emergency
   * unlock the server has not recorded.
   */
  awaiting: number;
}

/**
 * The reconcile rule (#56's review): a read never overrides a newer state
 * change. `checkIn` reads the participation's state before it writes, so a
 * check-in racing a refocus or an unlock can answer the state from before it
 * after the change's own answer has reached the phone — and any read can
 * simply arrive late. So a read's answer (its status, state and session) is
 * applied only when no state change of the phone's can be newer: none was
 * waiting for its answer when the read was sent, and none has been made or
 * answered since. Otherwise the read is stale: ignore it — the change's own
 * answer, or the next read, reconciles. (A change's own answer is not a read:
 * it is the truth as of that change, but a change the phone made after
 * sending it still stands on the phone until its own answer comes.)
 */
export function readMayReconcile(sent: ReconcileStamp, now: ReconcileStamp): boolean {
  return sent.awaiting === 0 && now.changes === sent.changes;
}
