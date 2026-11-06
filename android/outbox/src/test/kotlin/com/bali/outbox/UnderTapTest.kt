package com.bali.outbox

import com.bali.core.ActionOrder
import com.bali.core.BlockRead
import com.bali.core.ParticipationState
import com.bali.core.TapRequest
import com.bali.core.UnlockReason
import com.bali.core.UnlockRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/** Where an Emergency Unlock is filed (decision 11): BaliOutbox's UnlockRouteTests, every one now (AN4d's and AN5e's). */
class UnlockRouteTest : OutboxFiles() {
    /** The engine's truth: [standing], and [changes] queued, those at [stuck] stuck. */
    private suspend fun state(standing: Standing, changes: List<Change> = emptyList(), stuck: Set<Int> = emptySet()): SyncState {
        val (outbox, _) = makeOutbox()
        changes.forEachIndexed { index, change ->
            val queued = record(outbox, change)
            if (index in stuck) outbox.execute("UPDATE outbox SET stuck = 1 WHERE eventId = '${queued.eventId}'")
        }
        return SyncState(standing = standing, queued = outbox.records())
    }

    @Test
    fun underATapNotYetAnsweredTheLatestWhateverThePhoneStoodInElseOfTheSessionItIsInElseWhereItStoodUnreadNotFiledYetElseNowhere(): Unit =
        runBlocking {
            val focused = Standing.InSession(session(), ParticipationState.Focused)
            for (standing in listOf(Standing.Out, Standing.Waiting, Standing.Unread, focused)) {
                val tapped = state(standing, listOf(Change.Tap("A"), Change.Tap("B")))
                assertEquals(Change.UnlockUnderTap(tapped.queued[1].eventId, UnlockReason.Nurse), tapped.emergencyUnlock(UnlockReason.Nurse), "$standing")
            }
            for (participation in listOf(ParticipationState.Focused, ParticipationState.Unlocked, ParticipationState.ProtectionOff, null)) {
                assertEquals(Change.Unlock("s", null), state(Standing.InSession(session(), participation)).emergencyUnlock(null), "$participation")
            }
            // Out or waiting, nothing the phone knows locks.
            for (standing in listOf(Standing.Out, Standing.Waiting)) assertNull(state(standing).emergencyUnlock(null), "$standing")
            assertEquals(Change.UnlockUnfiled(UnlockReason.Other), state(Standing.Unread).emergencyUnlock(UnlockReason.Other))
            // A stuck tap is no tap not yet answered: its refusal ended its lock.
            assertEquals(Change.Unlock("s", null), state(focused, listOf(Change.Tap("A")), stuck = setOf(0)).emergencyUnlock(null))
            assertNull(state(Standing.Out, listOf(Change.Tap("A")), stuck = setOf(0)).emergencyUnlock(null))
            assertEquals(Change.UnlockUnfiled(null), state(Standing.Unread, listOf(Change.Tap("A")), stuck = setOf(0)).emergencyUnlock(null))
            // A tap stuck behind one still pending: the pending one's.
            val behind = state(Standing.Out, listOf(Change.Tap("A"), Change.Tap("B")), stuck = setOf(1))
            assertEquals(Change.UnlockUnderTap(behind.queued[0].eventId, null), behind.emergencyUnlock(null))
        }

    @Test
    fun aTapNotYetAnsweredKeepsItsLockOnlyUntilAnUnlockAfterItOfEitherKind(): Unit =
        runBlocking {
            assertEquals(at(SyncState.TAP_CAP.seconds), state(Standing.Out, listOf(Change.Tap("A"))).tapHeldUntil)
            val unlocked = state(Standing.Out, listOf(Change.Tap("A"), Change.UnlockUnderTap("t", null)))
            assertNull(unlocked.tapHeldUntil)
            assertNull(unlocked.shieldedUntil(t0))
        }

