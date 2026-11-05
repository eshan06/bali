package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

/** In session s, as iOS's tests' `tapIn` leaves the phone (its answer the drain's, AN5b), in [state]. */
private fun inSession(state: ParticipationState) = Standing.InSession(session(), state)

/** A row this build can't read, which every read of the queue fails on while it is there: a storage failure that passes. */
suspend fun poison(outbox: Outbox, poisoned: Boolean = true) =
    outbox.execute(
        if (poisoned) {
            "INSERT INTO outbox (eventId, kind, sessionId, recordedAt, nextAttemptAt) " +
                "VALUES ('poison', 'protection_off', 's', 'garbage', 'garbage')"
        } else {
            "DELETE FROM outbox WHERE eventId = 'poison'"
        },
    )

/** The standing the file keeps, made unreadable: this build can't decode it. */
suspend fun spoilStanding(outbox: Outbox) = outbox.setState(Outbox.Key.Standing, "spoiled")

/** The engine's frame (AN5a): its start from the file, its calls, its run. No iOS twin but where named. */
class SyncEngineTest : EngineFiles() {
    @Test
    fun openedTheEngineStartsFromTheFileWhatItQueuedWhereProtectionOffWasReportedTheLastTapAndWhereThePhoneStood(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"), standing = inSession(ParticipationState.Focused))
            val off = record(outbox, Change.ProtectionOff("s"), standing = inSession(ParticipationState.ProtectionOff))
            val opened = engine(outbox).updates.value
            val read =
                SyncState(
                    standing = inSession(ParticipationState.ProtectionOff), queued = listOf(tap, off), reportedOff = "s",
                    lastTap = tap.eventId,
                )
            assertEquals(read, opened)
            // A queue it can't read is shown, never read as none, and the rest is read all the same.
            poison(outbox)
            assertEquals(read.copy(queued = emptyList(), link = Link.StorageFailed), engine(outbox).updates.value)
        }

    @Test
    fun aRecordWhoseCallerIsCancelledIsStillKeptAndSentTheCallerStopsWaitingAtOnceAndTheWriteGoesOn(): Unit =
        runBlocking {
            val held = HeldWrite()
            val outbox = open(temporaryFile(), driver = Watching(began = held.hold))
            outbox.keep(inSession(ParticipationState.Focused))
            val rig = rig(outbox)
            held.arm()
            val caller = launch(start = CoroutineStart.UNDISPATCHED) { rig.engine.record(Change.Unlock("s", null)) }
            held.began()
            // The screen goes: its call stops waiting at once, the write still under way.
            if (withTimeoutOrNull(5.seconds) { caller.cancelAndJoin() } == null) {
                held.release()
                fail("the cancelled caller waited for the write")
            }
            assertEquals(emptyList(), outbox.records())
            // The write goes on all the same: the Emergency Unlock is kept, acted on, and sent.
            held.release()
            val state = rig.until { it.queued.isNotEmpty() }
            assertEquals(listOf(Change.Unlock("s", null)), outbox.records().map { it.change })
            assertEquals(inSession(ParticipationState.Unlocked), state.standing)
            assertEquals(inSession(ParticipationState.Unlocked), outbox.standing())
            assertEquals(state.queued.single().eventId, rig.server.next(unlockRoute).eventId)
        }

    @Test
    fun aQueueReadThatFailsAfterARecordIsShownAndKeepsTheLastListWithTheRecordTheFileHoldsNow(): Unit =
        runBlocking {
            val (outbox, relaunches) = relaunching(temporaryFile())
            outbox.keep(inSession(ParticipationState.Focused))
            val rig = rig(outbox)
            poison(outbox)
            relaunches.watching = true
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            relaunches.watching = false
            // The phone acts on what it just did, whatever the read: its lock off, the unlock queued.
            val state = rig.engine.updates.value
            assertEquals(inSession(ParticipationState.Unlocked), state.standing)
            assertEquals(listOf(unlock), state.queued)
            assertEquals(Link.StorageFailed, state.link)
            // Shown after the record's own step, so no write since the record's keeps where the phone
            // stood before it (santa's review): a relaunch at any commit from the record's, the first
            // to stand unlocked, stands unlocked. (Room's own bookkeeping commits too, before it.)
            val relaunched = relaunches.engines.map { it.updates.value.standing }.dropWhile { it != inSession(ParticipationState.Unlocked) }
            assertTrue(relaunched.isNotEmpty())
            assertEquals(relaunched.map { inSession(ParticipationState.Unlocked) }, relaunched)
        }

