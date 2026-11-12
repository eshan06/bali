package com.bali.outbox

import com.bali.core.ParticipationState
import java.time.Duration
import java.time.Instant
import java.util.Collections
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

// Rule 3's report (AN7b): BaliOutbox's ProtectionOffTests, RevokedWhileRunningTests, BackOnTests and
// LaunchGraceTests, the lock's switch in Screen Time's permission's and its marker's place: off is the
// marker gone, on and bound the marker there, starting a launch's not determined. The screen `settles`
// chooses is the router's (AN10a), and the words they check AN10f's: Protection off's way on, Unlocked's card.

/** In session s, ending 3000 s after [t0], in [state]. */
private fun inSession(state: ParticipationState) = Standing.InSession(session(), state)

/** Decision 7's cap after [t0]: until when a tap recorded then is locked. */
private val capped = at(SyncState.TAP_CAP.seconds)

/**
 * Waits until the read loop, or the grace's check made again, sleeps until [deadline], so the clock moved
 * there runs that wake, never one a wake later: BaliOutbox's tests' `checkInDue`.
 */
private suspend fun Rig.dueAt(deadline: Instant) = eventually { clock.deadlines.contains(deadline) }

/** Rule 3: protection off, found and reported. BaliOutbox's ProtectionOffTests. */
class ProtectionOffTest : EngineFiles() {
    /**
     * In a session, focused, the screen on: the student switches the lock off, and the check before the
     * next check-in reports it, which lands, the report returned.
     */
    private suspend fun reported(rig: Rig, phone: Enforced): Server.Exchange {
        rig.tapIn()
        rig.screenOn()
        phone.until { it.locked }
        phone.lock.set(LockSwitch.Off)
        rig.clock.advance(30)
        val report = rig.server.next(protectionOffRoute)
        val now = phone.until { it.switch == LockSwitch.Off && it.until == null }
        assertTrue(now.switchedOff && !now.locked)
        assertEquals(inSession(ParticipationState.ProtectionOff), rig.engine.updates.value.standing)
        report.reply(200, Answer.protectionOff())
        rig.server.next(checkInRoute).reply(200, Answer.live(state = "protection_off"))
        rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
        rig.dueAt(at(60))
        return report
    }

