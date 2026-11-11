package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.ApiErrorReason
import com.bali.core.EndEnrollmentRequest
import com.bali.core.EndEnrollmentResponse
import com.bali.core.EventId
import com.bali.core.MeClass
import com.bali.core.OrUnknown
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.TeacherView
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

// Leaving a class (C6c), over A19's fixtures: BaliOutbox's LeaveTests, `words` AN10's with the words; and new: Cancel and
// the same class's Leave again, its replay still, a deleted sign-in's 409 (C3d), and the not-known standing. And leaving
// through the engine (C6c): LeaveEngineTests, and new: a leave whose caller is cancelled.

/** The route a leave of `e3` goes to. */
private val leaveRoute = "DELETE /v1/enrollments/e3"
private val ended = """{"outcome":"ended","reason":"left_class","endedParticipation":false}"""
private val request = EndEnrollmentRequest(EventId.mint(t0))

/** Classes c, left through enrollment e3, and d, through e5, as `GET /v1/me` names them. */
private val classes = listOf(Answer.inClass("c", enrollment = "e3"), Answer.inClass("d", enrollment = "e5"))

/** Class [id], named [name], as `GET /v1/me` gives it: with the enrollment `e<id>`, or none. */
private fun classRow(id: String, name: String, enrolled: Boolean = true) = MeClass(id, name, TeacherView("Ms. Rivera"), "e$id".takeIf { enrolled }, null)

/** `DELETE /v1/enrollments/e3` as [client] answers it. */
private suspend fun answered(client: ApiClient) = client.leave("e3", request)

/** Leaving a class (C6c): BaliOutbox's LeaveTests. */
class LeaveTest {
    @Test
    fun leaveAsksFirstTheQuestionUnderTheClassPressedWhatWentWrongBeforeGoneCancelTakesItAwayNoneForAClassWithNoEnrollmentNorWhileALeaveIsUnderWayWhichCancelWaitsOutToo(): Unit =
        runBlocking {
            val (p3, p5) = classRow("3", "Period 3") to classRow("5", "Period 5")
            assertEquals(Leaving(), Leaving().ask(classRow("6", "Period 6", enrolled = false)))
            val asked = Leaving().ask(p3)
            assertEquals(listOf<Any?>(p3, false), listOf(asked.asking, asked.busy))
            assertEquals(Leaving(), asked.cancel())
            // What went wrong before: a leave with no answer. Another class's Leave pressed clears it.
            val failed = asked.send(t0).first.left(answered(client(Canned(null))), "e3").first
            assertNotNull(failed.failure)
            val other = failed.ask(p5)
            assertEquals(listOf<Any?>(p5, null), listOf(other.asking, other.failure))
            val busy = other.send(t0).first
            assertEquals(busy, busy.ask(p3).cancel())
            assertEquals(listOf<Any?>(p5, true), listOf(busy.asking, busy.busy))
        }

    @Test
    fun theQuestionShowsUnderTheEnrollmentItWasAskedAboutTheSameClassJoinedAgainSinceIsAnotherEnrollmentWhichShowsNoneAndAClassWithNoEnrollmentIdNeverShowsIt() {
        // Its Leave class would send the old one's leave, answered as already out (santa's round 1).
        val p3 = classRow("3", "Period 3")
        val asked = Leaving().ask(p3)
        assertTrue(asked.asks(p3))
        val rejoined = MeClass("3", "Period 3", null, "e9", null)
        for (row in listOf(rejoined, classRow("3", "Period 3", enrolled = false), classRow("5", "Period 5"))) assertFalse(asked.asks(row), "$row")
        assertFalse(Leaving().asks(p3))
    }

