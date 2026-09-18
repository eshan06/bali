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
  /** Not saved yet — keep it and try again later. */
  | 'retry'
  /** The token was rejected — refresh it, then retry (keep the record). */
  | 'reauth';

/**
 * The unlock response outcomes that all mean "durably recorded", so the outbox
 * can stop retrying. Kept in sync with the engine's unlock() outcomes and the
 * UnlockResponse DTO: 'applied' flipped a live participation, 'recorded' saved
 * the note when there was none to flip, 'replay' means the event already landed.
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
 * ISSUES #2: only a 200 whose body carries a recorded outcome deletes the
 * record; a 401 means refresh-and-retry; everything else — a transport failure,
 * a transient 5xx/429, an unexpected 2xx, even a 4xx that must never occur for an
 * unlock under this contract (the server records instead of refusing) — keeps
 * the record and retries. Discarding is never a disposition.
 */
export function unlockDisposition(
  result: number | 'network_error',
  body?: { outcome?: string | null },
): UnlockDisposition {
  if (result === 'network_error') return 'retry';
  if (result === 401) return 'reauth';
  if (result === 200 && typeof body?.outcome === 'string' && isUnlockRecorded(body.outcome)) {
    return 'recorded';
  }
  return 'retry';
}