    @Test
    fun theSwitchFoundOffInASessionIsReportedAtTheNextCheckOnceTheCheckAfterFindsItOnRecord(): Unit =
        runBlocking {
            val rig = rig()
            reported(rig, enforced(rig))
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(state = "protection_off"))
            rig.sleeping(at(90))
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(emptyList(), rig.outbox.records())
        }

    @Test
    fun reportedThereAReadSayingThePhoneIsFocusedThereAgainAnOlderReTapLandedHasItReportedAgainAtTheCheck(): Unit =
        runBlocking {
            // A13's rider, through the check, where AN5c's test recorded the report by hand.
            val rig = rig()
            val first = reported(rig, enforced(rig))
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            rig.until { it.standing == inSession(ParticipationState.Focused) }
            rig.dueAt(at(90))
            rig.clock.advance(30)
            val again = rig.server.next(protectionOffRoute)
            assertNotEquals(first.eventId, again.eventId)
            again.reply(200, Answer.protectionOff())
            rig.until { it.standing == inSession(ParticipationState.ProtectionOff) }
        }

    @Test
    fun reportedThereOnlyFocusReportsItAgainAnUnlockMadeSinceReportsNothingNewAtTheCheckAndKeepsNothingEither(): Unit =
        runBlocking {
            val rig = rig()
            reported(rig, enforced(rig))
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            assertEquals(inSession(ParticipationState.Unlocked), rig.engine.updates.value.standing)
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            // Queuing nothing, it keeps nothing either: the file stands where the phone does.
            assertEquals(inSession(ParticipationState.Unlocked), rig.outbox.standing())
            checkIn.reply(200, Answer.live(state = "protection_off"))
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            // The engine's own answer, as AN5c's test had it by hand: nothing to record there.
            assertNull(rig.engine.record(Change.ProtectionOff("s")))
        }

    @Test
    fun protectionOffTheOutboxCouldntQueueIsShownAndTriedAgainAtTheNextCheckQueuedThenItIsNoLongerShown(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            rig.screenOn()
            phone.until { it.locked }
            phone.lock.set(LockSwitch.Off)
            refuseRecords(rig.outbox)
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            val shown = phone.until { it.unreported && it.switch == LockSwitch.Off }
            assertTrue(shown.switchedOff && !shown.locked)
            assertEquals(emptyList(), rig.outbox.records())
            refuseRecords(rig.outbox, false)
            rig.dueAt(at(60))
            rig.clock.advance(30)
            val report = rig.server.next(protectionOffRoute)
            phone.until { !it.unreported }
            assertEquals(inSession(ParticipationState.ProtectionOff), rig.engine.updates.value.standing)
            report.reply(200, Answer.protectionOff())
        }

    @Test
    fun aCheckMadeWhileAPassWaitsOnTheLockKeepsWhatItFoundThePassNeverWritesOverAProtectionOffItCouldntQueue(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            phone.lock.set(LockSwitch.Off)
            refuseRecords(rig.outbox)
            // A pass on the next state the engine publishes, held at its second read of the lock.
            phone.lock.hold(after = 1)
            rig.clock.advance(1)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(503)
            eventually { phone.lock.holding }
            withTimeoutOrNull(patience) { phone.enforcer.check() } ?: fail("the check waited for the pass held on the lock")
            assertTrue(phone.enforcer.updates.value.unreported)
            phone.lock.release()
            val now = phone.until { it.switch == LockSwitch.Off }
            assertTrue(now.unreported && !now.locked)
            assertTrue(phone.enforcer.updates.value.unreported)
        }

    @Test
    fun aCheckAtAWakeWhileAPassWaitsOnTheLockQueuesItsReportAndReturnsAtOnceSoTheCheckInGoesNeverHeldUpByThePass(): Unit =
        runBlocking {
            // Claude Review's WARN on #521, decided as iOS has it: a check returns at once while another pass
            // runs, which then runs again on the newest truth. The check-in claims nothing of the lock, and
            // the report goes first.
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            rig.screenOn()
            phone.until { it.locked }
            // A pass held at its first read of the lock: the run's, for a state the engine publishes.
            phone.lock.hold(after = 0)
            rig.engine.setTapCap(Duration.ofMinutes(15))
            eventually { phone.lock.holding }
            phone.lock.set(LockSwitch.Off)
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            assertTrue(phone.lock.holding)
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
            phone.lock.release()
            phone.until { it.switchedOff && it.until == null && !it.locked }
            checkIn.reply(200, Answer.live(state = "protection_off"))
        }

    @Test
    fun startingForAMomentAsTheServiceBindsIsNeverReportedHoweverManyChecksReadItThen(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            rig.screenOn()
            phone.until { it.locked }
            // The service binding again, on the list and not bound: two checks in a second, each at once.
            phone.lock.set(LockSwitch.Starting)
            phone.enforcer.check()
            rig.clock.advance(1)
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
            assertFalse(phone.enforcer.updates.value.switchedOff)
            // Bound by the check before the next check-in: nothing reported, nothing owed.
            phone.lock.set(LockSwitch.On)
            rig.clock.advance(29)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            phone.lock.set(LockSwitch.Starting)
            rig.dueAt(at(60))
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(inSession(ParticipationState.Focused), rig.engine.updates.value.standing)
        }

    @Test
    fun neverBoundStartingFromTheCheckAsTheScreenComesOnAndAtEveryCheckAfterIsReportedOnceThatLastsTheGraceOnceAndClaimedOffFromThen(): Unit =
        runBlocking {
            // #145's twin: a phone whose lock can't cover anything is never shown locked, nor switched off before the grace.
            val rig = rig()
            val phone = enforced(rig, FakeLock(rig.clock, LockSwitch.Starting))
            rig.tapIn()
            rig.screenOn()
            assertEquals(emptyList(), rig.outbox.records())
            assertFalse(phone.enforcer.updates.value.switchedOff)
            rig.clock.advance(30)
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            rig.server.next(checkInRoute).reply(200, Answer.live(state = "protection_off"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            phone.until { it.switchedOff && it.switch == LockSwitch.Starting && !it.locked }
            rig.dueAt(at(60))
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(state = "protection_off"))
            rig.sleeping(at(90))
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(emptyList(), rig.outbox.records())
        }

    @Test
    fun anyOtherReadEndsARunOfStartingAPassesTooSoAMomentsReadNeverJoinsALaterOne(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            phone.lock.set(LockSwitch.Starting)
            phone.enforcer.check()
            phone.until { it.switch == LockSwitch.Starting }
            // Bound: the pass on the next state the engine publishes reads it on, the check's recheck held
            // back, so only the pass reads it.
            phone.lock.set(LockSwitch.On)
            rig.clock.advance(10, holdingWakes = true)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(503)
            phone.until { it.switch == LockSwitch.On }
            // Starting again, later: a run of its own, not the first's.
            phone.lock.set(LockSwitch.Starting)
            rig.clock.advance(30)
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
            rig.clock.advance(30)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }

    @Test
    fun aClockTurnedBackBetweenTheChecksNeitherStallsTheRunNorStartsItAgainItIsMeasuredByTheTimeThePhoneHasRun(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig, FakeLock(rig.clock, LockSwitch.Starting))
            rig.tapIn()
            phone.enforcer.check()
            // The student turns the phone's clock back ten minutes.
            rig.clock.turn(Duration.ofSeconds(-600))
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
            rig.clock.advance(30)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }

    @Test
    fun aClockSetForwardBetweenTwoReadsOfStartingCollapsesNoGraceAMomentIsNeverReportedAndOneThatLastsTheGraceIs(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            // Just after a launch, the phone's clock minutes behind: starting, for a moment.
            phone.lock.set(LockSwitch.Starting)
            phone.enforcer.check()
            // The clock corrects itself, ten minutes forward, and a second later Bali checks again.
            rig.clock.turn(Duration.ofSeconds(600))
            rig.clock.advance(1)
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
            rig.clock.advance(29)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }

    @Test
    fun aSessionThePhonesOwnClockSaysIsOverHasNoProtectionOffToReportAsItHasNoLockNoneIsWrittenIntoItsHistory(): Unit =
        runBlocking {
            for ((seconds, reported) in listOf(1199L to true, 1200L to false, 1300L to false)) {
                val rig = rig()
                val phone = enforced(rig)
                // Offline since the tap, say: nothing has told the phone the session is over but its clock.
                rig.tapIn(session(endsAt = 1200))
                phone.until { it.locked }
                rig.clock.advance(seconds)
                phone.lock.set(LockSwitch.Off)
                phone.enforcer.check()
                val queued = rig.outbox.records().map { it.change }
                assertEquals(if (reported) listOf(Change.ProtectionOff("s")) else emptyList(), queued, "at $seconds s")
                phone.stop()
            }
        }

    @Test
    fun offlineRule3sCheckStillRunsEvery30SecondsWhileTheScreenIsOnBeforeTheCheckInThatNeverCompletesTheLockPutBackProtectionOffQueued(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            // The screen on, offline: the check-in gets no answer, and goes again at each wake.
            rig.engine.setScreenOn(true)
            rig.server.next(checkInRoute).reply(null)
            phone.until { it.locked }
            rig.dueAt(at(30))
            phone.lock.drop()
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(null)
            eventually { phone.lock.holds }
            rig.dueAt(at(60))
            phone.lock.set(LockSwitch.Off)
            rig.clock.advance(30)
            rig.server.next(protectionOffRoute).reply(null)
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }

    @Test
    fun outOfASessionOrInOneWhoseRowTheServerAlreadyHasAsProtectionOffThereIsNothingToReport(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig, FakeLock(rig.clock, LockSwitch.Off))
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
            // A read says so, say Bali was reinstalled since: this file never reported it.
            rig.screenOn(Answer.me(session(), state = "protection_off"))
            assertEquals(inSession(ParticipationState.ProtectionOff), rig.engine.updates.value.standing)
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
        }

    @Test
    fun outOfASessionTooTheCheckRunsAtEachWakeWhileTheScreenIsOnSwitchedOffItIsFoundAtTheNextWakeNothingReportedOnAgainAtTheNextWake(): Unit =
        runBlocking {
            // C1c. Switched on again in Settings, it is on at the next check: Android has no marker to write again.
            val rig = rig()
            val phone = enforced(rig)
            rig.screenOn(Answer.me(null))
            phone.until { it.checked && it.switch == LockSwitch.On }
            // Switched off in Settings, and nothing else happens: no session, no read, no change.
            phone.lock.set(LockSwitch.Off)
            rig.clock.advance(30)
            phone.until { it.switch == LockSwitch.Off && it.switchedOff }
            rig.dueAt(at(60))
            phone.lock.set(LockSwitch.On)
            rig.clock.advance(30)
            phone.until { it.switch == LockSwitch.On && !it.switchedOff }
            rig.dueAt(at(90))
            phone.lock.set(LockSwitch.Off)
            rig.clock.advance(30)
            phone.until { it.switch == LockSwitch.Off && it.switchedOff }
            // The read loop asleep again: that wake sent nothing.
            rig.dueAt(at(120))
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(emptyList(), rig.server.waiting)
        }
}

