package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.BlockRead
import com.bali.core.CheckInRequest
import com.bali.core.CheckInResponse
import com.bali.core.DisplayState
import com.bali.core.EventId
import com.bali.core.HttpTransport
import com.bali.core.MeResponse
import com.bali.core.NoAnswer
import com.bali.core.OkHttpTransport
import com.bali.core.ParticipationState
import com.bali.core.ReconcileStamp
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.SignIn
import com.bali.core.StateChangeDisposition
import com.bali.core.TapDisposition
import com.bali.core.UnlockDisposition
import com.bali.core.UnlockReason
import com.bali.core.UnlockReasonRequest
import com.bali.core.UnlockReasonResponse
import com.bali.core.readMayReconcile
import java.net.URI
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
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
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// The sync engine, BaliOutbox's SyncEngine.swift: its frame, AN5a's, its drain, AN5b's, its read loop,
// AN5c's, its wait for the Start, AN5d's, Emergency Unlock, AN5e's: where it is filed, its reason and the
// late unlock, and the phone check's cap, AN7a's. Swift's actor is a lock each stretch holds
// (docs/PLAN-ANDROID.md).

/** The engine's clock: the time records are stamped with, the zone its days end in, and waiting on it: a test's own there. */
interface SyncClock {
    fun now(): Instant

    /**
     * How long the phone has run, by a clock no setting of the time moves: for a span that a clock set
     * forward or back must neither shrink nor stretch. Only a span between two readings means anything.
     */
    fun uptime(): Duration

    /** The zone the phone is in now, where its days end (iOS's `Calendar.current`): read at each use, as a phone moves. */
    fun zone(): ZoneId

    /**
     * Returns at [until], or throws once its coroutine is cancelled. Never waits on the enforcer, its lock
     * or a call into it: the enforcer's recheck starts its sleep inside a stretch of its own, which such a
     * wait would never let go of ([Enforcer.check]; #522's review).
     */
    suspend fun sleep(until: Instant)
}

/** The phone's clock; its uptime `System.nanoTime`'s, which no setting of the time moves. */
object SystemClock : SyncClock {
    override fun now(): Instant = Instant.now()

    override fun uptime(): Duration = Duration.ofNanos(System.nanoTime())

    override fun zone(): ZoneId = ZoneId.systemDefault()

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

    /**
     * A tap answered armed while where the phone stood was unread, which can't show it: carried until the
     * standing is known ([update]), onto an out the file gives back, or a read of the truth that names no
     * session, unless that read says no tap of the student's waits (#166).
     */
    private var armed = false

    /** `ReconcileStamp.changes`: each change the phone makes, and each answer to one. */
    private var changes = 0

    /** Whether the truth is to be read again ([reread]): at the read loop's next wake, and each after till one answers. */
    private var rereading = false

    /** Whether a fresh token was already tried since the last answer that wasn't a 401 ([heard]). */
    private var refreshed = false

    /** The refresh under way, which every 401 heard while it runs shares: the drain's, a read's. */
    private var reauth: Deferred<Unit>? = null

    /**
     * The last change of an unlock's reason no answer came to: tried again for the same unlock and
     * reason, it goes under the same event id (rule 4).
     */
    private var unanswered: Pick.Change? = null

    /** Whether the screen is on, as the lock's service says (AN7): the check-ins' 30 s ([setScreenOn]). */
    private var screenOn = false

    /** Whether the screen went on or off since the read loop's last wake, whose check-in that is ([setScreenOn]). */
    private var screenTurned = false

