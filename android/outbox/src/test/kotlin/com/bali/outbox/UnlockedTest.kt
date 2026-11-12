package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.MeResponse
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.UnlockReason
import com.bali.core.UnlockReasonRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

// What the Unlocked, Protection off and Session over screens say (C5a, C5b), AN10f: BaliOutbox's UnlockedTests and
// ProtectionOffScreenTests, iOS's word for word but where the Android canvas's Words board changes a line: Screen Time's become
// Bali's lock's (the lock off, back on, being checked, the re-tap's and a refused Back to focus's lines), the step back names
// Accessibility settings, and iOS's way to Screen Time's own prompt has no twin, Settings being Android's one way. On a US phone in
// New York, never the PC's zone or locale. protectionOffWords' read of iOS's view, which never offers Back to focus, is AS6's.

/** Class c's name, as its teacher wrote it. */
private val period3 = "Period 3 ${Char(0x2014)} Algebra II"

/** A session whose bell is at 10:42 AM in New York. */
private val bell1042 = session(endsAt = 1720)

/** In [bell1042], the phone [state] there (none: a state this build doesn't know). */
private fun inBell1042(state: ParticipationState?) = Standing.InSession(bell1042, state)

/**
 * The engine standing [standing] with [queued], and `GET /v1/me` naming class c, with Ms. Rivera, or, [me] false, not read:
 * BaliOutbox's tests' `synced`.
 */
private fun synced(standing: Standing, queued: List<OutboxRecord> = emptyList(), me: Boolean = true): SyncState {
    val read = """{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"c","name":"$period3","teacher":{"displayName":"Ms. Rivera"}}],"session":null}"""
    return SyncState(standing = standing, queued = queued, link = Link.Reached, me = if (me) BaliJson.decodeFromString(MeResponse.serializer(), read) else null)
}

/** The Unlocked screen's words for [state], on a US phone in New York. */
private fun words(state: SyncState): UnlockedWords? = UnlockedWords.of(state, newYorkZone, usShortTime)

/** [state] with an unlock the server recorded in session [session], at [reason]. */
private fun recorded(state: SyncState, reason: UnlockReason?, session: String = "s") = state.copy(recordedUnlock = RecordedUnlock(session, "u", reason))

/** Unlocked in Period 3, whose bell is at 10:42 AM, with [queued]. */
private fun unlocked(queued: List<OutboxRecord> = emptyList()) = synced(inBell1042(ParticipationState.Unlocked), queued)

/**
 * What rule 3's check found: the switch [switch], judged off where it reads off, or where it reads starting [lasting] past the
 * grace, the lock verified on ([locked]) or not, and a protection off it found but couldn't queue ([unreported]). BaliOutbox's
 * ProtectionOffScreenTests' `checked`, iOS's denied the switch off here, not determined starting, approved on (Q3).
 */
private fun checked(switch: LockSwitch, lasting: Boolean = false, locked: Boolean = false, unreported: Boolean = false) =
    Protection(checked = true, switch = switch, switchedOff = switch == LockSwitch.Off || lasting, locked = locked, unreported = unreported)

/** The Protection off screen's words for [state] under [protection], on a US phone in New York. */
private fun offWords(state: SyncState, protection: Protection? = checked(LockSwitch.Off)) = ProtectionOffWords.of(state, protection, newYorkZone, usShortTime)

/** A Back to focus the server refused in session [session], for [reason]. */
private fun refusedBack(reason: ApiErrorReason?, session: String = "s") = Refusal(Change.Refocus(session), 409, reason, null)

/** What a refused Back to focus says after protection off there: the Words board's line, Bali's lock where the iPhone's says Screen Time. */
const val REFOCUS_REFUSED_OFF = "Bali couldn't lock your apps again, because Bali's lock was off during this class. Tap your teacher's block to lock them again."

/** What a Back to focus refused for anything else says, iOS's line. */
const val REFOCUS_REFUSED = "Bali couldn't lock your apps again. Tap your teacher's block to lock them again, or ask your teacher."

