package com.bali.outbox

import com.bali.core.BaliJson
import com.bali.core.MeResponse
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SessionView
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout

// Which screen the app shows (C1a): the router halves of BaliOutbox's ScreenTests, AppTests' `offersSignOut`, and
// BellRedrawTests' timeSet, with a test of its own for a clock set short of the bell or back. iOS's permission is the lock's
// switch here (approved its On, denied its Off, not determined its Starting) and its shields the lock (Q3). The words are
// AN10d's to AN10h's; waitingWords and ridersWiring read iOS's views and have no twin; MoveTests are AS2's.

/**
 * The router's answer for what the phone knows at [now]: no intro Sign up shows, signed in, kept from the last run unless
 * [signedInThisRun] says, the lock's switch on and checked (never read on before, [everApproved]), the engine standing [standing]
 * with [queued] and its newest tap [lastTap], `GET /v1/me` not answered unless [me] says, nor failed unless [meFailed] says, the
 * link [link], the consent list as it stands seen by [me]'s student, `u` (L8a), and Home's tab chosen, unless said otherwise; none
 * for a sign-in, an enforcer or an engine that hasn't spoken. The switch is judged off as the enforcer judges it: off at once,
 * starting only where [switchedOff] says it has lasted past the grace. BaliOutbox's ScreenTests' `screen`, with its tab bar.
 */
private fun routed(
    problem: Problem? = null, deleting: Boolean = false, age: AgeCheck.Answer = AgeCheck.Answer.Passed, intro: Boolean = false,
    signedIn: Boolean? = true, signedInThisRun: Boolean = false, switch: LockSwitch? = LockSwitch.On, switchedOff: Boolean? = null,
    checked: Boolean = true, locked: Boolean = false, everApproved: Boolean = false, standing: Standing? = Standing.Out,
    queued: List<OutboxRecord> = emptyList(), lastTap: String? = null, me: MeResponse? = null, meFailed: SendResult? = null,
    link: Link? = null, listSeenBy: String? = "u", sessionOverClosed: SessionView? = null, opened: List<Screen> = emptyList(),
    tab: Screen = Screen.Home, now: Instant = t0,
): Screen.Shown {
    val protection = switch?.let { Protection(checked = checked, switch = it, switchedOff = switchedOff ?: (it == LockSwitch.Off), locked = locked) }
    val sync = standing?.let { SyncState(standing = it, queued = queued, link = link, lastTap = lastTap, me = me, meFailed = meFailed) }
    return Screen.choose(
        problem = problem, deleting = deleting, age = age, intro = intro, signedIn = signedIn, signedInThisRun = signedInThisRun,
        protection = protection, everApproved = everApproved, sync = sync, listSeenBy = listSeenBy,
        sessionOverClosed = sessionOverClosed, opened = opened, tab = tab, now = now,
    )
}

/** [routed]'s screen alone. */
private fun screen(
    problem: Problem? = null, deleting: Boolean = false, age: AgeCheck.Answer = AgeCheck.Answer.Passed, intro: Boolean = false,
    signedIn: Boolean? = true, signedInThisRun: Boolean = false, switch: LockSwitch? = LockSwitch.On, switchedOff: Boolean? = null,
    checked: Boolean = true, locked: Boolean = false, everApproved: Boolean = false, standing: Standing? = Standing.Out,
    queued: List<OutboxRecord> = emptyList(), lastTap: String? = null, me: MeResponse? = null, meFailed: SendResult? = null,
    link: Link? = null, listSeenBy: String? = "u", sessionOverClosed: SessionView? = null, opened: List<Screen> = emptyList(),
    tab: Screen = Screen.Home, now: Instant = t0,
): Screen =
    routed(
        problem, deleting, age, intro, signedIn, signedInThisRun, switch, switchedOff, checked, locked, everApproved, standing,
        queued, lastTap, me, meFailed, link, listSeenBy, sessionOverClosed, opened, tab, now,
    ).screen

/**
 * Whether the tab bar shows over the phone standing [standing], with [opened], at [now], the router's own answer beside its
 * screen, `GET /v1/me` answering [me], none unless said: BaliOutbox's ScreenTests' `tabbed`, History chosen.
 */
private fun tabbed(
    standing: Standing, opened: List<Screen> = emptyList(), closed: SessionView? = null, now: Instant = t0, me: MeResponse? = null,
): Boolean = routed(standing = standing, opened = opened, sessionOverClosed = closed, now = now, me = me, tab = Screen.History).tabbed

/**
 * The screen for [state] at [now], and whether its tab bar shows, with [opened]: the router's answer for a phone signed in, its
 * switch on and checked, the consent list as it stands seen by `GET /v1/me`'s student, `u` (L8a), Home's tab chosen. BaliOutbox's
 * ScreenTests' `shown`, for the engine's tests' screen halves (WaitTest.kt).
 */
fun shown(state: SyncState, opened: List<Screen> = emptyList(), now: Instant = t0): Screen.Shown =
    Screen.choose(
        problem = null, deleting = false, age = AgeCheck.Answer.Passed, intro = false, signedIn = true, signedInThisRun = false,
        protection = Protection(checked = true, switch = LockSwitch.On), everApproved = false, sync = state, listSeenBy = "u",
        sessionOverClosed = null, opened = opened, tab = Screen.Home, now = now,
    )

/** `GET /v1/me`'s answer [json], as the phone decodes it. */
private fun me(json: String): MeResponse = BaliJson.decodeFromString(MeResponse.serializer(), json)

/** `GET /v1/me`'s answer for a student with a name, in no class: Home's empty state, never a Join of the router's own (the owner's ruling, 2026-10-07). */
private fun inNone(): MeResponse = me(Answer.me(null, name = "Ana"))

/** `GET /v1/me`'s answer: account `u` of [role], named [name] or nothing, in [classes], each as [Answer.inClass] writes one. */
private fun user(role: String = "student", name: String? = "Ana", classes: List<String> = emptyList()): MeResponse {
    val named = name?.let { "\"$it\"" } ?: "null"
    return me("""{"user":{"id":"u","role":"$role","displayName":$named},"classes":[${classes.joinToString(",")}],"session":null}""")
}

/** In session [view], the phone [state] there (none: a state this build doesn't know). */
private fun inSession(state: ParticipationState?, view: SessionView = session()) = Standing.InSession(view, state)

/** A session whose bell is a thousand seconds past [t0]'s cap. */
private val later = session(endsAt = 4000)

/** Focused in [session], whose bell rings at [ended]. */
private val rung = inSession(ParticipationState.Focused)

/** When [session]'s bell rings. */
private val ended = at(3000)

/** Why the app couldn't start: its storage wouldn't open. */
private val failed = Problem.StartFailed(IOException("disk I/O error"))

/** Which screen the app shows (C1a): BaliOutbox's ScreenTests, the router's halves. */
class ScreenTest : OutboxFiles() {
    /** A queue of one tap the server hasn't answered, which holds the lock on to its cap (decision 7), as the file gives it back. */
    private fun held(): List<OutboxRecord> =
        runBlocking {
            val (outbox, _) = makeOutbox()
            record(outbox, Change.Tap("tag"))
            outbox.records()
        }

    @Test
    fun nothingKnownYetTheSignInTheEnforcerOrTheEngineSilentOrTheEnforcersFirstPassNotMadeIsStartingTheIntroIncluded() {
        // Sign up shows the intro only once Sign in has shown (the approved Sign in & sign up design).
        assertEquals(Screen.Starting, screen(signedIn = null))
        assertEquals(Screen.Starting, screen(switch = null))
        assertEquals(Screen.Starting, screen(checked = false))
        assertEquals(Screen.Starting, screen(standing = null))
        assertEquals(Screen.Starting, screen(intro = true, signedIn = null, switch = null, standing = null))
    }

