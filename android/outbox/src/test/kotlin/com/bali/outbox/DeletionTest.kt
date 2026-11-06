package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.UnlockReason
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/**
 * The outbox before an account deletion (C4): BaliOutbox's DeletionOrderTests, and the rules no iOS test
 * reaches through the outbox alone: every kind of Emergency Unlock kept, and which refused record holds no
 * deletion back.
 */
class DeletionOrderTest : OutboxFiles() {
    @Test
    fun everyEmergencyUnlockGoesFirstButOneUnderATapStillQueuedThenTheRestInTheOrderThePhoneActedARecordTriedAndPendingHoldingThoseBehind(): Unit =
        runBlocking {
            // A refocus waits for its unlock, an unlock not filed goes nowhere.
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            val underTap = record(outbox, Change.UnlockUnderTap(tap.eventId, null))
            val off = record(outbox, Change.ProtectionOff("s"))
            record(outbox, Change.UnlockUnfiled(null))
            val unlock = record(outbox, Change.Unlock("s", null))
            val refocus = record(outbox, Change.Refocus("s"))
            assertEquals(unlock.eventId, refocus.follows)

            val tried = mutableSetOf<String>()
            suspend fun next(): String? = outbox.nextBeforeDeletion(tried)?.eventId?.also { tried += it }
            assertEquals(unlock.eventId, next())
            assertEquals(tap.eventId, next()) // the refocus waits for its unlock, still queued
            send(outbox, tap, 200, Answer.joined())
            assertEquals(underTap.eventId, next()) // its tap gone, filed in its session
            send(outbox, assertNotNull(current(outbox, underTap.eventId)), 200, Answer.unlocked())
            send(outbox, unlock, 200, Answer.unlocked())
            assertEquals(off.eventId, next())
            send(outbox, off, 200, Answer.protectionOff())
            assertEquals(refocus.eventId, next())
            send(outbox, refocus, 200, Answer.refocused())
            assertNull(next()) // the unlock not filed goes nowhere

            // Tried and still pending, a record holds what the phone did after it.
            val (held, _) = makeOutbox()
            val first = record(held, Change.ProtectionOff("s"))
            record(held, Change.Refocus("s"))
            assertNull(held.nextBeforeDeletion(setOf(first.eventId)))
        }

    @Test
    fun aRefocusWaitsForItsUnlockStuckOrNotWhileARecordTriedAndStuckHoldsNothingBehindIt(): Unit =
        runBlocking {
            // Landing first, the refocus would leave the server's truth unlocked once its unlock lands (nextDue's rule).
            val (outbox, _) = makeOutbox()
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, 400, Answer.badInput)
            val refocus = record(outbox, Change.Refocus("s"))
            assertEquals(unlock.eventId, refocus.follows)
            val report = record(outbox, Change.ProtectionOff("s"))
            assertEquals(report.eventId, outbox.nextBeforeDeletion(setOf(unlock.eventId))?.eventId)
            assertNull(outbox.nextBeforeDeletion(setOf(unlock.eventId, report.eventId)))
        }

    @Test
    fun onceTheApiHasDeletedTheAccountEveryRecordQueuedIsLetGoButAnEmergencyUnlockWhichNeverIs(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            record(outbox, Change.Tap("tag"))
            record(outbox, Change.ProtectionOff("s"))
            val unlock = record(outbox, Change.Unlock("s", null))
            record(outbox, Change.Refocus("s"))
            outbox.accountDeleted()
            assertEquals(listOf(unlock.eventId), outbox.records().map { it.eventId })
        }

    @Test
    fun theDeletionKeepsEveryKindOfEmergencyUnlockAsItWasInItsSessionUnderItsTapNotFiledYetARefiledOnesFollowUpAndOneStuck(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val stuck = record(outbox, Change.Unlock("s", UnlockReason.Nurse))
            send(outbox, stuck, 400, Answer.badInput)
            val tap = record(outbox, Change.Tap("tag"), standing = Standing.InSession(session("t"), ParticipationState.Focused))
            record(outbox, Change.UnlockUnderTap(tap.eventId, null), standing = Standing.InSession(session("t"), ParticipationState.Unlocked))
            // Its tap armed: filed again in the session it was made in, a follow-up of its own (B6d).
            send(outbox, tap, 200, Answer.armed)
            record(outbox, Change.UnlockUnfiled(UnlockReason.Bathroom))
            val again = record(outbox, Change.Tap("tag"))
            record(outbox, Change.UnlockUnderTap(again.eventId, null))
            record(outbox, Change.ProtectionOff("s"))
            val unlocks = outbox.records().filter { it.change.isUnlock }
            assertEquals(5, unlocks.size, "${outbox.records()}")
            outbox.accountDeleted()
            assertEquals(unlocks, outbox.records())
            assertTrue(assertNotNull(current(outbox, stuck.eventId)).stuck)
        }

    @Test
    fun aTapTheServerRefusedHoldsNoDeletionBackATapNoAnswerSettledAndEveryUnlockRefusedOrNotDo(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val refused = record(outbox, Change.Tap("tag"))
            send(outbox, refused, 404, Answer.unknownBlock)
            val unanswered = record(outbox, Change.Tap("tag"))
            var now = t0
            repeat(Outbox.BOUND) {
                send(outbox, unanswered, 500, at = now)
                now = assertNotNull(current(outbox, unanswered.eventId)).nextAttemptAt
            }
            assertTrue(assertNotNull(current(outbox, unanswered.eventId)).stuck) // at the bound
            val unlock = record(outbox, Change.Unlock("s", null))
            send(outbox, unlock, 400, Answer.badInput)
            val held = record(outbox, Change.ProtectionOff("s"))
            val records = outbox.records().associateBy { it.eventId }
            assertTrue(assertNotNull(records[refused.eventId]).refusedForGood)
            // Stuck at the bound, never refused: the server may yet record it.
            assertFalse(assertNotNull(records[unanswered.eventId]).refusedForGood)
            assertFalse(assertNotNull(records[unlock.eventId]).refusedForGood)
            assertFalse(assertNotNull(records[held.eventId]).refusedForGood)
        }
}

