package com.bali.core

import com.bali.core.LessonWorld.Reply
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.TimeUnit.MILLISECONDS
import java.util.zip.GZIPOutputStream
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okio.Buffer

/** When a lesson test starts, by the phone's clock. */
private val start: Instant = Instant.ofEpochSecond(1_790_000_000)

/**
 * A live lesson's world in a test: the server's answers in order, and a clock that moves only when the poll waits. Once no
 * answer is left, the next wait throws, as the owner's cancel would. LiveLessonTests.swift's `LessonWorld`.
 */
class LessonWorld(replies: List<Reply>, now: Instant = start) : HttpTransport {
    /**
     * One answer: a status, its headers and body, or, with no status, none at all (offline). [cancels]: the coroutine that sent
     * it is cancelled on its way, as the app going behind does. [holds]: it waits on its way until the test lets it go
     * ([release]). [echoes]: the pick its request sent, taken, as the server answers an answer it now holds.
     */
    data class Reply(
        val status: Int?,
        val headers: Map<String, String> = emptyMap(),
        val body: String = "",
        val cancels: Boolean = false,
        val holds: Boolean = false,
        val echoes: Boolean = false,
    ) {
        /** This answer, held on its way until the test lets it go. */
        val held: Reply get() = copy(holds = true)

        companion object {
            fun ok(body: String, etag: String? = null) = Reply(200, etag?.let { mapOf("ETag" to it) }.orEmpty(), body)

            val notModified = Reply(304)
            val offline = Reply(null)
            val took = Reply(200, echoes = true)
        }
    }

    /** The world's wait, thrown once no answer is left or at the 20th, as the owner's cancel ends a run. */
    class Stopped : CancellationException("the lesson's world has no answer left, or waited 20 times")

    private val lock = Any()
    private val replies = replies.toMutableList()
    private var time = now
    private val requests = mutableListOf<HttpRequest>()
    private val waits = mutableListOf<Duration>()
    private val holding = mutableListOf<CompletableDeferred<Unit>>()

    /** How many answers are held on their way now: the mark [held] waits for. */
    private val holds = MutableStateFlow(0)

    val sent: List<HttpRequest> get() = synchronized(lock) { requests.toList() }
    val slept: List<Duration> get() = synchronized(lock) { waits.toList() }

    fun now(): Instant = synchronized(lock) { time }

    fun then(vararg more: Reply) = synchronized(lock) { replies += more }

    override suspend fun send(request: HttpRequest): HttpAnswer {
        val (reply, hold) =
            synchronized(lock) {
                requests += request
                val reply = if (replies.isEmpty()) fail("a request with no answer left: ${request.url}") else replies.removeAt(0)
                val hold = CompletableDeferred<Unit>().takeIf { reply.holds }?.also { holding += it }
                holds.value = holding.size
                reply to hold
            }
        hold?.await()
        if (reply.cancels) currentCoroutineContext().cancel()
        val status = reply.status ?: throw IOException("offline")
        val body = if (reply.echoes) took(picked(request)) else reply.body
        return HttpAnswer(status, reply.headers, body.encodeToByteArray())
    }

    /** Waits until [count] answers are held on their way: the world's own mark, never a clock. */
    suspend fun held(count: Int) {
        holds.first { it >= count }
    }

    /** Lets the first answer held go on. */
    fun release() =
        synchronized(lock) {
            holding.removeAt(0).also { holds.value = holding.size }
        }.complete(Unit)

    /**
     * The poll's wait: noted, and the clock moved on, and, once no answer is left, a throw. A poll that never takes the answers
     * left (no token) is stopped at 20 waits, never spun.
     */
    fun sleep(wait: Duration) =
        synchronized(lock) {
            waits += wait
            time = time.plusMillis(wait.inWholeMilliseconds)
            if (replies.isEmpty() || waits.size >= 20) throw Stopped()
        }

    /** [lesson]'s poll, run until it stops: by itself, or at a wait this world throws at, as the owner's cancel would end it. */
    suspend fun poll(lesson: LiveLesson) {
        try {
            lesson.run()
        } catch (stopped: Stopped) {
            return
        }
    }

    /** Session `s1`'s lesson in this world, its client signed in with [token]. */
    fun lesson(token: String? = "t") =
        LiveLesson("s1", ApiClient(URI("https://api.bali.test"), FixedToken(token), this), now = { now() }, sleep = { sleep(it) })
}

/** A fixture's body, as the API sends it. */
private fun wire(fixture: String): String = Contract.load(fixture).body.toString()

