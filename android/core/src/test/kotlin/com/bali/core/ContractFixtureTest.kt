package com.bali.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The phone's contract (ARCHITECTURE, "The fixtures are the phone's contract"): the API's real
 * answer to every student request, as `contracts/fixtures/` holds it, read in place from the repo
 * and never copied into this module, as BaliCore's tests read it. Gradle names the folder
 * (build.gradle.kts). ContractFixtureTests.swift's port.
 */
object Contract {
    /** The repo's `contracts/`. A run outside Gradle leaves it unset, and it throws. */
    val root =
        File(
            checkNotNull(System.getProperty("bali.contracts")) {
                "bali.contracts is unset: run the tests through Gradle (android/README.md)"
            },
        )

    val fixtures = File(root, "fixtures")

    /**
     * Every fixture, by its path under `contracts/fixtures/`: found by walking the folder, never
     * listed by hand, so a fixture the API gains is read here the day it lands. A missing folder
     * throws: the contract is never passed by checking nothing.
     */
    fun fixturePaths(): List<String> {
        check(fixtures.isDirectory) { "no folder at $fixtures" }
        return fixtures
            .walk()
            .filter { it.isFile && it.name.endsWith(".json") }
            .map { it.relativeTo(fixtures).invariantSeparatorsPath }
            .sorted()
            .toList()
    }

    /**
     * One fixture file, as `Fixture` in apps/api/test/helpers/contract.ts writes it. Its
     * [disposition] is what the TypeScript outbox table says of the answer: the port must agree.
     */
    @Serializable
    data class Fixture(
        val endpoint: String,
        val request: Request,
        val status: Int,
        val type: String,
        val body: JsonElement,
        val disposition: String?,
    ) {
        @Serializable
        data class Request(val path: String, val body: JsonElement?)
    }

    fun load(path: String): Fixture = BaliJson.decodeFromString(File(fixtures, path).readText())

    /** Each `@bali/shared` type a fixture's body can be, as the `core` type that decodes it. */
    val responseTypes: Map<String, KSerializer<*>> =
        mapOf(
            "MeResponse" to MeResponse.serializer(),
            "UpdateMeResponse" to UpdateMeResponse.serializer(),
            "DeleteMeResponse" to DeleteMeResponse.serializer(),
            "RegisterPushTokenResponse" to RegisterPushTokenResponse.serializer(),
            "RemovePushTokenResponse" to RemovePushTokenResponse.serializer(),
            "AgeCheckResponse" to AgeCheckResponse.serializer(),
            "TapResponse" to TapResponse.serializer(),
            "CheckInResponse" to CheckInResponse.serializer(),
            "UnlockResponse" to UnlockResponse.serializer(),
            "UnlockReasonResponse" to UnlockReasonResponse.serializer(),
            "RefocusResponse" to RefocusResponse.serializer(),
            "ProtectionOffResponse" to ProtectionOffResponse.serializer(),
            "ProtectionOnResponse" to ProtectionOnResponse.serializer(),
            "EnrollmentJoinResponse" to EnrollmentJoinResponse.serializer(),
            "EndEnrollmentResponse" to EndEnrollmentResponse.serializer(),
            "JoinCodePreviewResponse" to JoinCodePreviewResponse.serializer(),
            "HistoryPage" to HistoryPage.serializer(),
            "Presentation" to Presentation.serializer(),
            "AnswerResponse" to AnswerResponse.serializer(),
            "DeckDownload" to DeckDownload.serializer(),
            "ApiErrorBody" to ApiErrorBody.serializer(),
        )

