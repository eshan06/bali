package com.bali.outbox

import com.bali.core.AnswerResult
import com.bali.core.BaliJson
import com.bali.core.MeResponse
import com.bali.core.NoAnswer
import com.bali.core.ParticipationState
import com.bali.core.PollProblem
import com.bali.core.StudentAnswer
import com.bali.core.StudentQuestion
import com.bali.outbox.AnswerCard.Look.Closed
import com.bali.outbox.AnswerCard.Look.Open
import com.bali.outbox.AnswerCard.Said
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// A live lesson on the phone (L8), AN13c: BaliOutbox's LessonTests, iOS's word for word: which lesson the phone follows and its
// class's heading, and the answer card's looks and line, state by state, as AS8's card boards draw them. On a US phone in New
// York, never the PC's zone or locale, times compared with plain spaces.

/** Class c's name, as its teacher wrote it. */
private val period3 = "Period 3 ${Char(0x2014)} Algebra II"

/** A session whose bell is at 10:42 AM in New York. */
private val bell1042 = session(endsAt = 1720)

/** `GET /v1/me`'s answer [json], as the phone decodes it. */
private fun me(json: String): MeResponse = BaliJson.decodeFromString(MeResponse.serializer(), json)

/** Class p3, Period 3, with no teacher named, in its running session [live], ending [endsAt] seconds after [t0]. */
private fun p3(live: String = "live", endsAt: Long = 3000) =
    """{"id":"p3","name":"Period 3","liveSession":{"id":"$live","endsAt":"${wire(at(endsAt))}"}}"""

/**
 * The engine's truth standing [standing], with `GET /v1/me` listing class p3's running session [live], ending [endsAt] seconds
 * after [t0], and class p5 in none: LessonTests' `listing`.
 */
private fun listing(standing: Standing, live: String = "live", endsAt: Long = 3000) =
    SyncState(
        standing = standing,
        me = me("""{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"p5","name":"Period 5"},${p3(live, endsAt)}],"session":null}"""),
    )

/**
 * The engine standing [standing], with `GET /v1/me` naming class c, Period 3, with Ms. Rivera, and, [live], class p3 in session
 * after it; or, [read] false, not read: FocusTests' `synced`.
 */
private fun synced(standing: Standing, read: Boolean = true, live: Boolean = false): SyncState {
    val classes = listOfNotNull("""{"id":"c","name":"$period3","teacher":{"displayName":"Ms. Rivera"}}""", p3().takeIf { live })
    val named = me("""{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[${classes.joinToString(",")}],"session":null}""")
    return SyncState(standing = standing, link = Link.Reached, me = named.takeIf { read })
}

/** The lesson's heading for [state] at [now], [over] the sessions a read said are over, on a US phone in New York. */
private fun headed(state: SyncState, now: Instant = t0, over: Set<String> = emptySet()) =
    state.lessonHeading(now, over, newYorkZone, usShortTime)

/**
 * A question as `GET /v1/sessions/{id}/presentation` gives one: four answers, [open] or closed, answer [correct] once shown, and
 * the student's own [answer], if any, under [eventId]: LessonTests' `question`.
 */
private fun question(open: Boolean = true, correct: Int? = null, answer: Int? = null, eventId: String = "e1"): StudentQuestion {
    val held = answer?.let { """{"option":$it,"eventId":"$eventId"}""" } ?: "null"
    val json =
        """{"id":"q","prompt":"Which value of x solves x² − 5x + 6 = 0?","options":["x = 1","x = 2","x = 4","x = 6"],"open":$open,"correctOption":${correct ?: "null"},"answer":$held}"""
    return BaliJson.decodeFromString(StudentQuestion.serializer(), json)
}

/** The card for [question], with the last poll's [problem], a pick [sending] and what the last one [said]: LessonTests' `card`. */
private fun card(question: StudentQuestion, problem: PollProblem? = null, sending: Int? = null, said: Said? = null) =
    AnswerCard(question, problem, sending, said)

