package com.bali.outbox

import androidx.room.Room
import androidx.room.execSQL
import androidx.room.useReaderConnection
import androidx.room.useWriterConnection
import androidx.sqlite.SQLiteException
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.bali.core.ActionOrder
import com.bali.core.ApiErrorReason
import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.io.File
import java.time.Instant
import kotlin.io.path.createTempDirectory
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/**
 * Each test's files, in a folder of its own, deleted once the test is over and every outbox it
 * opened is closed: BaliOutbox's tests' `makeOutbox`, `open` and `temporaryFile`.
 */
abstract class OutboxFiles {
    private val folder = createTempDirectory("BaliOutboxTests").toFile()
    private val opened = mutableListOf<Outbox>()

    /** A new file's path, in a folder of its own. */
    fun temporaryFile(): File = createTempDirectory(folder.toPath(), "outbox").toFile().resolve("outbox.sqlite")

    /** The outbox in [file], opened as the app opens it, through Room's JVM builder. */
    fun open(file: File): Outbox = Outbox.open(Room.databaseBuilder<OutboxDatabase>(file.path)).also { opened += it }

    fun makeOutbox(): Pair<Outbox, File> = temporaryFile().let { open(it) to it }

    @AfterTest
    fun deleteFiles() {
        opened.forEach { it.close() }
        folder.deleteRecursively()
    }
}

/** [sql] run on the outbox's own file, as iOS's tests write through `outbox.pool`. */
suspend fun Outbox.execute(sql: String) = file.useWriterConnection { it.execSQL(sql) }

/** The first column of each row [sql] reads from the outbox's own file, as text. */
suspend fun Outbox.texts(sql: String): List<String?> =
    file.useReaderConnection { connection ->
        connection.usePrepared(sql) { row -> buildList { while (row.step()) add(if (row.isNull(0)) null else row.getText(0)) } }
    }

/** The install the outbox's file was given (A12). */
suspend fun Outbox.install(): String? = state(Outbox.Key.Install)

/** A row of [kind], due at [t0], as the store queues one; [changed] changes it. */
internal fun row(eventId: String, kind: String, changed: OutboxRow.() -> OutboxRow = { this }) =
    OutboxRow(eventId = eventId, kind = kind, recordedAt = t0, nextAttemptAt = t0).changed()

/** A lower-case UUID, the install's form. */
val lowerCaseUuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

/**
 * The outbox's file: OutboxTests' SchemaTests, their parts no rule holds, and `offFrom`, which
 * `record` holds. AN4e's: `reopens`' records sent and protection off reported once, and
 * `migratesEmpty`'s `nextDue` and `awaiting`.
 */
class SchemaTest : OutboxFiles() {
    @Test
    fun anEmptyFileIsMadeToTheSchemaAndHoldsNothing(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            assertEquals(emptyList(), outbox.records())
            // Room's version 1, as every migration of iOS's file is applied: Android's first file.
            assertEquals(listOf("1"), outbox.texts("PRAGMA user_version"))
            assertEquals(
                listOf(
                    "seq", "eventId", "kind", "tagId", "sessionId", "tapId", "reason", "follows", "recordedAt",
                    "attempts", "answers", "nextAttemptAt", "stuck", "lastStatus", "lastReason", "lastMessage",
                    "orderSeq", "refusedStatus",
                ),
                outbox.texts("SELECT name FROM pragma_table_info('outbox')"),
            )
            assertEquals(listOf("key", "value"), outbox.texts("SELECT name FROM pragma_table_info('outboxState')"))
        }

    @Test
    fun whatIsQueuedOutlivesTheProcessReopenedTheFileHoldsItAllAndTheRulesState(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            outbox.dao.insert(row("u", "unlock") { copy(sessionId = "s", reason = "nurse", attempts = 1, lastStatus = 409) })
            outbox.dao.insert(row("r", "refocus") { copy(sessionId = "s", follows = "u") })
            outbox.setState(Outbox.Key.Reported, "s")
            val records = outbox.records()
            outbox.close()

            val reopened = open(file)
            assertEquals(records, reopened.records())
            assertEquals(2, records.size)
            assertEquals("s", reopened.state(Outbox.Key.Reported))
            assertEquals(listOf("1"), reopened.texts("PRAGMA user_version"))
        }

