package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.EndEnrollmentRequest
import com.bali.core.EndEnrollmentResponse
import com.bali.core.EventId
import com.bali.core.MeClass
import com.bali.core.OrUnknown
import com.bali.core.SendResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

// Leaving a class through the engine (C6c): BaliOutbox's LeaveEngineTests, and new: a leave whose caller is cancelled.
// Leave's own rules (`Leaving`) are AN9f's.

/** The route a leave of `e3` goes to. */
private val leaveRoute = "DELETE /v1/enrollments/e3"
private val ended = """{"outcome":"ended","reason":"left_class","endedParticipation":false}"""
private val request = EndEnrollmentRequest(EventId.mint(t0))

/** Classes c, left through enrollment e3, and d, through e5, as `GET /v1/me` names them. */
private val classes = listOf(Answer.inClass("c", enrollment = "e3"), Answer.inClass("d", enrollment = "e5"))

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
