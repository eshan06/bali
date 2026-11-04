package com.bali.outbox

import com.bali.core.ActionOrder
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.UnlockDisposition
import com.bali.core.UnlockReason
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.runBlocking

/** The order records go in: OutboxTests' OrderTests, and the rules of `nextDue` and `retryNow` no iOS test reaches through the outbox. */
class OrderTest : OutboxFiles() {
    @Test
    fun inTheOrderThePhoneActedAnUnlockGoesAheadOfALaterRefocusAndNothingOvertakesItWhileItBacksOff(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val unlock = record(outbox, Change.Unlock("s", null))
            val refocus = record(outbox, Change.Refocus("s"))
            assertEquals(Outbox.Due.Send(unlock), outbox.nextDue(t0))

            // No answer: the unlock backs off, and the refocus, due since it was made, waits with it.
            send(outbox, unlock, null)
            assertEquals(Outbox.Due.Wait(at(2)), outbox.nextDue(t0))
            // So does a 5xx, short of the bound.
            val retried = assertNotNull(current(outbox, unlock.eventId))
            assertEquals(Outbox.Due.Send(retried), outbox.nextDue(at(2)))
            send(outbox, retried, 500, at = at(2))
            assertEquals(Outbox.Due.Wait(at(6)), outbox.nextDue(at(3)))

            send(outbox, retried, 200, Answer.recorded, at(6))
            assertEquals(Outbox.Due.Send(refocus), outbox.nextDue(at(6)))
        }

    @Test
    fun aPendingRecordHoldsEveryRecordBehindItWhateverTheirKindsUntilItIsAnswered(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            val unlock = record(outbox, Change.Unlock("s", null))
            record(outbox, Change.ProtectionOff("s"))
            send(outbox, tap, null)
            assertEquals(Outbox.Due.Wait(at(2)), outbox.nextDue(at(1)))
            send(outbox, tap, 502, at = at(2))
            assertEquals(Outbox.Due.Wait(at(6)), outbox.nextDue(at(5)))
            send(outbox, tap, 200, Answer.joined(), at(6))
            assertEquals(Outbox.Due.Send(unlock), outbox.nextDue(at(6)))
        }

    @Test
    fun aKeptRecordNeverBlocksTheOnesBehindItRefusedOrStuckAtTheBoundItStepsAsideAndIsRetriedAmongThem(): Unit =
        runBlocking {
            for ((status, body) in listOf(409 to Answer.badInput, 500 to "")) {
                val (outbox, _) = makeOutbox()
                val tap = record(outbox, Change.Tap("tag"))
                val unlock = record(outbox, Change.Unlock("s", null))
                val report = record(outbox, Change.ProtectionOff("s"))
                var now = t0
                while (current(outbox, tap.eventId)?.stuck == false) {
                    assertEquals(Outbox.Due.Send(assertNotNull(current(outbox, tap.eventId))), outbox.nextDue(now), "$status")
                    send(outbox, tap, status, body, now)
                    now = assertNotNull(current(outbox, tap.eventId)).nextAttemptAt
                }
                val stuck = assertNotNull(current(outbox, tap.eventId))
                // Stuck and backing off, the tap no longer holds the unlock or the report behind it.
                val before = stuck.nextAttemptAt.minusMillis(500)
                assertEquals(Outbox.Due.Send(unlock), outbox.nextDue(before), "$status")
                send(outbox, unlock, 200, Answer.recorded, before)
                assertEquals(Outbox.Due.Send(report), outbox.nextDue(before), "$status")
                // Due again, it goes first: it is still ahead of them.
                assertEquals(Outbox.Due.Send(stuck), outbox.nextDue(stuck.nextAttemptAt), "$status")
                // With only it left, the outbox waits for it.
                send(outbox, report, 200, Answer.applied, before)
                assertEquals(Outbox.Due.Wait(stuck.nextAttemptAt), outbox.nextDue(before), "$status")
            }
        }

