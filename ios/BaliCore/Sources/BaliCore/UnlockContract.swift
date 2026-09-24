import Foundation

// The emergency-unlock durability contract — packages/shared/src/unlock-contract.ts, ported
// (ISSUES #2: an emergency unlock record must never be lost). The phone writes an unlock to its
// own outbox first, sends it, and may delete it from the outbox ONLY once the server confirms the
// record is durably saved. This is the single typed table of "what does the outbox do with this
// send result", so the app implements against an explicit rule instead of a guess. The invariant
// that closes v2's lost-unlock bug: no result ever means discard-without-recording — and so
// `UnlockDisposition` has no case that discards.

/// What the phone's outbox does with a queued unlock after one send attempt. Each raw value is the
/// TypeScript's.
public enum UnlockDisposition: String, CaseIterable, Sendable {
    /// Durably recorded server-side (or on a replay) — safe to delete from the outbox.
    case recorded
    /// Not saved yet, transiently — keep it and try again later.
    case retry
    /// The token was rejected — refresh it, then retry (keep the record). An auth problem is never
    /// a reason to throw a record away.
    case reauth
    /// A 4xx but 401, 408 and 429 — one that must NOT happen for a well-formed authenticated unlock
    /// under this contract (the server records instead of refusing). Keep the record and keep
    /// retrying, but ALSO surface it: a client bug (a malformed 400, say) must not hide behind an
    /// endless silent retry (rule 5).
    case retryAndSurface = "retry_and_surface"
}

/// The unlock outbox's decision from one send attempt. The rule that keeps ISSUES #2 — the record
/// is deleted ONLY when it is durably saved, and no result ever means discard:
///
/// - any 2xx whose body carries a recorded outcome → `.recorded` (delete). The body's outcome is
///   the authoritative signal, so the exact 2xx code is not coupled to the decision. Every outcome
///   an unlock has means recorded, because unlock always records: `applied` flipped a live
///   participation, `recorded` saved a note and flipped nothing (no live participation, or its
///   protection is off — never softened), `replay` means the event already landed.
/// - 401 → `.reauth` (refresh the token, then retry).
/// - a transport failure, 408 (the request timed out), 429 (rate limited, ISSUES #1), any 5xx, or
///   a 2xx without a recorded outcome → `.retry` (transient; keep and try later). 408 and 429 are
///   the transport's, never a refusal, as in the tap and state-change tables.
/// - any other 4xx → `.retryAndSurface` (keep and retry, but surface — it must not happen for an
///   unlock, so it signals a bug, not a lost record).
///
/// `body` is the answer decoded as an `UnlockResponse` (see `SendResult`). An outcome this build
/// does not know (`.unknown`) is not one it can call recorded: `.retry` keeps the record.
public func unlockDisposition(_ result: SendResult, _ body: UnlockResponse?) -> UnlockDisposition {
    guard case .status(let status) = result else { return .retry }
    switch status {
    case 401: return .reauth
    case 408, 429: return .retry
    case 200..<300:
        // Every outcome, one by one: one BaliCore adds does not compile until it is placed here.
        switch body?.outcome.known {
        case .applied?, .recorded?, .replay?: return .recorded
        case nil: return .retry
        }
    case 400..<500: return .retryAndSurface
    default: return .retry
    }
}
