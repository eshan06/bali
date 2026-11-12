package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.UnlockReason
import java.time.Duration
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.KSerializer

// Emergency Unlock in the sync engine (AN5e): what locks, the reason and the way back, and the lock back
// on, with the helpers the unlock's tests share.

/** In session s, ending 3000 s after [t0], in [state]. */
private fun inSession(state: ParticipationState) = Standing.InSession(session(), state)

private val focused = inSession(ParticipationState.Focused)
private val unlocked = inSession(ParticipationState.Unlocked)

/** The route of an unlock filed under the tap [tap]. */
fun underTapRoute(tap: OutboxRecord) = "POST /v1/taps/${tap.eventId}/unlock"

/** The request an exchange carries, read as [serializer]'s. */
fun <T> Server.Exchange.body(serializer: KSerializer<T>): T = BaliJson.decodeFromString(serializer, assertNotNull(request.body).decodeToString())

/** The file refuses every new record, or takes them again: BaliOutbox's tests' `refuseRecords`. */
suspend fun refuseRecords(outbox: Outbox, refused: Boolean = true) =
    outbox.execute(if (refused) "CREATE TRIGGER refuse BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'no'); END" else "DROP TRIGGER refuse")

/** The file refuses to change a queued record, an unlock's filing among them, or takes it again: BaliOutbox's tests' `refuseUpdates`. */
suspend fun refuseUpdates(outbox: Outbox, refused: Boolean = true) =
    outbox.execute(
        if (refused) "CREATE TRIGGER refuseUpdate BEFORE UPDATE ON outbox BEGIN SELECT RAISE(ABORT, 'no'); END" else "DROP TRIGGER refuseUpdate",
    )

/**
 * Every state [rig]'s engine publishes from now on whose lock is on by the rig's clock, until [stop]: the
 * engine's half of iOS's count of the shields put back on. Collected where each is set, so none is missed.
 */
class LockWatch(rig: Rig, scope: CoroutineScope) {
    private val locked = Collections.synchronizedList(mutableListOf<SyncState>())
    private val watching = scope.launch(Dispatchers.Unconfined) { rig.engine.updates.collect { if (it.shieldedUntil(rig.clock.now()) != null) locked += it } }

    suspend fun stop(): List<SyncState> {
        watching.cancelAndJoin()
        return locked.toList()
    }
}

/** What the lock follows: the engine's truth, by the phone's clock. BaliOutbox's ShieldedUntilTests. */
class ShieldedUntilTest : OutboxFiles() {
    @Test
    fun focusedInASessionOnUntilItsEndAndOffFromThenOffInEveryOtherStanding() {
        val state = SyncState(standing = Standing.InSession(session(endsAt = 1200), ParticipationState.Focused))
        assertEquals(at(1200), state.shieldedUntil(t0))
        assertEquals(at(1200), state.shieldedUntil(at(1199)))
        assertNull(state.shieldedUntil(at(1200)))
        val others = listOf(Standing.Out, Standing.Waiting, unlocked, inSession(ParticipationState.ProtectionOff), Standing.InSession(session(), null))
        for (standing in others) assertNull(SyncState(standing = standing).shieldedUntil(t0), "$standing")
    }

    @Test
    fun aTapNotYetAnsweredOnAtOnceForDecision7s50MinutesBesideASessionsEndTheLaterAndOffOnceTheStudentUnlocksAfterItUntilAnotherTap(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val until1200 = Standing.InSession(session(endsAt = 1200), ParticipationState.Focused)
            record(outbox, Change.Tap("tag"), at(60))
            var state = SyncState(standing = until1200, queued = outbox.records())
            assertEquals(Duration.ofMinutes(50), SyncState.TAP_CAP)
            assertEquals(at(3060), state.shieldedUntil(at(60)))
            assertEquals(at(3060), state.shieldedUntil(at(3059)))
            assertNull(state.shieldedUntil(at(3060)))
            // An unlock after it is acted on at once (decision 11): the session's own end is left.
            record(outbox, Change.Unlock("s", null), at(90))
            state = state.copy(queued = outbox.records())
            assertEquals(at(1200), state.shieldedUntil(at(90)))
            state = state.copy(standing = until1200.copy(state = ParticipationState.Unlocked))
            assertNull(state.shieldedUntil(at(90)))
            // A tap after the unlock locks again.
            record(outbox, Change.Tap("tag"), at(120))
            state = state.copy(queued = outbox.records())
            assertEquals(at(3120), state.shieldedUntil(at(120)))
        }