/** #144's twin: the lock switched off while Bali runs, found by the switch. BaliOutbox's RevokedWhileRunningTests. */
class RevokedWhileRunningTest : EngineFiles() {
    /** Focused in a class, the screen on, the read loop asleep until the check-in at 30 s, the switch on and bound. */
    private suspend fun focused(): Pair<Rig, Enforced> {
        val rig = rig()
        val phone = enforced(rig)
        rig.tapIn()
        rig.screenOn()
        phone.until { it.locked && it.until == session().endsAt }
        return rig to phone
    }

    @Test
    fun switchedOffInSettingsWithTheScreenOnTheNextCheckReportsProtectionOffAndNeverPutsTheLockBackOverIt(): Unit =
        runBlocking {
            // Android unbinds the service, and the lock ends with it. The screen's way on is Settings, Android's Accessibility
            // settings, where iOS's is its own prompt.
            val (rig, phone) = focused()
            val locks = phone.lock.locks
            phone.lock.set(LockSwitch.Off)
            rig.clock.advance(30)
            val report = rig.server.next(protectionOffRoute)
            val now = phone.until { it.switchedOff && it.until == null }
            assertEquals(LockSwitch.Off, now.switch)
            assertFalse(now.locked)
            report.reply(200, Answer.protectionOff())
            rig.server.next(checkInRoute).reply(200, Answer.live(state = "protection_off"))
            val state = rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            assertEquals(ProtectionOffWords.Way.Settings, ProtectionOffWords.of(state, phone.enforcer.updates.value, newYorkZone, usShortTime)?.way)
            assertEquals(locks, phone.lock.locks)
            assertFalse(phone.lock.holds)
        }