/** Delete account on Me (C4b): BaliOutbox's DeletingTests, their ways on; their words are AN10's. */
class DeletingTest {
    @Test
    fun theQuestionIsAskedFromNothingAndCancelledBackToItDeleteAccountBeginsTheDeletionTryAgainOnlyWhereItCanHelpAndItsScreenShowsFromThePressToTheEnd() {
        var deleting: Deleting = Deleting.None
        assertFalse(deleting.shows)
        deleting = deleting.cancel()
        assertEquals(Deleting.None, deleting)
        assertNull(deleting.start())
        deleting = deleting.ask()
        assertEquals(Deleting.Asking, deleting)
        assertFalse(deleting.shows)
        deleting = deleting.cancel()
        assertEquals(Deleting.None, deleting)
        deleting = assertNotNull(deleting.ask().start())
        assertEquals(Deleting.Busy, deleting)
        assertTrue(deleting.shows)
        // Asked again, cancelled or closed: nothing changes under way, and nothing begins another.
        deleting = deleting.ask().cancel().close()
        assertEquals(Deleting.Busy, deleting)
        assertNull(deleting.start())
        for ((answer, retries) in listOf(
            AccountDeletion.UnlockUnsent to true, AccountDeletion.Unread to true,
            AccountDeletion.NotDeleted(SendResult.NetworkError) to true,
            AccountDeletion.SignInFirst to false, AccountDeletion.TeacherHasClasses to false,
        )) {
            val stopped = Deleting.Busy.answered(answer)
            assertTrue(stopped.shows, "$answer")
            assertEquals(retries, assertIs<Deleting.Stopped>(stopped, "$answer didn't stop").stop.retries, "$answer")
            assertEquals(if (retries) Deleting.Busy else null, stopped.start(), "$answer")
            assertEquals(Deleting.None, stopped.close(), "$answer")
        }
        var pending = Deleting.Busy.answered(AccountDeletion.SignInNotDeleted(SendResult.NetworkError))
        assertEquals(Deleting.Pending, pending)
        assertTrue(pending.shows)
        assertEquals(Deleting.Pending, pending.close())
        pending = assertNotNull(pending.start())
        assertEquals(Deleting.Busy, pending)
        val done = pending.answered(AccountDeletion.Deleted)
        assertEquals(Deleting.Done, done)
        assertTrue(done.shows)
        assertNull(done.start())
        assertEquals(Deleting.None, done.close())
        // An answer to no deletion under way changes nothing.
        assertEquals(Deleting.Asking, Deleting.Asking.answered(AccountDeletion.Deleted))
    }

    @Test
    fun aChangeOfWhoIsSignedInTakesTheQuestionAndAStopWithItAndHoldsTheDeletionUnderWayASignInWaitingToBeDeletedAndTheDoneScreen() {
        val stopped = Deleting.Busy.answered(AccountDeletion.Unread)
        for ((state, after) in listOf(
            Deleting.None to Deleting.None, Deleting.Asking to Deleting.None, stopped to Deleting.None,
            Deleting.Busy to Deleting.Busy, Deleting.Pending to Deleting.Pending, Deleting.Done to Deleting.Done,
        )) {
            assertEquals(after, state.signInChanged(), "$state")
        }
    }

    @Test
    fun theGapsFallbackHasADeletionThatCouldntReachBaliStopOfItsOwnWithTryAgainAndEveryOtherAnswerAsMesNeverATryAgainThatCantHelp() {
        // A sign-in around the 13+ question, answered under 13 (C7): Me's ways on, Claude Review's and santa's round 1.
        fun answered(answer: AccountDeletion, young: Boolean) = Deleting.Busy.answered(answer, underThirteen = young)
        val unreached = AccountDeletion.NotDeleted(SendResult.NetworkError)
        val unfinished = answered(unreached, young = true)
        assertEquals(Deleting.Stopped(Deleting.Stop.Unfinished), unfinished)
        assertEquals(Deleting.Stopped(Deleting.Stop.NotDeleted(SendResult.NetworkError)), answered(unreached, young = false))
        assertEquals(Deleting.Busy, unfinished.start())
        for (answer in listOf(
            AccountDeletion.UnlockUnsent, AccountDeletion.Unread, AccountDeletion.SignInFirst,
            AccountDeletion.TeacherHasClasses, AccountDeletion.SignInNotDeleted(SendResult.NetworkError),
            AccountDeletion.NotDeleted(SendResult.Status(500)), AccountDeletion.NotDeleted(SendResult.Status(429)),
        )) {
            assertEquals(answered(answer, young = false), answered(answer, young = true), "$answer")
        }
        for (answer in listOf(AccountDeletion.SignInFirst, AccountDeletion.TeacherHasClasses)) {
            assertNull(answered(answer, young = true).start(), "$answer")
        }
        assertEquals(Deleting.Done, answered(AccountDeletion.Deleted, young = true))
    }
}
