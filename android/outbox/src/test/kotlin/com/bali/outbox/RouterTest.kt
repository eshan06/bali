package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.SendResult
import java.io.IOException
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

// The router's run (AN10b): BaliApp.swift's `shown`, `remember`, `synced`'s note and `sawList`, and RootView.swift's bell, over the
// engine, the enforcer and the account as the app runs them: AppTests' everApproved, everInClass and listOnce, and ageAgainInClass's
// router half. And new: a start's problem with no engine (Q1); a Debug engine with no account (Q2); a tap's cap and a bell each
// choosing again; and the account and the router each reading the other's last published value, neither waiting on the other's lock.

/** A run as the app makes one (BaliApp's `start`), and the router over it, each running: what a test drives. */
class Routed(val router: Router, val enforcer: Enforcer, val account: Account?, val lock: FakeLock, val inputs: Channel<Router.Input>) {
    suspend fun until(condition: (Screen.Shown) -> Boolean): Screen.Shown = router.until(condition)

    /** The student or Android switches Bali's service [to], and rule 3's check reads it. */
    suspend fun switched(to: LockSwitch) {
        lock.set(to)
        enforcer.check()
    }
}

/**
 * [engine] run as the app runs it, by [clock]: an enforcer over [lock], the account over the engine's sign-in with [notes], none
 * over an engine with none, and the router over them with the same notes, the screens' inputs the test's, Android's [looks], and
 * [routerClock], by default the rig's.
 */
fun EngineFiles.routed(
    engine: SyncEngine, clock: TestClock, lock: FakeLock = FakeLock(clock), notes: Notes = MemoryNotes(), looks: Flow<Unit> = emptyFlow(),
    routerClock: SyncClock = clock,
): Routed {
    val enforcer = Enforcer(engine, lock, scope, clock)
    val account = Account.of(engine, scope, clock, notes)
    scope.launch(start = CoroutineStart.UNDISPATCHED) { enforcer.run() }
    account?.let { scope.launch(start = CoroutineStart.UNDISPATCHED) { it.run() } }
    val inputs = Channel<Router.Input>(Channel.UNLIMITED)
    val runs = MutableStateFlow(Router.Run(engine, enforcer, account))
    val router = Router(runs, MutableStateFlow(null), notes, inputs.receiveAsFlow(), looks, routerClock)
    scope.launch(start = CoroutineStart.UNDISPATCHED) { router.run() }
    return Routed(router, enforcer, account, lock, inputs)
}

/** Waits for an answer [condition] holds for, and returns it; none in time fails the test. */
suspend fun Router.until(condition: (Screen.Shown) -> Boolean): Screen.Shown =
    withTimeoutOrNull(patience) { shown.first(condition) } ?: fail("the router never showed what was waited for: ${shown.value}")

/** Waits for a claim [condition] holds for, and returns it; none in time fails the test. */
suspend fun Enforcer.until(condition: (Protection) -> Boolean): Protection =
    withTimeoutOrNull(patience) { updates.first(condition) } ?: fail("the enforcer never reached the claim waited for: ${updates.value}")

/** `GET /v1/me`'s answer for student [id], named so, in [classes], each as [Answer.inClass] writes one, in no session. */
private fun student(id: String, classes: List<String> = emptyList()) =
    """{"user":{"id":"$id","role":"student","displayName":"$id"},"classes":[${classes.joinToString(",")}],"session":null}"""

/** The truth read again, as a Try again reads it, each read answered with [me] until [done]. */
private suspend fun SignedRig.reread(me: String, done: () -> Boolean) {
    engine.retryNow()
    readsAnswered(me, done)
}

/**
 * The notes, a write of the consent list's note held once [arm]ed until [release], as a slow disk would hold it, the account's
 * lock with it: for twice the test's patience at most, so a router that waits on that lock fails its own wait by name first.
 */
private class HeldNotes(private val kept: Notes = MemoryNotes()) : Notes by kept {
    private val armed = AtomicBoolean(false)
    private val begun = CompletableDeferred<Unit>()
    private val released = CountDownLatch(1)

