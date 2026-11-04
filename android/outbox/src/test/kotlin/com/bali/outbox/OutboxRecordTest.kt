package com.bali.outbox

import com.bali.core.ActionOrder
import com.bali.core.ApiClient
import com.bali.core.BaliJson
import com.bali.core.EventId
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.NoAnswer
import com.bali.core.ProtectionOffRequest
import com.bali.core.ProtectionOnRequest
import com.bali.core.RefocusRequest
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.StateChangeDisposition
import com.bali.core.TapDisposition
import com.bali.core.TapRequest
import com.bali.core.TokenProvider
import com.bali.core.UnlockDisposition
import com.bali.core.UnlockReason
import com.bali.core.UnlockRequest
import java.io.IOException
import java.net.URI
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** A fixed instant on a whole second, BaliOutbox's tests' `t0`: on the wire, `2026-09-21T14:13:20.000Z`. */
val t0: Instant = Instant.ofEpochSecond(1_790_000_000)

/**
 * A record of [change] as the store queues one (AN4c): an id minted [at] the moment the phone acted,
 * due at once, never sent, [order] its place in what the phone did.
 */
fun queued(change: Change, at: Instant = t0, order: ActionOrder? = null) =
    OutboxRecord(
        eventId = EventId.mint(at), change = change, recordedAt = at, attempts = 0, answers = 0,
        nextAttemptAt = at, stuck = false, lastStatus = null, lastReason = null, lastMessage = null,
        refusedStatus = null, follows = null, order = order,
    )

/**
 * Answers every request with [status] and [body], or with no answer at all when [status] is none,
 * as OkHttp throws one: BaliOutbox's `Canned`, keeping each request it was sent.
 */
class Canned(private val status: Int?, private val body: String = "") : HttpTransport {
    val sent = mutableListOf<HttpRequest>()

    override suspend fun send(request: HttpRequest): HttpAnswer {
        sent += request
        return HttpAnswer(status ?: throw IOException("no answer"), emptyMap(), body.encodeToByteArray())
    }
}

/** Gives a token whenever it is asked, counting each ask: BaliOutbox's `Signed`. */
class Signed : TokenProvider {
    var asked = 0
        private set

    override suspend fun accessToken(): String {
        asked += 1
        return "token"
    }
}

/** The real client, over [transport]: every send goes through it, as the sync engine's will. */
fun client(transport: HttpTransport, tokens: TokenProvider = Signed()) =
    ApiClient(URI("https://api.bali.test"), tokens, transport)

/** A disposition as the TypeScript writes it. */
val Disposition.wire: String
    get() =
        when (this) {
            is Disposition.Tap -> disposition.wire
            is Disposition.Unlock -> disposition.wire
            is Disposition.StateChange -> disposition.wire
        }

/** A change of every kind a record sends, and where it goes. */
private val sendable =
    listOf(
        Change.Tap("04:A2:1B") to "POST /v1/taps",
        Change.Unlock("s", UnlockReason.Bathroom) to "POST /v1/sessions/s/unlock",
        Change.UnlockUnderTap("t", UnlockReason.Nurse) to "POST /v1/taps/t/unlock",
        Change.Refocus("s") to "POST /v1/sessions/s/refocus",
        Change.ProtectionOff("s") to "POST /v1/sessions/s/protection-off",
        Change.ProtectionOn("s") to "POST /v1/sessions/s/protection-on",
    )

/** What the phone did and the request it sends: OutboxTests' RecordTests and ActionOrderTests, their parts no store holds. */
class OutboxRecordTest {
    @Test
    fun eachChangeIsSentAsItsRequestUnderItsEventIdTheTimeThePhoneActedAndItsPlaceInWhatItDid() {
        val at = t0.plusSeconds(7)
        val nth = { seq: Long -> ActionOrder("install", seq) }
        val changes =
            listOf(
                Change.Tap("04:A2:1B"), Change.UnlockUnderTap("t", UnlockReason.Nurse),
                Change.Unlock("s", UnlockReason.Bathroom), Change.Unlock("s", null), Change.Refocus("s"),
                Change.ProtectionOff("s"), Change.ProtectionOn("s"),
            )
        val records = changes.mapIndexed { index, change -> queued(change, at, nth(index + 1L)) }
        val id = records.map { it.eventId }
        assertEquals(
            listOf(
                OutboxRecord.Request.Tap(TapRequest("04:A2:1B", id[0], at, nth(1))),
                // Filed under its tap (decision 11), with its own order like every record.
                OutboxRecord.Request.UnlockUnderTap("t", UnlockRequest(id[1], at, UnlockReason.Nurse, nth(2))),
                OutboxRecord.Request.Unlock("s", UnlockRequest(id[2], at, UnlockReason.Bathroom, nth(3))),
                OutboxRecord.Request.Unlock("s", UnlockRequest(id[3], at, order = nth(4))),
                OutboxRecord.Request.Refocus("s", RefocusRequest(id[4], at, nth(5))),
                OutboxRecord.Request.ProtectionOff("s", ProtectionOffRequest(id[5], at, nth(6))),
                OutboxRecord.Request.ProtectionOn("s", ProtectionOnRequest(id[6], at, nth(7))),
            ),
            records.map { it.request },
        )
        assertEquals(changes, records.map { it.change })
        // A file with no install sends its records with no order, ordered by their time, rather than not at all.
        val unordered = queued(Change.Refocus("s"), at)
        assertEquals(OutboxRecord.Request.Refocus("s", RefocusRequest(unordered.eventId, at)), unordered.request)
    }