    /** Each endpoint a fixture's request sends a body to, as the `core` type the phone sends. */
    val requestTypes: Map<String, KSerializer<*>> =
        mapOf(
            "PATCH /v1/me" to UpdateMeRequest.serializer(),
            "DELETE /v1/me" to DeleteMeRequest.serializer(),
            "PUT /v1/me/push-token" to RegisterPushTokenRequest.serializer(),
            "DELETE /v1/me/push-token" to RemovePushTokenRequest.serializer(),
            "PUT /v1/me/age-check" to RecordAgeCheckRequest.serializer(),
            "POST /v1/taps" to TapRequest.serializer(),
            "POST /v1/sessions/{id}/checkin" to CheckInRequest.serializer(),
            "POST /v1/sessions/{id}/unlock" to UnlockRequest.serializer(),
            "POST /v1/taps/{eventId}/unlock" to UnlockRequest.serializer(),
            "PATCH /v1/unlocks/{eventId}" to UnlockReasonRequest.serializer(),
            "POST /v1/sessions/{id}/refocus" to RefocusRequest.serializer(),
            "POST /v1/sessions/{id}/protection-off" to ProtectionOffRequest.serializer(),
            "POST /v1/sessions/{id}/protection-on" to ProtectionOnRequest.serializer(),
            "POST /v1/enrollments" to EnrollmentJoinRequest.serializer(),
            "DELETE /v1/enrollments/{id}" to EndEnrollmentRequest.serializer(),
            "POST /v1/questions/{id}/answers" to AnswerRequest.serializer(),
        )

    /**
     * Each endpoint whose answers go through an outbox table, as the port's disposition of an
     * answer: its status, and on a 2xx its body, decoded as the app decodes it (any other status
     * carries the error shape, which no table reads). Each fixture of one carries the TypeScript
     * table's disposition, to agree with.
     */
    val outboxes: Map<String, (Int, JsonElement) -> String> =
        mapOf(
            "POST /v1/taps" to table(TapResponse.serializer(), ::tapDisposition),
            "POST /v1/sessions/{id}/unlock" to table(UnlockResponse.serializer(), ::unlockDisposition),
            "POST /v1/taps/{eventId}/unlock" to table(UnlockResponse.serializer(), ::unlockDisposition),
            "POST /v1/sessions/{id}/refocus" to table(RefocusResponse.serializer(), ::stateChangeDisposition),
            "POST /v1/sessions/{id}/protection-off" to table(ProtectionOffResponse.serializer(), ::stateChangeDisposition),
            "POST /v1/sessions/{id}/protection-on" to table(ProtectionOnResponse.serializer(), ::stateChangeDisposition),
        )

    /** [port], an outbox table, reading a fixture's answer: decoded as [type] on a 2xx, else none. */
    private fun <A> table(type: KSerializer<A>, port: (SendResult, A?) -> Vocabulary): (Int, JsonElement) -> String =
        { status, body -> port(SendResult.Status(status), if (status in 200..299) appDecode(type, body) else null).wire }

    /**
     * [json] decoded as [type], strictly, so a vocabulary value `core` lacks fails rather than
     * reading as unknown, and encoded back: all of it that `core` reads, as JSON. It is decoded
     * from its text, as the app decodes an answer, so a failure names where in the JSON it is.
     */
    fun roundTrip(type: KSerializer<*>, json: JsonElement): JsonElement {
        @Suppress("UNCHECKED_CAST")
        val serializer = type as KSerializer<Any?>
        return BaliJson.encodeToJsonElement(serializer, StrictJson.decodeFromString(serializer, json.toString()))
    }

    /**
     * What a null field is swapped for, to learn whether `core` reads it. A field it reads either
     * refuses this (every type it decodes one as does, but a list of strings or any JSON) or, being
     * one of those, brings it back.
     */
    val probe = JsonArray(listOf(JsonPrimitive("probe")))
}

/** One step into a JSON value: an object's field, or an array's element. */
sealed interface JsonStep {
    data class Key(val key: String) : JsonStep {
        override fun toString() = key
    }

    data class Index(val index: Int) : JsonStep {
        override fun toString() = "[$index]"
    }
}

/** This value without its null fields: an optional `core` holds as none is encoded absent. */
val JsonElement.droppingNullFields: JsonElement
    get() =
        when (this) {
            is JsonObject -> JsonObject(filterValues { it !is JsonNull }.mapValues { it.value.droppingNullFields })
            is JsonArray -> JsonArray(map { it.droppingNullFields })
            else -> this
        }

