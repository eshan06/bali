package com.bali.outbox

import com.bali.core.ApiErrorBody
import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.SendResult
import com.bali.core.TapDisposition
import com.bali.core.UnlockDisposition
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/** Settling a send, each disposition's effect: OutboxTests' SettleTests, through the store, and the riders' rule. */
class SettleTest : OutboxFiles() {
    @Test
    fun onEveryResultAndBodyTheTypeScriptsTablesAnswerTheRecordGoesExactlyWhenItsDispositionEndsItAnUnlockOnlyWhenRecordedAndARefusalIsStuckAtOnce(): Unit =
        runBlocking {
            val wrong = mutableListOf<String>()
            for ((file, changes) in tables) {
                val table = OutboxCases.load<OutboxCases.Table>(file)
                for (change in changes) {
                    val (outbox, _) = makeOutbox()
                    var checked = 0
                    for (case in table.cases) {
                        for ((expected, results) in case.dispositions) {
                            for (json in results) {
                                val status = (OutboxCases.result(json) as? SendResult.Status)?.code
                                // A fresh record per send (protection off: a fresh session, reported once each).
                                val fresh = if (change is Change.ProtectionOff) Change.ProtectionOff("s$checked") else change
                                val queued = record(outbox, fresh)
                                val disposition = send(outbox, queued, status, case.body?.toString() ?: "")
                                val kept = current(outbox, queued.eventId)
                                val context = "$fresh ${status ?: "no answer"} ${OutboxCases.text(case.body)}"
                                if (disposition?.wire != expected) wrong += "$context: ${disposition?.wire}, not $expected"
                                if ((kept == null) != (expected in ending)) wrong += "$context: kept is ${kept != null}"
                                if (change.isUnlock && (kept == null) != (expected == "recorded")) wrong += "$context: an unlock kept is ${kept != null}"
                                if (kept != null && kept.stuck != (expected == "retry_and_surface")) wrong += "$context: stuck is ${kept.stuck}"
                                checked += 1
                            }
                        }
                    }
                    if (checked <= 900) wrong += "$change: only $checked sends checked"
                }
            }
            assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
        }

    @Test
    fun theApisRealAnswersEachFixtureOfAnOutboxEndpointSettlesAsItsDispositionAKeptOneRememberingTheAnswer(): Unit =
        runBlocking {
            for ((folder, change) in endpoints) {
                val (outbox, _) = makeOutbox()
                val fixtures = fixtures(folder)
                assertTrue(fixtures.size >= 4, folder)
                for ((index, named) in fixtures.withIndex()) {
                    val (name, fixture) = named
                    val fresh = if (change is Change.ProtectionOff) Change.ProtectionOff("s$index") else change
                    val queued = record(outbox, fresh)
                    assertEquals(fixture.disposition, send(outbox, queued, fixture.status, fixture.body.toString())?.wire, "$folder/$name")
                    val kept = current(outbox, queued.eventId)
                    assertEquals(fixture.disposition in ending, kept == null, "$folder/$name")
                    if (kept == null) continue
                    val error = runCatching { BaliJson.decodeFromJsonElement(ApiErrorBody.serializer(), fixture.body) }.getOrNull()
                    assertEquals(fixture.status, kept.lastStatus, "$folder/$name")
                    assertEquals(error?.error?.reason, kept.lastReason, "$folder/$name")
                    assertEquals(error?.error?.message, kept.lastMessage, "$folder/$name")
                }
            }
        }

    @Test
    fun aKeptRecordWaits2s4s8sCappedAtAMinuteAndCountsEachSend(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox(random = 0.0)
            val tap = record(outbox, Change.Tap("tag"))
            var now = t0
            for ((attempt, wait) in listOf(2L, 4, 8, 16, 32, 60, 60, 60, 60, 60).withIndex()) {
                assertEquals(Disposition.Tap(TapDisposition.Retry), send(outbox, tap, null, at = now))
                val kept = assertNotNull(current(outbox, tap.eventId))
                assertEquals(attempt + 1, kept.attempts)
                assertEquals(now.plusSeconds(wait), kept.nextAttemptAt)
                now = kept.nextAttemptAt
            }
        }

    @Test
    fun theJitterAddsUpToAsMuchAgainNeverLessAndNeverMoreWhateverTheRandomSourceSays() {
        for (random in listOf(0.0, 0.25, 0.5, 0.999_999, 1.0, -3.0, 7.0, Double.NaN)) {
            val (outbox, _) = makeOutbox(random)
            for (attempt in 1..12) {
                val base = minOf(1L shl minOf(attempt, 6), 60L)
                val wait = outbox.backoff(attempt)
                assertTrue(wait >= Duration.ofSeconds(base) && wait <= Duration.ofSeconds(2 * base), "$random, attempt $attempt: $wait")
                if (random in 0.0..1.0) assertEquals(base * (1 + random), wait.toNanos() / 1e9, 1e-9, "$random, attempt $attempt")
            }
        }
    }

