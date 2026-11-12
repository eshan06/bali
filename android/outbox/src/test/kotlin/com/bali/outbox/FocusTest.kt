package com.bali.outbox

import com.bali.core.BaliJson
import com.bali.core.MeResponse
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// What the Focus screen says (C4) and the block screen (B5c), AN10e: BaliOutbox's FocusTests and ShieldWordsTests, iOS's word
// for word but where the Android canvas changes a line: the claim names Bali's lock (the Words board), the block screen keeps its
// title alone (the owner's cut, 2026-11-04), and the late unlock's Settings path is Android's (AS5-Focus-clock, an intermediate
// state; UnlockTest.kt's superseded mark checks it). On a US phone in New York, never the PC's zone or locale. releaseHasBoth and
// unlockHold read iOS's views (AS5's), and unscheduled has no Android twin.

/** Where the tests' phone keeps time, BaliOutbox's tests' `newYork`'s zone: [t0] is 10:13:20 AM there. */
val newYorkZone: ZoneId = ZoneId.of("America/New_York")

/**
 * How a US phone writes a time of day, BaliOutbox's tests' `newYork`'s format. JDK 20 and later, as ICU does, put a narrow
 * no-break space before "AM", where Android 10 puts a space, so a test reads a time through [plain].
 */
val usShortTime: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.US)

/** [text] with plain spaces: the narrow no-break and no-break spaces a time may hold, each a space. BaliOutbox's tests' `plain`. */
fun plain(text: String?): String? = text?.replace(Char(0x202F), ' ')?.replace(Char(0x00A0), ' ')

/** Class c's name, as its teacher wrote it. */
private val period3 = "Period 3 ${Char(0x2014)} Algebra II"

/** A session whose bell is at 10:42 AM in New York. */
private val bell1042 = session(endsAt = 1720)

/** Focused in [view]. */
private fun focusedIn(view: SessionView = bell1042) = Standing.InSession(view, ParticipationState.Focused)

/**
 * The engine standing [standing] with [queued], its link [link], its late unlock [superseded], and `GET /v1/me` naming class c
 * with [teacher] ("null" for a teacher with no name), or, [me] false, not read: BaliOutbox's FocusTests' `synced`.
 */
private fun synced(
    standing: Standing, queued: List<OutboxRecord> = emptyList(), link: Link? = Link.Reached, teacher: String = "\"Ms. Rivera\"",
    me: Boolean = true, superseded: Superseded? = null,
): SyncState {
    val read = """{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"c","name":"$period3","teacher":{"displayName":$teacher}}],"session":null}"""
    val named = if (me) BaliJson.decodeFromString(MeResponse.serializer(), read) else null
    return SyncState(standing = standing, queued = queued, link = link, superseded = superseded, me = named)
}

/** What rule 3's check found: the lock verified on, or not, its switch judged [off], a report of it [unreported]: FocusTests' `checked`. */
private fun checked(locked: Boolean = true, off: Boolean = false, unreported: Boolean = false) =
    Protection(
        checked = true, switch = if (locked) LockSwitch.On else if (off) LockSwitch.Off else LockSwitch.Starting, switchedOff = off,
        locked = locked, unreported = unreported,
    )

/** The Focus screen's words for [state] under [protection] at [now], signed in as [signedIn] says, on a US phone in New York. */
private fun focus(state: SyncState, protection: Protection? = checked(), now: Instant = t0, signedIn: Boolean? = null) =
    FocusWords(state, protection, now, newYorkZone, usShortTime, signedIn)

/** A tap made at [t0], not answered yet: decision 7's cap holds the lock until 11:03:20 AM. */
private val heldTap = listOf(queued(Change.Tap("tag")))