    @Test
    fun untilItsTapIsAnsweredAnUnlockUnderItGuardsEverySessionTheAnswerNamingOneHandsItThatOneAndNoneLeavesItWhereThePhoneStood(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("A"))
            val other = record(outbox, Change.Tap("B"))
            val unlock = record(outbox, Change.UnlockUnderTap(tap.eventId, UnlockReason.Nurse))
            assertTrue(outbox.holdsUnlock("s") && outbox.holdsUnlock("t"))
            // Another tap's answer, or a send that brings none, narrows nothing.
            send(outbox, other, 200, Answer.joined(session("t")))
            send(outbox, tap, 503)
            assertTrue(outbox.holdsUnlock("s") && outbox.holdsUnlock("t"))
            // Over a record made after it (A12's order), it guards nothing.
            assertFalse(outbox.holdsUnlock("s", after = assertNotNull(unlock.order).seq))
            send(outbox, tap, 200, Answer.joined(session("s")))
            assertTrue(outbox.holdsUnlock("s"))
            assertFalse(outbox.holdsUnlock("t"))
            val filed = assertNotNull(current(outbox, unlock.eventId))
            assertEquals(Change.UnlockUnderTap(tap.eventId, UnlockReason.Nurse), filed.change)
            // Sent under its tap still.
            assertEquals(tap.eventId, assertIs<OutboxRecord.Request.UnlockUnderTap>(filed.request).tap)
            // A refocus there returns from it: it waits for it, as for any unlock of its session.
            assertEquals(unlock.eventId, record(outbox, Change.Refocus("s")).follows)
            // Recorded, it guards nothing.
            send(outbox, filed, 200, Answer.unlocked())
            assertFalse(outbox.holdsUnlock("s"))

            for (answer in listOf(Answer.armed, Answer.replayNoSession)) {
                val (again, _) = makeOutbox()
                val first = record(again, Change.Tap("A"))
                record(again, Change.UnlockUnderTap(first.eventId, null))
                send(again, first, 200, answer)
                assertFalse(again.holdsUnlock("s"), answer)
                // Made where the phone stood in a session, the standing it leaves names it, and that one
                // is guarded still: by the unlock, or, the tap armed, by its follow-up there (B6d).
                val retap = record(again, Change.Tap("B"))
                again.record(Change.UnlockUnderTap(retap.eventId, null), t0, Standing.InSession(session(), ParticipationState.Unlocked))
                send(again, retap, 200, answer)
                assertTrue(again.holdsUnlock("s"), answer)
                assertFalse(again.holdsUnlock("t"), answer)
            }
        }
}

