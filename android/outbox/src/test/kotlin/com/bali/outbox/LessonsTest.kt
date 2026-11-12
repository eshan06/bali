package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.BaliJson
import com.bali.core.Cognito
import com.bali.core.LiveLesson
import com.bali.core.MeResponse
import com.bali.core.OkHttpTransport
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.SignIn
import com.bali.outbox.AnswerCard.Look.Closed
import com.bali.outbox.AnswerCard.Look.Open
import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlin.time.Duration.Companion.seconds
import kotlin.time.toJavaDuration
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.jsonObject

// The phone's lesson half (AN13d), over the account's state as it comes, the lesson's own server and a clock of its own, and the
// engine's rig where the outbox is read: AppTests' lessonFollowed, lessonAnswers, lessonRefused, cardIgnoresTapsMidHold, lessonHide,
// offFocusCardWaits and cardGoesAtTheBell, their rules without their views (AS8's). And new: the poll stopped at the bell (Q7), a
// run of answers never in the outbox, one going at once while an Emergency Unlock's send is held, a teacher's account following
// nothing, a sign-in change, a sign-out and a deletion dropping all of the last student's lesson over the real account, a screen
// leaving never cutting an answer short, the poll's cancel never said, and the queue: an Emergency Unlock's send going while more
// of the lesson's calls than OkHttp's five a host are held, over real sockets.

val pollRoute = "GET /v1/sessions/s/presentation"
val answerRoute = "POST /v1/questions/q/answers"

/** Class p3's bell, session s's: ten minutes after [t0]. */
private val bell = at(600)

/** Session s, Period 3's, as the phone stands in it, ending at [bell]. */
private val periodThree = SessionView("s", "p3", bell)

private val inLine = "Your answer is in. You can change it until the question closes."
private val sendingLine = "Sending your answer${Char(0x2026)}"

/** The student's phone in this session, as the presentation read names it (W1): a read that differs from the last in that alone. */
private val focusedPhone = """{"state":"focused","lastSeenAt":null}"""

/** `GET /v1/me` naming [student], a [role]'s account, in Period 3, its session s live until [rings]: AppTests' `classInSession`. */
private fun meInSession(student: String = "ana", rings: Instant = bell, role: String = "student") =
    """{"user":{"id":"$student","role":"$role","displayName":"Ana"},"classes":[{"id":"p3","name":"Period 3",""" +
        """"teacher":{"displayName":"Ms. Rivera"},"liveSession":{"id":"s","endsAt":"${wire(rings)}"}}],"session":null}"""

/**
 * The account as it publishes Ana: [signedIn], standing [standing], `GET /v1/me` read [meReads] times listing her in Period 3 in
 * session, its bell [rings]; the consent list seen by her here, [seen]; [signIns] the changes of who is signed in.
 */
private fun ana(
    seen: Boolean = true, signedIn: Boolean = true, signIns: Int = 1, rings: Instant = bell, meReads: Int = 1,
    standing: Standing = Standing.Out,
) = Account.State(
    signedIn = signedIn,
    sync = SyncState(standing = standing, me = BaliJson.decodeFromString(MeResponse.serializer(), meInSession(rings = rings)), meReads = meReads),
    listSeenBy = "ana".takeIf { seen },
    signIns = signIns,
)

/** Session s's presentation, [running] or over: [question] open or closed, four answers, no answer of the student's read; the [phone]. */
private fun presentation(question: String? = "q", open: Boolean = true, running: Boolean = true, phone: String = "null"): String {
    val asked = question?.let { """{"id":"$it","prompt":"Which?","options":["A","B","C","D"],"open":$open,"correctOption":null,"answer":null}""" }
    return """{"running":$running,"question":${asked ?: "null"},"slide":null,"phone":$phone}"""
}

/** The answer the server holds once it takes the pick [request] sent, as `POST /v1/questions/{id}/answers` answers it. */
private fun took(request: String): String {
    val pick = BaliJson.parseToJsonElement(request).jsonObject
    return """{"outcome":"answered","answer":{"option":${pick["option"]},"eventId":${pick["eventId"]}}}"""
}

private fun took(pick: Server.Exchange) = took(pick.request.body?.decodeToString().orEmpty())