    @Test
    fun aRefocusIsNeverSentBeforeTheUnlockItReturnsFromIsRecordedEvenWithThatUnlockStuckWhileTheRestGoOn(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, 400, Answer.badInput)
            val refocus = record(outbox, Change.Refocus("s"))
            val report = record(outbox, Change.ProtectionOff("s"))
            // The unlock is stuck, so it holds nothing, but its refocus.
            assertEquals(Outbox.Due.Send(report), outbox.nextDue(t0))
            send(outbox, report, 200, Answer.applied)
            assertEquals(Outbox.Due.Wait(at(2)), outbox.nextDue(t0))
            assertEquals(Outbox.Due.Send(assertNotNull(current(outbox, unlock.eventId))), outbox.nextDue(at(9)))

            // Recorded at last: its refocus follows.
            send(outbox, unlock, 200, Answer.recorded, at(9))
            assertEquals(Outbox.Due.Send(refocus), outbox.nextDue(at(9)))
        }

    @Test
    fun aRefocusWaitsOnlyOnItsOwnUnlockNotOnAnOlderOneStillStuckNorOnAnotherSessions(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val older = record(outbox, Change.Unlock("s", null))
            send(outbox, older, 400, Answer.badInput)
            val own = record(outbox, Change.Unlock("s", null))
            send(outbox, own, 200, Answer.recorded)
            val refocus = record(outbox, Change.Refocus("s"))
            assertEquals(Outbox.Due.Send(refocus), outbox.nextDue(t0))

            val (other, _) = makeOutbox()
            val unlock = record(other, Change.Unlock("s", null))
            send(other, unlock, 400, Answer.badInput)
            val elsewhere = record(other, Change.Refocus("t"))
            assertEquals(Outbox.Due.Send(elsewhere), other.nextDue(t0))
        }

    @Test
    fun idleOnlyWhenNothingIsQueuedARefocusWaitingOnItsStuckUnlockWaitsWithIt(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            assertEquals(Outbox.Due.Idle, outbox.nextDue(t0))
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, 400, Answer.badInput)
            val refocus = record(outbox, Change.Refocus("s"))
            assertEquals(Outbox.Due.Wait(at(2)), outbox.nextDue(t0))
            send(outbox, unlock, 200, Answer.recorded, at(2))
            send(outbox, refocus, 200, Answer.applied, at(2))
            assertEquals(Outbox.Due.Idle, outbox.nextDue(at(2)))
        }

    // B6b's rule for the drain, which iOS's tests reach through the engine (UnreadUnlockTests).
    @Test
    fun anUnlockNotFiledYetGoesNowhereHoldingNothingBehindItAndOnceFiledGoesInItsPlace(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val unfiled = record(outbox, Change.UnlockUnfiled(UnlockReason.Nurse))
            assertEquals(Outbox.Due.Idle, outbox.nextDue(t0))
            // Behind it, a record goes at once.
            val tap = record(outbox, Change.Tap("tag"))
            assertEquals(Outbox.Due.Send(tap), outbox.nextDue(t0))
            // Filed where the phone stands, it goes first: it is ahead of the tap.
            assertTrue(outbox.file(Standing.InSession(session(), ParticipationState.Unlocked)))
            val filed = assertNotNull(current(outbox, unfiled.eventId))
            assertEquals(Change.Unlock("s", UnlockReason.Nurse), filed.change)
            assertEquals(Outbox.Due.Send(filed), outbox.nextDue(t0))
        }

    @Test
    fun theStudentsRetryMakesEveryQueuedRecordDueNowAStuckOneTooAndChangesNothingElse(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            val unlock = record(outbox, Change.Unlock("s", null))
            record(outbox, Change.ProtectionOff("s"))
            send(outbox, tap, 409, Answer.refused("event_id_conflict"))
            send(outbox, unlock, null)
            val before = outbox.records()
            assertEquals(listOf(at(2), at(2), t0), before.map { it.nextAttemptAt })
            outbox.retryNow(at(1))
            // Due now, but a record due already: it keeps its time.
            val after = outbox.records()
            assertEquals(listOf(at(1), at(1), t0), after.map { it.nextAttemptAt })
            // Stuck stays stuck, every count and answer stays, and the order holds.
            assertEquals(before.map { it.copy(nextAttemptAt = t0) }, after.map { it.copy(nextAttemptAt = t0) })
            assertEquals(Outbox.Due.Send(after[0]), outbox.nextDue(at(1)))
        }
}