/** What the Unlocked screen says (C5a): BaliOutbox's UnlockedTests, and the rule that no line says an unlock or its reason went. */
class UnlockedTest : OutboxFiles() {
    /** An Emergency Unlock pressed at [t0] in session s, with [reason], if any, waiting for one: its outbox, and its queue. */
    private suspend fun pressed(reason: UnlockReason? = null): Pair<Outbox, List<OutboxRecord>> {
        val (outbox, _) = makeOutbox()
        record(outbox, Change.Unlock("s", reason), hold = SyncEngine.REASON_HOLD)
        return outbox to outbox.records()
    }

    @Test
    fun theClassItsTeacherEverythingOpenUntilTheBellTheTeacherSeeingItOnceTheUnlockHasGoneAndNotBeforeAndTheThreeReasonsWhileOneCanStillGoWithIt(): Unit =
        runBlocking {
            // AS6-Unlocked, AS6-Unlocked-reason.
            val held = assertNotNull(words(unlocked(pressed().second)))
            assertEquals(period3, held.title)
            assertEquals("with Ms. Rivera · ends 10:42 AM", plain(held.subtitle))
            assertEquals(
                "Everything's open until you lock your apps again or the bell at 10:42 AM. Your teacher will see you unlocked.",
                plain(held.body),
            )
            assertEquals(listOf(UnlockedWords.Picker.Open(null), null, null), listOf(held.picker, held.retap, held.stuck))
            val gone = assertNotNull(words(unlocked()))
            assertEquals(
                "Everything's open until you lock your apps again or the bell at 10:42 AM. Your teacher can see you unlocked.",
                plain(gone.body),
            )
            assertNull(gone.picker)
            assertEquals("Your class", words(synced(inBell1042(ParticipationState.Unlocked), me = false))?.title)
            val others =
                listOf(
                    inBell1042(ParticipationState.Focused), inBell1042(ParticipationState.ProtectionOff), inBell1042(null), Standing.Out,
                    Standing.Waiting, Standing.Unread,
                )
            for (standing in others) assertNull(words(synced(standing)), "$standing")
        }

    @Test
    fun theReasonCardsCheckOnTheReasonTheUnlockCarriesOpenWhileItHasNeverBeenSentWaitingOnceItsOnItsWayOrStuckOnceTheServerHasItOpenAtTheReasonOnRecord(): Unit =
        runBlocking {
            // C5c; A20. An unlock this run didn't make, no card. Open, nothing under the three (the owner's cut, 2026-11-04); waiting,
            // why a pick can't go yet (the Reasons board's two captions).
            val (held, queued) = pressed(UnlockReason.Nurse)
            val first = queued.first()
            assertEquals(UnlockedWords.Picker.Open(UnlockReason.Nurse), words(unlocked(queued))?.picker)
            assertEquals(UnlockedWords.Picker.Waiting(UnlockReason.Nurse), words(unlocked(queued).copy(sending = setOf(first.eventId)))?.picker)
            send(held, first, null)
            assertEquals(1, held.records().first().attempts)
            assertEquals(UnlockedWords.Picker.Waiting(UnlockReason.Nurse), words(unlocked(held.records()))?.picker)
            assertEquals(UnlockedWords.Picker.Open(UnlockReason.Bathroom), words(recorded(unlocked(), UnlockReason.Bathroom))?.picker)
            assertEquals(UnlockedWords.Picker.Open(null), words(recorded(unlocked(), null))?.picker)
            // A newer unlock of the class on the phone is the card's; another class's recorded isn't.
            assertEquals(UnlockedWords.Picker.Open(UnlockReason.Nurse), words(recorded(unlocked(queued), UnlockReason.Bathroom))?.picker)
            assertNull(words(recorded(unlocked(), UnlockReason.Bathroom, session = "a"))?.picker)
            assertNull(words(unlocked())?.picker)
            // The unlock the card is about, which a pick is for alone (#140): the same one, by its id.
            assertEquals(first.eventId, words(unlocked(queued))?.unlock)
            assertEquals(first.eventId, words(recorded(unlocked(queued), UnlockReason.Bathroom))?.unlock)
            assertEquals("u", words(recorded(unlocked(), UnlockReason.Bathroom))?.unlock)
            assertNull(words(recorded(unlocked(), UnlockReason.Bathroom, session = "a"))?.unlock)
            assertNull(words(unlocked())?.unlock)
            assertNull(UnlockedWords.Picker.Open(null).caption)
            assertNull(UnlockedWords.Picker.Open(UnlockReason.Nurse).caption)
            assertEquals("You can pick a reason once your unlock reaches your teacher.", UnlockedWords.Picker.Waiting(null).caption)
            assertEquals(
                "Your reason goes with your unlock. You can change it once it arrives.",
                UnlockedWords.Picker.Waiting(UnlockReason.Nurse).caption,
            )
        }

