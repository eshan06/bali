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
// (Q2), and whose email it is; the 13+ check after a sign-in not through it, asked of Bali's server and again at each wake while
// unanswered and the question doesn't show (Q8); an answer under 13 held in memory for the run (Q5); forget me; the notes under
// the student (AN10b); Me's name and Leave, started afresh at each change of who is signed in; and Delete account through the
// engine. Its rules alone: the router is Router.kt's, the screens Phase 10's, every word AN10d's to AN10h's.

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
    private val notes: Notes,
) {
    /** What the router reads ([Router]): a value, each change a copy. */
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
        /**
         * Whose sign-in this is, as its tokens name it (#147), read at each sign-in that lands: Me says it by Sign out, so the
         * name a student's teachers see is never taken for it. None signed out, or where the tokens name none: never the last
         * student's.
         */
        val email: String? = null,
        /** The student `GET /v1/me` last listed in a class here, the notes' (#143): kept across a sign-out, keyed on the student. */
        val inClass: String? = null,
        /** The student who has seen the consent list as it stands here, the notes' (L8a): the router's one-time screen ([sawList]). */
        val listSeenBy: String? = null,
        /** Me's name (C6b) and AS2's Your name ([naming]), started afresh at each change of who is signed in. */
        val naming: Naming = Naming(),
        /** Me's Leave (C6c, [leaving]), started afresh likewise. */
        val leaving: Leaving = Leaving(),
        /** The changes of who is signed in, counted: at each, the router's tab goes back to Home, as iOS's `signed` sends it. */
        val signIns: Int = 0,
    ) {
        /** Whether the student `GET /v1/me` names has been listed in a class on this phone (#143): Home's empty state's words, AN10d's. */
        val everInClass: Boolean get() = inClass != null && sync?.me?.user?.id == inClass
    }

    private val scope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val mutex = Mutex()
    private val published = MutableStateFlow(State(inClass = notes.inClass, listSeenBy = notes.listSeenBy))

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

    /** The notes under the student, as the store held them as the account was made, then as the account keeps them. */
    private var inClass: String? = notes.inClass
    private var listSeenBy: String? = notes.listSeenBy
    private var email: String? = null
    private var naming = Naming()
    private var leaving = Leaving()

    /**
     * The screen the router showed last ([Router]), which the 13+ ask at a wake reads with the account let go, as the router
     * reads the account's last state, so neither waits on the other: none until a router reads this account.
     */
    @Volatile private var routed: (suspend () -> Screen?)? = null

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
                val email = if (landing.signedIn) signIn.email() else null
                val (forget, ask) = alone { signed(landing, pending, checked, email) }
                if (forget) engine.forgetMe()
                if (ask) scope.launch { askAge() }
            }
        }
    }

    /**
     * The engine's state as it comes, BaliApp.swift's `synced`: one sent before the engine forgot the last `me` comes without it,
     * and a student it lists in a class is kept as one in the notes (#143), replacing the last, the store's once no deletion runs
     * ([delete]).
     */
    internal suspend fun synced(state: SyncState) =
        alone {
            engineState = state
            shown()?.me?.takeIf { it.classes.isNotEmpty() && it.user.id != inClass }?.let {
                inClass = it.user.id
                if (deleting != Deleting.Busy) notes.inClass = it.user.id
            }
            publish()
        }

    /**
     * The consent list as it stands seen by the student `GET /v1/me` names (L8a), BaliApp.swift's `sawList`: Join's preview or
     * Me's What your teacher sees showing it, or the one-time screen's Continue (AS4's and AS7's calls). Kept in the notes, so
     * the router never shows them that screen again; nothing while no read has named them.
     */
    suspend fun sawList() =
        alone {
            val id = shown()?.me?.user?.id
            if (id == null || id == listSeenBy) return@alone
            listSeenBy = id
            if (deleting != Deleting.Busy) notes.listSeenBy = id
            publish()
        }

    /**
     * A step of Me's name (C6b; AS2's Your name and AS7's Me): [step] one of [Naming]'s own, and what it gives besides, which
     * this returns, a save's request to send through the engine ([SyncEngine.rename]), its answer handed back through `saved`.
     * Started afresh at each change of who is signed in, so an answer to the last student's save is dropped.
     */
    suspend fun <T> naming(step: (Naming) -> Pair<Naming, T>): T =
        alone {
            val (next, given) = step(naming)
            naming = next
            publish()
            given
        }

    /** A step of Me's Leave (C6c; AS7's), as [naming] is: a leave to send ([SyncEngine.leave]), its answer back through `left`. */
    suspend fun <T> leaving(step: (Leaving) -> Pair<Leaving, T>): T =
        alone {
            val (next, given) = step(leaving)
            leaving = next
            publish()
            given
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
     * sign-in gone from the phone and its Cognito user the server's deleter's (C3-cognito; AN9b's call). The notes under the
     * student leave the store before anything is sent, written through, so a process ended mid-deletion keeps nothing of the
     * student's (AN10c), the screens reading them from here meanwhile; a stop writes them back, so the same student isn't
     * asked again. The account deleted on the server, they go here too, and its `me` with them, as iOS's `forgetNotes`
     * forgets them (the owner's rulings, 2026-10-23).
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
        // The notes under the student off the disk before the engine sends anything; Busy from here, so nothing writes them back
        // meanwhile ([synced], [sawList]).
        notes.forgetStudent()
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
                if (gone) {
                    forgetNotes()
                    forgot()
                } else {
                    notes.inClass = inClass
                    notes.listSeenBy = listSeenBy
                }
                publish()
                gone
            }
        if (forget) engine.forgetMe()
    }

    /**
     * Who is signed in, as [landing] says, [pending] the account deleted on the server with its sign-in still to go (a
     * relaunch lands on the deletion's screen), [checked] the sign-in through the 13+ check and [email] whose it is, as its
     * tokens name it: BaliApp.swift's `signed`, but the screens' own (the intro, a code being typed, History, the lesson). A
     * change is another account's sign-in, the sign-out between seen or not, one after a sign-out, a sign-out, or any sign-in
     * that lands, the same account's again too (Q2), whose fresh tokens aren't through the check: Sign up's question kept while
     * its page was open goes, an ask on its way is dropped ([changes]), Delete account's question or stop goes with the last
     * sign-in, and Me's name and Leave start afresh, so an answer to the last student's save or leave is dropped. Another
     * student's `me` is forgotten, and so is one this run's sign-in has none of: a read that failed before it, with no token to
     * send, isn't its read ([forgot]); and, at a relaunch finding the account deleted, the notes under the student. A sign-in
     * not through the check is asked about it ([askAge]). Returns whether the engine is to forget `me`, and whether to ask,
     * each the caller's to do with the account let go.
     */
    private fun signed(landing: Landing, pending: Boolean, checked: Boolean, email: String?): Pair<Boolean, Boolean> {
        val another = landing.account?.let { account != null && it != account } ?: (landing.signedIn && signedIn == false)
        val changed = landing.signedIn != signedIn || another || landing.count != landed
        if (changed) {
            if (age.answer == AgeCheck.Answer.Asked) age = AgeCheck(AgeCheck.Answer.Unanswered)
            changes += 1
            deleting = deleting.signInChanged()
            naming = Naming()
            leaving = Leaving()
        }
        if (pending && deleting == Deleting.None) deleting = Deleting.Pending
        // A relaunch finding the account deleted on Bali's server and its sign-in still to go (the app closed between the two):
        // the notes under the student go now, as a finished Delete account takes them (the owner's ruling, 2026-10-23).
        val notesGone = pending && (inClass != null || listSeenBy != null)
        if (notesGone) forgetNotes()
        // Made here, not the store read at launch (none before it).
        val forget = notesGone || another || changed && landing.signedIn && signedIn != null && shown()?.me == null
        landing.account?.let { account = it }
        landed = landing.count
        signedIn = landing.signedIn
        this.email = email
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
     * Emergency Unlock with it (#300's review); never while the question shows, the way on there (BaliApp.swift's
     * `askAgeAgain`), as the router last showed it ([routed]), read with the account let go.
     */
    private suspend fun askAgeAgain() {
        if (!alone { unreached && cleared == false && age.answer != AgeCheck.Answer.TooYoung }) return
        if (routed?.invoke() == Screen.Age) return
        askAge()
    }

    /** The router reading this account ([Router]): [screen], what it showed last, which each wake's ask reads ([askAgeAgain]). */
    internal fun routedBy(screen: suspend () -> Screen?) {
        routed = screen
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

    /** The account deleted on Bali's server: the notes under the student go, here and in the store (BaliApp.swift's `forgetNotes`). */
    private fun forgetNotes() {
        inClass = null
        listSeenBy = null
        notes.inClass = null
        notes.listSeenBy = null
    }

    private fun publish() {
        val ageNow =
            when {
                signedIn != true || age.answer == AgeCheck.Answer.TooYoung -> age.answer
                cleared == true -> AgeCheck.Answer.Passed
                cleared == false -> AgeCheck.Answer.Unanswered
                else -> AgeCheck.Answer.Checking
            }
        published.value =
            State(
                signedIn = signedIn, signedInThisRun = signedInThisRun, age = ageNow, deleting = deleting, sync = shown(), email = email,
                inClass = inClass, listSeenBy = listSeenBy, naming = naming, leaving = leaving, signIns = changes,
            )
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
         * The account half over [engine]'s sign-in, [SyncEngine.make]'s, its calls in [scope], the app's, the notes under the
         * student in [notes], the app's own store (AN10c's), in memory alone where none is given; none for an engine opened without
         * one, a Debug build's while sign-in isn't set up.
         */
        fun of(engine: SyncEngine, scope: CoroutineScope, clock: SyncClock = SystemClock, notes: Notes = MemoryNotes()): Account? =
            engine.signIn?.let { Account(engine, it, scope, clock, notes) }
    }
}