    @Test
    fun switchedOffWithTheScreenOffTheCheckAsBaliComesToTheFrontReportsItWithNoRelaunchAndAPassBeforeItTheLockOwedPutsNoneOn(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            phone.lock.set(LockSwitch.Off)
            rig.clock.advance(600)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(200, Answer.me())
            val found = phone.until { it.switchedOff }
            assertEquals(session().endsAt, found.until)
            assertFalse(found.locked)
            assertFalse(phone.lock.holds)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }

    @Test
    fun onAndBoundTheSwitchIsNeverOffCheckAfterCheckAndNothingIsReadAgainEverySecond(): Unit =
        runBlocking {
            // markerThere's twin: on is on at once, with no grace and no recheck.
            val (rig, phone) = focused()
            for (check in 1L..3L) {
                rig.clock.advance(30)
                rig.server.next(checkInRoute).reply(200, Answer.live())
                rig.dueAt(at(30 * (check + 1)))
            }
            phone.enforcer.check()
            val now = phone.until { it.switch == LockSwitch.On && it.locked }
            assertFalse(now.switchedOff)
            assertFalse(rig.clock.deadlines.contains(at(90) + Enforcer.RECHECK_AFTER))
            assertEquals(emptyList(), rig.outbox.records())
        }

    @Test
    fun switchedOnAgainWhatTheStandingCallsForComesBackAReTapMadeWhileItWasOffNeverLockedOverItIsLockedAtOnceToItsCap(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            val view = session(endsAt = 1200)
            rig.tapIn(view)
            phone.until { it.locked }
            phone.lock.set(LockSwitch.Off)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff(view))
            rig.until { it.queued.isEmpty() && it.standing == Standing.InSession(view, ParticipationState.ProtectionOff) }
            // The block tapped again before the switch is on, its answer not come: owed, never put on.
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute)
            phone.until { it.until == capped }
            assertFalse(phone.lock.holds)
            val locks = phone.lock.locks
            // Switched on again in Settings: the check as the service binds (AN7c).
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            val now = phone.until { it.locked }
            assertFalse(now.switchedOff)
            assertEquals(capped, phone.lock.until)
            assertEquals(locks + 1, phone.lock.locks)
        }

    @Test
    fun andOverAStandingNotReadNothingIsReportedAndSwitchedOnAgainATapNotYetAnsweredIsLockedAgainWithItsEnd(): Unit =
        runBlocking {
            val (phone, _) = unreadable(held = false)
            val rig = phone.rig
            // Offline: a tap the server never answers, locked to its cap.
            rig.engine.record(Change.Tap("tag"))
            phone.until { it.locked && it.until == capped }
            rig.server.next(tapRoute).reply(null)
            assertEquals(capped, phone.lock.until)
            phone.lock.set(LockSwitch.Off)
            phone.enforcer.check()
            phone.until { it.switchedOff }
            assertEquals(listOf(Change.Tap("tag")), rig.outbox.records().map { it.change })
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            phone.until { it.locked }
            assertEquals(capped, phone.lock.until)
        }

    @Test
    fun aPassEndsARunOfStartingAtItsOwnReadSoACheckMadeWhileThePassIsUnderWayKeepsItsNewerReadReportedACheckInLaterNotTwo(): Unit =
        runBlocking {
            // runKeptOverPass's twin: B5a-2's order kept.
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked && it.until == session().endsAt }
            // A pass that has read the switch on, held at its first read of the lock.
            phone.lock.hold(after = 0)
            rig.clock.advance(1)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(503)
            eventually { phone.lock.holding }
            // The service rebinding now, and a check begins its run.
            phone.lock.set(LockSwitch.Starting)
            withTimeoutOrNull(patience) { phone.enforcer.check() } ?: fail("the check waited for the pass held on the lock")
            phone.lock.release()
            phone.until { it.switch == LockSwitch.Starting }
            rig.clock.advance(30)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }
}

