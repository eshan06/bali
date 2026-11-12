package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ParticipationState
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
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

/**
 * The read of one value the state table keeps: the standing, and each of the rules' own beside it. Never the queue's, whose read
 * takes the install in a statement of its own.
 */
private const val VALUE = "SELECT value FROM outboxState WHERE key = ?"

/** Decision 7's cap after [t0], in seconds: until when a tap recorded then is locked. */
private val cap = SyncState.TAP_CAP.seconds

class StorageFailedTest : EngineFiles() {
    /** Whether the storage refuses the outbox's own statements now ([failing]'s). */
    private val refusing = AtomicBoolean(false)

    /**
     * The outbox in a file of its own, whose storage refuses every statement of the outbox's own while [refusing], as a disk that
     * won't read or write refuses them: each read and write of its tables, and a write's first step. SQLite's own (a transaction's
     * begin and end, a rollback) and Room's (its open, its refresh after each write) go through: Room's refresh refused can't roll
     * back, and holds Room's writer for good (seen on this rig), where a real disk's failure rolls back. [before] sees each
     * statement first, a hold's place.
     */
    private fun failing(before: (String) -> Unit = {}): Outbox =
        open(
            temporaryFile(),
            driver = Watching(stepping = { sql -> before(sql); if (refusing.get() && (OUTBOX in sql || sql == FULL)) throw SQLiteException("disk I/O error") }),
        )

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

    @Test
    fun aFileRoomCantOpenAsAFailedUpdateMightLeaveIsAStandingUnreadItsStorageFailedTheLastRunsLockOffAtTheFirstPass(): Unit =
        runBlocking {
            // Not a database: Room opens the file at its first read, so every read fails there, and the engine runs all the same.
            val file = temporaryFile().also { it.writeText("not a database. ".repeat(512)) }
            val rig = rig(open(file))
            val phone = enforced(rig, FakeLock(rig.clock).also { it.held() })
            val claim = phone.until { it.checked }
            val loaded = rig.engine.updates.value
            assertEquals(listOf(Standing.Unread, Link.StorageFailed, true), listOf(loaded.standing, loaded.link, loaded.standingFailed))
            assertEquals(listOf(false, null), listOf(claim.locked, claim.until))
            assertFalse(phone.lock.holds)
            assertEquals(listOf(0, 1), listOf(phone.lock.locks, phone.lock.unlocks))
            // Nothing written over it.
            assertEquals("not a database. ".repeat(512), file.readText())
        }

    @Test
    fun aLaterReadThatWorksPutsTheLockBackFromTheStandingFocusedInASessionOnToItsBellAndOutOff(): Unit =
        runBlocking {
            for (standing in listOf(focused, Standing.Out)) {
                val outbox = failing()
                outbox.keep(standing)
                refusing.set(true)
                val rig = rig(outbox)
                val phone = enforced(rig, FakeLock(rig.clock).also { it.held() })
                phone.until { it.checked && !it.locked }
                // Read again within a minute (`Outbox.BACKOFF_CAP`), the drain's wait and the read loop's both: readable by then.
                rig.sleeping(at(60), at(60))
                refusing.set(false)
                rig.clock.advance(60)
                rig.until { it.standing == standing && !it.standingFailed }
                if (standing == focused) {
                    phone.until { it.locked && it.until == at(1200) }
                    assertEquals(at(1200), phone.lock.until)
                } else {
                    phone.enforcer.check()
                    assertFalse(phone.enforcer.updates.value.locked)
                    assertEquals(0, phone.lock.locks)
                }
                assertEquals(1, phone.lock.unlocks, "$standing")
                phone.stop()
            }
        }