    @Test
    fun aRefusedTapIsStuckAndItsLockDoesntOutliveTheRefusal(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            assertEquals(at(SyncState.TAP_CAP.seconds), SyncState(queued = outbox.records()).shieldedUntil(t0))
            send(outbox, tap, 409, Answer.refused("session_not_running"))
            val state = SyncState(queued = outbox.records())
            assertEquals(true, state.queued.firstOrNull()?.stuck)
            assertNull(state.shieldedUntil(t0))
        }
}

/** The reason sent with the unlock, and the way back (C5a): the engine's half of BaliOutbox's ReasonTests but `refiledReason` (ReasonTest's), their words AN10's. */
class ReasonEngineTest : EngineFiles() {
    @Test
    fun pressedInASessionTheUnlockStandsAtOnceItsSendWaitsForTheReasonGivenMeanwhileItGoesAtOnceWithItAndOnceTheServerHasItAPickIsAChangeOfIt(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            assertNull(rig.engine.pressUnlock())
            val pressed = rig.engine.updates.value
            assertEquals(listOf(unlocked, 1), listOf(pressed.standing, pressed.queued.size))
            // The drain waits out the hold, which the rig's clock marks: nothing sent before it.
            rig.sleeping(at(SyncEngine.REASON_HOLD.seconds))
            assertEquals(emptyList(), rig.server.waiting)
            assertNull(rig.engine.explain(UnlockReason.Bathroom))
            assertEquals(UnlockReason.Bathroom, rig.engine.updates.value.queued.first().change.reason)
            val sent = rig.server.next(unlockRoute)
            assertEquals("bathroom", sent.reason)
            sent.reply(200, Answer.unlocked(reason = "bathroom"))
            val recorded = assertNotNull(rig.until { it.queued.isEmpty() }.recordedUnlock)
            assertEquals(UnlockReason.Bathroom, recorded.reason)
            // Once the server has it, a pick is a change of it (A20).
            val picked = async { rig.engine.explain(UnlockReason.Nurse) }
            val change = rig.server.next("PATCH /v1/unlocks/${recorded.unlock}")
            assertEquals("nurse", change.reason)
            change.reply(200, """{"outcome":"applied","reason":"nurse"}""")
            assertNull(picked.await())
            assertEquals(UnlockReason.Nurse, rig.engine.updates.value.recordedUnlock?.reason)
        }

    @Test
    fun theServerKeepsTheReasonItRecordedFirstAnUnlocksAnswerKeepingNoneOrAnotherIsTheOneOnRecordUntilThePhonesNextChange(): Unit =
        runBlocking {
            val view = BaliJson.encodeToString(SessionView.serializer(), session())
            fun replay(reason: String) = """{"outcome":"replay","recordedAs":null,"state":"unlocked","session":$view,"reason":$reason}"""
            for ((answer, kept) in listOf("null" to null, "\"bathroom\"" to UnlockReason.Bathroom, "\"nurse\"" to UnlockReason.Nurse)) {
                val rig = rig()
                rig.tapIn()
                val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", UnlockReason.Nurse)))
                rig.server.next(unlockRoute).reply(200, replay(answer))
                assertEquals(RecordedUnlock("s", unlock.eventId, kept), rig.until { it.queued.isEmpty() }.recordedUnlock, answer)
                rig.engine.record(Change.Refocus("s"))
                assertNull(rig.engine.updates.value.recordedUnlock, answer)
                rig.stop()
            }
            // An older unlock's answer landing after a newer unlock was pressed, still queued: on record all
            // the same, while the card is about the newer one, whose reason can still go (santa's round 1).
            val rig = rig()
            rig.tapIn()
            val older = assertNotNull(rig.engine.record(Change.Unlock("s", UnlockReason.Nurse)))
            val sent = rig.server.next(unlockRoute)
            assertNull(rig.engine.pressUnlock())
            sent.reply(200, replay("null"))
            val newer = rig.until { it.queued.size == 1 }
            assertEquals(older.eventId, newer.recordedUnlock?.unlock)
            val card = assertNotNull(newer.unlockIn("s"))
            assertEquals(listOf(0, false, false), listOf(card.attempts, card.stuck, card.eventId in newer.sending))
            // On its way, a pick waits for it: never a change of the older one's reason.
            rig.clock.advance(SyncEngine.REASON_HOLD)
            rig.server.next(unlockRoute)
            assertEquals(ReasonFailure.OnItsWay, withTimeout(patience) { rig.engine.explain(UnlockReason.Bathroom) })
            rig.stop()
            // Another class's unlock stuck in the queue is no matter: this class's is still what the server
            // kept (santa's round 2).
            val (outbox, _) = makeOutbox()
            val stuck = record(outbox, Change.Unlock("a", null))
            send(outbox, stuck, 400, Answer.refused("invalid_request"))
            val other = rig(outbox)
            other.engine.record(Change.Tap("tag"))
            other.server.next(tapRoute).reply(200, Answer.joined())
            other.until { it.standing == focused }
            val unlock = assertNotNull(other.engine.record(Change.Unlock("s", UnlockReason.Nurse)))
            other.server.next(unlockRoute).reply(200, replay("null"))
            val state = other.until { it.queued.size == 1 }
            assertEquals(RecordedUnlock("s", unlock.eventId, null), state.recordedUnlock)
            assertNull(state.unlockIn("s"))
        }