/**
 * #167's twin: the lock switched on again in the class the phone was protection off in puts it back where
 * it stood, focused or still unlocked, with no re-tap. BaliOutbox's BackOnTests, the lock's half: the
 * engine's half of `once`, `lateUnlocked`, `unlockedSince` and `notKnown` is BackOnTest's.
 */
class LockBackOnTest : EngineFiles() {
    /** Tapped into session s, and, [unlocked], out of focus by an Emergency Unlock the server recorded; then switched off, its report answered. */
    private suspend fun off(unlocked: Boolean = false): Pair<Rig, Enforced> {
        val rig = rig()
        val phone = enforced(rig)
        rig.tapIn()
        phone.until { it.locked }
        if (unlocked) {
            rig.engine.emergencyUnlock()
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Unlocked) }
        }
        phone.lock.set(LockSwitch.Off)
        phone.enforcer.check()
        rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
        return rig to phone
    }

    @Test
    fun switchedOnAgainInTheClassFocusedAgainAtOnceTheLockBackOnTheServerToldUnderThePhonesOrderNoTapMadeAndALaterSwitchOffReportedAgain(): Unit =
        runBlocking {
            val (rig, phone) = off()
            // The check as the service binds (AN7c).
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            val now = phone.until { it.locked }
            assertFalse(now.switchedOff)
            assertEquals(session().endsAt, now.until)
            val state = rig.engine.updates.value
            assertEquals(inSession(ParticipationState.Focused), state.standing)
            assertNull(state.reportedOff)
            assertEquals(listOf(Change.ProtectionOn("s")), state.queued.map { it.change })
            assertNotNull(state.queued.first().order)
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Focused) }
            assertEquals(emptyList(), rig.server.waiting)
            // Switched off again, it is a new one: reported again.
            phone.lock.set(LockSwitch.Off)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOff("s")), rig.outbox.records().map { it.change })
        }

    @Test
    fun switchedOnButNotBoundYetProvesNothingTheBackOnWaitsForTheServiceToBind(): Unit =
        runBlocking {
            // No iOS twin (its marker's `markerNotBack` is Android's on and bound): starting may never bind,
            // and the grace would then report it off again.
            val (rig, phone) = off()
            phone.lock.set(LockSwitch.Starting)
            phone.enforcer.check()
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(inSession(ParticipationState.ProtectionOff), rig.engine.updates.value.standing)
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            assertEquals(listOf(Change.ProtectionOn("s")), rig.outbox.records().map { it.change })
            assertEquals(inSession(ParticipationState.Focused), rig.engine.updates.value.standing)
        }

    @Test
    fun unlockedBeforeTheSwitchWentOffStillUnlockedOnceItIsBackOnNeverLockedOverTheEmergencyUnlockAtOnceAndByTheServersAnswer(): Unit =
        runBlocking {
            // A20: its reason still changeable as before, the card open at the one on record (santa's round 1 on iOS).
            val (rig, phone) = off(unlocked = true)
            val locks = phone.lock.locks
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            rig.until { it.standing == inSession(ParticipationState.Unlocked) }
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn(state = "unlocked"))
            val state = rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Unlocked) }
            assertEquals(UnlockedWords.Picker.Open(null), UnlockedWords.of(state, newYorkZone, usShortTime)?.picker)
            val now = phone.until { it.switch == LockSwitch.On && !it.switchedOff }
            assertFalse(now.locked)
            assertNull(now.until)
            assertEquals(locks, phone.lock.locks)
            assertFalse(phone.lock.holds)
        }

    @Test
    fun madeOnceTwoChecksAtOnceAsItIsSwitchedOnRecordOneLockBackOnAndNeverLockOverTheEmergencyUnlockItReturnedTo(): Unit =
        runBlocking {
            // The lock's half of `once`.
            val (rig, phone) = off(unlocked = true)
            phone.lock.set(LockSwitch.On)
            listOf(async { phone.enforcer.check() }, async { phone.enforcer.check() }).awaitAll()
            val state = rig.engine.updates.value
            assertEquals(inSession(ParticipationState.Unlocked), state.standing)
            assertEquals(listOf(Change.ProtectionOn("s")), state.queued.map { it.change })
            phone.until { it.switch == LockSwitch.On && it.until == null }
            assertFalse(phone.lock.holds)
        }

    @Test
    fun unlockedAndTheLockBackOnsAnswerLateProtectionOffAgainByTheServersTruthTheNextChecksBackOnStillReturnsToUnlockedNeverLocked(): Unit =
        runBlocking {
            // The lock's half of `lateUnlocked`.
            val (rig, phone) = off(unlocked = true)
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            rig.server.next(protectionOnRoute).reply(200, Answer.replay(state = "protection_off"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            phone.enforcer.check()
            assertEquals(inSession(ParticipationState.Unlocked), rig.engine.updates.value.standing)
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn(state = "unlocked"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Unlocked) }
            assertFalse(phone.lock.holds)
        }

    @Test
    fun anEmergencyUnlockMadeAfterALockBackOnTheServerHasYetToTakeTheTruthThenProtectionOffAgainTheNextChecksReturnsToUnlocked(): Unit =
        runBlocking {
            // The lock's half of `unlockedSince`: that unlock is the latest turn the server recorded.
            val (rig, phone) = off()
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            rig.until { it.standing == inSession(ParticipationState.Focused) }
            val first = rig.server.next(protectionOnRoute)
            rig.engine.emergencyUnlock()
            first.reply(200, Answer.replay(state = "protection_off"))
            rig.server.next(unlockRoute).reply(200, Answer.unlockUnderOff())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            phone.enforcer.check()
            assertEquals(inSession(ParticipationState.Unlocked), rig.engine.updates.value.standing)
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn(state = "unlocked"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Unlocked) }
            assertFalse(phone.lock.holds)
        }

    @Test
    fun pastTheClassesBellByThePhonesClockOrOutOfAClassSwitchedOnAgainChangesNothingAndSendsNothing(): Unit =
        runBlocking {
            for (over in listOf(true, false)) {
                val (rig, phone) = off()
                if (over) {
                    rig.clock.advance(3000)
                } else {
                    // The server has the phone in no class.
                    rig.engine.setInFront(true)
                    rig.server.next(meRoute).reply(200, Answer.me(null))
                    rig.until { it.standing == Standing.Out }
                }
                phone.lock.set(LockSwitch.On)
                phone.enforcer.check()
                assertEquals(emptyList(), rig.outbox.records(), "over $over")
                val standing = if (over) inSession(ParticipationState.ProtectionOff) else Standing.Out
                assertEquals(standing, rig.engine.updates.value.standing, "over $over")
                phone.stop()
            }
        }

    @Test
    fun relaunchedInProtectionOffSwitchedOnAgainBeforeBaliClosedItsFirstCheckPutsItBackWhereItStoodAfterTheReportStillQueued(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            outbox.keep(inSession(ParticipationState.Unlocked))
            record(outbox, Change.ProtectionOff("s"))
            outbox.keep(inSession(ParticipationState.ProtectionOff))
            val phone = enforced(rig(open(file)))
            val rig = phone.rig
            phone.until { it.checked }
            phone.enforcer.check()
            rig.until { it.standing == inSession(ParticipationState.Unlocked) }
            assertEquals(listOf(Change.ProtectionOff("s"), Change.ProtectionOn("s")), rig.outbox.records().map { it.change })
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            // The report's answer is older than the phone's truth: it holds until the lock back on's comes.
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn(state = "unlocked"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Unlocked) }
            assertFalse(phone.lock.holds)
        }

    @Test
    fun refusedTheRowNoLongerProtectionOffItIsDroppedAndTheTruthReadAgainAndALateAnswerALaterProtectionOffOnRecordIsMadeGoodAtTheNextCheck(): Unit =
        runBlocking {
            val (rig, phone) = off()
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            rig.server.next(protectionOnRoute).reply(409, Answer.refused("protection_not_off"))
            rig.server.next(meRoute).reply(200, Answer.me())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Focused) }
            assertEquals(Change.ProtectionOn("s"), rig.engine.updates.value.refused?.change)
            // Off again, and on: the server holding a protection off of the phone's made after it answers as
            // its retry is, the truth now, which the next check makes good.
            phone.lock.set(LockSwitch.Off)
            phone.enforcer.check()
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            rig.server.next(protectionOnRoute).reply(200, Answer.replay(state = "protection_off"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            phone.enforcer.check()
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Focused) }
        }
}

