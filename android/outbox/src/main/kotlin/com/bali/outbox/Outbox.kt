package com.bali.outbox

import androidx.room.PooledConnection
import androidx.room.RoomDatabase
import androidx.room.deferredTransaction
import androidx.room.execSQL
import androidx.room.immediateTransaction
import androidx.room.useReaderConnection
import androidx.room.useWriterConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import com.bali.core.EventId
import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The phone's outbox, BaliOutbox's `Outbox`: each tap, Emergency Unlock, refocus and protection-off
 * report it acted on, kept until an answer lets it go. Its file is Room's, in the app's own storage,
 * which only Bali opens, so it needs none of the app group's coordination iOS's file has (one app,
 * no extensions: ARCHITECTURE, "Android app structure", decision 3). Here are the rules that record
 * what the phone did (AN4d); those that send it and settle its answers are AN4e's.
 *
 * Each write is one transaction, all or nothing, and reaches the disk before it returns: Room keeps
 * the file in WAL at `synchronous = NORMAL`, under which the phone losing power in the seconds after
 * a write can undo it, so every write sets FULL first (`docs/DECISIONS.md`, 2026-11-04, AN4d): an
 * Emergency Unlock's record is never discarded. Unlike iOS's, a write is cancelled with its caller:
 * undone before it commits, or, after, kept with the caller hearing only the cancel; so the sync
 * engine (AN5) writes where no screen can cancel it.
 */
class Outbox private constructor(internal val file: OutboxDatabase) : AutoCloseable {
    internal val dao = file.dao()
    private val times = Times()

    /**
     * Queues what the phone just did under a fresh event id, due at once, and keeps [standing], where
     * it leaves the phone, in the same write: a relaunch never finds the one without the other. A tap
     * or an unlock supersedes every queued refocus (deleted, never sent: it could only make the truth
     * older). Protection off is reported once per revocation, none when already reported in this
     * session, and again after a tap, which returns the row to focused, the lock back on (#167), or
     * [protectionRestored]; with it, where the phone stood there before it ([offFrom]), which the lock
     * back on returns to: kept until a tap or the next report, so a back on made again returns there
     * too, and unlocked by an Emergency Unlock since. An unlock waiting for its reason is due [hold]
     * later (C5a), and whatever the phone does next sends one at once: the student has moved on.
     * [standing] is never [Standing.Unread], whose keeping throws and undoes the write, the change with
     * it: the engine passes none for it, as iOS's does.
     */
    suspend fun record(change: Change, now: Instant, standing: Standing? = null, hold: Duration = Duration.ZERO): OutboxRecord? =
        write { db ->
            if (change is Change.ProtectionOff && db.value(Key.Reported) == change.session) return@write null
            db.release(now)
            // Where the phone stood before protection off, read before this record's standing is
            // kept: its own changes there, as the server's latest turn says (#167). One the file
            // won't give back is none, never a record refused.
            val before =
                try {
                    db.standing()
                } catch (_: IllegalArgumentException) {
                    null
                }
            // Kept as `file` keeps it, before what this does: an unlock not filed yet (a filing that
            // failed, say) goes where the phone stood, or under the last tap before this.
            if (standing != null) db.file(standing)
            val eventId = EventId.mint(now)

            fun queued(kind: String, session: String? = null, tagId: String? = null, tapId: String? = null, follows: String? = null) =
                OutboxRow(
                    eventId = eventId, kind = kind, tagId = tagId, sessionId = session, tapId = tapId,
                    reason = change.reason?.wire, follows = follows, recordedAt = now, nextAttemptAt = now + hold,
                )
            if (change is Change.Tap || change.isUnlock) db.step("DELETE FROM outbox WHERE kind = 'refocus'")
            val row =
                when (change) {
                    is Change.Tap -> {
                        db.setValue(Key.Reported, null)
                        db.setValue(Key.OffFrom, null)
                        db.setValue(Key.LastTap, eventId)
                        queued("tap", tagId = change.tagId)
                    }
                    is Change.Unlock -> queued("unlock", change.session)
                    // It guards the session the phone stood in, which the standing it leaves names,
                    // until its tap's answer names another: one naming none leaves it that one.
                    is Change.UnlockUnderTap -> queued("unlock", standing?.sessionId, tapId = change.tap)
                    is Change.UnlockUnfiled -> queued("unlock")
                    // The unlock it returns from, the latest, while it is queued: in this session, or
                    // under a tap whose answer names none yet.
                    is Change.Refocus -> {
                        val follows =
                            db.text(
                                "SELECT eventId FROM outbox WHERE eventId = ? " +
                                    "AND (sessionId = ? OR (tapId IS NOT NULL AND sessionId IS NULL))",
                                db.value(Key.LastUnlock), change.session,
                            )
                        queued("refocus", change.session, follows = follows)
                    }
                    is Change.ProtectionOff -> {
                        db.setValue(Key.Reported, change.session)
                        val stood = (before as? Standing.InSession)?.takeIf { it.session.id == change.session }?.state
                        if (stood != null && stood != ParticipationState.ProtectionOff) db.setValue(Key.OffFrom, stood.wire)
                        queued("protection_off", change.session)
                    }
                    // `offFrom` kept: a back on answered late, or not at all, is made again from there.
                    is Change.ProtectionOn -> {
                        db.setValue(Key.Reported, null)
                        queued("protection_on", change.session)
                    }
                }
            if (change.isUnlock) {
                db.setValue(Key.LastUnlock, eventId)
                // An Emergency Unlock is the latest turn the server records, under protection off too
                // (A2): a back on made since returns to it (santa's round 2).
                db.setValue(Key.OffFrom, ParticipationState.Unlocked.wire)
            }
            dao.insert(row)
            dao.record(eventId)?.record()
        }