private fun decoded(body: String): Presentation = BaliJson.decodeFromString(Presentation.serializer(), body)

/** A running lesson's read: question [id], open, with the student's [answer], if any. */
private fun asked(id: String = "q1", answer: StudentAnswer? = null): String {
    val held = answer?.let { """{"option":${it.option},"eventId":"${it.eventId}"}""" } ?: "null"
    return """{"running":true,"question":{"id":"$id","prompt":"Which planet is the largest?",""" +
        """"options":["Mars","Jupiter","Venus"],"open":true,"correctOption":null,"answer":$held},"slide":null,"phone":null}"""
}

/** The pick [request] sent. */
private fun picked(request: HttpRequest): AnswerRequest =
    BaliJson.decodeFromString(AnswerRequest.serializer(), checkNotNull(request.body).decodeToString())

/** The server's answer taking [pick]: the answer it holds now. */
private fun took(pick: AnswerRequest) =
    """{"outcome":"answered","answer":{"option":${pick.option},"eventId":"${pick.eventId}"}}"""

/** The ids of the answers [world] was sent, in the order sent. */
private fun answerIds(world: LessonWorld): List<String> = world.sent.filter { it.method == "POST" }.map { picked(it).eventId }

/** A lower-case UUIDv7, as the API checks one. */
private val uuidV7 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

/** An id's time: its first 48 bits, in milliseconds. */
private fun time(id: String): Long? = id.replace("-", "").take(12).toLongOrNull(16)

/** A live lesson's poll: LiveLessonTests.swift's LessonPollTests. */
class LessonPollTest {
    @Test
    fun itReadsEvery2SWithTheLastETagAndA304KeepsTheLastReadTheStudentsAnswerWithIt() =
        inTime {
            val answer = StudentAnswer(1, EventId.mint(start))
            val read = Reply.ok(asked(answer = answer), etag = "\"a\"")
            val world = LessonWorld(listOf(read, Reply.notModified, Reply.notModified))
            val lesson = world.lesson()
            // The owner, reading the lesson's changes from before its first read.
            val seen = mutableListOf<LessonState>()
            val owner = launch(start = CoroutineStart.UNDISPATCHED) { lesson.state.collect { seen += it } }
            world.poll(lesson)

            val sent = world.sent
            assertTrue(sent.all { it.method == "GET" }, "${sent.map { it.method }}")
            assertEquals(List(3) { "https://api.bali.test/v1/sessions/s1/presentation" }, sent.map { it.url.toString() })
            assertEquals(listOf(null, "\"a\"", "\"a\""), sent.map { it.headers["If-None-Match"] })
            assertEquals(List(3) { 2.seconds }, world.slept)
            val state = lesson.state.value
            assertEquals(decoded(asked(answer = answer)), state.presentation)
            assertEquals(answer, state.presentation?.question?.answer)
            assertNull(state.problem)
            // The owner reads each change, the newest kept.
            eventually { seen.lastOrNull() == state }
            owner.cancel()
            assertEquals(LessonState(), seen.first())
        }

    @Test
    fun itStopsByItselfOnceAReadSaysTheSessionIsNotRunningWaitingNoMore() =
        inTime {
            val (open, over) = wire("presentation/open.json") to wire("presentation/over.json")
            val world = LessonWorld(listOf(Reply.ok(open, etag = "\"a\""), Reply.ok(over, etag = "\"b\"")))
            val lesson = world.lesson()
            // By itself: never at a wait the world throws at.
            lesson.run()
            assertEquals(2, world.sent.size)
            assertEquals(listOf(2.seconds), world.slept)
            assertEquals(decoded(over), lesson.state.value.presentation)

            // Run again, it reads once, its 304 says the same, and it stops again.
            world.then(Reply.notModified)
            lesson.run()
            assertEquals("\"b\"", world.sent.last().headers["If-None-Match"])
            assertEquals(3, world.sent.size)
            assertEquals(listOf(2.seconds), world.slept)
        }

    @Test
    fun a429HoldsThePollForItsRetryAfterFrom2SToAMinuteAtMostTheLastReadKept() =
        inTime {
            val body = wire("presentation/open.json")
            val cases =
                listOf(
                    "7" to 7.seconds,
                    null to 60.seconds,
                    "600" to 60.seconds,
                    "1" to 2.seconds,
                    "-5" to 2.seconds,
                    "Wed, 21 Oct 2026 07:28:00 GMT" to 60.seconds,
                )
            for ((retryAfter, wait) in cases) {
                val limited =
                    Reply(
                        429,
                        retryAfter?.let { mapOf("Retry-After" to it) }.orEmpty(),
                        """{"error":{"code":"rate_limited","message":"over budget"}}""",
                    )
                val world = LessonWorld(listOf(Reply.ok(body, etag = "\"a\""), limited))
                val lesson = world.lesson()
                world.poll(lesson)
                val case = "Retry-After: $retryAfter"
                assertEquals(listOf(2.seconds, wait), world.slept, case)
                val state = lesson.state.value
                assertEquals(PollProblem.RateLimited, state.problem, case)
                assertEquals(decoded(body), state.presentation, case)
            }
        }

