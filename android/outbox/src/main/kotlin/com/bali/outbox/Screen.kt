package com.bali.outbox

import com.bali.core.BlockRead
import com.bali.core.HostedPage
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.SignInError
import com.bali.core.TapDisposition
import com.bali.core.UserRole
import com.bali.core.tapDisposition
import java.io.IOException
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

// Which screen the student app shows (C1 to C6), BaliOutbox's Screen.swift: the router (`choose`), the bell where it chooses
// again, and what the student opened kept across a change (`keepsOpened`); and the words of Home, a scan, the sign-in and the
// start (AN10d), each a function of its type (WordsTest reads every one). The router's run is AN10b's, the other screens' words
// AN10e's to AN10h's, each screen Phase 10's, and `Screen.Move` AS2's.

/**
 * Which screen the student app shows (C1 to C6), from what the phone knows: the one place that decides it. A screen renders its
 * own and calls the engine, the enforcer or the account, no rule living in one, so every rule here runs on the JVM. Each is a
 * type, never a word: what a screen says is a function of the types it shows.
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

/** Why the app couldn't start (rule 5), each said in its own words ([words]) with Try again. */
sealed interface Problem {
    /** This build isn't set up: a Release build with no config (AN10c). */
    data object NotSetUp : Problem

    /** The start failed, its storage not opening: [cause], which a support request needs. */
    data class StartFailed(val cause: Throwable) : Problem
}

/**
 * What the storage screen says of why Bali couldn't start (rule 5), over its Try again: BaliApp.swift's `problem`. The start that
 * failed names its cause in parentheses, as iOS's line names its error, for a support request ([named]). Never that the apps are
 * locked: a start that runs nothing has taken the last run's lock off (AN10c).
 */
val Problem.words: String
    get() =
        when (this) {
            Problem.NotSetUp -> "This copy of Bali isn't set up right. Ask your teacher."
            is Problem.StartFailed -> "Bali couldn't open its storage on this phone (${cause.named}). Try again, or ask your teacher."
        }

/**
 * A start's failure as the storage screen names it: a file's error (an `IOException`) by its message, as AS2's Storage board draws
 * one ("disk I/O error"), anything else by its type alone, so no other text an exception carries reaches a student's screen
 * (santa's review); never empty. SQLite's own error is named by its type: on a phone its class is a typealias of Android's, which
 * no `is` in `outbox` may name.
 */
private val Throwable.named: String
    get() = message?.takeIf { this is IOException && it.isNotBlank() } ?: javaClass.simpleName.ifEmpty { javaClass.name }

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

/**
 * Why the phone's newest tap is stuck (rule 5; kept and retried until recorded, ARCHITECTURE tap step 10), as Home and Waiting
 * say it ([words]): refused as a block no teacher set up, refused for anything else, or left unsettled by the retry bound.
 */
enum class StuckTap {
    /** Refused as a block Bali doesn't know (404): who can set it up is the way on. */
    UnknownBlock,

    /** Refused for anything else, the refusal the record keeps whatever answers came since: tapping again is the way on. */
    Refused,

    /** Unsettled at the retry bound by answers the outbox only retries: still being sent (#114's review). */
    StillSending,
}

/**
 * The latest tap the server refused, or the retry bound left unsettled, keyed on the refusal the record keeps whatever answers came
 * since (the riders), else its last answer, a refusal where `tapDisposition` says one; none while none is stuck. An answer the outbox
 * only retries (401, 408, 429, a server error, none) says nothing of why it is stuck: short of the bound's count of answers only a
 * refusal stuck it, one a file older than its kept refusal holds, so its refusal stands; at the bound, it is still being sent, never
 * "tap in again" then. Only while it is the phone's newest tap (#146): once the student taps again, the later tap is the one that
 * counts, the refused one still kept and retried, said no more. A file that names no tap leaves the latest stuck one said.
 * BaliOutbox's `refusedTapWords`, its kind a type here.
 */
val SyncState.stuckTap: StuckTap?
    get() {
        val stuck = queued.lastOrNull { it.change is Change.Tap && it.stuck } ?: return null
        if ((lastTap ?: stuck.eventId) != stuck.eventId) return null
        val status = stuck.refusedStatus ?: stuck.lastStatus
        return when {
            status == 404 -> StuckTap.UnknownBlock
            status != null && tapDisposition(SendResult.Status(status), null) == TapDisposition.RetryAndSurface -> StuckTap.Refused
            stuck.answers < Outbox.BOUND -> StuckTap.Refused
            else -> StuckTap.StillSending
        }
    }

/**
 * What Home and Waiting say of a stuck tap, with the way on the screen saying it has (#160's review): on Home in no class
 * ([inNoClass]), which has no Tap in (#143), its Try again; Tap in again everywhere else.
 */