/** An unlock filed under its tap, through the engine (decision 11): BaliOutbox's UnderTapEngineTests, the engine's half (the lock's, AN7's). */
class UnderTapEngineTest : EngineFiles() {
    @Test
    fun tappedWithNoSignalThenEmergencyUnlockBeforeTheAnswerTheLockOffAtOnceOnlineTheTapJoinsTheUnlockGoesUnderItAfterItByThePhonesOrderNeverLockedBetween(): Unit =
        runBlocking {
            val rig = rig()
            val view = session(endsAt = 1200)
            val tap = assertNotNull(rig.engine.tap(BlockRead.Block("T7XK2M9QPF")))
            assertEquals(Change.Tap("T7XK2M9QPF"), tap.change)
            assertEquals(at(SyncState.TAP_CAP.seconds), rig.engine.updates.value.shieldedUntil(t0))
            val offline = rig.server.next(tapRoute)
            val unlock = assertNotNull(rig.engine.emergencyUnlock(UnlockReason.Bathroom))
            assertEquals(Change.UnlockUnderTap(tap.eventId, UnlockReason.Bathroom), unlock.change)
            assertNull(rig.engine.updates.value.shieldedUntil(t0))
            offline.reply(null)
            rig.sleeping(at(2))
            rig.clock.advance(2)
            rig.server.next(tapRoute).reply(200, Answer.joined(view))
            // The tap's answer stands under the unlock after it: nothing locks meanwhile.
            val sent = rig.server.next(underTapRoute(tap))
            assertEquals(unlock.eventId, sent.eventId)
            val between = rig.engine.updates.value
            assertEquals(Standing.Out, between.standing)
            assertNull(between.shieldedUntil(rig.clock.now()))
            val body = sent.body(UnlockRequest.serializer())
            val order = assertNotNull(tap.order)
            assertEquals(UnlockReason.Bathroom, body.reason)
            assertEquals(ActionOrder(order.install, order.seq + 1), body.order)
            sent.reply(200, Answer.unlocked(view))
            val state = rig.until { it.queued.isEmpty() }
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), state.standing)
            assertNull(state.shieldedUntil(rig.clock.now()))
        }

    @Test
    fun focusedAReTapUnansweredEmergencyUnlockIsFiledUnderTheReTapThePhoneUnlockedWhereItStoodAtOnceAndSentThereAlwaysItsRetryToo(): Unit =
        runBlocking {
            val rig = rig()
            val view = session(endsAt = 1200)
            rig.tapIn(view)
            assertEquals(at(1200), rig.engine.updates.value.shieldedUntil(t0))
            val retap = assertNotNull(rig.engine.tap(BlockRead.Block("W3RD8K2QAN")))
            val held = rig.server.next(tapRoute)
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            assertEquals(Change.UnlockUnderTap(retap.eventId, null), unlock.change)
            val state = rig.engine.updates.value
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), state.standing)
            assertNull(state.shieldedUntil(t0))
            held.reply(200, Answer.joined(view))
            rig.server.next(underTapRoute(retap)).reply(null)
            rig.sleeping(at(2))
            rig.clock.advance(2)
            val again = rig.server.next()
            assertEquals(listOf(underTapRoute(retap), unlock.eventId), listOf(again.route, again.eventId))
            again.reply(200, Answer.unlocked(view))
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.until { it.queued.isEmpty() }.standing)
        }

    @Test
    fun stuckTheUnlockHoldsNoReadButItGuardsTheSessionItsTapsAnswerNamedNoReadLocksItAgain(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("T7XK2M9QPF")))
            val held = rig.server.next(tapRoute)
            rig.engine.emergencyUnlock()
            held.reply(200, Answer.joined())
            rig.server.next(underTapRoute(tap)).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            assertEquals(0, rig.outbox.awaiting())
            assertTrue(rig.outbox.holdsUnlock("s"))
            val later = Standing.InSession(session(endsAt = 4000), ParticipationState.Unlocked)
            rig.screenOn(Answer.me(session(endsAt = 4000)))
            assertEquals(later, rig.engine.updates.value.standing)
            // (The stuck unlock goes again as the clock moves, and is left unanswered.)
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt = 4000)))
            rig.sleeping(at(60))
            assertEquals(later, rig.engine.updates.value.standing)
        }

    @Test
    fun beforeItsTapIsAnsweredTheUnlocksSessionIsntKnownSoAllStuckItKeepsEveryReadFromLockingAgainTheTapRefusedItGoesAgainWhereThePhoneStood(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            val retap = assertNotNull(rig.engine.tap(BlockRead.Block("T7XK2M9QPF")))
            val held = rig.server.next(tapRoute)
            rig.engine.emergencyUnlock()
            held.reply(409, Answer.refused("session_not_running"))
            rig.server.next(underTapRoute(retap)).reply(400, Answer.refused("invalid_request"))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.server.next(meRoute).reply(200, Answer.me())
            rig.until { state -> state.queued.size == 3 && state.queued.all { it.stuck } }
            assertEquals(0, rig.outbox.awaiting())
            assertTrue(rig.outbox.holdsUnlock("s") && rig.outbox.holdsUnlock("t"))
            rig.screenOn(live = Answer.live(session(endsAt = 4000)))
            assertEquals(Standing.InSession(session(endsAt = 4000), ParticipationState.Unlocked), rig.engine.updates.value.standing)
        }

    @Test
    fun aTapsAnswerIsOlderThanAnUnlockMadeAfterItBothStuckTheTapsRetryAnsweredFocusedLocksNothingAReTapMadeAfterTheUnlockIsAReturnAndDoes(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.tap(BlockRead.Block("T7XK2M9QPF")))
            val held = rig.server.next(tapRoute)
            rig.engine.emergencyUnlock()
            held.reply(409, Answer.refused("session_not_running"))
            rig.server.next(underTapRoute(tap)).reply(400, Answer.refused("invalid_request"))
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { state -> state.queued.size == 2 && state.queued.all { it.stuck } }
            rig.sleeping(at(2))
            rig.clock.advance(2)
            rig.server.next(tapRoute).reply(200, Answer.joined())
            val state = rig.until { it.queued.size == 1 }
            assertEquals(Standing.InSession(session(), ParticipationState.Unlocked), state.standing)
            assertNull(state.shieldedUntil(rig.clock.now()))
            // The unlock, due again, is refused again; the student taps again, after it: back to focus.
            rig.server.next(underTapRoute(tap)).reply(400, Answer.refused("invalid_request"))
            rig.engine.tap(BlockRead.Block("T7XK2M9QPF"))
            rig.server.next(tapRoute).reply(200, Answer.joined())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
        }

    @Test
    fun aTapThatLandsAfterItsUnlockRefusedAtFirstTheUnlockKeptWithNoSessionFilesItThenAnsweredJoinedAndUnlockedAndNothingLocks(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.tap(BlockRead.Block("T7XK2M9QPF")))
            val held = rig.server.next(tapRoute)
            rig.engine.emergencyUnlock()
            assertNull(rig.engine.updates.value.shieldedUntil(t0))
            held.reply(409, Answer.refused("session_not_running"))
            rig.server.next(underTapRoute(tap)).reply(200, Answer.unlockKept("unknown_tap"))
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.queued.size == 1 && it.queued.first().stuck }
            rig.sleeping(at(2))
            rig.clock.advance(2)
            rig.server.next(tapRoute).reply(200, Answer.joined(state = "unlocked"))
            val state = rig.until { it.queued.isEmpty() }
            assertEquals(Standing.InSession(session(), ParticipationState.Unlocked), state.standing)
            assertNull(state.shieldedUntil(rig.clock.now()))
        }

    @Test
    fun aScanRecordsATapOnlyForABaliBlockAnotherTagAScanCancelledAPhoneWithNoNfcOrItSwitchedOffAReadersErrorNothingRecordedOrLockedNorIsAnUnlockWithNothingToUnlock(): Unit =
        runBlocking {
            for (read in listOf(BlockRead.NotBali, BlockRead.Cancelled, BlockRead.Unsupported, BlockRead.NfcOff, BlockRead.Failed("Session timeout"))) {
                val rig = rig()
                assertNull(rig.engine.tap(read), "$read")
                assertNull(rig.engine.emergencyUnlock(), "$read")
                val state = rig.engine.updates.value
                assertEquals(listOf(emptyList<OutboxRecord>(), Standing.Out), listOf(state.queued, state.standing), "$read")
                assertNull(state.shieldedUntil(t0), "$read")
                // Nothing queued, so nothing for the drain to send.
                assertEquals(emptyList(), rig.outbox.records(), "$read")
                assertEquals(emptyList(), rig.server.waiting, "$read")
                // A block's code is the tap's tag.
                rig.engine.tap(BlockRead.Block("T7XK2M9QPF"))
                assertEquals("T7XK2M9QPF", rig.server.next(tapRoute).body(TapRequest.serializer()).tagId, "$read")
                rig.stop()
            }
        }
}