    @Test
    fun itsWaitOverThePollGoesOnEvery2SAndTheNextReadEndsTheProblem() =
        inTime {
            val world =
                LessonWorld(
                    listOf(
                        Reply.ok(wire("presentation/open.json"), etag = "\"a\""),
                        Reply(429, mapOf("Retry-After" to "7")),
                        Reply.notModified,
                    ),
                )
            val lesson = world.lesson()
            world.poll(lesson)
            assertEquals(listOf(2.seconds, 7.seconds, 2.seconds), world.slept)
            assertEquals("\"a\"", world.sent.last().headers["If-None-Match"])
            assertNull(lesson.state.value.problem)
        }

    @Test
    fun aPollThatFailsSaysWhyAndKeepsTheLastReadTryingAgainIn2SAReadAnsweredEndsIt() =
        inTime {
            val body = wire("presentation/open.json")
            val world = LessonWorld(listOf(Reply.ok(body, etag = "\"a\""), Reply.offline))
            val lesson = world.lesson()
            world.poll(lesson)
            assertEquals(PollProblem.Unreachable(NoAnswer.Unreachable), lesson.state.value.problem)

            val notFound = Reply(404, body = wire("presentation/404-session-not-found.json"))
            val notEnrolled = Reply(403, body = wire("presentation/403-not-enrolled.json"))
            val refusals =
                listOf(
                    Triple("a 404", notFound, PollProblem.Refused(404, ApiErrorReason.SessionNotFound)),
                    Triple("a 403", notEnrolled, PollProblem.Refused(403, null)),
                    Triple("a proxy's 502", Reply(502, body = "<html>Bad Gateway</html>"), PollProblem.Refused(502, null)),
                    Triple("a 200 it can't read", Reply.ok("<html>OK</html>"), PollProblem.Refused(200, null)),
                )
            for ((case, reply, problem) in refusals) {
                world.then(reply)
                world.poll(lesson)
                val state = lesson.state.value
                assertEquals(problem, state.problem, case)
                assertEquals(decoded(body), state.presentation, case)
            }

            world.then(Reply.notModified)
            world.poll(lesson)
            assertNull(lesson.state.value.problem)
            assertEquals(List(7) { 2.seconds }, world.slept)
            assertEquals("\"a\"", world.sent.last().headers["If-None-Match"])
        }

    @Test
    fun withNoTokenToSendNothingIsSentAndItSaysSo() =
        inTime {
            val world = LessonWorld(emptyList())
            val lesson = world.lesson(token = null)
            world.poll(lesson)
            assertTrue(world.sent.isEmpty())
            assertEquals(PollProblem.Unreachable(NoAnswer.NoToken), lesson.state.value.problem)
        }

    @Test
    fun cancelledAsTheAppGoesBehindItStopsAtOnceKeepingNothingOfTheReadUnderWay() =
        inTime {
            val body = wire("presentation/open.json")
            val over = Reply.ok(wire("presentation/over.json"), etag = "\"b\"").copy(cancels = true)
            val world = LessonWorld(listOf(Reply.ok(body, etag = "\"a\""), over))
            val lesson = world.lesson()
            launch { lesson.run() }.join()
            assertEquals(2, world.sent.size)
            assertEquals(listOf(2.seconds), world.slept)
            assertEquals(decoded(body), lesson.state.value.presentation)
        }

    @Test
    fun aSecondRunTakesOverTheFirstStopsAtItsReadSayingNothingOfItSoThePollNeverRunsTwice() =
        inTime {
            val slide = wire("presentation/slide.json")
            val world =
                LessonWorld(
                    listOf(
                        Reply.ok(wire("presentation/open.json"), etag = "\"a\""),
                        Reply.ok(asked(), etag = "\"stale\"").held,
                        Reply.ok(slide, etag = "\"b\""),
                    ),
                )
            val lesson = world.lesson()
            val first = launch { world.poll(lesson) }
            world.held(1)
            // A second run, never cancelling the first: it reads, and waits (no answer left: stopped).
            world.poll(lesson)
            world.release()
            first.join()
            assertEquals(3, world.sent.size)
            // The first run's one wait, and the second's: the first never waits, nor reads, again.
            assertEquals(listOf(2.seconds, 2.seconds), world.slept)
            assertEquals(decoded(slide), lesson.state.value.presentation)
        }