    @Test
    fun anUnlockNotFiledYetHasNoRequestItsSendSendsNothingAndAsksForNoToken(): Unit =
        runBlocking {
            // B6b: kept, and never sent until the phone knows where it stands.
            val unlock = queued(Change.UnlockUnfiled(UnlockReason.Nurse))
            assertNull(unlock.request)
            val transport = Canned(200, """{"outcome":"applied","recordedAs":null,"state":"unlocked","session":null}""")
            val tokens = Signed()
            assertNull(unlock.send(client(transport, tokens)))
            assertTrue(transport.sent.isEmpty())
            assertEquals(0, tokens.asked)
        }

    @Test
    fun eachRecordGoesToItsOwnEndpointWithItsOwnBodyAnUnlockUnderATapUnderThatTap(): Unit =
        runBlocking {
            for ((change, endpoint) in sendable) {
                val record = queued(change, order = ActionOrder("install", 1))
                val transport = Canned(503)
                assertNotNull(record.send(client(transport)), "$change")
                val sent = transport.sent.single()
                assertEquals(endpoint, "${sent.method} ${sent.url.rawPath}", "$change")
                // The time the phone acted, never the time it sent: the server clamps it (rule 1).
                val expected =
                    buildJsonObject {
                        if (change is Change.Tap) put("tagId", change.tagId)
                        put("eventId", record.eventId)
                        put("deviceTime", "2026-09-21T14:13:20.000Z")
                        change.reason?.let { put("reason", it.wire) }
                        putJsonObject("order") {
                            put("install", "install")
                            put("seq", 1)
                        }
                    }
                assertEquals(expected, BaliJson.parseToJsonElement(checkNotNull(sent.body).decodeToString()), "$change")
            }
        }

    @Test
    fun everyAttemptSendsTheSameRequestUnderTheSameEventIdTimeAndOrderHoweverTheRecordStands(): Unit =
        runBlocking {
            // Unanswered and sent again, then kept and stuck: the same request each time (rule 4, A12).
            for ((change, _) in sendable) {
                val record = queued(change, order = ActionOrder("install", 2))
                val kept =
                    record.copy(
                        attempts = 8, answers = 8, nextAttemptAt = t0.plusSeconds(60), stuck = true, lastStatus = 503,
                        refusedStatus = 409,
                    )
                val transport = Canned(503)
                for (attempt in listOf(record, record, kept)) attempt.send(client(transport))
                val first = transport.sent.first()
                for (again in transport.sent.drop(1)) {
                    assertEquals(first.url, again.url, "$change")
                    assertContentEquals(first.body, again.body, "$change")
                }
                assertEquals(3, transport.sent.size, "$change")
            }
        }

    @Test
    fun anUnlockIsAnyOfTheThreeAReturnIsATapOrARefocusNeverTheLockBackOnAndOnlyAnUnlockHasAReason() {
        val changes =
            listOf(
                Change.Tap("tag"), Change.Unlock("s", UnlockReason.Nurse), Change.UnlockUnderTap("t", UnlockReason.Bathroom),
                Change.UnlockUnfiled(UnlockReason.Other), Change.Refocus("s"), Change.ProtectionOff("s"),
                Change.ProtectionOn("s"),
            )
        assertEquals(listOf(false, true, true, true, false, false, false), changes.map { it.isUnlock })
        assertEquals(listOf(false, false, false, true, false, false, false), changes.map { it.isUnfiled })
        assertEquals(listOf(true, false, false, false, true, false, false), changes.map { it.isReturn })
        assertEquals(
            listOf(null, UnlockReason.Nurse, UnlockReason.Bathroom, UnlockReason.Other, null, null, null),
            changes.map { it.reason },
        )
        assertNull(listOf<Change>(Change.Unlock("s", null)).single().reason)
    }
}