/** A live lesson on the phone (L8): BaliOutbox's LessonTests. */
class LessonTest {
    @Test
    fun theLessonFollowedTheSessionThePhoneStandsInElseTheFirstClassInSessionByGetV1MeTappedInOrNotEachWhileItsBellIsAheadByThePhonesClockNeverOneAReadSaidIsOver() {
        for (standing in listOf(Standing.Out, Standing.Waiting, Standing.Unread)) {
            assertEquals("live", listing(standing).lessonSession(t0, emptySet()), "$standing")
        }
        // In a session, that one, whatever its state.
        for (state in ParticipationState.entries + null) {
            assertEquals("tapped", listing(Standing.InSession(session("tapped"), state)).lessonSession(t0, emptySet()), "$state")
        }
        // Its bell rung by the phone's clock, or said over: the class in session instead.
        val rung = listing(Standing.InSession(session("tapped", endsAt = 60), ParticipationState.Focused))
        assertEquals("live", rung.lessonSession(at(61), emptySet()))
        val tapped = listing(Standing.InSession(session("tapped"), ParticipationState.Focused))
        assertEquals("live", tapped.lessonSession(t0, setOf("tapped")))
        // None running: none.
        assertNull(listing(Standing.Out, endsAt = 60).lessonSession(at(60), emptySet()))
        assertNull(listing(Standing.Out).lessonSession(t0, setOf("live")))
        assertNull(SyncState().lessonSession(t0, emptySet()))
    }

    @Test
    fun theLessonsClassHeadedAsASessionsScreensHeadTheirsItsNameThenItsTeacherAndBellTheOneThePhoneStandsInFirstNoneWithNoLessonOrAClassTheReadDoesntName() {
        val out = assertNotNull(headed(listing(Standing.Out)))
        assertEquals("Period 3" to "ends 11:03 AM", out.first to plain(out.second))
        val tapped = assertNotNull(headed(synced(Standing.InSession(bell1042, ParticipationState.Unlocked))))
        assertEquals(period3 to "with Ms. Rivera · ends 10:42 AM", tapped.first to plain(tapped.second))
        // The one the phone stands in before the class in session, as the lesson followed is.
        val both = assertNotNull(headed(synced(Standing.InSession(bell1042, ParticipationState.Focused), live = true)))
        assertEquals(period3 to "with Ms. Rivera · ends 10:42 AM", both.first to plain(both.second))
        // Its bell rung by the phone's clock, or said over: the class in session's, the lesson followed then.
        val rung = assertNotNull(headed(synced(Standing.InSession(session(endsAt = 60), ParticipationState.Focused), live = true), now = at(61)))
        assertEquals("Period 3" to "ends 11:03 AM", rung.first to plain(rung.second))
        val over = assertNotNull(headed(synced(Standing.InSession(bell1042, ParticipationState.Focused), live = true), over = setOf("s")))
        assertEquals("Period 3" to "ends 11:03 AM", over.first to plain(over.second))
        assertNull(headed(listing(Standing.Out), over = setOf("live")))
        assertNull(headed(synced(Standing.InSession(bell1042, ParticipationState.Unlocked), read = false)))
        // Followed, in a class the read doesn't name.
        assertEquals("tapped", listing(Standing.InSession(session("tapped"), ParticipationState.Focused)).lessonSession(t0, emptySet()))
        assertNull(headed(listing(Standing.InSession(session("tapped"), ParticipationState.Focused))))
        assertNull(headed(SyncState()))
    }

    @Test
    fun anOpenQuestionNothingPickedAndNoLineUnderTheAnswersATapOnItsWayPickedAndSendingTheAnswerBaliHoldsPickedAndYourAnswerIsInNeverAMarkOfTheCorrectAnswer() {
        // AS8-Focus-q: the owner's cut, 2026-11-04.
        val fresh = card(question())
        assertTrue(fresh.open)
        assertEquals(List(4) { Open(picked = false) }, fresh.looks)
        assertNull(fresh.line)
        assertFalse(fresh.alert || fresh.offline)
        // AS8-Card-sending.
        val sending = card(question(answer = 0), sending = 1)
        assertEquals(listOf(false, true, false, false).map { Open(it) }, sending.looks)
        assertEquals("Sending your answer…", sending.line)
        assertFalse(sending.alert || sending.offline)
        // AS8-Focus-answered.
        val answered = card(question(answer = 1))
        assertEquals(listOf(false, true, false, false).map { Open(it) }, answered.looks)
        assertEquals("Your answer is in. You can change it until the question closes.", answered.line)
        assertFalse(answered.alert || answered.offline)
    }

