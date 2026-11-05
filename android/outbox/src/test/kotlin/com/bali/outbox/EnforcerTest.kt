package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.time.Duration
import java.util.Collections
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

// The lock follows the engine (AN7a): BaliOutbox's EnforcerTests, the lock's switch in Screen Time's
// permission's place, and the lock's end, which iOS's shields don't carry.

/** In session s, ending 3000 s after [t0], in [state]. */
private fun inSession(state: ParticipationState) = Standing.InSession(session(), state)

/** Decision 7's cap after [t0]: until when a tap recorded then is locked. */
private val capped = at(SyncState.TAP_CAP.seconds)

/** The lock follows the engine: BaliOutbox's EnforcerTests. */
class EnforcerTest : EngineFiles() {
    @Test
    fun whatAScreenMayClaimIsCheckedOnlyOnceAPassHasReadThePhoneTheFirstValueIsTheDefaultsUncheckedAndACheckMakesItSo(): Unit =
        runBlocking {
            // C1a: no screen is chosen on the defaults.
            val rig = rig()
            val enforcer = Enforcer(rig.engine, FakeLock(rig.clock), scope, rig.clock)
            assertFalse(enforcer.updates.value.checked)
            enforcer.check()
            val found = enforcer.updates.value
            assertTrue(found.checked)
            assertEquals(LockSwitch.On, found.switch)
        }

    @Test
    fun aTapLocksAtOnceBeforeItsAnswerAndTheAnswerKeepsTheLockOnToTheBellWhereItStopsByThePhonesOwnClock(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            val view = session(endsAt = 1200)
            rig.engine.record(Change.Tap("tag"))
            var now = phone.until { it.locked }
            assertEquals(capped, now.until)
            assertEquals(LockSwitch.On, now.switch)
            assertEquals(capped, phone.lock.until)
            rig.server.next(tapRoute).reply(200, Answer.joined(view))
            now = phone.until { it.until == view.endsAt }
            assertTrue(now.locked)
            // The lock carries the bell's end now, its own by the phone's clock.
            assertEquals(view.endsAt, phone.lock.until)
            rig.clock.advance(1200)
            now = phone.until { !it.locked }
            assertNull(now.until)
            assertFalse(phone.lock.holds)
        }

    @Test
    fun emergencyUnlockTakesTheLockOffAtOnceThroughTheEngineAndARefocusPutsItBack(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            rig.engine.record(Change.Unlock("s", UnlockReason.Nurse))
            phone.until { !it.locked && it.until == null }
            assertFalse(phone.lock.holds)
            rig.engine.record(Change.Refocus("s"))
            phone.until { it.locked && it.until == session().endsAt }
            assertEquals(session().endsAt, phone.lock.until)
        }

    @Test
    fun aTapTheServerNeverAnswersComesOffAtDecision7sCapStillQueued(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.engine.record(Change.Tap("tag"))
            phone.until { it.locked && it.until == capped }
            rig.server.next(tapRoute).reply(null)
            rig.clock.advance(SyncState.TAP_CAP)
            phone.until { !it.locked }
            assertFalse(phone.lock.holds)
            assertNotNull(rig.engine.updates.value.pendingTap)
        }

    @Test
    fun anUnlockMadeWhileARetapWaitsForItsAnswerTakesTheLockOffAtOnce(): Unit =
        runBlocking {
            // Decision 11.
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn(session(endsAt = 1200))
            rig.engine.record(Change.Tap("tag"))
            phone.until { it.until == capped }
            rig.engine.record(Change.Unlock("s", null))
            phone.until { !it.locked }
            assertFalse(phone.lock.holds)
            assertNotNull(rig.engine.updates.value.pendingTap)
        }

    @Test
    fun aTapAnsweredArmedOrRefusedTakesItsLockOffWithTheAnswer(): Unit =
        runBlocking {
            for ((status, body) in listOf(200 to Answer.armed, 409 to Answer.refused("session_not_running"))) {
                val rig = rig()
                val phone = enforced(rig)
                rig.engine.record(Change.Tap("tag"))
                phone.until { it.locked }
                rig.server.next(tapRoute).reply(status, body)
                phone.until { !it.locked }
                assertFalse(phone.lock.holds, body)
                phone.stop()
            }
        }