    @Test
    fun onceAReadSaysTheSessionIsOverAReadFailingAfterItSaysNothingOverNeverUnreachable() =
        inTime {
            val over = wire("presentation/over.json")
            val world = LessonWorld(listOf(Reply.ok(over, etag = "\"b\"")))
            val lesson = world.lesson()
            lesson.run()
            for ((case, reply) in listOf("offline" to Reply.offline, "a 500" to Reply(500))) {
                world.then(reply)
                lesson.run()
                val state = lesson.state.value
                assertNull(state.problem, case)
                assertEquals(decoded(over), state.presentation, case)
            }
            assertEquals(3, world.sent.size)
            assertTrue(world.slept.isEmpty(), "${world.slept}")
        }
}

/** A refusal's answer as the API words one: its [status], [reason] and [message], and what the lesson makes of it. */
private data class Refusal(val status: Int, val reason: String?, val message: String, val result: AnswerResult)

/** A live lesson's answer: LiveLessonTests.swift's LessonAnswerTests. */
class LessonAnswerTest {
    @Test
    fun eachRefusalTheApiAnswersWithIsKnownByItsReason() =
        inTime {
            val cases =
                listOf(
                    "answers/409-question-closed.json" to AnswerResult.QuestionClosed,
                    "answers/400-invalid-option.json" to AnswerResult.InvalidOption,
                    "answers/409-event-id-conflict.json" to AnswerResult.EventIdConflict,
                    "answers/403-not-enrolled.json" to AnswerResult.Refused(403, null),
                    "answers/404-question-not-found.json" to AnswerResult.Refused(404, ApiErrorReason.QuestionNotFound),
                )
            for ((fixture, result) in cases) {
                val world = LessonWorld(listOf(Reply(Contract.load(fixture).status, body = wire(fixture))))
                assertEquals(result, world.lesson().answer("q1", 0), fixture)
                assertEquals(1, world.sent.size, fixture)
            }
        }

    @Test
    fun aRefusalIsKnownByItsReasonNeverItsMessageABodyItCannotReadIsTheStatusAlone() =
        inTime {
            val cases =
                listOf(
                    Refusal(409, "account_deleted", "account deleted", AnswerResult.AccountDeleted),
                    Refusal(409, "event_id_conflict", "the question is closed", AnswerResult.EventIdConflict),
                    Refusal(409, null, "the question is closed", AnswerResult.Refused(409, null)),
                    Refusal(429, null, "over budget", AnswerResult.Refused(429, null)),
                )
            for (case in cases) {
                val code = if (case.status == 429) "rate_limited" else "conflict"
                val said = case.reason?.let { ",\"reason\":\"$it\"" }.orEmpty()
                val body = """{"error":{"code":"$code"$said,"message":"${case.message}"}}"""
                val world = LessonWorld(listOf(Reply(case.status, body = body)))
                assertEquals(case.result, world.lesson().answer("q1", 0), "$case")
            }
        }

    @Test
    fun anAnswerItCannotReadIsItsStatusAloneNeverAnAnswer() =
        inTime {
            val world = LessonWorld(listOf(Reply.ok("<html>OK</html>")))
            assertEquals(AnswerResult.Refused(200, null), world.lesson().answer("q1", 0))
        }

    @Test
    fun noAnswerIsSaidSoOfflineSentOnceOrNoTokenNothingSent() =
        inTime {
            val offline = LessonWorld(listOf(Reply.offline))
            assertEquals(AnswerResult.Unreachable(NoAnswer.Unreachable), offline.lesson().answer("q1", 0))
            assertEquals(1, offline.sent.size)
            val signedOut = LessonWorld(emptyList())
            assertEquals(AnswerResult.Unreachable(NoAnswer.NoToken), signedOut.lesson(token = null).answer("q1", 0))
            assertTrue(signedOut.sent.isEmpty())
        }

