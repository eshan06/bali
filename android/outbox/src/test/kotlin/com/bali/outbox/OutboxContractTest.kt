package com.bali.outbox

import com.bali.core.BaliJson
import com.bali.core.ProtectionOffResponse
import com.bali.core.ProtectionOnResponse
import com.bali.core.ReconcileStamp
import com.bali.core.RefocusResponse
import com.bali.core.SendResult
import com.bali.core.StateChangeAnswer
import com.bali.core.StateChangeDisposition
import com.bali.core.TapDisposition
import com.bali.core.TapResponse
import com.bali.core.UnlockDisposition
import com.bali.core.UnlockResponse
import com.bali.core.Vocabulary
import com.bali.core.readMayReconcile
import com.bali.core.stateChangeDisposition
import com.bali.core.tapDisposition
import com.bali.core.unlockDisposition
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * The outbox contract's cases, as `contracts/outbox/` holds them: the TypeScript's own answer on
 * every input its golden test sends (packages/shared/src/outbox-cases.test.ts), every status class,
 * 408 and 429, outcomes no build knows, no body. Read in place from the repo, as BaliCore's tests
 * read them; Gradle names the folder (build.gradle.kts). A change to a table there goes red here
 * until the port follows.
 */
object OutboxCases {
    /** The repo's `contracts/outbox/`. A run outside Gradle leaves it unset, and it throws. */
    val directory =
        File(
            checkNotNull(System.getProperty("bali.contracts")) {
                "bali.contracts is unset: run the tests through Gradle (android/README.md)"
            },
            "outbox",
        )

    /**
     * Every case file, found by walking the folder, never listed by hand. A missing folder
     * throws: the port is never passed by checking nothing.
     */
    fun files(): List<String> {
        check(directory.isDirectory) { "no folder at $directory" }
        return directory.listFiles().orEmpty().filter { it.isFile && it.name.endsWith(".json") }.map { it.name }.sorted()
    }

    inline fun <reified T> load(file: String): T = BaliJson.decodeFromString(File(directory, file).readText())

    /** What every file names: the TypeScript function whose answers it holds. */
    @Serializable
    data class Header(val function: String)

    /** A table's file: for each body, the results each disposition answers. */
    @Serializable
    data class Table(
        val function: String,
        /** Every result each case is answered under. */
        val results: List<JsonElement>,
        val cases: List<Case>,
    ) {
        /** [body] is none for no body at all. */
        @Serializable
        data class Case(val body: JsonElement?, val dispositions: Map<String, List<JsonElement>>)
    }

    /** The reconcile rule's file. */
    @Serializable
    data class Reconcile(val cases: List<Case>) {
        @Serializable
        data class Stamp(val changes: Int, val awaiting: Int) {
            val stamp get() = ReconcileStamp(changes, awaiting)

            override fun toString() = "{changes: $changes, awaiting: $awaiting}"
        }

        @Serializable
        data class Case(val sent: Stamp, val now: Stamp, val mayReconcile: Boolean)
    }

    /** A result as the TypeScript writes it: a status, or `"network_error"`. */
    fun result(json: JsonElement): SendResult {
        val result = json as? JsonPrimitive ?: error("not a result: $json")
        if (result.isString) return if (result.content == "network_error") SendResult.NetworkError else error("not a result: $json")
        return SendResult.Status(result.content.toIntOrNull() ?: error("not a status: $json"))
    }

    /** [json] as text, for a failure's message. */
    fun text(json: JsonElement?): String = json?.toString() ?: "no body"
}

/** The outbox tables agree with the TypeScript on every case it generates: OutboxContractTests.swift's port. */
class OutboxContractTest {
    @Test
    fun findsEveryCaseFileInTheRepo() {
        val files = OutboxCases.files()
        assertTrue(files.isNotEmpty(), "no case file in ${OutboxCases.directory}")
        // Every file names the TypeScript function whose answers it holds.
        for (file in files) {
            val text = File(OutboxCases.directory, file).readText()
            assertTrue(text.trimStart().startsWith("{") && "\"function\"" in text, "$file names no function")
        }
    }

    @Test
    fun everyFunctionThePortHasHasItsCasesAndEveryFileIsOneItPorts() {
        val functions = OutboxCases.files().map { OutboxCases.load<OutboxCases.Header>(it).function }
        assertEquals(
            listOf("readMayReconcile", "stateChangeDisposition", "tapDisposition", "unlockDisposition"),
            functions.sorted(),
        )
    }