    @Test
    fun rule3ALockGoneBehindBalisBackGoesBackOnAtTheCheckBeforeTheNextCheckIn(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            rig.screenOn()
            phone.until { it.locked }
            phone.lock.drop()
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            // Back on at the check before it, before any answer could change the state.
            eventually { phone.lock.holds }
            assertEquals(session().endsAt, phone.lock.until)
            checkIn.reply(200, Answer.live())
        }

    @Test
    fun whatAScreenClaimsIsWhatThePassFoundNeverTheStandingAloneFocusedWithTheSwitchOffClaimsNoLockAndNoneIsPutOn(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            // The student switches the service off in Settings: Android unbinds it, and the lock ends with it.
            phone.lock.set(LockSwitch.Off)
            // A read of the truth, heard a second later, changes the state: the claim is checked again.
            rig.clock.advance(1)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(200, Answer.me())
            val now = phone.until { it.switch == LockSwitch.Off }
            assertTrue(now.switchedOff)
            assertFalse(now.locked)
            assertEquals(session().endsAt, now.until)
            assertEquals(inSession(ParticipationState.Focused), rig.engine.updates.value.standing)
            // Never put on over the switch off, where the service, unbound, would hold nothing.
            assertFalse(phone.lock.holds)
            assertEquals(1, phone.lock.locks)
            // Switched on again, the check as Bali comes back puts it back on, to the bell.
            phone.lock.set(LockSwitch.On)
            phone.enforcer.check()
            phone.until { it.locked }
            assertEquals(session().endsAt, phone.lock.until)
        }

    @Test
    fun aRelaunchStartsWhereThePhoneStoodInItsSessionItsTapStillWaitingSoTheLastRunsLockStaysOnOfflineTooGivenThisRunsEnd(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            val before = rig(outbox)
            before.tapIn(session(endsAt = 1200))
            before.engine.record(Change.Tap("tag"))
            before.stop()
            // An engine starts from the file, before it runs: enforcement never begins from nothing.
            val state = engine(open(file)).updates.value
            assertEquals(Standing.InSession(session(endsAt = 1200), ParticipationState.Focused), state.standing)
            assertNotNull(state.pendingTap)
            val rig = rig(open(file))
            val lock = FakeLock(rig.clock).also { it.held() }
            val now = enforced(rig, lock).until { it.until != null }
            assertTrue(now.locked)
            assertEquals(capped, now.until)
            // The last run's lock, given this run's end, never taken off meanwhile.
            assertEquals(capped, lock.until)
            assertEquals(0, lock.unlocks)
        }

    @Test
    fun switchedOnInSettingsTheClaimSaysSoAtTheCheckAsBaliComesBack(): Unit =
        runBlocking {
            // requestPermission's twin: Android asks nothing, the student switches the service on. No run
            // beside it, so the check's own pass is the only one.
            val rig = rig()
            val lock = FakeLock(rig.clock, LockSwitch.Off)
            val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
            enforcer.check()
            assertEquals(LockSwitch.Off, enforcer.updates.value.switch)
            lock.set(LockSwitch.On)
            enforcer.check()
            val claim = enforcer.updates.value
            assertEquals(LockSwitch.On, claim.switch)
            assertFalse(claim.switchedOff)
        }

    @Test
    fun leftOffInSettingsTheClaimSaysTheSwitchIsOffAsTheCheckReturnsNotACheckInLater(): Unit =
        runBlocking {
            // requestPermissionRefused's twin (C1b).
            val rig = rig()
            val enforcer = Enforcer(rig.engine, FakeLock(rig.clock, LockSwitch.Off), scope, rig.clock)
            enforcer.check()
            val claim = enforcer.updates.value
            assertTrue(claim.checked && claim.switchedOff)
            assertEquals(LockSwitch.Off, claim.switch)
        }