    @Test
    fun eachPickIsOneRequestUnderAnIdMintedAfterTheAnswerHeldFromAClockAMinuteBehindItAndAfterThePickBefore() =
        inTime {
            // The laptop answered a minute ahead of this phone's clock.
            val held = StudentAnswer(0, EventId.mint(start.plusSeconds(60)))
            val world = LessonWorld(listOf(Reply.ok(asked(answer = held), etag = "\"a\"")), now = start)
            val lesson = world.lesson()
            world.poll(lesson)
            world.then(Reply.offline, Reply.offline)
            assertEquals(AnswerResult.Unreachable(NoAnswer.Unreachable), lesson.answer("q1", 2))
            assertEquals(AnswerResult.Unreachable(NoAnswer.Unreachable), lesson.answer("q1", 1))

            val answers = world.sent.drop(1)
            assertEquals(2, answers.size)
            for (request in answers) {
                assertEquals("POST", request.method)
                assertEquals("https://api.bali.test/v1/questions/q1/answers", request.url.toString())
            }
            val bodies = answers.map(::picked)
            assertEquals(listOf(2, 1), bodies.map { it.option })
            val ids = bodies.map { it.eventId }
            assertTrue(ids.all { uuidV7.matches(it) }, "$ids")
            assertTrue(ids[0] > held.eventId, "${ids[0]} after ${held.eventId}")
            assertTrue(ids[1] > ids[0], "${ids[1]} after ${ids[0]}")
            // A millisecond on each time: random bits never decide the order.
            val held48 = checkNotNull(time(held.eventId))
            assertEquals(listOf(held48 + 1, held48 + 2), ids.map(::time))
        }

    @Test
    fun theAnswerTheServerHoldsIsKeptAndAReadMadeBeforeItLandedNeverTakesItBack() =
        inTime {
            val world = LessonWorld(listOf(Reply.ok(asked(), etag = "\"a\"")))
            val lesson = world.lesson()
            world.poll(lesson)

            val mine = StudentAnswer(1, EventId.mint(start))
            world.then(Reply.ok("""{"outcome":"answered","answer":{"option":1,"eventId":"${mine.eventId}"}}"""))
            assertEquals(AnswerResult.Answered(mine), lesson.answer("q1", 1))
            assertEquals(mine, lesson.state.value.presentation?.question?.answer)

            // A read the server made before the answer landed: the answer stays.
            world.then(Reply.ok(asked(), etag = "\"b\""))
            world.poll(lesson)
            assertEquals(mine, lesson.state.value.presentation?.question?.answer)

            // The laptop's later answer, read: that one is the answer now.
            val laptop = StudentAnswer(2, EventId.mint(start.plusSeconds(5)))
            world.then(Reply.ok(asked(answer = laptop), etag = "\"c\""))
            world.poll(lesson)
            assertEquals(laptop, lesson.state.value.presentation?.question?.answer)

            // A replay answering the laptop's, older than what is held, changes nothing kept.
            world.then(Reply.ok("""{"outcome":"replay","answer":{"option":1,"eventId":"${mine.eventId}"}}"""))
            assertEquals(AnswerResult.Answered(mine), lesson.answer("q1", 1))
            assertEquals(laptop, lesson.state.value.presentation?.question?.answer)
        }

    @Test
    fun aPickOnOneQuestionNeverShowsAsTheAnswerToTheNextNotThroughAReadNorLandingLate() =
        inTime {
            val world = LessonWorld(listOf(Reply.ok(asked(), etag = "\"a\"")))
            val lesson = world.lesson()
            world.poll(lesson)
            world.then(Reply.took)
            val mine = (lesson.answer("q1", 1) as? AnswerResult.Answered)?.answer ?: fail("the pick on q1 was not taken")
            assertEquals(mine, lesson.state.value.presentation?.question?.answer)

            // The teacher opens q2: its read shows no answer yet.
            world.then(Reply.ok(asked("q2"), etag = "\"b\""))
            world.poll(lesson)
            assertEquals("q2", lesson.state.value.presentation?.question?.id)
            assertNull(lesson.state.value.presentation?.question?.answer)

            // A tap on q1's card made before it changed, landing now: taken, and kept off q2's card.
            world.then(Reply.took)
            val late = lesson.answer("q1", 2)
            assertEquals(AnswerResult.Answered(StudentAnswer(2, answerIds(world)[1])), late)
            assertNull(lesson.state.value.presentation?.question?.answer)
        }

    @Test
    fun anAnswerLandingWhileAPollIsOutStaysOnTheCardWhenThatPollsOlderReadComesBack() =
        inTime {
            // The second read is the server's from before the answer landed: it holds none.
            val world = LessonWorld(listOf(Reply.ok(asked(), etag = "\"a\""), Reply.ok(asked(), etag = "\"b\"").held, Reply.took))
            val lesson = world.lesson()
            val polling = launch { world.poll(lesson) }
            world.held(1)
            val mine = (lesson.answer("q1", 1) as? AnswerResult.Answered)?.answer ?: fail("the pick was not taken")
            world.release()
            polling.join()
            assertEquals(mine, lesson.state.value.presentation?.question?.answer)
        }

