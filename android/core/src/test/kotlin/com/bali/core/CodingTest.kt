package com.bali.core

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put

private inline fun <reified T> decode(json: String, strict: Boolean = false): T =
    (if (strict) StrictJson else BaliJson).decodeFromString(json)

private inline fun <reified T> encoded(value: T): String = BaliJson.encodeToString(value)

@Serializable
private data class Stamp(@Contextual val at: Instant)

/** Times on the wire. */
class TimeTest {
    @Test
    fun aTimeDecodesWithMillisecondsAsJsToIsoStringWritesItAndWithout() {
        val times =
            mapOf(
                "2000-01-01T00:01:00.000Z" to Instant.ofEpochSecond(946_684_860),
                "2000-01-01T00:01:00Z" to Instant.ofEpochSecond(946_684_860),
                "2026-09-24T10:53:12.345Z" to Instant.ofEpochMilli(1_790_247_192_345),
                "2026-09-24T10:53:12Z" to Instant.ofEpochSecond(1_790_247_192),
            )
        for ((text, time) in times) assertEquals(time, decode<Stamp>("""{"at":"$text"}""").at, text)
    }

    @Test
    fun aTimeEncodesAsJsToIsoStringWritesItMillisecondsAndAll() {
        assertEquals("""{"at":"2026-09-24T10:53:12.500Z"}""", encoded(Stamp(Instant.ofEpochMilli(1_790_247_192_500))))
        assertEquals("""{"at":"2000-01-01T00:01:00.000Z"}""", encoded(Stamp(Instant.ofEpochSecond(946_684_860))))
    }

    @Test
    fun anythingButAnIso8601TimeIsADecodingErrorNeverAGuess() {
        for (text in listOf("yesterday", "2000-01-01", "")) {
            assertFailsWith<SerializationException>(text) { decode<Stamp>("""{"at":"$text"}""") }
        }
    }
}

/**
 * Forward compatibility: `/v1` is additive-only and old apps call forever. CodingTests.swift's
 * cases for the vocabulary and the error body; AN3b ports its wire types' own (a tap's answer, a
 * history, a class, the requests).
 */
class ForwardCompatibilityTest {
    /** An answer's vocabulary fields, as a tap's answer has them. */
    @Serializable
    private data class Answer(val outcome: OrUnknown<TapOutcome>, val state: OrUnknown<ParticipationState>? = null)

    @Test
    fun aVocabularyValueThisBuildDoesNotKnowDecodesAsUnknownAndEncodesAsSent() {
        val answer = decode<Answer>("""{"outcome":"queued","state":"dozing"}""")
        assertEquals(OrUnknown.Unknown("queued"), answer.outcome)
        assertEquals(OrUnknown.Unknown("dozing"), answer.state)
        assertEquals("""{"outcome":"queued","state":"dozing"}""", encoded(answer))
    }

    @Test
    fun aKnownValueDecodesAsItself() {
        val answer = decode<Answer>("""{"outcome":"already_armed","state":null}""")
        assertEquals(OrUnknown.Known(TapOutcome.AlreadyArmed), answer.outcome)
        assertEquals(TapOutcome.AlreadyArmed, answer.outcome.known)
        assertEquals("already_armed", answer.outcome.wire)
        assertNull(answer.state)
    }

    /** An answer's field that forgot [OrUnknown], which BaliCore would refuse to compile. */
    @Serializable
    private data class Bare(val outcome: TapOutcome)

    @Test
    fun aVocabularysOwnCodingSendsItsWireValueAndReadsOneOnlyWhereBaliCoreDoes() {
        // The phone's own records and requests: BaliCore's Codable vocabularies, a value it knows.
        assertEquals("\"nurse\"", encoded(UnlockReason.Nurse))
        assertEquals(ParticipationState.ProtectionOff, decode<ParticipationState>("\"protection_off\""))
        assertEquals(PushEnvironment.Sandbox, decode<PushEnvironment>("\"sandbox\""))
        assertFailsWith<SerializationException> { decode<UnlockReason>("\"stretch\"") }
        // Any other is read through OrUnknown only: alone, even a value it knows fails at once.
        assertEquals("""{"outcome":"joined"}""", encoded(Bare(TapOutcome.Joined)))
        assertFailsWith<SerializationException> { decode<Bare>("""{"outcome":"joined"}""") }
        assertFailsWith<SerializationException> { decode<ApiErrorReason>("\"protection_off\"") }
    }

