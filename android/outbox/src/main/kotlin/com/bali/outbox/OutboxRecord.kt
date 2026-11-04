package com.bali.outbox

import com.bali.core.ActionOrder
import com.bali.core.ApiClient
import com.bali.core.ApiErrorBody
import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.NoAnswer
import com.bali.core.OrUnknown
import com.bali.core.ParticipationState
import com.bali.core.ProtectionOffRequest
import com.bali.core.ProtectionOnRequest
import com.bali.core.RefocusRequest
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.StateChangeAnswer
import com.bali.core.StateChangeDisposition
import com.bali.core.TapDisposition
import com.bali.core.TapRequest
import com.bali.core.UnlockDisposition
import com.bali.core.UnlockReason
import com.bali.core.UnlockRecordedAs
import com.bali.core.UnlockRequest
import com.bali.core.UnlockResponse
import com.bali.core.stateChangeDisposition
import com.bali.core.tapDisposition
import com.bali.core.unlockDisposition
import java.time.Instant

// The outbox's records, BaliOutbox's OutboxRecord.swift: what the phone did, the request each one
// sends on every attempt, one send of it answered (`Sent`), read by its own kind's table in `core`,
// and each read from its row. The store keeps them (Outbox.kt) and settles each answer (AN4d); the
// sync engine sends them (AN5). Neither decides here what an answer means: `core`'s tables do.

/** What the phone did: acted on at once, and queued to send. */
sealed interface Change {
    /** `POST /v1/taps`: the tag the phone read. */
    data class Tap(val tagId: String) : Change

    /** `POST /v1/sessions/{id}/unlock`, with the student's reason, if any. */
    data class Unlock(val session: String, val reason: UnlockReason?) : Change

    /**
     * `POST /v1/taps/{eventId}/unlock`: an unlock made while the phone's own tap [tap] was
     * unanswered, filed under it (owner decision 11): sent there always, even once the tap's answer
     * names a session, whose lock it then guards (the store's `holdsUnlock`, AN4c).
     */
    data class UnlockUnderTap(val tap: String, val reason: UnlockReason?) : Change

    /**
     * An Emergency Unlock made where the phone stood unread, no tap of its own unanswered (B6b): its
     * session not known, it is kept and never sent until the phone knows where it stands, then filed
     * as one of the two above (the store's `file`, AN4c).
     */
    data class UnlockUnfiled(val reason: UnlockReason?) : Change

    /** `POST /v1/sessions/{id}/refocus`. */
    data class Refocus(val session: String) : Change

    /** `POST /v1/sessions/{id}/protection-off`: Bali's lock was found switched off. */
    data class ProtectionOff(val session: String) : Change

    /**
     * `POST /v1/sessions/{id}/protection-on`: the lock back on in the class the phone was protection
     * off in (#167), the student back where they stood before it, with no re-tap.
     */
    data class ProtectionOn(val session: String) : Change
}

// Each rule below names every change, so one added doesn't compile until it is placed, as Swift's
// `switch` doesn't.

/** Any unlock: a session's, one filed under a tap, or one not filed yet. */
internal val Change.isUnlock: Boolean
    get() =
        when (this) {
            is Change.Unlock, is Change.UnlockUnderTap, is Change.UnlockUnfiled -> true
            is Change.Tap, is Change.Refocus, is Change.ProtectionOff, is Change.ProtectionOn -> false
        }

internal val Change.isUnfiled: Boolean get() = this is Change.UnlockUnfiled

/** An unlock's reason, as the student gave it; none for none, and for any other change. */
internal val Change.reason: UnlockReason?
    get() =
        when (this) {
            is Change.Unlock -> this.reason
            is Change.UnlockUnderTap -> this.reason
            is Change.UnlockUnfiled -> this.reason
            is Change.Tap, is Change.Refocus, is Change.ProtectionOff, is Change.ProtectionOn -> null
        }

/**
 * The student's own return to focus, a tap or a refocus, whose answer an unlock made before it, by
 * the phone's order, never holds back (A13). The lock back on is none: it returns them where they
 * stood, and an unlock the server has yet to record still guards its session.
 */
internal val Change.isReturn: Boolean
    get() =
        when (this) {
            is Change.Tap, is Change.Refocus -> true
            is Change.Unlock, is Change.UnlockUnderTap, is Change.UnlockUnfiled,
            is Change.ProtectionOff, is Change.ProtectionOn -> false
        }

/**
 * One queued record. Only the store makes one (AN4c), from its row, as GRDB's `init(row:)` does on
 * iOS; a value, as Swift's struct is, so the store's changes come back as a new one.
 */