    @Test
    fun onceTheServerHasTheUnlockAPickIsAChangeOfItARefusalSaidNoAnswerSaidTheSamePickGoingAgainUnderItsEventIdAndThePhoneMovingOnTheAnswerMovesNothing(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            val unlock = assertNotNull(rig.until { it.queued.isEmpty() }.recordedUnlock).unlock
            val route = "PATCH /v1/unlocks/$unlock"
            val refused = async { rig.engine.explain(UnlockReason.Nurse) }
            val refusal = rig.server.next(route)
            refusal.reply(409, Answer.refused("unlock_superseded"))
            assertEquals(ReasonFailure.NotChanged(SendResult.Status(409), ApiErrorReason.UnlockSuperseded), refused.await())
            assertNull(rig.engine.updates.value.recordedUnlock?.reason)
            // Answered, the same pick again is a change of its own, under a new id (santa's review).
            val retried = async { rig.engine.explain(UnlockReason.Nurse) }
            val again409 = rig.server.next(route)
            assertNotEquals(refusal.eventId, again409.eventId)
            again409.reply(409, Answer.refused("unlock_superseded"))
            assertEquals(ReasonFailure.NotChanged(SendResult.Status(409), ApiErrorReason.UnlockSuperseded), retried.await())
            val lost = async { rig.engine.explain(UnlockReason.Other) }
            val first = rig.server.next(route)
            first.reply(null)
            assertEquals(ReasonFailure.NotChanged(SendResult.NetworkError, null), lost.await())
            val again = async { rig.engine.explain(UnlockReason.Other) }
            val second = rig.server.next(route)
            assertEquals(first.eventId, second.eventId)
            second.reply(200, """{"outcome":"replay","reason":"other"}""")
            assertNull(again.await())
            assertEquals(UnlockReason.Other, rig.engine.updates.value.recordedUnlock?.reason)
            // A new pick goes under a new id; Back to focus while it is on its way, and its answer moves nothing.
            val late = async { rig.engine.explain(UnlockReason.Bathroom) }
            val third = rig.server.next(route)
            assertNotEquals(first.eventId, third.eventId)
            assertNull(rig.engine.backToFocus())
            third.reply(200, """{"outcome":"applied","reason":"bathroom"}""")
            assertNull(late.await())
            assertNull(rig.engine.updates.value.recordedUnlock)
        }

    @Test
    fun aPickWhoseScreenIsCancelledWhileItsChangeIsOnItsWayStopsWaitingAtOnceAndTheChangeGoesOnItsAnswerKept(): Unit =
        runBlocking {
            // Santa's review: in the engine's scope, as every call is.
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            val unlock = assertNotNull(rig.until { it.queued.isEmpty() }.recordedUnlock).unlock
            val screen = launch { rig.engine.explain(UnlockReason.Nurse) }
            val change = rig.server.next("PATCH /v1/unlocks/$unlock")
            assertNotNull(withTimeoutOrNull(5.seconds) { screen.cancelAndJoin() }, "the cancelled screen waited for the change")
            change.reply(200, """{"outcome":"applied","reason":"nurse"}""")
            rig.until { it.recordedUnlock?.reason == UnlockReason.Nurse }
        }