    @Test
    fun protectionOffReportedInThisSessionSinceThePhonesLastTapMakesTheWayBackAReTapInTheWordsBoardsLineNeverBackToFocusReportedInAnotherBackToFocus() {
        // A2; #96's review. AS6-Unlocked-retap: Bali's lock, where the iPhone's line says Screen Time.
        assertEquals(
            "Bali's lock was off during this class, so tap your teacher's block to lock your apps again.",
            words(unlocked().copy(reportedOff = bell1042.id))?.retap,
        )
        assertNull(words(unlocked().copy(reportedOff = "another"))?.retap)
    }

    @Test
    fun theUnlockTheScreenReadsIsThisClassesAnotherClassesStuckOnThePhoneIsntSaidHereNorItsReasonWhileOneUnderATapOrNotFiledYetMayBeAnyClasses(): Unit =
        runBlocking {
            // #119's review: the teacher can see this one.
            val (outbox, _) = makeOutbox()
            val other = record(outbox, Change.Unlock("a", UnlockReason.Nurse))
            send(outbox, other, 400, Answer.refused("invalid_request"))
            val said = assertNotNull(words(unlocked(outbox.records())))
            assertNull(said.stuck)
            assertNull(said.picker)
            assertTrue(said.body.endsWith("Your teacher can see you unlocked."), said.body)
            val (tapped, _) = makeOutbox()
            record(tapped, Change.UnlockUnderTap("t", UnlockReason.Other))
            assertEquals(UnlockedWords.Picker.Open(UnlockReason.Other), words(unlocked(tapped.records()))?.picker)
        }

    @Test
    fun anUnlockTheServerRefusedOrLeftUnsettledToTheBoundIsSaidNotSentYetStillKeptAndRetriedAndNoPickCanReachItUntilItLands(): Unit =
        runBlocking {
            // Rule 5; AS6-Unlocked-stuck. Kept: the record is still the outbox's after its refusal.
            val (outbox, queued) = pressed()
            send(outbox, queued.first(), 400, Answer.refused("invalid_request"))
            val said = assertNotNull(words(unlocked(outbox.records())))
            assertEquals("Bali couldn't send your unlock to your teacher yet. It keeps trying.", said.stuck)
            assertEquals(UnlockedWords.Picker.Waiting(null), said.picker)
            assertEquals(listOf(queued.first().eventId to true), outbox.records().map { it.eventId to it.stuck })
        }

    @Test
    fun aChangeTheServerDidntTakeIsSaidByItsRefusalTheUnlockOverTheClassOverNotFoundEachSayingTheReasonCantChangeNoAnswerOrAnyOtherAnotherTry(): Unit =
        runBlocking {
            // Rule 5; AS6-Unlocked-notchanged (no answer). Read through the real client, as the engine reads a change's answer.
            suspend fun said(status: Int?, reason: String? = null): String {
                val answer = client(Canned(status, reason?.let(Answer::refused).orEmpty())).changeReason("u", UnlockReasonRequest(UnlockReason.Nurse, "e"))
                return ReasonFailure.NotChanged(answer.result, answer.error?.error?.reason).words
            }
            assertEquals("This unlock is over, so its reason can't change.", said(409, "unlock_superseded"))
            assertEquals("Class is over, so the reason can't change.", said(409, "session_not_running"))
            assertEquals("Bali couldn't find this unlock, so its reason can't change.", said(404, "unlock_not_found"))
            assertEquals("Bali couldn't change your reason. Check your connection and try again.", said(null))
            assertEquals("Bali couldn't change your reason. Try again in a moment.", said(500))
        }