/** The path to each of this value's null fields, through its objects and arrays. */
val JsonElement.nullFields: List<List<JsonStep>>
    get() =
        when (this) {
            is JsonObject ->
                entries.sortedBy { it.key }.flatMap { (key, value) ->
                    if (value is JsonNull) listOf(listOf(JsonStep.Key(key))) else value.nullFields.map { listOf(JsonStep.Key(key)) + it }
                }
            is JsonArray -> flatMapIndexed { index, value -> value.nullFields.map { listOf(JsonStep.Index(index)) + it } }
            else -> emptyList()
        }

/** The value at [path], if there is one. */
fun JsonElement.at(path: List<JsonStep>): JsonElement? {
    val step = path.firstOrNull() ?: return this
    val rest = path.drop(1)
    return when {
        this is JsonObject && step is JsonStep.Key -> this[step.key]?.at(rest)
        this is JsonArray && step is JsonStep.Index -> getOrNull(step.index)?.at(rest)
        else -> null
    }
}

/** This value with [replacement] at [path], a path it holds. */
fun JsonElement.replacing(path: List<JsonStep>, replacement: JsonElement): JsonElement {
    val step = path.firstOrNull() ?: return replacement
    val rest = path.drop(1)
    return when {
        this is JsonObject && step is JsonStep.Key && step.key in this ->
            JsonObject(this + (step.key to getValue(step.key).replacing(rest, replacement)))
        this is JsonArray && step is JsonStep.Index && step.index in indices ->
            JsonArray(mapIndexed { index, value -> if (index == step.index) value.replacing(rest, replacement) else value })
        else -> this
    }
}

/** A path as kotlinx's messages name a place in the JSON being decoded: `$.events[0].session`. */
val List<JsonStep>.jsonPath: String
    get() = "$" + joinToString("") { if (it is JsonStep.Key) ".${it.key}" else "$it" }

/**
 * Where in the JSON a decode failed, as kotlinx's message names it (`at path: $.events[0].session`),
 * BaliCore's `DecodingError.path`; none when it names no place.
 */
val SerializationException.path: String?
    get() = Regex("""at path: (\$\S*)""").find(message.orEmpty())?.groupValues?.get(1)

class ContractFixtureTest {
    @Test
    fun findsEveryFixtureInTheRepo() {
        // The repo's contracts/, beside the API's description, and not some other folder.
        assertTrue(File(Contract.root, "openapi.json").isFile, "${Contract.root} isn't the repo's contracts/")
        val paths = Contract.fixturePaths()
        assertTrue(paths.isNotEmpty(), "no fixture under ${Contract.fixtures}")
        for (path in paths) {
            val text = File(Contract.fixtures, path).readText()
            assertTrue(text.trimStart().startsWith("{") && "\"endpoint\"" in text, "$path is no fixture")
        }
    }

    @Test
    fun eachFixturesAnswerDecodesAsItsTypeAndReadsBackWholeItsRequestAsSent() {
        val wrong = Contract.fixturePaths().flatMap { path -> problems(path).map { "$path: $it" } }
        assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
    }