    @Test
    fun theSchemaRefusesARowItsKindCouldNotSend(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val insert = "INSERT INTO outbox (eventId, kind, tagId, sessionId, tapId, recordedAt, nextAttemptAt, orderSeq)"
            for (values in listOf(
                "('a', 'tap', NULL, NULL, NULL, 0, 0, NULL)", // a tap with no tag
                "('b', 'tap', 'tag', 's', NULL, 0, 0, NULL)", // a tap with a session
                "('d', 'refocus', 'tag', 's', NULL, 0, 0, NULL)", // a refocus with a tag
                "('e', 'checkin', NULL, 's', NULL, 0, 0, NULL)", // not an outbox kind
                "('f', 'tap', 'tag', NULL, 't', 0, 0, NULL)", // a tap filed under a tap
                "('g', 'refocus', NULL, 's', 't', 0, 0, NULL)", // a refocus filed under a tap
                "('h', 'protection_off', NULL, NULL, 't', 0, 0, NULL)", // protection off, no session
                "('k', 'refocus', NULL, 's', NULL, 0, 0, 1)", // a refocus in another's place
                "('m', 'protection_on', NULL, NULL, NULL, 0, 0, NULL)", // back on, no session
                "('n', 'protection_on', NULL, 's', 't', 0, 0, NULL)", // back on, under a tap
            )) {
                val refused = assertFailsWith<SQLiteException>(values) { outbox.execute("$insert VALUES $values") }
                assertContains(refused.message.orEmpty(), "CHECK constraint failed", message = values)
            }
            // An unlock filed under its tap (decision 11): no session until the tap's answer.
            outbox.execute("$insert VALUES ('i', 'unlock', NULL, NULL, 't', 0, 0, NULL)")
            outbox.execute("$insert VALUES ('j', 'unlock', NULL, 's', 't', 0, 0, NULL)")
            // One made where the phone stood unread: neither, until it is filed (B6b).
            outbox.execute("$insert VALUES ('c', 'unlock', NULL, NULL, NULL, 0, 0, NULL)")
            // A follow-up, in its press's place (B6d).
            outbox.execute("$insert VALUES ('l', 'unlock', NULL, 's', NULL, 0, 0, 1)")
            // Each event id once (rule 4).
            val again = assertFailsWith<SQLiteException> { outbox.execute("$insert VALUES ('i', 'unlock', NULL, 's', NULL, 0, 0, NULL)") }
            assertContains(again.message.orEmpty(), "UNIQUE constraint failed")
        }

    @Test
    fun theTableIsVersion1sChecksIncludedAsEveryFileMadeAtVersion1HasIt(): Unit =
        runBlocking {
            // Room's schema (schemas/) holds the columns, never the checks, so this copy holds the
            // table as files on phones have it: a change to it comes with a new version and a
            // migration that makes the table again, never alone.
            val version1 =
                """
                CREATE TABLE outbox (
                  seq INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, eventId TEXT NOT NULL,
                  kind TEXT NOT NULL CHECK (kind IN
                    ('tap', 'unlock', 'refocus', 'protection_off', 'protection_on')),
                  tagId TEXT CHECK ((kind = 'tap') = (tagId IS NOT NULL)),
                  sessionId TEXT
                    CHECK (kind = 'unlock' OR (kind = 'tap') = (sessionId IS NULL)),
                  tapId TEXT CHECK (tapId IS NULL OR kind = 'unlock'),
                  reason TEXT, follows TEXT, recordedAt TEXT NOT NULL,
                  attempts INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0,
                  nextAttemptAt TEXT NOT NULL, stuck INTEGER NOT NULL DEFAULT 0,
                  lastStatus INTEGER, lastReason TEXT, lastMessage TEXT,
                  orderSeq INTEGER CHECK (orderSeq IS NULL OR kind = 'unlock'),
                  refusedStatus INTEGER)
                """
            val (outbox, _) = makeOutbox()
            val words = Regex("\\s+")
            assertEquals(
                version1.trim().replace(words, " "),
                outbox.texts("SELECT sql FROM sqlite_master WHERE name = 'outbox'").single()?.trim()?.replace(words, " "),
            )
        }

    @Test
    fun roomReadsTheTableItsChecksAreMadeOnAsItsOwn(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            outbox.dao.insert(row("t", "tap") { copy(tagId = "tag") })
            outbox.close()
            // With no mark of Room's on it, Room checks the file's every table against its own before it
            // opens it, as it does after a migration, and refuses one whose columns or indexes differ.
            BundledSQLiteDriver().open(file.path).use { it.execSQL("DROP TABLE room_master_table") }
            assertEquals(listOf("t"), open(file).records().map { it.eventId })
        }