/**
 * #145's twin: a switch starting at a launch, off once that lasts the grace, read again every second
 * meanwhile, never over a service that binds within it; and on or off deciding at once.
 * BaliOutbox's LaunchGraceTests, with the screen `settles` chooses.
 */
class LaunchGraceTest : EngineFiles() {
    /**
     * A relaunch standing as [standing], the lock holding the last run's lock in a session, its switch
     * starting (on Android's list, not bound yet), and the check made as Bali comes to the front: the grace
     * begun, the screen off, so no wake of the engine's checks.
     */
    private suspend fun launched(standing: Standing): Enforced {
        val (outbox, file) = makeOutbox()
        outbox.keep(standing)
        val rig = rig(open(file))
        val phone = enforced(rig, FakeLock(rig.clock, LockSwitch.Starting).also { if (standing is Standing.InSession) it.held() })
        phone.until { it.checked }
        phone.enforcer.check()
        return phone
    }

    /** The clock moved on a second at a time, [count] times, each the grace's next check due there first. */
    private suspend fun seconds(count: Long, rig: Rig) {
        repeat(count.toInt()) {
            val due = rig.clock.now() + Enforcer.RECHECK_AFTER
            eventually { rig.clock.deadlines.contains(due) }
            rig.clock.advance(Enforcer.RECHECK_AFTER)
        }
    }

