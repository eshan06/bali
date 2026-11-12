package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.SessionView
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// What the Focus screen says (C4), BaliOutbox's Focus.swift: `FocusWords`, from the engine's truth and what rule 3's check
// verified, each line a function of their types (WordsTest reads every one), and the session's `heading`, which the other
// screens of a session share (AN10f's, AS8's). iOS's `unscheduled` has no twin: nothing has to
// wake at the bell (the Words board). Emergency Unlock's failures are said beside their type (`UnlockFailure.words`,
// SyncEngine.kt) and the block screen's in ShieldWords.kt; the screen, the hold and the words drawn in it (its chips, Almost
// done, While offline, Open Accessibility settings, the time left as TalkBack says it) are AS5's.

/**
 * What the Focus screen shows at [now] (C4; AS5's Focus boards), from the engine's truth, [sync], and what rule 3's check
 * verified, [protection]. Of the lock it claims [protection] alone, never the standing: the router shows Focus by the lock's
 * own rule ([SyncState.shieldedUntil]), so a tap held with the switch off is Focus over no lock, said so with the way back, and
 * no countdown is worded over nothing locked (rule 3: v2 showed one). Focus always holds Emergency Unlock, its screen's: no
 * line here says it can be missing, used up or refused, and each said of an unlock offers it again. [time] writes a time of day
 * as the phone does, in its locale and with its 24-hour setting (the app's, from the phone's own pattern), in [zone];
 * [signedIn]: whether someone is, as the sign-in says, none while it can't say yet. BaliOutbox's `FocusWords`.
 */