    /**
     * Sends now an unlock held for its reason (never sent, due after it was made: C5a), as the app
     * goes behind, where it may be stopped before the hold ends.
     */
    suspend fun release(now: Instant) = write { it.release(now) }

    private suspend fun PooledConnection.release(now: Instant) {
        step(
            "UPDATE outbox SET nextAttemptAt = ? WHERE kind = 'unlock' AND attempts = 0 " +
                "AND nextAttemptAt > MAX(recordedAt, ?)",
            times.text(now), times.text(now),
        )
    }

    /**
     * The student's reason for their latest Emergency Unlock (C5a; A1), kept in its record while it
     * has never been sent ([sent], records sent and not settled, have), which then goes at once, any
     * other held unlock with it (a scan's press, B6d, ahead of its follow-up): false when it was too late.
     */
    suspend fun explain(reason: UnlockReason, now: Instant, sent: Set<String>): Boolean =
        write { db ->
            val latest = db.value(Key.LastUnlock)
            if (latest == null || latest in sent) return@write false
            val kept =
                db.step(
                    "UPDATE outbox SET reason = ?, nextAttemptAt = ? " +
                        "WHERE eventId = ? AND kind = 'unlock' AND attempts = 0 RETURNING eventId",
                    reason.wire, times.text(now), latest,
                )
            if (kept) db.release(now)
            kept
        }

    /**
     * The session protection off was last reported in, since the phone's last tap or the lock back on
     * (#167): a refocus out of it is refused and a re-tap returns (A2), so the Unlocked screen offers
     * that there (C5a).
     */
    suspend fun reportedOff(): String? = read { it.value(Key.Reported) }

    /**
     * Where the phone stood in that session before protection off, focused or unlocked, which the lock
     * back on returns it to at once (#167), until a tap or the next report, unlocked by an Emergency
     * Unlock since; none: not known.
     */
    internal suspend fun offFrom(): ParticipationState? = read { it.value(Key.OffFrom) }?.let(ParticipationState.Wire::of)

    /**
     * The phone's newest tap's event id, queued or answered and gone, kept by each tap's own write; none
     * before this file kept one: only it is said refused (#146).
     */
    internal suspend fun lastTap(): String? = read { it.value(Key.LastTap) }

    /**
     * Where the wait for the teacher's Start ends (#166), kept with each arming; none before this file
     * kept one. Kept as the file keeps every time (`Times`), where iOS keeps seconds since 1970.
     */
    internal suspend fun waitEnds(): Instant? =
        read { it.value(Key.WaitEnds) }?.let {
            try {
                times.time(it)
            } catch (_: DateTimeParseException) {
                null
            }
        }

    internal suspend fun keepWaitEnds(ends: Instant) = write { it.setValue(Key.WaitEnds, times.text(ends)) }

    /**
     * A later revocation is a new one, reported again: the lock is back, or the phone's row is focused
     * again (the sync engine's record, A13).
     */
    suspend fun protectionRestored() = write { it.setValue(Key.Reported, null) }

    /**
     * Where the phone stood when the sync engine last said, for the app's next launch; [Standing.Out]
     * when it never said. An unlock made since, where it stood unread and not filed yet, acts on it as
     * it did on the lock (B6b): nothing was kept over it. One this build can't read throws.
     */
    suspend fun standing(): Standing = read { it.standing() }

    private suspend fun PooledConnection.standing(): Standing {
        val kept = value(Key.Standing)?.let(::keptStanding) ?: return Standing.Out
        return if (step("SELECT 1 FROM outbox WHERE $UNFILED")) kept.acting(Change.UnlockUnfiled(null)) else kept
    }

    internal suspend fun keep(standing: Standing) = write { it.keep(standing) }

    private suspend fun PooledConnection.keep(standing: Standing) = setValue(Key.Standing, standing.kept)

    /**
     * Keeps [standing] and files every unlock not filed yet (B6b) where it says, in one write, so a
     * relaunch never finds the one without the other: in the session it names, or naming none, under
     * the phone's last tap, which the server files where that tap landed, or keeps with no session
     * (A11): never discarded. With no tap known either, it waits for a standing that names one. What
     * waits is the file's to say, never a queue read before (#95's review): true when it filed one.
     */
    internal suspend fun file(standing: Standing): Boolean = write { it.file(standing) }