    @Test
    fun whatAPicksRequestSaidTakenSaysNothingTooLateClosesTheCardAtOnceSayingItWasntCountedAnythingElseDidntSendUntilBaliHoldsAnAnswerMadeSince() {
        val answer = StudentAnswer(option = 2, eventId = "e2")
        assertNull(Said.of(AnswerResult.Answered(answer), held = "e1"))
        assertEquals(Said.TooLate, Said.of(AnswerResult.QuestionClosed, held = "e1"))
        val failures =
            listOf(
                AnswerResult.InvalidOption, AnswerResult.EventIdConflict, AnswerResult.AccountDeleted, AnswerResult.Unreachable(NoAnswer.Unreachable),
                AnswerResult.Unreachable(NoAnswer.NoToken), AnswerResult.Refused(500, null), AnswerResult.Refused(429, null),
            )
        for (failure in failures) assertEquals(Said.Failed(held = "e1"), Said.of(failure, held = "e1"), "$failure")
        // AS8-Card-failed.
        val failed = card(question(), said = Said.Failed(held = null))
        assertTrue(failed.open && failed.alert && !failed.offline)
        assertEquals("Bali couldn't send your answer. Check your connection and tap it again.", failed.line)
        // Bali still holds the answer it held as the pick was made: said until then.
        val still = card(question(answer = 1, eventId = "e1"), said = Said.Failed(held = "e1"))
        assertEquals("Bali couldn't send your answer. Check your connection and tap it again.", still.line)
        // Bali holds an answer made since: the pick landed, its reply lost. It's in.
        val landed = card(question(answer = 1, eventId = "e2"), said = Said.Failed(held = "e1"))
        assertEquals("Your answer is in. You can change it until the question closes.", landed.line)
        assertFalse(landed.alert)
        // AS8-Card-toolate.
        val late = card(question(answer = 0), said = Said.TooLate)
        assertTrue(!late.open && late.alert && !late.offline)
        assertEquals("This question closed before your answer reached Bali, so it wasn't counted.", late.line)
        assertEquals(listOf(Closed(right = false, mine = true)) + List(3) { Closed(right = false, mine = false) }, late.looks)
    }

    @Test
    fun thePollsNoAnswerWhileTheQuestionIsOpenItsOwnLineWithItsIconInThePrimaryInkWhateverTheProblemAPicksOwnLineSaidFirstAndNoneOnceTheQuestionIsClosed() {
        // AS8-Card-offline.
        val problems: List<PollProblem> = NoAnswer.entries.map { PollProblem.Unreachable(it) } + PollProblem.RateLimited + PollProblem.Refused(503, null)
        for (problem in problems) {
            val offline = card(question(), problem = problem)
            assertTrue(offline.offline && offline.alert, "$problem")
            assertEquals("No connection right now, so Bali can't send your answer. It keeps trying.", offline.line, "$problem")
        }
        val failed = card(question(), problem = PollProblem.RateLimited, said = Said.Failed(held = null))
        assertFalse(failed.offline)
        assertEquals("Bali couldn't send your answer. Check your connection and tap it again.", failed.line)
        val sending = card(question(), problem = PollProblem.RateLimited, sending = 0)
        assertFalse(sending.offline)
        assertEquals("Sending your answer…", sending.line)
        val closed = card(question(open = false), problem = PollProblem.RateLimited)
        assertFalse(closed.offline)
        assertEquals("Your teacher closed this question.", closed.line)
    }

    @Test
    fun aClosedQuestionNoAnswerOpenToATapTheStudentsOwnMarkedOnceShownTheCorrectOneMarkedNeverRedNeverACountTheTeachersCloseSaidAPickOnItsWaySaysNothing() {
        // AS8-Card-closed.
        val closed = card(question(open = false, answer = 3))
        assertFalse(closed.open || closed.alert || closed.offline)
        assertEquals(List(3) { Closed(right = false, mine = false) } + Closed(right = false, mine = true), closed.looks)
        assertEquals("Your teacher closed this question.", closed.line)
        val revealed = card(question(open = false, correct = 1, answer = 3))
        assertEquals(listOf(Closed(false, false), Closed(true, false), Closed(false, false), Closed(false, true)), revealed.looks)
        assertEquals("Your teacher closed it and showed the answer.", revealed.line)
        // AS8-Focus-revealed.
        val right = card(question(open = false, correct = 1, answer = 1))
        assertEquals(Closed(right = true, mine = true), right.looks[1])
        assertEquals("Your teacher closed it and showed the answer.", right.line)
        // AS8-Card-noanswer.
        val none = card(question(open = false, correct = 1))
        assertEquals(listOf(Closed(false, false), Closed(true, false), Closed(false, false), Closed(false, false)), none.looks)
        assertEquals("Your teacher closed it and showed the answer.", none.line)
        assertFalse(none.alert || none.offline)
        val sending = card(question(open = false), sending = 2)
        assertEquals("Your teacher closed this question.", sending.line)
        assertEquals(Closed(right = false, mine = false), sending.looks[2])
    }
}
