package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ParticipationState
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlinx.coroutines.runBlocking

// The last run's lock over a storage that won't read (AN10c2): on Android a storage that won't open never fails the start, Room
// opening its file at the first read, so the engine runs over a standing unread (#566's santa, reviewer B). No iOS twin: iOS's
// file opens at the start, and its monitor ends the shields at the bell.

/** Where the last run left the phone: focused in session s, until 1200 s after [t0]. */
private val focused = Standing.InSession(session(endsAt = 1200), ParticipationState.Focused)

/** A statement of the outbox's own: each names its tables, `outbox` and `outboxState`. */
private const val OUTBOX = "outbox"

/** A write's first step ([Outbox]'s `write`), before its transaction begins. */
private const val FULL = "PRAGMA synchronous = FULL"

class StorageFailedTest : EngineFiles() {
    /** Whether the storage refuses the outbox's own statements now ([failing]'s). */
    private val refusing = AtomicBoolean(false)

    /**
     * The outbox in a file of its own, whose storage refuses every statement of the outbox's own while [refusing], as a disk that
     * won't read or write refuses them: each read and write of its tables, and a write's first step. SQLite's own (a transaction's
     * begin and end, a rollback) and Room's (its open, its refresh after each write) go through: Room's refresh refused can't roll
     * back, and holds Room's writer for good (seen on this rig), where a real disk's failure rolls back.
     */
    private fun failing(): Outbox =
        open(temporaryFile(), driver = Watching(stepping = { sql -> if (refusing.get() && (OUTBOX in sql || sql == FULL)) throw SQLiteException("disk I/O error") }))

    /** The storage back, before the teardown closes the files. */
    @AfterTest
    fun storageBack() = refusing.set(false)

    @Test
    fun aStorageThatWontReadOrWriteTakesTheLastRunsLockOffAsTheEngineLoadsNoEmergencyUnlockBeingSavedOverIt(): Unit =
        runBlocking {
            // The last run left the lock on, focused in a session; then the storage fails, the outbox's reads and writes alike.
            val outbox = failing()
            outbox.keep(focused)
            refusing.set(true)
            val rig = rig(outbox)
            val phone = enforced(rig, FakeLock(rig.clock).also { it.held() })
            val claim = phone.until { it.checked }
            val loaded = rig.engine.updates.value
            assertEquals(listOf(Standing.Unread, Link.StorageFailed), listOf(loaded.standing, loaded.link))
            // Its record can't be kept, so no Emergency Unlock goes through, at any press (the unlock contract).
            repeat(3) { assertEquals(UnlockFailure.NotSaved, rig.engine.pressUnlock(), "press ${it + 1}") }
            // So the lock comes off as the engine loads, as at a start that runs nothing (AN10c): never a lock the phone can
            // neither offer nor record an Emergency Unlock over.
            assertFalse(claim.locked, "the last run's lock still on, over a storage that won't read")
            assertFalse(phone.lock.holds)
            assertEquals(1, phone.lock.unlocks)
        }
}