    private suspend fun PooledConnection.file(standing: Standing): Boolean {
        val tap = if (standing.sessionId == null) value(Key.LastTap) else null
        // Nowhere to file it, no session named and no tap known, it matches nothing, and waits.
        // Whether it filed one is what the UPDATE itself returns, the rows it filed: no count another
        // statement could stand in for (#96's review, #97's), as a wrong no loses the drain that sends it.
        val filed =
            step(
                "UPDATE outbox SET sessionId = ?, tapId = ? WHERE $UNFILED AND ? IS NOT NULL RETURNING eventId",
                standing.sessionId, tap, standing.sessionId ?: tap,
            )
        keep(standing)
        return filed
    }

    /**
     * `PRAGMA synchronous` on the connection the file's writes go through: FULL (2) once one has, as
     * each sets it first, where Room opens every connection at NORMAL (1). The app's instrumented test
     * reads it, to show it on the phone.
     */
    suspend fun synchronous(): Long =
        file.useWriterConnection { writer ->
            writer.usePrepared("PRAGMA synchronous") { level -> level.apply { step() }.getLong(0) }
        }

    /** Everything queued, in the order the phone acted: for a screen to show what is stuck. */
    suspend fun records(): List<OutboxRecord> = dao.records().map { it.record() }

    internal suspend fun state(key: Key): String? = read { it.value(key) }

    /** Keeps [value] under [key], or forgets the key for none. */
    internal suspend fun setState(key: Key, value: String?) = write { it.setValue(key, value) }

    override fun close() = file.close()

    /**
     * One write, all or nothing, on Room's one writer connection, synced to the disk as it commits:
     * FULL set first, since Room sets NORMAL on each connection it opens. Room's DAO calls made inside
     * it join it, on its connection.
     */
    private suspend fun <T> write(block: suspend (PooledConnection) -> T): T =
        file.useWriterConnection { writer ->
            writer.execSQL("PRAGMA synchronous = FULL")
            writer.immediateTransaction { block(this) }
        }

    /** One read, in one transaction: what it reads is what one write left. */
    private suspend fun <T> read(block: suspend (PooledConnection) -> T): T =
        file.useReaderConnection { reader -> reader.deferredTransaction { block(this) } }

    /**
     * The rules' own state, each under its key: the session protection off was last reported for,
     * and where the phone stood there before it, the latest unlock's id, the file's install, the
     * phone's standing, the latest tap's id, and where a wait for the Start ends.
     */
    internal enum class Key(val key: String) {
        Reported("protectionOffReported"),
        OffFrom("protectionOffFrom"),
        LastUnlock("lastUnlock"),
        Install(INSTALL),
        Standing("standing"),
        LastTap("lastTap"),
        WaitEnds("waitEnds"),
    }

    companion object {
        /**
         * The outbox in the file [builder] names, made at its first open, on the SQLite Room bundles,
         * the same on the JVM's tests and on the phone. A file a newer build made is refused, never
         * read through a schema this one doesn't know, nor wiped: Room has no migration down.
         */
        fun open(builder: RoomDatabase.Builder<OutboxDatabase>): Outbox =
            Outbox(builder.setDriver(BundledSQLiteDriver()).addCallback(Created).build())
    }
}

/** The install's key, which the selection's SQL names too. */
internal const val INSTALL = "install"

/** An unlock not filed yet (B6b): made where the phone stood unread, under no session or tap. */
private const val UNFILED = "kind = 'unlock' AND sessionId IS NULL AND tapId IS NULL"

/** The value kept under [key]; none for none. */
private suspend fun PooledConnection.value(key: Outbox.Key): String? = text("SELECT value FROM outboxState WHERE key = ?", key.key)

private suspend fun PooledConnection.setValue(key: Outbox.Key, value: String?) {
    if (value == null) {
        step("DELETE FROM outboxState WHERE key = ?", key.key)
    } else {
        step("INSERT OR REPLACE INTO outboxState (key, value) VALUES (?, ?)", key.key, value)
    }
}

/** Runs [sql] with [args] bound in turn, text or none, and steps it once: whether that gave a row. */
private suspend fun PooledConnection.step(sql: String, vararg args: String?): Boolean = usePrepared(sql) { it.bind(args).step() }

/** The text [sql] reads first, with [args] bound in turn; none for no row, or none there. */
private suspend fun PooledConnection.text(sql: String, vararg args: String?): String? =
    usePrepared(sql) { it.bind(args).takeIf { read -> read.step() && !read.isNull(0) }?.getText(0) }

private fun SQLiteStatement.bind(args: Array<out String?>) =
    apply { args.forEachIndexed { index, arg -> if (arg == null) bindNull(index + 1) else bindText(index + 1, arg) } }