    @Test
    fun twoQuickTapsFromAClockAMinuteBehindLandInOrderTheSecondMintedAfterTheFirstAndKeptWhicheverAnswerComesBackLast() =
        inTime {
            val held = StudentAnswer(0, EventId.mint(start.plusSeconds(60)))
            val world = LessonWorld(listOf(Reply.ok(asked(answer = held), etag = "\"a\"")), now = start)
            val lesson = world.lesson()
            world.poll(lesson)
            world.then(Reply.took.held, Reply.took)
            val first = async { lesson.answer("q1", 2) }
            world.held(1)
            val second = lesson.answer("q1", 1)
            world.release()
            val answered = first.await()

            val ids = answerIds(world)
            val held48 = checkNotNull(time(held.eventId))
            assertEquals(listOf(held48 + 1, held48 + 2), ids.map(::time))
            assertEquals(AnswerResult.Answered(StudentAnswer(2, ids[0])), answered)
            assertEquals(AnswerResult.Answered(StudentAnswer(1, ids[1])), second)
            // The first tap's answer came back last; the second's, sorting after it, is the one kept.
            assertEquals(StudentAnswer(1, ids[1]), lesson.state.value.presentation?.question?.answer)
        }
}

/** A deck's bytes in a test, and their SHA-256 as the API gives a slide's. */
private val pdf = "%PDF-1.7 Factoring quadratics"
private val pdfSha256 = "bb00f1264482b1749c27e894811b96e133b8f53a83f9794981f20455b7037afc"

/** What a slide is given once that deck is in. */
private val ready = DeckResult.Ready(pdf.encodeToByteArray())

/** A page of that deck, shown. */
private fun slide(page: Int = 4) = Slide("d1", pdfSha256, page, 12)

/** The bucket's answer: the deck's bytes. */
private val bucket = Reply(200, body = pdf)

/** Where the download fixture sends the phone, and where the route is. */
private val fixtureUrl = "https://deck-storage.invalid/decks%2F00000000-0000-7000-8000-000000000001.pdf?signature=fixture"
private val route = "https://api.bali.test/v1/decks/d1/download"

/** A slide's deck: LiveLessonTests.swift's LessonDeckTests. */
class LessonDeckTest {
    @Test
    fun itAsksForAUrlFetchesTheBytesWithNoTokenAndKeepsThemTheNextPageAsksNothing() =
        inTime {
            val world = LessonWorld(listOf(Reply.ok(wire("download/shown.json")), bucket))
            val lesson = world.lesson()
            assertEquals(ready, lesson.deck(slide(page = 4)))
            assertEquals(ready, lesson.deck(slide(page = 5)))

            val sent = world.sent
            assertEquals(listOf(route, fixtureUrl), sent.map { it.url.toString() })
            assertEquals(listOf("GET", "GET"), sent.map { it.method })
            assertEquals(listOf("Bearer t", null), sent.map { it.headers["Authorization"] })
            // The bucket's request carries one header, its ask for the bytes as stored (Q6), and waits as the client's do.
            assertEquals(mapOf("Accept-Encoding" to "identity"), sent[1].headers)
            assertEquals(ApiClient.REQUEST_TIMEOUT, sent[1].timeout)
        }

    @Test
    fun bytesWhoseSha256IsNotTheSlidesAreRefusedAndKeptNowhereTheNextAskFetchesAgain() =
        inTime {
            val shown = Reply.ok(wire("download/shown.json"))
            val world = LessonWorld(listOf(shown, Reply(200, body = "%PDF-1.7 Something else"), shown, bucket))
            val lesson = world.lesson()
            assertEquals(DeckResult.Mismatch, lesson.deck(slide()))
            assertEquals(ready, lesson.deck(slide()))
            assertEquals(4, world.sent.size)
        }

    @Test
    fun aUrlTheBucketRefusesAsItRefusesOneExpiredIsAskedForAgainOnceRefusedAgainItIsSaid() =
        inTime {
            val expired = Reply(403, body = "<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>")
            val freshUrl = "https://deck-storage.invalid/decks%2Fd1.pdf?signature=fresh"
            val fresh = Reply.ok("""{"url":"$freshUrl"}""")
            val world = LessonWorld(listOf(Reply.ok(wire("download/shown.json")), expired, fresh, bucket))
            assertEquals(ready, world.lesson().deck(slide()))
            assertEquals(listOf(route, fixtureUrl, route, freshUrl), world.sent.map { it.url.toString() })

            // The fresh URL refused too: said, and never asked for a third time.
            world.then(fresh, expired, fresh, expired)
            assertEquals(DeckResult.Refused(403, null), world.lesson().deck(slide()))
            assertEquals(8, world.sent.size)
        }