    override var listSeenBy: String?
        get() = kept.listSeenBy
        set(value) {
            if (armed.get()) {
                begun.complete(Unit)
                released.await(2 * patience.inWholeMilliseconds, TimeUnit.MILLISECONDS)
            }
            kept.listSeenBy = value
        }

    fun arm() = armed.set(true)

    /** Waits for the write to begin; none in time fails the test. */
    suspend fun began() = withTimeoutOrNull(patience) { begun.await() } ?: fail("no write began")

    fun release() {
        armed.set(false)
        released.countDown()
    }
}

/** The router's run (AN10b). */
class RouterTest : EngineFiles() {
    @Test
    fun aStartsProblemShowsWithNoEngineThenTheRunsScreensAndEachChangeOfTheAccountTheEnforcerOrTheEngineIsChosenAgain(): Unit =
        runBlocking {
            // Q1: one router a process, so a start's problem shows with no engine, each a type (rule 5), and none is Starting.
            val rig = signedRig(gated = true)
            val (runs, problems) = MutableStateFlow<Router.Run?>(null) to MutableStateFlow<Problem?>(null)
            val router = Router(runs, problems, MemoryNotes(), clock = rig.clock)
            scope.launch(start = CoroutineStart.UNDISPATCHED) { router.run() }
            router.until { it == Screen.Shown(Screen.Starting, false) }
            problems.value = Problem.NotSetUp
            router.until { it == Screen.Shown(Screen.Storage(Problem.NotSetUp), false) }
            val failed = Problem.StartFailed(IOException("disk I/O error"))
            problems.value = failed
            router.until { it.screen == Screen.Storage(failed) }
            problems.value = null
            router.until { it.screen == Screen.Starting }
            // The run, its account signed out: Sign in.
            val lock = FakeLock(rig.clock)
            val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
            val account = checkNotNull(Account.of(rig.engine, scope, rig.clock))
            scope.launch { enforcer.run() }
            scope.launch { account.run() }
            runs.value = Router.Run(rig.engine, enforcer, account)
            router.until { it == Screen.Shown(Screen.SignIn, false) }
            // The account's change: signed in through the 13+ check, Home.
            rig.through(account, accessToken("a1"), me = Answer.me(null, name = "Ana"))
            router.until { it == Screen.Shown(Screen.Home, true) }
            // The enforcer's: the switch off, the permission step; on again, Home.
            lock.set(LockSwitch.Off)
            enforcer.check()
            router.until { it == Screen.Shown(Screen.Permission, false) }
            lock.set(LockSwitch.On)
            enforcer.check()
            router.until { it == Screen.Shown(Screen.Home, true) }
            // The engine's: a tap, Focus at once (decision 7), still once answered focused in the session; its bell, Session over.
            assertNotNull(rig.engine.record(Change.Tap("tag")))
            router.until { it == Screen.Shown(Screen.Focus, false) }
            rig.server.next(tapRoute).reply(200, Answer.joined())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) && it.queued.isEmpty() }
            assertEquals(Screen.Shown(Screen.Focus, false), router.shown.value)
            rig.clock.advance(3000)
            router.until { it == Screen.Shown(Screen.SessionOver, false) }
            rig.stop()
        }

    @Test
    fun aDebugEngineWithNoAccountReadsAsSignedOutNeverStartingFocusForATypedTapToItsCapThenSignInByTheRoutersOwnWake(): Unit =
        runBlocking {
            // Q2: a Debug build's engine while sign-in isn't set up has no account, so signed out: Sign in, never Starting forever,
            // the lock's own rule first, Focus for a typed tap (the readout's) to its cap (decision 7). At the cap the router chooses
            // again by its own wake, the enforcer's pass there held, so nothing else tells it (C5a).
            val rig = rig()
            assertNull(Account.of(rig.engine, scope, rig.clock))
            val phone = routed(rig.engine, rig.clock)
            phone.until { it == Screen.Shown(Screen.SignIn, false) }
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            val sent = rig.server.next(tapRoute) // on its way, never answered
            phone.until { it == Screen.Shown(Screen.Focus, false) }
            val cap = tap.recordedAt + SyncState.TAP_CAP
            phone.enforcer.until { it.until == cap }
            phone.lock.hold(after = 0)
            rig.clock.advance(SyncState.TAP_CAP)
            phone.until { it == Screen.Shown(Screen.SignIn, false) }
            assertEquals(cap, phone.enforcer.updates.value.until, "the enforcer's pass at the cap was held")
            phone.lock.release()
            sent.reply(null)
        }

    @Test
    fun theBellChoosesAgainByThePhonesClockOverAScreenNothingElseChangesAtAndSoDoesAClockSetPastItAtAndroidsSignal(): Unit =
        runBlocking {
            // RootView.swift's bell (C5a, C5b): Unlocked watches nothing at the bell, as Focus's lock does, so the router chooses
            // again there itself, by the phone's clock: the time passing, or the clock set past it, looked at again at Android's
            // signal (AN10c's), which a sleep doesn't count.
            val rig = signedRig(gated = true)
            val phone = routed(rig.engine, rig.clock)
            rig.through(checkNotNull(phone.account), accessToken("a1"), me = Answer.me(session(), state = "unlocked", name = "Ana"))
            phone.until { it == Screen.Shown(Screen.Unlocked, false) }
            rig.clock.advance(3000)
            phone.until { it == Screen.Shown(Screen.SessionOver, false) }
            // Focused, the clock set past the bell, then back before it, each at Android's signal: Session over, then Focus again,
            // the lock's own rule on by the clock though no bell waits then (santa's review), and the bell slept towards anew.
            val (looks, clock) = MutableSharedFlow<Unit>() to PhoneClock()
            val set = signedRig(gated = true)
            val signal = routed(set.engine, set.clock, looks = looks, routerClock = clock)
            set.through(checkNotNull(signal.account), accessToken("a1"), me = Answer.me(session(), name = "Ana"))
            signal.until { it == Screen.Shown(Screen.Focus, false) }
            eventually { clock.sleeps.size == 1 } // the bell asleep, its looks followed first
            clock.turn(Duration.ofSeconds(3000))
            looks.emit(Unit)
            signal.until { it == Screen.Shown(Screen.SessionOver, false) }
            clock.turn(Duration.ofSeconds(-3000))
            looks.emit(Unit)
            signal.until { it == Screen.Shown(Screen.Focus, false) }
            eventually { clock.sleeps.size == 1 }
            clock.advance(Duration.ofSeconds(3000))
            signal.until { it == Screen.Shown(Screen.SessionOver, false) }
            rig.stop()
            set.stop()
        }

    @Test
    fun theSwitchOnceReadOnIsKeptInTheNotesAStartingReadRoutesAsOnAFreshRouterReadsItBackAndOnceJudgedOffItGoes(): Unit =
        runBlocking {
            // AppTests' everApproved (C1b, Q3), in the notes as iOS keeps it in the phone's own defaults: set at a pass that read
            // the switch on, cleared once the check judges it off (off, or starting for the grace), left at a starting read.
            val rig = signedRig(gated = true)
            val notes = MemoryNotes()
            val phone = routed(rig.engine, rig.clock, FakeLock(rig.clock, LockSwitch.Starting), notes)
            rig.through(checkNotNull(phone.account), accessToken("a1"), me = Answer.me(null, name = "Ana"))
            phone.until { it == Screen.Shown(Screen.Permission, false) }
            assertFalse(notes.everApproved)
            phone.switched(LockSwitch.On)
            phone.until { it == Screen.Shown(Screen.Home, true) }
            assertTrue(notes.everApproved)
            // Starting, as Bali or the phone starts: routed as on, the flag kept, chosen at a tab taken with the switch so.
            phone.switched(LockSwitch.Starting)
            phone.enforcer.until { it.switch == LockSwitch.Starting }
            phone.inputs.send(Router.Input.Tab(Screen.History))
            phone.until { it == Screen.Shown(Screen.History, true) }
            assertTrue(notes.everApproved)
            // A fresh router over the same notes, a relaunch's: read back, so starting routes as on there too.
            val fresh = Router(MutableStateFlow(Router.Run(rig.engine, phone.enforcer, phone.account)), MutableStateFlow(null), notes, clock = rig.clock)
            scope.launch { fresh.run() }
            fresh.until { it == Screen.Shown(Screen.Home, true) }
            // Starting for the grace: judged off, the flag gone, the permission step.
            rig.clock.advance(Enforcer.GRACE)
            phone.until { it == Screen.Shown(Screen.Permission, false) }
            assertFalse(notes.everApproved)
            // On, then off: gone again.
            phone.switched(LockSwitch.On)
            phone.until { it == Screen.Shown(Screen.History, true) }
            assertTrue(notes.everApproved)
            phone.switched(LockSwitch.Off)
            phone.until { it == Screen.Shown(Screen.Permission, false) }
            assertFalse(notes.everApproved)
            rig.stop()
        }

    @Test
    fun whoseClassesWereListedIsKeptInTheNotesByStudentWhatTheyOpenedStaysAtAReadSayingNoneAndTheTabGoesHomeAtASignIn(): Unit =
        runBlocking {
            // AppTests' everInClass (#143): kept in the notes, read back by a fresh account; in no class later, Home, its card
            // saying none any more, nothing the student opened closing for it, as keepsOpened says (C3, C6a); keyed on the
            // student, so another student in no class has none yet.
            val rig = signedRig(gated = true)
            val notes = MemoryNotes().apply { listSeenBy = "ana" }
            val phone = routed(rig.engine, rig.clock, notes = notes)
            val account = checkNotNull(phone.account)
            rig.through(account, accessToken("a1"), me = student("ana", listOf(Answer.inClass("p3"), Answer.inClass("p5"))))
            val anas = checkNotNull(account.state.value.sync)
            phone.until { it == Screen.Shown(Screen.Home, true) }
            assertEquals("ana", notes.inClass)
            assertEquals("ana", Account.of(rig.engine, scope, rig.clock, notes)?.state?.value?.inClass)
            // Removed from both while Join, opened over Home, shows: Join stays at the read saying so, a choice made over that
            // read (the switch off, then on) showing it still there; Back, Home with its tab bar.
            phone.inputs.send(Router.Input.Open(Screen.Join))
            phone.until { it == Screen.Shown(Screen.Join, false) }
            rig.reread(student("ana")) { account.state.value.sync?.me?.classes?.isEmpty() == true }
            phone.switched(LockSwitch.Off)
            phone.until { it == Screen.Shown(Screen.Permission, false) }
            phone.switched(LockSwitch.On)
            phone.until { it == Screen.Shown(Screen.Join, false) }
            phone.inputs.send(Router.Input.Back)
            phone.until { it == Screen.Shown(Screen.Home, true) }
            assertTrue(account.state.value.everInClass)
            assertEquals("You're not in any classes. Join one with the class code from your teacher.", account.state.value.noClassesCard)
            // History chosen stays at a read saying none again; Me chosen, its name edited, shows no tab bar (C6b).
            phone.inputs.send(Router.Input.Tab(Screen.History))
            phone.until { it == Screen.Shown(Screen.History, true) }
            val reads = checkNotNull(account.state.value.sync).meReads
            rig.reread(student("ana")) { account.state.value.sync?.meReads == reads + 1 }
            phone.switched(LockSwitch.Off)
            phone.until { it == Screen.Shown(Screen.Permission, false) }
            phone.switched(LockSwitch.On)
            phone.until { it == Screen.Shown(Screen.History, true) }
            // A tap closes what was opened and the tab chosen, as keepsOpened says: Home once its answer leaves the phone out.
            assertNotNull(rig.engine.record(Change.Tap("tag")))
            phone.until { it == Screen.Shown(Screen.Focus, false) }
            rig.server.next(tapRoute).reply(200, Answer.replayNoSession)
            phone.until { it == Screen.Shown(Screen.Home, true) }
            phone.inputs.send(Router.Input.Tab(Screen.Me))
            phone.until { it == Screen.Shown(Screen.Me, true) }
            account.naming { it.edit("ana") to Unit }
            phone.until { it == Screen.Shown(Screen.Me, false) }
            // Ana signed out and back in, in no class: Home, the tab back there, and still kept as listed here.
            rig.signIn.signOut()
            phone.until { it == Screen.Shown(Screen.SignIn, false) }
            rig.through(account, accessToken("a1"), refresh = "refresh-2", me = student("ana"))
            phone.until { it == Screen.Shown(Screen.Home, true) }
            assertEquals("ana", notes.inClass)
            // Bea signs in, in no class: never listed here; a state of Ana's classes sent before Bea's sign-in, landing late, keeps
            // nobody; listed in a class herself, Bea is the one kept.
            rig.through(account, accessToken("b1"), refresh = "refresh-b", me = student("bea"))
            assertFalse(account.state.value.everInClass)
            assertEquals("You're not in a class yet. Join one with the class code from your teacher.", account.state.value.noClassesCard)
            account.synced(anas)
            assertEquals("ana", notes.inClass)
            rig.reread(student("bea", listOf(Answer.inClass("p3")))) { account.state.value.inClass == "bea" }
            assertEquals("bea", notes.inClass)
            rig.stop()
        }

    @Test
    fun theOneTimeScreenShowsOnceToAStudentListedInAClassWhoHasntSeenTheListHereSawListKeepsThemAndAnotherStudentGetsIt(): Unit =
        runBlocking {
            // AppTests' listOnce's rule (L8a): the screen's Continue, Join's preview and Me's What your teacher sees call `sawList`
            // (the list-changed screen's, AS4's and AS7's), kept in the notes, keyed on the student. L8a's own key has no twin.
            val rig = signedRig(gated = true)
            val notes = MemoryNotes()
            val phone = routed(rig.engine, rig.clock, notes = notes)
            val account = checkNotNull(phone.account)
            // Nothing while no read has named the student.
            account.sawList()
            assertNull(notes.listSeenBy)
            val inPeriod3 = listOf(Answer.inClass("p3"))
            rig.through(account, accessToken("a1"), me = student("ana", inPeriod3))
            phone.until { it == Screen.Shown(Screen.ListChanged, false) }
            account.sawList()
            phone.until { it == Screen.Shown(Screen.Home, true) }
            assertEquals("ana", notes.listSeenBy)
            assertEquals("ana", Account.of(rig.engine, scope, rig.clock, notes)?.state?.value?.listSeenBy)
            // Never again, a sign-out and back included.
            rig.signIn.signOut()
            phone.until { it == Screen.Shown(Screen.SignIn, false) }
            rig.through(account, accessToken("a1"), refresh = "refresh-2", me = student("ana", inPeriod3))
            phone.until { it == Screen.Shown(Screen.Home, true) }
            // Bea signs in, listed in Period 3: the screen, Ana still the one kept.
            rig.through(account, accessToken("b1"), refresh = "refresh-b", me = student("bea", inPeriod3))
            phone.until { it == Screen.Shown(Screen.ListChanged, false) }
            assertEquals("ana", notes.listSeenBy)
            rig.stop()
        }

    @Test
    fun theAskAtEachWakeNeverGoesWhileTheQuestionShowsTheWayOnThereOverFocusItCantShowSoBaliIsAskedAgainThere(): Unit =
        runBlocking {
            // AppTests' ageAgainInClass, its router half (Q8; BaliApp.swift's `askAgeAgain`): Bali not reached for the sign-in's
            // check, a wake asks again over Focus, the session's lock holding the question back.
            val (outbox, _) = makeOutbox()
            outbox.keep(Standing.InSession(session(), ParticipationState.Focused))
            val inClass = signedRig(outbox, gated = true)
            val focused = routed(inClass.engine, inClass.clock)
            inClass.signStudentIn(accessToken("a1"))
            val first = inClass.server.next(ageCheckRoute)
            inClass.until { it.meFailed == SendResult.NetworkError }
            first.reply(null)
            checkNotNull(focused.account).until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            focused.until { it == Screen.Shown(Screen.Focus, false) }
            inClass.engine.retryNow()
            inClass.server.next(ageCheckRoute).reply(200, ageCheckPassed)
            checkNotNull(focused.account).until { it.age == AgeCheck.Answer.Passed }
            // Out of a session the question shows: two wakes ask nothing, each the next one's check its mark (the screen on).
            val rig = signedRig(gated = true)
            val phone = routed(rig.engine, rig.clock)
            rig.signStudentIn(accessToken("a1"))
            val asked = rig.server.next(ageCheckRoute)
            rig.until { it.meFailed == SendResult.NetworkError }
            asked.reply(null)
            phone.until { it == Screen.Shown(Screen.Age, false) }
            val checks = AtomicInteger()
            phone.enforcer.until { it.checked }
            rig.engine.atEachWake { checks.incrementAndGet() }
            rig.engine.setScreenOn(true)
            eventually { checks.get() > 0 }
            val woken = checks.get()
            for (wake in 1..2) {
                rig.engine.retryNow()
                eventually { checks.get() >= woken + wake }
            }
            assertEquals(1, rig.server.sent.count { it.route == ageCheckRoute })
            assertEquals(Screen.Shown(Screen.Age, false), phone.router.shown.value)
            inClass.stop()
            rig.stop()
        }

    @Test
    fun eachWakesAskReadsTheRoutersLastScreenWithTheAccountLetGoSoARouterReadingTheAccountMeanwhileNeverWaitsOnIt(): Unit =
        runBlocking {
            // The riskiest part, the account's half: the ask reads the router while the router reads the account, each the other's
            // last published value. A read that takes the account's own lock returns, so the account holds none across it.
            val rig = signedRig(gated = true)
            val account = checkNotNull(Account.of(rig.engine, scope, rig.clock))
            scope.launch { account.run() }
            account.until { it.signedIn != null }
            rig.signStudentIn(accessToken("a1"))
            val first = rig.server.next(ageCheckRoute)
            rig.until { it.meFailed == SendResult.NetworkError }
            first.reply(null)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            val reads = AtomicInteger()
            account.routedBy {
                account.deleting { it }
                reads.incrementAndGet()
                Screen.Focus
            }
            rig.engine.retryNow()
            rig.server.next(ageCheckRoute).reply(200, ageCheckPassed)
            account.until { it.age == AgeCheck.Answer.Passed }
            assertTrue(reads.get() > 0)
            rig.stop()
        }

    @Test
    fun theRouterChoosesWhileTheAccountHoldsItsOwnLockReadingWhatTheAccountLastPublishedSoTheSwitchOffShowsAtOnce(): Unit =
        runBlocking {
            // The riskiest part, the router's half: it holds no lock of its own (one coroutine chooses), and reads the account's last
            // published state, so it never waits on the account's lock: held here in a write of the notes, a slow disk's.
            val rig = signedRig(gated = true)
            val notes = HeldNotes()
            val phone = routed(rig.engine, rig.clock, notes = notes)
            val account = checkNotNull(phone.account)
            rig.through(account, accessToken("a1"), me = Answer.me(null, name = "Ana"))
            phone.until { it == Screen.Shown(Screen.Home, true) }
            notes.arm()
            val seen = scope.async { account.sawList() }
            try {
                notes.began()
                phone.switched(LockSwitch.Off)
                phone.until { it == Screen.Shown(Screen.Permission, false) }
                assertFalse(seen.isCompleted, "the account's lock was let go before the router chose")
            } finally {
                notes.release()
            }
            withTimeout(patience) { seen.await() }
            assertEquals("u", notes.listSeenBy)
            rig.stop()
        }
}
