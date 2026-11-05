package com.bali.outbox

import com.bali.core.BlockRead
import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/**
 * Emergency Unlock over a standing the file won't give back (B6b): the engine's half of BaliOutbox's
 * UnreadUnlockTests but `filing` (StandingTest's). The lock's half, the last run's lock and `unlockedLast`,
 * is AN7's, with `leftByTheLastRun`; iOS's monitor has no Android twin.
 */
class UnreadUnlockTest : EngineFiles() {
    private val kept = Standing.InSession(session(endsAt = 1200), ParticipationState.Focused)
    private val unlocked = kept.copy(state = ParticipationState.Unlocked)

    /** A rig over [outbox], whose file holds where the phone stood, [kept], in a form this build can't read. */
    private suspend fun unreadable(outbox: Outbox = makeOutbox().first): Rig {
        outbox.keep(kept)
        spoilStanding(outbox)
        return rig(outbox)
    }

    @Test
    fun noTapPendingItIsKeptSentNowhereHoldingBackNothingGuardingEverySessionNothingWrittenOverTheFilesStandingUntilThePhoneKnowsWhereItStands(): Unit =
        runBlocking {
            val rig = unreadable()
            val unlock = assertNotNull(rig.engine.emergencyUnlock(UnlockReason.Nurse))
            assertEquals(Change.UnlockUnfiled(UnlockReason.Nurse), unlock.change)
            assertNull(unlock.request)
            val state = rig.engine.updates.value
            assertEquals(Standing.Unread, state.standing)
            assertEquals(listOf(unlock.eventId), state.queued.map { it.eventId })
            // Nothing the drain could send: so nothing went.
            assertEquals(Outbox.Due.Idle, rig.outbox.nextDue(rig.clock.now()))
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(0, rig.outbox.awaiting())
            assertTrue(rig.outbox.holdsUnlock("s") && rig.outbox.holdsUnlock("t"))
            assertEquals("spoiled", rig.outbox.state(Outbox.Key.Standing))
            // A tap made after it goes at once.
            rig.engine.tap(BlockRead.Block("T7XK2M9QPF"))
            rig.server.next(tapRoute).reply(null)
        }

    @Test
    fun underTheTapNotYetAnsweredAsDecision11FilesItItEndsThatTapsLockToo(): Unit =
        runBlocking {
            val rig = unreadable()
            val tap = assertNotNull(rig.engine.tap(BlockRead.Block("T7XK2M9QPF")))
            val held = rig.server.next(tapRoute)
            assertNotNull(rig.engine.updates.value.shieldedUntil(t0))
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            assertEquals(Change.UnlockUnderTap(tap.eventId, null), unlock.change)
            assertNull(rig.engine.updates.value.shieldedUntil(t0))
            held.reply(null)
        }

    @Test
    fun onceTheFileGivesBackWhereThePhoneStoodTheUnlockIsFiledThereInTheWriteThatKeepsItAndSentThePhoneUnlockedThereNeverLocked(): Unit =
        runBlocking {
            val (outbox, relaunches) = relaunching(temporaryFile())
            val rig = unreadable(outbox)
            val unlock = assertNotNull(rig.engine.emergencyUnlock(UnlockReason.Bathroom))
            outbox.keep(kept)
            // A relaunch at every commit from here never stands focused beside the unlock.
            relaunches.watching = true
            rig.sleeping(at(60))
            rig.clock.advance(60)
            val sent = rig.server.next(unlockRoute)
            relaunches.watching = false
            assertEquals(unlock.eventId, sent.eventId)
            assertEquals(listOf(unlocked, unlocked), listOf(rig.engine.updates.value.standing, rig.outbox.standing()))
            assertTrue(relaunches.engines.isNotEmpty())
            for (engine in relaunches.engines) assertNull(engine.updates.value.shieldedUntil(at(60)))
            sent.reply(200, Answer.unlocked(session(endsAt = 1200)))
            assertEquals(unlocked, rig.until { it.queued.isEmpty() }.standing)
        }