    @Test
    fun aReasonOrBackToFocusTheAppGivesWithNoEngineYetIsSaidBaliStillStartingWithAnotherTryNeverSilence() {
        // AN10d's call (iOS's `Joining.notStarted`): BaliApp.swift's `pick` and `backToFocus` with no engine.
        assertEquals("Bali is still starting. Try again in a moment.", ReasonFailure.NotStarted.words)
        assertEquals(Joining.Failure.NotStarted.words, RefocusFailure.NotStarted.words)
        assertEquals("Bali couldn't lock your apps. Try again.", RefocusFailure.NotSaved.words)
    }

    @Test
    fun noLineOfUnlockedSaysAnUnlockItsReasonOrItsRetryWasDroppedOrCanBeTakenBackAndEveryOneThatDidntGoSaysHowItGoesOn() {
        // The unlock contract (packages/shared/src/unlock-contract.ts): an Emergency Unlock is never discarded, so no line says it,
        // its reason or its retry went or can be undone; and no silent failures (CLAUDE.md): one not sent yet says so, with the way
        // on. A failure the student can try again says so; one on its way says when a pick can go; a change the server refused
        // for good (the unlock over, the class over, not found) says the reason can't change.
        val results = listOf(SendResult.NetworkError) + (100..599).map { SendResult.Status(it) }
        val changes = results.flatMap { result -> (ApiErrorReason.entries + null).map { ReasonFailure.NotChanged(result, it) } }
        val failures = listOf(ReasonFailure.NotStarted, ReasonFailure.NotSaved, ReasonFailure.OnItsWay) + changes
        val final = setOf(ApiErrorReason.UnlockSuperseded, ApiErrorReason.SessionNotRunning, ApiErrorReason.UnlockNotFound)
        for (failure in failures) {
            val said = failure.words
            when {
                failure == ReasonFailure.OnItsWay -> assertTrue("once your unlock reaches your teacher" in said, said)
                failure is ReasonFailure.NotChanged && failure.reason in final -> assertTrue(said.endsWith("can't change."), said)
                else -> assertTrue("try again" in said.lowercase(), "$failure: $said")
            }
        }
        for (failure in RefocusFailure.entries) assertTrue("try again" in failure.words.lowercase(), "$failure: ${failure.words}")
        // Every line of the screen and its card: an unlock pressed, on its way, stuck, recorded, under protection off reported, and
        // a Back to focus refused; and Home's card over it.
        val unlock = queued(Change.Unlock("s", UnlockReason.Nurse))
        val states =
            listOf(listOf(unlock), listOf(unlock.copy(attempts = 1)), listOf(unlock.copy(attempts = 1, stuck = true)), emptyList()).flatMap { queue ->
                listOf(null, RecordedUnlock("s", "u", UnlockReason.Bathroom)).flatMap { kept ->
                    listOf(null, refusedBack(ApiErrorReason.ProtectionOff), refusedBack(ApiErrorReason.EventIdConflict)).map {
                        unlocked(queue).copy(recordedUnlock = kept, refused = it, reportedOff = if (it == null) bell1042.id else null)
                    }
                }
            }
        val screen = states.map { assertNotNull(words(it)) }
        assertTrue(screen.any { it.stuck != null } && screen.any { it.picker is UnlockedWords.Picker.Waiting }, "every line reached")
        val lines =
            screen.flatMap { listOf(it.body, it.picker?.caption, it.retap, it.stuck) } +
                states.map { it.inSessionCard(t0, newYorkZone, usShortTime)?.words } +
                listOf(UnlockedWords.Picker.Waiting(null), UnlockedWords.Picker.Waiting(UnlockReason.Nurse)).map { it.caption } +
                failures.map { it.words } + RefocusFailure.entries.map { it.words }
        val gone = listOf("drop", "delet", "discard", "lost", "remov", "erase", "undo", "undone", "take back", "taken back", "cancel", "gone", "thrown", "forg")
        for (line in lines.filterNotNull().toSet()) for (word in gone) assertFalse(word in line.lowercase(), "says '$word': $line")
        // Not sent yet, said so: kept on the phone and tried again.
        assertTrue(UnlockedWords.UNSENT.endsWith(" yet. It keeps trying."), UnlockedWords.UNSENT)
    }
}