    @Test
    fun eachFilesCasesAnsweredByThePort() {
        val wrong = OutboxCases.files().flatMap { file -> cases(file).map { "$file: $it" } }
        assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
    }

    @Test
    fun stateChangeDispositionTakesALiteralNullOneEntryPointForEveryAnswerNeverAmbiguous() {
        // With an overload per answer type, none of these would compile (#70's review).
        assertEquals(StateChangeDisposition.Retry, stateChangeDisposition(SendResult.NetworkError, null))
        assertEquals(StateChangeDisposition.Retry, stateChangeDisposition(SendResult.Status(200), null))
        assertEquals(StateChangeDisposition.Reauth, stateChangeDisposition(SendResult.Status(401), null))
        assertEquals(StateChangeDisposition.Drop, stateChangeDisposition(SendResult.Status(409), null))
    }

    /** What the port gets wrong of one file's cases: nothing, if it answers each as the TypeScript does. */
    private fun cases(file: String): List<String> =
        when (val function = OutboxCases.load<OutboxCases.Header>(file).function) {
            "unlockDisposition" ->
                check(file, UnlockDisposition.entries) { result, body ->
                    unlockDisposition(result, decode(UnlockResponse.serializer(), body))
                }
            "tapDisposition" ->
                check(file, TapDisposition.entries) { result, body -> tapDisposition(result, decode(TapResponse.serializer(), body)) }
            // One table for all three: every case holds for a refocus's answer, a report's and the
            // lock back on's.
            "stateChangeDisposition" ->
                listOf<DeserializationStrategy<StateChangeAnswer>>(
                    RefocusResponse.serializer(), ProtectionOffResponse.serializer(), ProtectionOnResponse.serializer(),
                ).flatMap { type ->
                    check(file, StateChangeDisposition.entries) { result, body -> stateChangeDisposition(result, decode(type, body)) }
                        .map { "read as ${type.descriptor.serialName.substringAfterLast('.')}, $it" }
                }
            "readMayReconcile" ->
                OutboxCases.load<OutboxCases.Reconcile>(file).cases.mapNotNull { case ->
                    val got = readMayReconcile(sent = case.sent.stamp, now = case.now.stamp)
                    if (got == case.mayReconcile) null else "readMayReconcile(sent: ${case.sent}, now: ${case.now}) is $got"
                }
            else -> listOf("the port has no $function")
        }

    /**
     * A case's body as the app decodes an answer, from its text: an outcome it doesn't know is
     * unknown. Every body is one the answer's type decodes: no case goes unanswered on a decode error.
     */
    private fun <T> decode(type: DeserializationStrategy<T>, body: JsonElement?): T? =
        body?.let { BaliJson.decodeFromString(type, it.toString()) }

    /**
     * Every case of a table's [file] against [port]: each body under each result, every result
     * once; and the dispositions the cases reach are exactly the port's [dispositions], none it
     * lacks, and no value of its own (a discard, say) that the TypeScript never gives.
     */
    private fun check(
        file: String,
        dispositions: List<Vocabulary>,
        port: (SendResult, JsonElement?) -> Vocabulary,
    ): List<String> {
        val table = OutboxCases.load<OutboxCases.Table>(file)
        val problems = mutableListOf<String>()
        val reached = mutableSetOf<String>()
        for (case in table.cases) {
            val body = OutboxCases.text(case.body)
            val answered = mutableListOf<JsonElement>()
            for ((disposition, results) in case.dispositions) {
                reached += disposition
                for (result in results) {
                    answered += result
                    val got =
                        try {
                            port(OutboxCases.result(result), case.body).wire
                        } catch (error: SerializationException) {
                            "a body the app can't decode (${error.message})"
                        }
                    if (got != disposition) problems += "${table.function}($result, $body) is $got, not $disposition"
                }
            }
            if (answered.size != table.results.size || answered.toSet() != table.results.toSet()) {
                problems += "$body is answered under $answered, not once under each of ${table.results}"
            }
        }
        val ported = dispositions.map { it.wire }.toSet()
        if (reached != ported) problems += "${table.function}'s cases reach $reached, where the port has $ported"
        return problems
    }
}