    @Test
    fun aLeaveGoesUnderOneEventIdWhileItIsTheSameEnrollmentsATryAfterNoAnswerIsItsReplayAnotherClasssUnderItsOwnOneAtATimeAndAnAnswerToALeaveTheQuestionDidntSendIsDropped(): Unit =
        runBlocking {
            // Rule 4. The split's list leaves this one out (DECISIONS, AN9f's entry): it is where one leave's two event ids fail.
            val (p3, p5) = classRow("3", "Period 3") to classRow("5", "Period 5")
            assertEquals(Leaving() to null, Leaving().send(t0))
            val (sending, sent) = Leaving().ask(p3).send(t0)
            val first = assertNotNull(sent)
            assertEquals(listOf<Any?>("e3", true), listOf(first.enrollmentId, sending.busy))
            assertEquals(sending to null, sending.send(t0))
            val none = answered(client(Canned(null)))
            assertEquals(sending to false, sending.left(none, "e5"))
            val (unanswered, out) = sending.left(none, "e3")
            val failure = Leaving.Failure(SendResult.NetworkError, null)
            assertEquals(listOf<Any?>(false, false, failure, p3), listOf(out, unanswered.busy, unanswered.failure, unanswered.asking))
            val (retrying, retried) = unanswered.send(at(5))
            val retry = assertNotNull(retried)
            assertEquals(listOf<Any?>(first.request.eventId, null), listOf(retry.request.eventId, retrying.failure))
            // No iOS twin: Cancel, then the same class's Leave again, is its replay all the same.
            val (again, againSent) = retrying.left(none, "e3").first.cancel().ask(p3).send(at(7))
            assertEquals(first.request.eventId, assertNotNull(againSent).request.eventId)
            val (otherSending, otherSent) = again.left(none, "e3").first.cancel().ask(p5).send(at(9))
            val other = assertNotNull(otherSent)
            assertEquals("e5", other.enrollmentId)
            assertNotEquals(first.request.eventId, other.request.eventId)
            val left = answered(fixture("enrollments/left.json"))
            assertEquals(Leaving() to true, otherSending.left(left, "e5"))
            // Nothing asked, nothing sent: an answer changes nothing.
            assertEquals(Leaving() to false, Leaving().left(left, "e5"))
        }

    @Test
    fun aLeaveAsTheApiAnswersItOutItEndedOrTheyWereOutAlreadyTheQuestionGoesRefusedInSessionNotTheirsNotKnownADeletedSignInsOrNoAnswer401429OrAServerErrorEachItsResultAndReasonUnderTheQuestion(): Unit =
        runBlocking {
            // A19's fixtures. Keyed on the status as well as the reason (#134's review): a 403 whose reason this build doesn't know
            // keeps its status, which AN10's words key on, never the join's words for a 403.
            val p3 = classRow("3", "Period 3 \u2014 Algebra II")
            for (name in listOf("left", "left-past-bell", "already-removed")) {
                val (sending, _) = Leaving().ask(p3).send(t0)
                assertEquals(Leaving() to true, sending.left(answered(fixture("enrollments/$name.json")), "e3"), name)
            }
            val later = """{"error":{"code":"forbidden","reason":"a_later_reason","message":"no"}}"""
            val refusals =
                listOf(
                    fixture("enrollments/409-class-in-session.json") to Leaving.Failure(SendResult.Status(409), ApiErrorReason.ClassInSession),
                    fixture("enrollments/404-enrollment-not-found.json") to
                        Leaving.Failure(SendResult.Status(404), ApiErrorReason.EnrollmentNotFound),
                    fixture("enrollments/403-enrollment-not-yours.json") to
                        Leaving.Failure(SendResult.Status(403), ApiErrorReason.EnrollmentNotYours),
                    fixture("enrollments/403-unknown-user.json") to Leaving.Failure(SendResult.Status(403), ApiErrorReason.UnknownUser),
                    client(Canned(403, later)) to Leaving.Failure(SendResult.Status(403), null),
                    client(Canned(403)) to Leaving.Failure(SendResult.Status(403), null),
                    // No iOS twin: an account deleted from another phone, its sign-in's old token refused (C3d, #558).
                    client(Canned(409, Answer.refused("account_deleted"))) to
                        Leaving.Failure(SendResult.Status(409), ApiErrorReason.AccountDeleted),
                    client(Canned(null)) to Leaving.Failure(SendResult.NetworkError, null),
                    client(Canned(401)) to Leaving.Failure(SendResult.Status(401), null),
                    client(Canned(429)) to Leaving.Failure(SendResult.Status(429), null),
                    client(Canned(500)) to Leaving.Failure(SendResult.Status(500), null),
                )
            for ((answer, failure) in refusals) {
                val (sending, _) = Leaving().ask(p3).send(t0)
                val (after, out) = sending.left(answered(answer), "e3")
                assertEquals(listOf<Any?>(false, failure, p3, false), listOf(out, after.failure, after.asking, after.busy), "$failure")
            }
        }

    @Test
    fun thePhoneHoldsAClasssLeaveWhileItStandsInThatClasssLessonAndTheBellHasntRungByItsOwnClockNeverAnotherClasssNorOnceTheBellHasRungNorOutOfASession() {
        val p3 = classRow("c", "Period 3")
        val focused = SyncState(standing = Standing.InSession(session(endsAt = 3000), ParticipationState.Focused))
        assertTrue(Leaving.held(p3, focused, at(10)))
        assertFalse(Leaving.held(p3, focused, at(3000)))
        assertFalse(Leaving.held(classRow("d", "Period 5"), focused, at(10)))
        for (state in listOf(null, ParticipationState.Unlocked)) {
            assertTrue(Leaving.held(p3, SyncState(standing = Standing.InSession(session(endsAt = 3000), state)), at(10)), "$state")
        }
        // Standing.Unread has no iOS twin: where the phone stood is not known, so the server says.
        for (standing in listOf(Standing.Out, Standing.Waiting, Standing.Unread)) {
            assertFalse(Leaving.held(p3, SyncState(standing = standing), at(10)), "$standing")
        }
    }
}

