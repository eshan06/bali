package com.bali.bali

import androidx.sqlite.SQLiteException
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.UnlockReason
import com.bali.outbox.Change
import com.bali.outbox.OutboxRecord
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The outbox's file inside the app, on Android's Room and the SQLite it bundles for the phone: what
 * outbox's JVM tests can't show, since they pass on Room's JVM build whether or not the app can open
 * the file (Gradle's pick of Room's Android build, the driver's native library, Room's generated code).
 */
@RunWith(AndroidJUnit4::class)
class OutboxFileTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    @After
    fun deleteTheFile() {
        context.deleteDatabase(OUTBOX_FILE)
    }

    @Test
    fun theOutboxIsMadeInTheAppsOwnStorageAndReadsBackWhatItsFileHolds(): Unit =
        runBlocking {
            // Made at its first open by Room's code, with the table's checks and the file's install.
            val outbox = context.outbox()
            assertEquals(emptyList<OutboxRecord>(), outbox.records())
            outbox.close()
            val file = context.getDatabasePath(OUTBOX_FILE)
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

            val reopened = context.outbox()
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
}
