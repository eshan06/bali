package com.bali.outbox

import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// Enforcement (ARCHITECTURE, "Android app structure"; B5), BaliOutbox's Enforcement.swift: the lock follows
// the sync engine's truth, AN7a's. Rule 3's report, the lock back on and the launch grace are AN7b's.

/**
 * What a screen may claim of the lock: what the last pass found (rule 3), never the standing alone, since
 * a stuck report stops holding reads (B3a), so a read can say focused over no lock. A value, as
 * [SyncState] is: each change a copy.
 */
data class Protection(
    /**
     * A pass has read the phone: what follows is what it found, not these defaults. Until then no screen
     * is chosen on it (C1a).
     */
    val checked: Boolean = false,
    /** The lock's switch, as the last pass read it. */
    val switch: LockSwitch = LockSwitch.Starting,
    /**
     * The switch as the check judges it: off, read off, never a launch's moment (a start that lasts the
     * grace too, AN7b's). What is reported as protection off in a session (AN7b), and what ends
     * `everApproved` (AN10).
     */
    val switchedOff: Boolean = false,
    /** Verified: the lock holds, and its switch keeps it there. */
    val locked: Boolean = false,
    /** When it comes off, while the engine's truth keeps it on. */
    val until: Instant? = null,
)

/**
 * Keeps the lock where the engine's truth says (B5): it follows [SyncEngine.updates], puts the lock on
 * until the bell or the cap, an end the lock keeps by the phone's own clock (data model, decision 6), and
 * runs rule 3's check at each wake of the engine's read loop while the screen is on, before each
 * check-in, out of a session too (C1c). The app has one.
 *
 * Swift's actor is a lock no stretch takes twice ([alone]), as the engine's is: held through each stretch
 * Swift's runs between two `await`s, and let go at each call into the [lock] or the engine, so a check
 * lands while a pass waits on the lock. Each call runs in the enforcer's own scope ([call]): its caller
 * cancelled stops waiting, never the pass.
 */
class Enforcer(
    private val engine: SyncEngine,
    private val lock: Lock,
    scope: CoroutineScope,
    private val clock: SyncClock = SystemClock,
) {
    /** The app's scope, under a job of the enforcer's own, so no call's failure ends the others. */
    private val scope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val mutex = Mutex()
    private val published = MutableStateFlow(Protection())

    /** What a screen may claim, now and at each change: the newest only. */
    val updates: StateFlow<Protection> = published.asStateFlow()

    private var enforcing = false
    private var again = false

    /** The pass at the lock's end, which changes the claim there. */
    private var alarm: Job? = null

    /**
     * The end of the lock this enforcer put on, not the last run's, which has none of its own: over a
     * standing not read, this one, a pending tap's, still comes off at the cap, the last run's never,
     * since a session it may be for may still be running (#91's review). None: none.
     */
    private var putOn: Instant? = null

    /** Hands the engine rule 3's check, then follows its truth until cancelled. */
    suspend fun run() {
        engine.atEachWake { check() }
        try {
            engine.updates.collect { pass() }
        } finally {
            alone { alarm?.cancel() }
        }
    }

    /**
     * Rule 3's check, at each wake of the engine's read loop while the screen is on and as Bali comes to
     * the front: the lock goes back on where it should be on and isn't. Its report of the switch off, and
     * the lock back on after it, are AN7b's. Returns once its pass has run, or at once while another runs,
     * which then runs again. A lock that throws, against its promise, throws here: the caller checked
     * nothing, and the engine's read loop sends no check-in for it.
     */
    suspend fun check() = call { enforce() }

    /**
     * One pass at a time: a call made while one runs has it run again, on the newest truth. A pass the lock
     * cuts short, throwing or ending in a cancel of its own though it promises not to, is followed all the
     * same by the one a call made meanwhile asked for, and the last pass's failure reaches the caller. An
     * error, or the app's scope ending, lets go at once.
     */
    private suspend fun enforce() {
        if (alone { enforcing.also { again = true; enforcing = true } }) return
        var failed: Exception? = null
        // Whether to run again, and the pass's end, are one stretch, so no call made meanwhile is lost.
        while (alone { again.also { again = false; enforcing = it } }) {
            failed =
                try {
                    apply()
                    null
                } catch (cancelled: CancellationException) {
                    if (currentCoroutineContext().isActive) cancelled else cut(cancelled)
                } catch (failure: Exception) {
                    failure
                } catch (error: Throwable) {
                    cut(error)
                }
        }
        failed?.let { throw it }
    }

    /** A pass cut short for good, the app's scope ending or an error of the lock's: let go, so the next call runs one. */
    private suspend fun cut(failure: Throwable): Nothing {
        alone { enforcing = false }
        throw failure
    }

    /**
     * A pass the enforcer makes for itself, for the engine's newest truth or at the lock's end, with no
     * caller to tell: one the lock cuts short, throwing or ending in a cancel of its own though it promises
     * not to, ends there, never the run or the alarm, so the next pass runs, an Emergency Unlock's among
     * them, as the engine's hooks are kept (`SyncEngine.hooked`). Its own caller's cancel still ends it.
     */
    private suspend fun pass() {
        try {
            call { enforce() }
        } catch (cancelled: CancellationException) {
            currentCoroutineContext().ensureActive()
        } catch (failed: Exception) {
            // The lock's own failure, which the next pass reads again; the claim stays what the last
            // pass found.
        }
    }

    /**
     * The lock as the engine's truth says now, put on or taken off where the lock says otherwise ([changes]);
     * then what a screen may claim of it, and a pass at its end.
     */
    private suspend fun apply() {
        val state = engine.updates.value
        val until = state.shieldedUntil(clock.now())
        val switch = lock.switch()
        val locking = lock.locking()
        if (alone { changes(state, until, switch, locking) }) {
            if (until != null) lock.lock(until) else lock.unlock()
            alone { putOn = until }
        }
        val held = lock.locking()
        alone {
            // Read after the last wait, so a check made meanwhile keeps what it found.
            published.value =
                published.value.copy(
                    checked = true, switch = switch, switchedOff = switch == LockSwitch.Off,
                    locked = held && switch == LockSwitch.On, until = until,
                )
            alarm?.cancel()
            alarm = until?.let { end -> scope.launch { clock.sleep(end); pass() } }
        }
    }

    /**
     * Whether the lock changes to [until]: put on till then where it holds none, again as its end moves, and
     * the last run's given that end once where the phone stood is known, never before, which would take it
     * off there; or, none, taken off, but while where the phone stood is unread only one this enforcer put
     * on, or any once the student has unlocked over it ([SyncState.unlockedLast]): enforcement never
     * begins from nothing. Never put on over the switch off: Android has unbound the service.
     */
    private fun changes(state: SyncState, until: Instant?, switch: LockSwitch, locking: Boolean): Boolean {
        val known = state.standing != Standing.Unread
        return if (until != null) {
            switch != LockSwitch.Off && (!locking || until != putOn && (putOn != null || known))
        } else {
            locking && (known || putOn != null || state.unlockedLast)
        }
    }

    /** Runs [block] in the enforcer's own scope: its caller cancelled stops waiting at once, and the pass goes on. */
    private suspend fun <T> call(block: suspend () -> T): T = scope.async { block() }.await()

    /**
     * Runs [block] with the enforcer to itself, as a stretch of Swift's actor runs between two `await`s,
     * and never cut short, so a cancel lands after it. Never from inside another: the lock is no reentrant
     * one.
     */
    private suspend fun <T> alone(block: () -> T): T = withContext(NonCancellable) { mutex.withLock { block() } }
}
