package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.UserRole
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

// Which screen the student app shows (C1 to C6), BaliOutbox's Screen.swift: the router (`choose`), the bell where it chooses
// again, and what the student opened kept across a change (`keepsOpened`). Its rules alone: the router's run is AN10b's, every
// word AN10d's to AN10h's, each screen Phase 10's, and `Screen.Move` AS2's.

/**
 * Which screen the student app shows (C1 to C6), from what the phone knows: the one place that decides it. A screen renders its
 * own and calls the engine, the enforcer or the account, no rule living in one, so every rule here runs on the JVM. Each is a
 * type, never a word: the words are AN10d's to AN10h's.
 */
sealed interface Screen {
    /** Nothing known yet: the sign-in, the engine or the enforcer hasn't spoken. */
    data object Starting : Screen

    /** The 13+ check (C7): its question. */
    data object Age : Screen

    /** The 13+ check's stop screen, after an answer under 13. */
    data object TooYoung : Screen

    /** Your name (the owner's decision, 2026-10-07): a student's account with no name names itself, so a teacher always sees a real one. */
    data object Name : Screen

    /**
     * A teacher's account (the owner, 2026-11-07; DECISIONS 2026-11-07, #541): the app is the students', so this screen and
     * nothing else, built in Phase 10 from the approved iPhone board.
     */
    data object Teacher : Screen

    /**
     * Once (L8a; the app canvas's ListChanged board): the consent list gained lines since this student may have seen it, and it
     * promises it never grows without asking again.
     */
    data object ListChanged : Screen

    /** Sign up's intro, before its page (C1). */
    data object Intro : Screen

    data object SignIn : Screen

    /** The lock's permission step, in Screen Time's place (AS3): Bali's service switched on in Android's Accessibility settings. */
    data object Permission : Screen

    data object Join : Screen

    data object Home : Screen

    data object Waiting : Screen

    data object Focus : Screen

    data object Unlocked : Screen

    data object ProtectionOff : Screen

    data object SessionOver : Screen

    /** Home's neighbours in the tab bar (C6): the student's own history, and Me. */
    data object History : Screen

    data object Me : Screen

    /**
     * Me's Delete account under way, stopped or done (C4b; [com.bali.outbox.Deleting.shows]): its own screen, over every other
     * from the press to the end, Focus included: the deletion ends the session itself, and an unlock made meanwhile would wait for
     * the next sign-in (DECISIONS, C4a).
     */
    data object Deleting : Screen

    /** The app couldn't start: why, [problem], shown with a way to try again (rule 5). */
    data class Storage(val problem: Problem) : Screen

    /** The router's answer: the screen, and whether the tab bar shows under it (C6a), in one answer, so the two never disagree. */
    data class Shown(val screen: Screen, val tabbed: Boolean)

    /**
     * Whether this screen offers Sign out (C6b), BaliApp.swift's `offersSignOut`: Me, since every student in no class lands on
     * Home with its tab bar, so Me is the wrong account's way out (the approved Sign in & sign up design); Your name, whose only
     * other way on is a name; and a teacher's account's screen, whose other way on is the portal.
     */
    val offersSignOut: Boolean get() = this == Me || this == Name || this == Teacher