    @Test
    fun callsAtOnceNeverInterleaveATapMadeWhileAnUnlockIsWritingSeesTheUnlockAndNeverKeepsTheLockOverIt(): Unit =
        runBlocking {
            // The lock that stands for Swift's actor (santa's review): without it, the tap reads the
            // standing the unlock's write is about to change, and keeps it over the unlock.
            val held = HeldWrite()
            val outbox = open(temporaryFile(), driver = Watching(began = held.hold))
            outbox.keep(inSession(ParticipationState.Focused))
            val rig = rig(outbox)
            held.arm()
            val unlock = async { rig.engine.record(Change.Unlock("s", null)) }
            held.began()
            val tap = async { rig.engine.record(Change.Tap("tag")) }
            // Time for the tap's call to reach the engine; it waits there, in the correct engine, for
            // the unlock's stretch, its state step included.
            delay(100)
            held.release()
            withTimeout(patience) { listOf(unlock, tap).awaitAll() }
            assertEquals(inSession(ParticipationState.Unlocked), rig.engine.updates.value.standing)
            assertEquals(inSession(ParticipationState.Unlocked), outbox.standing())
        }

    @Test
    fun whereThePhoneStandsUnreadIsNeverHandedToTheFileTheChangeKeptAndNothingWrittenOverTheFilesStanding(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            outbox.keep(inSession(ParticipationState.Focused))
            spoilStanding(outbox)
            val rig = rig(outbox)
            val unread = rig.engine.updates.value
            assertEquals(listOf(Standing.Unread, Link.StorageFailed), listOf(unread.standing, unread.link))
            // An Emergency Unlock made now, as the phone files one where it stands unread (B6b): were
            // Unread handed to its write, the write would be undone, the unlock with it.
            val unlock = assertNotNull(rig.engine.record(Change.UnlockUnfiled(null)))
            assertEquals(listOf(unlock), outbox.records())
            val state = rig.engine.updates.value
            assertEquals(Standing.Unread, state.standing)
            assertEquals(listOf(unlock), state.queued)
            // Nor did the run's first change, or the record's, keep it over the file's truth.
            assertEquals("spoiled", outbox.state(Outbox.Key.Standing))
        }

    @Test
    fun oneRunAtATimeARunBesideItReturnsAtOnceAndARunCancelledCanRunAgain(): Unit =
        runBlocking {
            val engine = engine(makeOutbox().first)
            val first = scope.launch(start = CoroutineStart.UNDISPATCHED) { engine.run() }
            withTimeout(patience) { engine.run() }
            assertTrue(first.isActive)
            // Cancelled, both its loops end.
            withTimeout(patience) { first.cancelAndJoin() }
            val again = scope.launch(start = CoroutineStart.UNDISPATCHED) { engine.run() }
            withTimeout(patience) { engine.run() }
            assertTrue(again.isActive, "a run cancelled can run again")
            withTimeout(patience) { again.cancelAndJoin() }
        }
}

/** The engine keeps its standing: StandingKeptTests, AN5a's to AN5d's parts (`docs/PLAN-ANDROID.md`). */
class StandingKeptTest : EngineFiles() {
    @Test
    fun theStandingIsKeptInTheFileAsItChangesWaitingTooAndAStateThisBuildDoesntKnowKeptAsNone(): Unit =
        runBlocking {
            // StandingKeptTests' `kept`.
            val rig = rig()
            assertEquals(Standing.Out, rig.outbox.standing())
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(200, Answer.armed)
            rig.until { it.standing == Standing.Waiting }
            assertEquals(Standing.Waiting, rig.outbox.standing())
            rig.tapIn()
            assertEquals(inSession(ParticipationState.Focused), rig.outbox.standing())
            // In a session the screen coming on checks in, and its answer names a state this build doesn't know.
            rig.screenOn(live = Answer.live(session(endsAt = 4000), state = "on_a_break"))
            assertEquals(Standing.InSession(session(endsAt = 4000), null), rig.outbox.standing())
        }