/** The option [pick] sent. */
private fun option(pick: Server.Exchange): Int? = pick.request.body?.let { BaliJson.parseToJsonElement(it.decodeToString()).jsonObject["option"]?.toString()?.toInt() }

/** Whether the card shows answer [index] as the one Bali holds, its line saying it is in. */
private fun Lessons.State.answered(index: Int): Boolean = card?.let { it.looks[index] == Open(picked = true) && it.line == inLine } == true

/** The lesson half under test, its own server answered by hand and its own clock, the test moving both: AppTests' `standIn`. */
private class LessonRig(val lessons: Lessons, val server: Server, val clock: TestClock) {
    suspend fun until(condition: (Lessons.State) -> Boolean): Lessons.State =
        withTimeoutOrNull(patience) { lessons.state.first(condition) } ?: fail("the lesson half never reached the state waited for")

    /** The next poll, answered with [body]: the request returned. */
    suspend fun read(body: String = presentation()): Server.Exchange = server.next(pollRoute).also { it.reply(200, body) }

    /** Waits for the poll to sleep until [next] by the lesson's clock, its read in: 2 s on by default. */
    suspend fun asleep(next: Instant = clock.now() + LiveLesson.INTERVAL.toJavaDuration()) = eventually { next in clock.deadlines }

    /** A tap on [option], its request answered with [status] and [body], the server's taking it by default: the request returned. */
    suspend fun pick(option: Int, status: Int? = 200, body: String? = null): Server.Exchange =
        coroutineScope {
            val tapped = async { lessons.answer(option) }
            val sent = server.next(answerRoute)
            sent.reply(status, body ?: took(sent))
            tapped.await()
            sent
        }
}

/** A lesson half in the test's scope over a server and a clock of its own, followed by hand ([Lessons.followed]). */
private fun EngineFiles.lessonRig(): LessonRig {
    val (server, clock) = Server() to TestClock()
    return LessonRig(Lessons(emptyFlow(), client(server), scope, clock), server, clock)
}

/** The reads of the truth answered with [me] as they come until the next request to [route], returned: a deletion waits out the loops'. */
private suspend fun SignedRig.past(route: String, me: String): Server.Exchange {
    while (true) {
        val next = server.next()
        if (next.route == route) return next
        assertEquals(meRoute, next.route)
        next.reply(200, me)
    }
}

/**
 * Bali's API on the loopback, over real sockets, as OkHttp meets a server: each request answered by [answer], given its route and
 * body, on a thread of its own, so one held there holds that request alone. The JDK's own server: no library added.
 */
private class LocalApi(answer: (route: String, body: String) -> Pair<Int, String>) : AutoCloseable {
    private val threads = Executors.newCachedThreadPool()
    private val loopback = InetAddress.getByName("127.0.0.1")
    private val server =
        HttpServer.create(InetSocketAddress(loopback, 0), 0).apply {
            executor = threads
            createContext("/") { exchange ->
                try {
                    val (status, body) = answer("${exchange.requestMethod} ${exchange.requestURI.path}", exchange.requestBody.readBytes().decodeToString())
                    val bytes = body.encodeToByteArray()
                    exchange.sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
                    if (bytes.isNotEmpty()) exchange.responseBody.write(bytes)
                } finally {
                    exchange.close()
                }
            }
            start()
        }

    val url = URI("http://127.0.0.1:${server.address.port}")

    override fun close() {
        server.stop(0)
        threads.shutdownNow()
    }
}

