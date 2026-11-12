package com.bali.core

import java.net.InetAddress
import java.net.ServerSocket
import java.net.URI
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit.MILLISECONDS
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.EventListener
import okhttp3.Headers.Companion.headersOf
import okhttp3.Request

/** The OkHttp transport, over a real socket: APIClientTests.swift's URLSessionTransportTests. */
class OkHttpTransportTest {
    /** How long a test waits on its local server: answered, a request takes milliseconds. */
    private val stall = 1.minutes

    /** The app's own client, every wait of it [wait]. */
    private fun waitingClient(wait: Duration) =
        OkHttpTransport.makeClient().newBuilder()
            .connectTimeout(wait.inWholeMilliseconds, MILLISECONDS)
            .readTimeout(wait.inWholeMilliseconds, MILLISECONDS)
            .writeTimeout(wait.inWholeMilliseconds, MILLISECONDS)
            .callTimeout(wait.inWholeMilliseconds, MILLISECONDS)

    private fun waiting(wait: Duration) = OkHttpTransport(waitingClient(wait).build())

    /** A client of [server], over the app's own transport with waits only a broken test outlasts. */
    private fun client(server: MockWebServer) =
        ApiClient(server.url("/").toUri(), FixedToken("token-real"), waiting(stall), stall)

    @Test
    fun aRealAnswerComesBackItsStatusAndBodyWithTheTokenSentOnTheWire(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                val fixture = Contract.load("me/in-session.json")
                server.enqueue(MockResponse(200, headersOf("Content-Type", "application/json"), fixture.body.toString()))
                server.start()
                val me = client(server).me()
                assertEquals(SendResult.Status(200), me.result)
                assertEquals(appDecode(MeResponse.serializer(), fixture.body), me.answer)
                val sent = server.takeRequest()
                assertEquals("GET /v1/me HTTP/1.1", sent.requestLine)
                assertEquals("Bearer token-real", sent.headers["Authorization"])
            }
        }

    @Test
    fun aPatchGoesOnTheWireWithItsBodyAndItsTypeAsTheApiReadIt(): Unit =
        runBlocking {
            // PATCH, which the JDK's own HttpURLConnection can't send, is why the transport is OkHttp.
            MockWebServer().use { server ->
                val fixture = Contract.load("name/applied.json")
                server.enqueue(MockResponse(body = fixture.body.toString()))
                server.start()
                val renamed = client(server).updateMe(fixture.sent())
                assertEquals(appDecode(UpdateMeResponse.serializer(), fixture.body), renamed.answer)
                val sent = server.takeRequest()
                assertEquals("PATCH /v1/me HTTP/1.1", sent.requestLine)
                assertEquals("application/json", sent.headers["Content-Type"])
                assertEquals(fixture.request.body, BaliJson.parseToJsonElement(checkNotNull(sent.body).utf8()))
            }
        }

    @Test
    fun aPollsIfNoneMatchGoesOnTheWireAndIts304ComesBackAsItselfItsETagRead(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse(304, headersOf("ETag", "\"a\"")))
                server.start()
                val read = client(server).presentation("s1", ifNoneMatch = "\"a\"")
                assertEquals(SendResult.Status(304), read.result)
                assertEquals("\"a\"", read.etag)
                assertNull(read.answer)
                assertNull(read.error)
                val sent = server.takeRequest()
                assertEquals("GET /v1/sessions/s1/presentation HTTP/1.1", sent.requestLine)
                assertEquals("\"a\"", sent.headers["If-None-Match"])
            }
        }

    @Test
    fun aServerThatNeverAnswersTimesOutAsNoAnswerOnTheRequestsOwnWait(): Unit =
        runBlocking {
            // Never accepted: the connection waits in the listen backlog, never read or answered.
            ServerSocket(0, 8, InetAddress.getLoopbackAddress()).use { listener ->
                // A client that would wait two stalls: the request's own second must end it first.
                val client =
                    ApiClient(URI("http://127.0.0.1:${listener.localPort}"), FixedToken("t"), waiting(stall * 2), 1.seconds)
                val started = TimeSource.Monotonic.markNow()
                val unlock = client.unlock("s1", UnlockRequest("e1", Instant.now()))
                val waited = started.elapsedNow()
                assertEquals(SendResult.NetworkError, unlock.result)
                assertEquals(NoAnswer.Unreachable, unlock.noAnswer)
                // And the record kept.
                assertEquals(UnlockDisposition.Retry, unlockDisposition(unlock.result, unlock.answer))
                assertTrue(waited > 0.5.seconds && waited < stall, "waited $waited")
            }
        }

    @Test
    fun aRedirectComesBackAsItsStatusFollowedNowhereTheTokenNeverReachesTheAddressItNames(): Unit =
        runBlocking {
            for (status in listOf(301, 302, 303, 307, 308)) {
                // Where the redirect points: it answers anything that reaches it, and counts it.
                MockWebServer().use { elsewhere ->
                    elsewhere.start()
                    MockWebServer().use { server ->
                        server.enqueue(MockResponse(status, headersOf("Location", elsewhere.url("/v1/taps").toString())))
                        server.start()
                        val tap = client(server).tap(TapRequest("TAG-1", "e1", Instant.now()))
                        assertEquals(SendResult.Status(status), tap.result)
                        assertNull(tap.noAnswer, "$status")
                        // Not a 2xx, so no outcome: the tap is kept and sent again, never deleted.
                        assertNull(tap.answer, "$status")
                        assertEquals(TapDisposition.Retry, tapDisposition(tap.result, tap.answer), "$status")
                        val sent = server.takeRequest()
                        assertEquals("POST /v1/taps HTTP/1.1", sent.requestLine)
                        assertEquals("Bearer token-real", sent.headers["Authorization"])
                        // Followed, a 307 or 308 would carry the tap's body to whichever host it
                        // names (OkHttp would drop the token there), and a 301 or 302 make it a GET.
                        assertEquals(0, elsewhere.requestCount, "$status")
                    }
                }
            }
        }

    @Test
    fun aWritesBodyGoesOnceA408OrA503SayingRetryAfter0ComesBackAsItself(): Unit =
        runBlocking {
            // OkHttp sends a body again after either, unless it is one-shot (`Once`).
            for (answer in listOf(MockResponse(408), MockResponse(503, headersOf("Retry-After", "0")))) {
                MockWebServer().use { server ->
                    server.enqueue(answer)
                    server.enqueue(MockResponse(body = Contract.load("taps/joined.json").body.toString()))
                    server.start()
                    val tap = client(server).tap(TapRequest("TAG-1", "e1", Instant.now()))
                    assertEquals(SendResult.Status(answer.code), tap.result)
                    assertEquals(1, server.requestCount, "${answer.code}")
                }
            }
        }

    @Test
    fun aReadOnAConnectionTheServerClosedGoesAgainOnAFreshOneAsURLSessionsDoesAWriteNever(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                // Each answer closes its connection after it, as a server's idle timeout does: the
                // client finds out only when it uses the connection again.
                val me = Contract.load("me/in-session.json").body.toString()
                repeat(3) { server.enqueue(MockResponse.Builder().body(me).onResponseEnd(SocketEffect.CloseSocket()).build()) }
                server.start()
                val client = client(server)
                assertEquals(SendResult.Status(200), client.me().result)
                assertEquals(SendResult.Status(200), client.me().result)
                assertEquals(2, server.requestCount)
                // The write meets the connection the last answer closed and is never sent again:
                // no answer, which the outbox sends again under its event id.
                val tap = client.tap(TapRequest("TAG-1", "e1", Instant.now()))
                assertEquals(NoAnswer.Unreachable, tap.noAnswer)
                assertEquals(2, server.requestCount)
            }
        }

    @Test
    fun aCancelledCallerCancelsItsOkHttpCallNeverLeftToRunToItsBound(): Unit =
        runBlocking {
            // Never accepted: the call waits for an answer that never comes.
            ServerSocket(0, 8, InetAddress.getLoopbackAddress()).use { listener ->
                val (sent, cancelled) = CompletableDeferred<Unit>() to CompletableDeferred<Unit>()
                val events =
                    object : EventListener() {
                        override fun requestHeadersEnd(call: Call, request: Request) {
                            sent.complete(Unit)
                        }

                        override fun canceled(call: Call) {
                            cancelled.complete(Unit)
                        }
                    }
                val transport = OkHttpTransport(waitingClient(stall).eventListener(events).build())
                val client = ApiClient(URI("http://127.0.0.1:${listener.localPort}"), FixedToken("t"), transport, stall)
                val caller = launch(Dispatchers.IO) { client.me() }
                withTimeout(stall) { sent.await() }
                caller.cancelAndJoin()
                withTimeout(10.seconds) { cancelled.await() }
            }
        }

    @Test
    fun anAnswerCutOffInItsBodyIsNoAnswer(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                val me = Contract.load("me/in-session.json").body.toString()
                server.enqueue(MockResponse.Builder().body(me).onResponseBody(SocketEffect.CloseSocket()).build())
                server.start()
                val read = client(server).me()
                assertEquals(SendResult.NetworkError, read.result)
                assertEquals(NoAnswer.Unreachable, read.noAnswer)
            }
        }

    @Test
    fun aPathOkHttpWouldChangeIsNeverSentACodeOfDotsIsNoAnswerNeverThePathAbove(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse(404))
                server.start()
                val client = client(server)
                for (code in listOf("..", ".")) {
                    val preview = client.previewJoinCode(code)
                    assertEquals(SendResult.NetworkError, preview.result, code)
                    assertEquals(NoAnswer.Unreachable, preview.noAnswer, code)
                }
                assertEquals(0, server.requestCount)
                // A dot among other characters is no path segment of dots: it goes, escaped.
                assertEquals(SendResult.Status(404), client.previewJoinCode("a.b").result)
                assertEquals("GET /v1/join-codes/a%2Eb HTTP/1.1", server.takeRequest().requestLine)
            }
        }

    @Test
    fun aCallThroughTheAppsTransportGoesAtOnceWhileMoreCallsThanOkHttpsFiveAHostWaitAtTheServerThroughATransportApartFromIt(): Unit =
        runBlocking {
            // AN13d's queue (santa's reviewer B on #574): OkHttp lets 5 requests a host go at once and queues the rest, so the
            // live lesson's poll and answers, held on a slow network, could hold an Emergency Unlock's send behind them.
            val release = CountDownLatch(1)
            val held = AtomicInteger()
            MockWebServer().use { server ->
                server.dispatcher =
                    object : Dispatcher() {
                        override fun dispatch(request: RecordedRequest): MockResponse {
                            if (request.url.encodedPath == "/held") {
                                held.incrementAndGet()
                                release.await(stall.inWholeMilliseconds * 3, MILLISECONDS)
                            }
                            return MockResponse(200)
                        }
                    }
                server.start()
                try {
                    // The app's own transport, each of its waits past the test's, and the lesson's apart from it.
                    val app = waiting(stall * 3)
                    val lesson = app.apart()
                    fun get(path: String) = HttpRequest("GET", server.url(path).toUri(), emptyMap(), null, stall * 3)
                    val calls = List(6) { async(Dispatchers.IO) { lesson.send(get("/held")) } }
                    // Five at the server, OkHttp's limit, the sixth in the lesson's own queue.
                    withTimeout(stall) { while (held.get() < 5) delay(1) }
                    val answered = withTimeout(stall) { app.send(get("/app")) }
                    assertEquals(200, answered.status)
                    assertEquals(5, held.get(), "the lesson's calls let go before the app's went")
                    release.countDown()
                    assertEquals(List(6) { 200 }, calls.awaitAll().map { it.status })
                } finally {
                    release.countDown()
                }
            }
        }

    @Test
    fun aTransportApartIsTheAppsOwnItsRedirectsComingBackAsThemselvesItsCallsOnTheConnectionsTheAppsLeft(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse(200))
                server.enqueue(MockResponse(302, headersOf("Location", "/elsewhere")))
                server.start()
                val app = waiting(stall)
                fun get(path: String) = HttpRequest("GET", server.url(path).toUri(), emptyMap(), null, stall)
                assertEquals(200, app.send(get("/first")).status)
                assertEquals(302, app.apart().send(get("/moved")).status)
                val (first, moved) = server.takeRequest() to server.takeRequest()
                assertEquals("GET /moved HTTP/1.1", moved.requestLine)
                // The connection the app's call left, its second exchange: one pool for both. And followed nowhere.
                assertEquals(listOf(first.connectionIndex, 1), listOf(moved.connectionIndex, moved.exchangeIndex))
                assertEquals(2, server.requestCount)
            }
        }

    @Test
    fun theAppsClientKeepsNothingFollowsNoRedirectAndBoundsEachWait() {
        val client = OkHttpTransport.makeClient()
        assertNull(client.cache)
        assertEquals(CookieJar.NO_COOKIES, client.cookieJar)
        assertFalse(client.followRedirects)
        assertFalse(client.followSslRedirects)
        // On for a read; a body is never sent again of OkHttp's own accord (`Once`).
        assertTrue(client.retryOnConnectionFailure)
        val wait = ApiClient.REQUEST_TIMEOUT.inWholeMilliseconds.toInt()
        assertEquals(listOf(wait, wait, wait), listOf(client.connectTimeoutMillis, client.readTimeoutMillis, client.writeTimeoutMillis))
        assertEquals(OkHttpTransport.EXCHANGE_TIMEOUT.inWholeMilliseconds.toInt(), client.callTimeoutMillis)
        // Nothing between the client and the wire, so nothing there logs a token or a body.
        assertTrue(client.interceptors.isEmpty() && client.networkInterceptors.isEmpty())
    }
}
