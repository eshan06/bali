package com.bali.core

import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLDecoder
import java.net.UnknownHostException
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement

/** A transport that answers each request from [reply], with no network, and keeps what it sent. */
class TransportDouble(private val reply: suspend (HttpRequest) -> HttpAnswer) : HttpTransport {
    val sent = mutableListOf<HttpRequest>()

    override suspend fun send(request: HttpRequest): HttpAnswer {
        sent += request
        return reply(request)
    }

    companion object {
        /** Every request answered [status], with [body]. */
        fun answering(status: Int, body: String = "") =
            TransportDouble { HttpAnswer(status, emptyMap(), body.encodeToByteArray()) }

        /** No request answered at all: each throws [error], as OkHttp does. */
        fun throwing(error: IOException) = TransportDouble { throw error }
    }
}

/** A token provider that always gives [token], or none. */
class FixedToken(private val token: String?) : TokenProvider {
    override suspend fun accessToken() = token
}

/** A token provider that gives a new token each time it is asked, as one refreshed would. */
class RefreshingToken : TokenProvider {
    var asked = 0
        private set

    override suspend fun accessToken() = "token-${++asked}"
}

/** The endpoint's method: `POST` of `POST /v1/taps`. */
val Contract.Fixture.method: String get() = endpoint.substringBefore(' ')

/** The path's parameter, the `{id}` or `{code}` after its first two segments; empty when it has none. */
val Contract.Fixture.parameter: String
    get() {
        val raw = request.path.substringBefore('?').split('/').getOrElse(3) { "" }
        return URLDecoder.decode(raw.replace("+", "%2B"), Charsets.UTF_8)
    }

/** The value of [name] in the path's query, if it has one. */
fun Contract.Fixture.query(name: String): String? =
    request.path.substringAfter('?', "").split('&').firstOrNull { it.startsWith("$name=") }?.removePrefix("$name=")

/** The request's body, as the `core` type the phone sends. */
inline fun <reified T> Contract.Fixture.sent(): T = BaliJson.decodeFromJsonElement(checkNotNull(request.body))

/** [json] decoded as the app decodes an answer: a value it doesn't know is unknown, never a failure. */
fun <T> appDecode(type: KSerializer<T>, json: JsonElement): T = BaliJson.decodeFromString(type, json.toString())

/** What one send came back as, and its outbox table's disposition of it: none where no outbox sends it. */
private data class Sent(val response: ApiResponse<*>, val disposition: String? = null)

/** [port], an outbox table, reading this answer as the app's outbox does. */
private fun <A> ApiResponse<A>.read(port: (SendResult, A?) -> Vocabulary) = Sent(this, port(result, answer).wire)

/** A call of the client's, made from what a fixture's request holds, that no outbox sends. */
private fun call(block: suspend (ApiClient, Contract.Fixture) -> ApiResponse<*>): suspend (ApiClient, Contract.Fixture) -> Sent =
    { client, fixture -> Sent(block(client, fixture)) }

/** A call an outbox sends, its answer read by the outbox's table, [port]. */
private fun <A> outbox(
    port: (SendResult, A?) -> Vocabulary,
    block: suspend (ApiClient, Contract.Fixture) -> ApiResponse<A>,
): suspend (ApiClient, Contract.Fixture) -> Sent = { client, fixture -> block(client, fixture).read(port) }

/**
 * The API client against the phone's contract, APIClientTests.swift's APIClientFixtureTests: each
 * fixture's request sent as the API read it, once, and its answer returned as the app reads it,
 * which its outbox table reads as the TypeScript's did (the fixture's disposition).
 */
class ApiClientFixtureTest {
    private val base = "https://api.bali.test"
    private val token = "token-fx"