    @Test
    fun aChangeWhoseTokenTheApiRefusedGoesOnceMoreUnderTheSameIdWithTheSignInsFreshOneOnceOnlyAndNoFreshTokenLeavesThe401Said(): Unit =
        runBlocking {
            // iOS's `Joining.send(renewing:)`, the engine's own until AN9 (JoinTests' `renewing`, through the engine).
            for (refreshWorks in listOf(true, false)) {
                val rig = rig(refreshWorks = refreshWorks)
                rig.tapIn()
                rig.engine.record(Change.Unlock("s", null))
                rig.server.next(unlockRoute).reply(200, Answer.unlocked())
                val route = "PATCH /v1/unlocks/${assertNotNull(rig.until { it.queued.isEmpty() }.recordedUnlock).unlock}"
                val picked = async { rig.engine.explain(UnlockReason.Nurse) }
                val refused = rig.server.next(route)
                assertEquals("Bearer token-1", refused.token)
                refused.reply(401)
                if (refreshWorks) {
                    val again = rig.server.next(route)
                    assertEquals(listOf("Bearer token-2", refused.eventId), listOf(again.token, again.eventId))
                    again.reply(401)
                }
                assertEquals(ReasonFailure.NotChanged(SendResult.Status(401), null), picked.await(), "refresh works $refreshWorks")
                // Its call over, nothing more of it can go.
                assertEquals(listOf(1, emptyList<String>()), listOf(rig.tokens.refreshes, rig.server.waiting), "refresh works $refreshWorks")
                rig.stop()
            }
        }

    @Test
    fun aChangeForAnUnlockThePhoneHasMovedOnFromAnsweredLateLeavesTheNextUnlocksChangeAloneWhoseOwnWithNoAnswerStillGoesAgainUnderItsEventId(): Unit =
        runBlocking {
            // #140, santa's round 2.
            val rig = rig()
            rig.tapIn()
            val first = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            rig.until { it.recordedUnlock?.unlock == first.eventId }
            val old = async { rig.engine.explain(UnlockReason.Nurse) }
            val oldChange = rig.server.next("PATCH /v1/unlocks/${first.eventId}")
            // Locked again and unlocked anew, the change for the first still on its way.
            rig.engine.record(Change.Refocus("s"))
            rig.server.next(refocusRoute).reply(200, Answer.refocused())
            val second = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            rig.until { it.recordedUnlock?.unlock == second.eventId }
            val route = "PATCH /v1/unlocks/${second.eventId}"
            val lost = async { rig.engine.explain(UnlockReason.Other) }
            val lostChange = rig.server.next(route)
            lostChange.reply(null)
            assertEquals(ReasonFailure.NotChanged(SendResult.NetworkError, null), lost.await())
            oldChange.reply(null)
            assertEquals(ReasonFailure.NotChanged(SendResult.NetworkError, null), old.await())
            val again = async { rig.engine.explain(UnlockReason.Other) }
            val retried = rig.server.next(route)
            assertEquals(lostChange.eventId, retried.eventId)
            retried.reply(200, """{"outcome":"replay","reason":"other"}""")
            assertNull(again.await())
            assertEquals(UnlockReason.Other, rig.engine.updates.value.recordedUnlock?.reason)
        }

    @Test
    fun answeredTheUnlockLeavesSendingInTheStepThatReadsTheQueueAgainNoStatePublishedBetweenShowsItNeitherOnItsWayNorAnswered(): Unit =
        runBlocking {
            // Santa's round 2: one would open the card over an unlock already sent. Every state is seen as it
            // is published, none missed.
            val rig = rig()
            rig.tapIn()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            val sent = rig.server.next(unlockRoute)
            val open = Collections.synchronizedList(mutableListOf<SyncState>())
            val watching =
                launch(Dispatchers.Unconfined) {
                    rig.engine.updates.collect { state -> if (state.queued.any { it.eventId == unlock.eventId } && unlock.eventId !in state.sending) open += state }
                }
            sent.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
            watching.cancelAndJoin()
            assertEquals(emptyList(), open.toList())
        }