    @Test
    fun aLockThisRunPutOnWithItsOwnEndStaysOnThroughAStorageFailureToThatEndInASessionAndAtATapsCap(): Unit =
        runBlocking {
            // Focused in a session, its lock to the bell; then the storage fails.
            val rig = rig(failing())
            val phone = enforced(rig)
            rig.tapIn(focused.session)
            phone.until { it.locked && it.until == at(1200) }
            refusing.set(true)
            // Bali comes to the front: its read of the truth can't take its stamp, shown; the student's unlock can't be saved.
            rig.engine.setInFront(true)
            rig.until { it.link == Link.StorageFailed }
            assertEquals(UnlockFailure.NotSaved, rig.engine.pressUnlock())
            phone.enforcer.check()
            assertEquals(listOf(true, at(1200)), phone.enforcer.updates.value.let { listOf(it.locked, it.until) })
            assertEquals(at(1200), phone.lock.until)
            assertFalse(rig.engine.updates.value.standingFailed)
            // Off at its end, by the phone's clock, never taken off.
            rig.clock.advance(1200)
            phone.until { !it.locked }
            assertEquals(listOf(false, 0), listOf(phone.lock.holds, phone.lock.unlocks))
            phone.stop()
            // A tap not yet answered, over a standing this build can't read: its lock to decision 7's cap. Then the storage fails,
            // and the file read again within a minute fails in it.
            refusing.set(false)
            val outbox = failing()
            outbox.keep(focused)
            spoilStanding(outbox)
            val unread = rig(outbox)
            val tapped = enforced(unread)
            unread.engine.record(Change.Tap("tag"))
            tapped.until { it.locked && it.until == at(cap) }
            unread.server.next(tapRoute).reply(null)
            unread.sleeping(at(2), at(60), at(cap))
            refusing.set(true)
            unread.clock.advance(60)
            unread.until { it.standingFailed }
            tapped.enforcer.check()
            assertEquals(listOf(true, at(cap)), tapped.enforcer.updates.value.let { listOf(it.locked, it.until) })
            assertEquals(at(cap), tapped.lock.until)
            unread.clock.advance(SyncState.TAP_CAP.minusSeconds(60))
            tapped.until { !it.locked }
            assertEquals(listOf(false, 0), listOf(tapped.lock.holds, tapped.lock.unlocks))
        }

    @Test
    fun theLastRunsLockStaysOnWhileTheStandingsReadIsHeldPendingAndComesOffOnlyOnceThatReadFailsInTheStorage(): Unit =
        runBlocking {
            // A standing this build can't read, the storage itself fine: merely unread (Q4), the last run's lock held over it.
            // HeldWrite's hold, handed the reads of a kept value: one held once armed, at a point the rig marks.
            val held = HeldWrite()
            val outbox = failing { sql -> if (sql == VALUE) held.hold() }
            outbox.keep(focused)
            spoilStanding(outbox)
            val rig = rig(outbox)
            val phone = enforced(rig, FakeLock(rig.clock).also { it.held() })
            assertTrue(phone.until { it.checked }.locked, "the last run's lock taken off over a standing merely unread")
            // Read again within a minute: held once it has begun, a pass made meanwhile keeping the lock.
            rig.sleeping(at(60))
            held.arm()
            rig.clock.advance(60)
            held.began()
            phone.enforcer.check()
            assertTrue(phone.enforcer.updates.value.locked, "the last run's lock taken off while a read is only pending")
            assertEquals(listOf(true, 0), listOf(phone.lock.holds, phone.lock.unlocks))
            // That read fails in the storage: the lock off.
            refusing.set(true)
            held.release()
            phone.until { !it.locked }
            assertTrue(rig.engine.updates.value.standingFailed)
            assertEquals(listOf(false, 1), listOf(phone.lock.holds, phone.lock.unlocks))
        }

    @Test
    fun whereTheStandingCantBeReadButTheQueueCanAPendingTapGivesTheLockItsCapInTheLastRunsPlaceAndItComesOffThere(): Unit =
        runBlocking {
            // The last run's tap, never answered, in a session running ten minutes past its cap; the storage then refusing each
            // value kept beside the queue, the standing among them, never the queue.
            val outbox = open(temporaryFile(), driver = Watching(stepping = { sql -> if (refusing.get() && sql == VALUE) throw SQLiteException("disk I/O error") }))
            outbox.keep(Standing.InSession(session(endsAt = cap + 600), ParticipationState.Focused))
            val tap = record(outbox, Change.Tap("tag"))
            refusing.set(true)
            val rig = rig(outbox)
            val phone = enforced(rig, FakeLock(rig.clock).also { it.held() })
            val claim = phone.until { it.checked }
            val loaded = rig.engine.updates.value
            assertEquals(listOf(Standing.Unread, true), listOf(loaded.standing, loaded.standingFailed))
            assertEquals(listOf(tap.eventId), loaded.queued.map { it.eventId })
            // The same rule: the last run's lock held no longer, the tap's in its place, to its cap.
            assertEquals(listOf(true, at(cap)), listOf(claim.locked, claim.until))
            assertEquals(at(cap), phone.lock.until)
            // Its Emergency Unlock, under the tap, reads where the phone stood as it's kept: refused by the same storage.
            assertEquals(UnlockFailure.NotSaved, rig.engine.pressUnlock())
            // Offline, the tap never answered: off at its cap, where the last run's lock would have stayed for that session.
            rig.server.next(tapRoute).reply(null)
            rig.clock.advance(SyncState.TAP_CAP)
            phone.until { !it.locked }
            assertEquals(listOf(false, 1, 0), listOf(phone.lock.holds, phone.lock.locks, phone.lock.unlocks))
        }
}