    private val calls =
        mapOf(
            "GET /v1/me" to call { client, _ -> client.me() },
            "PATCH /v1/me" to call { client, fixture -> client.updateMe(fixture.sent()) },
            "DELETE /v1/me" to call { client, fixture -> client.deleteMe(fixture.sent()) },
            "PUT /v1/me/push-token" to call { client, fixture -> client.registerPushToken(fixture.sent()) },
            "DELETE /v1/me/push-token" to call { client, fixture -> client.removePushToken(fixture.sent()) },
            "GET /v1/me/age-check" to call { client, _ -> client.ageCheck() },
            "PUT /v1/me/age-check" to call { client, fixture -> client.recordAgeCheck(fixture.sent()) },
            "POST /v1/taps" to outbox(::tapDisposition) { client, fixture -> client.tap(fixture.sent()) },
            "POST /v1/sessions/{id}/checkin" to call { client, fixture -> client.checkIn(fixture.parameter, fixture.sent()) },
            "POST /v1/sessions/{id}/unlock" to
                outbox(::unlockDisposition) { client, fixture -> client.unlock(fixture.parameter, fixture.sent()) },
            "POST /v1/taps/{eventId}/unlock" to
                outbox(::unlockDisposition) { client, fixture -> client.unlockUnderTap(fixture.parameter, fixture.sent()) },
            "PATCH /v1/unlocks/{eventId}" to call { client, fixture -> client.changeReason(fixture.parameter, fixture.sent()) },
            "POST /v1/sessions/{id}/refocus" to
                outbox(::stateChangeDisposition) { client, fixture -> client.refocus(fixture.parameter, fixture.sent()) },
            "POST /v1/sessions/{id}/protection-off" to
                outbox(::stateChangeDisposition) { client, fixture -> client.protectionOff(fixture.parameter, fixture.sent()) },
            "POST /v1/sessions/{id}/protection-on" to
                outbox(::stateChangeDisposition) { client, fixture -> client.protectionOn(fixture.parameter, fixture.sent()) },
            "POST /v1/enrollments" to call { client, fixture -> client.join(fixture.sent()) },
            "DELETE /v1/enrollments/{id}" to call { client, fixture -> client.leave(fixture.parameter, fixture.sent()) },
            "GET /v1/join-codes/{code}" to call { client, fixture -> client.previewJoinCode(fixture.parameter) },
            "GET /v1/me/history" to
                call { client, fixture -> client.history(fixture.query("before"), fixture.query("limit")?.toInt()) },
            "GET /v1/sessions/{id}/presentation" to call { client, fixture -> client.presentation(fixture.parameter) },
            "POST /v1/questions/{id}/answers" to call { client, fixture -> client.answer(fixture.parameter, fixture.sent()) },
            "GET /v1/decks/{id}/download" to call { client, fixture -> client.download(fixture.parameter) },
        )

    @Test
    fun eachFixtureTheClientSendsItsRequestOnceAndReturnsItsAnswerAsTheFixturesDisposition(): Unit =
        runBlocking {
            val wrong = Contract.fixturePaths().flatMap { path -> problems(path).map { "$path: $it" } }
            assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
        }

    @Test
    fun everyEndpointTheFixturesHoldHasItsCallAndEveryCallMeetsAFixture() {
        assertEquals(calls.keys, Contract.fixturePaths().map { Contract.load(it).endpoint }.toSet())
    }