/** The phone's lesson half: BaliApp.swift's `Phone`'s, its rules (AppTests), and the lesson's queue apart from the engine's. */
class LessonsTest : EngineFiles() {
    @Test
    fun theLessonIsFollowedOnceTheListIsSeenItsPollOnlyInFrontNoneBehindOnceItGoesOrFromTheStartASignOutDropsItTheSameStudentFollowsItAgainAReadSayingOverForGood(): Unit =
        runBlocking {
            // AppTests' lessonFollowed: the owner's rulings of 2026-10-23 (the list first) and #330 (the poll in front alone), #331.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            // Before the list is seen: nothing followed, so nothing polls, and no card.
            lessons.followed(ana(seen = false))
            assertNull(lessons.state.value.lesson, "followed before the list was shown")
            assertFalse(lessons.polling())
            assertEquals(emptyList(), rig.server.sent.map { it.route })
            // The list seen, in front mid-class, as the one-time screen's Continue sees it: followed at once.
            lessons.followed(ana())
            rig.read()
            assertEquals("q", rig.until { it.card != null }.card?.question?.id)
            rig.asleep()
            // Behind: the poll stops, its sleep let go, the bell's alone left; back in front, it reads at once.
            lessons.setInFront(false)
            eventually { rig.clock.deadlines == listOf(bell) }
            assertFalse(lessons.polling(), "polled behind the app")
            lessons.setInFront(true)
            rig.server.next(pollRoute).reply(304)
            rig.asleep()
            // A sign-out drops it, its poll with it; the list's record kept, as the account keeps it.
            lessons.followed(ana(signedIn = false, signIns = 2))
            assertNull(lessons.state.value.lesson)
            assertNull(lessons.state.value.card)
            eventually { rig.clock.deadlines.isEmpty() }
            assertFalse(lessons.polling(), "polled after the sign-out")
            // Back in, behind: followed, its poll waiting for the front.
            lessons.setInFront(false)
            lessons.followed(ana(signIns = 3))
            assertNotNull(lessons.state.value.lesson)
            assertFalse(lessons.polling(), "polled behind the app from the start")
            lessons.setInFront(true)
            rig.read()
            rig.until { it.card?.question?.id == "q" }
            // A read saying the session is over drops it, its poll stopped there, and a read of GET /v1/me still listing the
            // session follows it no more.
            rig.asleep()
            rig.clock.advance(2)
            rig.read(presentation(question = null, running = false))
            rig.until { it.lesson == null }
            assertFalse(lessons.polling())
            lessons.followed(ana(signIns = 3, meReads = 2))
            assertNull(lessons.state.value.lesson, "followed after a read said it was over")
            eventually { rig.clock.deadlines.isEmpty() }
        }

    @Test
    fun aTapSendsItsAnswerAtOnceInOneRequestAnotherChangesItUnderALaterIdATapOnTheAnswerHeldSendsNothingOneUnansweredSaysItDidntSendOfCrossingPicksTheLastIsSaid(): Unit =
        runBlocking {
            // AppTests' lessonAnswers (decisions 4 and 5): one too late closes the card at once, and Hide keeps it gone.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            rig.read()
            rig.until { it.card != null }
            rig.asleep()
            // The poll stopped, so only the picks reach the server.
            lessons.setInFront(false)
            // Each answer taken shows on the card the moment its tap ends, never the one held before it for a moment.
            val one = rig.pick(1)
            assertTrue(lessons.state.value.answered(1), "${lessons.state.value.card?.looks}")
            val two = rig.pick(2)
            assertTrue(lessons.state.value.answered(2), "${lessons.state.value.card?.looks}")
            assertEquals(listOf(1, 2), listOf(option(one), option(two)))
            assertTrue(assertNotNull(one.eventId) < assertNotNull(two.eventId), "${one.eventId}, ${two.eventId}")
            // The answer Bali holds: a tap on it sends nothing again.
            lessons.answer(2)
            assertEquals(2, rig.server.sent.count { it.route == answerRoute })
            // No answer: it didn't send, the answer held still picked.
            rig.pick(0, status = null)
            var card = assertNotNull(lessons.state.value.card)
            assertEquals("Bali couldn't send your answer. Check your connection and tap it again.", card.line)
            assertEquals(Open(picked = true), card.looks[2])
            // The first pick's no answer, held until the next is taken: never said over it.
            val first = async { lessons.answer(0) }
            val held = rig.server.next(answerRoute)
            rig.until { it.card?.line == sendingLine }
            rig.pick(1)
            held.reply(null)
            first.await()
            card = assertNotNull(lessons.state.value.card)
            assertEquals(Open(picked = true), card.looks[1])
            assertEquals(inLine, card.line)
            // The other way: the earlier pick's answer, landing while the later is on its way, says nothing over it.
            val earlier = async { lessons.answer(2) }
            val early = rig.server.next(answerRoute)
            val later = async { lessons.answer(0) }
            val late = rig.server.next(answerRoute)
            early.reply(200, took(early))
            earlier.await()
            card = assertNotNull(lessons.state.value.card)
            assertEquals(listOf<Any?>(sendingLine, Open(picked = true)), listOf(card.line, card.looks[0]))
            late.reply(200, took(late))
            later.await()
            rig.until { it.answered(0) }
            // Too late: the card closed at once, saying so, the answer Bali holds the student's.
            rig.pick(3, status = 409, body = Answer.refused("question_closed"))
            card = assertNotNull(lessons.state.value.card)
            assertFalse(card.open)
            assertEquals(Closed(right = false, mine = true), card.looks[0])
            assertEquals("This question closed before your answer reached Bali, so it wasn't counted.", card.line)
            // Hide: kept however often the question is read again, until another opens, whose card carries nothing of the last.
            lessons.hide()
            assertNull(lessons.state.value.card)
            lessons.setInFront(true)
            rig.read(presentation(phone = focusedPhone))
            assertNull(rig.until { it.lesson?.presentation?.phone != null }.card)
            rig.asleep()
            rig.clock.advance(2)
            rig.read(presentation(question = "next"))
            card = assertNotNull(rig.until { it.card?.question?.id == "next" }.card)
            assertTrue(card.open)
            assertNull(card.line)
        }