    @Test
    fun the13PlusCheckIsAskedAtSignUpSignedOutSignInUntilSignUpIsPressedThenItsQuestionAndItsStopAndNeverOverASessionsScreens() {
        // C7, the approved Sign in & sign up design: a first launch opens on Sign in, never the question or the intro, whatever
        // the answer; past the question, the intro where Sign up shows it; a student signed in past the check sees none of them,
        // in no class too; the lock on is Focus, and the home a standing not read keeps holds Emergency Unlock, before all of
        // them. No tab bar on any.
        val held = held()
        for (age in AgeCheck.Answer.entries) {
            assertEquals(Screen.Starting, screen(age = age, intro = true, signedIn = null), "$age")
            assertEquals(Screen.Starting, screen(age = age, intro = true, signedIn = null, switch = null, standing = null), "$age")
            assertEquals(Screen.Starting, screen(age = age, signedIn = null), "$age")
        }
        // Signed in, the intro is no screen of the router's: Sign in shows none.
        assertEquals(Screen.Home, screen(intro = true))
        assertEquals(Screen.Home, screen())
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting))
        assertEquals(Screen.Unlocked, screen(standing = inSession(ParticipationState.Unlocked)))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off))
        assertEquals(Screen.Home, screen(me = inNone()))
        val gates =
            listOf(
                Triple(AgeCheck.Answer.Unanswered, Screen.SignIn, Screen.Intro),
                Triple(AgeCheck.Answer.Passed, Screen.SignIn, Screen.Intro),
                Triple(AgeCheck.Answer.Asked, Screen.Age, Screen.Age),
                Triple(AgeCheck.Answer.TooYoung, Screen.TooYoung, Screen.TooYoung),
                Triple(AgeCheck.Answer.Checking, Screen.SignIn, Screen.Intro),
            )
        for ((age, gate, signingUp) in gates) {
            assertEquals(signingUp, screen(age = age, intro = true, signedIn = false), "$age")
            assertEquals(signingUp, screen(age = age, intro = true, signedIn = false, switch = LockSwitch.Off), "$age")
            assertEquals(Screen.Focus, screen(age = age, intro = true, signedIn = false, standing = rung), "$age")
            assertEquals(gate, screen(age = age, signedIn = false), "$age")
            assertEquals(gate, screen(age = age, signedIn = false, switch = LockSwitch.Off), "$age")
            assertEquals(gate, screen(age = age, signedIn = false, standing = Standing.Waiting), "$age")
            assertEquals(gate, screen(age = age, signedIn = false, standing = rung, now = ended), "$age")
            assertEquals(Screen.Focus, screen(age = age, signedIn = false, standing = rung), "$age")
            assertEquals(Screen.Focus, screen(age = age, signedIn = false, queued = held), "$age")
            assertEquals(Screen.Home, screen(age = age, signedIn = false, locked = true, standing = Standing.Unread), "$age")
            assertEquals(Screen.Deleting, screen(deleting = true, age = age, signedIn = false), "$age")
            assertEquals(Screen.Storage(failed), screen(problem = failed, age = age, signedIn = false), "$age")
            for ((intro, shown) in listOf(false to gate, true to signingUp)) {
                assertEquals(Screen.Shown(shown, false), routed(age = age, intro = intro, signedIn = false, tab = Screen.History), "$age")
            }
        }
    }

    @Test
    fun signedInASignInNotThroughThe13PlusCheckIsTheMarkWhileBaliIsAskedThenTheQuestionNeverOverASessionsScreens() {
        // The gap's fallback (the owner's decisions, 2026-10-06 and 2026-10-08; C7-server): in Home's place, its empty state's
        // too, Waiting's and the permission step's, over a Join or a tab opened, after the bell once Session over is closed; the
        // stop screen there once answered under 13. Never over Focus, Unlocked, Protection off, Session over not closed, nor the
        // home a standing not read keeps; Delete account's screen and a start that failed come first. No tab bar; passed, none.
        val held = held()
        val asked =
            listOf(
                AgeCheck.Answer.Unanswered to Screen.Age, AgeCheck.Answer.Asked to Screen.Age,
                AgeCheck.Answer.TooYoung to Screen.TooYoung, AgeCheck.Answer.Checking to Screen.Starting,
            )
        for ((age, question) in asked) {
            assertEquals(question, screen(age = age), "$age")
            assertEquals(question, screen(age = age, standing = Standing.Waiting), "$age")
            assertEquals(question, screen(age = age, switch = LockSwitch.Off), "$age")
            assertEquals(question, screen(age = age, switch = LockSwitch.Starting), "$age")
            assertEquals(question, screen(age = age, me = inNone()), "$age")
            assertEquals(question, screen(age = age, opened = listOf(Screen.Join), tab = Screen.Me), "$age")
            assertEquals(question, screen(age = age, standing = rung, sessionOverClosed = session(), now = ended), "$age")
            // Never over a session's screens, the lock's or the last run's.
            assertEquals(Screen.Focus, screen(age = age, standing = rung), "$age")
            assertEquals(Screen.Focus, screen(age = age, queued = held), "$age")
            assertEquals(Screen.Home, screen(age = age, locked = true, standing = Standing.Unread), "$age")
            assertEquals(Screen.Home, screen(age = age, standing = Standing.Unread), "$age")
            assertEquals(Screen.Unlocked, screen(age = age, standing = inSession(ParticipationState.Unlocked)), "$age")
            val off = inSession(ParticipationState.ProtectionOff)
            assertEquals(Screen.ProtectionOff, screen(age = age, switch = LockSwitch.Off, standing = off), "$age")
            assertEquals(Screen.SessionOver, screen(age = age, standing = rung, now = ended), "$age")
            assertEquals(Screen.Permission, screen(age = age, switch = LockSwitch.Off, standing = rung, now = ended), "$age")
            assertEquals(Screen.Deleting, screen(deleting = true, age = age), "$age")
            assertEquals(Screen.Storage(failed), screen(problem = failed, age = age), "$age")
            assertEquals(Screen.Starting, screen(age = age, signedIn = null), "$age")
            // Those keep their own ways on, a tab among them: Me's Delete account is reachable there, so the fallback's
            // deletion is the one an answer under 13 starts, never one made with the check not passed (santa's round 1).
            val unlocked = inSession(ParticipationState.Unlocked)
            assertEquals(Screen.Me, screen(age = age, standing = unlocked, opened = listOf(Screen.Home), tab = Screen.Me), "$age")
            assertEquals(Screen.Me, screen(age = age, standing = Standing.Unread, tab = Screen.Me), "$age")
            assertEquals(Screen.Shown(question, false), routed(age = age, tab = Screen.History), "$age")
        }
        assertEquals(Screen.Home, screen(age = AgeCheck.Answer.Passed))
        assertEquals(Screen.Home, screen(age = AgeCheck.Answer.Passed, me = inNone()))
    }

    @Test
    fun yourNameSignedInAStudentsAccountGetMeNamesWithNoNameGetsItFirstNamedOrATeachersOrARoleNotKnownNever() {
        // The owner's decision, 2026-10-07: after a sign-up, before the permission step and Home, in Waiting's place too, over a
        // Join or a tab opened, after the bell once Session over is closed, with no tab bar. Not known until a read answers: Bali
        // not reached, the screens as before. After the 13+ question, and never over a session's screens; Delete account's
        // screen, a start that failed and Sign in come first.
        val held = held()
        val none = user(name = null)
        assertEquals(Screen.Name, screen(switch = LockSwitch.Starting, me = none))
        assertEquals(Screen.Name, screen(switch = LockSwitch.Off, me = none))
        assertEquals(Screen.Name, screen(me = none))
        assertEquals(Screen.Name, screen(standing = Standing.Waiting, me = none))
        assertEquals(Screen.Name, screen(me = none, opened = listOf(Screen.Join), tab = Screen.Me))
        assertEquals(Screen.Name, screen(standing = rung, me = none, sessionOverClosed = session(), now = ended))
        // Named, a role not known: the screens as before; a teacher's account its own.
        for (other in listOf(user(), user(role = "admin", name = null))) {
            assertEquals(Screen.Permission, screen(switch = LockSwitch.Starting, me = other), "$other")
            assertEquals(Screen.Home, screen(me = other), "$other")
        }
        assertEquals(Screen.Teacher, screen(me = user(role = "teacher", name = null)))
        // A sign-in kept from the last run, Bali not reached yet: no read to say, so the screens go on (a sign-in made this
        // run holds the starting screen, the next test).
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Starting))
        assertEquals(Screen.Home, screen())
        // The question first, for an account that hasn't passed it here.
        assertEquals(Screen.Age, screen(age = AgeCheck.Answer.Unanswered, me = none))
        assertEquals(Screen.TooYoung, screen(age = AgeCheck.Answer.TooYoung, me = none))
        // Never over a session's screens, the lock's or the last run's.
        assertEquals(Screen.Focus, screen(standing = rung, me = none))
        assertEquals(Screen.Focus, screen(queued = held, me = none))
        assertEquals(Screen.Home, screen(locked = true, standing = Standing.Unread, me = none))
        assertEquals(Screen.Home, screen(standing = Standing.Unread, me = none))
        assertEquals(Screen.Unlocked, screen(standing = inSession(ParticipationState.Unlocked), me = none))
        val off = inSession(ParticipationState.ProtectionOff)
        assertEquals(Screen.ProtectionOff, screen(switch = LockSwitch.Off, standing = off, me = none))
        assertEquals(Screen.SessionOver, screen(standing = rung, me = none, now = ended))
        assertEquals(Screen.Deleting, screen(deleting = true, me = none))
        assertEquals(Screen.Storage(failed), screen(problem = failed, me = none))
        assertEquals(Screen.SignIn, screen(signedIn = false, me = none))
        assertEquals(Screen.Starting, screen(signedIn = null, me = none))
        assertEquals(Screen.Shown(Screen.Name, false), routed(signedInThisRun = true, me = none, tab = Screen.History))
    }

    @Test
    fun aSignInMadeThisRunHoldsTheStartingScreenUntilGetMeAnswersOrFailsForItSoNoScreenFlashesBeforeYourName() {
        // The owner's ruling, 2026-10-07: in the permission step's place, Home's and Waiting's, over a Join or a tab opened,
        // after the bell once Session over is closed, with no tab bar; a read that answers brings Your name or the screens, and
        // one that failed, or the phone's storage failing, so none can be tried, lets them go on, as a sign-in kept from the
        // last run does. After the 13+ question, and never over a session's screens.
        val held = held()
        assertEquals(Screen.Starting, screen(signedInThisRun = true, switch = LockSwitch.Starting))
        assertEquals(Screen.Starting, screen(signedInThisRun = true, switch = LockSwitch.Off))
        assertEquals(Screen.Starting, screen(signedInThisRun = true))
        assertEquals(Screen.Starting, screen(signedInThisRun = true, standing = Standing.Waiting))
        assertEquals(Screen.Starting, screen(signedInThisRun = true, opened = listOf(Screen.Join), tab = Screen.Me))
        assertEquals(Screen.Starting, screen(signedInThisRun = true, standing = rung, sessionOverClosed = session(), now = ended))
        // A read answers: Your name for a student's account with none, else the screens.
        assertEquals(Screen.Name, screen(signedInThisRun = true, me = user(name = null)))
        assertEquals(Screen.Permission, screen(signedInThisRun = true, switch = LockSwitch.Starting, me = user()))
        assertEquals(Screen.Teacher, screen(signedInThisRun = true, me = user(role = "teacher", name = null)))
        // A read failed, offline at once or no answer in the request's time: the screens go on.
        assertEquals(Screen.Permission, screen(signedInThisRun = true, switch = LockSwitch.Starting, meFailed = SendResult.NetworkError))
        assertEquals(Screen.Home, screen(signedInThisRun = true, meFailed = SendResult.Status(500)))
        assertEquals(Screen.Waiting, screen(signedInThisRun = true, standing = Standing.Waiting, meFailed = SendResult.NetworkError))
        // The question first, on a phone that hasn't passed it.
        assertEquals(Screen.Age, screen(age = AgeCheck.Answer.Unanswered, signedInThisRun = true))
        assertEquals(Screen.TooYoung, screen(age = AgeCheck.Answer.TooYoung, signedInThisRun = true))
        // Never over a session's screens, the lock's or the last run's: Emergency Unlock's.
        assertEquals(Screen.Focus, screen(signedInThisRun = true, standing = rung))
        assertEquals(Screen.Focus, screen(signedInThisRun = true, queued = held))
        assertEquals(Screen.Home, screen(signedInThisRun = true, locked = true, standing = Standing.Unread))
        assertEquals(Screen.Home, screen(signedInThisRun = true, standing = Standing.Unread))
        val unlocked = inSession(ParticipationState.Unlocked)
        assertEquals(Screen.Unlocked, screen(signedInThisRun = true, standing = unlocked))
        assertEquals(Screen.Me, screen(signedInThisRun = true, standing = unlocked, opened = listOf(Screen.Home), tab = Screen.Me))
        val off = inSession(ParticipationState.ProtectionOff)
        assertEquals(Screen.ProtectionOff, screen(signedInThisRun = true, switch = LockSwitch.Off, standing = off))
        assertEquals(Screen.SessionOver, screen(signedInThisRun = true, standing = rung, now = ended))
        assertEquals(Screen.Deleting, screen(deleting = true, signedInThisRun = true))
        assertEquals(Screen.Storage(failed), screen(problem = failed, signedInThisRun = true))
        assertEquals(Screen.SignIn, screen(signedIn = false, signedInThisRun = true))
        assertEquals(Screen.Shown(Screen.Starting, false), routed(signedInThisRun = true, tab = Screen.History))
        // The phone's storage failing, no read can be tried: a failed read too, never a mark held with nothing said.
        assertEquals(Screen.Shown(Screen.History, true), routed(signedInThisRun = true, link = Link.StorageFailed, tab = Screen.History))
    }

    @Test
    fun theConsentListsNewLinesOnceSignedInAStudentGetMeListsInAClassWhoHasntSeenTheListAsItStandsHereGetsTheOneTimeScreen() {
        // L8a; ARCHITECTURE, "Live lesson", decision 11: in Home's place, the permission step's and Waiting's, over a Join or a
        // tab opened, after the bell once Session over is closed, with no tab bar; seen by that student, never again, while
        // another student seen before gets it; never in no class (a join shows the list as it stands), for a teacher's account
        // or a role this build doesn't know, nor before a read names who is signed in. After the 13+ question and Your name, and
        // never over a session's screens; Delete account's screen, a start that failed and Sign in come first.
        val held = held()
        val inClass = user(classes = listOf(Answer.inClass("c")))
        // Not seen by this student here: none seen it, or another student.
        assertEquals(Screen.ListChanged, screen(me = inClass, listSeenBy = null))
        assertEquals(Screen.ListChanged, screen(me = inClass, listSeenBy = "bea"))
        assertEquals(Screen.ListChanged, screen(switch = LockSwitch.Starting, me = inClass, listSeenBy = null))
        assertEquals(Screen.ListChanged, screen(switch = LockSwitch.Off, me = inClass, listSeenBy = null))
        assertEquals(Screen.ListChanged, screen(standing = Standing.Waiting, me = inClass, listSeenBy = null))
        assertEquals(Screen.ListChanged, screen(me = inClass, listSeenBy = null, opened = listOf(Screen.Join), tab = Screen.Me))
        assertEquals(
            Screen.ListChanged, screen(standing = rung, me = inClass, listSeenBy = null, sessionOverClosed = session(), now = ended),
        )
        // Seen by this student: the screens as before.
        assertEquals(Screen.Home, screen(me = inClass))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Starting, me = inClass))
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting, me = inClass))
        // In no class, a role not known, or nothing read yet: never; a teacher's account its own.
        for (other in listOf(user(), user(role = "admin", classes = listOf(Answer.inClass("c"))))) {
            assertEquals(Screen.Home, screen(me = other, listSeenBy = null), "$other")
        }
        assertEquals(Screen.Teacher, screen(me = user(role = "teacher", classes = listOf(Answer.inClass("c"))), listSeenBy = null))
        assertEquals(Screen.Home, screen(listSeenBy = null))
        // A sign-in made this run: the starting screen until its read answers, then the list.
        assertEquals(Screen.Starting, screen(signedInThisRun = true, listSeenBy = null))
        assertEquals(Screen.ListChanged, screen(signedInThisRun = true, me = inClass, listSeenBy = null))
        // The 13+ question first, then Your name.
        assertEquals(Screen.Age, screen(age = AgeCheck.Answer.Unanswered, me = inClass, listSeenBy = null))
        assertEquals(Screen.Starting, screen(age = AgeCheck.Answer.Checking, me = inClass, listSeenBy = null))
        assertEquals(Screen.Name, screen(me = user(name = null, classes = listOf(Answer.inClass("c"))), listSeenBy = null))
        // Never over a session's screens, the lock's or the last run's: Emergency Unlock's.
        assertEquals(Screen.Focus, screen(standing = rung, me = inClass, listSeenBy = null))
        assertEquals(Screen.Focus, screen(queued = held, me = inClass, listSeenBy = null))
        assertEquals(Screen.Home, screen(locked = true, standing = Standing.Unread, me = inClass, listSeenBy = null))
        assertEquals(Screen.Home, screen(standing = Standing.Unread, me = inClass, listSeenBy = null))
        val unlocked = inSession(ParticipationState.Unlocked)
        assertEquals(Screen.Unlocked, screen(standing = unlocked, me = inClass, listSeenBy = null))
        assertEquals(Screen.Me, screen(standing = unlocked, me = inClass, listSeenBy = null, opened = listOf(Screen.Home), tab = Screen.Me))
        val off = inSession(ParticipationState.ProtectionOff)
        assertEquals(Screen.ProtectionOff, screen(switch = LockSwitch.Off, standing = off, me = inClass, listSeenBy = null))
        assertEquals(Screen.SessionOver, screen(standing = rung, me = inClass, listSeenBy = null, now = ended))
        assertEquals(Screen.Deleting, screen(deleting = true, me = inClass, listSeenBy = null))
        assertEquals(Screen.Storage(failed), screen(problem = failed, me = inClass, listSeenBy = null))
        assertEquals(Screen.SignIn, screen(signedIn = false, me = inClass, listSeenBy = null))
        assertEquals(Screen.Starting, screen(signedIn = null, me = inClass, listSeenBy = null))
        assertEquals(Screen.Shown(Screen.ListChanged, false), routed(me = inClass, listSeenBy = null, tab = Screen.History))
    }

    @Test
    fun aTeachersAccountGetsTheTeacherScreenAndNothingElseOnceGetMeNamesItATeachersNeverOverFocusOrASessionsScreens() {
        // The owner, 2026-11-07: the app is the students'. In Home's place, the permission step's and Waiting's, over a Join or
        // a tab opened, after the bell once Session over is closed, with no tab bar; named or not, teaching a class or none, the
        // consent list seen or not, kept from the last run or signed in this run, whose mark holds until that read; a student's
        // account never gets it. After the 13+ check, and never over Focus, Unlocked, Protection off, Session over not closed,
        // nor the home a standing not read keeps, which hold Emergency Unlock and keep their own ways on; Delete account's
        // screen, a start that failed and Sign in come first.
        val held = held()
        val teaching = listOf(Answer.inClass("c"))
        val teacher = user(role = "teacher", name = "Ms. Rivera", classes = teaching)
        for (other in listOf(teacher, user(role = "teacher", name = null, classes = teaching), user(role = "teacher", name = "Ms. Rivera"))) {
            assertEquals(Screen.Teacher, screen(me = other), "$other")
            assertEquals(Screen.Teacher, screen(me = other, listSeenBy = null), "$other")
            assertEquals(Screen.Teacher, screen(switch = LockSwitch.Starting, me = other), "$other")
            assertEquals(Screen.Teacher, screen(switch = LockSwitch.Off, me = other), "$other")
            assertEquals(Screen.Teacher, screen(standing = Standing.Waiting, me = other), "$other")
            assertEquals(Screen.Teacher, screen(me = other, opened = listOf(Screen.Join), tab = Screen.Me), "$other")
            assertEquals(Screen.Teacher, screen(me = other, tab = Screen.History), "$other")
            assertEquals(Screen.Teacher, screen(standing = rung, me = other, sessionOverClosed = session(), now = ended), "$other")
            assertEquals(Screen.Teacher, screen(signedInThisRun = true, me = other), "$other")
        }
        // Signed in this run, the mark until a read names the account; a student's, as before.
        assertEquals(Screen.Starting, screen(signedInThisRun = true))
        assertEquals(Screen.Home, screen(me = user(name = "Ms. Rivera", classes = teaching)))
        assertEquals(Screen.Name, screen(me = user(name = null, classes = teaching)))
        assertEquals(Screen.Home, screen(me = user(role = "admin", name = "Ms. Rivera", classes = teaching)))
        // The 13+ check first.
        assertEquals(Screen.Starting, screen(age = AgeCheck.Answer.Checking, me = teacher))
        assertEquals(Screen.Age, screen(age = AgeCheck.Answer.Unanswered, me = teacher))
        assertEquals(Screen.TooYoung, screen(age = AgeCheck.Answer.TooYoung, me = teacher))
        // Never over a session's screens, the lock's or the last run's: Emergency Unlock's.
        assertEquals(Screen.Focus, screen(standing = rung, me = teacher))
        assertEquals(Screen.Focus, screen(queued = held, me = teacher))
        assertEquals(Screen.Home, screen(locked = true, standing = Standing.Unread, me = teacher))
        assertEquals(Screen.Home, screen(standing = Standing.Unread, me = teacher))
        val unlocked = inSession(ParticipationState.Unlocked)
        assertEquals(Screen.Unlocked, screen(standing = unlocked, me = teacher))
        assertEquals(Screen.Me, screen(standing = unlocked, me = teacher, opened = listOf(Screen.Home), tab = Screen.Me))
        val off = inSession(ParticipationState.ProtectionOff)
        assertEquals(Screen.ProtectionOff, screen(switch = LockSwitch.Off, standing = off, me = teacher))
        assertEquals(Screen.SessionOver, screen(standing = rung, me = teacher, now = ended))
        assertEquals(Screen.Deleting, screen(deleting = true, me = teacher))
        assertEquals(Screen.Storage(failed), screen(problem = failed, me = teacher))
        assertEquals(Screen.SignIn, screen(signedIn = false, me = teacher))
        assertEquals(Screen.Starting, screen(signedIn = null, me = teacher))
        assertEquals(Screen.Shown(Screen.Teacher, false), routed(me = teacher, tab = Screen.History))
        // `SyncState.teacher`, from `GET /v1/me`'s role alone: a teacher's, never a student's, a role not known or none read.
        assertTrue(SyncState(me = teacher).teacher)
        for (other in listOf(user(), user(role = "admin"), null)) assertFalse(SyncState(me = other).teacher, "$other")
    }

    @Test
    fun theAppCouldntStartStorageWithWhyOverEverythingElseEachProblemItsOwnTypeNeverAString() {
        // Rule 5, with Try again. Not set up, or the start failed: told apart by type, as every outcome is, the words AN10d's.
        for (problem in listOf(Problem.NotSetUp, failed)) {
            assertEquals(Screen.Storage(problem), screen(problem = problem, intro = true, signedIn = null, switch = null, standing = null))
            assertEquals(Screen.Storage(problem), screen(problem = problem, standing = rung))
            assertEquals(Screen.Shown(Screen.Storage(problem), false), routed(problem = problem, tab = Screen.History))
        }
        assertNotEquals<Screen>(Screen.Storage(Problem.NotSetUp), Screen.Storage(failed))
        // No screen, no problem and no answer of the router's holds words: each a type, a string nowhere among them.
        val types = listOf(Screen::class.java, Problem::class.java).flatMap { listOf(it) + it.declaredClasses }
        for (type in types) {
            assertTrue(type.declaredFields.none { it.type == String::class.java }, "${type.name} holds a string")
        }
        assertTrue(Screen.Storage::class.java in types && Problem.StartFailed::class.java in types)
    }

    @Test
    fun deleteAccountPressedTheDeletionsOwnScreenOverEverythingButAStartThatFailedWithNoTabBar() {
        // C4b: the lock's Focus, the last run's lock's Home, the intro, the sign-in, a session's screens, a screen opened over
        // another and a tab chosen; nothing else is offered from the press to the end.
        assertEquals(Screen.Deleting, screen(deleting = true))
        assertEquals(Screen.Deleting, screen(deleting = true, locked = true, standing = rung))
        assertEquals(Screen.Deleting, screen(deleting = true, locked = true, standing = Standing.Unread))
        assertEquals(Screen.Deleting, screen(deleting = true, intro = true, signedIn = null, switch = null, standing = null))
        assertEquals(Screen.Deleting, screen(deleting = true, intro = true, signedIn = false))
        assertEquals(Screen.Deleting, screen(deleting = true, signedIn = false))
        assertEquals(Screen.Deleting, screen(deleting = true, standing = inSession(ParticipationState.Unlocked)))
        assertEquals(Screen.Deleting, screen(deleting = true, opened = listOf(Screen.Join), tab = Screen.Me))
        assertEquals(Screen.Shown(Screen.Deleting, false), routed(deleting = true, tab = Screen.Me))
        assertEquals(Screen.Storage(failed), screen(problem = failed, deleting = true))
    }

    @Test
    fun signOutIsOfferedOnMeYourNameAndATeachersAccountsScreenAloneNeverOnAJoinOpenedOverHomeOrMeNorAnywhereElse() {
        // AppTests' nameAndSignOut, its screens' half (C6b): every student in no class lands on Home with its tab bar, so Me is
        // the wrong account's way out (the owner's ruling, 2026-10-07); never on a Join, opened over Home or Me, whose way back
        // reaches Me.
        val every =
            listOf(
                Screen.Starting, Screen.Age, Screen.TooYoung, Screen.Name, Screen.Teacher, Screen.ListChanged, Screen.Intro,
                Screen.SignIn, Screen.Permission, Screen.Join, Screen.Home, Screen.Waiting, Screen.Focus, Screen.Unlocked,
                Screen.ProtectionOff, Screen.SessionOver, Screen.History, Screen.Me, Screen.Deleting, Screen.Storage(Problem.NotSetUp),
            )
        // Every screen there is, one of each.
        val screens = Screen::class.java.declaredClasses.filter { Screen::class.java.isAssignableFrom(it) }.toSet()
        assertEquals(screens, every.map { it.javaClass }.toSet())
        val offering = setOf(Screen.Me, Screen.Name, Screen.Teacher)
        for (screen in every) assertEquals(screen in offering, screen.offersSignOut, "$screen")
        // As the router chooses them.
        assertTrue(screen(tab = Screen.Me).offersSignOut)
        assertTrue(screen(me = user(name = null)).offersSignOut)
        assertTrue(screen(me = user(role = "teacher")).offersSignOut)
        val elsewhere =
            listOf(
                screen(opened = listOf(Screen.Join), tab = Screen.Me), screen(me = inNone()), screen(standing = rung),
                screen(signedIn = false), screen(deleting = true), screen(standing = Standing.Waiting, opened = listOf(Screen.Home, Screen.Join)),
            )
        for (shown in elsewhere) assertFalse(shown.offersSignOut, "$shown")
    }

    @Test
    fun onboardingInOrderNotSignedInSignInOrTheIntroSignUpShowsThenTheSwitchNotOnOutOfAnyRunningSessionThePermissionStep() {
        // Sign in a first launch's screen, the intro in its place once Sign up shows it; then the switch off or starting.
        assertEquals(Screen.Home, screen(intro = true))
        assertEquals(Screen.Intro, screen(intro = true, signedIn = false))
        assertEquals(Screen.SignIn, screen(signedIn = false))
        assertEquals(Screen.SignIn, screen(signedIn = false, switch = LockSwitch.Starting))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Starting))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, standing = Standing.Waiting))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, me = inNone()))
    }

    @Test
    fun theLockOnByItsOwnRuleFocusedInASessionThePhonesClockSaysStillRunsOrATapHeldIsFocusBeforeTheSignInTheIntroAndThePermission() {
        // Focus holds Emergency Unlock, always allowed, whatever the switch reads, before any pass. Once the lock is off by
        // the phone's clock (the bell, the tap's cap), those rules again: no countdown over nothing locked.
        assertEquals(Screen.Focus, screen(signedIn = false, standing = rung))
        assertEquals(Screen.Focus, screen(intro = true, signedIn = null, switch = null, standing = rung))
        assertEquals(Screen.Focus, screen(switch = LockSwitch.Off, standing = rung))
        assertEquals(Screen.Focus, screen(switch = LockSwitch.Starting, checked = false, standing = rung))
        val held = held()
        assertEquals(Screen.Focus, screen(signedIn = false, queued = held))
        assertEquals(Screen.Focus, screen(intro = true, signedIn = false, queued = held))
        assertEquals(Screen.SignIn, screen(signedIn = false, queued = held, now = t0 + SyncState.TAP_CAP))
        assertEquals(Screen.SignIn, screen(signedIn = false, standing = rung, now = ended))
        assertEquals(Screen.SignIn, screen(signedIn = false, standing = inSession(ParticipationState.Unlocked)))
        assertEquals(Screen.Intro, screen(intro = true, signedIn = false, standing = inSession(ParticipationState.Unlocked)))
    }

    @Test
    fun inARunningSessionUnlockedAndProtectionOffHaveTheirScreensNeverThePermissionStepAStateThisBuildDoesntKnowIsHome() {
        // However the switch reads: switched off mid-session (off is judged at once), Protection off's, whose screen says how
        // back; a state this build doesn't know is Home, never Focus, never Unlocked.
        assertEquals(Screen.Focus, screen(standing = inSession(ParticipationState.Focused)))
        assertEquals(Screen.Unlocked, screen(standing = inSession(ParticipationState.Unlocked)))
        assertEquals(Screen.ProtectionOff, screen(standing = inSession(ParticipationState.ProtectionOff)))
        assertEquals(Screen.Home, screen(standing = inSession(null)))
        assertEquals(Screen.ProtectionOff, screen(switch = LockSwitch.Off, standing = inSession(ParticipationState.Unlocked)))
        assertEquals(Screen.ProtectionOff, screen(switch = LockSwitch.Off, standing = inSession(ParticipationState.ProtectionOff)))
        assertEquals(Screen.Home, screen(switch = LockSwitch.Starting, standing = inSession(null)))
    }

    @Test
    fun theLockBackOnLeavesProtectionOffWithNoTapThePhoneBackWhereItStoodAndAnotherClasssOrNoneMovesNothing() {
        // #167: Focus, or Unlocked after an Emergency Unlock, focused where that isn't known.
        val off = inSession(ParticipationState.ProtectionOff)
        val on = Change.ProtectionOn("s")
        assertEquals(Screen.ProtectionOff, screen(standing = off))
        assertEquals(Screen.Focus, screen(standing = off.acting(on)))
        assertEquals(Screen.Focus, screen(standing = off.acting(on, offFrom = ParticipationState.Focused)))
        assertEquals(Screen.Unlocked, screen(standing = off.acting(on, offFrom = ParticipationState.Unlocked)))
        assertEquals(off, off.acting(Change.ProtectionOn("t")))
        assertEquals(Standing.Out, Standing.Out.acting(on))
        assertEquals(Standing.Waiting, Standing.Waiting.acting(on))
    }

    @Test
    fun inARunningSessionTheSwitchJudgedOffIsProtectionOffWhateverTheStandingSaysFocusAndTheLastRunsLockStillWin() {
        // Off, or starting past the grace (C5b): unlocked, or a state this build doesn't know, before the check's report lands.
        // Focus still wins where the enforcer keeps the lock on, Emergency Unlock there, and so does Home over the last run's;
        // a read starting within the grace changes nothing; the permission step only outside a session.
        for (state in listOf(ParticipationState.Unlocked, ParticipationState.ProtectionOff, null)) {
            for (switch in listOf(LockSwitch.Off, LockSwitch.Starting)) {
                assertEquals(Screen.ProtectionOff, screen(switch = switch, switchedOff = true, standing = inSession(state)), "$switch $state")
            }
        }
        assertEquals(Screen.Unlocked, screen(switch = LockSwitch.Starting, standing = inSession(ParticipationState.Unlocked)))
        assertEquals(Screen.Home, screen(switch = LockSwitch.Starting, everApproved = true, standing = inSession(null)))
        assertEquals(Screen.Focus, screen(switch = LockSwitch.Off, standing = rung))
        assertEquals(Screen.Focus, screen(switch = LockSwitch.Off, standing = inSession(ParticipationState.ProtectionOff), queued = held()))
        assertEquals(Screen.Home, screen(switch = LockSwitch.Off, locked = true, standing = Standing.Unread))
        for (standing in listOf(Standing.Out, Standing.Waiting, inSession(ParticipationState.ProtectionOff))) {
            assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, standing = standing, now = ended), "$standing")
        }
    }

    @Test
    fun theBellRungByThePhonesOwnClockNoReadYetIsSessionOverNeverFocusOverALockThatsOffUntilTheStudentClosesIt() {
        // Decision 6, C5b: never Focus, Unlocked or Protection off, whatever the classes, until the student closes it: Home, the
        // next session's own again, and the same session's own once its bell moved, an extension after Done ringing a bell of
        // its own (C5b's review); the permission step first when the switch isn't on; a second before it, the session's screen.
        for (state in listOf(ParticipationState.Focused, ParticipationState.Unlocked, ParticipationState.ProtectionOff)) {
            val standing = inSession(state)
            assertEquals(Screen.SessionOver, screen(standing = standing, now = ended), "$state")
            assertEquals(Screen.SessionOver, screen(standing = standing, now = at(9000)), "$state")
            assertEquals(Screen.Home, screen(standing = standing, sessionOverClosed = session(), now = ended), "$state")
            assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, standing = standing, now = ended), "$state")
        }
        val next = inSession(ParticipationState.Unlocked, session("t"))
        assertEquals(Screen.SessionOver, screen(standing = next, sessionOverClosed = session(), now = ended))
        val extended = inSession(ParticipationState.Focused, session(endsAt = 3600))
        assertEquals(Screen.SessionOver, screen(standing = extended, sessionOverClosed = session(), now = at(3600)))
        // The bell as the file kept it, a millisecond off the server's: the same bell, still closed (santa's round 1).
        val read = inSession(ParticipationState.Focused, SessionView("s", "c", ended.plusMillis(1)))
        assertEquals(Screen.Home, screen(standing = read, sessionOverClosed = session(), now = at(3001)))
        assertEquals(Screen.Focus, screen(standing = inSession(ParticipationState.Focused), now = at(2999)))
        assertEquals(Screen.Unlocked, screen(standing = inSession(ParticipationState.Unlocked), now = at(2999)))
        assertEquals(Screen.ProtectionOff, screen(standing = inSession(ParticipationState.ProtectionOff), now = at(2999)))
        assertEquals(Screen.SessionOver, screen(standing = inSession(ParticipationState.Focused), now = ended))
    }

    @Test
    fun whereThePhoneStoodNotReadYetHomeWhateverTheSwitchReadsTheLastRunsLockFoundOnBeforeTheSignInTooWaitingIsWaiting() {
        // B6b: Emergency Unlock works on that Home. The last run's lock found on is the lock the check verified on (`locked`,
        // iOS's shielded): a switch still starting covers nothing until it binds, whose check then claims it.
        assertEquals(Screen.Home, screen(standing = Standing.Unread))
        assertEquals(Screen.Home, screen(switch = LockSwitch.Off, standing = Standing.Unread))
        assertEquals(Screen.Home, screen(signedIn = false, locked = true, standing = Standing.Unread))
        assertEquals(Screen.Home, screen(intro = true, signedIn = false, checked = false, locked = true, standing = Standing.Unread))
        assertEquals(Screen.SignIn, screen(signedIn = false, standing = Standing.Unread))
        assertEquals(Screen.SignIn, screen(signedIn = false, switch = LockSwitch.Starting, standing = Standing.Unread))
        assertEquals(Screen.SignIn, screen(signedIn = false, locked = true))
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting))
    }

    @Test
    fun outOfAnySessionHomeInAClassOrInNoneNeverAJoinOfTheRoutersOwnNorSessionOver() {
        // The owner's ruling, 2026-10-07; Session over leaves by itself once a read says where the phone stands (C5b).
        assertEquals(Screen.Home, screen())
        assertEquals(Screen.Home, screen(me = user(classes = listOf(Answer.inClass("c")))))
        assertEquals(Screen.Home, screen(me = inNone()))
        assertEquals(Screen.Home, screen(sessionOverClosed = session()))
        assertEquals(Screen.Home, screen(standing = Standing.Unread))
    }

    @Test
    fun theScreensTheStudentOpenedOverAnotherInOrderEachOnlyOverTheOneUnderItNeverOverTheLockOrASessionsScreens() {
        // C3: Join over Home, wherever Home is chosen, past the bell too once Session over is closed, and Home over Waiting,
        // then Join over that Home (santa's round 1: Join fell back to Waiting there); never over Focus, a session's own
        // screens, Session over, the permission step, the sign-in, the intro, nor the home the last run's lock keeps (B6b).
        assertEquals(Screen.Join, screen(opened = listOf(Screen.Join)))
        assertEquals(Screen.Join, screen(me = inNone(), opened = listOf(Screen.Join)))
        assertEquals(Screen.Join, screen(standing = rung, sessionOverClosed = session(), opened = listOf(Screen.Join), now = ended))
        assertEquals(Screen.SessionOver, screen(standing = rung, opened = listOf(Screen.Join), now = ended))
        assertEquals(Screen.Home, screen(standing = Standing.Waiting, opened = listOf(Screen.Home)))
        assertEquals(Screen.Join, screen(standing = Standing.Waiting, opened = listOf(Screen.Home, Screen.Join)))
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting, opened = listOf(Screen.Join)))
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting, opened = listOf(Screen.Join, Screen.Home)))
        assertEquals(Screen.Join, screen(opened = listOf(Screen.Join, Screen.Join)))
        assertEquals(Screen.Home, screen(me = inNone(), opened = listOf(Screen.Home)))
        assertEquals(Screen.Home, screen(opened = listOf(Screen.Focus)))
        assertEquals(Screen.Focus, screen(standing = inSession(ParticipationState.Focused), opened = listOf(Screen.Join)))
        assertEquals(Screen.Unlocked, screen(standing = inSession(ParticipationState.Unlocked), opened = listOf(Screen.Join)))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, standing = Standing.Waiting, opened = listOf(Screen.Home)))
        assertEquals(Screen.SignIn, screen(signedIn = false, opened = listOf(Screen.Join)))
        assertEquals(Screen.Intro, screen(intro = true, signedIn = false, opened = listOf(Screen.Join)))
        assertEquals(Screen.Home, screen(signedIn = false, locked = true, standing = Standing.Unread, opened = listOf(Screen.Join)))
    }

    @Test
    fun theTabBarHistoryOrMeInPlaceOfTheRoutersOwnHomeAndOfAHomeOpenedOverWaitingNowhereElseItsBarInTheSameAnswer() {
        // C6a: out, in a class or none, not read, past the bell once Session over is closed (C5b), a state not known, and the
        // regular Home over Waiting (#151); Home's tab is Home; never over Focus, a session's screens, Waiting itself, Join opened
        // over Home, Session over, the permission step, the sign-in, the intro, starting, nor the home the last run's lock keeps.
        for (tab in listOf(Screen.History, Screen.Me)) {
            assertEquals(tab, screen(tab = tab))
            assertEquals(tab, screen(me = inNone(), tab = tab))
            assertEquals(tab, screen(standing = Standing.Unread, tab = tab))
            assertEquals(tab, screen(standing = rung, sessionOverClosed = session(), tab = tab, now = ended))
            assertEquals(Screen.SessionOver, screen(standing = rung, tab = tab, now = ended), "$tab")
            assertEquals(tab, screen(standing = inSession(null), tab = tab))
            assertEquals(Screen.Focus, screen(standing = inSession(ParticipationState.Focused), tab = tab), "$tab")
            assertEquals(Screen.Unlocked, screen(standing = inSession(ParticipationState.Unlocked), tab = tab), "$tab")
            assertEquals(Screen.ProtectionOff, screen(standing = inSession(ParticipationState.ProtectionOff), tab = tab), "$tab")
            assertEquals(Screen.Waiting, screen(standing = Standing.Waiting, tab = tab), "$tab")
            assertEquals(tab, screen(standing = Standing.Waiting, opened = listOf(Screen.Home), tab = tab))
            assertEquals(Screen.Join, screen(opened = listOf(Screen.Join), tab = tab), "$tab")
            assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, tab = tab), "$tab")
            assertEquals(Screen.SignIn, screen(signedIn = false, tab = tab), "$tab")
            assertEquals(Screen.Intro, screen(intro = true, signedIn = false, tab = tab), "$tab")
            assertEquals(Screen.Starting, screen(signedIn = null, tab = tab), "$tab")
            assertEquals(Screen.Home, screen(signedIn = false, locked = true, standing = Standing.Unread, tab = tab), "$tab")
            assertEquals(Screen.Home, screen(locked = true, standing = Standing.Unread, tab = tab), "$tab")
        }
        assertEquals(Screen.Home, screen(tab = Screen.Home))
        // Only Home's neighbours are tabs: anything else chosen changes nothing.
        assertEquals(Screen.Home, screen(tab = Screen.Focus))
        assertEquals(Screen.Home, screen(tab = Screen.Join))
        // Where the phone stood unread, Home, and so Me, whatever the switch reads: Me's lock row can read off.
        assertEquals(Screen.Me, screen(switch = LockSwitch.Off, standing = Standing.Unread, tab = Screen.Me))
        // The bar in the same answer as the screen, at the same moment (C6a's review): a class's screen has none, the router's
        // own Home has one, and so has the Home opened over Waiting (#151); Waiting itself, and Join opened over Home, none.
        assertFalse(tabbed(standing = inSession(ParticipationState.Unlocked), now = at(2999)))
        assertTrue(tabbed(standing = Standing.Out) && tabbed(standing = inSession(null)))
        assertFalse(tabbed(standing = Standing.Waiting))
        assertTrue(tabbed(standing = Standing.Waiting, opened = listOf(Screen.Home)))
        assertFalse(tabbed(standing = Standing.Out, opened = listOf(Screen.Join)))
    }

    @Test
    fun homeOverUnlockedItsPrimaryWayOnWithItsTabBarAndJoinOverItOnlyWhileUnlockedIsTheRoutersOwn() {
        // C5c; the owner's ruling, 2026-09-30: the apps still open, History and Me honoured there; never over Focus, Protection
        // off or Session over.
        val unlocked = inSession(ParticipationState.Unlocked)
        assertEquals(Screen.Home, screen(standing = unlocked, opened = listOf(Screen.Home)))
        assertTrue(tabbed(standing = unlocked, opened = listOf(Screen.Home)))
        for (tab in listOf(Screen.History, Screen.Me)) assertEquals(tab, screen(standing = unlocked, opened = listOf(Screen.Home), tab = tab))
        assertEquals(Screen.Join, screen(standing = unlocked, opened = listOf(Screen.Home, Screen.Join), tab = Screen.Me))
        assertFalse(tabbed(standing = unlocked, opened = listOf(Screen.Home, Screen.Join)))
        assertEquals(Screen.Focus, screen(standing = inSession(ParticipationState.Focused), opened = listOf(Screen.Home)))
        assertEquals(Screen.ProtectionOff, screen(standing = inSession(ParticipationState.ProtectionOff), opened = listOf(Screen.Home)))
        assertEquals(Screen.SessionOver, screen(standing = unlocked, opened = listOf(Screen.Home), now = ended))
        assertFalse(tabbed(standing = unlocked, opened = listOf(Screen.Home), now = ended))
        // Its Unlocked gone, the bell rung, then Session over's Done, or a read saying out: the Home it opened is the router's
        // own Home, its tab bar, its tabs (santa's round 1).
        for ((standing, closed) in listOf(unlocked to session(), Standing.Out to null)) {
            assertEquals(Screen.Me, screen(standing = standing, sessionOverClosed = closed, opened = listOf(Screen.Home), tab = Screen.Me, now = ended))
            assertTrue(tabbed(standing = standing, opened = listOf(Screen.Home), closed = closed, now = ended), "$standing")
        }
    }

    @Test
    fun waitingsBackToHomeTheRegularHomeItsTabBarNeverAHomeStackedOverWaitingAndTheStartFoundIsFocusWhateverWasOpened() {
        // #151, the owner's decision, 2026-10-01: History and Me honoured there, Join over it as over any Home; Waiting itself
        // stays the tap's answer, with no bar. Home's card saying the wait is AN10d's.
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting))
        assertFalse(tabbed(standing = Standing.Waiting))
        assertEquals(Screen.Home, screen(standing = Standing.Waiting, opened = listOf(Screen.Home)))
        assertTrue(tabbed(standing = Standing.Waiting, opened = listOf(Screen.Home)))
        for (tab in listOf(Screen.History, Screen.Me)) assertEquals(tab, screen(standing = Standing.Waiting, opened = listOf(Screen.Home), tab = tab))
        assertEquals(Screen.Join, screen(standing = Standing.Waiting, opened = listOf(Screen.Home, Screen.Join), tab = Screen.Me))
        assertFalse(tabbed(standing = Standing.Waiting, opened = listOf(Screen.Home, Screen.Join)))
        for (tab in listOf(Screen.Home, Screen.History, Screen.Me)) {
            assertEquals(Screen.Focus, screen(standing = rung, opened = listOf(Screen.Home), tab = tab), "$tab")
            assertEquals(Screen.Focus, screen(standing = rung, opened = listOf(Screen.Home, Screen.Join), tab = tab), "$tab")
        }
    }

    @Test
    fun inNoClassTheStudentLandsOnHomeNeverAJoinOfItsOwnItsTabBarAndJoinOpenedOverItAndNothingElseMoves() {
        // #143; the owner's ruling, 2026-10-07: never in a class on this phone, removed from their last, or having left it. Its
        // card in the hero's place, with Join a class, is AN10d's.
        val (unlocked, none) = inSession(ParticipationState.Unlocked) to inNone()
        assertEquals(Screen.Unlocked, screen(standing = unlocked, me = none))
        assertEquals(Screen.Home, screen(me = none))
        assertTrue(tabbed(standing = Standing.Out, me = none))
        for (tab in listOf(Screen.History, Screen.Me)) assertEquals(tab, screen(me = none, tab = tab))
        assertEquals(Screen.Join, screen(me = none, opened = listOf(Screen.Join)))
        assertFalse(tabbed(standing = Standing.Out, opened = listOf(Screen.Join), me = none))
        // Nothing else moves.
        assertEquals(Screen.Home, screen())
        assertEquals(Screen.Waiting, screen(standing = Standing.Waiting, me = none))
        assertEquals(Screen.Home, screen(standing = Standing.Unread, me = none))
        assertEquals(Screen.SessionOver, screen(standing = unlocked, me = none, now = ended))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, me = none))
        assertEquals(Screen.SignIn, screen(signedIn = false, me = none))
    }

    @Test
    fun aScreenOpenedOverAnotherStaysWhileWhereThePhoneStandsHoldsAndClosesOnceTheStandingChangesOrATapIsMadeOrAnswered(): Unit =
        runBlocking {
            // C3. The classes read, the link, a failed read change nothing, nor a tap sent again. In no class, the router's own
            // is Home (#143): Join opened over it, its code typed, and a tab chosen there stay, at a first read saying none, the
            // classes gone or a read saying none again (santa's rounds 1 and 2: waiting too). A read saying out, once the bell has
            // rung by the phone's clock, changes nothing the student sees, so it keeps what they opened or chose since, History
            // from Session over (C5b's hand-off); before the bell, the class ending is a change.
            val bell = SyncState(standing = rung)
            assertTrue(SyncState(standing = Standing.Out).keepsOpened(bell, ended))
            assertFalse(SyncState(standing = Standing.Out).keepsOpened(bell, at(2999)))
            assertFalse(SyncState(standing = inSession(ParticipationState.Focused, session("t"))).keepsOpened(bell, ended))
            assertFalse(SyncState(standing = Standing.Waiting).keepsOpened(bell, ended))
            // The same class, still past its bell (the sweep not run yet, a state changed, or its bell a millisecond off the copy
            // the file kept): no change either; its bell moved on, an extension, is one.
            val kept = inSession(ParticipationState.Unlocked, SessionView("s", "c", ended.plusMillis(1)))
            assertTrue(SyncState(standing = kept).keepsOpened(bell, at(3001)))
            assertFalse(SyncState(standing = inSession(ParticipationState.Focused, session(endsAt = 3600))).keepsOpened(bell, at(3001)))
            val before = SyncState(standing = Standing.Waiting)
            var after = before.copy(link = Link.Unreachable, meFailed = SendResult.NetworkError, heardAt = t0)
            assertTrue(after.keepsOpened(before, t0))
            after = after.copy(me = me(Answer.me(null, classes = listOf(Answer.inClass("c")))))
            assertTrue(after.keepsOpened(before, t0))
            // No classes while waiting (an armed tap needs no enrollment) is still Waiting's: what was opened over it stays.
            val none = me(Answer.me(null))
            after = after.copy(me = none)
            assertTrue(after.hasClasses == false && after.keepsOpened(before, t0))
            val out = SyncState(standing = Standing.Out, me = none)
            val outBefore = out.copy(me = null)
            assertTrue(outBefore.keepsOpened(outBefore, t0))
            // Out, Join is never the router's own (#143): the classes read as none close nothing; where the phone stands
            // changing still does.
            val inClass = out.copy(me = me(Answer.me(null, classes = listOf(Answer.inClass("c")))))
            for (from in listOf(inClass, out, outBefore)) assertTrue(out.keepsOpened(from, t0))
            assertFalse(out.keepsOpened(inClass.copy(standing = inSession(ParticipationState.Unlocked)), t0))
            assertTrue(inClass.keepsOpened(out, t0))
            assertFalse(after.copy(me = null, standing = Standing.Out).keepsOpened(before, t0))
            assertFalse(before.keepsOpened(null, t0))
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            val tapped = before.copy(queued = outbox.records())
            assertFalse(tapped.keepsOpened(before, t0))
            assertFalse(before.keepsOpened(tapped, t0))
            send(outbox, tap, 503)
            val retried = tapped.copy(queued = outbox.records())
            assertEquals(1, retried.queued.first().attempts)
            assertTrue(retried.keepsOpened(tapped, t0))
        }

    @Test
    fun aTapNotYetAnsweredHoldsTheLockOnSoFocusWhateverThePhoneStoodInToItsCapNotOnceTheStudentUnlockedAfterItNorOnceRefused(): Unit =
        runBlocking {
            // Decisions 7 and 11.
            val (outbox, _) = makeOutbox()
            val tap = record(outbox, Change.Tap("tag"))
            val held = outbox.records()
            for (standing in listOf(Standing.Out, Standing.Waiting, Standing.Unread, inSession(ParticipationState.Unlocked, later), inSession(null, later))) {
                assertEquals(Screen.Focus, screen(standing = standing, queued = held), "$standing")
            }
            assertEquals(Screen.Focus, screen(queued = held, now = t0 + SyncState.TAP_CAP - Duration.ofSeconds(1)))
            assertEquals(Screen.Home, screen(queued = held, now = t0 + SyncState.TAP_CAP))
            val unlocked = inSession(ParticipationState.Unlocked, later)
            assertEquals(Screen.Unlocked, screen(standing = unlocked, queued = held, now = t0 + SyncState.TAP_CAP))
            record(outbox, Change.UnlockUnderTap(tap.eventId, null))
            val unlockedAfter = outbox.records()
            assertEquals(Screen.Home, screen(queued = unlockedAfter))
            assertEquals(Screen.Unlocked, screen(standing = unlocked, queued = unlockedAfter))
            val (refused, _) = makeOutbox()
            val refusedTap = record(refused, Change.Tap("tag"))
            send(refused, refusedTap, 409, Answer.refused("session_not_running"))
            val stuck = refused.records()
            assertTrue(stuck.first().stuck)
            assertEquals(Screen.Home, screen(queued = stuck))
        }

    @Test
    fun theSwitchOnceReadOnAStartingReadRoutesAsOnOutOfAnySessionAndPastTheBellNeverOnceJudgedOffNorOnAPhoneNeverOn() {
        // C1b, Q3: a switch starting as Bali or the phone starts, the service not bound yet, routes as on while `everApproved`
        // is set and the check doesn't judge it off; off still routes to the permission step, and so does starting on a phone
        // whose switch never read on, or once it lasts the grace; nothing else moves.
        assertEquals(Screen.Home, screen(switch = LockSwitch.Starting, everApproved = true))
        assertEquals(Screen.Waiting, screen(switch = LockSwitch.Starting, everApproved = true, standing = Standing.Waiting))
        assertEquals(Screen.Home, screen(switch = LockSwitch.Starting, everApproved = true, me = inNone()))
        assertEquals(Screen.SessionOver, screen(switch = LockSwitch.Starting, everApproved = true, standing = rung, now = ended))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Off, everApproved = true))
        assertEquals(Screen.Permission, screen(switch = LockSwitch.Starting, everApproved = false))
        assertEquals(Screen.Starting, screen(switch = LockSwitch.Starting, checked = false, everApproved = true))
        assertEquals(Screen.Intro, screen(intro = true, signedIn = false, switch = LockSwitch.Starting, everApproved = true))
        assertEquals(Screen.SignIn, screen(signedIn = false, switch = LockSwitch.Starting, everApproved = true))
        // Q3: starting past the grace is judged off, so never on, the flag still set before it's cleared: the permission step,
        // out of a session, waiting and past the bell.
        for (standing in listOf(Standing.Out, Standing.Waiting, rung)) {
            assertEquals(
                Screen.Permission, screen(switch = LockSwitch.Starting, switchedOff = true, everApproved = true, standing = standing, now = ended),
                "$standing",
            )
        }
    }
}