    /** What the client gets wrong of one fixture: nothing, if it sends its request and returns its answer. */
    private suspend fun problems(path: String): List<String> {
        val fixture = Contract.load(path)
        val call = calls[fixture.endpoint] ?: return listOf("no call for ${fixture.endpoint}")
        val transport = TransportDouble.answering(fixture.status, fixture.body.toString())
        val (response, disposition) = call(ApiClient(URI(base), FixedToken(token), transport), fixture)
        val problems = mutableListOf<String>()

        fun expect(what: String, actual: Any?, wanted: Any?) {
            if (actual != wanted) problems += "$what is $actual, not $wanted"
        }

        // Fed the fixture's answer, the client returns what the outbox table reads as the TypeScript did.
        expect("the disposition", disposition, fixture.disposition)

        // Fed the fixture's answer, the client returns it as the app reads it: its status, and its
        // body as the endpoint's answer on a 2xx, as the one error shape on any other.
        expect("the result", response.result, SendResult.Status(fixture.status))
        expect("no answer", response.noAnswer, null)
        if (fixture.status in 200..299) {
            val type = Contract.responseTypes[fixture.type] ?: return listOf("core has no type for ${fixture.type}")
            expect("the answer", response.answer, appDecode(type, fixture.body))
            expect("the error", response.error, null)
        } else {
            expect("the answer", response.answer, null)
            expect("the error", response.error, appDecode(ApiErrorBody.serializer(), fixture.body))
        }
        // Sent once, as the fixture was: its method, path and body, the token, and a body's type.
        val sent = transport.sent.singleOrNull() ?: return problems + "sent ${transport.sent.size} requests"
        expect("the method", sent.method, fixture.method)
        expect("the URL", sent.url.toString(), base + fixture.request.path)
        expect("the token", sent.headers["Authorization"], "Bearer $token")
        expect("the wait", sent.timeout, ApiClient.REQUEST_TIMEOUT)
        // A DELETE with a JSON content type and no body is a 400 from Fastify.
        expect("the content type", sent.headers["Content-Type"], fixture.request.body?.let { "application/json" })
        expect("the body", sent.body?.let { BaliJson.parseToJsonElement(it.decodeToString()) }, fixture.request.body)
        return problems
    }
}

private val at: Instant = Instant.ofEpochSecond(946_684_860)

/** One record an outbox sends, sent through a client and read by its table. */
private class OutboxCall(val name: String, val send: suspend (ApiClient) -> Sent)

private val records =
    listOf(
        OutboxCall("tap") { it.tap(TapRequest("TAG-1", "e1", at)).read(::tapDisposition) },
        OutboxCall("unlock") { it.unlock("s1", UnlockRequest("e1", at, UnlockReason.Nurse)).read(::unlockDisposition) },
        OutboxCall("unlock under a tap") {
            it.unlockUnderTap("t1", UnlockRequest("e1", at, UnlockReason.Nurse)).read(::unlockDisposition)
        },
        OutboxCall("refocus") { it.refocus("s1", RefocusRequest("e1", at)).read(::stateChangeDisposition) },
        OutboxCall("protection off") { it.protectionOff("s1", ProtectionOffRequest("e1", at)).read(::stateChangeDisposition) },
        OutboxCall("protection on") { it.protectionOn("s1", ProtectionOnRequest("e1", at)).read(::stateChangeDisposition) },
    )

/**
 * The API client: no answer, an answer it can't read, a 401, no token, and what each outbox table
 * makes of them. APIClientTests.swift's APIClientTests.
 */
class ApiClientTest {
    private val base = URI("https://api.bali.test")

    @Test
    fun noAnswerOfflineATimeoutADroppedConnectionACancelledCallIsNoAnswerSentOnceAndEveryTableKeepsTheRecord(): Unit =
        runBlocking {
            val errors =
                listOf(
                    UnknownHostException("api.bali.test"), SocketTimeoutException("timeout"),
                    SocketException("Connection reset"), ConnectException("Failed to connect"), IOException("Canceled"),
                )
            for (error in errors) {
                for (record in records) {
                    val transport = TransportDouble.throwing(error)
                    val (response, disposition) = record.send(ApiClient(base, FixedToken("t"), transport))
                    val case = "${record.name}, $error"
                    assertEquals(SendResult.NetworkError, response.result, case)
                    assertEquals(NoAnswer.Unreachable, response.noAnswer, case)
                    assertNull(response.answer, case)
                    assertNull(response.error, case)
                    assertEquals("retry", disposition, case)
                    assertEquals(1, transport.sent.size, case)
                }
            }
        }

