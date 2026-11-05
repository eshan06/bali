package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.UnlockReason
import java.time.Duration
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** In session s, ending [endsAt] seconds after [t0], in [state]. */
private fun inSession(state: ParticipationState?, endsAt: Long = 3000) = Standing.InSession(session(endsAt = endsAt), state)

private val focused = inSession(ParticipationState.Focused)
private val unlocked = inSession(ParticipationState.Unlocked)

/** The check-ins and the reads of the truth. BaliOutbox's ReadTests, all but `waitingStays` (AN5d's). */
class ReadTest : EngineFiles() {
    @Test
    fun theCheckInRunsEvery30SecondsWhileTheScreenIsOnOnceAsItGoesOnOrOffAndNeverWhileItIsOff(): Unit =
        runBlocking {
            // The battery plan: where iOS's coming back reads the truth and its going behind sends nothing.
            val rig = rig()
            rig.tapIn()
            rig.engine.setScreenOn(true)
            val on = rig.server.next()
            assertEquals(listOf(checkInRoute, wire(t0)), listOf(on.route, on.deviceTime))
            on.reply(200, Answer.live())
            rig.sleeping(at(30))
            rig.clock.advance(30)
            val first = rig.server.next()
            assertEquals(listOf(checkInRoute, wire(at(30))), listOf(first.route, first.deviceTime))
            first.reply(200, Answer.live())
            rig.sleeping(at(60))
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            rig.sleeping(at(90))
            // The screen off: one check-in, at once; then nothing, however long.
            rig.engine.setScreenOn(false)
            val off = rig.server.next(checkInRoute)
            assertEquals(wire(at(60)), off.deviceTime)
            off.reply(200, Answer.live())
            rig.sleeping()
            rig.clock.advance(600)
            assertEquals(emptyList(), rig.server.waiting)
            // On again: a check-in at once, then every 30 s again.
            rig.engine.setScreenOn(true)
            val again = rig.server.next(checkInRoute)
            assertEquals(wire(at(660)), again.deviceTime)
            again.reply(200, Answer.live())
            rig.sleeping(at(690))
            assertEquals(emptyList(), rig.server.waiting)
        }

    @Test
    fun theScreensOwnCheckInGoesBeforeAReadAskedForAndTheReadAtOnceAfterIt(): Unit =
        runBlocking {
            // A read of the truth that got no answer waits for the next wake: the screen going off.
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(null)
            rig.until { it.meFailed != null }
            rig.engine.setScreenOn(false)
            val checkIn = rig.server.next()
            assertEquals(checkInRoute, checkIn.route)
            checkIn.reply(200, Answer.live())
            assertEquals(meRoute, rig.server.next().route)
        }

