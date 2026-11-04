package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.ApiResponse
import com.bali.core.CheckInRequest
import com.bali.core.CheckInResponse
import com.bali.core.DisplayState
import com.bali.core.MeResponse
import com.bali.core.NoAnswer
import com.bali.core.ParticipationState
import com.bali.core.ReconcileStamp
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.StateChangeDisposition
import com.bali.core.TapDisposition
import com.bali.core.UnlockDisposition
import com.bali.core.readMayReconcile
import java.time.Duration
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.toKotlinDuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
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

// The sync engine, BaliOutbox's SyncEngine.swift: its frame, AN5a's, its drain, AN5b's, and its read
// loop, AN5c's. The wait for the Start is AN5d's and Emergency Unlock AN5e's, each on the pattern set
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

    /**
     * Whether the truth is to be read again ([reread]): at the read loop's next wake, and at each after
     * until a read answers.
     */
    private var rereading = false

    /** Whether a fresh token was already tried since the last answer that wasn't a 401 ([heard]). */
    private var refreshed = false

    /** The refresh under way, which every 401 heard while it runs shares: the drain's, a read's. */
    private var reauth: Deferred<Unit>? = null

    /**
     * Whether the screen is on, as the lock's service says (AN7): the read loop checks in every 30
     * seconds while it is, and while it is off, never but once, as it goes off ([goingOff]).
     */
    private var screenOn = false

    /** The one check-in the screen going off sends, in a session: the read loop's, at its next wake. */
    private var goingOff = false

    /** Rule 3's check of the lock, the lock's service's (AN7): [atEachWake]. */
    private var check: (suspend () -> Unit)? = null
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
     * the next run sends it at once under its event id and settles it. iOS settles it as no answer. A 401's
     * refresh is waited for, the engine let go, before the next pass ([heard]).
     */
    private suspend fun send(record: OutboxRecord): Outbox.Due? {
        val sent = record.send(client)
        var refreshing: Deferred<Unit>? = null
        val waits = alone {
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
                    refreshing = answered(record, sent, disposition)
                    null
                }
            }
        }
        refreshing?.await()
        return waits
    }

    /**
     * A change's answer, settled. A change's own answer is the truth as of that change, but a later change
     * of the phone's, still waiting for its own answer, stands over it until then. Each disposition is
     * placed by name ([effect]). Returns the refresh a 401 calls for ([heard]).
     */
    private suspend fun answered(record: OutboxRecord, sent: Sent, disposition: Disposition?): Deferred<Unit>? {
        val refreshing = heard(sent.result, sent.noAnswer)
        knowLastTap()
        val queued = queue()
        val applies = stored { outbox.awaiting() }.getOrNull() == 0
        val effect = disposition.effect
        // A live participation names its session and its state; a note (an unlock after the end names the
        // session it ended) names no window to be in, so the truth is read again.
        val session = sent.session
        val participation = sent.state
        val live = if (session != null && participation != null) Standing.InSession(session, participation) else null
        // The unlock guard, on every answer, not a tap's alone (#95's review). A tap's or a refocus's is the
        // student's own return: an unlock made before it, by the phone's order, holds nothing back.
        val focus = live?.takeIf { effect == Effect.Lands && applies }
        val after = if (record.change.isReturn) record.order?.seq ?: 0 else 0
        val keeps = if (focus != null && focus.state == ParticipationState.Focused) keepsUnlocked(focus.session.id, after) else false
        val lands = if (keeps == false) focus else focus?.copy(state = ParticipationState.Unlocked)
        // To come: an arming's wait (AN5d), and the unlock recorded, a late one said why (AN5e).
        update { now ->
            // Settled, and the queue read again, in one step: no screen sees the record neither on its way
            // nor answered.
            val next = now.copy(queued = queued, sending = now.sending - record.eventId)
            when {
                lands != null -> next.copy(standing = lands)
                effect == Effect.Drops ->
                    next.copy(refused = Refusal(record.change, sent.status, sent.error?.error?.reason, sent.error?.error?.message))
                else -> next
            }
        }
        // The guard's failed read, shown after that step, never before it: iOS shows it first, and its
        // step, copied before the failure, hides it again, the phone left unlocked and nothing said.
        if (keeps == null) failed()
        if (effect == Effect.Rereads || effect == Effect.Drops || effect == Effect.Lands && live == null) reread()
        if (effect != Effect.Again) changes += 1
        return refreshing
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

        /** Dropped, never sent again, its refusal shown, and the truth read again. */
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

    /**
     * Reads the truth: where the phone stood, from the file, while that is unread; then a read of the
     * truth (`GET /v1/me`) when one was asked for, tried again at each wake until one answers, or else the
     * check-in of the session the phone is in, every 30 seconds while the screen is on and once as it goes
     * off; then waits for the next wake. Each read's answer applies only as the reconcile says.
     */
    private suspend fun read(): Nothing {
        while (true) {
            val (wake, check) = alone { wake() to check }
            // Rule 3, with the engine let go: before the check-in, or the read of the truth in its place.
            // A protection off it reports is a change, which the read's stamp then counts.
            if (wake.checks) check?.invoke()
            val refreshing =
                when (val read = alone { reading(wake) }) {
                    null -> null
                    is Read.Me -> client.me().let { alone { readMe(read.sent, it) } }
                    is Read.CheckIn -> client.checkIn(read.session, CheckInRequest(read.at)).let { alone { checkedIn(read.sent, it) } }
                }
            refreshing?.await()
            readRings.pause(alone { nextRead() })
        }
    }

    /** What a wake does, taken at its top: whether it reads the truth, and whether it checks in. */
    private class Wake(val reads: Boolean, val checks: Boolean)

    /** What a wake sends, under the stamp [sent] of the phone's changes it was sent with (`readMayReconcile`). */
    private sealed interface Read {
        val sent: ReconcileStamp

        /** `GET /v1/me`. */
        class Me(override val sent: ReconcileStamp) : Read

        /** The check-in of [session], made [at]. */
        class CheckIn(override val sent: ReconcileStamp, val session: String, val at: Instant) : Read
    }

    /**
     * The top of a pass, which answers every ring made before it and takes what each rang for: where the
     * phone stood, read again while unread; whether the truth is read; and whether it checks in, rule 3's
     * check first: while the screen is on, in a session or out (C1c), and, in a session, as it goes off.
     * What a ring made after it rang for is the next pass's, so no pass wakes for nothing, an early
     * check-in, where iOS's can.
     */
    private suspend fun wake(): Wake {
        readRings.answer()
        readStanding()
        // Out of a session, in a class, the truth is read at each wake while the screen is on, at the
        // check-in's cadence, so Home says when a class of theirs is in session (C3c).
        val outInClass = screenOn && state.standing == Standing.Out && state.hasClasses == true
        val wake = Wake(reads = rereading || outInClass, checks = screenOn || goingOff && state.standing is Standing.InSession)
        rereading = false
        goingOff = false
        return wake
    }

    /**
     * What [wake] sends, under a stamp taken now: the read of the truth, or the check-in, in a session;
     * none. A stamp the file can't give sends none, and is shown, a read then left to the next wake.
     */
    private suspend fun reading(wake: Wake): Read? {
        val sent = stored { stamp() }.getOrNull()
        if (sent == null) {
            if (wake.reads) rereading = true
            return null
        }
        val standing = state.standing
        return when {
            wake.reads -> Read.Me(sent)
            wake.checks && standing is Standing.InSession -> Read.CheckIn(sent, standing.session.id, clock.now())
            else -> null
        }
    }

    /**
     * `GET /v1/me`'s answer: the truth reconciled, its classes with it in the same step; none leaves
     * them as they were, says why (rule 5), and is read again at the next wake.
     */
    private suspend fun readMe(sent: ReconcileStamp, response: ApiResponse<MeResponse>): Deferred<Unit>? {
        val refreshing = heard(response.result, response.noAnswer)
        val me = response.answer
        if (me == null) {
            rereading = true
            update { it.copy(meFailed = response.result) }
        } else {
            reconcile(sent, standing(me)) { it.copy(me = me, meReads = it.meReads + 1, meFailed = null) }
        }
        return refreshing
    }

    /** A check-in's answer: live, the truth reconciled; nothing live there any more, or no such session, the truth read again. */
    private suspend fun checkedIn(sent: ReconcileStamp, response: ApiResponse<CheckInResponse>): Deferred<Unit>? {
        val refreshing = heard(response.result, response.noAnswer)
        val answer = response.answer
        when (answer?.status?.known) {
            CheckInResponse.Status.Live -> answer.session?.let { reconcile(sent, Standing.InSession(it, answer.state?.known)) }
            CheckInResponse.Status.Gone -> reread()
            null -> if (response.result == SendResult.Status(404)) reread()
        }
        return refreshing
    }

    /**
     * When the read loop wakes on its own: for the check-in, while the screen is on; and while where the
     * phone stood is unread, within a minute, to read the file again.
     */
    private fun nextRead(): Instant? =
        when {
            screenOn -> clock.now() + CHECK_IN_INTERVAL
            state.standing == Standing.Unread -> clock.now() + Outbox.BACKOFF_CAP
            else -> null
        }

    /**
     * Where the phone stood, read again while the file wouldn't give it back: followed, and kept as it
     * changes, from then on. The server's truth settles it too (a read, or a change's answer naming the
     * session), so a file that never reads never strands the phone.
     */
    private suspend fun readStanding() {
        if (state.standing != Standing.Unread) return
        val standing = stored { outbox.standing() }.getOrNull() ?: return
        // Written back at once, filing whatever the file holds waiting to be ([keepStanding]).
        kept = null
        update { it.copy(standing = standing) }
    }

    /**
     * `GET /v1/me`'s answer, as a standing: its live session, or none. Silence is still focus, and a state
     * this build doesn't know is never focus. (Waiting for the Start is AN5d's.)
     */
    private fun standing(me: MeResponse): Standing {
        val session = me.session ?: return Standing.Out
        val view = SessionView(session.id, session.classId, session.endsAt)
        return when (session.state.known) {
            DisplayState.Focused, DisplayState.Silent -> Standing.InSession(view, ParticipationState.Focused)
            DisplayState.Unlocked -> Standing.InSession(view, ParticipationState.Unlocked)
            DisplayState.ProtectionOff -> Standing.InSession(view, ParticipationState.ProtectionOff)
            DisplayState.Ended -> Standing.Out
            null -> Standing.InSession(view, null)
        }
    }

    /**
     * A read's answer, the truth as the server saw it, applied only when no change of the phone's can be
     * newer (`readMayReconcile`). And no read puts a session's lock back on over an unrecorded Emergency
     * Unlock ([keepsUnlocked]): its window applies, not its focus. What else it answers ([also]: `GET
     * /v1/me`'s classes) goes in the same step.
     */
    private suspend fun reconcile(sent: ReconcileStamp, read: Standing, also: (SyncState) -> SyncState = { it }) {
        val now = stored { stamp() }.getOrNull()
        val applies = now != null && readMayReconcile(sent, now)
        val keeps = if (applies && read is Standing.InSession && read.state == ParticipationState.Focused) keepsUnlocked(read.session.id) else false
        val standing = if (keeps != false && read is Standing.InSession) read.copy(state = ParticipationState.Unlocked) else read
        update { also(if (applies) it.copy(standing = standing) else it) }
        // Shown after that step, as `answered` shows its own.
        if (keeps == null) failed()
    }

    /**
     * The unlock guard (B3b-2), for every read and every answer: a focus the server names in [session]
     * applies as unlocked while an Emergency Unlock the server has yet to record is queued there
     * (`holdsUnlock`), unless the student has returned there since: the phone stands focused there
     * already, or the answer is to their own return made after it, by the phone's order ([after], that
     * return's place in it). None: the file couldn't say, so it keeps the phone unlocked, its failure for
     * the caller to show after its state step.
     */
    private suspend fun keepsUnlocked(session: String, after: Long = 0): Boolean? =
        if (state.standing.isFocused(session)) false else tried { outbox.holdsUnlock(session, after) }.getOrNull()

    private suspend fun stamp() = ReconcileStamp(changes, outbox.awaiting())

    /**
     * Queues what the phone just did, acted on at once, and sends it; none when there's nothing to send
     * (protection off already reported). Throws when it couldn't be written: the caller shows it (rule
     * 5). The student acting again ends a refusal's showing. [hold] delays the send of an Emergency
     * Unlock waiting for its reason (C5a). Its caller cancelled, it stops waiting, and the record is
     * made all the same.
     */
    suspend fun record(change: Change, hold: Duration = Duration.ZERO): OutboxRecord? =
        call {
            // Standing focused there, the phone's row is focused again (a re-tap older than its last
            // report can put it back, A13), so protection off found now is reported again.
            if (change is Change.ProtectionOff && state.standing.isFocused(change.session)) outbox.protectionRestored()
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
                now.copy(
                    standing = standing, queued = queued.getOrElse { now.queued + record }, reportedOff = off, lastTap = lastTap,
                    refused = null,
                )
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
     * The screen went on, or off, as the lock's service hears it (AN7; ARCHITECTURE, the battery plan).
     * On, the truth is read at once, then the session checked in to every 30 seconds, rule 3's check at
     * each wake; off, one check-in in a session, then nothing until it comes on again. Its caller
     * cancelled, it stops waiting, and goes on all the same.
     */
    suspend fun setScreenOn(on: Boolean) =
        call {
            screenOn = on
            if (on) {
                reread()
            } else {
                goingOff = true
                readRings.ring()
            }
        }

    /**
     * Bali's own screen came to the front, or went behind. In front, the truth is read at once, as iOS's
     * coming back reads it; behind, no reason is coming, so an unlock held for one goes now (C5a). Its
     * caller cancelled, it stops waiting, and goes on all the same.
     */
    suspend fun setInFront(front: Boolean) =
        call {
            if (front) reread() else stored { outbox.release(clock.now()) }
            drainRings.ring()
        }

    /**
     * Runs [check] at each wake of the read loop while the screen is on, before each check-in and out of
     * a session too (C1c), and before the check-in its going off sends: rule 3's check of the lock, the
     * lock's service's (AN7). It never throws, as Swift's type promises: the read loop waits on it.
     */
    suspend fun atEachWake(check: suspend () -> Unit) = call { this.check = check }

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
     * ends a rejection ([refreshed]). A 401 is sign-in's: once per rejection, [refresh] giving a fresh
     * token sends everything again at once; a fresh token refused too waits out the backoff, or for the
     * sign-in's [retryNow]; a refresh that gives none is asked again at the next 401, a backoff later.
     * Returns that refresh, started here or the one under way, which every 401 heard meanwhile shares:
     * its caller waits for it with the engine let go, as Swift's `heard` waits for it, after a stretch
     * that has nothing of a 401's to apply.
     */
    private suspend fun heard(result: SendResult, noAnswer: NoAnswer?): Deferred<Unit>? {
        if (result !is SendResult.Status) {
            update { it.copy(link = if (noAnswer == NoAnswer.NoToken) Link.SignIn else Link.Unreachable) }
            return null
        }
        val now = clock.now()
        if (result.code != 401) refreshed = false
        update { it.copy(heardAt = now, link = if (result.code == 401) Link.SignIn else Link.Reached) }
        if (result.code != 401 || refreshed) return null
        // In the engine's scope, so a loop cancelled while it waits leaves it to end for the other. A
        // refresh that throws gives no token: the phone waits on sign-in, as it shows.
        return reauth ?: scope.async { reauthed(tried { refresh() }.getOrDefault(false)) }.also { reauth = it }
    }

    /** A refresh's end: a fresh token, the first since the rejection, sends everything again at once. */
    private suspend fun reauthed(fresh: Boolean) =
        alone {
            reauth = null
            if (fresh && !refreshed) {
                refreshed = true
                sendAndReadNow()
            }
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
        /** The every-30-seconds "still here" while the screen is on (data model, decision 7; the battery plan). */
        val CHECK_IN_INTERVAL: Duration = Duration.ofSeconds(30)

        /**
         * The engine over [outbox], starting from its file: what the phone queued and where it stood. A
         * part it can't read is shown, the rest read all the same. Its calls run in [scope], the app's,
         * which outlives every screen. [refresh] is the sign-in's (AN6): refresh the token the API
         * refused, true once a fresh one is ready, asked once per rejection ([heard]). It must return at
         * once, since the loops wait on it: false when only the student can give a token, whose sign-in
         * then calls [retryNow]. It never throws, as Swift's type promises.
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