    @Test
    fun aPollRefused403Or404DropsTheLessonTheCardGoneNeverSayingNoConnectionItsPollStoppedNotFollowedAgainUntilALaterReadListsItA429SaysThatLineTheLessonKept(): Unit =
        runBlocking {
            // AppTests' lessonRefused (L8b-2's call; the owner's ruling of 2026-10-23: added back, it comes back with no relaunch).
            val offline = "No connection right now, so Bali can't send your answer. It keeps trying."
            for (status in listOf(403, 404)) {
                val rig = lessonRig()
                val lessons = rig.lessons
                lessons.setInFront(true)
                lessons.followed(ana())
                rig.read()
                rig.until { it.card?.question?.id == "q" }
                rig.asleep()
                // A 429: that line, the lesson kept, its poll waiting out the minute.
                rig.clock.advance(2)
                rig.server.next(pollRoute).reply(429)
                rig.until { it.card?.line == offline }
                assertNotNull(lessons.state.value.lesson, "$status")
                rig.asleep(rig.clock.now() + LiveLesson.LONGEST_WAIT.toJavaDuration())
                // Refused: dropped at once, never with that line, and its poll stopped.
                rig.clock.advance(60)
                rig.server.next(pollRoute).reply(status, """{"error":{"code":"forbidden","message":"refused"}}""")
                rig.until { it.lesson == null }
                assertNull(lessons.state.value.card, "$status")
                assertFalse(lessons.polling(), "$status")
                // A state with no read of GET /v1/me since, still listing the session: followed no more.
                lessons.followed(ana())
                assertNull(lessons.state.value.lesson, "$status: followed again")
                // Added back: a later read lists it, and it is followed again.
                lessons.followed(ana(meReads = 2))
                rig.read()
                rig.until { it.card?.question?.id == "q" }
            }
        }

    @Test
    fun whileEmergencyUnlockIsHeldTheCardIgnoresTapsNoAnswerSentNoneShownOnItsWayAClosedQuestionsHideDoesNothingLetGoATapAnswersAndHideHidesAsBefore(): Unit =
        runBlocking {
            // AppTests' cardIgnoresTapsMidHold (the owner's ruling, 2026-10-23): no second finger answers or hides a question the
            // screen no longer shows.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            rig.read()
            rig.until { it.card?.question?.id == "q" }
            rig.asleep()
            lessons.setInFront(false)
            lessons.setUnlockHeld(true)
            withTimeoutOrNull(patience) { lessons.answer(1) } ?: fail("answered mid-hold")
            assertEquals(0, rig.server.sent.count { it.route == answerRoute }, "answered mid-hold")
            val card = assertNotNull(lessons.state.value.card)
            assertEquals(Open(picked = false), card.looks[1])
            assertNull(card.line)
            lessons.setUnlockHeld(false)
            rig.pick(1)
            assertEquals(listOf(1), rig.server.sent.filter { it.route == answerRoute }.map(::option))
            // Closed: Hide does nothing mid-hold, and hides once the hold is let go.
            lessons.setInFront(true)
            rig.read(presentation(open = false))
            rig.until { it.card?.open == false }
            lessons.setUnlockHeld(true)
            lessons.hide()
            assertNotNull(lessons.state.value.card, "hidden mid-hold")
            lessons.setUnlockHeld(false)
            lessons.hide()
            assertNull(lessons.state.value.card)
        }