    @Test
    fun aFieldThisBuildDoesNotKnowIsIgnored() {
        val body = decode<ApiErrorBody>("""{"error":{"code":"gone","message":"No.","hint":"x"},"requestId":"r"}""")
        assertEquals(OrUnknown.Unknown("gone"), body.error.code)
        assertEquals("No.", body.error.message)
    }

    @Test
    fun anErrorsReasonThisBuildDoesNotKnowReadsAsNoneAKnownOneAsItself() {
        val unknown = decode<ApiErrorBody>("""{"error":{"code":"conflict","reason":"moon_phase","message":"No."}}""")
        assertNull(unknown.error.reason)
        assertEquals(OrUnknown.Known(ApiErrorCode.Conflict), unknown.error.code)

        val known = decode<ApiErrorBody>("""{"error":{"code":"conflict","reason":"protection_off","message":"No."}}""")
        assertEquals(ApiErrorReason.ProtectionOff, known.error.reason)

        val none = decode<ApiErrorBody>("""{"error":{"code":"teapot","message":"No.","details":[{"path":"x"}]}}""")
        assertNull(none.error.reason)
        assertEquals(OrUnknown.Unknown("teapot"), none.error.code)
        assertEquals(buildJsonArray { addJsonObject { put("path", "x") } }, none.error.details)

        assertNull(decode<ApiErrorBody>("""{"error":{"code":"conflict","reason":null,"message":"No."}}""").error.reason)
    }

    @Test
    fun anOptionalFieldLeftOutReadsAsNoneAndNoneIsLeftOutWhenSent() {
        val bare = """{"error":{"code":"conflict","message":"No."}}"""
        val body = decode<ApiErrorBody>(bare)
        assertNull(body.error.reason)
        assertNull(body.error.details)
        assertEquals(bare, encoded(body))
        val full = """{"error":{"code":"conflict","reason":"protection_off","message":"No.","details":{"seen":1}}}"""
        assertEquals(full, encoded(decode<ApiErrorBody>(full)))
    }

    /** A body whose field has a default that isn't none. */
    @Serializable
    private data class Counted(val tag: String, val count: Int = 0, val note: String? = null)

    @Test
    fun everyFieldButNoneIsSentItsDefaultToo() {
        // As Swift sends every field it has: a default left out would read as a missing field.
        assertEquals("""{"tag":"t","count":0}""", encoded(Counted("t")))
    }

    @Test
    fun theContractTestsStrictModeRefusesWhatTheAppReadsAsUnknown() {
        assertFailsWith<SerializationException> {
            decode<Answer>("""{"outcome":"queued","state":null}""", strict = true)
        }
        assertFailsWith<SerializationException> {
            decode<ApiErrorBody>("""{"error":{"code":"conflict","reason":"moon_phase","message":"No."}}""", strict = true)
        }
        assertFailsWith<SerializationException> {
            decode<ApiErrorBody>("""{"error":{"code":"teapot","message":"No."}}""", strict = true)
        }
        val known = decode<Answer>("""{"outcome":"joined","state":null}""", strict = true)
        assertEquals(OrUnknown.Known(TapOutcome.Joined), known.outcome)
        val reason = """{"error":{"code":"conflict","reason":"protection_off","message":"No."}}"""
        assertEquals(ApiErrorReason.ProtectionOff, decode<ApiErrorBody>(reason, strict = true).error.reason)
        // Its module is BaliJson's with the mark added, so it reads a time as the app does.
        val time = decode<Stamp>("""{"at":"2000-01-01T00:01:00Z"}""", strict = true)
        assertEquals(Instant.ofEpochSecond(946_684_860), time.at)
    }
}
