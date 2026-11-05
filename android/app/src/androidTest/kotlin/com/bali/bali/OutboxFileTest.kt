package com.bali.bali

import android.content.pm.ApplicationInfo
import androidx.sqlite.SQLiteException
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.ApiClient
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.TokenProvider
import com.bali.core.UnlockDisposition
import com.bali.core.UnlockReason
import com.bali.outbox.Change
import com.bali.outbox.Disposition
import com.bali.outbox.Outbox
import com.bali.outbox.OutboxRecord
import com.bali.outbox.Standing
import java.io.IOException
import java.net.URI
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.xmlpull.v1.XmlPullParser

/**
 * The outbox's file inside the app, on Android's Room and the SQLite it bundles for the phone: what
 * outbox's JVM tests can't show, since they pass on Room's JVM build whether or not the app can open
 * the file (Gradle's pick of Room's Android build, the driver's native library, Room's generated code).
 * That the store's writes reach the disk as they commit, on Android's Room as on the JVM's (AN4d), and
 * that a send's answer settles through it (AN4e). And the backup rules that keep the file on the phone.
 * Over a file of its own: the app's, [OUTBOX_FILE], is its engine's, which a Debug build's start opens in
 * the tests' process too and never closes (AN7d), so no test deletes or opens it under that engine.
 */