    @Test
    fun eachRefusalOfTheDownloadIsSaidByItsStatusAndReasonAskedOnceAndKeptNowhere() =
        inTime {
            val cases =
                listOf(
                    "download/403-not-shown.json" to DeckResult.Refused(403, null),
                    "download/404-deck-not-found.json" to DeckResult.Refused(404, ApiErrorReason.DeckNotFound),
                    "download/503-deck-storage-off.json" to DeckResult.Refused(503, ApiErrorReason.DeckStorageOff),
                )
            for ((fixture, result) in cases) {
                val refused = Reply(Contract.load(fixture).status, body = wire(fixture))
                val world = LessonWorld(listOf(refused, refused))
                val lesson = world.lesson()
                assertEquals(result, lesson.deck(slide()), fixture)
                assertEquals(result, lesson.deck(slide()), fixture)
                assertEquals(2, world.sent.size, fixture)
            }
        }

    @Test
    fun noAnswerAnAnswerItCannotReadOrTheBucketsOwnRefusalIsSaidWithNoTokenNothingIsSent() =
        inTime {
            val shown = Reply.ok(wire("download/shown.json"))
            val elsewhere = Reply(302, mapOf("Location" to "https://elsewhere.test/"))
            val cases =
                listOf(
                    Triple("offline", listOf(Reply.offline), DeckResult.Unreachable(NoAnswer.Unreachable)),
                    Triple("a 200 it can't read", listOf(Reply.ok("<html>OK</html>")), DeckResult.Refused(200, null)),
                    Triple("a URL it can't read", listOf(Reply.ok("""{"url":"not a url"}""")), DeckResult.Refused(200, null)),
                    Triple("the bucket offline", listOf(shown, Reply.offline), DeckResult.Unreachable(NoAnswer.Unreachable)),
                    Triple("the bucket's 500", listOf(shown, Reply(500)), DeckResult.Refused(500, null)),
                    Triple("the bucket's redirect", listOf(shown, elsewhere), DeckResult.Refused(302, null)),
                )
            for ((case, replies, result) in cases) {
                val world = LessonWorld(replies)
                assertEquals(result, world.lesson().deck(slide()), case)
                assertEquals(replies.size, world.sent.size, case)
            }
            val signedOut = LessonWorld(emptyList())
            assertEquals(DeckResult.Unreachable(NoAnswer.NoToken), signedOut.lesson(token = null).deck(slide()))
            assertTrue(signedOut.sent.isEmpty())
        }

    @Test
    fun theSessionsEndEmptiesWhatItKeptOnceAReadSaysItIsOverTheDeckIsAskedForAgain() =
        inTime {
            val world = LessonWorld(listOf(Reply.ok(wire("download/shown.json")), bucket))
            val lesson = world.lesson()
            assertEquals(ready, lesson.deck(slide()))
            world.then(Reply.ok(wire("presentation/over.json"), etag = "\"b\""))
            lesson.run()

            world.then(Reply(403, body = wire("download/403-not-shown.json")))
            assertEquals(DeckResult.Refused(403, null), lesson.deck(slide()))
            assertEquals(4, world.sent.size)
        }

    @Test
    fun aDeckStillOnItsWayWhenTheSessionEndsGoesToItsAskerAndIsKeptNowhere() =
        inTime {
            val world = LessonWorld(listOf(Reply.ok(wire("download/shown.json")), bucket.held))
            val lesson = world.lesson()
            val fetching = async { lesson.deck(slide()) }
            world.held(1)
            world.then(Reply.ok(wire("presentation/over.json"), etag = "\"b\""))
            lesson.run()
            world.release()
            assertEquals(ready, fetching.await())

            world.then(Reply(403, body = wire("download/403-not-shown.json")))
            assertEquals(DeckResult.Refused(403, null), lesson.deck(slide()))
            assertEquals(4, world.sent.size)
        }