/** What the Protection off and Session over screens say (C5b): BaliOutbox's ProtectionOffScreenTests. */
class ProtectionOffScreenTest : OutboxFiles() {
    @Test
    fun theClassItsTeacherBalisLockOffThatTheTeacherSeesItOrWillSeeItAndHowBackOnceTheSwitchReadsOnAgainTheReTapIsTheWayOn(): Unit =
        runBlocking {
            // AS6-Off-a, AS6-Off-backon, and the Words board's Lock off rows, where the iPhone's lines name Screen Time. A refocus out
            // of protection off is refused (A2), so nothing here offers Lock my apps again.
            val off = assertNotNull(offWords(synced(inBell1042(ParticipationState.ProtectionOff))))
            assertEquals(period3, off.title)
            assertEquals("with Ms. Rivera · ends 10:42 AM", plain(off.subtitle))
            assertEquals(listOf("Bali's lock is off", ProtectionOffWords.Way.Settings, null), listOf(off.headline, off.way, off.refused))
            assertEquals("Bali can't keep you focused without it, so your teacher sees that the lock is off.", off.body)
            val (outbox, _) = makeOutbox()
            record(outbox, Change.ProtectionOff("s"))
            val sending = synced(inBell1042(ParticipationState.ProtectionOff), outbox.records())
            assertEquals("Bali can't keep you focused without it, so your teacher will see that the lock is off.", offWords(sending)?.body)
            assertEquals(offWords(sending)?.body, offWords(synced(inBell1042(ParticipationState.Unlocked)))?.body)
            val back = assertNotNull(offWords(synced(inBell1042(ParticipationState.ProtectionOff)), checked(LockSwitch.On)))
            assertEquals("Bali's lock is back on" to ProtectionOffWords.Way.Retap, back.headline to back.way)
            assertEquals("Tap your teacher's block again to rejoin class. Until then, your teacher sees the lock as off.", back.body)
            // The steps back (#167): the lock on again puts the phone back by itself; the re-tap is the second step only where the
            // switch reads on and that couldn't be done.
            assertEquals(listOf("Turn Bali back on in Accessibility settings", "Bali puts you back in class by itself"), off.steps)
            assertEquals(listOf("Turn Bali back on in Accessibility settings", "Tap your teacher's block again"), back.steps)
            assertEquals("Your class", offWords(synced(inBell1042(ParticipationState.ProtectionOff), me = false))?.title)
            for (standing in listOf(Standing.Out, Standing.Waiting, Standing.Unread)) assertNull(offWords(synced(standing)), "$standing")
        }

    @Test
    fun theWayOnFollowsWhatTheCheckVerifiedOffOrStartingPastTheGraceSettingsOnAgainTheReTapStartingWithinTheGraceOrUncheckedClaimsNothingYet() {
        // Santa's review on iOS; AS6-Off-checking. iOS's way to its own prompt, for a permission never given there, has no Android
        // twin: a switch starting past the grace is off, its way Settings, as one read off is. Within the grace, never "off" over a
        // switch a relaunch hasn't read back yet, and nothing offered.
        val off = synced(inBell1042(ParticipationState.ProtectionOff))
        assertEquals(ProtectionOffWords.Way.Settings, offWords(off, checked(LockSwitch.Off))?.way)
        val never = assertNotNull(offWords(off, checked(LockSwitch.Starting, lasting = true)))
        assertEquals(ProtectionOffWords.Way.Settings to "Bali's lock is off", never.way to never.headline)
        assertEquals(ProtectionOffWords.Way.Retap, offWords(off, checked(LockSwitch.On))?.way)
        for (checking in listOf(checked(LockSwitch.Starting), Protection(), null)) {
            val words = assertNotNull(offWords(off, checking))
            assertEquals(ProtectionOffWords.Way.Checking to "Checking Bali's lock…", words.way to words.headline, "$checking")
            assertEquals("Until the lock is back on, your teacher sees that it's off.", words.body, "$checking")
            assertEquals("Bali puts you back in class by itself", words.steps.last(), "$checking")
        }
    }

