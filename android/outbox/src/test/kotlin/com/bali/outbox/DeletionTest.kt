package com.bali.outbox

import com.bali.core.NoAnswer
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
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

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
    fun onceTheApiHasDeletedTheAccountEveryRecordQueuedIsLetGoAnEmergencyUnlockKeptApartOutOfTheQueue(): Unit =
        runBlocking {
            // AN9j's call (the conductor's, 2026-11-13): never discarded, and never in the queue the next account's sign-in sends.
            val (outbox, _) = makeOutbox()
            record(outbox, Change.Tap("tag"))
            record(outbox, Change.ProtectionOff("s"))
            val unlock = record(outbox, Change.Unlock("s", null))
            record(outbox, Change.Refocus("s"))
            outbox.accountDeleted()
            assertEquals(emptyList(), outbox.records())
            assertEquals(setOf(unlock.eventId), keptApart(outbox).keys)
        }

    @Test
    fun theDeletionKeepsEveryKindOfEmergencyUnlockApartWholeInItsSessionUnderItsTapNotFiledYetARefiledOnesFollowUpAndOneStuck(): Unit =
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
            val rows = unlocks.map { assertNotNull(outbox.dao.record(it.eventId)).row }
            outbox.accountDeleted()
            assertEquals(emptyList(), outbox.records())
            // Each kept as its row held it: its session or its tap, its reason, its time, and its place in what the phone did.
            val kept = keptApart(outbox)
            assertEquals(unlocks.map { it.eventId }.toSet(), kept.keys)
            for (row in rows) {
                val fields = assertNotNull(kept[row.eventId])
                assertEquals(
                    listOf(row.sessionId, row.tapId, row.reason, Times().text(row.recordedAt)),
                    listOf(fields.text("sessionId"), fields.text("tapId"), fields.text("reason"), fields.text("recordedAt")),
                    row.eventId,
                )
                assertEquals(row.orderSeq ?: row.seq, fields["seq"]?.jsonPrimitive?.longOrNull, row.eventId)
            }
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

private const val NOT_DELETED = "Your account isn't deleted"
private const val NOT_FINISHED = "Bali couldn't finish deleting your account"

/** What the deletion's screen says once [answer] comes to it under way, [young] the gap's fallback's. */
private fun said(answer: AccountDeletion, young: Boolean = false): Said? = Deleting.Busy.answered(answer, young).let { if (young) it.saidUnderThirteen else it.said }