    @Test
    fun hideOnAClosedQuestionTakesTheCardAwayKeptOnThisPhoneHoweverOftenTheQuestionIsReadAgainUntilAnotherOpensWhoseCardShows(): Unit =
        runBlocking {
            // AppTests' lessonHide, its rules: the ring coming back and an open card having no Hide are AS8's views.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            rig.read(presentation(open = false))
            rig.until { it.card?.open == false }
            rig.asleep()
            lessons.hide()
            assertNull(lessons.state.value.card)
            rig.clock.advance(2)
            rig.read(presentation(open = false, phone = focusedPhone))
            assertNull(rig.until { it.lesson?.presentation?.phone != null }.card)
            rig.asleep()
            rig.clock.advance(2)
            rig.read(presentation(question = "next"))
            assertEquals(true, rig.until { it.card?.question?.id == "next" }.card?.open)
        }

    @Test
    fun offFocusTheCardShowsOnlyOnceTheListIsSeenUnlockedProtectionOffAndHomeAlikeNoPollBeforeAndItGoesOnceAReadShowsNoQuestionTheLessonStillFollowed(): Unit =
        runBlocking {
            // AppTests' offFocusCardWaits, its rules: the one-time screen in Home's place is the router's (RouterTest).
            val standings =
                listOf(
                    Standing.InSession(periodThree, ParticipationState.Unlocked), Standing.InSession(periodThree, ParticipationState.ProtectionOff),
                    Standing.Out,
                )
            for (standing in standings) {
                val rig = lessonRig()
                val lessons = rig.lessons
                lessons.setInFront(true)
                lessons.followed(ana(seen = false, standing = standing))
                assertNull(lessons.state.value.lesson, "$standing: followed before the list was seen")
                assertFalse(lessons.polling(), "$standing")
                assertEquals(emptyList(), rig.server.sent.map { it.route }, "$standing")
                lessons.followed(ana(standing = standing))
                rig.read()
                rig.until { it.card?.question?.id == "q" }
                rig.asleep()
                rig.clock.advance(2)
                rig.read(presentation(question = null))
                rig.until { it.card == null }
                assertNotNull(lessons.state.value.lesson, "$standing")
            }
        }

    @Test
    fun theCardGoesAtItsClassesBellByThePhonesClockBaliReachedOrNotThePollStoppingThereAndALaterReadWithTheBellMovedFollowsItAgain(): Unit =
        runBlocking {
            // AppTests' cardGoesAtTheBell (L8c), offline at the bell; and Q7, the conductor's call: the lesson followed afresh at
            // the bell, so the poll stops there too, where iOS's runs past it until Bali answers.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana(rings = at(3)))
            rig.read()
            rig.until { it.card?.question?.id == "q" }
            rig.asleep()
            rig.clock.advance(2)
            rig.server.next(pollRoute).reply(null)
            rig.until { it.card?.offline == true }
            assertNotNull(lessons.state.value.heading(newYorkZone, usShortTime))
            rig.asleep(at(4))
            // The bell, by the phone's clock, before the poll's next read, its wake run late, as on a loaded phone: a tap sends
            // nothing meanwhile. Then the card goes, the lesson with it, its poll stopped.
            rig.clock.advance(1, holdingWakes = true)
            withTimeoutOrNull(patience) { lessons.answer(1) } ?: fail("answered past the bell")
            assertEquals(0, rig.server.sent.count { it.route == answerRoute }, "answered past the bell")
            rig.clock.releaseWakes()
            rig.until { it.card == null && it.lesson == null }
            assertNull(lessons.state.value.heading(newYorkZone, usShortTime))
            assertFalse(lessons.polling(), "polled past the bell")
            eventually { rig.clock.deadlines.isEmpty() }
            // A later read with the bell moved, the teacher's extend: followed again.
            lessons.followed(ana(rings = at(600), meReads = 2))
            rig.read()
            rig.until { it.card?.question?.id == "q" }
        }