/** Leaving through the engine (C6c): BaliOutbox's LeaveEngineTests. */
class LeaveEngineTest : EngineFiles() {
    @Test
    fun aClassLeftIsGoneFromMeAtOnceItsOtherClassesKeptAndTheTruthReadAgainALeaveRefusedKeepsTheClassAndReadsAgainA401RenewsTheTokenOnce(): Unit =
        runBlocking {
            // A refusal is the screen's to say; the 401 sends the same leave again.
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = classes))
            val refused = async { rig.engine.leave("e3", request) }
            rig.server.next(leaveRoute).reply(409, Answer.refused("class_in_session"))
            assertEquals(ApiErrorReason.ClassInSession, refused.await().error?.error?.reason)
            assertEquals(listOf("c", "d"), rig.engine.updates.value.me?.classes?.map(MeClass::id))
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = classes))
            val answer = async { rig.engine.leave("e3", request) }
            rig.server.next(leaveRoute).reply(401)
            val again = rig.server.next(leaveRoute)
            assertEquals(listOf("Bearer token-2", request.eventId), listOf(again.token, again.eventId))
            again.reply(200, ended)
            assertEquals(OrUnknown.Known(EndEnrollmentResponse.Outcome.Ended), answer.await().answer?.outcome)
            assertEquals(listOf("d"), rig.engine.updates.value.me?.classes?.map(MeClass::id))
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = classes.drop(1)))
            rig.stop()
        }

    @Test
    fun aReadOfTheTruthSentBeforeTheLeaveAndAnsweredAfterItNeverBringsTheClassBackItIsOlderALeaveThatGotNoAnswerChangesNothing(): Unit =
        runBlocking {
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = classes))
            val lost = async { rig.engine.leave("e3", request) }
            rig.server.next(leaveRoute).reply(null)
            assertEquals(SendResult.NetworkError, lost.await().result)
            assertEquals(2, rig.engine.updates.value.me?.classes?.size)
            rig.engine.setInFront(true)
            val before = rig.server.next(meRoute)
            val answer = async { rig.engine.leave("e3", request) }
            rig.server.next(leaveRoute).reply(200, """{"outcome":"already_removed","reason":"left_class","endedParticipation":false}""")
            answer.await()
            before.reply(200, Answer.me(null, classes = classes))
            // Sent once the stale answer is in: it has brought nothing back.
            val after = rig.server.next(meRoute)
            assertEquals(listOf("d"), rig.engine.updates.value.me?.classes?.map(MeClass::id))
            after.reply(200, Answer.me(null, classes = classes.drop(1)))
            // The stale read counted as none: the screen's and this one.
            rig.until { it.meReads == 2 }
            assertEquals(listOf("d"), rig.engine.updates.value.me?.classes?.map(MeClass::id))
            rig.stop()
        }

    @Test
    fun aLeaveAnsweredAfterAnotherStudentsSignInMadeTheEngineForgetTheLastOnesMeTakesNoClassFromTheNextStudentsNotEvenOneUnderTheSameEnrollmentId(): Unit =
        runBlocking {
            // As a join adds none (F11a-1; #164's review): no two enrollments share an id, so the forget, not the id, keeps it.
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = classes.take(1)))
            val answer = async { rig.engine.leave("e3", request) }
            val leave = rig.server.next(leaveRoute)
            rig.engine.forgetMe()
            // The next student's own, read before the last one's leave answers.
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("d", enrollment = "e3"))))
            rig.until { it.me?.classes?.map(MeClass::id) == listOf("d") }
            leave.reply(200, ended)
            assertEquals(OrUnknown.Known(EndEnrollmentResponse.Outcome.Ended), answer.await().answer?.outcome)
            assertEquals(listOf("d"), rig.engine.updates.value.me?.classes?.map(MeClass::id))
            rig.stop()
        }

    @Test
    fun aLeaveWhoseCallerIsCancelledStillTakesItsClassOutOfMeForTheServerEndedItAndTheTruthIsReadAgain(): Unit =
        runBlocking {
            // No iOS twin: as a join's (JoinEngineTest), its answer is applied in the engine's scope however its caller ends.
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = classes))
            val caller = launch { rig.engine.leave("e3", request) }
            val leave = rig.server.next(leaveRoute)
            caller.cancelAndJoin()
            leave.reply(200, ended)
            rig.until { it.me?.classes?.map(MeClass::id) == listOf("d") }
            assertTrue(caller.isCancelled)
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = classes.drop(1)))
            rig.stop()
        }
}
