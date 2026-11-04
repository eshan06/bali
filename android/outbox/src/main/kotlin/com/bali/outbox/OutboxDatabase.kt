package com.bali.outbox

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

// The outbox's file, BaliOutbox's migrator as Room's version 1: the table iOS's migrations leave,
// its checks included, and the rules' own state. Room's schema for each version is kept in
// outbox/schemas/, so a later version's migration is checked against the one it starts from.

/**
 * The file. The app builds it with Room's own builder, Android's, in the app's own storage; the tests
 * with Room's JVM one, in a folder of their own; either way [Outbox.open] makes it the outbox.
 */
@Database(entities = [OutboxRow::class, OutboxState::class], version = 1)
@TypeConverters(Times::class)
abstract class OutboxDatabase : RoomDatabase() {
    internal abstract fun dao(): OutboxDao
}

/**
 * One queued record's row, in the order the phone acted: [seq] is its place in what the phone did
 * (A12), never reused or lowered while the file lives (AUTOINCREMENT). An unlock names its session
 * or its tap ([tapId], decision 11), or neither until it is filed (B6b); a follow-up stands in its
 * press's place ([orderSeq], B6d).
 */
@Entity(tableName = "outbox", indices = [Index("eventId", unique = true)])
internal data class OutboxRow(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val eventId: String,
    val kind: String,
    val tagId: String? = null,
    val sessionId: String? = null,
    val tapId: String? = null,
    val reason: String? = null,
    val follows: String? = null,
    val recordedAt: Instant,
    @ColumnInfo(defaultValue = "0") val attempts: Int = 0,
    @ColumnInfo(defaultValue = "0") val answers: Int = 0,
    val nextAttemptAt: Instant,
    @ColumnInfo(defaultValue = "0") val stuck: Boolean = false,
    val lastStatus: Int? = null,
    val lastReason: String? = null,
    val lastMessage: String? = null,
    val orderSeq: Long? = null,
    val refusedStatus: Int? = null,
)

/** The rules' own state, under [Outbox.Key]'s keys. */
@Entity(tableName = "outboxState")
internal data class OutboxState(@PrimaryKey val key: String, val value: String)

/** A row with its file's install, what each request's order is made of: what a record is read from. */
internal data class QueuedRow(@Embedded val row: OutboxRow, val install: String?)

/** Every row's columns, with its file's install. */
internal const val SELECTION =
    "SELECT outbox.*, (SELECT value FROM outboxState WHERE key = '$INSTALL') AS install FROM outbox"

@Dao
internal interface OutboxDao {
    /** Everything queued, in the order the phone acted: a follow-up stands where its press does (B6d). */
    @Query("$SELECTION ORDER BY COALESCE(orderSeq, seq), seq")
    suspend fun records(): List<QueuedRow>

    @Insert
    suspend fun insert(row: OutboxRow): Long

    @Query("SELECT value FROM outboxState WHERE key = :key")
    suspend fun state(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun keep(state: OutboxState)

    @Query("DELETE FROM outboxState WHERE key = :key")
    suspend fun forget(key: String)
}

/**
 * A time as GRDB keeps a `Date`: in UTC, to the millisecond, as text whose order is the times'. So
 * a time compared in SQL compares as the times do, as on iOS.
 */
internal class Times {
    @TypeConverter
    fun text(time: Instant): String = FORMAT.format(time)

    @TypeConverter
    fun time(text: String): Instant = FORMAT.parse(text, Instant::from)

    private companion object {
        val FORMAT: DateTimeFormatter =
            DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss.SSS", Locale.ROOT).withZone(ZoneOffset.UTC)
    }
}

/**
 * The file's first open, in the transaction that makes it: the table made again with the checks iOS's
 * has, which Room can't declare, and the file's install minted, once.
 */
internal object Created : RoomDatabase.Callback() {
    override fun onCreate(connection: SQLiteConnection) {
        // The checks refuse a row its kind could not send. Room reads a table's columns and indexes,
        // never its checks, so these columns and this index are Room's own (OutboxRow), and a
        // migration that makes the table again carries the checks, as iOS's v3, v4 and v6 do.
        connection.execSQL("DROP TABLE outbox")
        connection.execSQL(
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
            """,
        )
        connection.execSQL("CREATE UNIQUE INDEX index_outbox_eventId ON outbox (eventId)")
        // The install names this file's counter (A12): a reinstall's file starts again at 1 under an
        // install of its own, so the server never compares the two.
        connection.prepare("INSERT INTO outboxState (key, value) VALUES (?, ?)").use {
            it.bindText(1, INSTALL)
            it.bindText(2, UUID.randomUUID().toString().lowercase())
            it.step()
        }
    }
}