    @Test
    fun theScreenComingOnRingsTheDrainTooARecordDueByThePhonesClockGoesAtOnceThoughItsAlarmRunsLate(): Unit =
        runBlocking {
            // As iOS's coming back does: on a phone, the drain's wait counts no deep sleep.
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute).reply(503)
            rig.sleeping(at(2))
            rig.clock.advance(2, holdingWakes = true)
            rig.engine.setScreenOn(true)
            assertEquals(tap.eventId, rig.server.next(tapRoute).eventId)
            rig.clock.releaseWakes()
        }

    @Test
    fun theScreenGoingOffChecksInOnceInASessionRule3sCheckAndItsReportFirstThenNothingAndOutOfASessionNothingAtAll(): Unit =
        runBlocking {
            // The battery plan: nothing while the screen is off but its one check-in.
            val checks = AtomicInteger()
            val switchedOff = AtomicBoolean(false)
            val rig = rig()
            rig.engine.atEachWake {
                checks.incrementAndGet()
                if (switchedOff.get()) rig.engine.record(Change.ProtectionOff("s"))
            }
            // Out of a session, its going off runs nothing: the next request is the read Bali coming to the
            // front asks for, no check run before it.
            rig.screenOn(Answer.me(null))
            rig.engine.setScreenOn(false)
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            assertEquals(1, checks.get())
            // In one: the lock found switched off as the screen goes off is reported, and the check-in goes
            // after the check, at once.
            rig.tapIn()
            rig.screenOn()
            switchedOff.set(true)
            rig.engine.setScreenOn(false)
            val report = rig.server.next(protectionOffRoute)
            val checkIn = rig.server.next(checkInRoute)
            assertEquals(listOf(3, wire(t0)), listOf(checks.get(), checkIn.deviceTime))
            report.reply(200, Answer.protectionOff())
            checkIn.reply(200, Answer.live(state = "protection_off"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            rig.sleeping()
            rig.clock.advance(600)
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(3, checks.get())
        }

    @Test
    fun anAlarmWhoseRingComesLateAfterAnotherRingHasWokenTheReadLoopRingsNothingNoReadGoesEarlyAndTheCheckInsKeepTheirCadence(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.sleeping(at(30))
            // The check-in's alarm goes off as Bali comes to the front, and its ring runs late: after the
            // read of the truth coming to the front makes has gone.
            rig.clock.advance(30, holdingWakes = true)
            rig.engine.setInFront(true)
            val read = rig.server.next(meRoute)
            rig.clock.releaseWakes()
            read.reply(200, Answer.me())
            rig.sleeping(at(60))
            rig.clock.advance(30)
            val next = rig.server.next()
            assertEquals(listOf(checkInRoute, wire(at(60))), listOf(next.route, next.deviceTime))
            next.reply(200, Answer.live())
        }

    @Test
    fun aReadAskedForWhileAWakeRunsIsTheNextWakesAtOnceAndLeavesNoEarlyCheckInAfterIt(): Unit =
        runBlocking {
            // Each pass takes what its rings rang for at its top. iOS's takes a read asked for during rule
            // 3's check in that pass, and the ring left behind wakes it once more, a check-in 30 s early.
            val checking = CompletableDeferred<Unit>()
            val held = CompletableDeferred<Unit>()
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.engine.atEachWake {
                checking.complete(Unit)
                held.await()
            }
            rig.clock.advance(30)
            withTimeout(patience) { checking.await() }
            rig.engine.setInFront(true)
            held.complete(Unit)
            val checkIn = rig.server.next()
            assertEquals(checkInRoute, checkIn.route)
            checkIn.reply(200, Answer.live())
            val read = rig.server.next()
            assertEquals(meRoute, read.route)
            read.reply(200, Answer.me())
            rig.sleeping(at(60))
            assertEquals(emptyList(), rig.server.waiting)
        }

    @Test
    fun aCheckThatThrowsOrEndsInACancelOfItsOwnCheckedNothingSoThatWakeSendsNoCheckInAndTheLoopGoesOn(): Unit =
        runBlocking {
            // Its contract says it never does (`atEachWake`): rule 3, a check-in claims only what was checked.
            for (fails in listOf<suspend () -> Unit>({ throw CancellationException("its own") }, { error("broken") })) {
                val failing = AtomicBoolean(false)
                val rig = rig()
                rig.engine.atEachWake { if (failing.get()) fails() }
                rig.tapIn()
                rig.screenOn()
                failing.set(true)
                rig.clock.advance(30)
                rig.sleeping(at(60))
                assertEquals(emptyList(), rig.server.waiting)
                failing.set(false)
                rig.clock.advance(30)
                rig.server.next(checkInRoute).reply(200, Answer.live())
                rig.stop()
            }
        }

    @Test
    fun aRunCancelledWhileItsReadOfTheTruthIsOnItsWayLeavesTheReadToTheNextRunAsIOSsNoAnswerDoes(): Unit =
        runBlocking {
            val rig = rig()
            rig.engine.retryNow()
            rig.server.next(meRoute)
            withTimeout(patience) { rig.running.cancelAndJoin() }
            val again = scope.launch { rig.engine.run() }
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.meReads == 1 }
            withTimeout(patience) { again.cancelAndJoin() }
        }

    @Test
    fun aReadOfTheTruthAskedForWhileTheStampCantBeReadGoesAtTheNextWakeOnceItCan(): Unit =
        runBlocking {
            val rig = rig()
            rig.screenOn(Answer.me(null))
            rig.outbox.execute("ALTER TABLE outbox RENAME TO gone")
            rig.engine.setInFront(true)
            rig.until { it.link == Link.StorageFailed }
            // The read loop's next wake, and the drain's look again within a minute.
            rig.sleeping(at(30), at(60))
            assertEquals(emptyList(), rig.server.waiting)
            rig.outbox.execute("ALTER TABLE gone RENAME TO outbox")
            rig.clock.advance(30)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.link == Link.Reached }
        }

    @Test
    fun balisOwnScreenGoingBehindSendsAnUnlockHeldForItsReasonAtOnceForNoReasonIsComing(): Unit =
        runBlocking {
            // C5a. iOS's ReasonTests' `movesOn`, through the press and its words, is AN5e's.
            val rig = rig()
            rig.tapIn()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null), hold = Duration.ofSeconds(15)))
            rig.sleeping(at(15))
            assertEquals(emptyList(), rig.server.waiting)
            rig.engine.setInFront(false)
            assertEquals(unlock.eventId, rig.server.next(unlockRoute).eventId)
            assertEquals(t0, rig.clock.now())
        }

    @Test
    fun aReadOfTheTruthThatGetsNoAnswerIsTriedAgainAtTheNextWakeNotAtOnce(): Unit =
        runBlocking {
            val rig = rig()
            rig.engine.setScreenOn(true)
            rig.server.next(meRoute).reply(null)
            rig.sleeping(at(30))
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(Link.Unreachable, rig.engine.updates.value.link)
            rig.clock.advance(30)
            rig.server.next(meRoute).reply(200, Answer.me())
            rig.until { it.standing == focused }
        }

    @Test
    fun anOutboxTheCheckInCantStampFromIsShownAndNoReadIsMadeUntilItCanBe(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.outbox.execute("ALTER TABLE outbox RENAME TO gone")
            rig.clock.advance(30)
            rig.until { it.link == Link.StorageFailed }
            rig.sleeping(at(60))
            assertEquals(emptyList(), rig.server.waiting)
            rig.outbox.execute("ALTER TABLE gone RENAME TO outbox")
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            rig.until { it.link == Link.Reached }
        }

    @Test
    fun outOfASessionThereIsNothingToCheckInToTheScreenComingOnReadsTheTruthOnce(): Unit =
        runBlocking {
            val rig = rig()
            rig.screenOn(Answer.me(null))
            rig.clock.advance(90)
            rig.sleeping(at(120))
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(Standing.Out, rig.engine.updates.value.standing)
        }

    @Test
    fun aCheckInAnswersTheTruthAnExtensionAndAStateTheGridSawFirstApplied(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt = 4000), state = "protection_off"))
            val state = rig.until { it.standing != focused }
            assertEquals(inSession(ParticipationState.ProtectionOff, endsAt = 4000), state.standing)
        }

    @Test
    fun aCheckInFindingNothingLiveThereOrNoSuchSessionReadsTheTruthAgain(): Unit =
        runBlocking {
            for ((status, body) in listOf(200 to Answer.gone, 404 to Answer.refused("session_not_found"))) {
                val rig = rig()
                rig.tapIn()
                rig.screenOn()
                rig.clock.advance(30)
                rig.server.next(checkInRoute).reply(status, body)
                rig.server.next(meRoute).reply(200, Answer.me(session("t"), state = "unlocked"))
                rig.until { it.standing == Standing.InSession(session("t"), ParticipationState.Unlocked) }
                rig.stop()
            }
        }

    @Test
    fun getMesStatesSilenceIsStillFocusEndedIsOutAndAStateThisBuildDoesntKnowIsNeverFocus(): Unit =
        runBlocking {
            val states =
                listOf(
                    "silent" to focused,
                    "unlocked" to unlocked,
                    "protection_off" to inSession(ParticipationState.ProtectionOff),
                    "ended" to Standing.Out,
                    "on_a_break" to inSession(null),
                )
            for ((state, standing) in states) {
                val rig = rig()
                rig.screenOn(Answer.me(session(), state = state))
                assertEquals(standing, rig.engine.updates.value.standing, state)
                rig.stop()
            }
        }
}