    @Test
    fun aFileANewerBuildMadeIsRefusedNeverReadThroughASchemaThisOneDoesNotKnowNorWiped(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            outbox.dao.insert(row("u", "unlock") { copy(sessionId = "s") })
            outbox.close()
            BundledSQLiteDriver().open(file.path).use { it.execSQL("PRAGMA user_version = 2") }

            // Room leaves open the connection it refused, so on Windows this test's folder stays behind.
            val refused = assertFailsWith<IllegalStateException> { open(file).records() }
            assertContains(refused.message.orEmpty(), "migration from 2 to 1")
            BundledSQLiteDriver().open(file.path).use { sqlite ->
                sqlite.prepare("SELECT eventId FROM outbox").use { assertEquals(true, it.step()); assertEquals("u", it.getText(0)) }
            }
        }

    @Test
    fun protectionOffKeepsWhereThePhoneStoodBeforeItWhichTheLockBackOnReturnsToTheNextReportWritesItAnewATapForgetsIt(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            for ((before, kept) in listOf(ParticipationState.Unlocked to ParticipationState.Unlocked, ParticipationState.Focused to ParticipationState.Focused)) {
                outbox.keep(Standing.InSession(session(), before))
                record(outbox, Change.ProtectionOff("s"))
                assertEquals(kept to "s", outbox.offFrom() to outbox.reportedOff())
                // Kept for a back on made again (santa's round 1).
                record(outbox, Change.ProtectionOn("s"))
                assertEquals(kept to null, outbox.offFrom() to outbox.reportedOff())
            }
            // An Emergency Unlock since, the latest turn the server records, under protection off
            // too, is where a back on made again returns (santa's round 2).
            record(outbox, Change.Unlock("s", null))
            assertEquals(ParticipationState.Unlocked, outbox.offFrom())
            // Standing in protection off already, or in another session, nothing new is known:
            // reported again from protection off, it keeps the first (#167).
            outbox.keep(Standing.InSession(session(), ParticipationState.Unlocked))
            record(outbox, Change.ProtectionOff("s"))
            outbox.keep(Standing.InSession(session(), ParticipationState.ProtectionOff))
            outbox.protectionRestored()
            record(outbox, Change.ProtectionOff("s"))
            assertEquals(ParticipationState.Unlocked, outbox.offFrom())
            record(outbox, Change.Tap("tag"))
            assertNull(outbox.offFrom())
            outbox.keep(Standing.InSession(session("t"), ParticipationState.Unlocked))
            record(outbox, Change.ProtectionOff("s"))
            assertNull(outbox.offFrom())
        }
}

/**
 * The conductor's call (`docs/DECISIONS.md`, 2026-11-04, AN4d): each write reaches the disk as it
 * commits, `synchronous = FULL`, the file kept in WAL, though Room opens every connection at NORMAL.
 */
class DurabilityTest : OutboxFiles() {
    @Test
    fun everyWriteGoesThroughTheConnectionThatWritesAtFullWhereRoomOpensItAtNormalTheFileStillInWal(): Unit =
        runBlocking {
            val writes: List<Pair<String, suspend (Outbox) -> Unit>> =
                listOf(
                    "record" to { it.record(Change.Tap("tag"), t0) },
                    "release" to { it.release(t0) },
                    "explain" to { it.explain(UnlockReason.Nurse, t0, emptySet()) },
                    "protectionRestored" to { it.protectionRestored() },
                    "keep" to { it.keep(Standing.Waiting) },
                    "file" to { it.file(Standing.Waiting) },
                    "keepWaitEnds" to { it.keepWaitEnds(t0) },
                    "setState" to { it.setState(Outbox.Key.LastTap, "t") },
                )
            for ((name, write) in writes) {
                val (outbox, file) = makeOutbox()
                assertEquals(1L, outbox.synchronous(), name)
                write(outbox)
                assertEquals(2L, outbox.synchronous(), name)
                assertEquals(listOf("wal"), outbox.texts("PRAGMA journal_mode"), name)
                // Reopened, Room's connection starts at NORMAL again, until the next write.
                outbox.close()
                val reopened = open(file)
                assertEquals(1L, reopened.synchronous(), name)
                write(reopened)
                assertEquals(2L, reopened.synchronous(), name)
            }
        }