/** `packages/shared/src/outbox-contract.test.ts`'s scenarios for the reconcile rule: ReconcileTests' port. */
class ReconcileTest {
    /** The phone's two counters, kept the way [ReconcileStamp] describes. */
    private class Phone {
        var stamp = ReconcileStamp(changes = 0, awaiting = 0)
            private set

        /** A tap, unlock, refocus or protection-off report, acted on at once and queued. */
        fun make() {
            stamp = stamp.copy(changes = stamp.changes + 1, awaiting = stamp.awaiting + 1)
        }

        /** A change's first answer (a disposition other than retry or reauth). */
        fun answer() {
            stamp = stamp.copy(changes = stamp.changes + 1, awaiting = stamp.awaiting - 1)
        }

        /** A later answer to a record the outbox kept and resent (retry_and_surface). */
        fun answerAgain() {
            stamp = stamp.copy(changes = stamp.changes + 1)
        }
    }

    @Test
    fun aReadSentAndAnsweredWithNothingInBetweenReconciles() {
        val phone = Phone()
        phone.make()
        phone.answer()
        val sent = phone.stamp
        assertTrue(readMayReconcile(sent = sent, now = phone.stamp))
    }

    @Test
    fun theRaceOf56ARefocusAnsweredWhileACheckInIsInFlightWins() {
        // The check-in reads `unlocked` before the refocus commits and answers after it, so its
        // answer reaches the phone second and is the older one.
        val phone = Phone()
        val checkIn = phone.stamp
        phone.make() // the student refocuses
        phone.answer() // 200 applied, focused
        assertFalse(readMayReconcile(sent = checkIn, now = phone.stamp))
    }

    @Test
    fun aChangeMadeWhileTheReadIsInFlightWinsAnsweredOrNot() {
        val phone = Phone()
        val checkIn = phone.stamp
        phone.make() // an unlock, not answered yet
        assertFalse(readMayReconcile(sent = checkIn, now = phone.stamp))
    }

    @Test
    fun aChangeStillWaitingWhenTheReadWasSentWinsEvenIfNothingMovedSince() {
        // An unlock queued offline, or in backoff: the server has not seen it, so anything a read
        // says is older than the phone's own truth.
        val phone = Phone()
        phone.make()
        val checkIn = phone.stamp
        assertFalse(readMayReconcile(sent = checkIn, now = phone.stamp))
    }

    @Test
    fun aKeptRecordWaitsOnlyForItsFirstAnswerEachLaterOneStillOutdatesAReadInFlight() {
        // A refused tap is kept and resent (retry_and_surface). Its first answer ends its wait, so
        // reads reconcile between resends (the phone must re-read the truth after it), and
        // awaiting never goes below zero.
        val phone = Phone()
        phone.make()
        phone.answer() // 409: kept, surfaced
        val between = phone.stamp
        assertEquals(0, between.awaiting)
        assertTrue(readMayReconcile(sent = between, now = phone.stamp))

        // A resend lands (the block got registered, say: 200 joined) while a check-in is in
        // flight: that answer is newer than the check-in's read.
        val checkIn = phone.stamp
        phone.answerAgain()
        assertEquals(0, phone.stamp.awaiting)
        assertFalse(readMayReconcile(sent = checkIn, now = phone.stamp))
        val next = phone.stamp
        assertTrue(readMayReconcile(sent = next, now = phone.stamp))
    }

    @Test
    fun anUnlockWaitsUntilRecordedARefusedOneKeepsEveryReadFromPuttingTheLockBack() {
        val phone = Phone()
        phone.make() // the student unlocks
        phone.answerAgain() // 409 retry_and_surface: kept, and still waiting
        val checkIn = phone.stamp
        assertEquals(1, checkIn.awaiting)
        assertFalse(readMayReconcile(sent = checkIn, now = phone.stamp))
        phone.answer() // at last, recorded
        val next = phone.stamp
        assertTrue(readMayReconcile(sent = next, now = phone.stamp))
    }

    @Test
    fun onceTheChangeIsAnsweredTheNextReadReconciles() {
        val phone = Phone()
        phone.make()
        val stale = phone.stamp
        phone.answer()
        assertFalse(readMayReconcile(sent = stale, now = phone.stamp))
        val next = phone.stamp
        assertTrue(readMayReconcile(sent = next, now = phone.stamp))
    }
}