    @Test
    fun a401AndNoAnswerAreNotTheRecordsFaultTheyBackOffButNeverCountTowardTheBoundNorDo408And429(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val unlock = record(outbox, Change.Unlock("s", null))
            for (status in listOf(null, 401, 408, 429, null, 401, 408, 429, null, 401)) send(outbox, unlock, status)
            val kept = assertNotNull(current(outbox, unlock.eventId))
            assertEquals(listOf(10, 0), listOf(kept.attempts, kept.answers))
            assertFalse(kept.stuck)
            assertEquals(401, kept.lastStatus)
        }

    @Test
    fun theServersAnswersThatLeaveARecordUnsettledA5xxA3xxA2xxThisBuildCannotReadMakeItStuckAtTheEighthAndStuckStaysStuck(): Unit =
        runBlocking {
            for ((change, status, body) in listOf(
                Triple(Change.Tap("tag"), 500, ""),
                Triple(Change.Tap("tag"), 200, """{"outcome":"queued"}"""),
                Triple(Change.Unlock("s", null), 503, "<html>"),
                Triple(Change.Unlock("s", null), 200, """{"outcome":"recorded_elsewhere"}"""),
                Triple(Change.Refocus("s"), 302, ""),
                Triple(Change.ProtectionOff("s"), 200, "not json"),
            )) {
                val (outbox, _) = makeOutbox()
                val queued = record(outbox, change)
                for (answer in 1..Outbox.BOUND) {
                    send(outbox, queued, status, body)
                    val kept = assertNotNull(current(outbox, queued.eventId), "$change $status")
                    assertEquals(answer, kept.answers, "$change $status")
                    assertEquals(answer == Outbox.BOUND, kept.stuck, "$change $status: answer $answer")
                    assertEquals(status, kept.lastStatus, "$change $status")
                }
                // Kept, never discarded, and once stuck a later answer of any kind leaves it stuck.
                send(outbox, queued, null)
                send(outbox, queued, 401)
                val kept = assertNotNull(current(outbox, queued.eventId), "$change $status")
                assertTrue(kept.stuck && kept.attempts == Outbox.BOUND + 2, "$change $status")
            }
        }

    @Test
    fun aRefusalTheTablesKeepATapsOrAnUnlocks4xxIsStuckAtOnceAndShown(): Unit =
        runBlocking {
            for (change in listOf(Change.Tap("tag"), Change.Unlock("s", null))) {
                val (outbox, _) = makeOutbox()
                val queued = record(outbox, change)
                val disposition =
                    send(
                        outbox, queued, 409,
                        """{"error":{"code":"conflict","reason":"event_id_conflict","message":"event_id already used by another event"}}""",
                    )
                assertTrue(
                    disposition == Disposition.Tap(TapDisposition.RetryAndSurface) ||
                        disposition == Disposition.Unlock(UnlockDisposition.RetryAndSurface),
                    "$change: $disposition",
                )
                val kept = assertNotNull(current(outbox, queued.eventId), "$change")
                assertTrue(kept.stuck && kept.answers == 1, "$change")
                assertEquals(409 to ApiErrorReason.EventIdConflict, kept.lastStatus to kept.lastReason, "$change")
                assertEquals("event_id already used by another event", kept.lastMessage, "$change")
                // Stuck stays stuck, whatever answers next short of one that ends it.
                send(outbox, queued, null)
                send(outbox, queued, 503)
                val later = assertNotNull(current(outbox, queued.eventId), "$change")
                assertTrue(later.stuck && later.answers == 2 && later.attempts == 3, "$change")
                assertEquals(listOf(503, null, null), listOf(later.lastStatus, later.lastReason, later.lastMessage), "$change")
            }
        }

    // The riders' rule (C4's review), which iOS's tests reach only through the engine's screens.
    @Test
    fun aRefusalsStatusStaysOnItsRecordWhateverAnswersComeAfterAnotherRefusalWritesItAnewAndTheBoundSticksNone(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            send(outbox, tap, 409, Answer.refused("event_id_conflict"))
            for (status in listOf(503, null, 401, 429)) send(outbox, tap, status)
            assertEquals(409 to 429, assertNotNull(current(outbox, tap.eventId)).let { it.refusedStatus to it.lastStatus })
            send(outbox, tap, 404, Answer.unknownBlock)
            assertEquals(404, current(outbox, tap.eventId)?.refusedStatus)
            // Stuck by the bound, never refused: none.
            val unlock = record(outbox, Change.Unlock("s", null))
            repeat(Outbox.BOUND) { send(outbox, unlock, 500) }
            assertEquals(true to null, assertNotNull(current(outbox, unlock.eventId)).let { it.stuck to it.refusedStatus })
        }
}