    @Test
    fun protectionOffTheCheckFoundButCouldntSaveIsSaidSoNeverThatTheTeacherSeesOrWillSeeItOnTheReTapsAndTheChecksWaysTooAQueuedReportStillWillBeSeen(): Unit =
        runBlocking {
            // Santa's review on iOS; rule 5; C5b's review. The Words board's not-drawn line, the lock where the iPhone's says Screen Time.
            val unlocked = synced(inBell1042(ParticipationState.Unlocked))
            assertEquals(
                "Bali can't keep you focused without it. It couldn't tell your teacher yet, and keeps trying.",
                offWords(unlocked, checked(LockSwitch.Off, unreported = true))?.body,
            )
            assertEquals(
                "Tap your teacher's block again to rejoin class. Bali couldn't tell your teacher that the lock was off.",
                offWords(unlocked, checked(LockSwitch.On, unreported = true))?.body,
            )
            assertEquals(
                "Bali couldn't tell your teacher that the lock was off. It keeps trying.",
                offWords(unlocked, checked(LockSwitch.Starting, unreported = true))?.body,
            )
            val off = synced(inBell1042(ParticipationState.ProtectionOff))
            assertEquals(
                "Tap your teacher's block again to rejoin class. Until then, your teacher sees the lock as off.",
                offWords(off, checked(LockSwitch.On, unreported = true))?.body,
            )
            val (outbox, _) = makeOutbox()
            record(outbox, Change.ProtectionOff("s"))
            val queued = synced(inBell1042(ParticipationState.Unlocked), outbox.records())
            assertEquals(
                "Until the lock is back on, your teacher will see that it's off.",
                offWords(queued, checked(LockSwitch.Starting, unreported = true))?.body,
            )
        }

    @Test
    fun protectionOffNeverQuotesALabelTheGridsProtectionOffNorThePhonesLockOffWhateverTheWayAndWhatTheTeacherIsToldTheScreenSaysItInItsOwnWords(): Unit =
        runBlocking {
            // D2j on iOS, Android's labels the Words board's: the chip's "Lock off" for the ruled "Screen Time off", and the grid's
            // "Protection off". Recorded (sees), on its way (will see), and neither, a protection off found but not saved not told
            // (santa's round 1).
            val (outbox, _) = makeOutbox()
            record(outbox, Change.ProtectionOff("s"))
            val states =
                listOf(
                    synced(inBell1042(ParticipationState.ProtectionOff)), synced(inBell1042(ParticipationState.Unlocked), outbox.records()),
                    synced(inBell1042(ParticipationState.Unlocked)),
                )
            val checks =
                listOf(false, true).flatMap { unreported ->
                    listOf(
                        checked(LockSwitch.Off, unreported = unreported), checked(LockSwitch.Starting, lasting = true, unreported = unreported),
                        checked(LockSwitch.On, unreported = unreported), checked(LockSwitch.Starting, unreported = unreported),
                    )
                }
            val quotes = listOf("lock off", "protection off", "screen time off", "\"", Char(0x201C).toString(), Char(0x201D).toString())
            for (state in states) {
                for (protection in checks) {
                    val words = assertNotNull(offWords(state, protection))
                    for (line in listOf(words.headline, words.body) + words.steps) {
                        for (quoted in quotes) assertFalse(quoted in line.lowercase(), "quotes $quoted: $line")
                    }
                }
            }
        }