    @Test
    fun anAskCancelledOnItsWayEndsByThrowingSayingNothingAndKeepsNothingTheNextAskFetchesAgain() =
        inTime {
            // Kotlin's own: a cancelled coroutine's ask throws, as the client's calls do, where Swift's says it is unreachable.
            val world = LessonWorld(listOf(Reply.ok(wire("download/shown.json")), bucket.held))
            val lesson = world.lesson()
            var said: DeckResult? = null
            val asking = launch { said = lesson.deck(slide()) }
            world.held(1)
            asking.cancelAndJoin()
            assertNull(said)

            world.then(Reply.ok(wire("download/shown.json")), bucket)
            assertEquals(ready, lesson.deck(slide()))
            assertEquals(4, world.sent.size)
        }
}

/** [bytes] gzipped, as an upload naming `Content-Encoding: gzip` could leave them stored. */
private fun gzipped(bytes: ByteArray): ByteArray =
    ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(bytes) } }.toByteArray()

/** [bytes]' SHA-256 in lower-case hex, as the API gives a slide's. */
private fun sha256Hex(bytes: ByteArray) =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/**
 * A slide's deck on the wire, over a real socket: the bucket's request as the app's own transport sends it, as
 * OkHttpTransportTest checks the API's. Kotlin's own: OkHttp, like URLSession, asks for gzip by itself and decodes what an
 * answer names, so the bucket is asked for the bytes as stored (Q6).
 */
class LessonDeckWireTest {
    /** How long a test waits on its local servers: answered, a request takes milliseconds. */
    private val stall = 1.minutes

    /** Session `s1`'s lesson, its client of [api] signed in, on the app's own transport, waits only a broken test outlasts. */
    private fun lesson(api: MockWebServer): LiveLesson {
        val client = OkHttpTransport.makeClient().newBuilder().callTimeout(stall.inWholeMilliseconds, MILLISECONDS).build()
        return LiveLesson("s1", ApiClient(api.url("/").toUri(), FixedToken("token-real"), OkHttpTransport(client), stall))
    }

    /** The URL of [target] on [storage], written out by hand, so the API's answer names exactly it. */
    private fun presigned(storage: MockWebServer, target: String) = storage.url("/").toString().trimEnd('/') + target

    @Test
    fun thePresignedUrlReachesTheBucketAsTheApiWroteItEachPercent2FUnchangedAndNoAuthorizationHeader(): Unit =
        inTime {
            MockWebServer().use { api ->
                MockWebServer().use { storage ->
                    storage.enqueue(MockResponse(body = pdf))
                    storage.start()
                    // The key's slash escaped, as the fixture and the API's stand-in write it, the credential's as S3's do.
                    val target =
                        "/decks%2Fd1.pdf?X-Amz-Credential=AKIDEXAMPLE%2F20261112%2Fus-east-1%2Fs3%2Faws4_request" +
                            "&X-Amz-Signature=fe5f80f77d5fa3beca038a248ff027d0445342fe2855ddc963176630326f1024"
                    api.enqueue(MockResponse(body = """{"url":"${presigned(storage, target)}"}"""))
                    api.start()
                    assertEquals(ready, lesson(api).deck(slide()))
                    assertEquals("Bearer token-real", api.takeRequest().headers["Authorization"])
                    val fetched = storage.takeRequest()
                    assertEquals("GET $target HTTP/1.1", fetched.requestLine)
                    assertNull(fetched.headers["Authorization"])
                }
            }
        }

    @Test
    fun itAsksTheBucketForIdentityAndAnAnswerNamedGzipIsLeftUndecodedSoTheHashSeesItsBytesAsSent(): Unit =
        inTime {
            // Gzipped, as S3 keeps an encoding an upload names unsigned: decoded, these would be the deck itself.
            val stored = gzipped(pdf.encodeToByteArray())
            MockWebServer().use { api ->
                MockWebServer().use { storage ->
                    storage.start()
                    api.start()
                    repeat(2) {
                        val gzip = MockResponse.Builder().addHeader("Content-Encoding", "gzip").body(Buffer().write(stored))
                        storage.enqueue(gzip.build())
                        api.enqueue(MockResponse(body = """{"url":"${presigned(storage, "/decks%2Fd1.pdf?signature=s")}"}"""))
                    }
                    val lesson = lesson(api)
                    // Hashed as sent: a slide naming the stored bytes' hash is given those bytes, never their decoding,
                    assertEquals(DeckResult.Ready(stored), lesson.deck(Slide("d1", sha256Hex(stored), 4, 12)))
                    // and one naming the deck's own refuses them: nothing decodes them into a match.
                    assertEquals(DeckResult.Mismatch, lesson.deck(slide()))
                    repeat(2) { assertEquals("identity", storage.takeRequest().headers["Accept-Encoding"]) }
                }
            }
        }
}