    @Test
    fun aRunOfAnswersLeavesNoRecordInTheEnginesQueueOrTheOutboxsFileEachGoingAtOnceWhileAnEmergencyUnlocksSendIsHeld(): Unit =
        runBlocking {
            // Decision 5: answers are never queued in the outbox, so none waits ahead of an unlock, nor an unlock behind one. The
            // lesson here on the engine's own server, as iOS's is on its client, so the unlock and the picks meet one server.
            val rig = rig()
            val clock = TestClock()
            val world = LessonRig(Lessons(emptyFlow(), client(rig.server, rig.tokens), scope, clock), rig.server, clock)
            val lessons = world.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            world.read()
            world.until { it.card != null }
            lessons.setInFront(false)
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            val sending = rig.server.next(unlockRoute)
            for (option in listOf(0, 1, 2, 3, 1)) world.pick(option)
            world.until { it.answered(1) }
            assertEquals(5, rig.server.sent.count { it.route == answerRoute })
            // The unlock alone, still on its way, in the engine's queue and the outbox's file.
            assertEquals(listOf(unlock.eventId), rig.engine.updates.value.queued.map { it.eventId })
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            sending.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
            assertEquals(emptyList(), rig.outbox.records())
        }

    @Test
    fun aTeachersAccountNeverShownTheConsentListFollowsNothingNoPollAndNoCardThoughItsClassIsInSession(): Unit =
        runBlocking {
            // The app is the students' (the owner, 2026-11-07): a teacher's account is shown the teacher's screen alone, never the
            // consent list, so the list's note never names it, whoever the phone's last student was.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            val teacher = BaliJson.decodeFromString(MeResponse.serializer(), meInSession(student = "rivera", role = "teacher"))
            for (seen in listOf("ana", null)) {
                lessons.followed(Account.State(signedIn = true, sync = SyncState(me = teacher, meReads = 1), listSeenBy = seen, signIns = 1))
                assertTrue(lessons.state.value.let { it.lesson == null && it.card == null }, "$seen")
                assertFalse(lessons.polling(), "$seen")
            }
            assertEquals(emptyList(), rig.server.sent.map { it.route })
        }

    @Test
    fun eachSignInThatLandsTheSameStudentsAgainTooDropsTheLessonItsCardAndItsPickTheLessonFollowedAfreshItsPicksAnswerSaidNowhere(): Unit =
        runBlocking {
            // AN9e's count of the sign-ins landed (Q2), every landing a change, as iOS's `signed` drops the lesson at each (#331).
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            rig.read()
            rig.until { it.card != null }
            rig.asleep()
            lessons.setInFront(false)
            val tapped = async { lessons.answer(1) }
            val picked = rig.server.next(answerRoute)
            rig.until { it.card?.line == sendingLine }
            lessons.followed(ana(signIns = 2))
            assertNull(lessons.state.value.card, "kept over the sign-in")
            assertNotNull(lessons.state.value.lesson)
            picked.reply(200, took(picked))
            tapped.await()
            assertNull(lessons.state.value.card)
            lessons.setInFront(true)
            rig.read()
            val card = assertNotNull(rig.until { it.card != null }.card)
            assertEquals(List(4) { Open(picked = false) }, card.looks)
            assertNull(card.line)
        }