    @Test
    fun onceTheServerNamesTheSessionAReadSayingFocusedThereLeavesThePhoneUnlockedAndTheUnlockIsFiledThereAndSent(): Unit =
        runBlocking {
            val rig = unreadable()
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            val view = session(endsAt = 4000)
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(view))
            val sent = rig.server.next(unlockRoute)
            assertEquals(unlock.eventId, sent.eventId)
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.engine.updates.value.standing)
            sent.reply(200, Answer.unlocked(view))
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.until { it.queued.isEmpty() }.standing)
        }

    @Test
    fun whenTheTruthNamesNoSessionItGoesUnderThePhonesLastTapWhichTheServerFilesWhereThatTapLandedOrKeepsWithNoClassNeverDiscarded(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("T7XK2M9QPF"))
            send(outbox, tap, 200, Answer.joined(session(endsAt = 1200)))
            val rig = unreadable(outbox)
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            // The class ended while the file couldn't say so: the student is in none.
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            val sent = rig.server.next(underTapRoute(tap))
            assertEquals(unlock.eventId, sent.eventId)
            sent.reply(200, Answer.unlockAfterEnd(session(endsAt = 1200)))
            assertEquals(Standing.Out, rig.until { it.queued.isEmpty() }.standing)
        }

    @Test
    fun withNoTapKnownAndNoSessionNamedItWaitsKeptNeverSentAndALaterTruthNamingOneFilesItThereATapTheStudentMakesAfterIt(): Unit =
        runBlocking {
            val rig = unreadable()
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(null))
            val out = rig.until { it.standing == Standing.Out }
            assertEquals(listOf(Change.UnlockUnfiled(null)), out.queued.map { it.change })
            assertEquals(Outbox.Due.Idle, rig.outbox.nextDue(rig.clock.now()))
            val view = session("t", endsAt = 4000)
            rig.engine.tap(BlockRead.Block("T7XK2M9QPF"))
            rig.server.next(tapRoute).reply(200, Answer.joined(view))
            val sent = rig.server.next("POST /v1/sessions/t/unlock")
            assertEquals(unlock.eventId, sent.eventId)
            sent.reply(200, Answer.unlockSuperseded(view))
            assertEquals(Standing.InSession(view, ParticipationState.Focused), rig.until { it.queued.isEmpty() }.standing)
        }

    @Test
    fun keptAcrossARelaunchTheFileStillUnreadItStaysAndTheFileReadAgainTheNextLaunchStandsUnlockedWhereThePhoneStoodAndFilesAndSendsIt(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            val first = unreadable(outbox)
            val unlock = assertNotNull(first.engine.emergencyUnlock())
            first.stop()
            val second = rig(open(file))
            val unread = second.engine.updates.value
            assertEquals(listOf(Standing.Unread, listOf(unlock.eventId)), listOf(unread.standing, unread.queued.map { it.eventId }))
            second.stop()
            outbox.keep(kept)
            val third = rig(open(file))
            assertEquals(unlock.eventId, third.server.next(unlockRoute).eventId)
            assertEquals(unlocked, third.engine.updates.value.standing)
        }

    @Test
    fun anUnlockTheLastRunLeftStuckAnsweredAtLastRecordedLateLocksNothingOverThePressNotFiledYetWhichIsFiledThereAndSent(): Unit =
        runBlocking {
            // #95's Claude Review.
            val (outbox, _) = makeOutbox()
            val stuck = record(outbox, Change.Unlock("s", null))
            send(outbox, stuck, 400, Answer.refused("invalid_request"))
            val rig = unreadable(outbox)
            val press = assertNotNull(rig.engine.emergencyUnlock())
            eventually { rig.clock.deadlines.contains(at(2)) }
            rig.clock.advance(2)
            val view = session(endsAt = 1200)
            rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded(view))
            val sent = rig.server.next(unlockRoute)
            assertEquals(press.eventId, sent.eventId)
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.engine.updates.value.standing)
            // Refused, the press stays stuck, and still no lock comes back over it.
            sent.reply(400, Answer.refused("invalid_request"))
            val state = rig.until { it.queued.size == 1 && it.queued[0].stuck }
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), state.standing)
            assertNull(state.shieldedUntil(rig.clock.now()))
        }

    @Test
    fun aRefocussOwnAnswerIsTheStudentsReturnByThePhonesOrderOverAStandingNotReadAnUnlockMadeBeforeItAndStillStuckLeavesItsFocusBe(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val view = session(endsAt = 1200)
            val stuck = record(outbox, Change.Unlock("s", null))
            send(outbox, stuck, 400, Answer.refused("invalid_request"))
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, 200, Answer.unlocked(view))
            assertNull(record(outbox, Change.Refocus("s")).follows)
            val rig = unreadable(outbox)
            rig.server.next(refocusRoute).reply(200, Answer.refocused(view))
            val state = rig.until { it.standing != Standing.Unread }
            assertEquals(Standing.InSession(view, ParticipationState.Focused), state.standing)
            assertEquals(listOf(stuck.eventId), state.queued.map { it.eventId })
        }

    @Test
    fun aReadOfTheQueueThatFailsRightAfterThePressTakesNothingFromItAndWhereTheServerThenSaysThePhoneStandsThePressIsFiledAndSent(): Unit =
        runBlocking {
            // #95's Claude Review.
            val rig = unreadable()
            poison(rig.outbox)
            val press = assertNotNull(rig.engine.emergencyUnlock())
            assertEquals(listOf(press.eventId), rig.engine.updates.value.queued.map { it.eventId })
            poison(rig.outbox, false)
            val view = session(endsAt = 4000)
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(view))
            assertEquals(press.eventId, rig.server.next(unlockRoute).eventId)
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.engine.updates.value.standing)
        }

    @Test
    fun aLaunchWhoseReadOfTheQueueFailsAPressNotFiledYetIsFiledAllTheSameWhereTheFileSaysAtLaunchOrReadAgainOrWhereTheServerSaysAndSent(): Unit =
        runBlocking {
            // #95's Claude Review: by what the file holds, never the list the screens hold.
            for (known in listOf("at launch", "file read again", "server says")) {
                val (outbox, _) = makeOutbox()
                outbox.keep(kept)
                val press = record(outbox, Change.UnlockUnfiled(null))
                if (known != "at launch") spoilStanding(outbox)
                poison(outbox)
                val rig = rig(outbox)
                // Every read of the queue fails at first: the drain waits a minute to read it again.
                eventually { rig.clock.deadlines.contains(at(60)) }
                poison(outbox, false)
                when (known) {
                    "at launch" -> rig.clock.advance(60)
                    "file read again" -> {
                        outbox.keep(kept)
                        rig.clock.advance(60)
                    }
                    else -> {
                        rig.engine.setInFront(true)
                        rig.server.next(meRoute).reply(200, Answer.me(session(endsAt = 1200)))
                    }
                }
                assertEquals(unlocked, rig.until { it.standing != Standing.Unread }.standing, known)
                eventually { current(outbox, press.eventId)?.change == Change.Unlock("s", null) }
                assertEquals(press.eventId, rig.server.next(unlockRoute).eventId, known)
                rig.stop()
            }
        }

    @Test
    fun aFilingTheFileRefusedIsMadeByTheStudentsNextActInThatActsOwnWriteNeverLeftBehindItARefocusThereReturnsFromThePressAndWaitsForIt(): Unit =
        runBlocking {
            // #95's Claude Review.
            val (outbox, _) = makeOutbox()
            val rig = unreadable(outbox)
            val press = assertNotNull(rig.engine.emergencyUnlock())
            // Readable again, but the write that would file the press there is refused.
            refuseUpdates(outbox)
            outbox.keep(kept)
            rig.sleeping(at(60))
            rig.clock.advance(60)
            rig.until { it.standing != Standing.Unread }
            assertEquals(Change.UnlockUnfiled(null), current(outbox, press.eventId)?.change)
            refuseUpdates(outbox, false)
            val refocus = assertNotNull(rig.engine.record(Change.Refocus("s")))
            assertEquals(press.eventId, refocus.follows)
            val sent = rig.server.next()
            assertEquals(listOf(unlockRoute, press.eventId), listOf(sent.route, sent.eventId))
        }
}