@ConsistentCopyVisibility
data class OutboxRecord internal constructor(
    /** A UUIDv7 minted when the phone acted, sent with every attempt (rule 4). */
    val eventId: String,
    val change: Change,
    /** The phone's clock when it acted: the request's `deviceTime`, which the server clamps (rule 1). */
    val recordedAt: Instant,
    /** Sends that left it queued; of them, [answers] the server answered: what the bound counts. */
    val attempts: Int,
    val answers: Int,
    val nextAttemptAt: Instant,
    /**
     * Refused (`retry_and_surface`), or unsettled by the store's bound of answers: still kept,
     * retried and shown, but no longer holding the records behind it or the phone's reads.
     */
    val stuck: Boolean,
    /** The last answer, for a screen: its status (none for none), an error's reason and message. */
    val lastStatus: Int?,
    val lastReason: ApiErrorReason?,
    val lastMessage: String?,
    /**
     * The status of the latest answer that refused it, kept whatever answers came after (each
     * overwrites [lastStatus]), so a refused tap stays said as refused (the riders); none: never.
     */
    val refusedStatus: Int?,
    /** A refocus's: the unlock it returns from, while that is unrecorded. */
    internal val follows: String?,
    /**
     * Where it sits in what the phone did (A12): the file's install and the record's `seq`, sent
     * with every attempt. None only for a file with no install, which no migrated file is: the
     * record then goes without one, ordered by its time, rather than not at all.
     */
    internal val order: ActionOrder?,
) {
    /** The request a record sends: its endpoint's path parameter, if it has one, and its body. */
    sealed interface Request {
        data class Tap(val body: TapRequest) : Request

        data class Unlock(val session: String, val body: UnlockRequest) : Request

        data class UnlockUnderTap(val tap: String, val body: UnlockRequest) : Request

        data class Refocus(val session: String, val body: RefocusRequest) : Request

        data class ProtectionOff(val session: String, val body: ProtectionOffRequest) : Request

        data class ProtectionOn(val session: String, val body: ProtectionOnRequest) : Request
    }

    /**
     * The request to send, built from what was stored: every attempt sends the same. None for an
     * unlock not filed yet, which goes nowhere until it is (the store's `nextDue`, AN4c).
     */
    val request: Request?
        get() {
            fun unlock(reason: UnlockReason?) = UnlockRequest(eventId, recordedAt, reason, order)
            return when (change) {
                is Change.Tap -> Request.Tap(TapRequest(change.tagId, eventId, recordedAt, order))
                is Change.Unlock -> Request.Unlock(change.session, unlock(change.reason))
                is Change.UnlockUnderTap -> Request.UnlockUnderTap(change.tap, unlock(change.reason))
                is Change.UnlockUnfiled -> null
                is Change.Refocus -> Request.Refocus(change.session, RefocusRequest(eventId, recordedAt, order))
                is Change.ProtectionOff ->
                    Request.ProtectionOff(change.session, ProtectionOffRequest(eventId, recordedAt, order))
                is Change.ProtectionOn ->
                    Request.ProtectionOn(change.session, ProtectionOnRequest(eventId, recordedAt, order))
            }
        }

    /**
     * Sends the record's request through [client], once, and reads the answer as its own endpoint's
     * type by its own kind's table: the only way to make a [Sent], so the store's `settle` can never
     * read an answer by another kind's table. None, sending nothing, for an unlock not filed.
     */
    suspend fun send(client: ApiClient): Sent? = Sent.of(this, client)
}

/** The record a row holds, GRDB's `init(row:)`: a kind this build doesn't know is refused, never read as another. */
internal fun QueuedRow.record(): OutboxRecord {
    fun session() = row.sessionId ?: error("The outbox's ${row.kind} ${row.eventId} names no session")
    val reason = row.reason?.let(UnlockReason.Wire::of)
    val change =
        when (row.kind) {
            "tap" -> Change.Tap(row.tagId ?: error("The outbox's tap ${row.eventId} names no tag"))
            // Filed under its tap, it stays so once the tap's answer names a session (decision 11);
            // filed under neither, it waits to be (B6b).
            "unlock" ->
                row.tapId?.let { Change.UnlockUnderTap(it, reason) }
                    ?: row.sessionId?.let { Change.Unlock(it, reason) }
                    ?: Change.UnlockUnfiled(reason)
            "refocus" -> Change.Refocus(session())
            "protection_off" -> Change.ProtectionOff(session())
            "protection_on" -> Change.ProtectionOn(session())
            else -> throw UnknownKind(row.kind)
        }
    return OutboxRecord(
        eventId = row.eventId, change = change, recordedAt = row.recordedAt, attempts = row.attempts,
        answers = row.answers, nextAttemptAt = row.nextAttemptAt, stuck = row.stuck,
        lastStatus = row.lastStatus, lastReason = row.lastReason?.let(ApiErrorReason.Wire::of),
        lastMessage = row.lastMessage, refusedStatus = row.refusedStatus, follows = row.follows,
        // A follow-up's order is its press's (B6d): the same act, filed a second time.
        order = install?.let { ActionOrder(it, row.orderSeq ?: row.seq) },
    )
}

/** A row of a kind this build doesn't know. */
internal class UnknownKind(val kind: String) : Exception("The outbox holds a record of a kind this build doesn't know: $kind")

