package com.bali.outbox

import java.time.Instant

// The lock as the phone has it, BaliOutbox's Enforcement.swift's `Permission` and `ScreenTime`: Bali's
// Accessibility service, the app's (AN7c), behind this seam, so the enforcer's rules run on the JVM.

/**
 * The lock's switch: Bali's service in Android's Accessibility settings, the student's to switch on and
 * off as Screen Time's permission is on iOS (ARCHITECTURE, "Android app structure", the rules).
 */
enum class LockSwitch {
    /** On Android's list of switched-on services, and bound: the lock can cover apps. */
    On,

    /**
     * Not on the list: switched off, Bali force-stopped, or the phone in Safe Mode, each leaving it off
     * until the student switches it on again. Judged at once.
     */
    Off,

    /**
     * On the list, not bound yet: as Bali starts, or the phone does (the emulators bound it 11.5 to 20 s
     * after a reboot's screen came on). Off once that lasts the grace ([Enforcer.GRACE]).
     */
    Starting,
}

/**
 * The lock as the phone has it (decision 2). Its end is its own: put on until a time, it stops covering
 * apps there by the phone's clock, with nothing woken, the bell's twin (ARCHITECTURE, "The bell needs no
 * extension"). Its calls never throw, nor end in a cancel of their own, as Swift's protocol's can't: a
 * failure is the lock's own to handle, though the enforcer outlives one all the same.
 */
interface Lock {
    /** The switch, read now. */
    suspend fun switch(): LockSwitch

    /**
     * Whether it holds a lock now: this run's, before its end, or the last run's, kept across a restart
     * with no end of its own (AN7c), as iOS's store keeps its shields. The last run's is read once, as this
     * run starts, never again within it: a lock this run put on, ended and read back as the last run's,
     * would be kept over a standing not read until the phone knows where it stands or the student unlocks.
     */
    suspend fun locking(): Boolean

    /**
     * Locks every app the lock covers (decision 2) until [until], in place of any lock it holds: from now
     * while it is switched on, and as the service binds while it starts.
     */
    suspend fun lock(until: Instant)

    /** Takes the lock off, this run's or the last run's. */
    suspend fun unlock()

    /**
     * When the lock was lost with Bali stopped (a force-stop switches it off), for the run after it; none:
     * not known. iOS's `markerLostAt`, its monitor's note, which Android has no twin of, so none ever is
     * (DECISIONS 2026-11-05, Q7): a force-stop found after the bell reports nothing, the grid having seen
     * the phone go quiet in class. The owner's question, whether Bali reports how long it was stopped,
     * would fill it, with a board and the owner's approval first, and the step that fills it brings the
     * twin of iOS's `monitorsNote` test with it.
     */
    suspend fun stoppedAt(): Instant? = null
}