    @Test
    fun anotherStudentsSignInASignOutAndADeletionEachDropTheLessonItsCardItsPickAndItsHeadingNothingOfOneStudentsLessonShownToTheNext(): Unit =
        runBlocking {
            // Over the real account and sign-in (AN9e), the lesson half run as the app runs it, on its own server and clock.
            val rig = signedRig(gated = true)
            val account = checkNotNull(Account.of(rig.engine, scope, rig.clock, MemoryNotes()))
            scope.launch { account.run() }
            account.until { it.signedIn != null }
            val (server, clock) = Server() to TestClock()
            val lessons = Lessons(account.state, ApiClient(URI("https://api.bali.test"), rig.signIn, server), scope, clock)
            val world = LessonRig(lessons, server, clock)
            scope.launch { lessons.run() }
            lessons.setInFront(true)
            rig.through(account, scoped("a1"), me = meInSession("ana"))
            account.sawList()
            assertEquals("Bearer ${scoped("a1")}", world.read().token)
            world.until { it.card?.question?.id == "q" }
            val tapped = async { lessons.answer(1) }
            val picked = server.next(answerRoute)
            world.until { it.card?.line == sendingLine }
            assertNotNull(lessons.state.value.heading(newYorkZone, usShortTime))
            // Bob signs in over her: her lesson goes at once, its card, her pick and its heading.
            rig.signStudentIn(scoped("b1"), refresh = "refresh-b")
            world.until { it.lesson == null && it.card == null }
            assertNull(lessons.state.value.heading(newYorkZone, usShortTime))
            // Her pick's answer, landing now, says nothing to him.
            picked.reply(200, took(picked))
            tapped.await()
            assertNull(lessons.state.value.card)
            rig.server.next(ageCheckRoute).reply(200, ageCheckPassed)
            rig.readsAnswered(meInSession("bob")) { account.state.value.sync?.me?.user?.id == "bob" }
            assertNull(lessons.state.value.lesson, "followed for a student who hasn't seen the list")
            // He sees the list: his own lesson, under his own token, with nothing of hers on its card.
            account.sawList()
            assertEquals("Bearer ${scoped("b1")}", world.read().token)
            val his = assertNotNull(world.until { it.card != null }.card)
            assertEquals(List(4) { Open(picked = false) }, his.looks)
            assertNull(his.line)
            // A sign-out drops it.
            rig.signIn.signOut()
            world.until { it.lesson == null && it.card == null }
            // Back in, the list's note kept: followed again. Then Delete account: dropped with the account.
            rig.through(account, scoped("b1"), refresh = "refresh-b2", me = meInSession("bob"))
            // Each poll answered as it comes: one begun as the sign-in landed, before its check, is let go as the check lets it
            // through and the account reads `me` again.
            eventually {
                if (pollRoute in server.waiting) server.next(pollRoute).reply(200, presentation())
                lessons.state.value.card != null
            }
            account.deleting { it.ask() }
            val deleting = scope.async { account.deleteAccount() }
            rig.past(deleteMeRoute, meInSession("bob")).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            withTimeout(patience) { deleting.await() }
            world.until { it.lesson == null && it.card == null }
            assertNull(lessons.state.value.heading(newYorkZone, usShortTime))
            assertFalse(lessons.polling())
            rig.stop()
        }

    @Test
    fun aScreenThatLeavesWhileItsTapIsOnItsWayNeverCutsTheAnswerShortItGoesAndTheCardSaysWhatItSaid(): Unit =
        runBlocking {
            // The call runs in the lesson half's own scope, as iOS's Task isn't cancelled by its view.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            rig.read()
            rig.until { it.card != null }
            lessons.setInFront(false)
            val screen = launch { lessons.answer(2) }
            val sent = rig.server.next(answerRoute)
            screen.cancelAndJoin()
            sent.reply(200, took(sent))
            rig.until { it.answered(2) }
        }

    @Test
    fun aPollCutShortAsBaliGoesBehindIsANormalStopNeverSaidItsReadKeptNowhereAndBackInFrontTheLessonReadsAgain(): Unit =
        runBlocking {
            // AN13a's note: the cancel's throw is no failure, so never the card's no-connection line.
            val rig = lessonRig()
            val lessons = rig.lessons
            lessons.setInFront(true)
            lessons.followed(ana())
            rig.read()
            rig.until { it.card != null }
            rig.asleep()
            val seen = CopyOnWriteArrayList<Lessons.State>()
            val watching = launch(start = CoroutineStart.UNDISPATCHED) { lessons.state.collect { seen += it } }
            rig.clock.advance(2)
            val onItsWay = rig.server.next(pollRoute)
            lessons.setInFront(false)
            assertFalse(lessons.polling())
            onItsWay.reply(200, presentation(question = "next"))
            lessons.setInFront(true)
            rig.read(presentation(question = "again"))
            rig.until { it.card?.question?.id == "again" }
            watching.cancel()
            assertTrue(seen.none { it.card?.question?.id == "next" }, "the read cut short was kept")
            assertTrue(seen.all { it.lesson?.problem == null && it.card?.line == null }, "the cancel was said: ${seen.map { it.card?.line }}")
        }