    @Test
    fun thePhonesOwnChangeAndTheStandingItLeavesAreKeptInOneWriteKilledAtAnyMomentAfterAnEmergencyUnlockARelaunchNeverLocksOverIt(): Unit =
        runBlocking {
            // StandingKeptTests' `keptWithItsStanding`, its lock check AN5e's.
            val changes =
                listOf(
                    Change.Unlock("s", null) to ParticipationState.Unlocked,
                    Change.ProtectionOff("s") to ParticipationState.ProtectionOff,
                )
            for ((change, state) in changes) {
                val (outbox, relaunches) = relaunching(temporaryFile())
                outbox.keep(inSession(ParticipationState.Focused))
                val rig = rig(outbox)
                relaunches.watching = true
                val record = assertNotNull(rig.engine.record(change))
                relaunches.watching = false
                val holding =
                    relaunches.engines.map { it.updates.value }.filter { relaunched -> relaunched.queued.any { it.eventId == record.eventId } }
                assertTrue(holding.isNotEmpty(), "$change")
                for (relaunched in holding) {
                    assertEquals(inSession(state), relaunched.standing, "$change")
                    assertNull(relaunched.shieldedUntil(t0), "$change")
                }
                rig.stop()
            }
        }

    @Test
    fun theStandingIsKeptInTheFileByEachChangesOwnWriteAndARelaunchStartsWhereTheLastLeftIt(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            outbox.keep(inSession(ParticipationState.Focused))
            val rig = rig(outbox)
            val changes =
                listOf(
                    Change.Unlock("s", UnlockReason.Nurse) to ParticipationState.Unlocked,
                    Change.Refocus("s") to ParticipationState.Focused,
                    Change.ProtectionOff("s") to ParticipationState.ProtectionOff,
                    // A tap leaves it where it stood: where it lands is its answer's (AN5b).
                    Change.Tap("tag") to ParticipationState.ProtectionOff,
                )
            for ((change, state) in changes) {
                rig.engine.record(change)
                val now = rig.engine.updates.value
                assertEquals(inSession(state), now.standing, "$change")
                assertEquals(inSession(state), outbox.standing(), "$change")
                // And in the same step, the rest as the file holds it: the queue, the report, the last tap.
                val held = listOf(outbox.records(), outbox.reportedOff(), outbox.lastTap())
                assertEquals(held, listOf(now.queued, now.reportedOff, now.lastTap), "$change")
            }
            rig.stop()
            assertEquals(inSession(ParticipationState.ProtectionOff), engine(open(file)).updates.value.standing)
        }

    @Test
    fun theStandingAnAnswerLeavesIsKeptInTheFileAndARelaunchStartsThere(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            val rig = rig(outbox)
            rig.tapIn()
            assertEquals(inSession(ParticipationState.Focused), outbox.standing())
            // A replay's: the state now, an unlock made since, in the session as it runs now.
            rig.engine.record(Change.Tap("tag"))
            val now = Standing.InSession(session(endsAt = 4000), ParticipationState.Unlocked)
            rig.server.next(tapRoute).reply(200, Answer.replay(session(endsAt = 4000), state = "unlocked"))
            rig.until { it.standing == now && it.queued.isEmpty() }
            assertEquals(now, outbox.standing())
            rig.stop()
            assertEquals(now, engine(open(file)).updates.value.standing)
        }

    @Test
    fun aStandingALaunchCouldNotKeepIsKeptAtItsFirstChangeFilingInTheSameWriteTheUnlockMadeWhereItStoodUnread(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            outbox.keep(inSession(ParticipationState.Focused))
            // The last run's Emergency Unlock, made where the phone stood unread: kept, not filed yet (B6b).
            val press = record(outbox, Change.UnlockUnfiled(UnlockReason.Nurse))
            val engine = engine(outbox)
            assertEquals(inSession(ParticipationState.Unlocked), engine.updates.value.standing)
            assertEquals(Change.UnlockUnfiled(UnlockReason.Nurse), current(outbox, press.eventId)?.change)
            // The first change, the run's: the standing kept, and the press filed in it, which then goes.
            val running = scope.launch { engine.run() }
            val filed = Change.Unlock("s", UnlockReason.Nurse)
            val state = withTimeout(patience) { engine.updates.first { it.queued.map { record -> record.change } == listOf(filed) } }
            assertEquals(inSession(ParticipationState.Unlocked), state.standing)
            assertEquals(filed, current(outbox, press.eventId)?.change)
            assertEquals(inSession(ParticipationState.Unlocked), outbox.standing())
            running.cancelAndJoin()
        }

    /** A relaunch whose file holds where the phone stood, focused until 1200 s, in a form this build can't read: its rig, and that standing. */
    private suspend fun unreadable(): Pair<Rig, Standing> {
        val (outbox, _) = makeOutbox()
        val kept = Standing.InSession(session(endsAt = 1200), ParticipationState.Focused)
        outbox.keep(kept)
        spoilStanding(outbox)
        return rig(outbox) to kept
    }

