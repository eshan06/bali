package com.bali.core

// The outbox contracts for a tap and for a state change (refocus, protection off, the lock back
// on), the siblings of the unlock's, and the reconcile rule: packages/shared/src/outbox-contract.ts,
// ported as BaliCore's OutboxContract.swift ports it. The phone writes each record to its outbox,
// acts on it at once, and sends it; after one send attempt these typed tables say what the outbox
// does with the record and what the phone does next (the outbox is built on them, AN4b and AN4c).
// The TypeScript is the source: contracts/outbox/ holds its answer on every input its tests
// generate, contracts/fixtures/ its answer to each real one, and the contract tests fail until this
// port agrees with both.

/**
 * One send attempt's result, as every outbox table takes it: the status the server answered with,
 * or no answer at all, `'network_error'` in the TypeScript.
 *
 * Each table also takes the answer's body, decoded as the endpoint's response type: none when there
 * is none, or when it doesn't decode as one ([ApiResponse.answer]): no known outcome, so the record
 * is kept, never deleted on a guess. (The TypeScript reads the raw body; on a malformed one the API
 * never sends, a `session` that is not a session, it may delete where the port keeps.)
 */
sealed interface SendResult {
    data class Status(val code: Int) : SendResult
    data object NetworkError : SendResult
}

/**
 * What the outbox does with a queued tap after one send attempt, and what the phone does next:
 * `@bali/shared`'s `TapDisposition`. Never sent: each [wire], Swift's raw value, is the
 * TypeScript's spelling, as `contracts/` holds it.
 */
enum class TapDisposition(override val wire: String) : Vocabulary {
    /**
     * Recorded, in a running session the answer names (`joined`, `switched`, or the `replay` of a
     * tap still live): delete the record and reconcile to the answer. `session.endsAt` replaces
     * decision 7's 50-minute cap; `state` is the current truth (a replay's can be `unlocked` or
     * `protection_off`, a late tap's, A13, included), so the phone is locked only while it is
     * `focused`.
     */
    ApplySession("apply_session"),

    /**
     * Armed (decision 5), or `already_armed`: a waiting tap of this student's for this teacher
     * already stands and covers this one, which is also the answer to the retry of a tap still
     * waiting (A4): delete the record. The tap joined nothing, so it gives the phone no window:
     * show "Ready, waiting for your teacher". A session the phone is already in is untouched
     * (arming ends nothing; only a join switches, decision 4). How the phone learns of the Start
     * is open decision 6.
     */
    WaitForStart("wait_for_start"),

    /**
     * Recorded, but the answer names no running session: delete the record, lock to nothing it
     * says, and re-read the truth (`GET /v1/me`), which says whether the phone is in a session at
     * all. This is the `replay` of a tap recorded but no longer current (A4): its participation
     * ended (the student switched away, left or was removed from the class) or its session is
     * over, whether the retry reached a running session or found nothing running.
     */
    Reread("reread"),

    /**
     * Not answered (no response, 408, 429, any 5xx, or a 2xx without a known outcome): keep the
     * record and retry with backoff. The phone keeps what it did on its own; decision 7's cap
     * still bounds the tap's lock.
     */
    Retry("retry"),

    /** The token was rejected: refresh it, then retry (keep the record). */
    Reauth("reauth"),

    /**
     * Refused, any other 4xx: keep the record and keep retrying, because only a 2xx lets the phone
     * delete a tap and a 409 is a tap the server never kept (ARCHITECTURE, tap steps 9–10). Also
     * surface it (rule 5: no silent retry) and re-read the truth: the answer carries no window, so
     * the tap's own lock must not outlive it. A record kept this way never holds up the records
     * behind it.
     */
    RetryAndSurface("retry_and_surface"),
}

/**
 * The tap outbox's decision from one send attempt:
 *
 * - a 2xx with a known outcome deletes the record: [TapDisposition.WaitForStart] when armed,
 *   [TapDisposition.ApplySession] when it names a session, [TapDisposition.Reread] when it names
 *   none. The session, not the outcome's name, decides whether there is a window, so `replay` with
 *   no session means "recorded: nothing to lock to, re-read the truth".
 * - 401: [TapDisposition.Reauth]. No response, 408, 429, any 5xx, or a 2xx without a known outcome
 *   (one this build doesn't know included): [TapDisposition.Retry].
 * - any other 4xx: [TapDisposition.RetryAndSurface]. What `/v1/taps` refuses: 400 (a malformed
 *   tap; 413 and 415 are Fastify's), 404 (not a registered block), and 409, `conflict`, told apart
 *   by `error.reason`. The 409s:
 *   - `event_id_conflict`: the id is held by a different event (another student's, another kind,
 *     or this student's tap under another teacher: always when arming; when joining, once that tap
 *     is no longer current), which never lands (a client bug: the student taps again, which mints a
 *     new id);
 *   - `session_not_running`: a fresh tap whose session ended between the server resolving the
 *     block and locking the session (the bell), whose retry resolves afresh.
 *
 *   A retry recorded but no longer current is not among them since A4: it is `200 replay` with no
 *   session ([TapDisposition.Reread]).
 */