/**
 * The phone's clock as the bell's wait reads it, iOS's `Reads`: its time, each read counted, set forward or back by [turn],
 * and a sleep that counts only the time that passes ([advance]), as the phone's does ([SystemClock]), so a clock set never
 * ends one. The rig's [TestClock] wakes a sleep its clock is turned past, which would hide a change never looked at.
 */
class PhoneClock : SyncClock {
    private class Sleeper(val ends: Duration, val wake: CancellableContinuation<Unit>)

    private val lock = Any()
    private var time = t0
    private var running = Duration.ZERO
    private val sleepers = mutableListOf<Sleeper>()
    private val count = AtomicInteger()

    /** How many times the clock has been read. */
    val reads: Int get() = count.get()

    /** The sleeps under way, each by how long the phone will have run when it ends. */
    val sleeps: List<Duration> get() = synchronized(lock) { sleepers.map { it.ends } }

    override fun now(): Instant = synchronized(lock) { time }.also { count.incrementAndGet() }

    override fun uptime(): Duration = synchronized(lock) { running }

    override fun zone(): ZoneId = central

    override suspend fun sleep(until: Instant) =
        suspendCancellableCoroutine<Unit> { wake ->
            val sleeper = synchronized(lock) { Sleeper(running + Duration.between(time, until), wake) }
            wake.invokeOnCancellation { synchronized(lock) { sleepers.remove(sleeper) } }
            val due =
                synchronized(lock) {
                    when {
                        !wake.isActive -> false
                        sleeper.ends <= running -> true
                        else -> false.also { sleepers += sleeper }
                    }
                }
            if (due) wake.resume(Unit)
        }