/** An outbox endpoint's fixture: the API's real answer, and the disposition the TypeScript's table gives it. */
@Serializable
data class Fixture(val status: Int, val body: JsonElement, val disposition: String)

/** One send and what its kind's table made of the answer: SettleTests' parts no store holds. */
class SendTest {
    /** The dispositions that end a record: every other keeps it. */
    private val ending = setOf("apply_session", "wait_for_start", "reread", "recorded", "drop")

    /** Each table's case file, and a change of each kind it reads. */
    private val tables =
        mapOf(
            "tap.json" to listOf(Change.Tap("tag")),
            "unlock.json" to listOf(Change.Unlock("s", null), Change.UnlockUnderTap("t", null)),
            "state-change.json" to listOf(Change.Refocus("s"), Change.ProtectionOff("s"), Change.ProtectionOn("s")),
        )

    /** Each outbox endpoint's fixture folder, and a change of its kind: BaliOutbox's `Contract.endpoints`. */
    private val endpoints =
        listOf(
            "taps" to Change.Tap("tag"),
            "unlock" to Change.Unlock("session", null),
            "tap-unlock" to Change.UnlockUnderTap("tap", null),
            "refocus" to Change.Refocus("session"),
            "protection-off" to Change.ProtectionOff("session"),
            "protection-on" to Change.ProtectionOn("session"),
        )

    @Test
    fun onEveryResultAndBodyTheTypeScriptsTablesAnswerASendIsReadByItsOwnKindsTableAndKeptExactlyWhenThatSaysAnUnlockUntilRecorded(): Unit =
        runBlocking {
            // Every case file but the reconcile rule's, which no send reads.
            assertEquals(OutboxCases.files() - "reconcile.json", tables.keys.sorted())
            val wrong = mutableListOf<String>()
            for ((file, changes) in tables) {
                val table = OutboxCases.load<OutboxCases.Table>(file)
                for (change in changes) {
                    var checked = 0
                    for (case in table.cases) {
                        for ((expected, results) in case.dispositions) {
                            for (json in results) {
                                val result = OutboxCases.result(json)
                                val status = (result as? SendResult.Status)?.code
                                val record = queued(change)
                                val sent = record.send(client(Canned(status, case.body?.toString() ?: "")))
                                val context = "$change ${status ?: "no answer"} ${OutboxCases.text(case.body)}"
                                wrong += problems(record, sent, result, expected).map { "$context: $it" }
                                checked += 1
                            }
                        }
                    }
                    if (checked <= 900) wrong += "$change: only $checked sends checked"
                }
            }
            assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
        }

    /** What one send of [record] gets wrong, answered [result] where its table says [expected]. */
    private fun problems(record: OutboxRecord, sent: Sent?, result: SendResult, expected: String): List<String> {
        sent ?: return listOf("no Sent")
        val problems = mutableListOf<String>()

        fun expect(what: String, actual: Any?, wanted: Any?) {
            if (actual != wanted) problems += "$what is $actual, not $wanted"
        }
        expect("the event id", sent.eventId, record.eventId)
        expect("the table", sent.disposition::class, table(record.change))
        expect("the disposition", sent.disposition.wire, expected)
        expect("kept", sent.disposition.keeps, expected !in ending)
        if (record.change.isUnlock) expect("an unlock kept", sent.disposition.keeps, expected != "recorded")
        expect("refused", sent.disposition.refused, expected == "retry_and_surface")
        expect("the result", sent.result, result)
        expect("the status", sent.status, (result as? SendResult.Status)?.code)
        expect("why no answer", sent.noAnswer, if (result == SendResult.NetworkError) NoAnswer.Unreachable else null)
        return problems
    }

    /** The table that reads [change]'s answers. */
    private fun table(change: Change) =
        when (change) {
            is Change.Tap -> Disposition.Tap::class
            is Change.Unlock, is Change.UnlockUnderTap, is Change.UnlockUnfiled -> Disposition.Unlock::class
            is Change.Refocus, is Change.ProtectionOff, is Change.ProtectionOn -> Disposition.StateChange::class
        }

    @Test
    fun theApisRealAnswersEachOutboxFixtureComesBackAsItsDispositionWithWhatTheStoreAndTheEngineReadOfIt(): Unit =
        runBlocking {
            val wrong = mutableListOf<String>()
            val seen = mutableSetOf<String>()
            for ((folder, change) in endpoints) {
                val fixtures = fixtures(folder)
                if (fixtures.size < 4) wrong += "$folder: only ${fixtures.size} fixtures"
                for ((name, fixture) in fixtures) {
                    val sent = queued(change).send(client(Canned(fixture.status, fixture.body.toString())))
                    wrong += problems(change, sent, fixture, seen).map { "$folder/$name: $it" }
                }
            }
            // The fixtures reach each of the answer's facts, so none passes on nothing.
            val facts = setOf("a session", "a state", "superseded", "a kept reason", "an error's reason")
            assertTrue(seen.containsAll(facts), "the fixtures reach only $seen")
            assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
        }

