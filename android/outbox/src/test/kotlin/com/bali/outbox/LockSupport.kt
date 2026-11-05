package com.bali.outbox

import com.bali.core.ParticipationState
import java.time.Instant
import kotlin.test.fail
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

// The lock as the enforcer's tests hold it, beside the engine's rig: BaliOutbox's EnforcementTests'
// `FakeScreenTime`, `Enforced` and `unreadable`, the lock's switch in Screen Time's permission's place and
// the lock it holds in the shields'.

/**
 * The lock as a test holds it: its switch, which the test changes behind the enforcer's back as Android
 * or the student would; the lock it holds, which stops at its end by [clock], as the service's does; and
 * a read of it held while the test does what it must. BaliOutbox's tests' `FakeScreenTime`.
 */
class FakeLock(private val clock: SyncClock, switch: LockSwitch = LockSwitch.On) : Lock {
    private val sync = Any()
    private var switched = switch

    /** The end of the lock it holds; none: none, or the last run's. */
    private var end: Instant? = null

    /** Whether it holds the last run's lock, kept across a restart with no end of its own (AN7c). */
    private var kept = false
    private var locked = 0
    private var unlocked = 0

    /** Reads of the lock to let through before the one held ([hold]); none: none held. */
    private var through: Int? = null
    private var parked: CompletableDeferred<Unit>? = null
    private var failing: Throwable? = null
    private var thrown = 0

    override suspend fun switch(): LockSwitch = synchronized(sync) { switched }

    override suspend fun locking(): Boolean {
        val park =
            synchronized(sync) {
                val left = through
                through = left?.takeIf { it > 0 }?.minus(1)
                if (left == 0) CompletableDeferred<Unit>().also { parked = it } else null
            }
        park?.await()
        synchronized(sync) {
            failing?.let { failure ->
                failing = null
                thrown += 1
                throw failure
            }
        }
        return holds
    }

    override suspend fun lock(until: Instant) {
        synchronized(sync) {
            end = until
            kept = false
            locked += 1
        }
    }

    override suspend fun unlock() {
        synchronized(sync) {
            end = null
            kept = false
            unlocked += 1
        }
    }

    /** Whether it holds a lock now: the last run's, or this run's before its end, by the clock. */
    val holds: Boolean get() = synchronized(sync) { kept || end?.let { it > clock.now() } == true }

    /** The end of the lock it holds now; none: none, or the last run's, which has none of its own. */
    val until: Instant? get() = synchronized(sync) { end?.takeIf { it > clock.now() } }

    /** Each lock put on, and each taken off, counted. */
    val locks: Int get() = synchronized(sync) { locked }
    val unlocks: Int get() = synchronized(sync) { unlocked }

    /** The student switches the service on or off, or Android does: off, the service is unbound, and the lock ends with it. */
    fun set(switch: LockSwitch) =
        synchronized(sync) {
            switched = switch
            if (switch == LockSwitch.Off) drop()
        }

    /** The lock is gone, and nothing told the app. */
    fun drop() =
        synchronized(sync) {
            end = null
            kept = false
        }

    /** It holds the last run's lock already: a relaunch's. */
    fun held() = synchronized(sync) { kept = true }

    /**
     * The next read of the lock to end throws [failure], as the lock promises never to, a held one too once
     * released: by default a failure of its own, else an error or a cancel of its own (a timeout in it).
     */
    fun failNextRead(failure: Throwable = IllegalStateException("the lock broke its promise")) = synchronized(sync) { failing = failure }

    /** How many reads have thrown so. */
    val throws: Int get() = synchronized(sync) { thrown }

    /** Lets [after] reads of the lock through, then holds the next until [release]: a pass of the enforcer waiting on the lock there. */
    fun hold(after: Int) = synchronized(sync) { through = after }

    val holding: Boolean get() = synchronized(sync) { parked != null }

    fun release() {
        synchronized(sync) { parked.also { parked = null } }?.complete(Unit)
    }
}

/** An enforcer over a rig's engine and clock, with the lock as the test holds it, running at once: BaliOutbox's tests' `Enforced`. */
class Enforced(val rig: Rig, val lock: FakeLock, scope: CoroutineScope) {
    val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
    private val running: Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { enforcer.run() }

    /** Waits for a claim [condition] holds for, and returns it; none in time fails the test. */
    suspend fun until(condition: (Protection) -> Boolean): Protection =
        withTimeoutOrNull(patience) { enforcer.updates.first(condition) } ?: fail("the enforcer never reached the claim waited for")

    /** Stops the enforcer, then the engine. */
    suspend fun stop() {
        withTimeoutOrNull(patience) { running.cancelAndJoin() } ?: fail("the enforcer's run never ended")
        rig.stop()
    }
}

/** An enforcer over [rig] and [lock], by default one switched on holding none, in the test's scope, which ends it with the test. */
fun EngineFiles.enforced(rig: Rig, lock: FakeLock = FakeLock(rig.clock)) = Enforced(rig, lock, scope)

/**
 * A relaunch over [outbox], a fresh one by default, whose file holds where the phone stood, focused until
 * [endsAt] seconds after [t0], in a form this build can't read, the lock holding the last run's lock
 * ([held]) or none: its enforcer, its first pass made, and that standing. BaliOutbox's tests' `unreadable`.
 */
suspend fun EngineFiles.unreadable(held: Boolean = true, endsAt: Long = 1200, outbox: Outbox? = null): Pair<Enforced, Standing> {
    val file = outbox ?: makeOutbox().first
    val kept = Standing.InSession(session(endsAt = endsAt), ParticipationState.Focused)
    file.keep(kept)
    spoilStanding(file)
    val rig = rig(file)
    val phone = enforced(rig, FakeLock(rig.clock).also { if (held) it.held() })
    phone.until { it.checked }
    return phone to kept
}