    @Test
    fun whatTheScreensProtectionOffTakesOverFromSaidIsSaidThereTooAnUnlockOfThisClassStuckATapTheServerRefusedWhileItsThePhonesNewestTheClassesNotRead(): Unit =
        runBlocking {
            // C5b's review; rule 5, with Try again. #146: the owner's phone said a refused tap an hour later, in another class.
            assertEquals(emptyList(), offWords(synced(inBell1042(ParticipationState.Unlocked)))?.problems)
            val (outbox, _) = makeOutbox()
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, 400, Answer.refused("invalid_request"))
            val tap = record(outbox, Change.Tap("tag"))
            send(outbox, tap, 404, Answer.refused("session_not_found"))
            val unknownBlock = "Bali doesn't know a block you tapped, so that tap hasn't counted. Ask your teacher to set it up."
            val unreached = "Can't reach the server. Check your connection and try again."
            var state = synced(inBell1042(ParticipationState.Unlocked), outbox.records()).copy(meFailed = SendResult.NetworkError)
            assertEquals(listOf(UnlockedWords.UNSENT, unknownBlock, unreached), offWords(state)?.problems)
            state = state.copy(standing = Standing.InSession(session("t", endsAt = 1720), ParticipationState.Unlocked), meFailed = null)
            assertNotEquals(UnlockedWords.UNSENT, offWords(state)?.problems?.firstOrNull())
            // A tap since, joined: the refused one, still kept, is no longer said; the rest still is.
            val next = record(outbox, Change.Tap("tag"))
            send(outbox, next, 200, Answer.joined())
            state = synced(inBell1042(ParticipationState.Unlocked), outbox.records()).copy(lastTap = outbox.lastTap(), meFailed = SendResult.NetworkError)
            assertTrue(state.queued.any { it.eventId == tap.eventId })
            assertEquals(listOf(UnlockedWords.UNSENT, unreached), offWords(state)?.problems)
        }

    @Test
    fun aBackToFocusTheServerRefusedIsSaidWhereTheStudentLandsAfterProtectionOffWhyInTheWordsBoardsLineAnyOtherWithWhoToAskNoneOnceTheClassIsOver() {
        // Rule 5, the re-tap the way back: on Protection off, on Unlocked in Lock my apps again's place while the unlock stands there,
        // and on the class's Home. Once the class is over for the phone, its bell rung or the phone out of it, nothing: the words
        // stale (santa's review on iOS); a refusal of another kind, or none, says nothing.
        var state = synced(inBell1042(ParticipationState.ProtectionOff)).copy(refused = refusedBack(ApiErrorReason.ProtectionOff))
        assertEquals(REFOCUS_REFUSED_OFF, state.refusedRefocusWords(t0))
        assertEquals(REFOCUS_REFUSED_OFF, offWords(state)?.refused)
        assertNull(state.refusedRefocusWords(bell1042.endsAt))
        state = state.copy(refused = refusedBack(ApiErrorReason.EventIdConflict))
        assertEquals(REFOCUS_REFUSED, state.refusedRefocusWords(t0))
        state = state.copy(standing = inBell1042(ParticipationState.Unlocked))
        assertEquals(REFOCUS_REFUSED, words(state)?.retap)
        for (standing in listOf(Standing.Out, Standing.Waiting, Standing.InSession(session("t"), ParticipationState.Unlocked))) {
            assertNull(state.copy(standing = standing).refusedRefocusWords(t0), "$standing")
        }
        state = state.copy(refused = refusedBack(ApiErrorReason.EventIdConflict, session = "another"))
        assertNull(words(state)?.retap)
        assertNull(state.refusedRefocusWords(t0))
        state = state.copy(refused = Refusal(Change.ProtectionOff("s"), 409, null, null))
        assertNull(state.refusedRefocusWords(t0))
        assertNull(words(state)?.retap)
    }

    @Test
    fun sessionOverSaysTheClassThatEndedAndWhenByItsBellAndThatEveryAppIsBackOnlyOnceTheCheckFoundNoLockOnAClassNotReadIsYourClassInNoSessionNothing() {
        // AS6-Over. Nothing checked, nothing claimed of the apps.
        val rung = synced(inBell1042(ParticipationState.Focused))
        assertEquals(
            "$period3 ended at 10:42 AM. All your apps are back.",
            plain(rung.sessionOverWords(checked(LockSwitch.On), newYorkZone, usShortTime)),
        )
        assertEquals("$period3 ended at 10:42 AM.", plain(rung.sessionOverWords(checked(LockSwitch.On, locked = true), newYorkZone, usShortTime)))
        assertEquals("$period3 ended at 10:42 AM.", plain(rung.sessionOverWords(null, newYorkZone, usShortTime)))
        val unread = synced(inBell1042(ParticipationState.Unlocked), me = false)
        assertEquals(
            "Your class ended at 10:42 AM. All your apps are back.",
            plain(unread.sessionOverWords(checked(LockSwitch.On), newYorkZone, usShortTime)),
        )
        assertNull(synced(Standing.Out).sessionOverWords(checked(LockSwitch.On), newYorkZone, usShortTime))
    }
}