    @Test
    fun anAnswerThatDoesNotDecodeIsNoneAndItsStatusStillStandsA2xxKeepsTheRecord(): Unit =
        runBlocking {
            val answers =
                listOf(
                    Triple(200, "<html>Service Unavailable</html>", "retry"),
                    Triple(200, """{"outcome":42}""", "retry"),
                    Triple(201, "", "retry"),
                    Triple(401, "<html>Unauthorized</html>", "reauth"),
                    Triple(502, "<html>Bad Gateway</html>", "retry"),
                )
            for ((status, body, kept) in answers) {
                for (record in records) {
                    val (response, disposition) =
                        record.send(ApiClient(base, FixedToken("t"), TransportDouble.answering(status, body)))
                    val case = "${record.name}, $status $body"
                    assertEquals(SendResult.Status(status), response.result, case)
                    assertNull(response.noAnswer, case)
                    assertNull(response.answer, case)
                    assertNull(response.error, case)
                    assertEquals(kept, disposition, case)
                }
            }
        }

    @Test
    fun anAnswerThatIsNotUtf8IsNoneAsSwiftsDecoderReadsIt(): Unit =
        runBlocking {
            // A tap's whole answer, but for one byte UTF-8 has no place for, in its state.
            val body = """{"outcome":"joined","session":null,"state":"x"}""".encodeToByteArray()
            body[body.size - 3] = 0xFF.toByte()
            val tap = ApiClient(base, FixedToken("t"), TransportDouble { HttpAnswer(200, emptyMap(), body) }).tap(TapRequest("TAG-1", "e1", at))
            assertEquals(SendResult.Status(200), tap.result)
            assertNull(tap.answer)
        }

    @Test
    fun aBodyIsReadOnlyAsItsStatussA2xxsAsTheAnswerAnyOthersAsTheErrorShape(): Unit =
        runBlocking {
            val answers =
                listOf(409 to """{"outcome":"joined","session":null,"state":null}""", 200 to """{"error":{"code":"conflict","message":"No."}}""")
            for ((status, body) in answers) {
                val tap = ApiClient(base, FixedToken("t"), TransportDouble.answering(status, body)).tap(TapRequest("TAG-1", "e1", at))
                assertEquals(SendResult.Status(status), tap.result)
                assertNull(tap.answer, "$status")
                assertNull(tap.error, "$status")
            }
        }

    @Test
    fun a401ComesBackAsAValueSentOnceTheCallersReauthPathRunsNotTheClients(): Unit =
        runBlocking {
            for (record in records) {
                val transport = TransportDouble.answering(401, """{"error":{"code":"unauthorized","message":"token expired"}}""")
                val tokens = RefreshingToken()
                val (response, disposition) = record.send(ApiClient(base, tokens, transport))
                assertEquals(SendResult.Status(401), response.result, record.name)
                assertEquals(ApiErrorCode.Unauthorized, response.error?.error?.code?.known, record.name)
                assertEquals("reauth", disposition, record.name)
                // No refresh and no resend of its own: one token asked for, one request sent.
                assertEquals(1, tokens.asked, record.name)
                assertEquals(1, transport.sent.size, record.name)
            }
        }

    @Test
    fun noTokenToGiveNothingIsSentAndItReadsAsNoAnswerNeverASignOutNeverADrop(): Unit =
        runBlocking {
            for (token in listOf(null, "")) {
                for (record in records) {
                    val transport = TransportDouble.answering(401)
                    val (response, disposition) = record.send(ApiClient(base, FixedToken(token), transport))
                    val case = "${record.name}, token $token"
                    assertEquals(SendResult.NetworkError, response.result, case)
                    assertEquals(NoAnswer.NoToken, response.noAnswer, case)
                    assertEquals("retry", disposition, case)
                    assertTrue(transport.sent.isEmpty(), case)
                }
            }
        }

    @Test
    fun aReadWithNoTokenIsNoAnswerTooSendingNothing(): Unit =
        runBlocking {
            val transport = TransportDouble.answering(200)
            val me = ApiClient(base, FixedToken(null), transport).me()
            assertEquals(SendResult.NetworkError, me.result)
            assertEquals(NoAnswer.NoToken, me.noAnswer)
            assertTrue(transport.sent.isEmpty())
        }

