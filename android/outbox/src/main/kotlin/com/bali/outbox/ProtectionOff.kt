package com.bali.outbox

import com.bali.core.ParticipationState
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// What the Protection off screen says (C5b), BaliOutbox's ProtectionOff.swift: `ProtectionOffWords`, from the engine's truth and
// what rule 3's check verified, each line a function of their types (WordsTest reads every one), Screen Time's lines Bali's lock's
// as the Words board writes them. iOS's `.ask` way, Screen Time's own prompt, has no Android twin: Android's Accessibility settings
// are the one place to switch the lock back on. Session over's words are in Screen.kt (`sessionOverWords`); the screen and the
// words drawn in it (its chip, To rejoin class, Open Accessibility settings, Tap in) are AS6's.

/**
 * What the Protection off screen shows (C5b; AS6's lock-off boards) in a running session where Bali's lock is off, or was: the
 * class, what happened and that the teacher sees it, and the way back, the lock switched on again, which puts the phone back where
 * it stood by itself (#167), or a re-tap where that couldn't be done. A refocus out of protection off is refused (A2), so the screen
 * never offers Lock my apps again. What the teacher sees is said, never quoted: the grid's label is "Protection off", the phone's
 * chip "Lock off" (D2j; the Words board). The bell in [time] at [zone], as the phone writes it ([FocusWords]). BaliOutbox's
 * `ProtectionOffWords`, made by [of].
 */
class ProtectionOffWords private constructor(
    sync: SyncState, stood: Standing.InSession, protection: Protection?, zone: ZoneId, time: DateTimeFormatter,
) {
    /**
     * The way on, from what rule 3's check verified of the switch: Settings once the check judges it off, off or starting past the
     * grace; the re-tap once it reads on and bound again here, which the lock back on leaves at once wherever it can (#167); none
     * yet while nothing has judged it off, starting within the grace or not checked ("Checking Bali's lock…"), never "off" over a
     * switch a relaunch hasn't read back yet.
     */
    enum class Way { Settings, Retap, Checking }

    /** The class, and under it its teacher and bell ([SyncState.heading]). */
    val title: String
    val subtitle: String
    val headline: String
    val body: String
    val way: Way

    /** The steps back to class (AS6's card): the lock switched on again, then Bali putting the student back by itself (#167), or, on the re-tap's way, the tap. */
    val steps: List<String>

    /** A Back to focus the server refused (rule 5). */
    val refused: String?

    /**
     * What the screens it takes over from would say, which it must not drop (rule 5; C5b's review): an Emergency Unlock of this
     * class stuck on the phone (Unlocked's), a tap the server refused and the classes not read (Home's), said with Try again.
     */
    val problems: List<String>

    init {
        val session = stood.session
        val (named, line) = sync.heading(session, zone, time)
        title = named ?: "Your class"
        subtitle = line
        way =
            when {
                protection?.switch == LockSwitch.On -> Way.Retap
                protection?.switchedOff == true -> Way.Settings
                else -> Way.Checking
            }
        // Recorded and gone, the teacher sees it; on the phone, or not reported yet, will (C5a's).
        val queued = sync.queued.any { it.change == Change.ProtectionOff(session.id) }
        val sent = stood.state == ParticipationState.ProtectionOff && !queued
        val sees = if (sent) "sees" else "will see"
        // Found and never saved, nothing yet makes it true that the teacher sees it, or will (rule 5), whichever the way (C5b's
        // review). Switched on again, the check reports nothing more: no "keeps trying" there.
        val untold = protection?.unreported == true && !sent && !queued
        when (way) {
            Way.Settings -> {
                headline = "Bali's lock is off"
                body =
                    if (untold) {
                        "Bali can't keep you focused without it. It couldn't tell your teacher yet, and keeps trying."
                    } else {
                        "Bali can't keep you focused without it, so your teacher $sees that the lock is off."
                    }
            }
            Way.Retap -> {
                headline = "Bali's lock is back on"
                body =
                    if (untold) {
                        "Tap your teacher's block again to rejoin class. Bali couldn't tell your teacher that the lock was off."
                    } else {
                        "Tap your teacher's block again to rejoin class. Until then, your teacher $sees the lock as off."
                    }
            }
            Way.Checking -> {
                headline = "Checking Bali's lock…"
                body = if (untold) "Bali couldn't tell your teacher that the lock was off. It keeps trying." else "Until the lock is back on, your teacher $sees that it's off."
            }
        }
        steps =
            listOf(
                "Turn Bali back on in Accessibility settings",
                if (way == Way.Retap) "Tap your teacher's block again" else "Bali puts you back in class by itself",
            )
        refused = sync.refusedRefocus(session.id)
        problems = listOfNotNull(UnlockedWords.UNSENT.takeIf { sync.unlockIn(session.id)?.stuck == true }, sync.refusedTapWords, sync.meWords)
    }

    companion object {
        /** The Protection off screen's words, the bell in [time] at [zone]; none unless the phone stands in a session. */
        fun of(sync: SyncState, protection: Protection?, zone: ZoneId, time: DateTimeFormatter): ProtectionOffWords? =
            (sync.standing as? Standing.InSession)?.let { ProtectionOffWords(sync, it, protection, zone, time) }
    }
}