    companion object {
        /**
         * The screen for what the phone knows at [now], and whether the tab bar shows under it (C6a): [problem], why the app
         * couldn't start; [deleting], whether Me's Delete account has its own screen to show
         * ([com.bali.outbox.Deleting.shows]), before everything but a start that failed; [age], the 13+ check (C7), as
         * `Account.State.age` reads it: signed out, its question in Sign in's place once Sign up was pressed, the stop screen once
         * answered under 13; signed in, the starting mark while Bali's server is asked for the account's yes, and with none, the
         * question, before anything but a session's screens (C7-server); [intro], whether Sign up shows the intro next, before
         * its page (C1), a first launch opening on Sign in; [signedIn], none until the sign-in could say; [signedInThisRun],
         * whether a sign-in reached Bali's API this run, made here or let through by the 13+ check, rather than kept from the
         * last: the starting screen then holds where Your name could show until [sync]'s read of `GET /v1/me` answers or fails;
         * [protection], what rule 3's check found, none until the enforcer runs, unchecked until its first pass, of the lock
         * claiming only what it verified (`locked`); [everApproved], whether a pass has ever read the switch on (C1b): a
         * switch starting, as Bali or the phone starts, routes as on while it is set and the check doesn't judge it off (Q3);
         * [sync], the engine's truth, none until it runs, its `me` naming a student's account with no name, Your name where the
         * question would show, and a teacher's account, the teacher's screen there and nothing after it (the owner, 2026-11-07);
         * in no class, the student lands on Home and its empty state, never a Join of its own (the owner's ruling, 2026-10-07);
         * [listSeenBy], the student who has seen the consent list as it stands on this phone, by their id: a student `me` lists
         * in a class who isn't that one gets what the list gained, once, after Your name (L8a); [sessionOverClosed], the session
         * whose Session over the student closed, as it was then, its bell moved since being another's to close (C5b); [opened],
         * the screens the student opened over the one chosen, in order (C3): Home over Waiting (Waiting's Back to home, the
         * regular Home, #151), Join over Home, and Home over Unlocked, its primary way on (C5c), each only while the one under it
         * shows; [tab], the one chosen in the tab bar (C6a): History or Me in place of the router's own Home with nothing opened
         * over it, or of a Home opened over Unlocked or Waiting, and nowhere else. The bar shows wherever a tab is honoured.
         */
        fun choose(
            problem: Problem?, deleting: Boolean, age: AgeCheck.Answer, intro: Boolean, signedIn: Boolean?,
            signedInThisRun: Boolean, protection: Protection?, everApproved: Boolean, sync: SyncState?,
            listSeenBy: String?, sessionOverClosed: SessionView?, opened: List<Screen>, tab: Screen, now: Instant,
        ): Shown {
            if (problem != null) return Shown(Storage(problem), false)
            // Delete account pressed (C4b): its screen and nothing else, not Focus either, whose Emergency Unlock would wait
            // for the next sign-in; the deletion takes the lock off itself, as the question said.
            if (deleting) return Shown(Deleting, false)
            // The lock on by its own rule, so the screen and the lock agree: focused in a session the phone's own clock says
            // still runs (decision 6), or a tap not yet answered holding it (decision 7, to its cap; not after decision 11's
            // unlock, nor refused), is Focus before anything else, signed out or not: Focus holds Emergency Unlock.
            if (sync != null && sync.shieldedUntil(now) != null) return Shown(Focus, false)
            // Where the phone stood not read, the last run's lock found on (B6b): Home, which holds Emergency Unlock there,
            // before the sign-in too.
            if (sync?.standing == Standing.Unread && protection?.locked == true) return Shown(Home, false)
            if (signedIn == null || protection == null || !protection.checked || sync == null) return Shown(Starting, false)
            // Signed out: Sign in, or, Sign up pressed (C7), its question in place, the stop screen once answered under 13,
            // then the intro where Sign up shows it.
            if (!signedIn) {
                val gate =
                    when (age) {
                        AgeCheck.Answer.Asked -> Age
                        AgeCheck.Answer.TooYoung -> TooYoung
                        AgeCheck.Answer.Unanswered, AgeCheck.Answer.Passed, AgeCheck.Answer.Checking -> if (intro) Intro else SignIn
                    }
                return Shown(gate, false)
            }
            // Signed in, before the permission step or Home, never over a session's screens (one whose bell hasn't rung, or
            // past it with Session over not closed) nor the home a standing not read keeps: the 13+ check (C7-server, the
            // gap's fallback), then, known only once a read answers, a teacher's account's screen, Your name, and what the
            // consent list gained. A sign-in made this run holds the starting screen until a read answers or fails, the
            // phone's storage failing too, so no other screen flashes first (the owner's ruling, 2026-10-07).
            val stood = sync.standing
            val sessionShows = stood is Standing.InSession && (stood.session.endsAt > now || !stood.session.rings(sessionOverClosed))
            if (!sessionShows && stood != Standing.Unread) {
                if (age == AgeCheck.Answer.Checking) return Shown(Starting, false)
                if (age != AgeCheck.Answer.Passed) return Shown(if (age == AgeCheck.Answer.TooYoung) TooYoung else Age, false)
                if (signedInThisRun && sync.me == null && sync.meFailed == null && sync.link != Link.StorageFailed) {
                    return Shown(Starting, false)
                }
                if (sync.teacher) return Shown(Teacher, false)
                val me = sync.me
                if (me != null && me.user.role.known == UserRole.Student) {
                    if (me.user.displayName == null) return Shown(Name, false)
                    // A student in a class joined it through the list's preview, so may have seen it before its latest
                    // lines; one who has seen it as it stands here is never asked again.
                    if (me.classes.isNotEmpty() && me.user.id != listSeenBy) return Shown(ListChanged, false)
                }
            }
            var shown = settled(sync, protection, everApproved, sessionOverClosed, now)
            // Home with its tab bar: the router's own, or opened over Unlocked or Waiting. Join opened has none.
            var tabbed = shown == Home
            for (screen in opened) {
                when {
                    shown == Home && screen == Join || (shown == Waiting || shown == Unlocked) && screen == Home -> {
                        tabbed = screen == Home
                        shown = screen
                    }
                    // A Home opened over a screen that has since become Home itself (Unlocked's, after its bell) is that Home.
                    shown == Home && screen == Home -> continue
                    else -> return Shown(shown, false)
                }
            }
            return if (tabbed) Shown(if (tab == History || tab == Me) tab else Home, true) else Shown(shown, false)
        }

        /** The screen of where the phone stands, signed in and the switch checked. */
        private fun settled(
            sync: SyncState, protection: Protection, everApproved: Boolean, sessionOverClosed: SessionView?, now: Instant,
        ): Screen {
            val stood = sync.standing
            return when {
                // Not read from the phone yet: Home says so, and Emergency Unlock works there (B6b).
                stood == Standing.Unread -> Home
                // In a session still running: its state's screen, and Protection off, whatever the state, once the check
                // judges the switch off, whose screen says how back (C5b). Focused is the rule above; a state this build
                // doesn't know is Home: never Focus, which the enforcer doesn't lock for, nor an unlock the student didn't make.
                stood is Standing.InSession && stood.session.endsAt > now ->
                    when {
                        stood.state == ParticipationState.ProtectionOff || protection.switchedOff -> ProtectionOff
                        stood.state == ParticipationState.Unlocked -> Unlocked
                        else -> Home
                    }
                // No session runs by the phone's clock (the bell rung with no read yet, waiting, or out), so the switch not
                // on is the permission step; past the bell, Session over until a read says where the phone stands or the
                // student closes it (C5b).
                !approved(protection, everApproved) -> Permission
                stood == Standing.Waiting -> Waiting
                stood is Standing.InSession && !stood.session.rings(sessionOverClosed) -> SessionOver
                else -> Home
            }
        }

        /**
         * Whether the switch counts as on for the permission step (Q3, the conductor's call): on, or starting, as Bali or the
         * phone starts, while it has ever read on ([everApproved], set at on and cleared once the check judges it off) and the
         * check doesn't judge it off now. iOS's approved, or not determined once approved.
         */
        private fun approved(protection: Protection, everApproved: Boolean): Boolean =
            protection.switch == LockSwitch.On ||
                everApproved && protection.switch == LockSwitch.Starting && !protection.switchedOff

        /**
         * Returns at [bell] by the phone's own clock, [clock], where the router chooses again (C5a), or throws once its coroutine
         * is cancelled: slept towards, and looked at again at each of [changes]. A sleep counts only the time that passes, and
         * [SystemClock]'s, a `delay`, not the time the phone spends in deep sleep, so each look aims it afresh at the bell as the
         * clock reads now: a clock set forward past the bell ends the wait at once, where the sleep would wait out the time left
         * (C5a's review), and one set forward short of it, or back, is slept towards anew. [changes] are the moments the clock
         * may have moved past what a sleep counts: Android saying the time was set, and the screen coming on after the phone
         * slept (AN10c's). They are followed before the clock is first read, so a hot flow misses no change made after it.
         */
        suspend fun bell(bell: Instant, changes: Flow<Unit>, clock: SyncClock = SystemClock): Unit =
            coroutineScope {
                val looks = Channel<Unit>(Channel.CONFLATED)
                val watching = launch(start = CoroutineStart.UNDISPATCHED) { changes.collect { looks.send(Unit) } }
                while (clock.now() < bell) {
                    val sleeping =
                        launch {
                            clock.sleep(bell)
                            looks.send(Unit)
                        }
                    looks.receive()
                    sleeping.cancel()
                }
                watching.cancel()
            }
    }
}