    @Test
    fun anAccountDeletionsClientSendsEveryRequestUnderTheDeletionsOwnTokenOfThatAccountAloneThePlainClientUnderTheAccessToken(): Unit =
        runBlocking {
            // A provider giving only the deletion's token sends nothing but through forDeletion, a
            // queued record and DELETE /v1/me alike (C7's fallback), for the account it names alone (AN9h).
            val deletionOnly =
                object : TokenProvider {
                    override suspend fun accessToken(): String? = null

                    override suspend fun deletionToken(account: String?) = "deletion".takeIf { account == "a1" }
                }
            val transport = TransportDouble.answering(200, """{"outcome":"already_deleted"}""")
            val client = ApiClient(base, deletionOnly, transport)
            val tap = TapRequest("TAG-1", "e1", at)
            assertEquals(NoAnswer.NoToken, client.me().noAnswer)
            assertEquals(NoAnswer.NoToken, client.tap(tap).noAnswer)
            assertEquals(NoAnswer.NoToken, client.deleteMe(DeleteMeRequest("e2")).noAnswer)
            assertEquals(NoAnswer.NoToken, client.forDeletion("b1").deleteMe(DeleteMeRequest("e2")).noAnswer)
            assertEquals(NoAnswer.NoToken, client.forAccount("a1").tap(tap).noAnswer)
            assertTrue(transport.sent.isEmpty())
            client.forDeletion("a1").tap(tap)
            val deleted = client.forDeletion("a1").deleteMe(DeleteMeRequest("e2"))
            assertEquals(DeleteMeResponse.Outcome.AlreadyDeleted, deleted.answer?.outcome?.known)
            assertEquals(listOf("POST", "DELETE"), transport.sent.map { it.method })
            assertEquals(listOf("Bearer deletion", "Bearer deletion"), transport.sent.map { it.headers["Authorization"] })
            // A provider of one token gives it for its own account alone, its `sub`, to a deletion and to the
            // account's own calls: never for another, nor for none, and a token that names no account for none.
            val plain = TransportDouble.answering(200, """{"outcome":"deleted"}""")
            val one = ApiClient(base, FixedToken(jwt("a1")), plain)
            one.forDeletion("a1").deleteMe(DeleteMeRequest("e3"))
            one.forAccount("a1").me()
            assertEquals(listOf("Bearer ${jwt("a1")}", "Bearer ${jwt("a1")}"), plain.sent.map { it.headers["Authorization"] })
            for (account in listOf("b1", null)) {
                assertEquals(NoAnswer.NoToken, one.forDeletion(account).deleteMe(DeleteMeRequest("e4")).noAnswer, "$account")
                assertEquals(NoAnswer.NoToken, one.forAccount(account).me().noAnswer, "$account")
            }
            assertEquals(NoAnswer.NoToken, ApiClient(base, FixedToken("t"), plain).forDeletion("a1").deleteMe(DeleteMeRequest("e5")).noAnswer)
            assertEquals(2, plain.sent.size)
        }