    @Test
    fun aCheckMadeWhileAPassWaitsOnTheLockLandsAtOnceAndThePassRunsAgainOnTheNewestTruth(): Unit =
        runBlocking {
            // Swift's actor, let go at each call into the lock: AN7b's checkDuringPass, runKeptOverPass and
            // passCrossesGrace need a check to land so. No run beside it, so only the checks make passes.
            val rig = rig()
            rig.tapIn()
            val lock = FakeLock(rig.clock)
            val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
            enforcer.check()
            assertTrue(enforcer.updates.value.locked)
            // A pass held at its second read of the lock, after it has found nothing to change.
            lock.hold(after = 1)
            val held = async { enforcer.check() }
            eventually { lock.holding }
            // The lock gone behind Bali's back meanwhile, and a check made: it lands at once.
            lock.drop()
            withTimeoutOrNull(patience) { enforcer.check() } ?: fail("the check waited for the pass held on the lock")
            lock.release()
            held.await()
            // The held pass ran again for it: the lock back on, and claimed.
            assertTrue(lock.holds)
            assertTrue(enforcer.updates.value.locked)
            assertEquals(2, lock.locks)
        }

    @Test
    fun aCheckWhoseCallerIsCancelledStopsWaitingAtOnceAndItsPassGoesOnTheLockPutOnAllTheSame(): Unit =
        runBlocking {
            // The engine's read loop cancelled while it waits on the check, say: never a pass cut short.
            val rig = rig()
            rig.tapIn()
            val lock = FakeLock(rig.clock)
            val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
            lock.hold(after = 0)
            val caller = launch { enforcer.check() }
            eventually { lock.holding }
            withTimeoutOrNull(patience) { caller.cancelAndJoin() } ?: fail("the cancelled caller waited for the pass")
            lock.release()
            eventually { lock.holds }
            withTimeoutOrNull(patience) { enforcer.updates.first { it.locked } } ?: fail("the pass never claimed the lock")
        }

    @Test
    fun startingOnTheListNotBoundYetStillLocksSoTheLockCoversAppsAsTheServiceBinds(): Unit =
        runBlocking {
            val rig = rig()
            val lock = FakeLock(rig.clock, LockSwitch.Starting)
            val phone = enforced(rig, lock)
            rig.tapIn()
            val starting = phone.until { it.until == session().endsAt && it.switch == LockSwitch.Starting }
            // Neither verified while it starts, nor off.
            assertFalse(starting.locked)
            assertFalse(starting.switchedOff)
            assertEquals(session().endsAt, lock.until)
            // Bound: the service's connect runs the check (AN7c), which claims the lock it held.
            lock.set(LockSwitch.On)
            phone.enforcer.check()
            phone.until { it.locked }
            assertEquals(1, lock.locks)
        }

    @Test
    fun aLockThatThrowsAgainstItsPromiseAFailureOrAnErrorEndsOnlyThatPassItsCallerToldAndTheNextCheckRunsOne(): Unit =
        runBlocking {
            // An error as an API the phone lacks raises one (santa's review).
            for (failure in listOf(IllegalStateException("its own failure"), NotImplementedError("an error"))) {
                val rig = rig()
                val lock = FakeLock(rig.clock)
                val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
                lock.failNextRead(failure)
                assertFailsWith(failure::class) { enforcer.check() }
                assertFalse(enforcer.updates.value.checked, "$failure")
                enforcer.check()
                assertTrue(enforcer.updates.value.checked, "$failure")
                rig.stop()
            }
        }

    @Test
    fun aLockThatThrowsInAPassTheRunMakesEndsOnlyThatPassTheRunGoesOnAndAnEmergencyUnlockAfterTakesTheLockOffAtOnce(): Unit =
        runBlocking {
            // Santa's review: no failure of the lock's ends the run, whose next pass an unlock needs.
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn()
            phone.until { it.locked }
            phone.lock.failNextRead()
            // A read of the truth heard a second later changes the state: the run's pass for it meets the throw.
            rig.clock.advance(1)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(200, Answer.me())
            eventually { phone.lock.throws == 1 }
            rig.engine.record(Change.Unlock("s", null))
            phone.until { !it.locked && it.until == null }
            assertFalse(phone.lock.holds)
        }