    @Test
    fun aWriteCommitsAtFullFromTheConnectionsFirstWriteSetBeforeItsTransactionBegins(): Unit =
        runBlocking {
            // The level the record's insert ran at, read inside its write by a trigger: one set
            // after the transaction would leave a connection's first write at NORMAL (santa's review).
            val (outbox, _) = makeOutbox()
            outbox.execute(
                "CREATE TRIGGER level AFTER INSERT ON outbox BEGIN INSERT OR REPLACE INTO outboxState (key, value) " +
                    "VALUES ('level', (SELECT synchronous FROM pragma_synchronous)); END",
            )
            assertEquals(1L, outbox.synchronous())
            record(outbox, Change.Tap("tag"))
            assertEquals(listOf("2"), outbox.texts("SELECT value FROM outboxState WHERE key = 'level'"))
        }
}

/** The phone's own order (A12): OutboxTests' ActionOrderTests, their parts no rule holds (AN4d's hold the rest). */
class ActionOrderTest : OutboxFiles() {
    @Test
    fun eachFileIsGivenItsInstallOnceALowerCaseUuidTheSameEveryTimeItOpensAnotherFilesItsOwn(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            val install = assertNotNull(outbox.install())
            assertTrue(lowerCaseUuid.matches(install), install)
            outbox.close()
            assertEquals(install, open(file).install())
            assertNotEquals(install, makeOutbox().first.install())
        }

    @Test
    fun eachRecordGoesWithItsOwnSeqNeverReusedNorLoweredWhileTheFileLivesItsRowsAnsweredAndGoneOrNot(): Unit =
        runBlocking {
            val (outbox, file) = makeOutbox()
            val install = assertNotNull(outbox.install())
            for (id in listOf("a", "b", "c")) outbox.dao.insert(row(id, "unlock") { copy(sessionId = "s") })
            assertEquals((1L..3L).map { ActionOrder(install, it) }, outbox.records().map { it.order })
            // Every record answered and gone: what the phone does next still comes after everything it did.
            outbox.execute("DELETE FROM outbox")
            assertEquals(4L, outbox.dao.insert(row("d", "tap") { copy(tagId = "tag") }))
            outbox.close()
            val reopened = open(file)
            assertEquals(5L, reopened.dao.insert(row("e", "tap") { copy(tagId = "tag") }))
            assertEquals(listOf(ActionOrder(install, 4), ActionOrder(install, 5)), reopened.records().map { it.order })
        }
}

/** Each record read from its row, GRDB's `init(row:)`, and the rules' state kept by key. */
class OutboxRowTest : OutboxFiles() {
    @Test
    fun eachRowIsReadAsTheChangeItsKindAndColumnsSayWithEveryColumnItKeeps(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            val rows =
                listOf(
                    row("tap", "tap") { copy(tagId = "04:A2:1B") },
                    row("unlock", "unlock") { copy(sessionId = "s", reason = "bathroom") },
                    // Filed under its tap, it stays so once the tap's answer names a session (decision 11).
                    row("underTap", "unlock") { copy(tapId = "t", reason = "nurse") },
                    row("underTapInSession", "unlock") { copy(tapId = "t", sessionId = "s") },
                    // Filed under neither, it waits to be (B6b); a reason this build doesn't know is none.
                    row("unfiled", "unlock") { copy(reason = "hall_pass") },
                    row("refocus", "refocus") { copy(sessionId = "s", follows = "unlock") },
                    row("off", "protection_off") { copy(sessionId = "s") },
                    row("on", "protection_on") { copy(sessionId = "s") },
                )
            rows.forEach { outbox.dao.insert(it) }
            val records = outbox.records()
            assertEquals(
                listOf(
                    Change.Tap("04:A2:1B"), Change.Unlock("s", UnlockReason.Bathroom),
                    Change.UnlockUnderTap("t", UnlockReason.Nurse), Change.UnlockUnderTap("t", null),
                    Change.UnlockUnfiled(null), Change.Refocus("s"), Change.ProtectionOff("s"), Change.ProtectionOn("s"),
                ),
                records.map { it.change },
            )
            assertEquals(rows.map { it.eventId }, records.map { it.eventId })
            assertEquals(listOf(null, null, null, null, null, "unlock", null, null), records.map { it.follows })
            val install = assertNotNull(outbox.install())
            assertEquals((1L..8L).map { ActionOrder(install, it) }, records.map { it.order })

            // An answer's columns, and a refusal's, read back as kept; an error reason this build
            // doesn't know is none.
            val later = t0.plusMillis(2_500)
            outbox.dao.insert(
                row("kept", "tap") {
                    copy(
                        tagId = "tag", attempts = 9, answers = 8, nextAttemptAt = later, stuck = true, lastStatus = 503,
                        lastReason = "session_not_running", lastMessage = "no", refusedStatus = 404,
                    )
                },
            )
            outbox.dao.insert(row("unknownReason", "tap") { copy(tagId = "tag", lastReason = "overtaken") })
            val (kept, unknownReason) = outbox.records().takeLast(2)
            assertEquals(
                queued(Change.Tap("tag"), t0, ActionOrder(install, 9)).copy(
                    eventId = "kept", attempts = 9, answers = 8, nextAttemptAt = later, stuck = true, lastStatus = 503,
                    lastReason = ApiErrorReason.SessionNotRunning, lastMessage = "no", refusedStatus = 404,
                ),
                kept,
            )
            assertNull(unknownReason.lastReason)
        }