    @Test
    fun aStandingTheFileWouldNotGiveBackAtLaunchIsNeverWrittenOverFromNothingAndIsReadAgainWithinAMinute(): Unit =
        runBlocking {
            // The lock's half, its cover left as it was, is AN7's.
            val (rig, kept) = unreadable()
            val unread = rig.engine.updates.value
            assertEquals(listOf(Standing.Unread, Link.StorageFailed), listOf(unread.standing, unread.link))
            // The next change of state writes nothing over it: a read of the truth, unanswered. Were the
            // engine's own `Unread` check gone, its keeping would fail and say so instead.
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(null)
            rig.until { it.link == Link.Unreachable }
            assertEquals("spoiled", rig.outbox.state(Outbox.Key.Standing))
            // Readable again: read within a minute, and followed.
            rig.outbox.keep(kept)
            rig.sleeping(at(60))
            rig.clock.advance(60)
            rig.until { it.standing == kept }
            // And kept again as it changes.
            rig.engine.record(Change.Unlock("s", null))
            assertEquals(Standing.InSession(session(endsAt = 1200), ParticipationState.Unlocked), rig.outbox.standing())
        }

    @Test
    fun aStandingTheFileCantGiveBackIsSettledByTheServersTruthTooThePhoneIsNeverStrandedBehindIt(): Unit =
        runBlocking {
            // The class ended while the app was closed: the server has the phone in no session.
            val (rig, _) = unreadable()
            rig.screenOn(Answer.me(null))
            assertEquals(Standing.Out, rig.engine.updates.value.standing)
            assertEquals(Standing.Out, rig.outbox.standing())
        }

    @Test
    fun overAStandingNotReadATapAnsweredArmedAsksTheServerWhereThePhoneStandsArmingEndsNothing(): Unit =
        runBlocking {
            // The lock's half, its cover never taken off meanwhile, is AN7's.
            val (rig, _) = unreadable()
            rig.engine.record(Change.Tap("another teacher's"))
            rig.server.next(tapRoute).reply(200, Answer.armed)
            assertEquals(Standing.Unread, rig.until { it.queued.isEmpty() }.standing)
            rig.server.next(meRoute).reply(200, Answer.me(session(endsAt = 1200)))
            rig.until { it.standing == Standing.InSession(session(endsAt = 1200), ParticipationState.Focused) }
            // Known now, the standing carries the truth itself, as it would have without the gap: a read
            // naming no session later leaves the phone out.
            rig.clock.advance(1)
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.standing == Standing.Out }
        }

    @Test
    fun overAStandingNotReadATapAnsweredArmedLeavesThePhoneWaitingWhenTheReadOfTheTruthItAsksForNamesNoSession(): Unit =
        runBlocking {
            val (rig, _) = unreadable()
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(200, Answer.armed)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            assertEquals(Standing.Waiting, rig.until { it.standing != Standing.Unread }.standing)
            assertEquals(Standing.Waiting, rig.outbox.standing())
        }

    @Test
    fun andWhenTheFileGivesBackWhereThePhoneStoodBeforeThatReadComesTheArmingIsCarriedOntoItOutBecomesWaiting(): Unit =
        runBlocking {
            val (rig, _) = unreadable()
            rig.engine.record(Change.Tap("tag"))
            val tap = rig.server.next(tapRoute)
            // Readable again: the phone was in no session.
            rig.outbox.keep(Standing.Out)
            tap.reply(200, Answer.armed)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.standing == Standing.Waiting }
            assertEquals(Standing.Waiting, rig.outbox.standing())
        }

    @Test
    fun rule3sCheckRunsAtEachWakeWhileTheScreenIsOnTheReadAsItComesOnAndEachCheckInAndBeforeTheCheckInAsItGoesOffNeverWhileOff(): Unit =
        runBlocking {
            // Where iOS's going behind runs none, the screen going off runs it once, before its check-in.
            val checks = AtomicInteger()
            val rig = rig()
            rig.engine.atEachWake { checks.incrementAndGet() }
            rig.tapIn()
            assertEquals(0, checks.get())
            rig.screenOn()
            assertEquals(1, checks.get())
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            assertEquals(2, checks.get())
            checkIn.reply(200, Answer.live())
            rig.sleeping(at(60))
            rig.engine.setScreenOn(false)
            val off = rig.server.next(checkInRoute)
            assertEquals(3, checks.get())
            off.reply(200, Answer.live())
            rig.sleeping()
            rig.clock.advance(60)
            rig.sleeping()
            assertEquals(3, checks.get())
        }

    @Test
    fun aRunCancelledMidStretchFinishesItThePressItWasFilingFiledAndShownFiledAndItLetsGoOfTheRun(): Unit =
        runBlocking {
            // The run's first change writes the standing, filing the press: held once its write has
            // begun, while the run is cancelled.
            val held = HeldWrite()
            val outbox = open(temporaryFile(), driver = Watching(began = held.hold))
            outbox.keep(inSession(ParticipationState.Focused))
            val press = record(outbox, Change.UnlockUnfiled(null))
            val engine = engine(outbox)
            held.arm()
            val first = scope.launch { engine.run() }
            held.began()
            first.cancel()
            held.release()
            withTimeout(patience) { first.join() }
            // Finished all the same: the press filed, in the file and in the queue the screens read.
            val filed = Change.Unlock("s", null)
            assertEquals(filed, current(outbox, press.eventId)?.change)
            assertEquals(listOf(filed), engine.updates.value.queued.map { it.change })
            // And the engine let go of its run: one runs again.
            val again = scope.launch(start = CoroutineStart.UNDISPATCHED) { engine.run() }
            withTimeout(patience) { engine.run() }
            assertTrue(again.isActive)
            withTimeout(patience) { again.cancelAndJoin() }
        }
}