    @Test
    fun noneGivenItGoesAsTheHoldEndsWithoutOneAReasonGivenWhileItIsOnItsWayOrAfterASendWithNoAnswerWaitsForItToLand(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            assertNull(rig.engine.pressUnlock())
            rig.sleeping(at(SyncEngine.REASON_HOLD.seconds))
            rig.clock.advance(SyncEngine.REASON_HOLD)
            val first = rig.server.next(unlockRoute)
            assertNull(first.reason)
            // On its way, never sent by the file's count: the send wouldn't carry it.
            assertEquals(ReasonFailure.OnItsWay, rig.engine.explain(UnlockReason.Nurse))
            // No answer: the server may have it all the same, and would keep it without one.
            first.reply(null)
            rig.until { it.queued.firstOrNull()?.attempts == 1 }
            assertEquals(ReasonFailure.OnItsWay, rig.engine.explain(UnlockReason.Nurse))
            rig.clock.advance(2)
            val again = rig.server.next(unlockRoute)
            assertNull(again.reason)
            again.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
        }

    @Test
    fun aReasonGivenOnceASendCutShortWithTheRunIsFollowedByOneWithNoTokenIsNeverSaidSavedThatSendMayHaveReachedTheServer(): Unit =
        runBlocking {
            // AN5b's note: a send cut short makes no answer (AN4b), so the file counts it never sent, where iOS
            // counts it; the server keeps the reason it recorded first (A1), so a reason kept now would go
            // with a send it never reads.
            val rig = rig()
            rig.tapIn()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute)
            withTimeout(patience) { rig.running.cancelAndJoin() }
            rig.tokens.set(null)
            val again = scope.launch { rig.engine.run() }
            assertEquals(setOf(unlock.eventId), rig.until { it.link == Link.SignIn }.sending)
            assertEquals(ReasonFailure.OnItsWay, rig.engine.explain(UnlockReason.Nurse))
            assertNull(current(rig.outbox, unlock.eventId)?.change?.reason)
            // A token, and it goes again as it went; answered, it is on its way no more.
            rig.tokens.set("token-9")
            rig.engine.retryNow()
            val sent = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, null), listOf(sent.eventId, sent.reason))
            sent.reply(200, Answer.unlocked())
            assertEquals(emptySet(), rig.until { it.queued.isEmpty() }.sending)
            withTimeout(patience) { again.cancelAndJoin() }
        }

    @Test
    fun pressedInASessionsLastSecondsItWaitsForTheReasonOnlyUntilTheBellSoTheClasssGridShowsIt(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn(session(endsAt = 5))
            assertNull(rig.engine.pressUnlock())
            rig.sleeping(at(5))
            rig.clock.advance(5)
            rig.server.next(unlockRoute).reply(200, Answer.unlocked(session(endsAt = 5)))
            rig.until { it.queued.isEmpty() }
        }

    @Test
    fun theStudentMovingOnSendsItAtOnceBalisScreenGoingBehindOrBackToFocusWhoseRefocusFollowsIt(): Unit =
        runBlocking {
            for (back in listOf(false, true)) {
                val rig = rig()
                rig.tapIn()
                assertNull(rig.engine.pressUnlock())
                if (back) {
                    assertNull(rig.engine.backToFocus())
                    assertEquals(focused, rig.engine.updates.value.standing)
                } else {
                    rig.engine.setInFront(false)
                }
                val sent = rig.server.next(unlockRoute)
                assertEquals(listOf(null, t0), listOf(sent.reason, rig.clock.now()), "back $back")
                sent.reply(200, Answer.unlocked())
                if (back) {
                    rig.server.next(refocusRoute).reply(200, Answer.refocused())
                    rig.until { it.queued.isEmpty() && it.standing == focused }
                } else {
                    rig.until { it.queued.isEmpty() && it.standing == unlocked }
                }
                rig.stop()
            }
        }

    @Test
    fun backToFocusRefusedByTheServerIsDroppedTheTruthReadAgainItsRefusalShownWhereItLandsUntilThePhonesNextChange(): Unit =
        runBlocking {
            // C5b; rule 5. What Protection off and Unlocked say of it is AN10's.
            val refusals =
                listOf(
                    Triple("protection_off", ApiErrorReason.ProtectionOff, ParticipationState.ProtectionOff),
                    Triple("event_id_conflict", ApiErrorReason.EventIdConflict, ParticipationState.Unlocked),
                )
            for ((reason, said, landed) in refusals) {
                val rig = rig()
                rig.tapIn()
                assertNull(rig.engine.pressUnlock())
                assertNull(rig.engine.backToFocus())
                rig.server.next(unlockRoute).reply(200, Answer.unlocked())
                rig.server.next(refocusRoute).reply(409, Answer.refused(reason))
                rig.server.next(meRoute).reply(200, Answer.me(state = landed.wire))
                val state = rig.until { it.standing == inSession(landed) && it.refused != null }
                assertEquals(listOf(Change.Refocus("s"), said), listOf(state.refused?.change, state.refused?.reason), reason)
                rig.engine.record(Change.Tap("tag"))
                assertNull(rig.engine.updates.value.refused, reason)
                rig.stop()
            }
        }

    @Test
    fun aPressThatFindsNothingToUnlockIsSaidNeverSilenceAndRecordsNothingPressedWhereNoUnlockedScreenAsksWhyUnderATapOutOfAnySessionItGoesAtOnce(): Unit =
        runBlocking {
            // #116's review.
            val rig = rig()
            assertEquals(UnlockFailure.NothingToUnlock, rig.engine.pressUnlock())
            assertEquals(emptyList(), rig.engine.updates.value.queued)
            assertEquals(emptyList(), rig.outbox.records())
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            assertNull(rig.engine.pressUnlock())
            rig.server.next(tapRoute).reply(200, Answer.joined())
            val underTap = rig.server.next()
            assertEquals(listOf(underTapRoute(tap), t0), listOf(underTap.route, rig.clock.now()))
            underTap.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
        }

    @Test
    fun aPressTheOutboxRefusesToKeepIsSaidNotSavedNeverDoneNothingRecordedThePhoneStillLockedAndAnEmergencyUnlockThrows(): Unit =
        runBlocking {
            // Claude Review on #499: `record` leaves its own failed write to its caller, which must say so
            // (rule 5); the unlock contract: never a record dropped as if kept.
            val rig = rig()
            rig.tapIn()
            refuseRecords(rig.outbox)
            assertEquals(UnlockFailure.NotSaved, rig.engine.pressUnlock())
            assertFailsWith<SQLiteException> { rig.engine.emergencyUnlock() }
            val state = rig.engine.updates.value
            assertEquals(listOf(focused, emptyList<OutboxRecord>()), listOf(state.standing, state.queued))
            assertEquals(session().endsAt, state.shieldedUntil(t0))
            assertEquals(listOf(emptyList<OutboxRecord>(), focused), listOf(rig.outbox.records(), rig.outbox.standing()))
            // The file takes it again: held again, the press is kept.
            refuseRecords(rig.outbox, false)
            assertNull(rig.engine.pressUnlock())
            assertEquals(unlocked, rig.engine.updates.value.standing)
        }

    @Test
    fun aReasonTheFileWontKeepIsSaidNotSavedBackToFocusTheFileWontKeepTooAndUnlockedInNoSessionBackToFocusRecordsNothing(): Unit =
        runBlocking {
            val rig = rig()
            assertNull(rig.engine.backToFocus())
            assertEquals(emptyList(), rig.engine.updates.value.queued)
            rig.tapIn()
            assertNull(rig.engine.pressUnlock())
            refuseUpdates(rig.outbox)
            assertEquals(ReasonFailure.NotSaved, rig.engine.explain(UnlockReason.Other))
            refuseRecords(rig.outbox)
            assertEquals(RefocusFailure.NotSaved, rig.engine.backToFocus())
            assertEquals(listOf(unlocked, unlocked), listOf(rig.engine.updates.value.standing, rig.outbox.standing()))
        }

    @Test
    fun protectionOffReportedInASessionIsKnownUntilThePhonesNextTapWhichARefocusOutOfItNeedsAcrossARelaunchToo(): Unit =
        runBlocking {
            // A2.
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.ProtectionOff("s"))
            assertEquals("s", rig.engine.updates.value.reportedOff)
            assertEquals("s", engine(rig.outbox).updates.value.reportedOff)
            rig.engine.record(Change.Tap("tag"))
            assertNull(rig.engine.updates.value.reportedOff)
        }

    @Test
    fun anUnlockAnsweredLatePuttingTheLockBackWithNoReturnOfThisPhonesSinceIsSaidUntilThePhonesNextChangeWithThePhonesOrderOrWithNone(): Unit =
        runBlocking {
            // A10, A12. Focus says it (AN10e): sent with the phone's order, a return the order can't place; with none, the clock
            // behind and how to set it, Android's Settings path (AS5-Focus-clock); in another session, nothing.
            for (ordered in listOf(true, false)) {
                val rig = rig()
                if (!ordered) rig.outbox.setState(Outbox.Key.Install, null)
                rig.tapIn()
                rig.engine.record(Change.Unlock("s", null))
                rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
                val state = rig.until { it.queued.isEmpty() }
                assertEquals(listOf(focused, Superseded("s", ordered)), listOf(state.standing, state.superseded), "ordered $ordered")
                // Late, it is on no chip, and its reason never changes (A20): nothing to pick for.
                assertNull(state.recordedUnlock, "ordered $ordered")
                assertEquals(
                    if (ordered) {
                        "Bali recorded your unlock, but Bali on another phone, or from before a reinstall, put you back in focus after it. Hold to unlock again if you need to."
                    } else {
                        "Bali recorded your unlock, but this phone's clock was behind, so it counted as before you went back to focus. Turn on automatic time in Settings → System → Date & time, then hold to unlock again."
                    },
                    FocusWords(state, null, t0, newYorkZone, usShortTime).superseded, "ordered $ordered",
                )
                val elsewhere = state.copy(standing = Standing.InSession(session("t"), ParticipationState.Focused))
                assertNull(FocusWords(elsewhere, null, t0, newYorkZone, usShortTime).superseded, "ordered $ordered")
                rig.engine.record(Change.Unlock("s", null))
                assertNull(rig.engine.updates.value.superseded, "ordered $ordered")
                rig.stop()
            }
        }

    @Test
    fun butWithATapOfThisPhonesSinceRefusedStuckStillItsOwnNothingIsSaidTheLateUnlockIsNoSurpriseToIt(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.firstOrNull()?.stuck == true }
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(404, Answer.refused("session_not_found"))
            rig.until { state -> state.queued.size == 2 && state.queued.all { it.stuck } }
            rig.clock.advance(Outbox.BACKOFF_CAP.multipliedBy(2))
            rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
            val state = rig.until { it.queued.size == 1 }
            assertEquals(focused, state.standing)
            assertNull(state.superseded)
        }
}

