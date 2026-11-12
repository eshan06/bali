package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.UnlockReason
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// What the Unlocked screen says (C5a), BaliOutbox's Unlocked.swift: `UnlockedWords`, from the engine's truth, each line a function
// of its types (WordsTest reads every one), the re-tap's line the Words board's. A reason that didn't take and a Back to focus that
// didn't go are said beside their types (`ReasonFailure.words`, `RefocusFailure.words`, SyncEngine.kt), Home's card for the class
// and a refused Back to focus in Screen.kt; the screen and the words drawn in it (its chip, You're unlocked, the reason card's
// title and its three, Go to Home, Lock my apps again, Tap in) are AS6's.

/**
 * What the Unlocked screen shows (C5a; AS6's Unlocked boards) for the session the phone stands unlocked in: the class and its bell,
 * what is open until when and whether the teacher sees it yet, the reason the student may give and change, optional, never what
 * the unlock waits on (A1, A20), and the way back. No line says the unlock, its reason or its retry was dropped or can be taken
 * back: an Emergency Unlock is never discarded (`packages/shared`'s unlock contract), and one not sent yet is said so, kept and
 * retried. The bell in [time] at [zone], as the phone writes it ([FocusWords]). BaliOutbox's `UnlockedWords`, made by [of].
 */
class UnlockedWords private constructor(sync: SyncState, session: SessionView, zone: ZoneId, time: DateTimeFormatter) {
    /**
     * The reason card (C5c): the check on the reason on record ([chosen]). [Open]: a pick goes with the unlock while it has never
     * been sent (`Outbox.explain`), else as a change of it (A20). [Waiting]: the unlock is on its way or stuck, and no pick can
     * reach it until the server has it.
     */
    sealed interface Picker {
        val chosen: UnlockReason?

        /**
         * What the card says under the three, nothing having gone wrong: while a pick can go, nothing (the owner's cut,
         * 2026-11-04); while the unlock is on its way, what a pick waits for.
         */
        val caption: String?
            get() =
                when (this) {
                    is Open -> null
                    is Waiting -> if (chosen == null) ReasonFailure.OnItsWay.words else "Your reason goes with your unlock. You can change it once it arrives."
                }

        data class Open(override val chosen: UnlockReason?) : Picker

        data class Waiting(override val chosen: UnlockReason?) : Picker
    }

    /** The class, and under it its teacher and bell ([SyncState.heading]). */
    val title: String
    val subtitle: String

    /** What is open until when, and whether the teacher sees it yet: once the unlock has left the phone, and not before. */
    val body: String

    /** None: no unlock of this phone's to give a reason for, one before a relaunch, say. */
    val picker: Picker?

    /** The unlock the card is about, by its event id: a pick is for it alone (#140). None with no card. */
    val unlock: String?

    /**
     * Why the way back is a re-tap, not Lock my apps again: protection off was reported in this session since the phone's last
     * tap, and a refocus out of it is refused (A2; #96's review), or the server refused this session's refocus (C5b).
     */
    val retap: String?

    /** The unlock stuck, refused or unsettled to the bound, still kept and retried (rule 5): not sent yet, never dropped. */
    val stuck: String?

    init {
        val (named, line) = sync.heading(session, zone, time)
        title = named ?: "Your class"
        subtitle = line
        // This class's: another class's unlock, stuck, isn't the one the screen shows (#119's review); one under a tap or not
        // filed yet may be any's.
        val queued = sync.unlockIn(session.id)
        val bell = time.format(session.endsAt.atZone(zone))
        body =
            if (queued == null) {
                "Everything's open until you lock your apps again or the bell at $bell. Your teacher can see you unlocked."
            } else {
                "Everything's open until you lock your apps again or the bell at $bell. Your teacher will see you unlocked."
            }
        // This class's unlock still on the phone first, a newer one than any recorded; then the one the server recorded, at the
        // reason on record.
        val recorded = sync.recordedUnlock?.takeIf { it.session == session.id }
        picker =
            when {
                queued != null ->
                    if (queued.attempts == 0 && !queued.stuck && queued.eventId !in sync.sending) {
                        Picker.Open(queued.change.reason)
                    } else {
                        Picker.Waiting(queued.change.reason)
                    }
                recorded != null -> Picker.Open(recorded.reason)
                else -> null
            }
        unlock = if (picker == null) null else queued?.eventId ?: recorded?.unlock
        retap = sync.retapIn(session.id)
        stuck = if (queued?.stuck == true) UNSENT else null
    }

    companion object {
        /** What a screen says of an Emergency Unlock stuck on the phone, kept and retried (rule 5): BaliOutbox's `UnlockedWords.unsent`. */
        internal const val UNSENT = "Bali couldn't send your unlock to your teacher yet. It keeps trying."

        /** The Unlocked screen's words, the bell in [time] at [zone]; none unless the phone stands unlocked in a session. */
        fun of(sync: SyncState, zone: ZoneId, time: DateTimeFormatter): UnlockedWords? {
            val stood = sync.standing as? Standing.InSession ?: return null
            return if (stood.state == ParticipationState.Unlocked) UnlockedWords(sync, stood.session, zone, time) else null
        }
    }
}

/**
 * Why the way back from an unlock in [session] is a re-tap, Unlocked's own rule, which Home's card shares ([inSessionCard]):
 * protection off was reported there since the phone's last tap, and a refocus out of it is refused (A2), said in the Words board's
 * line; or the server refused the refocus ([refusedRefocus]). None: Lock my apps again is the way back.
 */
internal fun SyncState.retapIn(session: String): String? =
    if (reportedOff == session) "Bali's lock was off during this class, so tap your teacher's block to lock your apps again." else refusedRefocus(session)