/** What the Focus screen says (C4): BaliOutbox's FocusTests, and the rule that every line of an unlock offers it again. */
class FocusTest {
    @Test
    fun theClassItsTeacherTheCountdownToTheBellByThePhonesClockTheRingAsFullAsTheTimeLeftAndTheLockAsVerifiedWithNoLineUnderTheRing() {
        // AS5-Focus; the owner's cut, 2026-11-04.
        val words = focus(synced(focusedIn()))
        assertEquals(period3, words.title)
        assertEquals("with Ms. Rivera · ends 10:42 AM", plain(words.subtitle))
        val countdown = assertNotNull(words.countdown)
        assertEquals("28:40" to "until 10:42 AM", countdown.digits to plain(countdown.until))
        assertEquals(1720.0 / FocusWords.RING_SPAN.seconds, countdown.fraction)
        assertFalse(countdown.final)
        assertEquals(FocusWords.Claim.Paused, words.claim)
        assertNull(words.claimWords)
        assertEquals(listOf(null, null, null), listOf(words.offline, words.stalled, words.superseded))
    }

    @Test
    fun theCountdownInMinutesAndSecondsHoursOnceOverOneNeverASecondEarlyZeroOnlyAtTheBellTheRingFullAtFiftyMinutesEmptyAtTheBellTheLastTwoMinutesFinal() {
        // AS5-Focus-final.
        val state = synced(focusedIn())
        val cases =
            listOf(
                Triple(at(1720 - 121), "2:01", false), Triple(at(1720 - 120), "2:00", true), Triple(at(1720 - 112), "1:52", true),
                Triple(at(1720).minusMillis(300), "0:01", true), Triple(at(1720), "0:00", true), Triple(at(1800), "0:00", true),
            )
        for ((now, digits, final) in cases) {
            val words = focus(state, now = now)
            assertEquals(digits to final, words.countdown?.let { it.digits to it.final }, "$now")
            assertEquals(period3, words.title, "$now")
        }
        assertEquals(112L, focus(state, now = at(1720 - 112)).countdown?.secondsLeft)
        assertEquals(1L, focus(state, now = at(1720).minusMillis(300)).countdown?.secondsLeft)
        assertEquals(0.0, focus(state, now = at(1720)).countdown?.fraction)
        val long = focus(synced(focusedIn(session(endsAt = 3905))))
        assertEquals("1:05:05" to 1.0, long.countdown?.let { it.digits to it.fraction })
        assertEquals(0.5, focus(synced(focusedIn(session(endsAt = FocusWords.RING_SPAN.seconds / 2)))).countdown?.fraction)
    }

    @Test
    fun aClassGetMeHasntNamedNotReadYetOrNotAmongItsClassesIsInFocusATeacherWithNoNameIsLeftOutNeverWithYourTeacher() {
        val unread = focus(synced(focusedIn(), me = false))
        assertEquals("In focus" to "ends 10:42 AM", unread.title to plain(unread.subtitle))
        assertEquals("In focus", focus(synced(focusedIn(SessionView("s", "other", at(1720))))).title)
        val unnamed = focus(synced(focusedIn(), teacher = "null"))
        assertEquals(period3 to "ends 10:42 AM", unnamed.title to plain(unnamed.subtitle))
    }

    @Test
    fun aTapNotAnsweredYetIsYoureInItsCapOnlyTheLatestTheLockComesOffUnlessTheBellOfTheSessionItsFocusedInComesFirstOfflineItsCardSaysTheTapIsSaved() {
        // Decision 7; AS5-Focus-tap.
        val held = focus(synced(Standing.Out, queued = heldTap))
        assertEquals("You're in" to "Your class shows here once Bali hears back.", held.title to held.subtitle)
        assertEquals("50:00" to "at most until 11:03 AM", held.countdown?.let { it.digits to plain(it.until) })
        assertNull(held.offline)
        assertEquals(
            "Your tap is saved on this phone and reaches your teacher as soon as Bali is back online.",
            focus(synced(Standing.Out, queued = heldTap, link = Link.Unreachable)).offline,
        )
        // Tapped again while focused: the cap outlasting the bell, the tap's answer may name another session.
        val outlasts = focus(synced(focusedIn(), queued = heldTap))
        assertEquals("You're in" to "at most until 11:03 AM", outlasts.title to plain(outlasts.countdown?.until))
        val later = focus(synced(focusedIn(session(endsAt = 4000)), queued = heldTap))
        assertEquals(period3 to "until 11:20 AM", later.title to plain(later.countdown?.until))
        // Unlocked, then tapped again: the tap holds the lock, and no session is focused.
        assertEquals("You're in", focus(synced(Standing.InSession(bell1042, ParticipationState.Unlocked), queued = heldTap)).title)
    }