    @Test
    fun aFollowUpGoesWithItsPresssOrderAndStandsWhereItsPressDoes(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            outbox.dao.insert(row("press", "unlock") { copy(tapId = "t", reason = "nurse") })
            outbox.dao.insert(row("refocus", "refocus") { copy(sessionId = "s") })
            outbox.dao.insert(row("followUp", "unlock") { copy(sessionId = "s", reason = "nurse", orderSeq = 1) })
            val install = assertNotNull(outbox.install())
            val records = outbox.records()
            assertEquals(listOf("press", "followUp", "refocus"), records.map { it.eventId })
            assertEquals(listOf(1L, 1L, 2L).map { ActionOrder(install, it) }, records.map { it.order })
        }

    @Test
    fun aFileWithNoInstallReadsItsRecordsWithNoOrderRatherThanNotAtAll(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            outbox.dao.insert(row("tap", "tap") { copy(tagId = "tag") })
            outbox.setState(Outbox.Key.Install, null)
            assertNull(outbox.records().single().order)
        }

    @Test
    fun aKindThisBuildDoesNotKnowIsRefusedNeverReadAsAnother() {
        // The table's check refuses such a row (SchemaTest); a newer build's file, which could hold
        // one, is refused before it is read.
        val refused = assertFailsWith<UnknownKind> { QueuedRow(row("e", "checkin") { copy(sessionId = "s") }, "i").record() }
        assertEquals("checkin", refused.kind)
    }

    @Test
    fun eachKeyOfTheRulesStateIsKeptReplacedAndForgottenUnderItsNameOnIos(): Unit =
        runBlocking {
            // The names are the file's, so a later build reads what an earlier one kept.
            assertEquals(
                listOf("protectionOffReported", "protectionOffFrom", "lastUnlock", "install", "standing", "lastTap", "waitEnds"),
                Outbox.Key.entries.map { it.key },
            )
            val (outbox, file) = makeOutbox()
            for (key in Outbox.Key.entries) {
                outbox.setState(key, "a")
                outbox.setState(key, "b")
            }
            outbox.setState(Outbox.Key.LastTap, null)
            outbox.close()
            val reopened = open(file)
            assertEquals(Outbox.Key.entries.map { if (it == Outbox.Key.LastTap) null else "b" }, Outbox.Key.entries.map { reopened.state(it) })
        }

    @Test
    fun aTimeIsKeptAsGrdbKeepsADateInUtcToTheMillisecondAsTextThatSortsAsTheTimesDo() {
        val times = Times()
        assertEquals("2026-09-21 14:13:20.000", times.text(t0))
        assertEquals("2026-09-21 14:13:20.250", times.text(t0.plusNanos(250_999_999)))
        assertEquals(t0.plusMillis(250), times.time("2026-09-21 14:13:20.250"))
        val sorted = listOf(t0.plusMillis(999), t0.minusSeconds(86_400 * 400L), t0.plusSeconds(1), t0)
        assertEquals(sorted.sorted().map(times::text), sorted.map(times::text).sorted())
        assertEquals(Instant.EPOCH, times.time(times.text(Instant.EPOCH)))
    }
}