fun tapDisposition(result: SendResult, body: TapResponse?): TapDisposition {
    val status = (result as? SendResult.Status)?.code ?: return TapDisposition.Retry
    return when (status) {
        401 -> TapDisposition.Reauth
        408, 429 -> TapDisposition.Retry
        in 200..299 ->
            // Every outcome, one by one: one `core` adds does not compile until it is placed here.
            when (body?.outcome?.known) {
                // A join or a replay locks only to a session the answer names.
                TapOutcome.Joined, TapOutcome.Switched, TapOutcome.Replay ->
                    if (body?.session != null) TapDisposition.ApplySession else TapDisposition.Reread
                // An armed tap never does, even if an answer ever carried one: arming joins nothing.
                TapOutcome.Armed, TapOutcome.AlreadyArmed -> TapDisposition.WaitForStart
                null -> TapDisposition.Retry
            }
        in 400..499 -> TapDisposition.RetryAndSurface
        else -> TapDisposition.Retry
    }
}

/**
 * What the outbox does with a queued refocus or protection-off report after one send attempt:
 * `@bali/shared`'s `StateChangeDisposition`. Never sent: each [wire], Swift's raw value, is the
 * TypeScript's spelling, as `contracts/` holds it.
 */
enum class StateChangeDisposition(override val wire: String) : Vocabulary {
    /**
     * Applied, or a replay while the session runs: delete the record and reconcile to `session`
     * and `state` (a replay answers the current state, as a late refocus does, A13).
     */
    ApplySession("apply_session"),

    /**
     * Recorded with no session: a protection-off report that first reached the server after its
     * session ended (A2c), and its replay; and the replay of a refocus whose participation ended
     * while its session runs (A4). Each carries a null `session` and `state`: delete the record;
     * there is no window to lock to, so re-read the truth (`GET /v1/me`).
     */
    Reread("reread"),

    /**
     * Refused, any 4xx but 401, 408 and 429: delete the record and never send its `eventId` again
     * (a refused change is final for its id), re-read the truth, and show the refusal (rule 5). See
     * [stateChangeDisposition] for why.
     */
    Drop("drop"),

    /**
     * Not answered (no response, 408, 429, any 5xx, or a 2xx without a known outcome): keep it and
     * retry with backoff.
     */
    Retry("retry"),

    /** The token was rejected: refresh it, then retry (keep the record). */
    Reauth("reauth"),
}

/**
 * An answer [stateChangeDisposition] reads: a refocus's, a protection-off report's or the lock back
 * on's, the TypeScript's `RefocusResponse | ProtectionOffResponse | ProtectionOnResponse`, a union
 * as closed as this interface is sealed.
 */
sealed interface StateChangeAnswer {
    val outcome: OrUnknown<Vocabulary>
    val session: SessionView?

    /**
     * The outcome read as a [StateChangeOutcome], the union of the three endpoints' outcomes: from
     * its wire value, so a refocus answered `recorded` reads as a report's would; none for one this
     * build doesn't know.
     */
    val stateChangeOutcome: StateChangeOutcome? get() = StateChangeOutcome.Wire.of(outcome.wire)
}