/** The reconcile: no read overrides a newer change. BaliOutbox's StaleReadTests, AN5c's part. */
class StaleReadTest : EngineFiles() {
    @Test
    fun theRaceOf56ACheckInReadBeforeAnUnlockAndAnsweredAfterItIsNeverApplied(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            rig.engine.record(Change.Unlock("s", null))
            val unlock = rig.server.next(unlockRoute)
            // It read focused before the unlock: stale, and ignored.
            checkIn.reply(200, Answer.live())
            rig.sleeping(at(60))
            assertEquals(unlocked, rig.engine.updates.value.standing)
            unlock.reply(200, Answer.unlocked())
            assertEquals(unlocked, rig.until { it.queued.isEmpty() }.standing)
        }

    @Test
    fun aReadSentWhileAChangeAwaitedItsAnswerIsStaleEvenOnceThatAnswerHasCome(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            rig.engine.record(Change.Unlock("s", null))
            val unlock = rig.server.next(unlockRoute)
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            unlock.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
            checkIn.reply(200, Answer.live(session(endsAt = 4000)))
            rig.sleeping(at(60))
            assertEquals(unlocked, rig.engine.updates.value.standing)
            // The next check-in, sent with nothing awaiting, reconciles.
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt = 4000)))
            rig.until { it.standing == inSession(ParticipationState.Focused, endsAt = 4000) }
        }

    @Test
    fun theUnlockGuardStuckAnUnlockHoldsNoReadButNoneTurnsItsSessionsLockBackOnTheWindowAndTheEndStillApply(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", UnlockReason.Nurse))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            assertEquals(0, rig.outbox.awaiting())
            // Focused, and extended: the window applies, the focus doesn't.
            rig.screenOn(live = Answer.live(session(endsAt = 4000)))
            assertEquals(inSession(ParticipationState.Unlocked, endsAt = 4000), rig.engine.updates.value.standing)
            // (The stuck unlock goes again as the clock moves, and is left unanswered.)
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt = 4000)))
            rig.sleeping(at(60))
            assertEquals(inSession(ParticipationState.Unlocked, endsAt = 4000), rig.engine.updates.value.standing)
            // The session over: that applies, and the unlock stays queued, never discarded.
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.gone)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.standing == Standing.Out }
            assertTrue(rig.outbox.holdsUnlock("s"))
        }

    @Test
    fun butARefocusTheStudentMadeSinceTheStuckUnlockStandsAReadAgreeingWithItApplies(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            rig.engine.record(Change.Refocus("s"))
            assertEquals(focused, rig.engine.updates.value.standing)
            rig.screenOn(live = Answer.live(session(endsAt = 4000)))
            assertEquals(inSession(ParticipationState.Focused, endsAt = 4000), rig.engine.updates.value.standing)
        }
}