class FocusWords(
    sync: SyncState, protection: Protection?, now: Instant, zone: ZoneId, time: DateTimeFormatter, signedIn: Boolean? = null,
) {
    /** What the check verified ([Protection]), iOS's `Claim`. */
    enum class Claim {
        /** The lock on, and its switch keeping it there ([Protection.locked]). */
        Paused,

        /** The switch judged off: off, or starting past the grace, never a launch's moment ([Protection.switchedOff]). */
        LockOff,

        /** Nothing verified yet. */
        Unverified,
    }

    /**
     * The time left until the lock comes off by the phone's own clock: the bell, or a tap's cap, which is only the latest it can.
     * [secondsLeft] in whole seconds, rounded up, as [digits] say it; how full the ring is ([fraction]), until when ([until]),
     * and whether these are the last two minutes ([final], AS5's final board).
     */
    data class Countdown(val secondsLeft: Long, val digits: String, val fraction: Double, val until: String, val final: Boolean)

    /** The class, and under it its teacher and bell; a tap not answered yet knows neither. */
    val title: String
    val subtitle: String

    val claim: Claim

    /**
     * What the claim says under its chip: while nothing is verified, only that the check runs; the switch off, the way back, and
     * a report of it the check couldn't save (rule 5); over the lock on, nothing (the owner's cut, 2026-11-04).
     */
    val claimWords: String?

    /** The countdown, over the lock verified on alone: none over a lock off or not checked yet, so nothing ticks over no lock (rule 3). */
    val countdown: Countdown?

    /** No answer from the server (AS5's offline board): what its card says; none online. */
    val offline: String?

    /**
     * Why nothing reaches the teacher, the server there or not: signed out, the sign-in not renewed, or the phone's storage
     * refusing, said beside the countdown, which still holds (rule 5); none otherwise.
     */
    val stalled: String?

    /**
     * Why the lock came back after an Emergency Unlock the server recorded late, in this session (C5a): a return to focus the
     * phone's order can't place went ahead of it, or, sent with no order, its clock was behind (A10, A12), with how to set it
     * on Android; none when none did.
     */
    val superseded: String?

    init {
        // The session named is the one whose bell ends the lock, not one a re-tap's cap outlasts, where the tap's answer may name
        // another, and at the bell, still its own.
        val held = sync.shieldedUntil(now)
        val stood = sync.standing as? Standing.InSession
        val session = stood?.session?.takeIf { stood.state == ParticipationState.Focused && it.endsAt >= (held ?: it.endsAt) }
        val ends = held ?: session?.endsAt ?: now
        val at = time.format(ends.atZone(zone))
        val capped = ends != session?.endsAt
        if (session == null) {
            title = "You're in"
            subtitle = "Your class shows here once Bali hears back."
        } else {
            val (named, line) = sync.heading(session, zone, time)
            title = named ?: "In focus"
            subtitle = line
        }
        // Each line one string, as the boards and iOS write it.
        superseded =
            sync.superseded?.takeIf { it.session == session?.id }?.let {
                if (it.ordered) {
                    "Bali recorded your unlock, but Bali on another phone, or from before a reinstall, put you back in focus after it. Hold to unlock again if you need to."
                } else {
                    "Bali recorded your unlock, but this phone's clock was behind, so it counted as before you went back to focus. Turn on automatic time in Settings → System → Date & time, then hold to unlock again."
                }
            }
        claim =
            when {
                protection?.locked == true -> Claim.Paused
                protection?.switchedOff == true -> Claim.LockOff
                else -> Claim.Unverified
            }
        val claimed =
            when (claim) {
                Claim.Paused -> null
                Claim.LockOff -> "Bali's lock is off, so no app is paused. Turn it back on in Settings → Accessibility → Bali."
                Claim.Unverified -> "Checking Bali's lock…"
            }
        // Found and not saved: the check tries again while it is off (rule 5).
        val unsaved = claim == Claim.LockOff && protection?.unreported == true
        claimWords = if (unsaved) claimed?.let { "$it Bali couldn't tell your teacher yet, and keeps trying." } else claimed
        stalled =
            when {
                signedIn == false -> "You're signed out, so Bali can't reach your teacher. Sign in again once class is over."
                sync.link == Link.SignIn -> "Bali can't check your sign-in right now, so it can't reach your teacher. It keeps trying."
                sync.link == Link.StorageFailed -> "Bali can't use this phone's storage right now, so it can't reach your teacher. It tries again within a minute."
                else -> null
            }
        val left = maxOf(Duration.ZERO, Duration.between(now, ends))
        countdown = if (claim == Claim.Paused) countdown(left, if (capped) "at most until $at" else "until $at") else null
        offline =
            when {
                sync.link != Link.Unreachable -> null
                capped -> "Your tap is saved on this phone and reaches your teacher as soon as Bali is back online."
                else -> "Focus still ends at $at. This phone keeps time without Wi-Fi, and Bali catches up when it's back online. Your teacher sees when this phone last checked in."
            }
    }

    companion object {
        /** The ring is full with this long left or more: the phone knows the bell, not the start. */
        val RING_SPAN: Duration = Duration.ofMinutes(50)

        /** The countdown with [left] to go until [until]: whole seconds rounded up, hours once over one, never a second early. */
        private fun countdown(left: Duration, until: String): Countdown {
            val seconds = left.seconds + if (left.nano > 0) 1 else 0
            val (hours, minutes) = seconds / 3600 to seconds / 60 % 60
            val digits = if (hours > 0) "%d:%02d:%02d".format(Locale.ROOT, hours, minutes, seconds % 60) else "%d:%02d".format(Locale.ROOT, minutes, seconds % 60)
            val fraction = minOf(1.0, left.toMillis() / RING_SPAN.toMillis().toDouble())
            return Countdown(seconds, digits, fraction, until, final = left <= Duration.ofMinutes(2))
        }
    }
}

/**
 * A session's class, where `GET /v1/me` names it (none where it doesn't), and under it its teacher and bell (C4, C5a), the bell
 * in [time] at [zone]: BaliOutbox's `SyncState.heading`, which Focus says, and Unlocked's, Protection off's and the lesson's
 * headings with it, so the headings can't drift apart.
 */
internal fun SyncState.heading(session: SessionView, zone: ZoneId, time: DateTimeFormatter): Pair<String?, String> {
    val named = me?.classes?.firstOrNull { it.id == session.classId }
    val bell = "ends ${time.format(session.endsAt.atZone(zone))}"
    return named?.name to (named?.teacher?.displayName?.let { "with $it · $bell" } ?: bell)
}