/** A loop's rings: Swift's `ring` and `pause`, which every loop of the engine waits on. */
class RingsTest {
    @Test
    fun aRingMadeWhileTheLoopIsBusyEndsItsNextPauseAtOnceHoweverManyOneWake(): Unit =
        runBlocking {
            val rings = Rings(TestClock())
            repeat(3) { rings.ring() }
            withTimeout(patience) { rings.pause(null) }
            assertNull(withTimeoutOrNull(100.milliseconds) { rings.pause(null) })
        }

    @Test
    fun aPauseEndsAtItsDeadlineByTheEnginesClockOrSoonerAtARingItsAlarmThenGone(): Unit =
        runBlocking {
            val clock = TestClock()
            val rings = Rings(clock)
            val paused = launch { rings.pause(at(10)) }
            eventually { clock.deadlines == listOf(at(10)) }
            clock.advance(9)
            assertEquals(listOf(at(10)), clock.deadlines)
            assertTrue(paused.isActive)
            clock.advance(1)
            withTimeout(patience) { paused.join() }
            val again = launch { rings.pause(at(20)) }
            eventually { clock.deadlines == listOf(at(20)) }
            rings.ring()
            withTimeout(patience) { again.join() }
            assertEquals(emptyList(), clock.deadlines)
        }

    @Test
    fun aPassesTopAnswersTheRingsMadeBeforeItItsPauseThenWaitsForTheNext(): Unit =
        runBlocking {
            val rings = Rings(TestClock())
            repeat(2) { rings.ring() }
            rings.answer()
            assertNull(withTimeoutOrNull(100.milliseconds) { rings.pause(null) })
            rings.ring()
            withTimeout(patience) { rings.pause(null) }
        }

    @Test
    fun anAlarmGoingOffAsARingEndsThePauseItsWakeRunLateLeavesNoRingForTheNextPauseNoEarlyCheckIn(): Unit =
        runBlocking {
            val clock = TestClock()
            val rings = Rings(clock)
            val paused = launch { rings.pause(at(30)) }
            eventually { clock.deadlines == listOf(at(30)) }
            // The alarm goes off, its wake run late, as a ring ends the pause.
            clock.advance(30, holdingWakes = true)
            rings.ring()
            withTimeout(patience) { paused.join() }
            clock.releaseWakes()
            assertNull(withTimeoutOrNull(100.milliseconds) { rings.pause(null) })
        }
}

/** What the engine knows: SyncState's own rules. */
class SyncStateTest {
    @Test
    fun aTapNotYetAnsweredIsTheNewestTapQueuedNotStuckAndAnUnlockNotFiledYetIsHeld() {
        val (first, unlock, second) = listOf(queued(Change.Tap("a")), queued(Change.Unlock("s", null)), queued(Change.Tap("b")))
        assertEquals(second, SyncState(queued = listOf(first, unlock, second)).pendingTap)
        assertEquals(first, SyncState(queued = listOf(first, unlock, second.copy(stuck = true))).pendingTap)
        assertNull(SyncState(queued = listOf(first.copy(stuck = true), unlock)).pendingTap)
        assertFalse(SyncState(queued = listOf(first, unlock)).holdsUnfiled)
        assertTrue(SyncState(queued = listOf(unlock, queued(Change.UnlockUnfiled(null)))).holdsUnfiled)
    }
}