/** One send of a record, answered, and what its table made of the answer: the store's `settle` takes it. */
class Sent private constructor(
    val eventId: String,
    response: ApiResponse<*>,
    val disposition: Disposition,
    /** A 2xx answer's session: the truth as of this change, to reconcile to, with [state]. */
    val session: SessionView?,
    state: OrUnknown<ParticipationState>?,
    /** An unlock recorded late: a return to focus went ahead of it (A10, A12). */
    val superseded: Boolean = false,
    /** An unlock's reason as the server keeps it: the one recorded first, never a retry's (A1). */
    val reason: UnlockReason? = null,
) {
    /** The status the server answered with, or [SendResult.NetworkError] and [noAnswer], why there was none. */
    val result: SendResult = response.result
    val noAnswer: NoAnswer? = response.noAnswer

    /** Any status but a 2xx: the error body, whose `reason` a screen keys on. */
    val error: ApiErrorBody? = response.error

    /** A 2xx answer's state, if this build knows it. */
    val state: ParticipationState? = state?.known

    internal val status: Int? get() = (result as? SendResult.Status)?.code

    // Swift's `fileprivate init`: the constructor is private, so only `of`, a record's own send, makes one.
    internal companion object {
        /** [OutboxRecord.send]: the record's request through [client], once, read by its own kind's table. */
        suspend fun of(record: OutboxRecord, client: ApiClient): Sent? {
            val id = record.eventId
            return when (val request = record.request) {
                is OutboxRecord.Request.Tap -> {
                    val response = client.tap(request.body)
                    val answer = response.answer
                    val disposition = Disposition.Tap(tapDisposition(response.result, answer))
                    Sent(id, response, disposition, answer?.session, answer?.state)
                }
                is OutboxRecord.Request.Unlock -> unlocked(id, client.unlock(request.session, request.body))
                is OutboxRecord.Request.UnlockUnderTap -> unlocked(id, client.unlockUnderTap(request.tap, request.body))
                is OutboxRecord.Request.Refocus ->
                    client.refocus(request.session, request.body).let { changed(id, it, it.answer?.state) }
                is OutboxRecord.Request.ProtectionOff ->
                    client.protectionOff(request.session, request.body).let { changed(id, it, it.answer?.state) }
                is OutboxRecord.Request.ProtectionOn ->
                    client.protectionOn(request.session, request.body).let { changed(id, it, it.answer?.state) }
                null -> null
            }
        }

        /** Either unlock's answer, by the unlock's table. */
        private fun unlocked(id: String, response: ApiResponse<UnlockResponse>): Sent {
            val answer = response.answer
            val disposition = Disposition.Unlock(unlockDisposition(response.result, answer))
            return Sent(
                id, response, disposition, answer?.session, answer?.state,
                superseded = answer?.recordedAs?.known == UnlockRecordedAs.Superseded,
                reason = answer?.reason?.known,
            )
        }

        /** A refocus's, a protection-off report's or the lock back on's answer, by the state change's table. */
        private fun <A : StateChangeAnswer> changed(
            id: String, response: ApiResponse<A>, state: OrUnknown<ParticipationState>?,
        ): Sent {
            val disposition = Disposition.StateChange(stateChangeDisposition(response.result, response.answer))
            return Sent(id, response, disposition, response.answer?.session, state)
        }
    }
}

/** What one answer means for a record, by its kind's table: `core`'s, never decided here. */
sealed interface Disposition {
    data class Tap(val disposition: TapDisposition) : Disposition

    data class Unlock(val disposition: UnlockDisposition) : Disposition

    data class StateChange(val disposition: StateChangeDisposition) : Disposition
}

/**
 * Whether the record stays queued: each value by name, so one `core` adds must be placed. An unlock
 * leaves only once recorded: no answer drops one the server hasn't recorded.
 */
internal val Disposition.keeps: Boolean
    get() =
        when (this) {
            is Disposition.Tap ->
                when (disposition) {
                    TapDisposition.ApplySession, TapDisposition.WaitForStart, TapDisposition.Reread -> false
                    TapDisposition.Retry, TapDisposition.Reauth, TapDisposition.RetryAndSurface -> true
                }
            is Disposition.Unlock ->
                when (disposition) {
                    UnlockDisposition.Recorded -> false
                    UnlockDisposition.Retry, UnlockDisposition.Reauth, UnlockDisposition.RetryAndSurface -> true
                }
            is Disposition.StateChange ->
                when (disposition) {
                    StateChangeDisposition.ApplySession, StateChangeDisposition.Reread, StateChangeDisposition.Drop -> false
                    StateChangeDisposition.Retry, StateChangeDisposition.Reauth -> true
                }
        }

/** A refusal the record is kept through: stuck at once. */
internal val Disposition.refused: Boolean
    get() =
        this == Disposition.Tap(TapDisposition.RetryAndSurface) ||
            this == Disposition.Unlock(UnlockDisposition.RetryAndSurface)