    /** Time passes: the clock and how long the phone has run move on together, and each sleep then due wakes. */
    fun advance(by: Duration) {
        val due =
            synchronized(lock) {
                time += by
                running += by
                sleepers.filter { it.ends <= running }.also { sleepers -= it.toSet() }
            }
        due.forEach { it.wake.resume(Unit) }
    }

    /** The clock set, forward or back: how long the phone has run doesn't move, so no sleep wakes. */
    fun turn(by: Duration) = synchronized(lock) { time += by }
}

/** The bell, where the router chooses again (C5a, C5b): BaliOutbox's BellRedrawTests, and the bell aimed afresh at each look. */
class BellRedrawTest {
    /**
     * The bells' own scope, apart from the test's, so a bell that ignored a cancel, or never returned, fails its test by name
     * rather than holding the test open. Cancelled as each test ends.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun stopBells() = scope.cancel()

    @Test
    fun sleptTowardsByThePhonesOwnClockAndLookedAtAgainWheneverAndroidSaysTheTimeWasSetAClockSetPastTheBellEndsTheWaitAtOnce(): Unit =
        runBlocking {
            // The bell reached by sleeping ends it, by the phone's clock, and so does a cancel, once it is asleep, its sleep let go.
            val slept = PhoneClock()
            val rang = scope.async { Screen.bell(at(60), emptyFlow(), slept) }
            eventually { slept.sleeps == listOf(Duration.ofSeconds(60)) }
            slept.advance(Duration.ofSeconds(60))
            withTimeout(patience) { rang.await() }
            val asleep = PhoneClock()
            val cancelled = scope.launch { Screen.bell(at(3600), emptyFlow(), asleep) }
            eventually { asleep.sleeps.size == 1 }
            withTimeout(patience) { cancelled.cancelAndJoin() }
            assertTrue(cancelled.isCancelled)
            assertEquals(emptyList(), asleep.sleeps)
            // Followed and asleep, a change made now is seen, and looked at, a read of the clock, short of the bell, which ends
            // nothing: it is looked at again at the next (iOS's santa: no timing). Then the clock set forward past the bell ends
            // the wait at once, where the sleep alone would have waited out the time left (C5a's review).
            val (changes, clock) = MutableSharedFlow<Unit>() to PhoneClock()
            val ringing = scope.async { Screen.bell(at(3600), changes, clock) }
            eventually { changes.subscriptionCount.value == 1 && clock.sleeps.size == 1 }
            var read = clock.reads
            changes.emit(Unit)
            eventually { clock.reads > read }
            read = clock.reads
            changes.emit(Unit)
            eventually { clock.reads > read }
            clock.turn(Duration.ofSeconds(3600))
            changes.emit(Unit)
            withTimeout(patience) { ringing.await() }
        }

    @Test
    fun aClockSetForwardShortOfTheBellIsSleptTowardsAnewSoTheBellRingsByTheClockNeverLateByTheChangeAndOneSetBackSleepsOnToIt(): Unit =
        runBlocking {
            // The bell an hour off: set forward half an hour, the sleep aimed afresh at the half hour left by the clock.
            val (changes, forward) = MutableSharedFlow<Unit>() to PhoneClock()
            val ringing = scope.async { Screen.bell(at(3600), changes, forward) }
            eventually { changes.subscriptionCount.value == 1 && forward.sleeps == listOf(Duration.ofSeconds(3600)) }
            forward.turn(Duration.ofSeconds(1800))
            changes.emit(Unit)
            eventually { forward.sleeps == listOf(Duration.ofSeconds(1800)) }
            forward.advance(Duration.ofSeconds(1800))
            withTimeout(patience) { ringing.await() }
            // Set back an hour with no change said: the sleep ends with the bell still an hour off, and sleeps on to it.
            val back = PhoneClock()
            val later = scope.async { Screen.bell(at(3600), emptyFlow(), back) }
            eventually { back.sleeps == listOf(Duration.ofSeconds(3600)) }
            back.turn(Duration.ofSeconds(-3600))
            back.advance(Duration.ofSeconds(3600))
            eventually { back.sleeps == listOf(Duration.ofSeconds(7200)) }
            back.advance(Duration.ofSeconds(3600))
            withTimeout(patience) { later.await() }
        }
}