@RunWith(AndroidJUnit4::class)
class OutboxFileTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    @After
    fun deleteTheFile() {
        context.deleteDatabase(FILE)
    }

    @Test
    fun theOutboxIsMadeInTheAppsOwnStorageAndReadsBackWhatItsFileHolds(): Unit =
        runBlocking {
            // Made at its first open by Room's code, with the table's checks and the file's install.
            val outbox = context.outbox(FILE)
            assertEquals(emptyList<OutboxRecord>(), outbox.records())
            outbox.close()
            val file = context.getDatabasePath(FILE)
            assertTrue(file.path, file.path.startsWith(context.dataDir.path + "/"))

            BundledSQLiteDriver().open(file.path).use { sqlite ->
                sqlite.execSQL(
                    "INSERT INTO outbox (eventId, kind, tapId, reason, recordedAt, nextAttemptAt) " +
                        "VALUES ('e', 'unlock', 't', 'nurse', '2026-09-21 14:13:20.000', '2026-09-21 14:13:21.500')",
                )
                val refused =
                    assertThrows(SQLiteException::class.java) {
                        sqlite.execSQL(
                            "INSERT INTO outbox (eventId, kind, sessionId, recordedAt, nextAttemptAt) " +
                                "VALUES ('f', 'checkin', 's', '', '')",
                        )
                    }
                assertTrue(refused.message, refused.message.orEmpty().contains("CHECK constraint failed"))
            }

            val reopened = context.outbox(FILE)
            val record = reopened.records().single()
            reopened.close()
            assertEquals(Change.UnlockUnderTap("t", UnlockReason.Nurse), record.change)
            assertEquals(Instant.ofEpochSecond(1_790_000_000), record.recordedAt)
            assertEquals(Instant.ofEpochSecond(1_790_000_001, 500_000_000), record.nextAttemptAt)
            // Sent with its place in what the phone did: the file's install, minted once, and its seq.
            val order = (record.request as OutboxRecord.Request.UnlockUnderTap).body.order
            assertEquals(1L, order?.seq)
            val install = order?.install.orEmpty()
            assertTrue(install, install.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
        }

    @Test
    fun whatThePhoneDidIsRecordedThroughTheStoreEachWriteSyncedToTheDiskAsItCommitsTheFileKeptInWal(): Unit =
        runBlocking {
            val at = Instant.ofEpochSecond(1_790_000_000)
            val outbox = context.outbox(FILE)
            // Room opens its connections at NORMAL (1); each of the outbox's writes sets FULL (2) first.
            assertEquals(1L, outbox.synchronous())
            val tap = checkNotNull(outbox.record(Change.Tap("04:A2:1B"), at))
            val stood = Standing.InSession(SessionView("s", "c", at.plusSeconds(3000)), ParticipationState.Unlocked)
            val press = checkNotNull(outbox.record(Change.UnlockUnderTap(tap.eventId, null), at, stood, Duration.ofSeconds(10)))
            assertEquals(2L, outbox.synchronous())
            assertTrue(outbox.explain(UnlockReason.Nurse, at.plusSeconds(2), emptySet()))
            outbox.close()
            BundledSQLiteDriver().open(context.getDatabasePath(FILE).path).use { sqlite ->
                sqlite.prepare("PRAGMA journal_mode").use { assertTrue(it.step()); assertEquals("wal", it.getText(0)) }
            }

            val reopened = context.outbox(FILE)
            val records = reopened.records()
            val standing = reopened.standing()
            reopened.close()
            assertEquals(listOf(tap.eventId, press.eventId), records.map { it.eventId })
            assertEquals(Change.UnlockUnderTap(tap.eventId, UnlockReason.Nurse), records[1].change)
            assertEquals(at.plusSeconds(2), records[1].nextAttemptAt)
            assertEquals(stood, standing)
        }

    @Test
    fun aRecordSentIsSettledThroughTheStoreKeptWithItsAnswerAndItsBackoffThenGoneOnceRecorded(): Unit =
        runBlocking {
            val at = Instant.ofEpochSecond(1_790_000_000)
            val outbox = context.outbox(FILE)
            val unlock = checkNotNull(outbox.record(Change.Unlock("s", UnlockReason.Nurse), at))
            outbox.close()
            // Reopened, Room's writer is at NORMAL again, so the settle's own write sets FULL.
            val sending = context.outbox(FILE)
            assertEquals(1L, sending.synchronous())
            assertEquals(Outbox.Due.Send(unlock), sending.nextDue(at))
            // No answer: kept, due after 2 s and up to as much again, at random, as the app's jitter.
            val unanswered = checkNotNull(unlock.send(client(null)))
            assertEquals(Disposition.Unlock(UnlockDisposition.Retry), sending.settle(unanswered, at))
            assertEquals(2L, sending.synchronous())
            sending.close()

            val reopened = context.outbox(FILE)
            val kept = reopened.records().single()
            assertEquals(listOf(1, 0), listOf(kept.attempts, kept.answers))
            assertTrue("${kept.nextAttemptAt}", kept.nextAttemptAt in at.plusSeconds(2)..at.plusSeconds(4))
            assertEquals(Outbox.Due.Wait(kept.nextAttemptAt), reopened.nextDue(at))
            // Recorded, it goes.
            val recorded = """{"outcome":"recorded","recordedAs":"no_live_participation","state":null,"session":null,"reason":null}"""
            val answered = checkNotNull(kept.send(client(200, recorded)))
            assertEquals(Disposition.Unlock(UnlockDisposition.Recorded), reopened.settle(answered, kept.nextAttemptAt))
            reopened.close()
            val drained = context.outbox(FILE)
            assertEquals(emptyList<OutboxRecord>(), drained.records())
            assertEquals(Outbox.Due.Idle, drained.nextDue(kept.nextAttemptAt))
            drained.close()
        }

    /** The real client, over a transport answering every request with [status] and [body], or with no answer when [status] is none. */
    private fun client(status: Int?, body: String = "") =
        ApiClient(
            URI("https://api.bali.test"),
            object : TokenProvider {
                override suspend fun accessToken() = "token"
            },
            object : HttpTransport {
                override suspend fun send(request: HttpRequest) =
                    HttpAnswer(status ?: throw IOException("no answer"), emptyMap(), body.encodeToByteArray())
            },
        )

    // Lint fails a manifest that drops either rules file (DataExtractionRules, UnusedResources); this
    // holds what they say, and allowBackup, which lint doesn't hold.
    @Test
    fun nothingOfBalisGoesIntoABackupOrATransferToANewPhone() {
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
        val every =
            setOf(
                "root", "file", "database", "sharedpref", "external",
                "device_root", "device_file", "device_database", "device_sharedpref",
            )
        assertEquals(mapOf("cloud-backup" to every, "device-transfer" to every), leftOut(R.xml.data_extraction_rules))
        assertEquals(mapOf("full-backup-content" to every), leftOut(R.xml.backup_rules))
    }

    /** The domains each section of the rules in [xml] leaves out whole; an include fails. */
    private fun leftOut(xml: Int): Map<String, Set<String>> {
        val sections = mutableMapOf<String, MutableSet<String>>()
        var section = ""
        context.resources.getXml(xml).use { rules ->
            while (rules.next() != XmlPullParser.END_DOCUMENT) {
                if (rules.eventType != XmlPullParser.START_TAG) continue
                when (rules.name) {
                    "exclude" -> {
                        assertEquals(rules.positionDescription, ".", rules.getAttributeValue(null, "path"))
                        sections.getValue(section) += rules.getAttributeValue(null, "domain")
                    }
                    "include" -> fail("Something is backed up: ${rules.positionDescription}")
                    else -> section = rules.name.also { sections[it] = mutableSetOf() }
                }
            }
        }
        return sections.filterValues { it.isNotEmpty() }
    }

    private companion object {
        const val FILE = "outbox-file-test.sqlite"
    }
}