    @Test
    fun theSwitchDecidesALaunchAtOnceOffAtTheFirstPassAndReportedAtTheFirstCheckNoGraceWaitedOutOnLockedAtTheFirstPassNothingReadAgainEverySecond(): Unit =
        runBlocking {
            // markerAtLaunch's twin.
            for (off in listOf(true, false)) {
                val (outbox, file) = makeOutbox()
                outbox.keep(inSession(ParticipationState.Focused))
                val rig = rig(open(file))
                val lock = FakeLock(rig.clock, if (off) LockSwitch.Off else LockSwitch.On).also { if (!off) it.held() }
                val phone = enforced(rig, lock)
                val first = phone.until { it.checked }
                assertEquals(off, first.switchedOff, "off $off")
                assertEquals(!off, first.locked, "off $off")
                phone.enforcer.check()
                assertEquals(if (off) listOf(Change.ProtectionOff("s")) else emptyList(), rig.outbox.records().map { it.change }, "off $off")
                if (off) rig.sleeping() else rig.sleeping(session().endsAt)
                phone.stop()
            }
        }

    @Test
    fun neverBoundAtALaunchTheSwitchReadsStartingReadAgainEverySecondByTheEnforcerAloneAndJudgedOffOnceThatLastsTheGraceReportedThenASecondSoonerNothing(): Unit =
        runBlocking {
            val phone = launched(inSession(ParticipationState.Focused))
            val rig = phone.rig
            seconds(Enforcer.GRACE.seconds - 1, rig)
            // The check a second before the grace's end made, its next due at the end: nothing yet.
            rig.dueAt(at(Enforcer.GRACE.seconds))
            assertEquals(emptyList(), rig.outbox.records())
            assertFalse(phone.enforcer.updates.value.switchedOff)
            rig.clock.advance(Enforcer.RECHECK_AFTER)
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            val claim = phone.until { it.switchedOff }
            assertEquals(LockSwitch.Starting, claim.switch)
            assertFalse(claim.locked)
            val state = rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            // The screen says Bali's lock is off, its way on Settings, where iOS's is its own prompt for a grant never given.
            val off = assertNotNull(ProtectionOffWords.of(state, claim, newYorkZone, usShortTime))
            assertEquals(ProtectionOffWords.Way.Settings to "Bali's lock is off", off.way to off.headline)
            // Judged off, nothing is read every second: the engine's wakes check from here.
            rig.sleeping()
        }