    @Test
    fun aPassTheLockCutsShortThrowingOrInACancelOfItsOwnIsFollowedAllTheSameByTheOneACallMadeMeanwhileAskedForAndOnlyTheLastPassesFailureIsTold(): Unit =
        runBlocking {
            // Santa's review: a call made during a pass the lock cuts short is never dropped. No run beside
            // it, so only the checks make passes.
            for (failure in listOf(IllegalStateException("its own failure"), CancellationException("its own timeout"))) {
                val rig = rig()
                rig.tapIn()
                val lock = FakeLock(rig.clock)
                val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
                enforcer.check()
                // A pass held at its second read of the lock, which throws once released.
                lock.hold(after = 1)
                val held = async { runCatching { enforcer.check() } }
                eventually { lock.holding }
                lock.failNextRead(failure)
                // The lock gone meanwhile, and a check made, which lands at once.
                lock.drop()
                withTimeoutOrNull(patience) { enforcer.check() } ?: fail("the check waited for the pass held on the lock")
                lock.release()
                // The pass it asked for ran after the one cut short, and put the lock back: no failure told.
                assertTrue(held.await().isSuccess, "$failure")
                assertEquals(1, lock.throws, "$failure")
                assertTrue(lock.holds, "$failure")
                assertTrue(enforcer.updates.value.locked, "$failure")
                rig.stop()
            }
        }

    @Test
    fun aLockThatThrowsInThePassAtTheLocksEndReachesNoHandlerOfTheAppsAndTheNextCheckRunsOne(): Unit =
        runBlocking {
            // Santa's review: the pass at the lock's end is the enforcer's own, as the run's are, so no
            // failure of the lock's there reaches the app's handler, which on Android ends the app.
            val uncaught = Collections.synchronizedList(mutableListOf<Throwable>())
            val rig = rig()
            rig.tapIn(session(endsAt = 1200))
            val lock = FakeLock(rig.clock)
            // A job of its own under the test's, so its calls and alarms can be seen to end.
            val own = Job(scope.coroutineContext.job)
            val handler = CoroutineExceptionHandler { _, failure -> uncaught += failure }
            val enforcer = Enforcer(rig.engine, lock, CoroutineScope(scope.coroutineContext + own + handler), rig.clock)
            enforcer.check()
            assertEquals(at(1200), lock.until)
            lock.failNextRead()
            rig.clock.advance(1200)
            eventually { lock.throws == 1 }
            eventually { own.children.all { it.children.none() } }
            assertEquals(emptyList(), uncaught.toList())
            enforcer.check()
            assertFalse(enforcer.updates.value.locked)
        }
}

/** The lock carries its own end, the bell's twin (ARCHITECTURE, "The bell needs no extension"): put on with it, and again as it moves. */
class LockEndTest : EngineFiles() {
    @Test
    fun theEndMovesWithARetapBackWithItsAnswerAndWithAnExtensionTheLockPutOnAgainEachTimeNeverTakenOff(): Unit =
        runBlocking {
            val rig = rig()
            val phone = enforced(rig)
            rig.tapIn(session(endsAt = 1200))
            phone.until { it.until == at(1200) }
            assertEquals(at(1200), phone.lock.until)
            // A re-tap not yet answered: its cap, the later.
            rig.engine.record(Change.Tap("tag"))
            phone.until { it.until == capped }
            assertEquals(capped, phone.lock.until)
            rig.server.next(tapRoute).reply(200, Answer.joined(session(endsAt = 1200)))
            phone.until { it.until == at(1200) }
            assertEquals(at(1200), phone.lock.until)
            // Extended: the check-in as the screen comes on names the new end.
            rig.screenOn(live = Answer.live(session(endsAt = 2400)))
            phone.until { it.until == at(2400) }
            assertEquals(at(2400), phone.lock.until)
            assertEquals(0, phone.lock.unlocks)
        }

    @Test
    fun aDebugBuildsShorterCapForThePhoneCheckIsTheOneATapIsLockedForAndBackToDecision7sTheLockFollowsAtOnce(): Unit =
        runBlocking {
            // BellTests' relaunchAndCap, its cap's half: the window it registers has no Android twin.
            val rig = rig()
            val phone = enforced(rig)
            val floor = Duration.ofMinutes(15)
            rig.engine.setTapCap(floor)
            assertEquals(floor, rig.engine.updates.value.cap)
            rig.engine.record(Change.Tap("tag"))
            phone.until { it.until == at(floor.seconds) }
            assertEquals(at(floor.seconds), phone.lock.until)
            rig.engine.setTapCap(null)
            phone.until { it.until == capped }
            assertEquals(capped, phone.lock.until)
            assertEquals(SyncState.TAP_CAP, rig.engine.updates.value.cap)
        }
}
