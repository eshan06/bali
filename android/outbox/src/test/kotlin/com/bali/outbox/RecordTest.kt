package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ActionOrder
import com.bali.core.ParticipationState
import com.bali.core.ProtectionOffRequest
import com.bali.core.RefocusRequest
import com.bali.core.SessionView
import com.bali.core.TapRequest
import com.bali.core.UnlockReason
import com.bali.core.UnlockRequest
import java.time.Duration
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/** Queues [change], which the test expects to be queued: BaliOutbox's tests' `record`. */
suspend fun record(outbox: Outbox, change: Change, at: Instant = t0, standing: Standing? = null, hold: Duration = Duration.ZERO) =
    assertNotNull(outbox.record(change, at, standing, hold), "$change wasn't queued")

/** The record [eventId] as the outbox holds it now; none once it's gone. */
suspend fun current(outbox: Outbox, eventId: String): OutboxRecord? = outbox.dao.record(eventId)?.record()

/** Session [id], ending [endsAt] seconds after [t0], as the phone keeps it and an answer names it. */
fun session(id: String = "s", endsAt: Long = 3000) = SessionView(id, "c", t0.plusSeconds(endsAt))

/** A UUIDv7, in lower case. */
val uuidV7 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

/** Queuing what the phone did: OutboxTests' RecordTests, and the rules of `record` no iOS test reaches through the outbox alone. */
class RecordTest : OutboxFiles() {
    @Test
    fun eachChangeIsQueuedUnderANewUuidV7MintedAtThatMomentDueAtOnceSentAsItsRequest(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val at = t0.plusSeconds(7)
            val changes =
                listOf(
                    Change.Tap("04:A2:1B"), Change.UnlockUnderTap("t", UnlockReason.Nurse),
                    Change.Unlock("s", UnlockReason.Bathroom), Change.Unlock("s", null), Change.Refocus("s"),
                    Change.ProtectionOff("s"),
                )
            val records = changes.map { record(outbox, it, at) }
            // The unlocks superseded nothing; the refocus follows the last.
            assertEquals(records, outbox.records())
            assertEquals(records[3].eventId, records[4].follows)
            for (record in records) {
                assertTrue(uuidV7.matches(record.eventId), record.eventId)
                // Its first 48 bits are the time it was recorded, in milliseconds.
                assertEquals(1_790_000_007_000, record.eventId.replace("-", "").take(12).toLong(16))
                assertEquals(listOf(at, at), listOf(record.recordedAt, record.nextAttemptAt))
                assertEquals(listOf(0, 0), listOf(record.attempts, record.answers))
                assertFalse(record.stuck)
                assertEquals(listOf(null, null, null), listOf(record.lastStatus, record.lastReason, record.lastMessage))
            }
            val id = records.map { it.eventId }
            assertEquals(records.size, id.toSet().size)
            // Each with its place in what the phone did (A12): the file's install, its own seq.
            val install = assertNotNull(outbox.install())
            val nth = { seq: Long -> ActionOrder(install, seq) }
            assertEquals(
                listOf(
                    OutboxRecord.Request.Tap(TapRequest("04:A2:1B", id[0], at, nth(1))),
                    // Filed under its tap (decision 11), with its own order like every record.
                    OutboxRecord.Request.UnlockUnderTap("t", UnlockRequest(id[1], at, UnlockReason.Nurse, nth(2))),
                    OutboxRecord.Request.Unlock("s", UnlockRequest(id[2], at, UnlockReason.Bathroom, nth(3))),
                    OutboxRecord.Request.Unlock("s", UnlockRequest(id[3], at, order = nth(4))),
                    OutboxRecord.Request.Refocus("s", RefocusRequest(id[4], at, nth(5))),
                    OutboxRecord.Request.ProtectionOff("s", ProtectionOffRequest(id[5], at, nth(6))),
                ),
                records.map { it.request },
            )
            assertEquals(changes, records.map { it.change })
        }