    @Test
    fun itClaimsWhatTheCheckVerifiedNeverTheStandingTheLockOnIsPausedItsSwitchOffBalisLockOffAndTheWayBackNothingCheckedOnlyTheCheckNoCountdownOverEither() {
        // Rule 3: v2 showed a countdown over nothing locked. The Words board's two lines for Focus, where the iPhone's name Screen
        // Time (AS5-Focus-lockoff-a, AS5-Focus-checking).
        val focused = synced(focusedIn())
        val off = focus(focused, checked(locked = false, off = true))
        assertEquals(FocusWords.Claim.LockOff, off.claim)
        assertEquals("Bali's lock is off, so no app is paused. Turn it back on in Settings → Accessibility → Bali.", off.claimWords)
        assertNull(off.countdown)
        // A tap held, focused still until the report lands: the lock off all the same, never paused.
        val tapOff = focus(synced(Standing.Out, queued = heldTap), checked(locked = false, off = true))
        assertEquals(FocusWords.Claim.LockOff to null, tapOff.claim to tapOff.countdown)
        for (unverified in listOf(null, Protection(), checked(locked = false))) {
            val words = focus(focused, unverified)
            assertEquals(FocusWords.Claim.Unverified to "Checking Bali's lock…", words.claim to words.claimWords, "$unverified")
            assertNull(words.countdown, "$unverified")
        }
        assertNotNull(focus(focused).countdown)
    }

    @Test
    fun anUnlockTheOutboxCouldntKeepIsSaidHoldingAgainTheWayOnItsAppsStillPausedOnlyWhereTheCheckVerifiedTheLockOnBaliNotStartedSaysSoAndAPressThatFoundNothing() {
        // Rule 3, santa's review, and #116's review; AS5-Focus-notsaved.
        val focused = synced(focusedIn())

        // What the screen says of a failure under a protection's claim, as the Focus screen asks.
        fun said(failure: UnlockFailure, protection: Protection? = checked()) =
            failure.words(paused = focus(focused, protection).claim == FocusWords.Claim.Paused)
        assertEquals("Bali couldn't save your unlock, so your apps are still paused. Hold to try again.", said(UnlockFailure.NotSaved))
        for (protection in listOf(checked(locked = false, off = true), null, checked(locked = false))) {
            assertEquals("Bali couldn't save your unlock. Hold to try again.", said(UnlockFailure.NotSaved, protection), "$protection")
        }
        assertEquals(Joining.Failure.NotStarted.words, said(UnlockFailure.NotStarted))
        assertEquals("There was nothing to unlock, so nothing was recorded.", said(UnlockFailure.NothingToUnlock))
    }

    @Test
    fun noAnswerFromTheServerTheBellStillKeptByThePhoneWithNoLineUnderTheRingWaitingOnTheSignInStorageRefusedOrNoExchangeYetIsNoNoConnection() {
        // AS5-Focus-offline; the owner's cut, 2026-11-04.
        val words = focus(synced(focusedIn(), link = Link.Unreachable))
        assertEquals(
            "Focus still ends at 10:42 AM. This phone keeps time without Wi-Fi, and Bali catches up when it's back online. Your teacher sees when this phone last checked in.",
            plain(words.offline),
        )
        assertEquals(FocusWords.Claim.Paused to null, words.claim to words.claimWords)
        for (link in listOf(Link.SignIn, Link.StorageFailed, null)) assertNull(focus(synced(focusedIn(), link = link)).offline, "$link")
    }