/**
 * Delete account on Me (C4b): BaliOutbox's DeletingTests, their ways on and their words (AN10g). New: Bali still starting; and the
 * three lines drawn first (Q9): another account's sign-in landed, with Back alone; a token run out partway, said as the sign-in
 * Bali couldn't check, never as no connection (Q7); and a sign-in that can't delete, with no "older version" (Q8).
 */
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
            // Who is signed in changed meanwhile (AN9h): its Try again would delete the account signed in now.
            AccountDeletion.SignInChanged to false,
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
        // No iOS twin as a type: a phone whose engine hasn't started, the app's to give, said with Try again (BaliApp.swift's
        // `deleteAccount`): nothing was sent, so nothing is deleted.
        val unstarted = Deleting.Stopped(Deleting.Stop.NotStarted)
        assertEquals(listOf<Any?>(true, true, Deleting.Busy), listOf(unstarted.shows, unstarted.stop.retries, unstarted.start()))
        assertEquals(Said(NOT_DELETED, "Bali is still starting. Try again in a moment."), unstarted.said)
    }

    @Test
    fun eachStopIsSaidWithItsWayOnTheDeletionsOwnAnswerInJoinsWordsSignInStillToGoTryAgainDoneAFreshStartUnderWayAMoment() {
        // BaliOutbox's `words`: the teacher's account, the school; an unsent Emergency Unlock and an unread file, another try.
        assertEquals(
            Said(NOT_DELETED, "A teacher's account with classes or blocks is deleted through your school. Ask your school to arrange it."),
            said(AccountDeletion.TeacherHasClasses),
        )
        assertEquals(Said(NOT_FINISHED, "Your Emergency Unlock hasn't reached your teacher yet. Check your connection and try again."), said(AccountDeletion.UnlockUnsent))
        assertEquals(
            Said(NOT_FINISHED, "Bali can't read what your phone saved right now, so it can't delete your account yet. Try again in a moment."),
            said(AccountDeletion.Unread),
        )
        // A deletion sent by a try before, its answer lost, may have landed (C4a): every stop that can follow one claims neither way.
        for (result in listOf(SendResult.NetworkError, SendResult.Status(500), SendResult.Status(429))) {
            assertEquals(Said(NOT_FINISHED, Joining.words(result, null)), said(AccountDeletion.NotDeleted(result)), "$result")
        }
        assertEquals("Can't reach the server. Check your connection and try again.", said(AccountDeletion.NotDeleted(SendResult.NetworkError, NoAnswer.Unreachable))?.body)
        val deleted = "Your account is deleted"
        assertEquals(Said(deleted, "Bali's part is done, but your sign-in isn't deleted yet. Try again to finish."), said(AccountDeletion.SignInNotDeleted(SendResult.Status(500))))
        assertEquals(Said(deleted, "Your sign-in is gone too. If you join Bali again, you start fresh."), said(AccountDeletion.Deleted))
        assertEquals(Said("Deleting your account\u2026", "Bali deletes your account first, then your sign-in. This takes a moment."), Deleting.Busy.said)
        for (quiet in listOf(Deleting.None, Deleting.Asking)) assertNull(quiet.said, "$quiet")
        // Me's question under Delete account, before anything runs: what goes, and that it isn't an Emergency Unlock.
        assertEquals("Delete your account?", Deleting.QUESTION)
        assertEquals(
            "Bali deletes your account, your name and your sign-in. This can't be undone. Lessons you were in still count in your teachers' " +
                "reports, with no name on them. If a class is running, you leave it now and your apps unlock. It isn't an Emergency Unlock.",
            Deleting.CONSEQUENCE,
        )
    }

    @Test
    fun anotherAccountSignedInBeforeTheDeletionWasDoneIsSaidAsThisPhoneSignedInToAnotherAccountNowWithBackAloneUnder13Too() {
        // AN9h's stop, drawn first (AS7-Del-changed, Q9): a Try again would start a deletion of the account signed in now, so Back
        // alone; and a DELETE /v1/me with no answer may have landed first, so the title claims neither way.
        for (young in listOf(false, true)) {
            val stopped = assertIs<Deleting.Stopped>(Deleting.Busy.answered(AccountDeletion.SignInChanged, young))
            assertEquals(Deleting.Stop.SignInChanged, stopped.stop)
            assertEquals(
                Said(NOT_FINISHED, "This phone is signed in to another account now, so Bali stopped. Sign out and sign in to your own account, then delete it."),
                if (young) stopped.saidUnderThirteen else stopped.said,
            )
            assertFalse(stopped.stop.retries, "Try again offered")
            assertNull(stopped.start(), "Try again began a deletion")
            assertEquals(Deleting.None, stopped.close())
        }
    }

    @Test
    fun aTokenRunOutPartwayIsSaidAsTheSignInBaliCouldntCheckWithTryAgainNeverAsNoConnectionUnder13TooOnlyNoAnswerFromBaliIsTheConnections() {
        // #553's review and Q7, drawn first (AS7-Del-notoken, Q9): nothing went, so no connection was at fault. Join's 401 line,
        // with Try again; under 13 too, never the gap's fallback's line about the connection.
        val noToken = AccountDeletion.NotDeleted(SendResult.NetworkError, NoAnswer.NoToken)
        for (young in listOf(false, true)) {
            val stopped = assertIs<Deleting.Stopped>(Deleting.Busy.answered(noToken, young))
            assertEquals(Deleting.Stop.NotDeleted(SendResult.NetworkError, NoAnswer.NoToken), stopped.stop, "under 13: $young")
            val words = assertNotNull(said(noToken, young))
            assertEquals(Said(NOT_FINISHED, "Bali couldn't check your sign-in. Try again."), words, "under 13: $young")
            assertEquals(Joining.words(SendResult.Status(401), null), words.body)
            for (connection in listOf("connection", "reach", "offline", "internet")) assertFalse(connection in words.body.lowercase(), "said as no connection: ${words.body}")
            assertEquals(Deleting.Busy, stopped.start())
        }
        // No answer from Bali is the connection's: Me's line, and under 13 the gap's fallback's own.
        val unreached = AccountDeletion.NotDeleted(SendResult.NetworkError, NoAnswer.Unreachable)
        assertEquals("Can't reach the server. Check your connection and try again.", said(unreached)?.body)
        assertEquals(Deleting.Stopped(Deleting.Stop.Unfinished), Deleting.Busy.answered(unreached, underThirteen = true))
    }

    @Test
    fun aSignInThatCantDeleteItselfOrCantBeReadNowNamesNoOlderVersionOfBaliItsWayOnSigningOutAndInAgainWithBackAlone() {
        // Q8, drawn first (AS7-Del-signinfirst, Q9): every Android build asks for the scope DeleteUser needs (the Words board), so
        // the iPhone's "from an older version of Bali" has no twin; nothing was sent, so the account isn't deleted.
        val stopped = assertIs<Deleting.Stopped>(Deleting.Busy.answered(AccountDeletion.SignInFirst))
        val words = assertNotNull(stopped.said)
        assertEquals(Said(NOT_DELETED, "Bali can't delete your account with this sign-in. Sign out and sign in again, then delete your account."), words)
        for (older in listOf("older version", "version of bali", "update")) assertFalse(older in words.body.lowercase(), "names an older version: ${words.body}")
        assertFalse(stopped.stop.retries)
        assertNull(stopped.start())
    }

    @Test
    fun theGapsFallbackSaysTheStopScreensTitleOverTheDeletionUnderWayAndDoneAndOneThatCouldntReachBaliEveryOtherStopAsMesSaysIt() {
        // BaliOutbox's `underThirteen`, its words: the owner's (2026-10-06), final for the run once done.
        assertEquals("Bali isn't available for you yet", AgeCheck.NOT_YET)
        assertEquals("Ask your teacher how to take part in class without the app.", AgeCheck.ASK_TEACHER)
        for (quiet in listOf(Deleting.None, Deleting.Asking)) assertNull(quiet.saidUnderThirteen, "$quiet")
        assertEquals(Said(AgeCheck.NOT_YET, "Bali is deleting your account. This takes a moment."), Deleting.Busy.saidUnderThirteen)
        assertEquals(
            Said(AgeCheck.NOT_YET, "Bali couldn't finish deleting your account. Check your connection and try again."),
            said(AccountDeletion.NotDeleted(SendResult.NetworkError, NoAnswer.Unreachable), young = true),
        )
        for (answer in listOf(
            AccountDeletion.UnlockUnsent, AccountDeletion.Unread, AccountDeletion.SignInFirst, AccountDeletion.TeacherHasClasses,
            AccountDeletion.SignInNotDeleted(SendResult.NetworkError), AccountDeletion.NotDeleted(SendResult.Status(500)),
            AccountDeletion.NotDeleted(SendResult.Status(429)), AccountDeletion.SignInChanged,
            AccountDeletion.NotDeleted(SendResult.NetworkError, NoAnswer.NoToken),
        )) {
            assertEquals(said(answer), said(answer, young = true), "$answer")
        }
        assertEquals("Your account is deleted", said(AccountDeletion.SignInNotDeleted(SendResult.NetworkError), young = true)?.title)
        assertEquals(
            Said(AgeCheck.NOT_YET, "Bali deleted your account. Ask your teacher how to take part in class without the app."),
            said(AccountDeletion.Deleted, young = true),
        )
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
            AccountDeletion.SignInChanged,
        )) {
            assertEquals(answered(answer, young = false), answered(answer, young = true), "$answer")
        }
        for (answer in listOf(AccountDeletion.SignInFirst, AccountDeletion.TeacherHasClasses, AccountDeletion.SignInChanged)) {
            assertNull(answered(answer, young = true).start(), "$answer")
        }
        assertEquals(Deleting.Done, answered(AccountDeletion.Deleted, young = true))
    }
}