/** A scan that joins no class, its unlock filed again where the student stood (owner's ruling, B6d): BaliOutbox's RefiledTests, every one now (AN4e's and AN5e's). */
class RefiledTest : EngineFiles() {
    @Test
    fun armedOrRefusedAScanJoinsNoClassThePressMadeBeforeItsAnswerIsFiledAgainInTheClassTheStudentStoodInWithItsOwnIdAndThePresssReasonTimeAndOrderNeverLockedAgain(): Unit =
        runBlocking {
            for ((status, answer) in listOf(200 to Answer.armed, 404 to Answer.unknownBlock)) {
                for (kept in listOf(true, false)) {
                    val rig = rig()
                    val view = session(endsAt = 4000)
                    rig.tapIn(view)
                    val scan = assertNotNull(rig.engine.tap(BlockRead.Block("W3RD8K2QAN")))
                    val held = rig.server.next(tapRoute)
                    val press = assertNotNull(rig.engine.emergencyUnlock(UnlockReason.Nurse))
                    val locks = LockWatch(rig, scope)
                    held.reply(status, answer)
                    rig.server.next(underTapRoute(scan))
                        .reply(if (kept) 200 else 400, if (kept) Answer.unlockKept("tap_armed") else Answer.refused("invalid_request"))
                    val again = rig.server.next(unlockRoute)
                    val body = again.body(UnlockRequest.serializer())
                    assertNotEquals(press.eventId, body.eventId)
                    assertEquals(UnlockReason.Nurse, body.reason)
                    assertEquals(listOf(press.recordedAt, press.order), listOf(body.deviceTime, body.order))
                    assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.engine.updates.value.standing)
                    again.reply(200, Answer.unlocked(view))
                    val state = rig.until { now -> now.queued.none { it.eventId == body.eventId } }
                    assertEquals(Standing.InSession(view, ParticipationState.Unlocked), state.standing)
                    assertEquals(if (kept) emptyList() else listOf(press.eventId), state.queued.filter { it.change.isUnlock }.map { it.eventId })
                    assertEquals(emptyList(), locks.stop(), "$status, kept $kept")
                    rig.stop()
                }
            }
        }

    @Test
    fun aScanThatLandsInAClassHasItsUnlockFiledThereAsDecision11HasItNoSecond(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn(session(endsAt = 4000))
            val scan = assertNotNull(rig.engine.tap(BlockRead.Block("W3RD8K2QAN")))
            val held = rig.server.next(tapRoute)
            rig.engine.emergencyUnlock()
            val other = session("t", endsAt = 4000)
            held.reply(200, Answer.joined(other))
            rig.server.next(underTapRoute(scan)).reply(200, Answer.unlocked(other))
            val state = rig.until { it.queued.isEmpty() }
            assertEquals(Standing.InSession(other, ParticipationState.Unlocked), state.standing)
            assertEquals(emptyList(), rig.server.waiting)
        }

    @Test
    fun stuckUnrecordedTheFollowUpGuardsTheClassItNamesAReadThereFocusedLeavesThePhoneUnlocked(): Unit =
        runBlocking {
            val rig = rig()
            val view = session(endsAt = 4000)
            rig.tapIn(view)
            val scan = assertNotNull(rig.engine.tap(BlockRead.Block("W3RD8K2QAN")))
            val held = rig.server.next(tapRoute)
            rig.engine.emergencyUnlock()
            held.reply(200, Answer.armed)
            rig.server.next(underTapRoute(scan)).reply(200, Answer.unlockKept("tap_armed"))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.size == 1 && it.queued[0].stuck }
            assertEquals(0, rig.outbox.awaiting())
            assertTrue(rig.outbox.holdsUnlock("s"))
            // The read the press's kept answer asked for, sent while the follow-up awaited: stale.
            rig.server.next(meRoute).reply(200, Answer.me(view))
            rig.screenOn(live = Answer.live(view))
            rig.clock.advance(30)
            rig.server.next(checkInRoute).reply(200, Answer.live(view))
            rig.sleeping(at(60))
            assertEquals(Standing.InSession(view, ParticipationState.Unlocked), rig.engine.updates.value.standing)
        }

    @Test
    fun aReTapMadeAfterThePressIsAfterItByThePhonesOrderSoAfterItsFollowUpWhichGoesWithThePresssOrderAheadOfItTheReTapsFocusStandingOnceAnswered(): Unit =
        runBlocking {
            val rig = rig()
            val view = session(endsAt = 4000)
            rig.tapIn(view)
            val scan = assertNotNull(rig.engine.tap(BlockRead.Block("W3RD8K2QAN")))
            val held = rig.server.next(tapRoute)
            val press = assertNotNull(rig.engine.emergencyUnlock())
            val retap = assertNotNull(rig.engine.tap(BlockRead.Block("T7XK2M9QPF")))
            assertNotNull(rig.engine.updates.value.shieldedUntil(t0))
            held.reply(200, Answer.armed)
            rig.server.next(underTapRoute(scan)).reply(200, Answer.unlockKept("tap_armed"))
            val again = rig.server.next(unlockRoute)
            assertEquals(press.order, again.body(UnlockRequest.serializer()).order)
            assertTrue(assertNotNull(press.order).seq < assertNotNull(retap.order).seq)
            // The re-tap's lock held meanwhile.
            assertNotNull(rig.engine.updates.value.shieldedUntil(rig.clock.now()))
            again.reply(400, Answer.refused("invalid_request"))
            rig.server.next(tapRoute).reply(200, Answer.joined(view))
            val state = rig.until { it.standing == Standing.InSession(view, ParticipationState.Focused) }
            assertEquals(view.endsAt, state.shieldedUntil(rig.clock.now()))
        }

    @Test
    fun mintedOnceTheScanRefusedAgainOnItsRetryThePresssOwnAnswerAfterItARelaunchOneFollowUpInThePresssPlaceBeforeALaterRefocus(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            val scan = record(outbox, Change.Tap("W3RD8K2QAN"))
            val press =
                assertNotNull(outbox.record(Change.UnlockUnderTap(scan.eventId, UnlockReason.Nurse), t0, Standing.InSession(session(), ParticipationState.Unlocked)))
            val refocus = record(outbox, Change.Refocus("s"))
            send(outbox, scan, 404, Answer.unknownBlock)

            suspend fun followUps(of: Outbox) = of.records().filter { it.change == Change.Unlock("s", UnlockReason.Nurse) }
            val followUp = followUps(outbox).first()
            assertNotEquals(press.eventId, followUp.eventId)
            assertEquals(press.recordedAt, followUp.recordedAt)
            assertEquals(press.order, followUp.order)
            // A refocus there returns from the follow-up now, the unlock of its session (santa's review).
            assertEquals(followUp.eventId, current(outbox, refocus.eventId)?.follows)
            assertEquals(listOf(scan, press, followUp, refocus).map { it.eventId }, outbox.records().map { it.eventId })
            send(outbox, assertNotNull(current(outbox, scan.eventId)), 404, Answer.unknownBlock)
            send(outbox, press, 200, Answer.unlockKept("unknown_tap"))
            outbox.close()
            val reopened = open(file)
            assertEquals(listOf(followUp.eventId), followUps(reopened).map { it.eventId })
            assertEquals(followUp.eventId, record(reopened, Change.Refocus("s")).follows)
        }

    @Test
    fun aRefusedScanWhoseRetryLandsInAClassAfterAllLeavesTwoRecordsOfOnePressBothKeptNothingDiscarded(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val scan = record(outbox, Change.Tap("W3RD8K2QAN"))
            val press = assertNotNull(outbox.record(Change.UnlockUnderTap(scan.eventId, null), t0, Standing.InSession(session(), ParticipationState.Unlocked)))
            send(outbox, scan, 409, Answer.refused("session_not_running"))
            send(outbox, assertNotNull(current(outbox, scan.eventId)), 200, Answer.joined(session("t")))
            // The follow-up where the phone stood, the press where the scan landed (santa's review, disclosed).
            assertEquals(listOf(Change.UnlockUnderTap(scan.eventId, null), Change.Unlock("s", null)), outbox.records().map { it.change })
            assertNotNull(current(outbox, press.eventId))
            assertTrue(outbox.holdsUnlock("s") && outbox.holdsUnlock("t"))
        }

    @Test
    fun aPressKeptWithNoClassWhileItsScanIsStuckUnansweredIsFiledAgainWhereThePhoneStoodOneWhoseScanLandedIsNot(): Unit =
        runBlocking {
            val stood = Standing.InSession(session(), ParticipationState.Unlocked)
            val (outbox, _) = makeOutbox()
            val scan = record(outbox, Change.Tap("W3RD8K2QAN"))
            val press = assertNotNull(outbox.record(Change.UnlockUnderTap(scan.eventId, null), t0, stood))
            repeat(Outbox.BOUND) { send(outbox, assertNotNull(current(outbox, scan.eventId)), 503) }
            send(outbox, press, 200, Answer.unlockKept("unknown_tap"))
            assertEquals(listOf(Change.Tap("W3RD8K2QAN"), Change.Unlock("s", null)), outbox.records().map { it.change })

            val (landed, _) = makeOutbox()
            val joined = record(landed, Change.Tap("W3RD8K2QAN"))
            val under = assertNotNull(landed.record(Change.UnlockUnderTap(joined.eventId, null), t0, stood))
            send(landed, joined, 200, Answer.joined(session("t")))
            send(landed, assertNotNull(current(landed, under.eventId)), 200, Answer.unlockKept("unknown_tap"))
            assertEquals(emptyList(), landed.records())
        }
}

/** The student's reason for an Emergency Unlock: OutboxTests' ReasonTests, their part the store settles. */
class ReasonTest : OutboxFiles() {
    @Test
    fun aReasonGivenForAPressUnderAScanThatJoinedNoClassGoesWithItsFollowUpAtOnceThePresssHoldEndedWithIt(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            // Held for its reason as the sync engine holds a press.
            assertNotNull(
                outbox.record(Change.UnlockUnderTap(tap.eventId, null), t0, Standing.InSession(session(), ParticipationState.Unlocked), SyncEngine.REASON_HOLD),
            )
            send(outbox, tap, 200, Answer.armed)
            val followUp = outbox.records().first { it.change is Change.Unlock }
            assertTrue(outbox.explain(UnlockReason.Nurse, t0, emptySet()))
            assertEquals(UnlockReason.Nurse, current(outbox, followUp.eventId)?.change?.reason)
            val due = assertIs<Outbox.Due.Send>(outbox.nextDue(t0), "the press's hold still holds the follow-up back")
            assertEquals(Change.UnlockUnderTap(tap.eventId, null), due.record.change)
        }
}
