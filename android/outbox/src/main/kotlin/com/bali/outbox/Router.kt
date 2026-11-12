package com.bali.outbox

import java.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch

// The router's run (AN10b), BaliApp.swift's `shown` and `remember` and RootView.swift's bell: what the router reads, and when it
// chooses again. Its rules are Screen.kt's (AN10a); the app runs one for its life (AN10c), and the screens draw what it shows and
// give it what the student opened (Phase 10).

/**
 * Which screen shows now ([shown]), chosen by [Screen.choose] over what the phone knows: one a process (Q1), so it says a start's
 * problem with no engine. It reads the app's run ([runs]: the engine, its enforcer, and the account over its sign-in), the start's
 * problem ([problems], AN10c's), the phone's [notes] and the screens' [inputs] (Phase 10's), and chooses again at each of their
 * changes and wherever the phone's clock may change the answer: the bell of the session the phone stands in, and a tap's cap,
 * each slept towards and looked at again at each of [looks], Android saying the time was set and the screen coming on (AN10c's),
 * as [Screen.bell] has it. It keeps `everApproved` in the notes (Q3), and what the student opened while `keepsOpened` says. One
 * coroutine chooses, a bell's wake included, so the router holds no lock; it reads the account, the enforcer and the engine by
 * the value each last published, so it never waits on one, and the account's 13+ ask reads it the same way ([Account.routedBy]).
 */
