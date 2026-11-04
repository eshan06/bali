package com.bali.outbox

import androidx.room.RoomDatabase
import androidx.sqlite.driver.bundled.BundledSQLiteDriver

/**
 * The phone's outbox, BaliOutbox's `Outbox`: each tap, Emergency Unlock, refocus and protection-off
 * report it acted on, kept until an answer lets it go. Its file is Room's, in the app's own storage,
 * which only Bali opens, so it needs none of the app group's coordination iOS's file has (one app,
 * no extensions: ARCHITECTURE, "Android app structure", decision 3). The rules on it are AN4d's.
 */
class Outbox private constructor(internal val file: OutboxDatabase) : AutoCloseable {
    internal val dao = file.dao()

    /** Everything queued, in the order the phone acted: for a screen to show what is stuck. */
    suspend fun records(): List<OutboxRecord> = dao.records().map { it.record() }

    internal suspend fun state(key: Key): String? = dao.state(key.key)

    /** Keeps [value] under [key], or forgets the key for none. */
    internal suspend fun setState(key: Key, value: String?) =
        if (value == null) dao.forget(key.key) else dao.keep(OutboxState(key.key, value))

    override fun close() = file.close()

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