/** Why the app couldn't start (rule 5), each said in its own words (AN10d's) with Try again. */
sealed interface Problem {
    /** This build isn't set up: a Release build with no config (AN10c). */
    data object NotSetUp : Problem

    /** The start failed, its storage not opening: [cause], which a support request needs. */
    data class StartFailed(val cause: Throwable) : Problem
}

/**
 * Whether [other] is this session with the same bell: to the second, since an extension moves it by minutes, while the copy the
 * file keeps can read a millisecond off the server's (santa's round 1).
 */
internal fun SessionView.rings(other: SessionView?): Boolean =
    other != null && other.id == id && Duration.between(other.endsAt, endsAt).abs() < Duration.ofSeconds(1)

/**
 * Whether the screens the student opened over another (C3), and the tab they chose (C6a), stay once the engine's state is this,
 * after [before], at [now]: not once the standing changes, nor once a tap is made or answered (a new arming is Waiting's again).
 * The classes read change nothing: in none, the router's own is Home too (#143; the owner's ruling, 2026-10-07), so Join opened
 * over it, its code typed, and a tab chosen there stay. A read saying out, or the same class still past its bell, once the bell
 * has rung by the phone's clock, changes nothing the student sees, the class over for the phone already, so History chosen from
 * Session over holds (C5b's hand-off).
 */
fun SyncState.keepsOpened(before: SyncState?, now: Instant): Boolean {
    val tapped = pendingTap?.eventId != before?.pendingTap?.eventId
    val ended = (before?.standing as? Standing.InSession)?.session?.takeIf { it.endsAt <= now }
    val over =
        ended != null &&
            when (val stood = standing) {
                Standing.Out -> true
                is Standing.InSession -> stood.session.rings(ended)
                Standing.Waiting, Standing.Unread -> false
            }
    return !tapped && (standing == before?.standing || over)
}
