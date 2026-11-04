package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.NoAnswer
import com.bali.core.SendResult
import com.bali.core.StateChangeDisposition
import com.bali.core.TapDisposition
import com.bali.core.UnlockDisposition
import java.time.Duration
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.toKotlinDuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// The sync engine, BaliOutbox's SyncEngine.swift: its frame, AN5a's, and its drain, AN5b's. The read
// loop is AN5c's, the wait for the Start AN5d's and Emergency Unlock AN5e's, each on the pattern set
// here: Swift's actor as a lock each stretch holds (docs/PLAN-ANDROID.md).

/** The engine's clock: the time records are stamped with, and waiting on it: a test's own there. */
interface SyncClock {
    fun now(): Instant

    /**
     * How long the phone has run, by a clock no setting of the time moves: for a span that a clock set
     * forward or back must neither shrink nor stretch. Only a span between two readings means anything.
     */
    fun uptime(): Duration

    /** Returns at [until], or throws once its coroutine is cancelled. */
    suspend fun sleep(until: Instant)
}

/** The phone's clock; its uptime `System.nanoTime`'s, which no setting of the time moves. */
object SystemClock : SyncClock {
    override fun now(): Instant = Instant.now()

    override fun uptime(): Duration = Duration.ofNanos(System.nanoTime())

    override suspend fun sleep(until: Instant) = delay(Duration.between(Instant.now(), until).toKotlinDuration())
}

/**
 * The sync engine (ARCHITECTURE, "Android app structure", decision 4): the one owner of the phone's
 * server communication. It drains the outbox through the app's one [client], checks in every 30
 * seconds while the screen is on, and applies the server's answers, the reconcile, to its state. The
 * app records what the phone did through [record], never the outbox itself: the reconcile counts every
 * change.
 *
 * Swift's actor is a lock no stretch takes twice ([alone]): held through each stretch Swift's runs
 * without an `await`, the file's reads and writes included, and let go at each `await` (a send, a
 * refresh, a pause). Room's calls suspend, so a dispatcher of the engine's own couldn't keep an answer
 * or a check-in from landing between a write and the state it leaves; the lock does. No stretch is cut
 * short: Room finishes a write whatever its caller, and a cancel landing as it returns would skip the
 * state it leaves. Each public call runs in the engine's own scope ([call]): its caller cancelled
 * stops waiting, never the write, so an Emergency Unlock's record is never discarded. The file is
 * never handed [Standing.Unread].
 */