    @Test
    fun a409AccountDeletedIsToldToTheProviderThatGaveItsTokenWithTheAccountItNamesBeforeTheCallReturnsNoOtherAnswerIs(): Unit =
        runBlocking {
            // AN9j (the owner, 2026-11-12): read where every call's answer comes, so each client over one provider reads it alike,
            // a client held to one account or a deletion's included; the answer is still the caller's, as before.
            val told = mutableListOf<String?>()
            var token: String? = jwt("a1")
            val tokens =
                object : TokenProvider {
                    override suspend fun accessToken() = token

                    override suspend fun deletedOnServer(account: String?) {
                        told += account
                    }
                }
            val deleted = """{"error":{"code":"conflict","reason":"account_deleted","message":"this account was deleted"}}"""
            var reply = 409 to deleted
            val client = ApiClient(base, tokens, TransportDouble { HttpAnswer(reply.first, emptyMap(), reply.second.encodeToByteArray()) })
            val me = client.me()
            assertEquals(listOf<String?>("a1"), told)
            assertEquals(SendResult.Status(409), me.result)
            assertEquals(ApiErrorReason.AccountDeleted, me.error?.error?.reason)
            client.forAccount("a1").recordAgeCheck(RecordAgeCheckRequest("y1"))
            client.forDeletion("a1").deleteMe(DeleteMeRequest("e1"))
            assertEquals(listOf<String?>("a1", "a1", "a1"), told)
            // A token naming no account: told so, for none.
            token = token("""{"iat":1000000000,"exp":1000003600}""")
            client.tap(TapRequest("TAG-1", "e2", at))
            assertEquals(listOf("a1", "a1", "a1", null), told)
            // Every other answer is the caller's alone: another 409's reason, a 409 naming none, the reason under another status.
            token = jwt("a1")
            val others =
                listOf(
                    409 to """{"error":{"code":"conflict","reason":"event_id_conflict","message":"no"}}""",
                    409 to """{"error":{"code":"conflict","message":"no"}}""",
                    409 to """{"error":{"code":"conflict","reason":"account_deleted_since","message":"no"}}""",
                    403 to deleted,
                    200 to """{"passed":false}""",
                )
            for (other in others) {
                reply = other
                client.me()
                client.forDeletion("a1").ageCheck()
            }
            assertEquals(4, told.size)
        }

    @Test
    fun eachRequestAsksForTheTokenAfreshSoARefreshedOneGoesOnTheNext(): Unit =
        runBlocking {
            val transport = TransportDouble.answering(200)
            val client = ApiClient(base, RefreshingToken(), transport)
            client.me()
            client.history()
            assertEquals(listOf("Bearer token-1", "Bearer token-2"), transport.sent.map { it.headers["Authorization"] })
        }

    @Test
    fun nothingTypedChangesTheUrlsShapeEachPathParameterAndQueryValueIsEscaped(): Unit =
        runBlocking {
            val transport = TransportDouble.answering(200)
            val client = ApiClient(base, FixedToken("t"), transport)
            client.previewJoinCode(" 6bv/za5?x=1#é")
            client.leave("../me", EndEnrollmentRequest("e"))
            client.checkIn("s 1", CheckInRequest(at))
            client.history(before = "e1&limit=50", limit = 5)
            assertEquals(
                listOf(
                    "/v1/join-codes/%206bv%2Fza5%3Fx%3D1%23%C3%A9",
                    "/v1/enrollments/%2E%2E%2Fme",
                    "/v1/sessions/s%201/checkin",
                    "/v1/me/history?limit=5&before=e1%26limit%3D50",
                ),
                transport.sent.map { it.url.toString().removePrefix(base.toString()) },
            )
        }

    @Test
    fun theBaseUrlMayCarryAPathWithOrWithoutItsTrailingSlash(): Unit =
        runBlocking {
            for (path in listOf("https://api.bali.test/api", "https://api.bali.test/api/")) {
                val transport = TransportDouble.answering(200)
                ApiClient(URI(path), FixedToken("t"), transport).me()
                assertEquals(listOf("https://api.bali.test/api/v1/me"), transport.sent.map { it.url.toString() }, path)
            }
        }

    @Test
    fun aCallerCancelledIsCancelledNeverAnsweredAsNoAnswer(): Unit =
        runBlocking {
            // Where Swift's cancelled call is no answer, a cancelled coroutine stays cancelled, as
            // Kotlin's coroutines are: no table reads an answer, so the record is kept all the same.
            val transport = TransportDouble { awaitCancellation() }
            var answered: ApiResponse<MeResponse>? = null
            val caller = launch { answered = ApiClient(base, FixedToken("t"), transport).me() }
            while (transport.sent.isEmpty()) yield()
            caller.cancelAndJoin()
            assertTrue(caller.isCancelled)
            assertNull(answered)
        }
}