/** What holds the phone's reads: OutboxTests' AwaitingTests, and `holdsUnlock`'s rules no iOS test reaches through the outbox. */
class AwaitingTest : OutboxFiles() {
    @Test
    fun everyRecordStillPendingAwaitsItsAnswerARefusedTapNoLongerDoesAsItsFirstAnswerCame(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            record(outbox, Change.Unlock("s", null))
            assertEquals(2, outbox.awaiting())
            send(outbox, tap, null)
            send(outbox, tap, 503)
            assertEquals(2, outbox.awaiting())
            send(outbox, tap, 409, Answer.badInput)
            assertEquals(1, outbox.awaiting())
        }

    @Test
    fun anUnlockTheServerRefusesOrLeavesUnsettledToTheBoundStopsHoldingReadsButStillGuardsItsSession(): Unit =
        runBlocking {
            for ((status, body, sends) in listOf(Triple(400, Answer.badInput, 1), Triple(500, "", Outbox.BOUND))) {
                val (outbox, _) = makeOutbox()
                val unlock = record(outbox, Change.Unlock("s", UnlockReason.Nurse))
                for (sent in 1..sends) {
                    assertEquals(1, outbox.awaiting(), "$status")
                    send(outbox, unlock, status, body, at(sent.toLong()))
                }
                assertEquals(0, outbox.awaiting(), "$status")
                assertTrue(outbox.holdsUnlock("s"), "$status")
                assertFalse(outbox.holdsUnlock("t"), "$status")
                // Its refocus waits on it unsent, and so awaits nothing either: the server has seen neither.
                record(outbox, Change.Refocus("s"))
                assertEquals(0, outbox.awaiting(), "$status")
                // Recorded at last: the unlock is gone, and its refocus is on its way.
                send(outbox, unlock, 200, Answer.recorded, at(100))
                assertFalse(outbox.holdsUnlock("s"), "$status")
                assertEquals(1, outbox.awaiting(), "$status")
            }
        }

    @Test
    fun aRefocusBehindAPendingUnlockAwaitsWithIt(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, null)
            record(outbox, Change.Refocus("s"))
            assertEquals(2, outbox.awaiting())
        }

    // B6b's rule for the reads, which iOS's tests reach through the engine (UnreadUnlockTests).
    @Test
    fun anUnlockNotFiledYetAwaitsNothingAndGuardsEverySessionItMayBeAnyUntilFiledInOne(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            record(outbox, Change.UnlockUnfiled(null))
            assertEquals(0, outbox.awaiting())
            assertTrue(outbox.holdsUnlock("s") && outbox.holdsUnlock("t"))
            outbox.file(Standing.InSession(session(), ParticipationState.Unlocked))
            assertEquals(1, outbox.awaiting())
            assertTrue(outbox.holdsUnlock("s"))
            assertFalse(outbox.holdsUnlock("t"))
        }

    // A12's order for the guard (B6d), which iOS's tests reach through the engine (RefiledTests' afterThePress).
    @Test
    fun anUnlockGuardsItsSessionOverOnlyWhatThePhoneDidBeforeItAFollowUpFromItsPresssPlaceNotItsOwn(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val scan = record(outbox, Change.Tap("W3RD8K2QAN"))
            val press = assertNotNull(outbox.record(Change.UnlockUnderTap(scan.eventId, null), t0, Standing.InSession(session(), ParticipationState.Unlocked)))
            val retap = record(outbox, Change.Tap("T7XK2M9QPF"))
            // Under a tap still queued, it may be any session's: over every record made before it.
            val pressSeq = assertNotNull(press.order).seq
            assertTrue(outbox.holdsUnlock("t", after = pressSeq - 1))
            assertFalse(outbox.holdsUnlock("t", after = pressSeq))
            // The scan armed: the follow-up, the newest row, stands in the press's place, behind the re-tap.
            send(outbox, scan, 200, Answer.armed)
            val followUp = outbox.records().single { it.change == Change.Unlock("s", null) }
            assertEquals(pressSeq, followUp.order?.seq)
            assertTrue(outbox.holdsUnlock("s", after = pressSeq - 1))
            assertFalse(outbox.holdsUnlock("s", after = assertNotNull(retap.order).seq))
            assertFalse(outbox.holdsUnlock("t"))
        }
}