/**
 * #167: the lock back on in the class the phone was protection off in puts it back where it stood, focused
 * or still unlocked, with no re-tap: the engine's half of BaliOutbox's BackOnTests `once`, `lateUnlocked`,
 * `unlockedSince` and `notKnown`, recorded here by hand; the lock's half, through rule 3's check, is
 * LockBackOnTest's (AN7b).
 */
class BackOnTest : EngineFiles() {
    /** Tapped into session s, and, [unlocked], out of focus by an Emergency Unlock the server recorded; then protection off, its report answered. */
    private suspend fun off(unlocked: Boolean = false): Rig {
        val rig = rig()
        rig.tapIn()
        if (unlocked) {
            rig.engine.emergencyUnlock()
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.Unlocked) }
        }
        rig.engine.record(Change.ProtectionOff("s"))
        rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
        return rig
    }

    @Test
    fun madeOnceASecondLockBackOnFindsThePhoneBackWhereItStoodAndRecordsNothingNeverFocusOverTheEmergencyUnlockTheFirstReturnedTo(): Unit =
        runBlocking {
            val rig = off(unlocked = true)
            assertNotNull(rig.engine.record(Change.ProtectionOn("s")))
            assertNull(rig.engine.record(Change.ProtectionOn("s")))
            val state = rig.engine.updates.value
            assertEquals(unlocked, state.standing)
            assertEquals(listOf(Change.ProtectionOn("s")), state.queued.map { it.change })
            assertEquals(unlocked, rig.outbox.standing())
            // The lock going off and coming back is no turn of the student's: the unlock's reason is still
            // theirs to change (A20; santa's round 1).
            assertNotNull(state.recordedUnlock)
        }

    @Test
    fun unlockedAndTheLockBackOnsAnswerLateProtectionOffAgainByTheServersTruthTheNextLockBackOnStillReturnsToUnlockedNeverFocus(): Unit =
        runBlocking {
            val rig = off(unlocked = true)
            rig.engine.record(Change.ProtectionOn("s"))
            rig.server.next(protectionOnRoute).reply(200, Answer.replay(state = "protection_off"))
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            rig.engine.record(Change.ProtectionOn("s"))
            assertEquals(unlocked, rig.engine.updates.value.standing)
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn(state = "unlocked"))
            assertNull(rig.until { it.queued.isEmpty() && it.standing == unlocked }.shieldedUntil(rig.clock.now()))
        }

    @Test
    fun anEmergencyUnlockMadeAfterALockBackOnTheServerHasYetToTakeTheTruthThenProtectionOffAgainTheNextLockBackOnReturnsToUnlocked(): Unit =
        runBlocking {
            // That unlock is the latest turn the server recorded (santa's round 2).
            val rig = off()
            rig.engine.record(Change.ProtectionOn("s"))
            assertEquals(focused, rig.engine.updates.value.standing)
            val first = rig.server.next(protectionOnRoute)
            rig.engine.emergencyUnlock()
            first.reply(200, Answer.replay(state = "protection_off"))
            rig.server.next(unlockRoute).reply(200, Answer.unlockUnderOff())
            rig.until { it.queued.isEmpty() && it.standing == inSession(ParticipationState.ProtectionOff) }
            rig.engine.record(Change.ProtectionOn("s"))
            assertEquals(unlocked, rig.engine.updates.value.standing)
            rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn(state = "unlocked"))
            assertNull(rig.until { it.queued.isEmpty() && it.standing == unlocked }.shieldedUntil(rig.clock.now()))
        }

    @Test
    fun whereThePhoneStoodBeforeProtectionOffNotKnownTheLockBackOnPassesTheUnlockGuardAnEmergencyUnlockStillQueuedThereKeepsItUnlocked(): Unit =
        runBlocking {
            // AN5c's note: `keepsUnlocked` takes a phone focused already as returned, so no lock back on may
            // bring focus past the guard. Not known, as a build before #167's left the file: iOS's test leaves
            // its unlock's own `offFrom`, and so reaches no guard.
            for ((queued, back) in listOf(true to ParticipationState.Unlocked, false to ParticipationState.Focused)) {
                val (outbox, _) = makeOutbox()
                if (queued) record(outbox, Change.Unlock("s", null))
                record(outbox, Change.ProtectionOff("s"))
                outbox.keep(inSession(ParticipationState.ProtectionOff))
                outbox.setState(Outbox.Key.OffFrom, null)
                val rig = rig(outbox)
                rig.until { it.standing == inSession(ParticipationState.ProtectionOff) }
                rig.engine.record(Change.ProtectionOn("s"))
                assertEquals(inSession(back), rig.engine.updates.value.standing, "unlock queued $queued")
                assertEquals(inSession(back), outbox.standing(), "unlock queued $queued")
                rig.stop()
            }
        }

    @Test
    fun aReadOfTheFileThatFailsInTheLockBackOnWhereThePhoneStoodOrTheGuardsIsShownAfterTheStepTheGuardDecidingOrThePhoneKeptUnlocked(): Unit =
        runBlocking {
            // The failure shown after the step, as AN5a's `record` shows its own, never hidden by it.
            for ((refused, back) in listOf(KEPT_STATE to ParticipationState.Focused, HOLDS_UNLOCK to ParticipationState.Unlocked)) {
                val refusing = AtomicBoolean(false)
                val outbox = open(temporaryFile(), driver = Watching(stepping = { if (refused in it && refusing.compareAndSet(true, false)) throw SQLiteException("refused") }))
                record(outbox, Change.ProtectionOff("s"))
                outbox.keep(inSession(ParticipationState.ProtectionOff))
                // Where it stood kept unlocked, which a read that worked would return to; or not known.
                outbox.setState(Outbox.Key.OffFrom, if (refused == KEPT_STATE) ParticipationState.Unlocked.wire else null)
                val rig = rig(outbox)
                // The report goes, and is left unanswered: nothing else reads the file meanwhile.
                rig.server.next(protectionOffRoute)
                refusing.set(true)
                assertNotNull(rig.engine.record(Change.ProtectionOn("s")))
                val state = rig.engine.updates.value
                assertEquals(listOf(inSession(back), Link.StorageFailed), listOf(state.standing, state.link), refused)
                assertEquals(inSession(back), outbox.standing(), refused)
                rig.stop()
            }
        }

    private companion object {
        /** The first read of the rules' own state, where the phone stood before protection off (`Outbox.offFrom`). */
        const val KEPT_STATE = "SELECT value FROM outboxState WHERE key = ?"

        /** The unlock guard's read of the file, `Outbox.holdsUnlock`'s SQL. */
        const val HOLDS_UNLOCK = "SELECT 1 FROM outbox WHERE kind = 'unlock' AND COALESCE(orderSeq, seq) > ?"
    }
}
