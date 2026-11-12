package com.bali.outbox

import com.bali.core.ParticipationState
import java.time.Duration
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// Enforcement (ARCHITECTURE, "Android app structure"; B5), BaliOutbox's Enforcement.swift: the lock follows
// the sync engine's truth, AN7a's, and rule 3's report, the lock back on and the launch grace, AN7b's.

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
     * The switch as the check judges it: off, read off, or starting for [Enforcer.GRACE] of the phone's
     * running, never a launch's moment. What is reported as protection off in a session, and what ends
     * `everApproved` (AN10).
     */
    val switchedOff: Boolean = false,
    /** Verified: the lock holds, and its switch keeps it there. */
    val locked: Boolean = false,
    /** When it comes off, while the engine's truth keeps it on. */
    val until: Instant? = null,
    /** Protection off was found, and couldn't be queued: shown, and tried again at the next check. */
    val unreported: Boolean = false,
)

/**
 * Keeps the lock where the engine's truth says (B5): it follows [SyncEngine.updates], puts the lock on
 * until the bell or the cap, an end the lock keeps by the phone's own clock (data model, decision 6), and
 * runs rule 3's check at each wake of the engine's read loop while the screen is on, before each
 * check-in, out of a session too (C1c), which reports the switch found off (ARCHITECTURE, "Protection off
 * is the lock's own switch"). The app has one.
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

    /** Within the grace, the check made again [RECHECK_AFTER] on; none: none due. */
    private var recheck: Job? = null

    /**
     * When the checks in a row that read the switch starting began, by how long the phone has run, which
     * no setting of its clock moves; none after any read that didn't: a check's, or a pass's.
     */
    private var starting: Duration? = null

    /**
     * The end of the lock this enforcer put on and the lock still holds, not the last run's, which has
     * none of its own: over a standing not read, this one, a pending tap's, still comes off at the cap,
     * the last run's never, since a session it may be for may still be running (#91's review), but where
     * the standing's storage failed (AN10c2). None: none.
     */
    private var putOn: Instant? = null

    /** Hands the engine rule 3's check, then follows its truth until cancelled. */
    suspend fun run() {
        engine.atEachWake { check() }
        try {
            engine.updates.collect { pass() }
        } finally {
            alone {
                alarm?.cancel()
                recheck?.cancel()
            }
        }
    }

    /**
     * Rule 3's check, at each wake of the engine's read loop while the screen is on and as Bali comes to
     * the front: the lock goes back on where it should be on and isn't, and the switch found off in a
     * session whose row isn't protection off already, and which the phone's own clock says isn't over, is
     * reported: once there (the outbox's), and again whenever the phone stands focused there (the engine's
     * `record`, A13). Off is off at once; starting is off only once checks have read it so for [GRACE] of
     * the phone's running, since the service binds a while after Bali or the phone starts, so meanwhile
     * the check is made again every [RECHECK_AFTER], never waiting on the next wake. Switched on again in
     * the class it was off in, before its bell, the phone goes back where it stood ([backOn]). Returns
     * once its pass has run, or at once while another runs, which then runs again. A lock that throws,
     * against its promise, throws here: the caller checked nothing, and the engine's read loop sends no
     * check-in for it.
     */
    suspend fun check(): Unit =
        call {
            val switch = lock.switch()
            val off =
                alone {
                    starting = if (switch == LockSwitch.Starting) starting ?: clock.uptime() else null
                    judged(switch)
                }
            // When the lock was lost, never after now: now, as Android never notes a stop (Q7), so a session
            // over by the phone's own clock has nothing to report.
            val now = clock.now()
            val lost = minOf(lock.stoppedAt() ?: now, now)
            val stood = engine.updates.value.standing
            var unreported = false
            if (off && stood is Standing.InSession && stood.state != ParticipationState.ProtectionOff && stood.session.endsAt > lost) {
                // Android has no suspension to wait out, so a refusal is always shown (iOS's isSuspension).
                unreported = !records(Change.ProtectionOff(stood.session.id))
            }
            alone { published.value = published.value.copy(unreported = unreported) }
            if (switch == LockSwitch.On) backOn()
            enforce()
            // Starting, within the grace: checked again a second on, so the grace ends as the service binds,
            // or the switch off shows once it lasts. By `off` as judged above, not the grace read again: a
            // pass that ended past the grace claims off, and the report must follow it (iOS's santa, round 1).
            // Started at once, so its wait is set before this check returns.
            alone {
                recheck?.cancel()
                recheck =
                    if (!off && starting != null) {
                        scope.launch(start = CoroutineStart.UNDISPATCHED) {
                            clock.sleep(clock.now() + RECHECK_AFTER)
                            own { check() }
                        }
                    } else {
                        null
                    }
            }
        }

    /**
     * The switch as the check judges it ([Protection.switchedOff]): off, read off, at once; starting, once
     * checks have read it so for [GRACE]. Within a stretch.
     */
    private fun judged(switch: LockSwitch): Boolean =
        when (switch) {
            LockSwitch.On -> false
            LockSwitch.Off -> true
            LockSwitch.Starting -> starting?.let { clock.uptime() - it >= GRACE } == true
        }

    /**
     * Switched on again in the class the phone was protection off in (#167, the owner's decision
     * 2026-10-02): on and bound, and that class still running by the phone's own clock, the phone goes back
     * where it stood before it, at once, and tells the server, which returns the row there too: no re-tap.
     * Made once: the engine records it only out of protection off, so a check overlapping this one records
     * none ([SyncEngine.record]). Not saved, the file refusing it, the next check makes it again, and
     * meanwhile the screen offers the re-tap. Out of a class, or past its bell, nothing changes.
     */
    private suspend fun backOn() {
        val stood = engine.updates.value.standing as? Standing.InSession ?: return
        if (stood.state == ParticipationState.ProtectionOff && stood.session.endsAt > clock.now()) {
            records(Change.ProtectionOn(stood.session.id))
        }
    }

    /** Records [change] through the engine, with the enforcer let go: false where the outbox refused it. */
    private suspend fun records(change: Change): Boolean =
        try {
            engine.record(change)
            true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (refused: Exception) {
            false
        }

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

    /** A pass the enforcer makes for itself, for the engine's newest truth or at the lock's end ([own]). */
    private suspend fun pass() = own { call { enforce() } }

    /**
     * A pass, or a check within the grace, that the enforcer makes for itself, with no caller to tell: one
     * the lock cuts short, throwing or ending in a cancel of its own though it promises not to, ends there,
     * never the run, the alarm or the recheck, so the next pass runs, an Emergency Unlock's among them, as
     * the engine's hooks are kept ([hooked]). Its own caller's cancel still ends it.
     */
    private suspend fun own(made: suspend () -> Unit) {
        try {
            made()
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
        // Ends a run of starting at the read, never at the pass's end, over a check's newer read made meanwhile.
        alone { if (switch != LockSwitch.Starting) starting = null }
        val locking = lock.locking()
        val changing =
            alone {
                // A lock ended by its end, or with the switch, is none this enforcer holds.
                if (!locking) putOn = null
                changes(state, until, switch, locking)
            }
        if (changing) {
            if (until != null) lock.lock(until) else lock.unlock()
            alone { putOn = until }
        }
        val held = lock.locking()
        alone {
            // Read after the last wait, so a check made meanwhile keeps what it found (`unreported`).
            published.value =
                published.value.copy(
                    checked = true, switch = switch, switchedOff = judged(switch),
                    locked = held && switch == LockSwitch.On, until = until,
                )
            alarm?.cancel()
            alarm = until?.let { end -> scope.launch { clock.sleep(end); pass() } }
        }
    }

    /**
     * Whether the lock changes to [until]: put on till then where it holds none, again as its end moves, and
     * the last run's given that end once where the phone stood is known, or its storage failed to give it
     * back ([SyncState.standingFailed]), never before, which would take it off there; or, none, taken off,
     * but while where the phone stood is merely unread only one this enforcer put on, or any once the student
     * has unlocked over it ([SyncState.unlockedLast]): enforcement never begins from nothing, nor holds the
     * last run's lock over a storage that may refuse the unlock's record (AN10c2). Never put on over the
     * switch off: Android has unbound the service.
     */
    private fun changes(state: SyncState, until: Instant?, switch: LockSwitch, locking: Boolean): Boolean {
        val known = state.standing != Standing.Unread || state.standingFailed
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

    companion object {
        /**
         * How long the switch may read starting, on Android's list and not bound yet, before the check
         * judges it off: the service binds a while after Bali or the phone starts (the emulators bound it
         * 11.5 to 20 s after a reboot's screen came on), and one that never binds locks nothing. iOS's
         * grace is 10 s; this, the conductor's call (DECISIONS 2026-11-05, Q3), is tuned on the phones from
         * the Debug readout's Launch line (AN7d). Off, the common case, is judged at once.
         */
        val GRACE: Duration = Duration.ofSeconds(30)

        /** Within the grace, how soon a check that read starting is made again: never waiting on the engine's next wake. */
        internal val RECHECK_AFTER: Duration = Duration.ofSeconds(1)
    }
}