/**
 * The unlock guard in a change's answer, AN5b's note: an answer naming focus never puts the lock back on
 * over an Emergency Unlock the server hasn't recorded, nor does a read after it. No iOS twin but its rule.
 */
class UnlockGuardTest : EngineFiles() {
    @Test
    fun anAnswerNamingFocusNeverPutsTheLockBackOverAnEmergencyUnlockTheServerRefused(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            focusNamed(rig)
        }

    @Test
    fun butAReTapMadeAfterAStuckUnlockIsTheStudentsReturnItsAnswerPutsTheLockBackOnTheUnlockStillQueued(): Unit =
        runBlocking {
            // A13: an unlock made before the student's own return, by the phone's order, holds nothing back.
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(200, Answer.joined())
            rig.until { it.standing == focused && it.queued.size == 1 }
            assertTrue(rig.outbox.holdsUnlock("s"))
        }

    @Test
    fun norOverOneStuckAfterEightAnswersThatLeftItUnsettled(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            // Each after its backoff: 2 s, 4 s, 8 s… up to a minute (the jitter fixed at none).
            var due = 0L
            for (wait in listOf(2L, 4, 8, 16, 32, 60, 60)) {
                rig.server.next(unlockRoute).reply(503)
                due += wait
                rig.until { it.retryAt == at(due) }
                rig.clock.advance(wait)
            }
            rig.server.next(unlockRoute).reply(503)
            assertEquals(listOf(listOf(8, true)), rig.until { it.queued.singleOrNull()?.answers == 8 }.queued.map { listOf(it.answers, it.stuck) })
            focusNamed(rig)
        }