/**
 * The state-change outbox's decision from one send attempt, for `POST /v1/sessions/{id}/refocus`,
 * `…/protection-off` and `…/protection-on` (#167) alike:
 *
 * - a 2xx with a known outcome deletes the record: [StateChangeDisposition.ApplySession] when it
 *   names the running session, [StateChangeDisposition.Reread] when it names none (`recorded` and
 *   its replay; a refocus replayed after the student was removed, left the class or switched away,
 *   A4).
 * - 401: [StateChangeDisposition.Reauth]. No response, 408, 429, any 5xx, or a 2xx without a known
 *   outcome (one this build doesn't know included): [StateChangeDisposition.Retry]. 408 and 429 are
 *   the transport's, not a refusal: a change the server never decided on is never dropped.
 * - any other 4xx: [StateChangeDisposition.Drop]. The refusals: `409 session has ended` (any
 *   refocus after the end; a protection-off report after it from anyone not in the session at its
 *   end, or the retry of one that landed while it ran), `409 not in this session` (nothing live to
 *   change, or a report retried after the student left the running session), the 409 for a refocus
 *   out of protection off (a re-tap or the lock back on returns), the 409 for the lock back on with
 *   protection not off, `409` for an id held by another event, 404 for an unknown session, 400 for
 *   a malformed body.
 *
 * Why a refusal is final: a refused change records nothing, so the server treats its id as unused
 * and a late resend would land as new: a refocus refused out of protection off, resent after a
 * re-tap and a fresh unlock, would turn an unlocked phone green (docs/DECISIONS.md, A2).
 *
 * Two outbox rules this table cannot express:
 * - a refocus a later tap or unlock has superseded is never sent: drop it unsent, as it could only
 *   make the phone's truth older;
 * - protection off is reported once per revocation, and again after any tap or join made while it
 *   is still revoked, since each returns the row to focused (a new report, under a new id).
 *
 * The first covers a refocus superseded by a switch, but not by a removal or by leaving the class,
 * nor one already in flight, so the server answers a refocus replayed after the participation ended
 * with no session (A4).
 *
 * One entry point for every answer, as in the TypeScript: [body] is a [StateChangeAnswer], or none,
 * and a literal `null` compiles, where one overload per answer type made it ambiguous.
 */
fun stateChangeDisposition(result: SendResult, body: StateChangeAnswer?): StateChangeDisposition {
    val status = (result as? SendResult.Status)?.code ?: return StateChangeDisposition.Retry
    return when (status) {
        401 -> StateChangeDisposition.Reauth
        408, 429 -> StateChangeDisposition.Retry
        in 200..299 ->
            // Every outcome, one by one: one `core` adds does not compile until it is placed here.
            when (body?.stateChangeOutcome) {
                StateChangeOutcome.Applied, StateChangeOutcome.Replay ->
                    if (body?.session != null) StateChangeDisposition.ApplySession else StateChangeDisposition.Reread
                // `recorded` means the session is over, so it never locks, even if an answer ever
                // carried a session.
                StateChangeOutcome.Recorded -> StateChangeDisposition.Reread
                null -> StateChangeDisposition.Retry
            }
        in 400..499 -> StateChangeDisposition.Drop
        else -> StateChangeDisposition.Retry
    }
}

/**
 * The phone's count of its own state changes, taken when it sends a read of the truth (a check-in,
 * or `GET /v1/me`) and again when the answer comes. A value, as Swift's struct is: a count changes
 * through `copy`, so a stamp once taken never moves.
 */
data class ReconcileStamp(
    /**
     * Bumped each time the phone makes a state change (a tap, an unlock, a refocus, a
     * protection-off report, each acted on at once and written to the outbox) and each time an
     * answer to one arrives: any disposition but retry or reauth, including every later answer to
     * a record the outbox kept and resent.
     */
    val changes: Int,
    /**
     * How many of those changes still wait for their answer, each counted once, from when it is
     * made until its first answer, or, for an unlock, until it is [UnlockDisposition.Recorded],
     * since no read may put the lock back over an emergency unlock the server has not recorded. A
     * kept record's later answers never touch it, so it never goes below zero. A record stuck at
     * the outbox's retry bound stops counting; a stuck unlock still guards its session (B3a).
     */
    val awaiting: Int,
)

/**
 * The reconcile rule (#56's review): a read never overrides a newer state change. A check-in reads
 * the participation's state before it writes, so a check-in racing a refocus or an unlock can
 * answer the state from before it after the change's own answer has reached the phone, and any
 * read can simply arrive late. So a read's answer (its status, state and session) is applied only
 * when no state change of the phone's can be newer: none was waiting for its answer when the read
 * was sent, and none has been made or answered since. Otherwise the read is stale: ignore it; the
 * change's own answer, or the next read, reconciles. (A change's own answer is not a read: it is
 * the truth as of that change, but a change the phone made after sending it still stands on the
 * phone until its own answer comes.)
 */
fun readMayReconcile(sent: ReconcileStamp, now: ReconcileStamp): Boolean =
    sent.awaiting == 0 && now.changes == sent.changes
