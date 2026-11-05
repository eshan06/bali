package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.MeResponse
import com.bali.core.SendResult
import java.time.Instant
import java.time.ZoneId

// What the sync engine knows, SyncEngine.swift's `SyncState`: its core, AN5a's, the read loop's, AN5c's,
// and the wait's, AN5d's. Each later AN5 step adds the fields its own rules keep (docs/PLAN-ANDROID.md).

/**
 * What the engine knows, for the screens and the lock ([SyncEngine.updates]). A value, as Swift's
 * struct is: each change is a copy, so a state a screen holds never moves under it.
 */
data class SyncState(
    /**
     * The server's truth as last reconciled, with the phone's own changes over it; [Standing.Unread]
     * while the file hasn't given back where the phone stood.
     */
    val standing: Standing = Standing.Out,
    /** Every record queued, in the order the phone acted: a stuck one is shown with its last answer (rule 5). */
    val queued: List<OutboxRecord> = emptyList(),
    /**
     * How the last exchange went, none before the first, and when the server last answered, so a
     * screen says how old its truth is instead of pretending.
     */
    val link: Link? = null,
    val heardAt: Instant? = null,
    /** When the outbox sends next; none when nothing is queued or it waits on a ring. */
    val retryAt: Instant? = null,
    /**
     * The last state change the server refused, dropped and never sent again: shown (rule 5) until the
     * phone's next change.
     */
    val refused: Refusal? = null,
    /**
     * The session protection off was last reported in, since the phone's last tap or the lock back on
     * (`Outbox.reportedOff`): only those leave it there (A2; #167).
     */
    val reportedOff: String? = null,
    /**
     * The phone's newest tap, as the outbox's file keeps it: a refused tap is said only while it is
     * this one (#146). None: the file names none.
     */
    val lastTap: String? = null,
    /**
     * The records on their way, sent and not settled, or answered in a write the file refused, which
     * the file still counts as never sent: a reason given now wouldn't go with them (santa's review),
     * so the card offers none (C5c).
     */
    val sending: Set<String> = emptySet(),
    /**
     * Who the student is and their classes, as `GET /v1/me` last answered, for Home and the router
     * (C3); none until a read answers.
     */
    val me: MeResponse? = null,
    /**
     * Why the last read of `GET /v1/me` gave no answer (none came, or a status with no body this build
     * reads) until one does: said where its classes would be (rule 5), never read as none.
     */
    val meFailed: SendResult? = null,
    /**
     * How many reads of `GET /v1/me` have given [me]: a later count is a read the server answered since
     * (L8c: a lesson refused is followed again once a later read lists its session).
     */
    val meReads: Int = 0,
    /**
     * When the wait for the teacher's Start ends by the phone's own clock, offline too (#166): the end of
     * the day its tap was last answered armed ([waitEnds]'s), kept in the outbox's file for a relaunch;
     * none when not known (the file keeps none it can read), a wait only a read ends.
     */
    val waitEnds: Instant? = null,
) {
    /** Whether the student is in any class, as [me] says: none until a read answers (C3). */
    val hasClasses: Boolean? get() = me?.let { it.classes.isNotEmpty() }

    /** A tap the server hasn't answered yet: the lock covers apps for it at once, to decision 7's cap (B5). */
    val pendingTap: OutboxRecord? get() = queued.lastOrNull { it.change is Change.Tap && !it.stuck }

    /** Whether an unlock made where the phone stood unread waits to be filed (B6b). */
    internal val holdsUnfiled: Boolean get() = queued.any { it.change.isUnfiled }

    companion object {
        /**
         * Where a wait armed at [armedAt] ends: the midnight after it in [zone], the phone's, the school's
         * in class, as the server drops an armed tap at the end of its school day, in the school's zone
         * (decision 5; Hosting, decision 5). By the zone's own calendar, so a day the clocks change is 23
         * hours or 25, never 24.
         */
        fun waitEnds(armedAt: Instant, zone: ZoneId): Instant =
            armedAt.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant()
    }
}

/** How the last exchange went. */
enum class Link {
    /** The server answered. */
    Reached,

    /** No answer came: "can't reach the server", with a retry. */
    Unreachable,

    /**
     * No token to send, or the server refused the one sent: waiting on sign-in (B4). Never a sign-out,
     * and nothing is dropped for it.
     */
    SignIn,

    /** The outbox couldn't be read or written; tried again within a minute. */
    StorageFailed,
}

/** A state change the server refused: the change, and its answer's status, reason and message. */
data class Refusal(val change: Change, val status: Int?, val reason: ApiErrorReason?, val message: String?)