/** An unlock is never discarded: OutboxTests' UnlockSafetyTests. */
class UnlockSafetyTest : OutboxFiles() {
    /**
     * Answers of every shape: none; each outcome of each table, with a session and without; one no
     * build knows; bodies that don't decode; refusals; the transport's statuses.
     */
    private val answers: List<Pair<Int?, String>> =
        listOf(
            null to "", 200 to Answer.applied, 200 to Answer.recorded, 200 to """{"outcome":"replay"}""",
            200 to """{"outcome":"joined","session":{"id":"s","classId":"c","endsAt":"2026-09-24T09:50:00.000Z"},"state":"focused"}""",
            200 to Answer.armed, 200 to """{"outcome":"replay","session":null}""", 200 to """{"outcome":"what"}""", 200 to "{",
            204 to "", 302 to "", 400 to Answer.badInput, 401 to "", 404 to Answer.badInput, 408 to "", 409 to Answer.badInput,
            429 to "", 500 to "", 503 to "<html>",
        )

    @Test
    fun aRandomWalkOfRecordsAndSendsDueOrNotDeletesAnUnlockOnlyWhenASendSaysRecordedOneNotFiledYetFiledAndAScansFollowUpIncluded(): Unit =
        runBlocking {
            var filed = 0
            var followUps = 0
            for (seed in 1..12) {
                // Seeded, so a walk that fails fails again.
                val random = Random(seed)
                val (outbox, _) = makeOutbox(random = 0.5)
                val unrecorded = mutableSetOf<String>()
                val presses = mutableSetOf<ActionOrder?>()
                var now = t0
                for (step in 0 until 120) {
                    now = now.plusSeconds(random.nextLong(0, 90))
                    val session = listOf("s", "t").random(random)
                    val stood = Standing.InSession(SessionView(session, "c", at(3000)), ParticipationState.Unlocked)
                    when (random.nextInt(0, 11)) {
                        0 -> outbox.record(Change.Tap("tag"), now)
                        1 -> outbox.record(Change.Refocus(session), now)
                        2 -> outbox.record(Change.ProtectionOff(session), now)
                        3 -> outbox.protectionRestored()
                        4 -> {
                            // Of the session; filed under the latest tap queued (decision 11), made where
                            // the phone stood in a session or not (B6d); or not filed yet (B6b).
                            val tap = outbox.records().lastOrNull { it.change is Change.Tap }
                            val pick = random.nextInt(0, 3)
                            val change =
                                when {
                                    tap != null && pick == 0 -> Change.UnlockUnderTap(tap.eventId, null)
                                    pick == 1 -> Change.UnlockUnfiled(null)
                                    else -> Change.Unlock(session, null)
                                }
                            val unlock = assertNotNull(outbox.record(change, now, if (random.nextBoolean()) stood else null))
                            unrecorded += unlock.eventId
                            presses += unlock.order
                        }
                        10 -> {
                            val before = outbox.records().count { it.change.isUnfiled }
                            outbox.file(listOf(Standing.Out, Standing.Waiting, stood).random(random))
                            if (outbox.records().count { it.change.isUnfiled } < before) filed += 1
                        }
                        in 5..7 -> {
                            val due = outbox.nextDue(now) as? Outbox.Due.Send
                            if (due != null) {
                                val (status, body) = answers.random(random)
                                if (send(outbox, due.record, status, body, now) == Disposition.Unlock(UnlockDisposition.Recorded)) {
                                    unrecorded -= due.record.eventId
                                }
                            }
                        }
                        else -> {
                            val any = outbox.records().randomOrNull(random)
                            if (any != null) {
                                val (status, body) = answers.random(random)
                                if (send(outbox, any, status, body, now) == Disposition.Unlock(UnlockDisposition.Recorded)) {
                                    unrecorded -= any.eventId
                                }
                            }
                        }
                    }
                    val queued = outbox.records().filter { it.change.isUnlock }
                    for (minted in queued.filter { it.eventId !in unrecorded }) {
                        // A scan's follow-up (B6d): a session unlock, in its press's place.
                        if (minted.change !is Change.Unlock || minted.order !in presses) fail("seed $seed, step $step: ${minted.change}")
                        unrecorded += minted.eventId
                        followUps += 1
                    }
                    assertEquals(unrecorded, queued.map { it.eventId }.toSet(), "seed $seed, step $step")
                }
            }
            assertTrue(filed > 0 && followUps > 0, "filed $filed, followed up $followUps")
        }
}
