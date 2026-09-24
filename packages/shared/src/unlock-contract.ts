/*
 * The emergency-unlock durability contract (ISSUES.md #2 — "an emergency unlock
 * record must never be lost"). The phone writes an unlock to its own outbox
 * first, sends it, and may delete it from the outbox ONLY once the server
 * confirms the record is durably saved. This module is the single typed table of
 * "what does the outbox do with this send result", so the Phase 3 iOS client
 * implements against an explicit rule instead of a guess. The invariant that
 * closes v2's lost-unlock bug: no result ever means discard-without-recording.
 */

/** What the phone's outbox does with a queued unlock after one send attempt. */
export type UnlockDisposition =
  /** Durably recorded server-side (or on a replay) — safe to delete from the outbox. */
  | 'recorded'
  /** Not saved yet, transiently — keep it and try again later. */
  | 'retry'
  /** The token was rejected — refresh it, then retry (keep the record). */
  | 'reauth'
  /**
   * A 4xx but 401, 408 and 429 — one that must NOT happen for a well-formed
   * authenticated unlock under this contract (the server records instead of
   * refusing). Keep the record and keep retrying, but ALSO surface it: a client
   * bug (e.g. a malformed 400) must not hide behind an endless silent retry
   * (rule 5).
   */
  | 'retry_and_surface';

/**
 * Every outcome an unlock can have — and, because unlock always records, they
 * all mean "durably recorded", so the outbox stops retrying on any of them:
 * 'applied' flipped a live participation, 'recorded' saved a note and flipped
 * nothing (no live participation, its protection is off — never softened — or
 * the student came back to focus after it), 'replay' means the event already
 * landed. This is the single
 * source of truth for the outcome union: the engine's UnlockResult.outcome and
 * the UnlockResponse DTO both derive from it, so the three cannot drift.
 */
export const UNLOCK_RECORDED_OUTCOMES = ['applied', 'recorded', 'replay'] as const;
export type UnlockRecordedOutcome = (typeof UNLOCK_RECORDED_OUTCOMES)[number];

/** True when an unlock response outcome means the record is durably saved. */
export function isUnlockRecorded(outcome: string): outcome is UnlockRecordedOutcome {
  return (UNLOCK_RECORDED_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * The outbox's decision from one send attempt. `result` is the HTTP status code,
 * or 'network_error' when there was no response at all. The rule that keeps
 * ISSUES #2 — the record is deleted ONLY when it is durably saved, and no result
 * ever means discard:
 *
 *   - any 2xx whose body carries a recorded outcome -> 'recorded' (delete). The
 *     body outcome is the authoritative signal, so the exact 2xx code is not
 *     coupled to the decision.
 *   - 401 -> 'reauth' (refresh the token, then retry).
 *   - a transport failure, 408 (the request timed out), 429 (rate limited,
 *     ISSUES #1), any 5xx, or a 2xx without a recorded outcome -> 'retry'
 *     (transient; keep and try later). 408 and 429 are the transport's, never a
 *     refusal, as in the tap and state-change tables (A5).
 *   - any other non-401 4xx -> 'retry_and_surface' (keep and retry, but surface —
 *     it must not happen for an unlock, so it signals a bug, not a lost record).
 */
export function unlockDisposition(
  result: number | 'network_error',
  body?: { outcome?: string | null },
): UnlockDisposition {
  if (result === 'network_error') return 'retry';
  if (result === 401) return 'reauth';
  if (result === 408 || result === 429) return 'retry';
  if (result >= 200 && result < 300) {
    return typeof body?.outcome === 'string' && isUnlockRecorded(body.outcome)
      ? 'recorded'
      : 'retry';
  }
  if (result >= 400 && result < 500) return 'retry_and_surface';
  return 'retry';
}