    // Its in-flight refocus's answer, which comes back to nothing, is AN4e's: it needs `settle`.
    @Test
    fun aLaterTapOrUnlockOneFiledUnderATapTooSupersedesEveryQueuedRefocusDeletedNeverSent(): Unit =
        runBlocking {
            for (later in listOf(Change.Tap("tag"), Change.Unlock("s", null), Change.UnlockUnderTap("t", null))) {
                val (outbox, _) = makeOutbox()
                val unlock = record(outbox, Change.Unlock("s", null))
                val report = record(outbox, Change.ProtectionOff("s"))
                record(outbox, Change.Refocus("s"))
                record(outbox, Change.Refocus("t"))
                val tap = record(outbox, Change.Tap("tag"))
                // A refocus queued after the tap is superseded in its turn.
                record(outbox, Change.Refocus("s"))
                val latest = record(outbox, later)
                assertEquals(listOf(unlock, report, tap, latest).map { it.eventId }, outbox.records().map { it.eventId }, "$later")
                // Nothing supersedes an unlock, a tap or a protection-off report.
                record(outbox, Change.Tap("tag"))
                record(outbox, Change.Unlock("s", null))
                assertEquals(6, outbox.records().size, "$later")
            }
        }

    @Test
    fun protectionOffIsReportedOncePerRevocationAndAgainAfterATapInAnotherSessionOrOnceRestored(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val first = record(outbox, Change.ProtectionOff("s"))
            // Every later check-in that finds the lock still switched off: nothing new.
            assertNull(outbox.record(Change.ProtectionOff("s"), t0))
            assertNull(outbox.record(Change.ProtectionOff("s"), t0))
            // An unlock or a refocus doesn't return the row to focused.
            record(outbox, Change.Unlock("s", null))
            record(outbox, Change.Refocus("s"))
            assertNull(outbox.record(Change.ProtectionOff("s"), t0))

            // A tap does: reported again, under a new id.
            record(outbox, Change.Tap("tag"))
            val afterTap = record(outbox, Change.ProtectionOff("s"))
            assertNotEquals(first.eventId, afterTap.eventId)
            assertNull(outbox.record(Change.ProtectionOff("s"), t0))

            // A join the phone didn't tap for, an armed tap converted at Start, is another session.
            record(outbox, Change.ProtectionOff("t"))
            assertNull(outbox.record(Change.ProtectionOff("t"), t0))

            // Restored, then switched off again: a new revocation.
            outbox.protectionRestored()
            record(outbox, Change.ProtectionOff("t"))
            assertEquals(4, outbox.records().count { it.change is Change.ProtectionOff })
        }