    @Test
    fun aCheckJudgedAMomentBeforeTheGracesEndItsPassEndingPastItIsStillMadeAgainASecondOnTheReportFollowingTheClaimOfTheSwitchOff(): Unit =
        runBlocking {
            // Santa's round 1 on iOS: never left to the engine's next wake.
            val phone = launched(inSession(ParticipationState.Focused))
            val rig = phone.rig
            seconds(Enforcer.GRACE.seconds - 2, rig)
            // The check a second before the grace's end, held in its pass at its second read of the lock while
            // the grace runs out.
            rig.dueAt(at(Enforcer.GRACE.seconds - 1))
            phone.lock.hold(after = 1)
            rig.clock.advance(Enforcer.RECHECK_AFTER)
            eventually { phone.lock.holding }
            rig.clock.advance(Enforcer.RECHECK_AFTER)
            phone.lock.release()
            phone.until { it.switchedOff }
            rig.dueAt(at(Enforcer.GRACE.seconds + 1))
            rig.clock.advance(Enforcer.RECHECK_AFTER)
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
        }

    @Test
    fun aLockThatThrowsInTheGracesCheckMadeAgainReachesNoHandlerOfTheAppsAndTheNextCheckGoesOnWithTheGrace(): Unit =
        runBlocking {
            // The recheck is the enforcer's own, as the alarm's pass is (AN7a), so no failure of the lock's
            // there reaches the app's handler, which on Android ends the app. Out of a session, no alarm
            // runs beside it.
            val uncaught = Collections.synchronizedList(mutableListOf<Throwable>())
            val rig = rig()
            val lock = FakeLock(rig.clock, LockSwitch.Starting)
            // A job of its own under the test's, so its calls and rechecks can be seen to end.
            val own = Job(scope.coroutineContext.job)
            val handler = CoroutineExceptionHandler { _, failure -> uncaught += failure }
            val enforcer = Enforcer(rig.engine, lock, CoroutineScope(scope.coroutineContext + own + handler), rig.clock)
            enforcer.check()
            rig.dueAt(at(1))
            lock.failNextRead()
            rig.clock.advance(Enforcer.RECHECK_AFTER)
            eventually { lock.throws == 1 }
            eventually { own.children.all { it.children.none() } }
            assertEquals(emptyList(), uncaught.toList())
            // The run of starting kept: the next check, the grace over, judges it off.
            rig.clock.advance(Enforcer.GRACE)
            enforcer.check()
            assertTrue(enforcer.updates.value.switchedOff)
        }

    @Test
    fun aServiceThatBindsAMomentAfterALaunchReadsOnTheSecondItBindsReadAgainEverySecondAndNoClaimEverJudgesItOffNothingReported(): Unit =
        runBlocking {
            for (standing in listOf(inSession(ParticipationState.Focused), Standing.Out)) {
                val phone = launched(standing)
                val rig = phone.rig
                // Every claim, collected where each is set, so none is missed.
                val claims = Collections.synchronizedList(mutableListOf<Protection>())
                val watching = scope.launch(Dispatchers.Unconfined) { phone.enforcer.updates.collect { claims += it } }
                seconds(2, rig)
                // The service binds between 2 and 3 s: the check made at 3 s reads it.
                rig.dueAt(at(3))
                phone.lock.set(LockSwitch.On)
                rig.clock.advance(Enforcer.RECHECK_AFTER)
                val now = phone.until { it.switch == LockSwitch.On }
                assertEquals(standing != Standing.Out, now.locked, "$standing")
                assertFalse(now.switchedOff, "$standing")
                // Settled, nothing is read every second, and long past the grace, nothing reported.
                if (standing == Standing.Out) rig.sleeping() else rig.sleeping(session().endsAt)
                rig.clock.advance(60)
                phone.enforcer.check()
                assertEquals(emptyList(), rig.outbox.records(), "$standing")
                watching.cancelAndJoin()
                // No claim routes as the switch off: out of a session, starting routes as on, the switch read on before
                // (`everApproved`, Q3), so Home, never the permission step; in one, Focus.
                val sync = rig.engine.updates.value
                for (claim in claims.toList()) {
                    if (!claim.checked) continue
                    assertFalse(claim.switchedOff, "$standing")
                    val shown =
                        Screen.choose(
                            problem = null, deleting = false, age = AgeCheck.Answer.Passed, intro = false, signedIn = true,
                            signedInThisRun = false, protection = claim, everApproved = true, sync = sync, listSeenBy = "u",
                            sessionOverClosed = null, opened = emptyList(), tab = Screen.Home, now = rig.clock.now(),
                        )
                    assertEquals(if (standing == Standing.Out) Screen.Home else Screen.Focus, shown.screen, "$standing $claim")
                }
                phone.stop()
            }
        }
}