class SyncEngine private constructor(
    private val outbox: Outbox,
    /** The app's one client: the screens' own calls go through it too. */
    val client: ApiClient,
    scope: CoroutineScope,
    private val clock: SyncClock,
    /** The sign-in's (AN6), for a refused token: [open] says what it owes. */
    private val refresh: suspend () -> Boolean,
) {
    /** The app's scope, under a job of the engine's own, so no call's failure ends the others. */
    private val scope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val lock = Mutex()

    /** What the engine knows; changed only by [update], which keeps its standing and publishes it. */
    private var state = SyncState()
    private val published = MutableStateFlow(state)

    /** The state now, then at each change: the newest only, for each screen and for the lock. */
    val updates: StateFlow<SyncState> = published.asStateFlow()

    /**
     * The standing the file holds; none when not known, so a write that failed is made again at the
     * next change of state.
     */
    private var kept: Standing? = null

    /** `ReconcileStamp.changes`: each change the phone makes, and each answer to one. */
    private var changes = 0

    /** Whether the truth is to be read again ([reread]): the read loop's, at its next wake (AN5c). */
    private var rereading = false

    /** Whether a fresh token was already tried since the last answer that wasn't a 401: AN5c's refresh. */
    private var refreshed = false
    private var running = false
    private val drainRings = Rings(clock)
    private val readRings = Rings(clock)

    /**
     * Drains the outbox and reads the truth, until cancelled: one run at a time, and a run cancelled can
     * run again.
     */
    suspend fun run() {
        // Whether this run is the engine's one, let go however it ends, as Swift's `defer` does.
        var mine = false
        try {
            alone {
                if (!running) {
                    running = true
                    mine = true
                    refreshQueue()
                }
            }
            if (!mine) return
            coroutineScope {
                launch { drain() }
                launch { read() }
            }
        } finally {
            if (mine) alone { running = false }
        }
    }

    /** The outbox, in order: the record due, sent and settled; then the next, or a wait for one. */
    private suspend fun drain(): Nothing {
        while (true) {
            val found = alone { due() }
            // Answered, the next pass goes at once; else the drain waits for what is due, or a ring.
            val waits = if (found is Outbox.Due.Send) send(found.record) ?: continue else found
            val wake = (waits as? Outbox.Due.Wait)?.until
            alone { update { it.copy(retryAt = wake) } }
            drainRings.pause(wake)
        }
    }

    /**
     * The top of a pass, which answers every ring made before it: the record due, marked on its way, or
     * when one is due. A file it can't read is shown, and read again within a minute.
     */
    private suspend fun due(): Outbox.Due {
        drainRings.answer()
        val due = tried { outbox.nextDue(clock.now()) }.getOrElse { return Outbox.Due.Wait(failed()) }
        // Never an unlock not filed yet (`nextDue`): it has nowhere to go.
        if (due is Outbox.Due.Send) update { it.copy(sending = it.sending + due.record.eventId) }
        return due
    }

    /**
     * Sends [record] with the engine let go of, as Swift's `await` lets go of its actor; then, in one
     * stretch, settles the answer and applies it: none once answered, the next pass going at once, else
     * what the drain waits for. Cancelled with its run, the send makes no [Sent] (AN4b): the record stays
     * as it was, due, its attempt uncounted, and on its way, since it may have reached the server, until
     * the next run sends it at once under its event id and settles it. iOS settles it as no answer.
     */
    private suspend fun send(record: OutboxRecord): Outbox.Due? {
        val sent = record.send(client)
        return alone {
            when {
                // An unlock not filed yet sends nothing, and `nextDue` never names one.
                sent == null -> {
                    update { it.copy(sending = it.sending - record.eventId) }
                    Outbox.Due.Idle
                }
                // No token: nothing went, so nothing is settled: the record waits on sign-in (a ring), or a
                // minute. Never a sign-out, never a dropped record.
                sent.noAnswer == NoAnswer.NoToken -> {
                    update { it.copy(sending = it.sending - record.eventId, link = Link.SignIn) }
                    Outbox.Due.Wait(clock.now() + Outbox.BACKOFF_CAP)
                }
                // A settle the file refuses leaves the record on its way: the file counts it never sent.
                else -> {
                    val disposition = tried { outbox.settle(sent, clock.now()) }.getOrElse { return@alone Outbox.Due.Wait(failed()) }
                    answered(record, sent, disposition)
                    null
                }
            }
        }
    }

    /**
     * A change's answer, settled. A change's own answer is the truth as of that change, but a later change
     * of the phone's, still waiting for its own answer, stands over it until then. Each disposition is
     * placed by name ([effect]).
     */
    private suspend fun answered(record: OutboxRecord, sent: Sent, disposition: Disposition?) {
        heard(sent.result, sent.noAnswer)
        knowLastTap()
        val queued = queue()
        val applies = stored { outbox.awaiting() }.getOrNull() == 0
        val effect = disposition.effect
        // A live participation names its session and its state; a note (an unlock after the end names the
        // session it ended) names no window to be in, so the truth is read again.
        val session = sent.session
        val participation = sent.state
        val live = if (session != null && participation != null) Standing.InSession(session, participation) else null
        // To come: the unlock guard and a dropped change shown (AN5c), an arming's wait (AN5d), and the
        // unlock recorded, a late one said why (AN5e).
        update { now ->
            // Settled, and the queue read again, in one step: no screen sees the record neither on its way
            // nor answered.
            val next = now.copy(queued = queued, sending = now.sending - record.eventId)
            if (effect == Effect.Lands && applies && live != null) next.copy(standing = live) else next
        }
        if (effect == Effect.Rereads || effect == Effect.Drops || effect == Effect.Lands && live == null) reread()
        if (effect != Effect.Again) changes += 1
    }

    /** What an answer does to the phone's truth ([effect]). */
    private enum class Effect {
        /** Kept to go again, a retry or a reauth: no answer counted (`ReconcileStamp`). */
        Again,

        /** Counted, the truth the phone holds left as it is. */
        Stands,

        /** The session a live participation names, applied while no change of the phone's awaits its answer. */
        Lands,

        /** Armed: the wait for the Start, AN5d's; till then it stands. */
        Waits,

        /** The truth read again. */
        Rereads,

        /** Dropped, never sent again, and the truth read again; the refusal shown is AN5c's. */
        Drops,
    }

    /** What each disposition does: one `core` adds must be placed here. */
    private val Disposition?.effect: Effect
        get() =
            when (this) {
                // Superseded in flight: its answer is older than the phone's truth.
                null -> Effect.Stands
                is Disposition.Tap ->
                    when (disposition) {
                        TapDisposition.Retry, TapDisposition.Reauth -> Effect.Again
                        TapDisposition.ApplySession -> Effect.Lands
                        TapDisposition.WaitForStart -> Effect.Waits
                        TapDisposition.Reread, TapDisposition.RetryAndSurface -> Effect.Rereads
                    }
                is Disposition.Unlock ->
                    when (disposition) {
                        UnlockDisposition.Retry, UnlockDisposition.Reauth -> Effect.Again
                        UnlockDisposition.Recorded -> Effect.Lands
                        // Refused, it is kept and shown, and still stands on the phone (`holdsUnlock`).
                        UnlockDisposition.RetryAndSurface -> Effect.Stands
                    }
                is Disposition.StateChange ->
                    when (disposition) {
                        StateChangeDisposition.Retry, StateChangeDisposition.Reauth -> Effect.Again
                        StateChangeDisposition.ApplySession -> Effect.Lands
                        StateChangeDisposition.Reread -> Effect.Rereads
                        StateChangeDisposition.Drop -> Effect.Drops
                    }
            }

    // The read loop's pass is AN5c's: till then it waits on its rings.
    private suspend fun read(): Nothing { while (true) readRings.pause(null) }

    /**
     * Queues what the phone just did, acted on at once, and sends it; none when there's nothing to send
     * (protection off already reported). Throws when it couldn't be written: the caller shows it (rule
     * 5). [hold] delays the send of an Emergency Unlock waiting for its reason (C5a). Its caller
     * cancelled, it stops waiting, and the record is made all the same.
     */
    suspend fun record(change: Change, hold: Duration = Duration.ZERO): OutboxRecord? =
        call {
            // Where it leaves the phone is kept in the change's own write: killed between two, a
            // relaunch would stand where the phone stood before, locked over an Emergency Unlock. Never
            // where it stands unread, whose keeping would undo the write, the change with it.
            val standing = state.standing.acting(change)
            val keeping = standing.takeIf { it != Standing.Unread }
            val record = outbox.record(change, clock.now(), keeping, hold) ?: return@call null
            if (keeping != null) kept = keeping
            changes += 1
            // A read that fails keeps the last list, with this record, which the file holds now: the
            // phone acts on what it just did (an unlock's lock off, a tap's on) whatever the read.
            val queued = tried { outbox.records() }
            val reportedOff = tried { outbox.reportedOff() }
            update { now ->
                // The file's newest tap now, written with it.
                val lastTap = if (change is Change.Tap) record.eventId else now.lastTap
                val off = reportedOff.getOrElse { now.reportedOff }
                now.copy(standing = standing, queued = queued.getOrElse { now.queued + record }, reportedOff = off, lastTap = lastTap)
            }
            // Shown after that step, never before it: then the standing this record replaced would be kept again.
            if (queued.isFailure || reportedOff.isFailure) failed()
            drainRings.ring()
            record
        }

    /**
     * Everything queued goes now, and the truth is read again: the student's retry (rule 5), and the
     * sign-in's once it gives a token (AN6). Its caller cancelled, it stops waiting, and goes on all the
     * same.
     */
    suspend fun retryNow() =
        call {
            refreshed = false
            sendAndReadNow()
        }

    /**
     * Runs [block] in the engine's own scope, with the engine to itself: its caller cancelled stops
     * waiting at once, and the stretch goes on, its write included.
     */
    private suspend fun <T> call(block: suspend () -> T): T = scope.async { alone(block) }.await()

    /**
     * Runs [block] with the engine to itself, as a stretch of Swift's actor runs between two `await`s:
     * the lock held throughout, the file's reads and writes included, and never cut short, so a cancel
     * lands after it. Never from inside another: the lock is no reentrant one.
     */
    private suspend fun <T> alone(block: suspend () -> T): T = withContext(NonCancellable) { lock.withLock { block() } }

    /**
     * Changes the state in one step, so no screen, and not the lock, ever sees half of one; then keeps
     * its standing in the file as it changes, so a relaunch starts where the phone stood, locked still,
     * offline too, never while it is unread, which would write over the file's truth from nothing; then
     * publishes it, if it changed.
     */
    private suspend fun update(change: (SyncState) -> SyncState) {
        val last = state
        state = change(last)
        if (state.standing != kept && state.standing != Standing.Unread) keepStanding()
        if (state != last) published.value = state
    }

    /**
     * Where the phone stood, and what it queued, each read on its own: the lock follows this state from
     * the start, so it must never begin from nothing. An unlock not filed yet acts on the standing, and
     * the first change files it ([keepStanding]), as it files whatever the file holds when its queue
     * couldn't be read.
     */
    private suspend fun load() {
        val queued = tried { outbox.records() }.getOrNull()
        val reportedOff = tried { outbox.reportedOff() }.getOrNull()
        val lastTap = tried { outbox.lastTap() }.getOrNull()
        val standing = tried { outbox.standing() }.getOrNull()
        state =
            SyncState(
                standing = standing ?: Standing.Unread, queued = queued.orEmpty(), reportedOff = reportedOff,
                lastTap = lastTap, link = Link.StorageFailed.takeIf { queued == null || standing == null },
            )
        if (standing != null && queued != null && !state.holdsUnfiled) kept = standing
        published.value = state
    }

    /**
     * Any answer, or none, for [SyncState.link], and when the server last answered; any status but a 401
     * ends a rejection ([refreshed]). A 401 is sign-in's: its refresh, once per rejection, is AN5c's.
     */
    private suspend fun heard(result: SendResult, noAnswer: NoAnswer?) {
        if (result !is SendResult.Status) {
            return update { it.copy(link = if (noAnswer == NoAnswer.NoToken) Link.SignIn else Link.Unreachable) }
        }
        val now = clock.now()
        if (result.code != 401) refreshed = false
        update { it.copy(heardAt = now, link = if (result.code == 401) Link.SignIn else Link.Reached) }
    }

    /** The truth to be read again (`GET /v1/me`), at the read loop's next wake. */
    private fun reread() {
        rereading = true
        readRings.ring()
    }

    /** Everything queued due now and read again for the screens, the truth to be read, both loops rung. */
    private suspend fun sendAndReadNow() {
        stored { outbox.retryNow(clock.now()) }
        refreshQueue()
        reread()
        drainRings.ring()
    }

    /**
     * The queue read again for the screens, the phone's newest tap with it while not known: each written
     * to the state in a step of its own, after its read (#155's review).
     */
    private suspend fun refreshQueue() {
        knowLastTap()
        val queued = queue()
        update { it.copy(queued = queued) }
    }

    /**
     * The phone's newest tap, read from the file while not known (a read at launch that failed, say),
     * or a refused tap a later one went ahead of would be said again (#146). Its own step, before the
     * queue is read: never a read's hidden effect.
     */
    private suspend fun knowLastTap() {
        if (state.lastTap != null) return
        val lastTap = tried { outbox.lastTap() }.getOrNull() ?: return
        update { it.copy(lastTap = lastTap) }
    }

    /** Everything queued, for the screens; a read that fails is shown (rule 5), the last one kept. */
    private suspend fun queue(): List<OutboxRecord> = stored { outbox.records() }.getOrElse { state.queued }

    /**
     * Writes the standing to the file, filing into it, in the same write, every unlock made where the
     * phone stood unread, which then goes (B6b): whatever the file holds, never what a read of the queue
     * last found, which one that fails leaves behind (#95's review). [kept] is set first, so the change
     * of state a failure makes ([failed]) writes nothing again at once; the next change does.
     */
    private suspend fun keepStanding() {
        val standing = state.standing
        kept = standing
        val filed = stored { outbox.file(standing) }.getOrNull()
        if (filed == null) kept = null
        if (filed == true) {
            refreshQueue()
            drainRings.ring()
        }
    }

    /** What [read] reads from the outbox, or writes; a failure is shown (rule 5). */
    private suspend fun <T> stored(read: suspend () -> T): Result<T> = tried(read).onFailure { failed() }

    /** What [read] reads, or its failure, unshown, as Swift's `try?`: a cancel is never taken for one. */
    private suspend fun <T> tried(read: suspend () -> T): Result<T> =
        try {
            Result.success(read())
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(error)
        }

    /**
     * A storage failure, shown (rule 5), and when to try again: within a minute. Every one is shown:
     * Android has no app group, whose file iOS refuses an app it suspends (iOS's `isSuspension`).
     */
    private suspend fun failed(): Instant {
        update { it.copy(link = Link.StorageFailed) }
        return clock.now() + Outbox.BACKOFF_CAP
    }

    companion object {
        /**
         * The engine over [outbox], starting from its file: what the phone queued and where it stood. A
         * part it can't read is shown, the rest read all the same. Its calls run in [scope], the app's,
         * which outlives every screen. [refresh] is the sign-in's (AN6): refresh the token the API
         * refused, true once a fresh one is ready. It must return at once, false when only the student
         * can give a token, since the drain waits on it.
         */
        suspend fun open(
            outbox: Outbox, client: ApiClient, scope: CoroutineScope, clock: SyncClock = SystemClock,
            refresh: suspend () -> Boolean = { false },
        ): SyncEngine = SyncEngine(outbox, client, scope, clock, refresh).apply { lock.withLock { load() } }
    }
}

/**
 * A loop's rings, Swift's `ring` and `pause`, as a conflated channel: a ring ends the loop's pause, or,
 * made while the loop is busy, its next one at once; however many come meanwhile, one wake.
 */
internal class Rings(private val clock: SyncClock) {
    private val rung = Channel<Unit>(Channel.CONFLATED)

    fun ring() { rung.trySend(Unit) }

    /** Answers every ring made before now: the top of a pass, which does what they rang for. */
    fun answer() { rung.tryReceive() }

    /**
     * Waits for [deadline] (none: none), by the engine's clock, or a ring, whichever comes first. The
     * deadline's alarm ends only this pause: one that goes off as a ring ends it neither wakes the next
     * pause nor leaves a ring for it, an early check-in.
     */
    suspend fun pause(deadline: Instant?) {
        if (deadline == null) return rung.receive()
        coroutineScope {
            val alarm = launch { clock.sleep(deadline) }
            select {
                rung.onReceive {}
                alarm.onJoin {}
            }
            alarm.cancel()
        }
    }
}