    @Test
    fun anEmergencyUnlocksSendGoesAtOnceWhileMoreOfTheLessonsCallsThanOkHttpsFiveAHostAreHeldOverRealSocketsTheLessonOnATransportApart(): Unit =
        runBlocking {
            // The queue (santa's reviewer B on #574): the app's one OkHttp lets 5 requests a host go at once and queues the rest,
            // so on a slow network the lesson's poll and crossing answers could hold an unlock's send. The engine as the app makes
            // it, on OkHttp, the lesson's calls on a transport apart from its own (`OkHttpTransport.apart`), each held at Bali's API
            // until the unlock has gone.
            val release = CountDownLatch(1)
            val held = AtomicInteger()
            val polls = AtomicInteger()
            val unlocked = CompletableDeferred<Int>()
            fun hold() {
                held.incrementAndGet()
                release.await(patience.inWholeMilliseconds, TimeUnit.MILLISECONDS)
            }
            LocalApi { route, body ->
                when (route) {
                    meRoute -> 200 to meInSession("ana")
                    ageCheckRoute -> 200 to ageCheckPassed
                    pollRoute -> {
                        if (polls.getAndIncrement() > 0) hold()
                        200 to presentation()
                    }
                    answerRoute -> {
                        hold()
                        200 to took(body)
                    }
                    unlockRoute -> {
                        unlocked.complete(held.get())
                        200 to Answer.unlocked()
                    }
                    else -> 503 to ""
                }
            }.use { api ->
                try {
                    val (cognito, clock, keychain) = Triple(Server(), TestClock(), MemoryKeychain())
                    val pool = Cognito(URI("https://bali-dev.auth.us-east-1.amazoncognito.com"), "phone-client", URI("bali://auth/callback"))
                    val signIn = SignIn(pool, keychain, scope, cognito, clock::now, gated = false)
                    val transport = OkHttpTransport()
                    val outbox = makeOutbox().first
                    val rig = SignedRig(SyncEngine.make(outbox, api.url, signIn, scope, transport, clock), signIn, outbox, cognito, clock, keychain, scope)
                    val account = checkNotNull(Account.of(rig.engine, scope, clock, MemoryNotes()))
                    scope.launch { account.run() }
                    rig.signStudentIn(accessToken("a1"))
                    account.until { it.sync?.me != null }
                    account.sawList()
                    // The lesson's client waits out a held call to the transport's 30 s bound, so a queue it shared would hold the
                    // unlock past the ten seconds below.
                    val lessonClock = TestClock()
                    val client = ApiClient(api.url, signIn, transport.apart(), OkHttpTransport.EXCHANGE_TIMEOUT)
                    val lessons = Lessons(account.state, client, scope, lessonClock)
                    scope.launch { lessons.run() }
                    lessons.setInFront(true)
                    withTimeout(patience) { lessons.state.first { it.card != null } }
                    eventually { lessonClock.now() + Duration.ofSeconds(2) in lessonClock.deadlines }
                    // The poll's next read, then five crossing picks: six calls, five at the server, the sixth in the lesson's queue.
                    lessonClock.advance(2)
                    eventually { held.get() == 1 }
                    val picks = listOf(0, 1, 2, 3, 0).map { option -> launch { lessons.answer(option) } }
                    eventually { held.get() == 5 }
                    val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
                    // At once: OkHttp would let a queued call go only as a held one ended, at the 30 s bound.
                    val heldThen = withTimeoutOrNull(10.seconds) { unlocked.await() } ?: fail("the unlock's send waited behind the lesson's calls")
                    assertEquals(5, heldThen, "the lesson's calls held as the unlock came")
                    assertEquals(sendingLine, lessons.state.value.card?.line)
                    rig.until { it.queued.none { record -> record.eventId == unlock.eventId } }
                    release.countDown()
                    picks.joinAll()
                    rig.stop()
                } finally {
                    release.countDown()
                }
            }
        }
}