    @Test
    fun norOverOneMadeWhereThePhoneStoodUnreadWhichTheAnswerFilesThereWithTheStandingItLeaves(): Unit =
        runBlocking {
            // The last run's report, still queued, and where the phone stood unreadable: the press is
            // kept unfiled (B6b) until an answer says where the phone stands.
            val (outbox, _) = makeOutbox()
            outbox.keep(focused)
            record(outbox, Change.ProtectionOff("s"))
            spoilStanding(outbox)
            val rig = rig(outbox)
            val report = rig.server.next(protectionOffRoute)
            val press = assertNotNull(rig.engine.record(Change.UnlockUnfiled(null)))
            report.reply(200, Answer.replay(state = "focused"))
            assertEquals(unlocked, rig.until { it.standing != Standing.Unread }.standing)
            assertEquals(unlocked, outbox.standing())
            assertEquals(Change.Unlock("s", null), current(outbox, press.eventId)?.change)
            assertEquals(press.eventId, rig.server.next(unlockRoute).eventId)
        }

    @Test
    fun aReadOfTheFileThatFailsInsideTheGuardKeepsThePhoneUnlockedItsFailureShowingAfterTheStepNeverHiddenByIt(): Unit =
        runBlocking {
            // iOS's `answered` shows it, then hides it again with the state it copied before (#500's worker).
            val refusing = AtomicBoolean(false)
            val outbox = open(temporaryFile(), driver = Watching(stepping = { if (refusing.get() && HOLDS_UNLOCK in it) throw SQLiteException("refused") }))
            val rig = rig(outbox)
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            refusing.set(true)
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute).reply(200, Answer.replay(state = "focused"))
            // The drain's next pause, the stuck unlock's backoff, comes once that answer's stretch is done.
            rig.sleeping(at(2))
            var state = rig.engine.updates.value
            assertEquals(listOf(unlocked, Link.StorageFailed), listOf(state.standing, state.link))
            // A read's guard, the same: the read's own answer said heard, the failure after it.
            rig.screenOn()
            state = rig.engine.updates.value
            assertEquals(listOf(unlocked, Link.StorageFailed), listOf(state.standing, state.link))
            refusing.set(false)
        }

    /** A later report's answer naming focus there, then a read naming it: neither puts the lock back on. */
    private suspend fun focusNamed(rig: Rig) {
        rig.engine.record(Change.ProtectionOff("s"))
        rig.server.next(protectionOffRoute).reply(200, Answer.replay(state = "focused"))
        assertEquals(unlocked, rig.until { state -> state.queued.none { it.change is Change.ProtectionOff } }.standing)
        rig.screenOn()
        assertEquals(unlocked, rig.engine.updates.value.standing)
        assertTrue(rig.outbox.holdsUnlock("s"))
    }

    private companion object {
        /** The unlock guard's read of the file, `Outbox.holdsUnlock`'s SQL. */
        const val HOLDS_UNLOCK = "SELECT 1 FROM outbox WHERE kind = 'unlock' AND COALESCE(orderSeq, seq) > ?"
    }
}

/** The classes, from the read of the truth (C3). BaliOutbox's ClassesTests, AN5c's part. */
class ClassesTest : EngineFiles() {
    @Test
    fun theClassesComeWithTheReadOfTheTruthNotKnownUntilOneAnswersNoneIsNoClassesAndSomeTheirTeachersNamedIsInClass(): Unit =
        runBlocking {
            val rig = rig()
            assertNull(rig.engine.updates.value.hasClasses)
            rig.screenOn(Answer.me(null))
            assertEquals(false, rig.engine.updates.value.hasClasses)
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"))))
            val state = rig.until { it.hasClasses == true }
            assertEquals("Ms. Rivera", state.me?.classes?.first()?.teacher?.displayName)
        }

    @Test
    fun aReadOfTheTruthThatGivesNoAnswerLeavesTheClassesAsTheyWereUnknownTooNeverNoneAndSaysWhyUntilOneAnswers(): Unit =
        runBlocking {
            // None came, a status, a body this build can't read (rule 5).
            val rig = rig()
            rig.engine.setScreenOn(true)
            rig.server.next(meRoute).reply(null)
            var state = rig.until { it.meFailed != null }
            assertEquals(listOf(SendResult.NetworkError, null), listOf(state.meFailed, state.hasClasses))
            // Each waits for the loop's sleep first: the time moved before it, the wake would slip.
            rig.sleeping(at(30))
            rig.clock.advance(30)
            rig.server.next(meRoute).reply(503)
            state = rig.until { it.meFailed == SendResult.Status(503) }
            assertNull(state.hasClasses)
            rig.sleeping(at(60))
            rig.clock.advance(30)
            rig.server.next(meRoute).reply(200, "{}")
            state = rig.until { it.meFailed == SendResult.Status(200) }
            // None of them a read that gave `me` (L8c's `meReads`).
            assertEquals(0, state.meReads)
            rig.sleeping(at(90))
            rig.clock.advance(30)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            state = rig.until { it.meFailed == null }
            assertEquals(listOf<Any?>(false, 1), listOf(state.hasClasses, state.meReads))
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(null)
            state = rig.until { it.meFailed != null }
            assertEquals(false, state.hasClasses)
        }

