package com.bali.core

import java.net.InetAddress
import java.net.ServerSocket
import java.net.URI
import java.time.Instant
import java.util.concurrent.TimeUnit.MILLISECONDS
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CookieJar
import okhttp3.Headers.Companion.headersOf

/** The OkHttp transport, over a real socket: APIClientTests.swift's URLSessionTransportTests. */
class OkHttpTransportTest {
    /** How long a test waits on its local server: answered, a request takes milliseconds. */
    private val stall = 1.minutes

    /** The app's own client, every wait of it [wait]. */
    private fun waiting(wait: Duration) =
        OkHttpTransport(
            OkHttpTransport.makeClient().newBuilder()
                .connectTimeout(wait.inWholeMilliseconds, MILLISECONDS)
                .readTimeout(wait.inWholeMilliseconds, MILLISECONDS)
                .writeTimeout(wait.inWholeMilliseconds, MILLISECONDS)
                .callTimeout(wait.inWholeMilliseconds, MILLISECONDS)
                .build(),
        )

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
                        val sent = server.takeRequest()
                        assertEquals("POST /v1/taps HTTP/1.1", sent.requestLine)
                        assertEquals("Bearer token-real", sent.headers["Authorization"])
                        // Followed, a 301 or 302 would resend the POST as a GET with no body, and
                        // every header, the bearer token included, to whichever host it names.
                        assertEquals(0, elsewhere.requestCount, "$status")
                    }
                }
            }
        }

    @Test
    fun a408ComesBackAsItselfSentOnceNeverResentByOkHttp(): Unit =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse(408))
                server.enqueue(MockResponse(body = Contract.load("me/in-session.json").body.toString()))
                server.start()
                assertEquals(SendResult.Status(408), client(server).me().result)
                assertEquals(1, server.requestCount)
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
    fun theAppsClientKeepsNothingFollowsNoRedirectResendsNoFailureAndBoundsEachWait() {
        val client = OkHttpTransport.makeClient()
        assertNull(client.cache)
        assertEquals(CookieJar.NO_COOKIES, client.cookieJar)
        assertFalse(client.followRedirects)
        assertFalse(client.followSslRedirects)
        assertFalse(client.retryOnConnectionFailure)
        val wait = ApiClient.REQUEST_TIMEOUT.inWholeMilliseconds.toInt()
        assertEquals(listOf(wait, wait, wait), listOf(client.connectTimeoutMillis, client.readTimeoutMillis, client.writeTimeoutMillis))
        assertEquals(OkHttpTransport.EXCHANGE_TIMEOUT.inWholeMilliseconds.toInt(), client.callTimeoutMillis)
        // Nothing between the client and the wire, so nothing there logs a token or a body.
        assertTrue(client.interceptors.isEmpty() && client.networkInterceptors.isEmpty())
    }
}