fun StuckTap.words(inNoClass: Boolean): String =
    when (this) {
        StuckTap.UnknownBlock -> "Bali doesn't know a block you tapped, so that tap hasn't counted. Ask your teacher to set it up."
        StuckTap.Refused ->
            if (inNoClass) "Bali couldn't record a tap. Try again, or ask your teacher." else "Bali couldn't record a tap. Tap in again, or ask your teacher."
        StuckTap.StillSending -> "Bali couldn't record a tap yet. It keeps trying."
    }

/** What Home and Waiting say of the phone's newest tap stuck ([stuckTap]): BaliOutbox's `refusedTapWords`. */
val SyncState.refusedTapWords: String? get() = stuckTap?.words(inNoClass)

/**
 * What Home's card says while the phone waits for its teacher's Start (#151; the owner's decision, 2026-10-01): Waiting's Back to
 * home lands on the regular Home, which says the tap counted and when the phone locks, in the hero's place, never "Tap your
 * teacher's block" as if it hadn't. None otherwise. iOS's second line, the apps locking in a few seconds while Bali checks in after
 * the class-started alert, waits for that check-in (AN12's).
 */
val SyncState.waitingCard: String?
    get() = if (standing == Standing.Waiting) "You're tapped in. Your phone locks when class starts, as long as Bali is open." else null

/** Out of any session, `GET /v1/me` listing the student in no class: Home's empty state, Tap in no way in, since a tap joins only a class the student is in (#143). */
internal val SyncState.inNoClass: Boolean get() = standing == Standing.Out && hasClasses == false

/**
 * What Home's card says in the hero's place there, with Join a class (#143; the owner's ruling, 2026-10-07: Home, never a forced
 * Join): to a student never in a class on this phone ([everInClass]), not in one yet; to one removed from their last, or who left
 * it, in none any more. None anywhere else.
 */
fun SyncState.noClassesCard(everInClass: Boolean): String? =
    when {
        !inNoClass -> null
        everInClass -> "You're not in any classes. Join one with the class code from your teacher."
        else -> "You're not in a class yet. Join one with the class code from your teacher."
    }

/** Home's empty state for the account's student: [SyncState.noClassesCard], keyed on whether they were ever in a class here ([Account.State.everInClass], the notes'). */
val Account.State.noClassesCard: String? get() = sync?.noClassesCard(everInClass)

/** What Home and Waiting say while `GET /v1/me` gives no answer (rule 5), beside Try again: in the Join screen's words; none while none failed. */
val SyncState.meWords: String? get() = meFailed?.let { Joining.words(it, null) }

/**
 * What the phone says when a scan recorded no tap (rule 5), with the way on: none for a block's code, the tap, nor for a scan the
 * student closed, which changed nothing. BaliOutbox's `BlockRead.words`, a phone that can't read NFC in the Words board's line, and
 * NFC off, Android's alone, in AS4's NFC sheet's (AS0).
 */
val BlockRead.words: String?
    get() =
        when (this) {
            is BlockRead.Block, BlockRead.Cancelled -> null
            BlockRead.NotBali -> "That isn't a Bali block. Hold your phone to your teacher's block."
            BlockRead.Unsupported -> "This phone can't read Bali blocks, so it can't tap in. Ask your teacher."
            BlockRead.NfcOff -> "Turn on NFC in Settings to read your teacher's block."
            is BlockRead.Failed -> "The scan didn't finish. Try again."
        }

/**
 * What the Sign in screen says under its buttons when a sign-in through [page] didn't finish (rule 5): the kind of failure in plain
 * words, and another try as the way on; none for a page the student closed, where nothing changed. A refusal's OAuth code is never
 * shown: the codes that mean something to a student have their own words, the rest one line (the readout has the code). Only a page
 * that couldn't open names its page, every way it can't (Q10: another sign-in page open, the Auth Tab's own end, no browser to open
 * it). BaliOutbox's `SignInError.words`.
 */
fun SignInError.words(page: HostedPage): String? =
    when (this) {
        SignInError.Cancelled -> null
        is SignInError.NotOpened ->
            when (page) {
                HostedPage.SignUp -> "The sign-up page couldn't open. Try again, or ask your teacher."
                HostedPage.SignIn -> "The sign-in page couldn't open. Try again, or ask your teacher."
            }
        SignInError.Unreachable -> "Can't reach the sign-in server. Check your connection and try again."
        is SignInError.Refused ->
            when (error) {
                "access_denied" -> "The sign-in server didn't allow this sign-in. Ask your teacher."
                "server_error", "temporarily_unavailable" -> "The sign-in server isn't working right now. Try again in a moment."
                else -> "The sign-in was refused. Try again, or ask your teacher."
            }
        SignInError.NotKept -> "Your phone couldn't keep the sign-in. Try again."
    }