    /** Rule 3's check of the lock, the enforcer's: [atEachWake]. */
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
            val (found, onItsWay) = alone { due() }
            // Answered, the next pass goes at once; else the drain waits for what is due, or a ring.
            val waits = if (found is Outbox.Due.Send) send(found.record, onItsWay) ?: continue else found
            val wake = (waits as? Outbox.Due.Wait)?.until
            alone { update { it.copy(retryAt = wake) } }
            drainRings.pause(wake)
        }
    }

    /**
     * The top of a pass, which answers every ring made before it: the record due, marked on its way, and
     * whether it was already, a send of it cut short or answered in a write the file refused; or when one
     * is due. A file it can't read is shown, and read again within a minute.
     */
    private suspend fun due(): Pair<Outbox.Due, Boolean> {
        drainRings.answer()
        val due = tried { outbox.nextDue(clock.now()) }.getOrElse { return Outbox.Due.Wait(failed()) to false }
        // Never an unlock not filed yet (`nextDue`): it has nowhere to go.
        if (due !is Outbox.Due.Send) return due to false
        val onItsWay = due.record.eventId in state.sending
        update { it.copy(sending = it.sending + due.record.eventId) }
        return due to onItsWay
    }

    /**
     * Sends [record] with the engine let go of, as Swift's `await` lets go of its actor; then, in one
     * stretch, settles the answer and applies it: none once answered, the next pass going at once, else
     * what the drain waits for. Cancelled with its run, the send makes no [Sent] (AN4b): the record stays
     * as it was, due, its attempt uncounted, and on its way, since it may have reached the server, until a
     * send of it settles; the next run sends it at once under its event id. iOS settles it as no answer. A
     * 401's refresh is waited for, the engine let go, before the next pass ([heard]).
     */
    private suspend fun send(record: OutboxRecord, onItsWay: Boolean): Outbox.Due? {
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
                // minute. Never a sign-out, never a dropped record. One on its way already may have reached
                // the server, so it stays so: a reason kept now would go with a send the server never reads (A1).
                sent.noAnswer == NoAnswer.NoToken -> {
                    update { it.copy(sending = if (onItsWay) it.sending else it.sending - record.eventId, link = Link.SignIn) }
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
        // An arming's wait ends where the server drops the tap, the end of its school day (decision 5), by
        // the phone's clock too, read or not (#166): kept for a relaunch before the step that waits, as iOS
        // keeps it, so no relaunch finds the wait without it.
        val arms = effect == Effect.Waits && applies
        val ends = if (arms) SyncState.waitEnds(clock.now(), clock.zone()) else null
        val endKept = ends?.let { tried { outbox.keepWaitEnds(it) } }
        // Arming ends nothing: a session the phone is in stays (decision 4) while it runs by the phone's own
        // clock (data model, decision 6); past its bell the phone is in none, and waits as from out, the
        // sweep that ends it on the server may run late (C3a). One it may be in, where it stood unread, is
        // asked of the server, the arming carried ([armed]).
        val stood = state.standing
        val waits =
            arms &&
                when (stood) {
                    is Standing.InSession -> stood.session.endsAt <= clock.now()
                    Standing.Out, Standing.Waiting -> true
                    Standing.Unread -> false
                }
        if (arms && stood == Standing.Unread) armed = true
        // An unlock recorded in a session, not late: its reason on record, the card's check (its own, or the
        // one the server kept, its first standing: A1), and what a pick changes from now (A20). A newer unlock
        // of the class still queued is the card's.
        val recorded =
            sent.session?.takeIf { disposition == Disposition.Unlock(UnlockDisposition.Recorded) && !sent.superseded }
                ?.let { RecordedUnlock(it.id, record.eventId, sent.reason) }
        // A late unlock putting the lock back on with no return of the phone's own since, focused there
        // already, or a tap or refocus made after it, is said why (C5a).
        val seq = record.order?.seq ?: 0
        val late =
            lands?.takeIf {
                sent.superseded && it.state == ParticipationState.Focused && !stood.isFocused(it.session.id) &&
                    queued.none { later -> later.change.isReturn && (later.order?.seq ?: 0) > seq }
            }
        update { now ->
            // Settled, and the queue read again, in one step: no screen sees the record neither on its way
            // nor answered.
            val next =
                now.copy(
                    queued = queued, sending = now.sending - record.eventId, waitEnds = ends ?: now.waitEnds,
                    recordedUnlock = recorded ?: now.recordedUnlock,
                )
            when {
                lands != null ->
                    next.copy(standing = lands, superseded = late?.let { Superseded(it.session.id, record.order != null) } ?: now.superseded)
                waits -> next.copy(standing = Standing.Waiting)
                effect == Effect.Drops ->
                    next.copy(refused = Refusal(record.change, sent.status, sent.error?.error?.reason, sent.error?.error?.message))
                else -> next
            }
        }
        // The guard's failed read, and the wait's end the file refused, shown after that step, never before
        // it: iOS shows the guard's first, and its step, copied before the failure, hides it again, the
        // phone left unlocked and nothing said.
        if (keeps == null || endKept?.isFailure == true) failed()
        val rereads = effect == Effect.Rereads || effect == Effect.Drops || effect == Effect.Lands && live == null
        if (rereads || effect == Effect.Waits && stood == Standing.Unread) reread()
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

        /** Armed: the wait for the Start and its end, applied as [Lands] is, but never over a session still running. */
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
     * truth (`GET /v1/me`) when one was asked for, tried again at each wake until one answers, and at each
     * wake while the screen is on and the phone waits for the Start, or else the check-in of the session
     * the phone is in, every 30 seconds while the screen is on and once as it goes on or off; then waits
     * for the next wake. Each read's answer applies only as the reconcile says.
     */
    private suspend fun read(): Nothing {
        while (true) {
            val (wake, check) = alone { wake() to check }
            val refreshing =
                try {
                    // Rule 3, with the engine let go: before the check-in, or the read of the truth in its
                    // place. A protection off it reports is a change, which the read's stamp then counts. One
                    // that throws verified nothing, so this wake claims nothing: no check-in.
                    val checked = wake.checks && hooked(false) {
                        check?.invoke()
                        true
                    }
                    val read = alone { reading(wake, checked) }
                    when {
                        read == null -> null
                        read.session == null -> client.me().let { alone { readMe(read.sent, it) } }
                        else -> client.checkIn(read.session, CheckInRequest(read.at)).let { alone { checkedIn(read.sent, it) } }
                    }
                } catch (cancelled: CancellationException) {
                    // Cancelled with its run, what it took is the next run's: iOS's no answer keeps its read.
                    alone {
                        if (wake.reads) rereading = true
                        if (wake.screen) screenTurned = true
                    }
                    throw cancelled
                }
            refreshing?.await()
            readRings.pause(alone { nextRead() })
        }
    }

    /** What a wake does, taken at its top: reads the truth, checks in, and whether that is the screen's own check-in. */
    private class Wake(val reads: Boolean, val checks: Boolean, val screen: Boolean)

    /** A read a wake sends, made [at] under the stamp [sent]: [session]'s check-in, or, none, `GET /v1/me`. */
    private class Read(val sent: ReconcileStamp, val at: Instant, val session: String? = null)

    /**
     * The top of a pass, which answers every ring made before it and takes what each rang for: where the
     * phone stood, read again while unread; a wait past its end ended; whether the truth is read; and
     * whether it checks in, rule 3's check first: while the screen is on, in a session or out (C1c), and,
     * in a session, as it goes on or off. What a ring made after it rang for is the next pass's, so no pass
     * wakes for nothing, an early check-in, where iOS's can.
     */
    private suspend fun wake(): Wake {
        readRings.answer()
        readStanding()
        // Past the end of the day its tap was armed, the server has dropped it (decision 5), which a read
        // says (`armed`); with none answered, offline, the wait ends there too, at a wake: never Waiting
        // where no Start would lock the phone (#166).
        val ends = state.waitEnds
        if (state.standing == Standing.Waiting && ends != null && ends <= clock.now()) {
            update { it.copy(standing = Standing.Out) }
        }
        val inSession = state.standing is Standing.InSession
        // Waiting for the teacher's Start, the truth is read at each wake while the screen is on, at the
        // check-in's cadence, since no answer of the phone's own brings the Start, and no feed does
        // (decision 6, the owner's ruling, 2026-09-29; C3a). Out of a session, in a class, by the same rule,
        // so Home says when a class of theirs is in session (C3c); and out of one as the screen comes on, as
        // iOS's coming back reads it.
        val waiting = screenOn && state.standing == Standing.Waiting
        val outInClass = screenOn && state.standing == Standing.Out && state.hasClasses == true
        val reads = rereading || waiting || outInClass || screenTurned && screenOn && !inSession
        val wake = Wake(reads, checks = screenOn || screenTurned && inSession, screen = screenTurned && inSession)
        rereading = false
        screenTurned = false
        return wake
    }

    /**
     * What [wake] sends, under a stamp taken now: the screen's own check-in first, a read asked for then
     * the next wake's, at once; else the read of the truth; else the check-in, in a session; none. A
     * check that failed ([checked] false) claims nothing. A stamp the file can't give sends none, and is
     * shown, a read then left to the next wake.
     */
    private suspend fun reading(wake: Wake, checked: Boolean): Read? {
        val sent = stored { stamp() }.getOrNull()
        if (sent == null) {
            if (wake.reads) rereading = true
            return null
        }
        val session = (state.standing as? Standing.InSession)?.session?.id
        return when {
            wake.screen && checked && session != null -> Read(sent, clock.now(), session).also { if (wake.reads) reread() }
            wake.reads -> Read(sent, clock.now())
            checked && session != null -> Read(sent, clock.now(), session)
            else -> null
        }
    }

    /**
     * `GET /v1/me`'s answer: the truth reconciled, its classes in the same step; none says why (rule 5),
     * and is read again at the next wake.
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
        // Written back at once, filing whatever the file holds waiting to be ([keepStanding]); an out an
        // arming was carried onto waits ([armed]).
        kept = null
        val known = if (armed && standing == Standing.Out) Standing.Waiting else standing
        update { it.copy(standing = known) }
    }

    /**
     * `GET /v1/me`'s answer, as a standing: its live session, or none; waiting, while armed and the read
     * doesn't say no tap of the student's waits (#166). Silence is still focus, and a state this build
     * doesn't know is never focus. A session over by the phone's own clock (data model, decision 6) isn't
     * the Start a waiting phone waits for: the sweep that ends it on the server may run late, and it would
     * end the wait with no class to be in (C3).
     */
    private fun standing(me: MeResponse): Standing {
        val waiting = (state.standing == Standing.Waiting || armed) && me.armed != false
        val session =
            me.session?.takeIf { !waiting || it.endsAt > clock.now() } ?: return if (waiting) Standing.Waiting else Standing.Out
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
        val focus = (read as? Standing.InSession)?.takeIf { applies && it.state == ParticipationState.Focused }
        val keeps = if (focus != null) keepsUnlocked(focus.session.id) else false
        val standing = if (keeps == false) read else focus?.copy(state = ParticipationState.Unlocked) ?: read
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
     * the caller to show after its state step. Focused already means returned since only while every
     * unlock takes the phone out of focus at once (`Standing.acting`) and nothing brings it back but a
     * refocus, an answer or a read past this guard, or the lock back on to where the phone stood before
     * protection off or, not known, past this guard (#167, [recording]'s): keep both so.
     */
    private suspend fun keepsUnlocked(session: String, after: Long = 0): Boolean? =
        if (state.standing.isFocused(session)) false else tried { outbox.holdsUnlock(session, after) }.getOrNull()

    private suspend fun stamp() = ReconcileStamp(changes, outbox.awaiting())

    /**
     * Queues what the phone just did, acted on at once, and sends it; none when there's nothing to send
     * (protection off already reported, or the lock back on where the phone isn't protection off).
     * Throws when it couldn't be written: the caller shows it (rule 5). The student acting again ends a
     * refusal's showing, and a late unlock's. An Emergency Unlock goes through [emergencyUnlock] or
     * [pressUnlock], which file it where decision 11 says; [hold] delays the send of one waiting for its
     * reason (C5a). Its caller cancelled, it stops waiting, and the record is made all the same.
     */
    suspend fun record(change: Change, hold: Duration = Duration.ZERO): OutboxRecord? = call { recording(change, hold) }

    /** [record]'s stretch, for a call that records from inside its own. */
    private suspend fun recording(change: Change, hold: Duration): OutboxRecord? {
        // Standing focused there, the phone's row is focused again (a re-tap older than its last report can
        // put it back, A13), so protection off found now is reported again.
        if (change is Change.ProtectionOff && state.standing.isFocused(change.session)) outbox.protectionRestored()
        // The lock back on (#167) only out of protection off there: a second, from a check that overlapped
        // the first, finds the phone back where it stood and records nothing (santa's round 1). It returns
        // where the phone stood before protection off; not known, past the unlock guard: an Emergency
        // Unlock still queued there keeps it unlocked, as does a file that can't say, shown after the step.
        var unread = false
        val offFrom =
            if (change !is Change.ProtectionOn) {
                null
            } else {
                val stood = state.standing
                val off = stood is Standing.InSession && stood.session.id == change.session && stood.state == ParticipationState.ProtectionOff
                if (!off) return null
                tried { outbox.offFrom() }.onFailure { unread = true }.getOrNull()
                    ?: when (keepsUnlocked(change.session)) {
                        false -> ParticipationState.Focused
                        true -> ParticipationState.Unlocked
                        null -> ParticipationState.Unlocked.also { unread = true }
                    }
            }
        // Where it leaves the phone is kept in the change's own write: killed between two, a relaunch would
        // stand where the phone stood before, locked over an Emergency Unlock. Never where it stands unread,
        // whose keeping would undo the write, the change with it.
        val standing = state.standing.acting(change, offFrom)
        val keeping = standing.takeIf { it != Standing.Unread }
        val record = outbox.record(change, clock.now(), keeping, hold) ?: return null
        if (keeping != null) kept = keeping
        changes += 1
        // A read that fails keeps the last list, with this record, which the file holds now: the phone acts
        // on what it just did (an unlock's lock off, a tap's on) whatever the read.
        val queued = tried { outbox.records() }
        val reportedOff = tried { outbox.reportedOff() }
        update { now ->
            // The file's newest tap now, written with it.
            val lastTap = if (change is Change.Tap) record.eventId else now.lastTap
            val off = reportedOff.getOrElse { now.reportedOff }
            // The lock going off or coming back is no turn of the student's (A9): the unlock recorded still
            // stands, its reason changeable once back on (A20; santa's round 1).
            val recorded = now.recordedUnlock.takeUnless { change.isUnlock || change.isReturn }
            now.copy(
                standing = standing, queued = queued.getOrElse { now.queued + record }, reportedOff = off, lastTap = lastTap,
                refused = null, superseded = null, recordedUnlock = recorded,
            )
        }
        // Shown after that step, never before it: then the standing this record replaced would be kept again.
        if (unread || queued.isFailure || reportedOff.isFailure) failed()
        drainRings.ring()
        return record
    }

    /**
     * A scan of the block (B6): a Bali block's code becomes the tap, recorded and sent; anything else
     * (another tag, a scan cancelled, a phone that can't read NFC) records nothing.
     */
    suspend fun tap(read: BlockRead): OutboxRecord? = (read as? BlockRead.Block)?.let { record(Change.Tap(it.code)) }

    /**
     * The student's Emergency Unlock, recorded where [SyncState.emergencyUnlock] files it; none when
     * nothing the phone knows locks. Throws when it couldn't be written, as [record].
     */
    suspend fun emergencyUnlock(reason: UnlockReason? = null): OutboxRecord? =
        call { state.emergencyUnlock(reason)?.let { recording(it, Duration.ZERO) } }

    /**
     * Emergency Unlock as the screens press it (C4): its send held [REASON_HOLD] where the Unlocked screen
     * then asks why, in a session (C5a), and never past its bell, so the class's grid shows it live; or
     * why it didn't go through (rule 5): nothing the phone knows locks any more (#116's review), or the
     * outbox refused it, never said as done. Its caller cancelled, it goes on all the same.
     */
    suspend fun pressUnlock(): UnlockFailure? =
        call {
            val unlock = state.emergencyUnlock(null) ?: return@call UnlockFailure.NothingToUnlock
            val bell = (state.standing as? Standing.InSession)?.session?.endsAt
            val hold = bell?.let { minOf(REASON_HOLD, maxOf(Duration.ZERO, Duration.between(clock.now(), it))) } ?: Duration.ZERO
            if (tried { recording(unlock, hold) }.isFailure) UnlockFailure.NotSaved else null
        }

    /**
     * The student's reason for their latest Emergency Unlock (C5a): sent with it, at once, while it has
     * never been sent; once the server has recorded it, a change of it (A20, `PATCH /v1/unlocks/{eventId}`,
     * its token renewed once on a 401), sent with the engine let go; or why not (rule 5): not saved, on
     * its way, or why the change didn't go. Its caller cancelled, it goes on all the same.
     */
    suspend fun explain(reason: UnlockReason): ReasonFailure? =
        scope.async {
            when (val pick = alone { pick(reason) }) {
                is Pick.Done -> pick.failure
                is Pick.Change -> renewing { client.changeReason(pick.unlock, pick.request) }.let { alone { changed(pick, it) } }
            }
        }.await()

    /** What [explain] does in its first stretch: the reason kept with the unlock, or the change to send. */
    private suspend fun pick(reason: UnlockReason): Pick {
        val kept = tried { outbox.explain(reason, clock.now(), state.sending) }.getOrElse { return Pick.Done(ReasonFailure.NotSaved) }
        if (kept) {
            refreshQueue()
            drainRings.ring()
            return Pick.Done(null)
        }
        val here = state.standing.sessionId
        val recorded =
            state.recordedUnlock?.takeIf { here != null && it.session == here && state.unlockIn(here) == null }
                ?: return Pick.Done(ReasonFailure.OnItsWay)
        val again = unanswered?.takeIf { it.unlock == recorded.unlock && it.request.reason == reason }
        return again ?: Pick.Change(recorded.unlock, UnlockReasonRequest(reason, EventId.mint(clock.now())))
    }

    /**
     * A change of the reason, answered: kept, unless the phone has moved on meanwhile; a change of its own
     * clears it, and then this answer leaves the next unlock's last change alone (#140, santa's round 2).
     */
    private suspend fun changed(pick: Pick.Change, answer: ApiResponse<UnlockReasonResponse>): ReasonFailure? {
        val current = state.recordedUnlock?.unlock == pick.unlock
        if (current) unanswered = pick.takeIf { answer.result == SendResult.NetworkError }
        val kept = answer.answer?.reason?.known ?: return ReasonFailure.NotChanged(answer.result, answer.error?.error?.reason)
        if (current) update { it.copy(recordedUnlock = it.recordedUnlock?.copy(reason = kept)) }
        return null
    }

    /** What [explain] does with a pick, its first stretch done. */
    private sealed interface Pick {
        /** Nothing left to send: kept with the unlock (none), or why not. */
        class Done(val failure: ReasonFailure?) : Pick

        /** A change of the reason the server recorded for [unlock] (A20). */
        data class Change(val unlock: String, val request: UnlockReasonRequest) : Pick
    }

    /**
     * Back to focus (C5a): the refocus of the session the phone stands unlocked in, none where it stands
     * in none, and another screen shows; or the refocus not saved (rule 5). Its caller cancelled, it goes
     * on all the same.
     */
    suspend fun backToFocus(): RefocusFailure? =
        call {
            val stood = (state.standing as? Standing.InSession)?.takeIf { it.state == ParticipationState.Unlocked } ?: return@call null
            if (tried { recording(Change.Refocus(stood.session.id), Duration.ZERO) }.isFailure) RefocusFailure.NotSaved else null
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
     * The screen went on, or off, as the lock's service hears it (AN7; ARCHITECTURE, the battery plan):
     * a check-in at once in a session, or, out of one as it comes on, the truth read; while it is on, a
     * check-in every 30 seconds, rule 3's check at each wake; while off, nothing. The drain looks again,
     * as on iOS: a phone's sleep stretches a backoff. Its caller cancelled, it goes on all the same.
     */
    suspend fun setScreenOn(on: Boolean) =
        call {
            screenOn = on
            screenTurned = true
            readRings.ring()
            drainRings.ring()
        }

    /**
     * Bali's own screen came to the front, its truth read at once as iOS's coming back reads it, or went
     * behind: no reason is coming, so an unlock held for one goes now (C5a). Its caller cancelled, it goes on.
     */
    suspend fun setInFront(front: Boolean) =
        call {
            if (front) reread() else stored { outbox.release(clock.now()) }
            drainRings.ring()
        }

    /**
     * Runs [check], rule 3's check of the lock (the enforcer's, [Enforcer.run]), before each check-in, and
     * at each wake while the screen is on, out of a session too (C1c), with the engine let go, so it may
     * record what it finds. It never throws, as Swift's type promises; one that does checked nothing: that
     * wake sends no check-in.
     */
    suspend fun atEachWake(check: suspend () -> Unit) = call { this.check = check }

    /**
     * A shorter cap than decision 7's on a tap not yet answered, none: decision 7's, for the phone check
     * (B5b's), which a Debug build runs at 15 minutes rather than wait out 50 (AN7d's readout). Made in the
     * state's one step, so the lock follows it at once. Its caller cancelled, it goes on all the same.
     */
    suspend fun setTapCap(cap: Duration?) = call { update { it.copy(cap = cap ?: SyncState.TAP_CAP) } }

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
     * publishes it, if it changed. A standing known carries an arming no further ([armed]), as iOS's
     * `didSet` has it.
     */
    private suspend fun update(change: (SyncState) -> SyncState) {
        val last = state
        state = change(last)
        if (state.standing != Standing.Unread) armed = false
        if (state.standing != kept && state.standing != Standing.Unread) keepStanding()
        if (state != last) published.value = state
    }

    /**
     * Where the phone stood, and what it queued, each read on its own: the lock follows this state from
     * the start, so it must never begin from nothing. An unlock not filed yet acts on the standing, and
     * the first change files it ([keepStanding]), as it files whatever the file holds when its queue
     * couldn't be read. A wait's end it can't read is none, unshown as iOS's: a read of the truth then
     * ends the wait.
     */
    private suspend fun load() {
        val queued = tried { outbox.records() }.getOrNull()
        val reportedOff = tried { outbox.reportedOff() }.getOrNull()
        val lastTap = tried { outbox.lastTap() }.getOrNull()
        val waitEnds = tried { outbox.waitEnds() }.getOrNull()
        val standing = tried { outbox.standing() }.getOrNull()
        state =
            SyncState(
                standing = standing ?: Standing.Unread, queued = queued.orEmpty(), reportedOff = reportedOff,
                lastTap = lastTap, link = Link.StorageFailed.takeIf { queued == null || standing == null },
                waitEnds = waitEnds,
            )
        if (standing != null && queued != null && !state.holdsUnfiled) kept = standing
        published.value = state
    }

    /**
     * Any answer, or none, for [SyncState.link], and when the server last answered; any status but a 401
     * ends a rejection ([refreshed]). A 401 is sign-in's: once per rejection, [refresh] giving a fresh
     * token sends everything again at once; a fresh token refused too waits out the backoff, or for the
     * sign-in's [retryNow]; one that gives none is asked again at the next 401. Returns that refresh,
     * started here or shared, for its caller to wait for with the engine let go, after a stretch that has
     * nothing of a 401's to apply, where Swift waits in `heard`.
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
        // In the engine's scope, so a loop cancelled while it waits leaves it to end for the other; and
        // ended however it ends, so no refresh is left under way for every later 401 to wait on.
        return reauth ?: scope.async {
            var fresh = false
            try {
                fresh = hooked(false) { refresh() }
            } finally {
                reauthed(fresh)
            }
        }.also { reauth = it }
    }

    /**
     * What a hook of the app's gives ([refresh], rule 3's check), or [none] when it throws or ends in a
     * cancel of its own (a timeout in it), though each promises not to: no hook ends a loop or leaves a
     * refresh under way for good. Its caller's own cancel still ends it.
     */
    private suspend fun <T> hooked(none: T, hook: suspend () -> T): T =
        try {
            hook()
        } catch (cancelled: CancellationException) {
            currentCoroutineContext().ensureActive()
            none
        } catch (error: Exception) {
            none
        }

    /**
     * A screen's own call, [send]: sent once more when the API refused its token and [refresh] renewed it,
     * as the loops do for their own; a refresh that gives none leaves the 401, said. iOS's
     * `Joining.send(renewing:)`, the engine's own until AN9 gives it to `Joining`.
     */
    private suspend fun <A> renewing(send: suspend () -> ApiResponse<A>): ApiResponse<A> {
        val answer = send()
        return if (answer.result == SendResult.Status(401) && hooked(false) { refresh() }) send() else answer
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
         * How long an Emergency Unlock's send waits for the reason the Unlocked screen asks (C5a; A1: a
         * reason is kept once recorded): the unlock itself never waits, the lock off and the record queued
         * at once, and any change of the phone's, or Bali going behind, sends it sooner. The teacher sees it
         * at most this late, online.
         */
        val REASON_HOLD: Duration = Duration.ofSeconds(15)

        /**
         * The engine over [outbox], starting from its file: what the phone queued and where it stood. A
         * part it can't read is shown, the rest read all the same. Its calls run in [scope], the app's,
         * which outlives every screen. [refresh] is the sign-in's (AN6): refresh the token the API
         * refused, true once a fresh one is ready, asked once per rejection ([heard]). It must return at
         * once, since the loops wait on it: false when only the student can give a token, whose sign-in
         * then calls [retryNow]. It never throws, as Swift's type promises; one that does gives no token.
         */
        suspend fun open(
            outbox: Outbox, client: ApiClient, scope: CoroutineScope, clock: SyncClock = SystemClock,
            refresh: suspend () -> Boolean = { false },
        ): SyncEngine = SyncEngine(outbox, client, scope, clock, refresh).apply { lock.withLock { load() } }

        /**
         * The app's one engine, over the student's sign-in (B4), its client on the API at [api]: the
         * client's tokens are [signIn]'s, and so is a 401's refresh; every token the sign-in gets
         * otherwise, a sign-in or a renewal of its own, sends everything again at once ([retryNow]).
         * BaliOutbox's `SyncEngine.make`, but the 13+ yes the read loop records, AN9's.
         */
        suspend fun make(
            outbox: Outbox, api: URI, signIn: SignIn, scope: CoroutineScope,
            transport: HttpTransport = OkHttpTransport(), clock: SyncClock = SystemClock,
        ): SyncEngine {
            val engine = open(outbox, ApiClient(api, signIn, transport), scope, clock) { signIn.refresh() }
            signIn.whenTokenArrives { engine.retryNow() }
            return engine
        }
    }
}

/**
 * Why an Emergency Unlock didn't go through (rule 5), Focus.swift's `UnlockFailure`: the app's engine
 * hasn't started, the outbox refused to keep it, or nothing the phone knows locked by the end of the press
 * (its tap answered meanwhile, say: #116's review). The words are AN10's, from the approved boards.
 */
enum class UnlockFailure {
    /** The app has no engine yet: the app's to say, never the engine's. */
    NotStarted,

    /** The outbox refused the write, so nothing changed: holding again is the way on. */
    NotSaved,

    /** Nothing locked, so nothing was recorded: iOS's `nothing`. */
    NothingToUnlock,
}

/** Why a reason the student picked didn't take (C5a; rule 5). The words are AN10's, from the approved boards. */
sealed interface ReasonFailure {
    /** The outbox refused to keep it with the unlock: another try is the way on. */
    data object NotSaved : ReasonFailure

    /** The unlock is on its way, or stuck: no pick reaches it until the server has it. */
    data object OnItsWay : ReasonFailure

    /** The change of the reason the server recorded (A20) didn't go: its answer's [result], and its refusal's [reason]. */
    data class NotChanged(val result: SendResult, val reason: ApiErrorReason?) : ReasonFailure
}

/** Why Back to focus didn't go through (C5a; rule 5): the outbox refused to keep the refocus. The words are AN10's. */
enum class RefocusFailure { NotSaved }

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
