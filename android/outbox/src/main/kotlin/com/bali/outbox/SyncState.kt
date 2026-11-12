package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.MeResponse
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.UnlockReason
import com.bali.core.UserRole
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

// What the sync engine knows, SyncEngine.swift's `SyncState`: its core, AN5a's, the read loop's, AN5c's,
// the wait's, AN5d's, Emergency Unlock's, AN5e's, the sign-ins that forgot `me`, AN9d's, and whether `me`
// names a teacher's account, AN10a's (`teacher`, which iOS reads where it's used), with
// Enforcement.swift's rules of when the lock is on (`shieldedUntil`) and when the student's unlock takes the
// last run's off (`unlockedLast`, AN7a's), which the enforcer follows (Enforcer.kt).

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
     * The student's unlock the server recorded late, a return to focus having gone ahead of it (A10,
     * A12), which put the lock back on with no return of this phone's since: said on Focus (C5a) until
     * the phone's next change.
     */
    val superseded: Superseded? = null,
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
     * This phone's latest Emergency Unlock the server has recorded in a session, and its reason on
     * record, the answer's, then each change's (A20): the Unlocked card's check, and what a pick changes
     * once the record has left the phone (C5c), until the student's next turn: the lock going off or
     * coming back is none (#167).
     */
    val recordedUnlock: RecordedUnlock? = null,
    /**
     * The records on their way, sent and not settled, or answered in a write the file refused, which
     * the file still counts as never sent: a reason given now wouldn't go with them (santa's review),
     * so the card offers none (C5c).
     */
    val sending: Set<String> = emptySet(),
    /** How long a tap not yet answered is locked for: decision 7's [TAP_CAP], or a Debug build's shorter one ([SyncEngine.setTapCap]). */
    val cap: Duration = TAP_CAP,
    /**
     * Who the student is and their classes, as `GET /v1/me` last answered, with a class the phone joined
     * since at once ([SyncEngine.join]), for Home and the router (C3); none until a read answers.
     */
    val me: MeResponse? = null,
    /**
     * Why the last read of `GET /v1/me` gave no answer (none came, or a status with no body this build
     * reads) until one does: said where its classes would be (rule 5), never read as none.
     */
    val meFailed: SendResult? = null,
    /**
     * How many times [me] has been forgotten for another student's sign-in ([SyncEngine.forgetMe]): a
     * state counting fewer forgets than the app asked for was sent before the last one, so its [me] is
     * the last student's (#160's review).
     */
    val forgets: Int = 0,
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

    /**
     * Whether the last read of `GET /v1/me` named the account a teacher's (`MeResponse.user.role`): the app is the students' (the
     * owner, 2026-11-07), so the router shows the teacher's screen alone, and the engine registers no device token for it (AN12).
     * False until a read names one.
     */
    val teacher: Boolean get() = me?.user?.role?.known == UserRole.Teacher

    /** A tap the server hasn't answered yet: the lock covers apps for it at once, to decision 7's cap (B5). */
    val pendingTap: OutboxRecord? get() = queued.lastOrNull { it.change is Change.Tap && !it.stuck }

    /** Whether an unlock made where the phone stood unread waits to be filed (B6b). */
    internal val holdsUnfiled: Boolean get() = queued.any { it.change.isUnfiled }

    /**
     * The Emergency Unlock to record now (decision 11): under a tap not yet answered, filed where that
     * tap lands, else of the session the phone is in; where it stood unread, not filed until the phone
     * knows where it stands (B6b); none: out or waiting, nothing the phone knows locks.
     */
    fun emergencyUnlock(reason: UnlockReason?): Change? {
        pendingTap?.let { return Change.UnlockUnderTap(it.eventId, reason) }
        return when (val stood = standing) {
            is Standing.InSession -> Change.Unlock(stood.session.id, reason)
            Standing.Unread -> Change.UnlockUnfiled(reason)
            Standing.Out, Standing.Waiting -> null
        }
    }

    /**
     * When the lock comes off, while the phone's truth keeps it on at [now]; none: off. On while focused
     * in a session, until its end, and for a tap not yet answered, until its cap ([tapHeldUntil]).
     * Unlocked, protection off, a state this build doesn't know, waiting or out: off.
     */
    fun shieldedUntil(now: Instant): Instant? {
        val focused = (standing as? Standing.InSession)?.takeIf { it.state == ParticipationState.Focused }
        return listOfNotNull(focused?.session?.endsAt, tapHeldUntil).filter { it > now }.maxOrNull()
    }

    /**
     * Until when a tap not yet answered keeps the lock on: decision 7's cap after it ([cap]), unless the
     * student unlocked since, which is acted on at once (decision 11). None: none does.
     */
    val tapHeldUntil: Instant?
        get() {
            val tap = pendingTap ?: return null
            if (queued.dropWhile { it.eventId != tap.eventId }.any { it.change.isUnlock }) return null
            return tap.recordedAt + cap
        }

    /**
     * Whether the student's Emergency Unlock has the last word on the lock: one after the tap not yet
     * answered, this run's or the last's (that tap holds the queue, so nothing since can have put the lock
     * back on), or, with none, one made where the phone stood unread. Over a standing not read, it takes the
     * last run's lock off too: the way out of a lock the phone can no longer justify (B6b). A session's
     * unlock the last run left queued alone doesn't: a tap answered since may have put the lock back on.
     */
    val unlockedLast: Boolean get() = if (pendingTap == null) holdsUnfiled else tapHeldUntil == null

    /**
     * The latest Emergency Unlock queued for [session]: that session's own, or one filed under a tap or
     * not filed yet, which may be any session's (C5b's review). Unlocked.swift's `unlock(in:)`.
     */
    internal fun unlockIn(session: String): OutboxRecord? =
        queued.lastOrNull {
            when (val change = it.change) {
                is Change.Unlock -> change.session == session
                is Change.UnlockUnderTap, is Change.UnlockUnfiled -> true
                is Change.Tap, is Change.Refocus, is Change.ProtectionOff, is Change.ProtectionOn -> false
            }
        }

    companion object {
        /** Decision 7: a tap the server hasn't answered locks at once, and for at most this long. */
        val TAP_CAP: Duration = Duration.ofMinutes(50)

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

/** An unlock the server recorded in [session]: its event id, [unlock], and its reason on record. */
data class RecordedUnlock(val session: String, val unlock: String, val reason: UnlockReason?)

/**
 * A late unlock's session, and whether it went with the phone's order (A12): with one, the return that
 * went ahead is one the order can't place, another install's or one sent with none; without, the
 * phone's clock was behind (A10).
 */
data class Superseded(val session: String, val ordered: Boolean)
