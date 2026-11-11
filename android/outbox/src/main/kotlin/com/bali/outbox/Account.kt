package com.bali.outbox

import com.bali.core.EventId
import com.bali.core.Landing
import com.bali.core.SignIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// The phone's account half (C4, C7, C7-server), BaliApp.swift's `Phone`'s: who is signed in, followed as each sign-in lands
// (Q2); the 13+ check after a sign-in not through it, asked of Bali's server and again at each wake while unanswered (Q8); an
// answer under 13 held in memory for the run (Q5); forget me; and Delete account through the engine. Its rules alone: the
// router is AN10's, the screens Phase 10's, every word AN10's.

/**
 * The phone's account half (DECISIONS 2026-11-05, Q1), BaliApp.swift's `Phone`'s: one a run, over the engine and its
 * sign-in ([of]), which the app only wires ([run]); what the router reads is [state]. Swift's main actor is a lock no
 * stretch takes twice ([alone]), let go at each call into the engine or the sign-in; a screen's call runs in the account's
 * own scope ([call]), so a screen cancelled stops waiting, never the answer it waits for.
 */
class Account internal constructor(
    private val engine: SyncEngine,
    private val signIn: SignIn,
    scope: CoroutineScope,
    private val clock: SyncClock,
) {
    /** What the router reads (AN10): a value, each change a copy. */
    data class State(
        /** Whether someone is signed in, once the sign-in could say: none until then. */
        val signedIn: Boolean? = null,
        /**
         * A sign-in reached Bali's API this run, made here or let through by the 13+ check: the router holds its starting
         * screen until a read of `me` answers, so none flashes before Your name (the owner's ruling, 2026-10-07).
         */
        val signedInThisRun: Boolean = false,
        /**
         * The 13+ check as the router reads it (C7), iOS's `ageNow`: signed in, passed once through, checking while Bali's
         * server is asked, else the question, or the stop an answer under 13 got this run; signed out, Sign up's question.
         */
        val age: AgeCheck.Answer = AgeCheck.Answer.Unanswered,
        /** Me's Delete account (C4b): its own screen over every other while it [Deleting.shows]. */
        val deleting: Deleting = Deleting.None,
        /** The engine's state, one sent before the last forget of `me` without it (F11a-1): none until the first. */
        val sync: SyncState? = null,
    )

    private val scope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val mutex = Mutex()
    private val published = MutableStateFlow(State())

    /** What the router reads, now and at each change: the newest only. */
    val state: StateFlow<State> = published.asStateFlow()

    private var signedIn: Boolean? = null
    private var signedInThisRun = false

    /** Whose tokens these are, the last one known: another student's sign-in is known by it, the sign-out between seen or not. */
    private var account: String? = null

    /** The sign-in's count of the sign-ins landed ([Landing.count]), as last followed. */
    private var landed = 0

    /** The changes of who is signed in ([signed]): an ask's answer from before one is the last sign-in's, dropped. iOS's `signIns`. */
    private var changes = 0

    /** The forgets of `me` asked of the engine: a state counting fewer ([SyncState.forgets]) was sent before the last. */
    private var forgets = 0

    /** The question this run (C7): an answer under 13 held here alone, written nowhere, until the process ends (Q5). */
    private var age = AgeCheck(AgeCheck.Answer.Unanswered)

    /** Whether the sign-in held now is through the 13+ check: none while Bali is asked ([askAge]), false once the question shows. */
    private var cleared: Boolean? = null

    /** Whether the last ask got no answer from Bali, so it is asked again at each wake ([askAgeAgain]). */
    private var unreached = false
    private var deleting: Deleting = Deleting.None
    private var engineState: SyncState? = null

    /**
     * Hands the engine the 13+ check's ask at each wake ([askAgeAgain]), then follows the engine's state and its sign-in,
     * each sign-in as it lands ([SignIn.landings]), until cancelled: BaliApp.swift's `start`'s and `follow`'s.
     */
    suspend fun run() {
        engine.askAgeAtEachWake { askAgeAgain() }
        coroutineScope {
            launch { engine.updates.collect { synced(it) } }
            signIn.landings().collect { landing ->
                val pending = landing.signedIn && signIn.deletionPending()
                val checked = landing.signedIn && signIn.checked()
                val (forget, ask) = alone { signed(landing, pending, checked) }
                if (forget) engine.forgetMe()
                if (ask) scope.launch { askAge() }
            }
        }
    }

    /** The engine's state as it comes, BaliApp.swift's `synced`: one sent before the engine forgot the last `me` comes without it. */
    internal suspend fun synced(state: SyncState) =
        alone {
            engineState = state
            publish()
        }

    /**
     * The 13+ question answered with [month] and [year] (C7), AS2's screen's call: held in memory alone, for this run (Q5).
     * Signed in, the sign-in not through the check (the gap's fallback): 13 or older lets it through, its yes kept with the
     * sign-in of the account the question was for ([SignIn.passed]), never another's landed since, and sent at the engine's
     * next wake; under 13 deletes its account as Delete account does. Signed out, Sign up's question, held for its page
     * (AS2's). Nothing once answered under 13 this run, nor signed in while the question isn't due.
     */
    suspend fun answerAge(month: Int, year: Int): Unit =
        call {
            val (answer, changesThen, asked) =
                alone {
                    if (age.answer == AgeCheck.Answer.TooYoung || signedIn == true && cleared != false) return@alone null
                    age = age.answered(month, year, clock.now(), clock.zone())
                    publish()
                    Triple(age.answer, changes, account).takeIf { signedIn == true }
                } ?: return@call
            if (answer == AgeCheck.Answer.TooYoung) {
                alone { deleting = deleting.ask() }
                return@call delete()
            }
            if (signIn.passed(asked, recording = EventId.mint(clock.now()))) letThrough(changesThen)
        }

    /** Me's Delete account asked, its Cancel, or Back or OK on its screen: [step] one of Deleting's own (`ask`, `cancel`, `close`). */
    suspend fun deleting(step: (Deleting) -> Deleting) =
        alone {
            deleting = step(deleting)
            publish()
        }

    /**
     * Me's Delete account, confirmed, or the screen's Try again (C4b): the one engine call ([SyncEngine.deleteAccount]), its
     * screen showing meanwhile and its answer kept ([Deleting.answered]); nothing where no try can help, nor while one
     * runs. After an answer under 13 this run it is the gap's fallback's. Another account's sign-in landed since the press
     * (Q2), after the deletion's own last read of it too (AN9h's window), leaves nothing whose Try again would act on it: any
     * stop is [AccountDeletion.SignInChanged], and the account deleted on the server but not its sign-in is deleted, that
     * sign-in gone from the phone and its Cognito user the server's deleter's (C3-cognito; AN9b's call). The account deleted
     * on the server, its `me` goes too, as iOS's `forgetNotes` forgets it.
     */
    suspend fun deleteAccount(): Unit = call { delete() }

    private suspend fun delete() {
        // The sign-in the press was for, as the account followed it: how many had landed, and whose.
        val (young, count, holder) =
            alone {
                deleting = deleting.start() ?: return@alone null
                publish()
                Triple(age.answer == AgeCheck.Answer.TooYoung, landed, account)
            } ?: return
        val answer = engine.deleteAccount(signIn)
        val now = signIn.landings().first()
        val forget =
            alone {
                // Another account's sign-in landed since: read from the sign-in as the answer came, or followed since.
                fun another(landings: Int, of: String?) = landings != count && of != holder
                val since = another(now.count, now.account) || another(landed, account)
                val kept =
                    when {
                        !since || answer == AccountDeletion.Deleted -> answer
                        answer is AccountDeletion.SignInNotDeleted -> AccountDeletion.Deleted
                        else -> AccountDeletion.SignInChanged
                    }
                deleting = deleting.answered(kept, young)
                val gone = kept == AccountDeletion.Deleted || kept is AccountDeletion.SignInNotDeleted
                if (gone) forgot()
                publish()
                gone
            }
        if (forget) engine.forgetMe()
    }

    /**
     * Who is signed in, as [landing] says, [pending] the account deleted on the server with its sign-in still to go (a
     * relaunch lands on the deletion's screen) and [checked] the sign-in through the 13+ check: BaliApp.swift's `signed`,
     * but the screens' own (the tabs, the intro, a name or a code being typed, History, the lesson). A change is another
     * account's sign-in, the sign-out between seen or not, one after a sign-out, a sign-out, or any sign-in that lands, the
     * same account's again too (Q2), whose fresh tokens aren't through the check: Sign up's question kept while its page was
     * open goes, an ask on its way is dropped ([changes]), and Delete account's question or stop goes with the last sign-in.
     * Another student's `me` is forgotten, and so is one this run's sign-in has none of: a read that failed before it, with
     * no token to send, isn't its read ([forgot]). A sign-in not through the check is asked about it ([askAge]). Returns
     * whether the engine is to forget `me`, and whether to ask, each the caller's to do with the account let go.
     */
    private fun signed(landing: Landing, pending: Boolean, checked: Boolean): Pair<Boolean, Boolean> {
        val another = landing.account?.let { account != null && it != account } ?: (landing.signedIn && signedIn == false)
        val changed = landing.signedIn != signedIn || another || landing.count != landed
        if (changed) {
            if (age.answer == AgeCheck.Answer.Asked) age = AgeCheck(AgeCheck.Answer.Unanswered)
            changes += 1
            deleting = deleting.signInChanged()
        }
        if (pending && deleting == Deleting.None) deleting = Deleting.Pending
        // Made here, not the store read at launch (none before it).
        val forget = another || changed && landing.signedIn && signedIn != null && shown()?.me == null
        landing.account?.let { account = it }
        landed = landing.count
        signedIn = landing.signedIn
        val ask = landing.signedIn && !checked && changed
        when {
            !landing.signedIn || checked -> cleared = landing.signedIn.takeIf { it }
            changed -> cleared = null
        }
        if (forget) forgot()
        publish()
        return forget to ask
    }

    /**
     * Bali's server asked whether the account signed in has its 13+ yes (C7-server), BaliApp.swift's `askAge`: the one call a
     * sign-in makes before its age is settled, the starting mark meanwhile, under the account it names, read first from the
     * sign-in (AN9h). Yes, it is let through ([letThrough]). No, or Bali not reached (the safe side, no screen of its own):
     * the question; not reached, asked again at each wake. Dropped once who is signed in changed, the check passed or
     * answered under 13 meanwhile.
     */
    private suspend fun askAge() {
        val changesThen = alone { changes }
        val account = signIn.account()
        val answer = engine.ageCheck(account).answer
        val passed =
            alone {
                if (!due(changesThen)) return@alone false
                unreached = answer == null
                if (answer?.passed != true) cleared = false
                publish()
                answer?.passed == true
            }
        if (passed && signIn.passed(account)) letThrough(changesThen)
    }

    /**
     * At each of the engine's wakes ([SyncEngine.askAgeAtEachWake]): Bali's server asked again for the account's 13+ yes while
     * the last ask couldn't reach it and the sign-in isn't through (Q8), so a yes lets it through before the bell, an
     * Emergency Unlock with it (#300's review). AN10 adds the router's condition: never while the question shows.
     */
    private suspend fun askAgeAgain() {
        if (alone { unreached && cleared == false && age.answer != AgeCheck.Answer.TooYoung }) askAge()
    }

    /**
     * The sign-in let through the 13+ check, unless who is signed in changed since [changes]: Bali's API given its token, what
     * the phone knew of `me` forgotten and read again, and everything queued sent at once.
     */
    private suspend fun letThrough(changesThen: Int) {
        val through =
            alone {
                due(changesThen).also { through ->
                    if (!through) return@also
                    cleared = true
                    forgot()
                    publish()
                }
            }
        if (!through) return
        engine.forgetMe()
        engine.retryNow()
    }

    /** Whether an ask or an answer begun at [changesThen] still holds: who is signed in the same, not through, nor under 13. */
    private fun due(changesThen: Int) = changesThen == changes && cleared != true && age.answer != AgeCheck.Answer.TooYoung

    /**
     * A sign-in reaching Bali's API this run, made here or let through by the 13+ check: what the phone knew of `me` is shown
     * no more ([shown]), and the engine is to forget it ([SyncEngine.forgetMe]), its caller's next call. iOS's `forgetMe`.
     */
    private fun forgot() {
        signedInThisRun = true
        forgets += 1
    }

    private fun publish() {
        val ageNow =
            when {
                signedIn != true || age.answer == AgeCheck.Answer.TooYoung -> age.answer
                cleared == true -> AgeCheck.Answer.Passed
                cleared == false -> AgeCheck.Answer.Unanswered
                else -> AgeCheck.Answer.Checking
            }
        published.value = State(signedIn, signedInThisRun, ageNow, deleting, shown())
    }

    /** The engine's state as the app may show it: one counting fewer forgets than the app asked for, without its `me`. */
    private fun shown(): SyncState? = engineState?.let { if (it.forgets < forgets) it.copy(me = null, meFailed = null) else it }

    /** Runs [block] in the account's own scope: its caller cancelled stops waiting at once, and the call goes on. */
    private suspend fun <T> call(block: suspend () -> T): T = scope.async { block() }.await()

    /**
     * Runs [block] with the account to itself, as a stretch of Swift's main actor, and never cut short, so a cancel lands
     * after it. Never from inside another: the lock is no reentrant one.
     */
    private suspend fun <T> alone(block: () -> T): T = withContext(NonCancellable) { mutex.withLock { block() } }

    companion object {
        /**
         * The account half over [engine]'s sign-in, [SyncEngine.make]'s, its calls in [scope], the app's; none for an engine
         * opened without one, a Debug build's while sign-in isn't set up.
         */
        fun of(engine: SyncEngine, scope: CoroutineScope, clock: SyncClock = SystemClock): Account? =
            engine.signIn?.let { Account(engine, it, scope, clock) }
    }
}