    /** What one send of a [change] answered with [fixture] gets wrong, noting in [seen] what it reached. */
    private fun problems(change: Change, sent: Sent?, fixture: Fixture, seen: MutableSet<String>): List<String> {
        sent ?: return listOf("no Sent")
        val problems = mutableListOf<String>()

        fun expect(what: String, actual: Any?, wanted: Any?) {
            if (wanted != null && wanted != false) seen += what
            if (actual != wanted) problems += "$what is $actual, not $wanted"
        }
        expect("the disposition", sent.disposition.wire, fixture.disposition)
        expect("the status", sent.status, fixture.status)
        expect("why no answer", sent.noAnswer, null)
        val body = fixture.body.jsonObject
        if (fixture.status in 200..299) {
            expect("the error", sent.error, null)
            val session = body["session"]?.takeUnless { it is JsonNull }
            expect("a session", sent.session, session?.let { BaliJson.decodeFromJsonElement(SessionView.serializer(), it) })
            expect("a state", sent.state?.wire, body.text("state"))
            // Only an unlock's answer says it was superseded (A10), and keeps the reason first recorded (A1).
            expect("superseded", sent.superseded, change.isUnlock && body.text("recordedAs") == "superseded")
            expect("a kept reason", sent.reason?.wire, if (change.isUnlock) body.text("reason") else null)
        } else {
            // What the store keeps for a screen: the reason a screen keys on, and the message.
            val error = body.getValue("error").jsonObject
            expect("an error's reason", sent.error?.error?.reason?.wire, error.text("reason"))
            expect("the error's message", sent.error?.error?.message, error.text("message"))
            expect("the session", sent.session, null)
            expect("the state", sent.state, null)
            expect("superseded", sent.superseded, false)
            expect("the reason", sent.reason, null)
        }
        return problems
    }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    /** The fixtures of [folder] under `contracts/fixtures/`, read in place as [OutboxCases] reads its files. */
    private fun fixtures(folder: String): List<Pair<String, Fixture>> {
        val directory = OutboxCases.directory.resolveSibling("fixtures").resolve(folder)
        check(directory.isDirectory) { "no folder at $directory" }
        return directory
            .listFiles()
            .orEmpty()
            .filter { it.isFile && it.name.endsWith(".json") }
            .sortedBy { it.name }
            .map { it.name to BaliJson.decodeFromString(Fixture.serializer(), it.readText()) }
    }

    @Test
    fun withNoTokenToGiveASendSendsNothingAndSaysSoNeverAsAServerOutOfReachAndTheRecordIsKept(): Unit =
        runBlocking {
            // The drain tells the two apart: no token waits for a sign-in, settling nothing (AN5;
            // SyncEngine.swift's drain and its sends before a deletion).
            val none =
                object : TokenProvider {
                    override suspend fun accessToken(): String? = null
                }
            for ((change, _) in sendable) {
                val transport = Canned(200)
                val sent = assertNotNull(queued(change).send(client(transport, none)), "$change")
                assertEquals(NoAnswer.NoToken, sent.noAnswer, "$change")
                assertEquals(SendResult.NetworkError, sent.result, "$change")
                assertNull(sent.status, "$change")
                assertTrue(sent.disposition.keeps, "$change")
                assertTrue(transport.sent.isEmpty(), "$change")
            }
        }

    @Test
    fun onlyRecordedLetsAnUnlockLeaveTheOutboxAndEveryDispositionKeepsOrEndsItsRecordByName() {
        // No answer drops an unlock the server hasn't recorded (ISSUES #2).
        for (disposition in UnlockDisposition.entries) {
            assertEquals(disposition != UnlockDisposition.Recorded, Disposition.Unlock(disposition).keeps, disposition.wire)
        }
        val every =
            TapDisposition.entries.map(Disposition::Tap) + UnlockDisposition.entries.map(Disposition::Unlock) +
                StateChangeDisposition.entries.map(Disposition::StateChange)
        for (disposition in every) {
            assertEquals(disposition.wire !in ending, disposition.keeps, "$disposition")
            // Kept through a refusal, stuck at once: a tap's or an unlock's; a state change's is dropped (A2).
            assertEquals(disposition.wire == "retry_and_surface", disposition.refused, "$disposition")
        }
    }
}