    // UnlockRouteTests' refocusFollows, then the rest of the rule, which no iOS test reaches through
    // the outbox alone.
    @Test
    fun aRefocusReturnsFromTheLatestUnlockWhileItIsQueuedOneUnderATapNotYetAnsweredItsSessionStillUnnamedIncluded(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("A"))
            val unlock = record(outbox, Change.UnlockUnderTap(tap.eventId, null))
            assertEquals(unlock.eventId, record(outbox, Change.Refocus("s")).follows)
        }

    @Test
    fun aRefocusReturnsOnlyFromAnUnlockOfItsSessionStillQueuedOneNotFiledYetFiledByTheRefocussOwnWrite(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            assertNull(record(outbox, Change.Refocus("s")).follows)
            val unlock = record(outbox, Change.Unlock("s", null))
            assertEquals(unlock.eventId, record(outbox, Change.Refocus("s")).follows)
            // The latest unlock another session's: none of this one's.
            record(outbox, Change.Unlock("t", null))
            assertNull(record(outbox, Change.Refocus("s")).follows)
            // Under a tap, made where the phone stood in a session: that session's alone.
            val underTap = record(outbox, Change.UnlockUnderTap("tap", null), standing = Standing.InSession(session(), ParticipationState.Unlocked))
            assertNull(record(outbox, Change.Refocus("t")).follows)
            assertEquals(underTap.eventId, record(outbox, Change.Refocus("s")).follows)
            // Recorded and gone: none.
            val gone = record(outbox, Change.Unlock("s", null))
            outbox.execute("DELETE FROM outbox WHERE eventId = '${gone.eventId}'")
            assertNull(record(outbox, Change.Refocus("s")).follows)
            // Not filed yet (B6b), it is filed where the refocus leaves the phone, in the refocus's own
            // write, which then returns from it and waits for it (#95's Claude Review).
            val press = record(outbox, Change.UnlockUnfiled(null))
            val refocus = record(outbox, Change.Refocus("s"), standing = Standing.InSession(session(), ParticipationState.Focused))
            assertEquals(press.eventId, refocus.follows)
            assertEquals(Change.Unlock("s", null), current(outbox, press.eventId)?.change)
        }

    @Test
    fun whereThePhoneStoodBeforeProtectionOffIsReadBeforeTheStandingTheReportLeavesIsKept(): Unit =
        runBlocking {
            // The engine records the report with the standing it leaves, protection off there (iOS's
            // `state.standing.acting(change)`; santa's review).
            val (outbox, _) = makeOutbox()
            val off = Standing.InSession(session(), ParticipationState.ProtectionOff)
            outbox.keep(Standing.InSession(session(), ParticipationState.Unlocked))
            record(outbox, Change.ProtectionOff("s"), standing = off)
            assertEquals(ParticipationState.Unlocked to off, outbox.offFrom() to outbox.standing())
        }

    @Test
    fun anUnlockWaitingForItsReasonIsDueItsHoldLaterAndWhateverThePhoneDoesNextSendsItAtOnce(): Unit =
        runBlocking {
            for (next in listOf(Change.Refocus("s"), Change.Tap("tag"), Change.ProtectionOff("s"), Change.Unlock("s", null))) {
                val (outbox, _) = makeOutbox()
                val press = record(outbox, Change.Unlock("s", null), hold = Duration.ofSeconds(10))
                assertEquals(listOf(t0, t0.plusSeconds(10)), listOf(press.recordedAt, press.nextAttemptAt), "$next")
                record(outbox, next, t0.plusSeconds(3))
                assertEquals(t0.plusSeconds(3), current(outbox, press.eventId)?.nextAttemptAt, "$next")
            }
            // A report not made, protection off already reported, changes nothing.
            val (outbox, _) = makeOutbox()
            record(outbox, Change.ProtectionOff("s"))
            val press = record(outbox, Change.Unlock("s", null), hold = Duration.ofSeconds(10))
            assertNull(outbox.record(Change.ProtectionOff("s"), t0.plusSeconds(3)))
            assertEquals(t0.plusSeconds(10), current(outbox, press.eventId)?.nextAttemptAt)
        }

    @Test
    fun releaseSendsNowAnUnlockHeldForItsReasonNeverOneSentAndBackingOffNorOneDueAlready(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            outbox.dao.insert(row("held", "unlock") { copy(sessionId = "s", nextAttemptAt = t0.plusSeconds(10)) })
            outbox.dao.insert(row("due", "unlock") { copy(sessionId = "s") })
            // Sent once with no answer, backing off: its backoff isn't cut short.
            outbox.dao.insert(row("sent", "unlock") { copy(sessionId = "s", attempts = 1, nextAttemptAt = t0.plusSeconds(4)) })
            outbox.dao.insert(row("late", "unlock") { copy(sessionId = "s", nextAttemptAt = t0.plusSeconds(1)) })
            // Made at a time the phone's clock has since been set back past: due when it was made.
            outbox.dao.insert(row("ahead", "unlock") { copy(sessionId = "s", recordedAt = t0.plusSeconds(5), nextAttemptAt = t0.plusSeconds(5)) })
            outbox.release(t0.plusSeconds(2))
            assertEquals(
                listOf(t0.plusSeconds(2), t0, t0.plusSeconds(4), t0.plusSeconds(1), t0.plusSeconds(5)),
                outbox.records().map { it.nextAttemptAt },
            )
        }

    @Test
    fun theReasonForTheLatestUnlockIsKeptInItsRecordWhileItHasNeverBeenSentWhichThenGoesAtOnceAnyOtherHeldUnlockWithIt(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            assertFalse(outbox.explain(UnlockReason.Nurse, t0, emptySet()))
            val hold = Duration.ofSeconds(10)
            val press = record(outbox, Change.UnlockUnderTap("tap", null), hold = hold)
            // Another held unlock, as a scan's press is beside its follow-up (B6d).
            outbox.dao.insert(row("other", "unlock") { copy(tapId = "tap", nextAttemptAt = t0.plusSeconds(10)) })
            assertTrue(outbox.explain(UnlockReason.Nurse, t0.plusSeconds(2), emptySet()))
            val explained = assertNotNull(current(outbox, press.eventId))
            assertEquals(Change.UnlockUnderTap("tap", UnlockReason.Nurse), explained.change)
            assertEquals(t0.plusSeconds(2), explained.nextAttemptAt)
            assertEquals(t0.plusSeconds(2), current(outbox, "other")?.nextAttemptAt)

            // Too late: on its way, sent once, or gone; nothing changes.
            val latest = record(outbox, Change.Unlock("s", null), hold = hold)
            assertFalse(outbox.explain(UnlockReason.Bathroom, t0, setOf(latest.eventId)))
            outbox.execute("UPDATE outbox SET attempts = 1 WHERE eventId = '${latest.eventId}'")
            assertFalse(outbox.explain(UnlockReason.Bathroom, t0, emptySet()))
            assertEquals(listOf(null, t0.plusSeconds(10)), current(outbox, latest.eventId).let { listOf(it?.change?.reason, it?.nextAttemptAt) })
            outbox.execute("DELETE FROM outbox WHERE eventId = '${latest.eventId}'")
            assertFalse(outbox.explain(UnlockReason.Bathroom, t0, emptySet()))
            assertEquals(UnlockReason.Nurse, current(outbox, press.eventId)?.change?.reason)
        }

    @Test
    fun theStandingIsKeptInTheWriteThatRecordsOrFilesAWriteTheFileRefusesKeepsNeither(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val focused = Standing.InSession(session(), ParticipationState.Focused)
            val unlocked = focused.copy(state = ParticipationState.Unlocked)
            outbox.keep(focused)
            outbox.execute("CREATE TRIGGER refuse BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'no'); END")
            assertFailsWith<SQLiteException> { outbox.record(Change.Unlock("s", null), t0, unlocked) }
            assertEquals(focused, outbox.standing())
            assertEquals(emptyList(), outbox.records())
            assertNull(outbox.state(Outbox.Key.LastUnlock))
            outbox.execute("DROP TRIGGER refuse")
            val unlock = record(outbox, Change.Unlock("s", null), standing = unlocked)
            assertEquals(unlocked, outbox.standing())
            assertEquals(listOf(unlock), outbox.records())

            // An unlock not filed yet, filed where the standing says, in the write that keeps it.
            val press = record(outbox, Change.UnlockUnfiled(null))
            outbox.execute("CREATE TRIGGER stay BEFORE UPDATE ON outbox BEGIN SELECT RAISE(ABORT, 'no'); END")
            assertFailsWith<SQLiteException> { outbox.file(Standing.InSession(session("t"), ParticipationState.Focused)) }
            assertEquals(unlocked, outbox.standing())
            assertEquals(Change.UnlockUnfiled(null), current(outbox, press.eventId)?.change)
        }

    @Test
    fun theNewestTapsEventIdIsKeptByEachTapsOwnWriteQueuedOrAnsweredAndGoneNoneBeforeOne(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            assertNull(outbox.lastTap())
            val first = record(outbox, Change.Tap("tag"))
            record(outbox, Change.Unlock("s", null))
            assertEquals(first.eventId, outbox.lastTap())
            val second = record(outbox, Change.Tap("tag"))
            outbox.execute("DELETE FROM outbox WHERE kind = 'tap'")
            outbox.close()
            assertEquals(second.eventId, open(file).lastTap())
        }

    @Test
    fun whereTheWaitForTheStartEndsIsKeptAsTheFileKeepsEveryTimeNoneBeforeOneOrForAValueThisBuildCannotRead(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            assertNull(outbox.waitEnds())
            val midnight = Instant.parse("2026-09-22T05:00:00Z")
            outbox.keepWaitEnds(midnight)
            assertEquals(midnight, outbox.waitEnds())
            outbox.keepWaitEnds(midnight.plusMillis(250))
            outbox.close()
            val reopened = open(file)
            assertEquals(midnight.plusMillis(250), reopened.waitEnds())
            assertEquals("2026-09-22 05:00:00.250", reopened.state(Outbox.Key.WaitEnds))
            // iOS's form, seconds since 1970, is no time here.
            reopened.setState(Outbox.Key.WaitEnds, "1790035200.0")
            assertNull(reopened.waitEnds())
        }
}
