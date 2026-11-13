package com.bali.bali

import android.content.Context
import androidx.core.content.edit
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.ApiClient
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.SignIn
import com.bali.core.TokenProvider
import com.bali.outbox.Lessons
import com.bali.outbox.Outbox
import com.bali.outbox.SlideShown
import com.bali.outbox.SyncEngine
import java.net.URI
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The lesson half in the app (AN13g), BaliApp.swift's `start` and `setForeground`, the lesson's lines: one a run beside the
 * account, in the run's own scope, its poll driven by Bali's screen in front ([BaliApp.front]), its slide's deck opened by the
 * app's renderer. Each run is the test's own, as BaliAppTest's are: a sign-in, a server and an outbox file of the test's own
 * (TestSignIn.kt), and the lesson half's client handed to [BaliApp.start] over that same server ([LessonCalls]), so nothing
 * reaches dev: the build's config is dev's since AN6d, and the app's own lesson client goes with the app's own run alone. A
 * check that something doesn't happen waits for a mark (a call's sender leaving, a binding's end, the server's count after a
 * known request), never a window of time.
 */
@RunWith(AndroidJUnit4::class)
class LessonAppTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val app = context.applicationContext as BaliApp
    private val server = Server()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val opened = mutableListOf<Pair<String, Outbox>>()

    /** The phone's notes as the test found them, put back after: a run's account writes them. */
    private var found: Pair<String?, String?> = null to null

    // After the app's own start, its run ended (BaliAppTest's), Bali behind, and nobody's notes on the phone.
    @Before
    fun begin(): Unit =
        runBlocking {
            app.launched.join()
            app.running.value?.job?.cancelAndJoin()
            app.front.value = false
            found = app.notes.run { inClass to listSeenBy }
            app.notes.forgetStudent()
        }

    // Each run ended before its outbox closes (the engine rig's teardown, AN5c), the renderer let go, the notes put back.
    @After
    fun end(): Unit =
        runBlocking {
            app.front.value = false
            app.running.value?.job?.cancelAndJoin()
            withTimeout(PATIENCE) { scope.coroutineContext.job.cancelAndJoin() }
            server.close()
            opened.forEach { (file, outbox) ->
                outbox.close()
                context.deleteDatabase(file)
            }
            app.notes.inClass = found.first
            app.notes.listSeenBy = found.second
            // Through to the disk now, as the notes write behind: the process ends with the run, and the next reads them as found.
            context.getSharedPreferences(NOTES_FILE, Context.MODE_PRIVATE).edit(commit = true) {}
            until { Unit.takeIf { app.renderer.bound == null } }
        }

    // BaliApp.swift's setForeground: the lesson's poll runs only while Bali's screen is in front (#330), cancelled as it goes
    // behind and run again as it comes back, Bali in front reaching the lesson half as it reaches the engine (BaliApp.front).
    @Test
    fun theLessonsPollReachesTheServerOnlyWhileBaliIsInFrontItsReadOnItsWayCutShortAsBaliGoesBehind(): Unit =
        runBlocking {
            val lesson = inLesson()
            // Followed behind the app, nothing read: the lesson's first call is its read once Bali is in front.
            app.front.value = true
            lesson.read(presentation())
            assertEquals(listOf(poll()), lesson.calls.routes)
            until { lesson.lessons.state.value.card }
            // In front it reads again, 2 s on; that read, on its way as Bali goes behind, is cut short, and the poll with it.
            server.next(poll())
            app.front.value = false
            cutShort(lesson.calls.sent[1], "the poll's read on its way as Bali went behind")
            // Back in front, it reads at once: the third call of the lesson's, so none went while Bali was behind.
            app.front.value = true
            server.next(poll())
            assertEquals(listOf(poll(), poll(), poll()), lesson.calls.routes)
        }

    // ARCHITECTURE's "Live lesson", decision 5: an answer goes in one request of the lesson's own, never through the outbox,
    // so the run's outbox file holds none, and nothing of the lesson's ever waits there ahead of an Emergency Unlock.
    @Test
    fun anAnswerIsOneRequestOfTheLessonsOwnClientAndLeavesNothingInTheRunsOutboxFile(): Unit =
        runBlocking {
            val lesson = inLesson()
            app.front.value = true
            lesson.read(presentation())
            until { lesson.lessons.state.value.card }
            for ((taps, option) in listOf(1, 2).withIndex()) {
                val tapped = scope.async { lesson.lessons.answer(option) }
                val pick = server.next(ANSWER)
                pick.reply(200, took(pick))
                withTimeout(PATIENCE) { tapped.await() }
                assertEquals(option, lesson.lessons.state.value.lesson?.presentation?.question?.answer?.option)
                // The tap's call has ended, so this is all it sent.
                assertEquals("requests for tap ${taps + 1}", taps + 1, lesson.calls.routes.count { it == ANSWER })
            }
            assertEquals(emptyList<Any>(), lesson.run.engine.updates.value.queued)
            assertEquals(emptyList<Any>(), lesson.outbox.records())
        }

    // AppTests' slideOncePerDeck, in the app: the slide's deck asked for as AS8 will ask (`ask`), fetched once, opened by the
    // app's renderer, and drawn through the Deck its ready phase holds; a page turned fetches nothing and draws from the same one.
    @Test
    fun aSlidesDeckAskedForAsTheScreensWillIsFetchedOnceAndDrawnByTheAppsRendererAcrossAPageTurn(): Unit =
        runBlocking {
            val lesson = inLesson()
            val deck = drawnDeck()
            app.front.value = true
            lesson.read(presentation(slide = slideOf(deck, page = 1)))
            val document = lesson.open(deck)
            assertColor(MARKS[0], checkNotNull(document.draw(1, 400, 300)) { "page 1 not drawn" }.bitmap.at(200, 150), "page 1")
            // The teacher turns the page, the poll's next read naming page 2, and the screen asks again as the slide changes.
            lesson.read(presentation(slide = slideOf(deck, page = 2)))
            val turned = until { lesson.lessons.state.value.slide?.takeIf { it.slide.page == 2 } }
            lesson.lessons.ask(turned.slide)
            assertSame(document, (turned.phase as SlideShown.Phase.Ready).document)
            assertColor(MARKS[1], checkNotNull(document.draw(2, 400, 300)) { "page 2 not drawn" }.bitmap.at(200, 150), "page 2")
            // The poll's next read, a request known to come after the ask: by then, one download and one GET at the bucket.
            server.next(poll())
            assertEquals(listOf(DOWNLOAD, BUCKET), lesson.calls.routes.filter { it != poll() })
        }

    // BaliApp.swift's start follows the lesson with the account: a run with none has no lesson half, though a client is handed
    // for it. (A start given no config, whose engine has neither, is BaliAppTest's.)
    @Test
    fun aRunWithNoAccountHasNoLessonHalfThoughHandedTheLessonsClient(): Unit =
        runBlocking {
            val outbox = outbox(FILE)
            app.start(SyncEngine.open(outbox, ApiClient(URI(API), NoToken, server), scope), scope, ApiClient(URI(API), NoToken, LessonCalls(server)))
            val run = checkNotNull(app.running.value)
            assertNull(run.account)
            assertNull("a lesson half with no account", run.lessons)
        }

    // The lesson half lives in the run's own scope (AN13g), so the run's end ends all of it: here Period 3's bell has rung and
    // Period 4's lesson is followed in its place (Q7), its slide's deck open in the app's renderer, an answer and a read on their
    // way. The run's end cuts both short, closes the document, and the renderer's process ends, unbound; after it, nothing of the
    // lesson's reaches the server, as the next run's first read shows.
    @Test
    fun theRunsEndStopsTheWholeLessonHalfTheLessonItsBellFollowedItsCallsOnTheirWayAndItsDocumentTheRendererUnbound(): Unit =
        runBlocking {
            val me = meInSession(rings = Instant.now().plusSeconds(BELL_IN), later = Instant.now().plusSeconds(3600))
            val lesson = inLesson(me)
            val deck = drawnDeck()
            app.front.value = true
            lesson.read(presentation())
            // Period 3's bell, by the phone's clock: Period 4's lesson followed afresh, read at once.
            lesson.read(presentation(slide = slideOf(deck)), session = "s2")
            val document = lesson.open(deck)
            val died = rendererDeath()
            val tapped = scope.async { lesson.lessons.answer(1) }
            server.next(ANSWER)
            server.next(poll("s2"))
            val calls = lesson.calls.sent
            lesson.run.job.cancelAndJoin()
            cutShort(calls.single { it.route == ANSWER }, "the answer on its way as the run ended")
            cutShort(calls.last { it.route == poll("s2") }, "the read on its way as the run ended")
            withTimeout(PATIENCE) { tapped.join() }
            assertTrue("the answer's caller left waiting", tapped.isCancelled)
            assertNull("a page of the ended run's document", document.draw(1, 400, 300))
            until { Unit.takeIf { app.renderer.bound == null } }
            assertTrue("the renderer's process never ended", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
            // The next run's lesson half reads at once, Bali in front: by then, nothing more of the ended run's.
            val next = next(lesson.signIn, me)
            server.next(poll("s2"))
            assertEquals(listOf(poll("s2")), next.calls.routes)
            assertEquals(calls.map { it.route }, lesson.calls.routes)
        }

    // BaliApp.start in place of a run before: the new run has a lesson half of its own, which reads at once with Bali in front,
    // and the old one's ends with its run, its read on its way cut short and its document closed, the renderer's process ended.
    @Test
    fun aNewStartMakesALessonHalfOfItsOwnAndTheOldOnesReadIsCutShortAndItsDocumentClosed(): Unit =
        runBlocking {
            val first = inLesson()
            val deck = drawnDeck()
            app.front.value = true
            first.read(presentation(slide = slideOf(deck)))
            val document = first.open(deck)
            val died = rendererDeath()
            server.next(poll())
            val calls = first.calls.sent
            val second = next(first.signIn, meInSession())
            assertNotSame(first.lessons, second.lessons)
            cutShort(calls.last { it.route == poll() }, "the old lesson half's read on its way")
            assertNull("a page of the old run's document", document.draw(1, 400, 300))
            until { Unit.takeIf { app.renderer.bound == null } }
            assertTrue("the renderer's process never ended", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
            // The new one reads at once through its own client, Bali in front: by then, nothing more of the old one's.
            server.next(poll())
            assertEquals(listOf(poll()), second.calls.routes)
            assertEquals(calls.map { it.route }, first.calls.routes)
        }

    /** A run of the test's own following Ana's lesson: the run, its lesson half, the calls its client sent, her sign-in and the outbox. */
    private class Lesson(val run: BaliApp.Running, val lessons: Lessons, val calls: LessonCalls, val signIn: SignIn, val outbox: Outbox)

    /**
     * A run of the test's own with Ana signed in, through the 13+ check, `GET /v1/me` read as [me] says, and the consent list seen
     * here, so its lesson half follows her first class in session: Bali behind, nothing of the lesson's read yet.
     */
    private suspend fun inLesson(me: String = meInSession()): Lesson {
        val signIn = testSignIn(server, scope)
        val lesson = start(FILE, signIn)
        val account = checkNotNull(lesson.run.account)
        until { account.state.value.takeIf { it.signedIn == false } }
        server.signStudentIn(signIn, scope, "u1")
        server.next(AGE_CHECK).reply(200, PASSED)
        // Each read of the truth answered until one lands (BaliAppTest's notes test: AN9d's `meChanges`).
        until {
            if ("GET /v1/me" in server.waiting) server.next("GET /v1/me").reply(200, me)
            account.state.value.sync?.me
        }
        account.sawList()
        until { lesson.lessons.state.value.lesson }
        return lesson
    }

    /** The app's next run, in place of any before, over a file of its own, Ana still signed in on [signIn]: its lesson followed once read [me]. */
    private suspend fun next(signIn: SignIn, me: String): Lesson {
        val lesson = start(NEXT_FILE, signIn)
        until {
            if ("GET /v1/me" in server.waiting) server.next("GET /v1/me").reply(200, me)
            lesson.lessons.state.value.lesson
        }
        return lesson
    }

    /** The app's run started, in place of any before, over outbox [file] and [signIn], its lesson half's client over the server. */
    private suspend fun start(file: String, signIn: SignIn): Lesson {
        val outbox = outbox(file)
        val calls = LessonCalls(server)
        app.start(SyncEngine.make(outbox, URI(API), signIn, scope, server), scope, ApiClient(URI(API), signIn, calls))
        val run = checkNotNull(app.running.value)
        return Lesson(run, checkNotNull(run.lessons) { "no lesson half beside the account" }, calls, signIn, outbox)
    }

    /** An outbox file of the test's own, [file], made afresh: closed and deleted after. */
    private fun outbox(file: String): Outbox {
        context.deleteDatabase(file)
        return context.outbox(file).also { opened += file to it }
    }

    /** The lesson's next read of [session], once sent, answered with [body]. */
    private fun Lesson.read(body: String, session: String = "s") = server.next(poll(session)).reply(200, body)

    /** The slide the lesson shows asked for as AS8 will ask (`ask`), its deck's download and its bucket answered with [deck]: its document. */
    private suspend fun Lesson.open(deck: ByteArray): Deck {
        lessons.ask(until { lessons.state.value.slide }.slide)
        server.next(DOWNLOAD).reply(200, PRESIGNED)
        server.next(BUCKET).reply(200, deck)
        return until { lessons.state.value.slide?.phase as? SlideShown.Phase.Ready }.document as Deck
    }

    /** [call], one of the lesson's, cut short, its sender no longer waiting for its answer; still waiting fails the test, naming [case]. */
    private suspend fun cutShort(call: LessonCalls.Call, case: String) =
        assertNotNull("$case went on", withTimeoutOrNull(PATIENCE) { call.left.await() })

    /** Opens as the app's renderer's process ends: Android's own notice, taken while it is bound. */
    private suspend fun rendererDeath(): CountDownLatch {
        val service = checkNotNull(checkNotNull(app.renderer.bound) { "unbound" }.service.await()) { "never bound" }
        return CountDownLatch(1).also { latch -> service.linkToDeath({ latch.countDown() }, 0) }
    }

    private companion object {
        const val FILE = "lesson-app-test.sqlite"
        const val NEXT_FILE = "lesson-app-test-next.sqlite"
        const val ANSWER = "POST /v1/questions/q/answers"
        const val DOWNLOAD = "GET /v1/decks/d1/download"
        const val BUCKET = "GET /decks/d1.pdf"

        /** Deck d1's download: a presigned GET at the bucket, its key's slash escaped as S3's are. */
        const val PRESIGNED = """{"url":"https://bucket.bali.test/decks%2Fd1.pdf?signature=s"}"""

        /** Period 3's bell, from the test's start: time enough to follow its lesson first, on the slowest emulator. */
        const val BELL_IN = 10L

        val PATIENCE = 30.seconds
    }
}

/**
 * The lesson half's own transport in a test, as the app's is one apart from the engine's (AN13d): through [server], each call
 * kept, with a mark of its sender leaving as a cancel cuts it short.
 */
private class LessonCalls(private val server: Server) : HttpTransport {
    class Call(val route: String) {
        /** Completed once its sender stops waiting for its answer. */
        val left = CompletableDeferred<Unit>()
    }

    private val calls = CopyOnWriteArrayList<Call>()

    /** Every call sent so far, in order. */
    val sent: List<Call> get() = calls.toList()

    val routes: List<String> get() = sent.map { it.route }

    override suspend fun send(request: HttpRequest): HttpAnswer {
        val call = Call("${request.method} ${request.url.path}").also { calls += it }
        try {
            return server.send(request)
        } catch (cancelled: CancellationException) {
            call.left.complete(Unit)
            throw cancelled
        }
    }
}

/** No token, ever: an engine opened with no sign-in, as a Debug build's while sign-in isn't set up. */
private object NoToken : TokenProvider {
    override suspend fun accessToken(): String? = null
}

/** Session [session]'s read of the presentation. */
private fun poll(session: String = "s") = "GET /v1/sessions/$session/presentation"

/** `GET /v1/me` naming Ana, u1, in Period 3, its session s live until [rings], and in Period 4, s2, live until [later] where given. */
private fun meInSession(rings: Instant = Instant.now().plusSeconds(3600), later: Instant? = null): String {
    fun row(id: String, name: String, session: String, ends: Instant) =
        """{"id":"$id","name":"$name","teacher":{"displayName":"Ms. Rivera"},"liveSession":{"id":"$session","endsAt":"$ends"}}"""
    val rows = listOfNotNull(row("p3", "Period 3", "s", rings), later?.let { row("p4", "Period 4", "s2", it) })
    return """{"user":{"id":"u1","role":"student","displayName":"Ana"},"classes":[${rows.joinToString(",")}],"session":null}"""
}

/** A running session's presentation: question q open, four answers, none of the student's read; the [slide] shown, none by default. */
private fun presentation(slide: String? = null) =
    """{"running":true,"question":{"id":"q","prompt":"Which?","options":["A","B","C","D"],"open":true,"correctOption":null,"answer":null},""" +
        """"slide":${slide ?: "null"},"phone":null}"""

/** Page [page] of deck d1, [deck]'s bytes, as the presentation read names it. */
private fun slideOf(deck: ByteArray, page: Int = 1) =
    """{"deckId":"d1","sha256":"${MessageDigest.getInstance("SHA-256").digest(deck).joinToString("") { "%02x".format(it) }}","page":$page,"pageCount":3}"""

/** The answer Bali holds once it takes the pick [pick] sent, as `POST /v1/questions/{id}/answers` answers it. */
private fun took(pick: Server.Exchange): String {
    val sent = pick.request.body?.decodeToString().orEmpty()
    val (eventId, option) = listOf(""""eventId":"([^"]+)"""", """"option":([0-9]+)""").map { checkNotNull(Regex(it).find(sent)).groupValues[1] }
    return """{"outcome":"answered","answer":{"option":$option,"eventId":"$eventId"}}"""
}

/** A three-page deck drawn in code, each page its own colour ([MARKS], page 1 first), as its bytes. */
private fun drawnDeck(): ByteArray {
    val deck: ByteBuffer = deck(3) { canvas, page -> canvas.drawColor(MARKS[page - 1]) }
    return ByteArray(deck.remaining()).also { deck.duplicate().get(it) }
}