    @Test
    fun outOfASessionInAClassTheTruthIsReadAtEachWakeWhileTheScreenIsOnAndWithItOffOrInNoClassNothing(): Unit =
        runBlocking {
            // C3c: so Home says a class of theirs is in session (its card is AN10's).
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = listOf(Answer.inClass("c"))))
            assertEquals(Standing.Out, rig.engine.updates.value.standing)
            rig.clock.advance(30)
            val live = """{"id":"c","name":"Class c","teacher":{"displayName":null},"liveSession":{"id":"s","endsAt":"${wire(at(4000))}"}}"""
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(live)))
            val state = rig.until { it.me?.classes?.firstOrNull()?.liveSession != null }
            assertEquals(Standing.Out, state.standing)
            rig.engine.setScreenOn(false)
            rig.clock.advance(30)
            rig.sleeping()
            rig.clock.advance(600)
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
            val none = rig()
            none.screenOn(Answer.me(null))
            none.clock.advance(30)
            none.sleeping(at(60))
            assertEquals(emptyList(), none.server.waiting)
        }

    @Test
    fun aReadsClassesApplyThoughItsStandingMayNotForNoChangeOfThePhonesMovesTheClassesOnlyAJoinDoes(): Unit =
        runBlocking {
            // A change of the phone's awaits its answer, so the read may be older than it.
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            val unlock = rig.server.next(unlockRoute)
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(session(endsAt = 4000), classes = listOf(Answer.inClass("c"))))
            val state = rig.until { it.me != null }
            assertEquals(listOf<Any?>(true, unlocked), listOf(state.hasClasses, state.standing))
            unlock.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
        }

    @Test
    fun outNotWaitingAReadNamingASessionItsClockSaysIsOverStillTakesItTheCheckInFindsItGone(): Unit =
        runBlocking {
            // Only a waiting phone's wait is kept from it (AN5d's).
            val rig = rig()
            rig.screenOn(Answer.me(session(endsAt = -60)))
            assertEquals(inSession(ParticipationState.Focused, endsAt = -60), rig.engine.updates.value.standing)
        }
}

/**
 * Protection off reported again: the engine's half of BaliOutbox's ProtectionOffTests' `reportedAgain`
 * and `onlyFocusAgain`, the check that finds it AN7's, its record made here by hand.
 */
class ProtectionOffTest : EngineFiles() {
    /** In a session, the screen on: protection off found and reported, the report landed. */
    private suspend fun reported(rig: Rig): OutboxRecord {
        rig.tapIn()
        rig.screenOn()
        val report = assertNotNull(rig.engine.record(Change.ProtectionOff("s")))
        rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
        return report
    }

    @Test
    fun reportedThereAReadSayingThePhoneIsFocusedThereAgainAnOlderReTapLandedHasItReportedAgain(): Unit =
        runBlocking {
            // A13's rider.
            val rig = rig()
            val first = reported(rig)
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live())
            rig.until { it.standing == focused }
            val again = assertNotNull(rig.engine.record(Change.ProtectionOff("s")))
            assertNotEquals(first.eventId, again.eventId)
            assertEquals(again.eventId, rig.server.next(protectionOffRoute).eventId)
        }

    @Test
    fun reportedThereOnlyFocusReportsItAgainAnUnlockMadeSinceReportsNothingNewAndKeepsNothingEither(): Unit =
        runBlocking {
            val rig = rig()
            reported(rig)
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            assertEquals(unlocked, rig.engine.updates.value.standing)
            // Queuing nothing, it keeps nothing either: the file stands where the phone does.
            assertNull(rig.engine.record(Change.ProtectionOff("s")))
            assertEquals(unlocked, rig.outbox.standing())
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
        }
}
