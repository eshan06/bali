package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/** Where an Emergency Unlock is filed (decision 11): OutboxTests' UnlockRouteTests, their part the store settles. */
class UnlockRouteTest : OutboxFiles() {
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

/** A scan that joins no class, its unlock filed again where the student stood (owner's ruling, B6d): OutboxTests' RefiledTests, their part the store settles. */
class RefiledTest : OutboxFiles() {
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
            // Held for its reason as the sync engine holds a press (AN5's `reasonHold`, 15 s on iOS).
            val hold = Duration.ofSeconds(15)
            assertNotNull(outbox.record(Change.UnlockUnderTap(tap.eventId, null), t0, Standing.InSession(session(), ParticipationState.Unlocked), hold))
            send(outbox, tap, 200, Answer.armed)
            val followUp = outbox.records().first { it.change is Change.Unlock }
            assertTrue(outbox.explain(UnlockReason.Nurse, t0, emptySet()))
            assertEquals(UnlockReason.Nurse, current(outbox, followUp.eventId)?.change?.reason)
            val due = assertIs<Outbox.Due.Send>(outbox.nextDue(t0), "the press's hold still holds the follow-up back")
            assertEquals(Change.UnlockUnderTap(tap.eventId, null), due.record.change)
        }
}