class Router(
    private val runs: Flow<Run?>,
    private val problems: Flow<Problem?>,
    private val notes: Notes,
    private val inputs: Flow<Input> = emptyFlow(),
    private val looks: Flow<Unit> = emptyFlow(),
    private val clock: SyncClock = SystemClock,
) {
    /** The app's run (BaliApp's `Running`): its [engine], the [enforcer] over it, and the [account] over its sign-in, none over an engine with none (Q2). */
    class Run(val engine: SyncEngine, val enforcer: Enforcer, val account: Account?)

    /** What a screen tells the router (Phase 10's; BaliApp.swift's `open`, `back` and `select`). */
    sealed interface Input {
        /** [screen] opened over the one shown (C3): Join over Home, or Home over Waiting or Unlocked. */
        data class Open(val screen: Screen) : Input

        /** Back from the screen opened last. */
        data object Back : Input

        /** A tab chosen in the tab bar (C6a): Home, History or Me, honoured in Home's place alone. */
        data class Tab(val tab: Screen) : Input
    }

    private val published = MutableStateFlow(Screen.Shown(Screen.Starting, false))

    /** The screen to show now, and whether the tab bar shows under it: Starting until the router knows more. */
    val shown: StateFlow<Screen.Shown> = published.asStateFlow()

    // What the router chooses over, changed only in [run]'s one coroutine.
    private var current: Run? = null
    private var problem: Problem? = null
    private var everApproved = notes.everApproved
    private var opened: List<Screen> = emptyList()
    private var tab: Screen = Screen.Home

    /** The engine's state last chosen over, whose change `keepsOpened` judges, and the sign-ins seen, each sending the tab Home. */
    private var before: SyncState? = null
    private var signIns = 0

    /** Chooses at each change and at each moment the phone's clock may move the answer, until cancelled. */
    suspend fun run(): Unit =
        coroutineScope {
            val changes = Channel<Change>(Channel.UNLIMITED)
            launch { problems.collect { changes.send(Change.Failed(it)) } }
            launch { inputs.collect { changes.send(Change.Asked(it)) } }
            launch {
                runs.collectLatest { run ->
                    changes.send(Change.Ran(run))
                    // With no account (Q2), the engine's own state; with one, the account's, which carries the engine's.
                    if (run != null) merge(run.enforcer.updates, run.account?.state ?: run.engine.updates).collect { changes.send(Change.Read) }
                }
            }
            var bell: Job? = null
            var ringsAt: Instant? = null
            for (change in changes) {
                when (change) {
                    is Change.Ran -> {
                        current = change.run
                        change.run?.account?.routedBy { published.value.screen }
                    }
                    is Change.Failed -> problem = change.problem
                    is Change.Asked -> asked(change.input)
                    // A bell rung is let go: one the clock was set back past since starts again.
                    Change.Rang -> ringsAt = null
                    Change.Read -> Unit
                }
                val now = clock.now()
                val next = choose(now)?.let { wakes(it, now) }
                if (next != ringsAt) {
                    bell?.cancel()
                    ringsAt = next
                    bell =
                        next?.let { at ->
                            launch {
                                Screen.bell(at, looks, clock)
                                changes.send(Change.Rang)
                            }
                        }
                }
            }
        }

    /**
     * [Screen.choose] over what the phone knows at [now], published, BaliApp.swift's `shown`: the start's problem; the account's
     * sign-in, 13+ check, deletion, notes and engine's state, or, over an engine with no account (Q2), signed out, so Sign in,
     * never Starting forever, Focus still first for a typed tap; and what rule 3's check found. Returns the engine's state.
     */
    private fun choose(now: Instant): SyncState? {
        val run = current
        val account = run?.account?.state?.value
        val protection = run?.enforcer?.updates?.value
        val sync = if (run?.account == null) run?.engine?.updates?.value else account?.sync
        protection?.let(::remember)
        // What the student opened, and the tab chosen, go as `keepsOpened` says at each change of the engine's state (C3, C6a),
        // the tab at each change of who is signed in too.
        if (sync != null && sync != before) {
            if (!sync.keepsOpened(before, now)) {
                opened = emptyList()
                tab = Screen.Home
            }
            before = sync
        }
        if (account != null && account.signIns != signIns) {
            signIns = account.signIns
            tab = Screen.Home
        }
        val signedIn =
            when {
                run == null -> null
                run.account == null -> false
                else -> account?.signedIn
            }
        // Sign up's intro and Session over closed are inputs of AS2's and AS6's screens, none until then.
        val shown =
            Screen.choose(
                problem = problem, deleting = account?.deleting?.shows == true, age = account?.age ?: AgeCheck.Answer.Unanswered,
                intro = false, signedIn = signedIn, signedInThisRun = account?.signedInThisRun == true, protection = protection,
                everApproved = everApproved, sync = sync, listSeenBy = account?.listSeenBy, sessionOverClosed = null,
                opened = opened, tab = tab, now = now,
            )
        // No tab bar under Me while its name is edited, whose ways on are Save and Cancel (C6b).
        published.value = if (account?.naming?.editing == true && shown.screen == Screen.Me) shown.copy(tabbed = false) else shown
        return sync
    }

    /**
     * Keeps `everApproved` (C1b, Q3), BaliApp.swift's `remember`: set at a pass that read the switch on, cleared once the check
     * judges it off, left at a starting read, the one it's there to see past; the notes' too, so a relaunch reads it back.
     */
    private fun remember(protection: Protection) {
        val on = protection.switch == LockSwitch.On
        if ((on || protection.switchedOff) && everApproved != on) {
            everApproved = on
            notes.everApproved = on
        }
    }

    /**
     * The next moment after [now] the phone's clock may change the answer for [sync], where the router chooses again (C5a): the
     * bell of the session it stands in, and the cap of a tap not yet answered while it holds the lock. None: none.
     */
    private fun wakes(sync: SyncState, now: Instant): Instant? =
        listOfNotNull((sync.standing as? Standing.InSession)?.session?.endsAt, sync.tapHeldUntil).filter { it > now }.minOrNull()

    private fun asked(input: Input) {
        when (input) {
            is Input.Open -> opened = opened + input.screen
            Input.Back -> opened = opened.dropLast(1)
            is Input.Tab -> tab = input.tab
        }
    }

    /** Why the router chooses again: a run, a start's problem, a screen's input, a value one of the run's published, or a bell. */
    private sealed interface Change {
        class Ran(val run: Run?) : Change

        class Failed(val problem: Problem?) : Change

        class Asked(val input: Input) : Change

        data object Read : Change

        data object Rang : Change
    }
}