    @Test
    fun nothingReachingTheTeacherIsSaidBesideTheCountdownWhichStillHoldsSignedOutTheSignInWaitedOnOrTheStorageRefusingAndProtectionOffUnsavedWithItsClaim() {
        // C4's review; rule 5. AS5-Focus-notes.
        val signedOut = "You're signed out, so Bali can't reach your teacher. Sign in again once class is over."
        val focused = synced(focusedIn(), link = Link.SignIn)
        val out = focus(focused, signedIn = false)
        assertEquals(signedOut, out.stalled)
        assertEquals("28:40", out.countdown?.digits)
        assertEquals(FocusWords.Claim.Paused to null, out.claim to out.offline)
        // Signed out offline too: the card says why nothing goes, beside offline's.
        assertEquals(signedOut, focus(synced(focusedIn(), link = Link.Unreachable), signedIn = false).stalled)
        for (signedIn in listOf(true, null)) {
            assertEquals(
                "Bali can't check your sign-in right now, so it can't reach your teacher. It keeps trying.",
                focus(focused, signedIn = signedIn).stalled, "$signedIn",
            )
        }
        val storage = focus(synced(focusedIn(), link = Link.StorageFailed))
        assertEquals(
            "Bali can't use this phone's storage right now, so it can't reach your teacher. It tries again within a minute.",
            storage.stalled,
        )
        assertEquals("28:40" to FocusWords.Claim.Paused, storage.countdown?.digits to storage.claim)
        for (link in listOf(Link.Reached, Link.Unreachable, null)) assertNull(focus(synced(focusedIn(), link = link)).stalled, "$link")
        // Protection off found and not saved: said with the claim, the check trying again while it is off.
        assertEquals(
            "Bali's lock is off, so no app is paused. Turn it back on in Settings → Accessibility → Bali. Bali couldn't tell your teacher yet, and keeps trying.",
            focus(synced(focusedIn()), checked(locked = false, off = true, unreported = true)).claimWords,
        )
        assertNull(focus(synced(focusedIn())).claimWords)
    }

    @Test
    fun everyLineFocusSaysOfAnUnlockOffersItAgainHoldingAgainTryingAgainOrAfterALateOneUnlockingAgainNothingToUnlockSaidOnlyOnceNothingLocks() {
        // Emergency Unlock is always reachable while the lock may be on (CLAUDE.md; packages/shared's unlock contract), and Focus
        // always holds it: an unlock not saved, Bali still starting, and one the server recorded late with the lock back on each
        // say how to unlock again. Nothing to unlock is said only once nothing the phone knows locks (SyncEngine.pressUnlock).
        for (paused in listOf(true, false)) assertTrue(UnlockFailure.NotSaved.words(paused).endsWith(" Hold to try again."), "paused $paused")
        assertTrue("Try again" in UnlockFailure.NotStarted.words(paused = true))
        for (ordered in listOf(true, false)) {
            val said = assertNotNull(focus(synced(focusedIn(), superseded = Superseded("s", ordered))).superseded, "ordered $ordered")
            assertTrue("hold to unlock again" in said.lowercase(), said)
        }
    }
}

/** What the block screen says (B5c): BaliOutbox's ShieldWordsTests' `words`; `readsNothing` reads iOS's shield extension (AS5's). */
class ShieldWordsTest {
    @Test
    fun theBlockScreenSaysBalisNameAloneWithOkAndOpenBaliNeverTheIphonesLineUnderItNorAWebsitesNorATime() {
        // The owner's cut, 2026-11-04 (AS5-Block); OK as the shield's, Open Bali the Words board's. Android's lock covers apps alone
        // (lock (a)), so no part speaks of a website, where the iPhone's shield has a website's words.
        assertEquals(listOf("Focused with Bali", "OK", "Open Bali"), ShieldWords.entries.map { it.words })
        for (word in ShieldWords.entries.map { it.words }) {
            assertFalse("website" in word.lowercase(), word)
            assertFalse(word.any { it.isDigit() }, word)
        }
    }
}