    /** What `core` gets wrong of one fixture: nothing, if it reads all of its answer and request. */
    private fun problems(path: String): List<String> {
        val fixture =
            try {
                Contract.load(path)
            } catch (error: SerializationException) {
                return listOf("no fixture: ${error.message}")
            }
        val type = Contract.responseTypes[fixture.type] ?: return listOf("core has no type for ${fixture.type}")
        // Read back whole: a field core misses or misnames fails here, not only a bad value.
        val answer =
            try {
                Contract.roundTrip(type, fixture.body)
            } catch (error: SerializationException) {
                return listOf("${fixture.type} refuses its answer: ${error.message}")
            }
        val problems = mutableListOf<String>()
        if (answer.droppingNullFields != fixture.body.droppingNullFields) {
            problems += "${fixture.type} reads its answer back as $answer"
        }
        // Its null fields too, which that compares on neither side: one null in every fixture that
        // core lacked or misnamed would decode as none forever. Each is sent the probe instead, and
        // core reads it only if the decode then fails at that field, or the probe comes back.
        for (field in fixture.body.nullFields) {
            val name = field.joinToString(".")
            try {
                val read = Contract.roundTrip(type, fixture.body.replacing(field, Contract.probe))
                if (read.at(field) != Contract.probe) problems += "${fixture.type} never reads $name"
            } catch (error: SerializationException) {
                val at = error.path
                val here = field.jsonPath
                if (at == null || !(at == here || at.startsWith("$here.") || at.startsWith("$here["))) {
                    problems += "${fixture.type}, $name probed, failed elsewhere: ${error.message}"
                }
            }
        }
        val request = fixture.request.body ?: return problems
        val requestType =
            Contract.requestTypes[fixture.endpoint] ?: return problems + "core has no body for ${fixture.endpoint}"
        // What the phone sends: every field, none extra, each time as the API's clock writes it.
        try {
            val sent = Contract.roundTrip(requestType, request)
            if (sent != request) problems += "its request reads back as $sent"
        } catch (error: SerializationException) {
            problems += "its request is refused: ${error.message}"
        }
        return problems
    }

    @Test
    fun aProbedFieldsRefusalNamesTheFieldItWasSwappedInto() {
        // The probe reads where a decode failed from kotlinx's message: pinned here, so a release
        // that words it otherwise fails by name, not as every probed field failing "elsewhere".
        val tap = BaliJson.parseToJsonElement("""{"outcome":"joined","session":["probe"],"state":null}""")
        val error = assertFailsWith<SerializationException> { Contract.roundTrip(TapResponse.serializer(), tap) }
        assertEquals("$.session", error.path)
        val moment =
            """{"eventId":"e","type":"unlock","occurredAt":"2000-01-01T00:01:00.000Z","class":{"id":"c","name":"n"},""" +
                """"teacher":{"displayName":null},"session":null,"reason":["probe"],"recordedAs":null,"countedIn":null}"""
        val page = BaliJson.parseToJsonElement("""{"events":[$moment],"nextBefore":null}""")
        val nested = assertFailsWith<SerializationException> { Contract.roundTrip(HistoryPage.serializer(), page) }
        assertEquals("$.events[0].reason", nested.path)
    }

    @Test
    fun eachFixturesDispositionTheTypeScriptOutboxTablesIsThePorts() {
        val wrong =
            Contract.fixturePaths().mapNotNull { path ->
                val fixture = Contract.load(path)
                val port = Contract.outboxes[fixture.endpoint]
                val expected = fixture.disposition
                when {
                    // A disposition no port here reads would be one nothing checks.
                    port == null -> expected?.let { "$path: core has no outbox for ${fixture.endpoint}" }
                    expected == null -> "$path: an outbox answer with no disposition"
                    else -> {
                        val got =
                            try {
                                port(fixture.status, fixture.body)
                            } catch (error: SerializationException) {
                                "an answer the app can't decode (${error.message})"
                            }
                        if (got == expected) null else "$path: the port's disposition is $got, not $expected"
                    }
                }
            }
        assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
    }

    @Test
    fun theWalkFindsAFixtureOfEveryTypeAndRequestCoreMapsAndNoneItDoesNot() {
        val fixtures = Contract.fixturePaths().map(Contract::load)
        assertEquals(Contract.responseTypes.keys, fixtures.map { it.type }.toSet())
        val requests = fixtures.filter { it.request.body != null }.map { it.endpoint }
        assertEquals(Contract.requestTypes.keys, requests.toSet())
        // Every outbox port meets the API's real answers, and only a port's answers carry one.
        val dispositions = fixtures.filter { it.disposition != null }.map { it.endpoint }
        assertEquals(Contract.outboxes.keys, dispositions.toSet())
    }
}
