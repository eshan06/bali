package com.bali.outbox

import com.bali.core.HostedPage
import com.bali.core.Landing
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SignIn
import java.io.File
import java.net.URI
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

// The phone's account half (AN9e), over the engine as the app makes it, its sign-in gated as the app's is, and the API and
// Cognito answered by hand: AppTests' ageFromServer, ageAgainInClass, forgetsAnother, deleteAccountWiring with its notes
// (AN10b) and signedInAs, their engine halves, the screens and their words AN10d's to AN10h's and Phase 10's. And new: each
// sign-in that lands counted, a renewal never (Q2); a deletion answered once another account's sign-in landed (AN9h's
// window); an answer under 13 held for the run alone (Q5); the check asked again at each wake while unanswered (Q8); an
// Emergency Unlock queued across another's sign-in; and Me's name and Leave started afresh at a sign-in, the last student's
// answers dropped (AN10b). The router's half, the ask never while the question shows, is RouterTest's.

val notPassed = """{"passed":false}"""

/** The app's account half over [rig]'s engine and sign-in, the notes [notes], run as the app runs it: back once it knows who is signed in. */
private suspend fun EngineFiles.account(rig: SignedRig, notes: Notes = MemoryNotes()): Account {
    val account = checkNotNull(Account.of(rig.engine, scope, rig.clock, notes))
    scope.launch { account.run() }
    account.until { it.signedIn != null }
    return account
}

/** Waits for a state [condition] holds for, and returns it; none in time fails the test. */
suspend fun Account.until(condition: (Account.State) -> Boolean): Account.State =
    withTimeoutOrNull(patience) { state.first(condition) } ?: fail("the account never reached the state waited for: ${state.value}")

/** Each read of the truth answered with [me] as it comes, until [done]. */
suspend fun SignedRig.readsAnswered(me: String = Answer.me(null), done: () -> Boolean) =
    eventually {
        if (meRoute in server.waiting) server.next(meRoute).reply(200, me)
        done()
    }

/** The next request to [route], each read of the truth sent before it answered: a deletion waits out the loops' (AN9b). */
private suspend fun SignedRig.pastReads(route: String): Server.Exchange {
    while (true) {
        val next = server.next()
        if (next.route == route) return next
        assertEquals(meRoute, next.route)
        next.reply(200, Answer.me(null))
    }
}

/** [access]'s student signed in and let through the 13+ check on Bali's yes, the truth read with [me] until the account shows it. */
suspend fun SignedRig.through(account: Account, access: String, refresh: String = "refresh-1", me: String = Answer.me(null)) {
    signStudentIn(access, refresh)
    server.next(ageCheckRoute).reply(200, ageCheckPassed)
    readsAnswered(me) { account.state.value.let { it.age == AgeCheck.Answer.Passed && it.sync?.me != null } }
}

/** The next launch's sign-in and engine, over [rig]'s keychain and [file] opened afresh, with a server of their own; [rig]'s loops ended first. */
private suspend fun EngineFiles.relaunched(rig: SignedRig, file: File): SignedRig {
    withTimeout(patience) { rig.running.cancelAndJoin() }
    val server = Server()
    val signIn = SignIn(rig.signIn.cognito, rig.keychain, scope, server, rig.clock::now, gated = true)
    val outbox = open(file)
    val engine = SyncEngine.make(outbox, URI("https://api.bali.test"), signIn, scope, server, rig.clock)
    return SignedRig(engine, signIn, outbox, server, rig.clock, rig.keychain, scope)
}

/** A birth month and year under 13 by [SignedRig.clock]: this month, this year. */
private fun SignedRig.thisMonth(): Pair<Int, Int> = clock.now().atZone(clock.zone()).let { it.monthValue to it.year }

/** The phone's account half: BaliApp.swift's `Phone`'s, its engine halves (AppTests). */
class AccountTest : EngineFiles() {
    @Test
    fun aSignInNotThroughTheCheckIsAskedOfBaliUnderItsOwnAccountTheStartingMarkMeanwhileAYesLetsItThroughNoYesSent(): Unit =
        runBlocking {
            // AppTests' ageFromServer, passed: right after a sign-in, GET /v1/me/age-check is the one call it makes (C7-server).
            val rig = signedRig(gated = true)
            val account = account(rig)
            assertEquals(false, account.state.value.signedIn)
            rig.signStudentIn(accessToken("a1"))
            val read = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("a1")}", read.token)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Checking }
            rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            assertEquals(emptyList(), rig.server.waiting)
            read.reply(200, ageCheckPassed)
            val truth = rig.server.next(meRoute)
            assertEquals("Bearer ${accessToken("a1")}", truth.token)
            truth.reply(200, Answer.me(null))
            val through = account.until { it.age == AgeCheck.Answer.Passed && it.sync?.me != null }
            assertTrue(through.signedInThisRun)
            assertTrue(rig.signIn.checked())
            assertNull(rig.signIn.yes())
            assertTrue(rig.server.sent.none { it.route == recordAgeCheckRoute })
            rig.stop()
        }

    @Test
    fun noYesOnBaliTheQuestionNothingMoreSentAnsweredThirteenOrOlderTheSignInGoesThroughItsYesRecordedUnderOneEventId(): Unit =
        runBlocking {
            // AppTests' ageFromServer, no yes: the question (AS2's), its answer the account's (C7-server).
            val rig = signedRig(gated = true)
            val account = account(rig)
            rig.signStudentIn(accessToken("a1"))
            rig.server.next(ageCheckRoute).reply(200, notPassed)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            assertEquals(emptyList(), rig.server.waiting)

            account.answerAge(1, 2000)
            // The yes at the next wake, and the truth read, in either order (AgeFallbackTest's).
            val yes = rig.pastReads(recordAgeCheckRoute)
            assertEquals("Bearer ${accessToken("a1")}", yes.token)
            assertTrue(uuidV7.matches(assertNotNull(yes.eventId)))
            yes.reply(200, ageCheckPassed)
            eventually { rig.signIn.yes() == null }
            rig.readsAnswered { account.state.value.sync?.me != null }
            val through = account.state.value
            assertEquals(AgeCheck.Answer.Passed, through.age)
            assertTrue(through.signedInThisRun)
            assertTrue(rig.signIn.checked())
            assertEquals(1, rig.server.sent.count { it.route == recordAgeCheckRoute })
            assertTrue(rig.server.sent.all { it.token == null || it.token == "Bearer ${accessToken("a1")}" })
            rig.stop()
        }

    @Test
    fun anAnswerOfThirteenOrOlderIsKeptForTheAccountWhoseQuestionItWasNeverForAnotherSignInLandedAsItWasGiven(): Unit =
        runBlocking {
            // AN9h's rule for the yes: a1's question answered as b1's sign-in lands, before the account follows it (its follow
            // ended here): b1 is asked itself, its own read first, never through on a1's answer.
            val rig = signedRig(gated = true)
            val account = checkNotNull(Account.of(rig.engine, scope, rig.clock))
            val following = scope.launch { account.run() }
            account.until { it.signedIn != null }
            rig.signStudentIn(accessToken("a1"))
            rig.server.next(ageCheckRoute).reply(200, notPassed)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            withTimeout(patience) { following.cancelAndJoin() }
            rig.signStudentIn(accessToken("b1"), refresh = "refresh-b")
            account.answerAge(1, 2000)
            assertEquals("b1", rig.signIn.account())
            assertFalse(rig.signIn.checked())
            assertNull(rig.signIn.yes())
            // Nor does the account claim a pass the sign-in doesn't hold.
            assertEquals(AgeCheck.Answer.Unanswered, account.state.value.age)
            rig.stop()
        }

    @Test
    fun answeredUnder13TheAccountIsDeletedAsDeleteAccountDeletesOneNoYesSentTheAnswerHeldThroughItsSignOut(): Unit =
        runBlocking {
            // AppTests' ageFromServer, under 13: the gap's fallback deletes the account made around the question (C7, C4).
            val rig = signedRig(gated = true)
            val account = account(rig)
            rig.signStudentIn(scoped("a1"))
            rig.server.next(ageCheckRoute).reply(200, notPassed)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            val (month, year) = rig.thisMonth()
            val answering = scope.async { account.answerAge(month, year) }
            val delete = rig.server.next(deleteMeRoute)
            assertEquals("Bearer ${scoped("a1")}", delete.token)
            assertEquals(Deleting.Busy, account.state.value.deleting)
            assertEquals(AgeCheck.Answer.TooYoung, account.state.value.age)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            withTimeout(patience) { answering.await() }
            val done = account.until { it.signedIn == false && it.deleting == Deleting.Done }
            assertEquals(AgeCheck.Answer.TooYoung, done.age)
            assertTrue(rig.keychain.isEmpty)
            assertTrue(rig.server.sent.none { it.route == recordAgeCheckRoute })
            rig.stop()
        }

    @Test
    fun anAnswerUnder13IsHeldInMemoryForTheRunAloneWrittenNowhereAndARelaunchAsksAgain(): Unit =
        runBlocking {
            // Q5 (C7 keeps nothing anywhere). Signed out, Sign up's question: the stop for this run, nothing kept or sent, and
            // no way back to the question in it.
            val (outbox, file) = makeOutbox()
            val rig = signedRig(outbox, gated = true)
            val account = account(rig)
            val (month, year) = rig.thisMonth()
            account.answerAge(month, year)
            assertEquals(AgeCheck.Answer.TooYoung, account.state.value.age)
            account.answerAge(1, 2000)
            assertEquals(AgeCheck.Answer.TooYoung, account.state.value.age)
            assertTrue(rig.keychain.isEmpty)
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(emptyList(), rig.server.sent)
            val relaunch = relaunched(rig, file)
            assertEquals(AgeCheck.Answer.Unanswered, account(relaunch).state.value.age)
            relaunch.stop()

            // Signed in, around the question: its deletion held back by an Emergency Unlock unsent, nothing of the answer kept
            // with the sign-in, which a relaunch asks Bali about again.
            val (second, kept) = makeOutbox()
            val signedIn = signedRig(second, gated = true)
            val asked = account(signedIn)
            val unlock = assertNotNull(signedIn.engine.record(Change.Unlock("s", null)))
            signedIn.signStudentIn(scoped("a1"))
            signedIn.server.next(ageCheckRoute).reply(200, notPassed)
            asked.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            signedIn.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            val tokens = assertNotNull(signedIn.keychain.load())
            val answering = scope.async { asked.answerAge(month, year) }
            signedIn.server.next(unlockRoute).reply(null)
            withTimeout(patience) { answering.await() }
            assertEquals(Deleting.Stopped(Deleting.Stop.UnlockUnsent), asked.state.value.deleting)
            assertEquals(AgeCheck.Answer.TooYoung, asked.state.value.age)
            assertTrue(tokens.contentEquals(signedIn.keychain.load()), "the answer went into the sign-in's keeping")
            assertEquals(listOf(unlock.eventId), signedIn.outbox.records().map { it.eventId })
            assertTrue(signedIn.server.sent.none { it.route == recordAgeCheckRoute })
            val again = relaunched(signedIn, kept)
            account(again)
            assertEquals("Bearer ${scoped("a1")}", again.server.next(ageCheckRoute).token)
            again.stop()
        }

    @Test
    fun theCheckBaliCouldntBeReachedForIsAskedAgainAtEachWakeAYesLetsItThroughBeforeTheBellTheUnlockMadeMeanwhileSentAtOnce(): Unit =
        runBlocking {
            // AppTests' ageAgainInClass, Bali back with a yes (#300's review; Q8): over Focus the question can't show, so Bali is
            // asked again at the engine's wakes, and a yes sends the Emergency Unlock it held. With no router reading the account,
            // each wake asks; the router's half, never while the question shows, is RouterTest's.
            val (outbox, _) = makeOutbox()
            outbox.keep(Standing.InSession(session(), ParticipationState.Focused))
            val rig = signedRig(outbox, gated = true)
            val account = account(rig)
            rig.signStudentIn(accessToken("a1"))
            val first = rig.server.next(ageCheckRoute)
            // The sign-in's own wake over (its read found no token) before the ask is answered, so no wake asks twice.
            rig.until { it.meFailed == SendResult.NetworkError }
            first.reply(null)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            assertNotNull(rig.engine.emergencyUnlock())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Unlocked) }
            rig.engine.retryNow()
            rig.server.next(ageCheckRoute).reply(null)
            rig.engine.retryNow()
            rig.server.next(ageCheckRoute).reply(200, ageCheckPassed)
            val unlock = rig.server.next(unlockRoute)
            assertEquals("Bearer ${accessToken("a1")}", unlock.token)
            assertTrue(rig.clock.now() < session().endsAt)
            unlock.reply(200, Answer.unlocked())
            account.until { it.age == AgeCheck.Answer.Passed }
            assertEquals(3, rig.server.sent.count { it.route == ageCheckRoute })
            rig.stop()
        }

    @Test
    fun aCheckBaliAnsweredIsAskedNoMoreAtTheWakesAfterNoYesHoldingEverythingTheUnlockToo(): Unit =
        runBlocking {
            // AppTests' ageAgainInClass, Bali back with no yes (Q8): the question once it may show, never asked again meanwhile.
            val rig = signedRig(gated = true)
            val checks = AtomicInteger()
            rig.engine.atEachWake { checks.incrementAndGet() }
            val account = account(rig)
            rig.signStudentIn(accessToken("a1"))
            val first = rig.server.next(ageCheckRoute)
            rig.until { it.meFailed == SendResult.NetworkError }
            first.reply(null)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.engine.retryNow()
            rig.server.next(ageCheckRoute).reply(200, notPassed)
            // The screen on, so each wake runs rule 3's check, its mark: two wakes, the first over before the second begins.
            rig.engine.setScreenOn(true)
            eventually { checks.get() > 0 }
            val woken = checks.get()
            for (wake in 1..2) {
                rig.engine.retryNow()
                eventually { checks.get() >= woken + wake }
            }
            assertEquals(2, rig.server.sent.count { it.route == ageCheckRoute })
            assertEquals(AgeCheck.Answer.Unanswered, account.state.value.age)
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            rig.stop()
        }

    @Test
    fun eachSignInsCheckIsReadUnderItsOwnAccountAYesFromBeforeAnotherLandedLetsNobodyThroughTheOtherAskedItself(): Unit =
        runBlocking {
            // AN9h: the app names the account it asks for, as iOS's `Phone.askAge` reads it first.
            val rig = signedRig(gated = true)
            val account = account(rig)
            rig.signStudentIn(accessToken("a1"))
            val first = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("a1")}", first.token)
            rig.signStudentIn(accessToken("b1"), refresh = "refresh-b")
            val second = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("b1")}", second.token)
            first.reply(200, ageCheckPassed)
            second.reply(200, notPassed)
            account.until { it.signedIn == true && it.age == AgeCheck.Answer.Unanswered }
            assertFalse(rig.signIn.checked())
            assertTrue(rig.server.sent.none { it.route == meRoute })
            rig.stop()
        }

    @Test
    fun eachSignInThatLandsCountsTheSameAccountsAgainTooARenewalNeverAndTheFreshTokensAreAskedTheCheckAgain(): Unit =
        runBlocking {
            // Q2: iOS's stream yields at every sign-in. A renewal keeps the account and the count.
            val rig = signedRig(gated = true)
            val landings = rig.signIn.landings()
            assertEquals(Landing(false, null, 0), landings.first())
            val account = account(rig)
            rig.through(account, accessToken("a1"))
            assertEquals(Landing(true, "a1", 1), landings.first())
            // A read refused with a 401, its token renewed: no landing.
            val forgets = rig.engine.updates.value.forgets
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(401)
            rig.server.next(tokenRoute).reply(200, grant(accessToken("a1")))
            rig.server.next(meRoute).reply(200, Answer.me(null))
            assertEquals(Landing(true, "a1", 1), landings.first())
            // The same account again, over itself: a landing, its fresh tokens not through the check, `me` kept meanwhile.
            rig.signStudentIn(accessToken("a1"), refresh = "refresh-a2")
            assertEquals(Landing(true, "a1", 2), landings.first())
            val asked = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("a1")}", asked.token)
            assertNotNull(account.until { it.age == AgeCheck.Answer.Checking }.sync?.me)
            assertEquals(forgets, rig.engine.updates.value.forgets)
            asked.reply(200, ageCheckPassed)
            account.until { it.age == AgeCheck.Answer.Passed }
            // Another account's over it, then a sign-out.
            rig.signStudentIn(accessToken("b1"), refresh = "refresh-b")
            assertEquals(Landing(true, "b1", 3), landings.first())
            rig.signIn.signOut()
            assertEquals(Landing(false, null, 3), landings.first())
            account.until { it.signedIn == false }
            rig.stop()
        }

    @Test
    fun anotherStudentsSignInForgetsTheLastOnesMeAtOnceKeyedOnTheAccountTheSignOutBetweenUnseenAStateSentBeforeShowsNoneOfIt(): Unit =
        runBlocking {
            // AppTests' forgetsAnother and nothingOfTheLast, their engine halves (C6b-1's and #160's reviews; F11a-1).
            val rig = signedRig(gated = true)
            val account = account(rig)
            rig.through(account, accessToken("a1"), me = Answer.me(null, classes = listOf(Answer.inClass("p3"))))
            val anas = rig.engine.updates.value
            assertNotNull(anas.me)
            // b1 over a1, no sign-out between: none of a1's shown from the sign-in on, the engine's forgotten too.
            rig.signStudentIn(accessToken("b1"), refresh = "refresh-b")
            account.until { it.sync?.me == null }
            rig.until { it.me == null && it.forgets == anas.forgets + 1 }
            // A state the engine sent before it forgot a1's, landing late: none of a1's.
            account.synced(anas)
            assertNull(account.state.value.sync?.me)
            assertEquals(anas.standing, account.state.value.sync?.standing)
            // b1's own, once read, show.
            rig.server.next(ageCheckRoute).reply(200, ageCheckPassed)
            rig.readsAnswered { account.state.value.sync?.me?.classes?.isEmpty() == true }
            rig.stop()
        }

    @Test
    fun anEmergencyUnlockQueuedAsAnotherStudentSignsInStaysQueuedThroughTheForgetAndGoesOnceTheyreThrough(): Unit =
        runBlocking {
            // A12, and the outbox file's rule: nothing at a sign-in closes, wipes or empties it; an unlock is never discarded.
            val rig = signedRig(gated = true)
            val account = account(rig)
            rig.through(account, accessToken("a1"), me = Answer.me())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            rig.server.next(unlockRoute).reply(null)
            rig.until { it.retryAt == at(2) }
            rig.signStudentIn(accessToken("b1"), refresh = "refresh-b")
            val asked = rig.server.next(ageCheckRoute)
            rig.until { it.me == null }
            assertEquals(listOf(unlock.eventId), rig.engine.updates.value.queued.map { it.eventId })
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            asked.reply(200, ageCheckPassed)
            // Under b1's token, as every queued record goes under whoever is signed in (AN9h's entry): two accounts on one
            // phone are ruled out for the pilot, so this changes with that rule at the owner's re-check before K-12.
            val sent = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer ${accessToken("b1")}"), listOf(sent.eventId, sent.token))
            sent.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
            assertEquals(emptyList(), rig.outbox.records())
            rig.stop()
        }

    @Test
    fun deleteAccountShowsItsScreenUntilTheAnswerDeleteUserUnansweredLeavesItPendingARelaunchLandsThereAtOnceAndTryAgainFinishesIt(): Unit =
        runBlocking {
            // AppTests' deleteAccountWiring, its engine half (C4b), with the notes under the student (AN10b): listed in a class
            // and having seen the consent list here.
            val (outbox, file) = makeOutbox()
            val rig = signedRig(outbox, gated = true)
            val notes = MemoryNotes().apply { listSeenBy = "u" }
            val account = account(rig, notes)
            rig.through(account, scoped("a1"), me = Answer.me(null, classes = listOf(Answer.inClass("p3"))))
            val listed = account.state.value.sync
            assertEquals(listOf("u", "u"), listOf(notes.inClass, notes.listSeenBy))
            account.deleting { it.ask() }
            assertEquals(Deleting.Asking, account.state.value.deleting)
            assertFalse(account.state.value.deleting.shows)
            val pressed = scope.async { account.deleteAccount() }
            val delete = rig.pastReads(deleteMeRoute)
            assertEquals(Deleting.Busy, account.state.value.deleting)
            assertTrue(account.state.value.deleting.shows)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(null)
            withTimeout(patience) { pressed.await() }
            assertEquals(Deleting.Pending, account.state.value.deleting)
            assertTrue(rig.signIn.deletionPending())
            assertFalse(rig.keychain.isEmpty)
            // The deleted account's notes go from the store, and its `me`, as iOS's `forgetNotes` forgets them: shown at once, the
            // engine's after (the owner's rulings, 2026-10-23).
            assertNull(account.state.value.sync?.me)
            assertEquals(listOf(null, null), listOf(notes.inClass, notes.listSeenBy))
            assertEquals(listOf(null, null), account.state.value.let { listOf(it.inClass, it.listSeenBy) })
            rig.until { it.me == null }
            // A state the engine sent before it forgot her, still listing her in Period 3, landing late: she isn't kept in a
            // class again.
            account.synced(checkNotNull(listed))
            assertEquals(listOf(null, null), listOf(notes.inClass, account.state.value.inClass))

            // A relaunch over the same keychain, the notes still there, as an app closed between the server's deletion and its
            // own answer leaves them: the deletion's screen at once, before any press, the notes gone at once, never left for a
            // Try again (the owner's ruling, 2026-10-23), the list's note alone too. Try again finishes it.
            val listOnly = MemoryNotes().apply { listSeenBy = "u" }
            val first = relaunched(rig, file)
            assertEquals(Deleting.Pending, account(first, listOnly).state.value.deleting)
            assertNull(listOnly.listSeenBy)
            notes.inClass = "u"
            notes.listSeenBy = "u"
            val relaunch = relaunched(first, file)
            val again = account(relaunch, notes)
            assertEquals(Deleting.Pending, again.state.value.deleting)
            assertEquals(listOf(null, null), listOf(notes.inClass, notes.listSeenBy))
            assertEquals(listOf(null, null), again.state.value.let { listOf(it.inClass, it.listSeenBy) })
            val retried = scope.async { again.deleteAccount() }
            relaunch.server.next(deleteUserRoute).reply(200, "{}")
            withTimeout(patience) { retried.await() }
            again.until { it.signedIn == false && it.deleting == Deleting.Done }
            assertTrue(rig.keychain.isEmpty)
            again.deleting { it.close() }
            assertEquals(Deleting.None, again.state.value.deleting)
            relaunch.stop()
            first.stop()
            rig.stop()
        }

    @Test
    fun aStopAnsweredOnceAnotherAccountsSignInLandedAfterTheDeletionsLastReadOfItIsSignInChangedWithNoTryAgainForIt(): Unit =
        runBlocking {
            // AN9h's window (DECISIONS 2026-11-10, "For AN9e"): b1 lands after the deletion's last read of the sign-in and
            // before the account takes its answer, followed by then or not yet.
            for (followed in listOf(true, false)) {
                val rig = signedRig(gated = true)
                onAHeldThread(rig) { account, pool, following ->
                    rig.through(account, scoped("a1"))
                    val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
                    rig.server.next(unlockRoute).reply(null)
                    rig.until { it.retryAt == at(2) }
                    val stopped =
                        rig.pressedAcrossASignIn(account, pool, following, followed, unlockRoute, AccountDeletion.UnlockUnsent) { sent ->
                            assertEquals(unlock.eventId, sent.eventId)
                            sent.reply(null)
                        }
                    assertEquals(Deleting.Stopped(Deleting.Stop.SignInChanged), stopped, "$followed")
                    // No Try again: a press starts nothing for b1.
                    account.deleteAccount()
                    assertEquals(stopped, account.state.value.deleting, "$followed")
                    assertTrue(rig.server.sent.none { it.route == deleteMeRoute || it.route == deleteUserRoute }, "$followed")
                    assertTrue(rig.server.sent.none { it.route == unlockRoute && it.token == "Bearer ${scoped("b1")}" }, "$followed")
                    assertFalse(rig.signIn.deletionPending(), "$followed")
                    assertEquals("b1", rig.signIn.account(), "$followed")
                    assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId }, "$followed")
                    rig.stop()
                }
            }
        }

    @Test
    fun deletedOnTheServerItsSignInNotYetOnceAnotherAccountsSignInLandedIsDoneTheSameAccountsOwnSignInKeepsPendingAndItsTryAgain(): Unit =
        runBlocking {
            // AN9h's window, a deletion done on the server, DeleteUser unanswered: b1's sign-in has the last one's tokens gone
            // from the phone, so Pending's Try again would delete b1; a1's own sign-in again leaves Try again a1's.
            for (another in listOf(true, false)) {
                val rig = signedRig(gated = true)
                onAHeldThread(rig) { account, pool, following ->
                    rig.through(account, scoped("a1"))
                    val after =
                        rig.pressedAcrossASignIn(
                            account, pool, following, followed = true, deleteMeRoute, AccountDeletion.SignInNotDeleted(SendResult.NetworkError),
                            another,
                        ) { delete ->
                            delete.reply(200, deletedAnswer)
                            rig.server.next(deleteUserRoute).reply(null)
                        }
                    assertEquals(if (another) Deleting.Done else Deleting.Pending, after, "$another")
                    assertEquals(1, rig.server.sent.count { it.route == deleteMeRoute }, "$another")
                    rig.stop()
                }
            }
        }

    @Test
    fun anAnswerWhileTheQuestionIsntDueChangesNothingSoNoCallDeletesAnAccountBeingAskedOrThrough(): Unit =
        runBlocking {
            // This step's guard (DECISIONS 2026-11-11), which iOS leaves to its router: while Bali is asked, and once through.
            val rig = signedRig(gated = true)
            val account = account(rig)
            rig.signStudentIn(scoped("a1"))
            val read = rig.server.next(ageCheckRoute)
            account.until { it.age == AgeCheck.Answer.Checking }
            val (month, year) = rig.thisMonth()
            withTimeout(patience) { account.answerAge(month, year) }
            assertEquals(AgeCheck.Answer.Checking, account.state.value.age)
            read.reply(200, ageCheckPassed)
            rig.readsAnswered { account.state.value.let { it.age == AgeCheck.Answer.Passed && it.sync?.me != null } }
            withTimeout(patience) { account.answerAge(month, year) }
            val through = account.state.value
            assertEquals(AgeCheck.Answer.Passed, through.age)
            assertEquals(Deleting.None, through.deleting)
            assertTrue(rig.server.sent.none { it.route == deleteMeRoute || it.route == deleteUserRoute })
            assertTrue(rig.signIn.checked())
            rig.stop()
        }

    @Test
    fun meSaysWhoseSignInThisIsTheEmailItsTokensNameReadAtEachSignInNoneSignedOutAnotherStudentsTheirsOrNoneNeverTheLastOnes(): Unit =
        runBlocking {
            // AppTests' signedInAs, its engine half (#147): the email the tokens name, read with who is signed in at each sign-in
            // that lands. Its words are AN10g's.
            val rig = signedRig(gated = true)
            val account = account(rig)
            assertNull(account.state.value.email)
            rig.signInNaming(accessToken("a1"), "ana@bali.test")
            account.until { it.signedIn == true && it.email == "ana@bali.test" }
            rig.signIn.signOut()
            assertNull(account.until { it.signedIn == false }.email)
            rig.signInNaming(accessToken("a1"), "ana@bali.test")
            account.until { it.email == "ana@bali.test" }
            rig.signInNaming(accessToken("b1"), "bea@bali.test", refresh = "refresh-b")
            account.until { it.email == "bea@bali.test" }
            // Tokens naming no email say none, never the last student's.
            rig.signInNaming(accessToken("c1"), null, refresh = "refresh-c")
            assertNull(account.until { it.email != "bea@bali.test" }.email)
            assertEquals("c1", rig.signIn.account())
            rig.stop()
        }

    @Test
    fun aChangeOfWhoIsSignedInStartsMeNameAndLeaveAfreshSoTheLastStudentsSaveOrLeaveAnsweredAfterItIsDropped(): Unit =
        runBlocking {
            // AN9f's note, BaliApp.swift's `signed`: `Naming()` and `Leaving()` started afresh at a change of who is signed in, so
            // an answer to the last student's save or leave, sent through the engine as Your name and Me send them, is dropped.
            val rig = signedRig(gated = true)
            val account = account(rig)
            val classes = listOf(Answer.inClass("c", enrollment = "e3"))
            rig.through(account, accessToken("a1"), me = Answer.me(null, classes = classes, name = "Ana"))
            account.naming { it.edit("Ana") to Unit }
            account.naming { it.type("Ana B") to Unit }
            val request = assertNotNull(account.naming { it.save(rig.clock.now()) })
            account.leaving { it.ask(checkNotNull(account.state.value.sync?.me).classes.single()) to Unit }
            val leave = assertNotNull(account.leaving { it.send(rig.clock.now()) })
            assertEquals(listOf(true, true), account.state.value.let { listOf(it.naming.busy, it.leaving.busy) })
            val renaming = scope.async { rig.engine.rename(request) }
            val renamed = rig.server.next("PATCH /v1/me")
            val leaving = scope.async { rig.engine.leave(leave.enrollmentId, leave.request) }
            val left = rig.server.next("DELETE /v1/enrollments/e3")
            // b1's sign-in lands before either answer: both start afresh.
            rig.signStudentIn(accessToken("b1"), refresh = "refresh-b")
            account.until { it.naming == Naming() && it.leaving == Leaving() }
            renamed.reply(200, """{"outcome":"applied","user":{"id":"u","role":"student","displayName":"Ana B"}}""")
            left.reply(200, """{"outcome":"ended","reason":"left_class","endedParticipation":false}""")
            val (saved, out) = renaming.await() to leaving.await()
            assertTrue(saved.answer != null && out.answer != null)
            assertFalse(account.naming { it.saved(saved, request) })
            assertFalse(account.leaving { it.left(out, leave.enrollmentId) })
            assertEquals(listOf(Naming(), Leaving()), account.state.value.let { listOf(it.naming, it.leaving) })
            rig.stop()
        }
}

/** The student signs in, Cognito answering with [access] and [refresh], its ID token naming [email], or none. */
private suspend fun SignedRig.signInNaming(access: String, email: String?, refresh: String = "refresh-1") =
    coroutineScope {
        val signingIn = async { signIn.signIn(HostedPage.SignIn, null, hostedUi) }
        val claims = email?.let { """{"sub":"x","email":"$it"}""" } ?: """{"sub":"x"}"""
        val idToken = "h.${Base64.getUrlEncoder().withoutPadding().encodeToString(claims.encodeToByteArray())}.s"
        val grant = """{"access_token":"$access","refresh_token":"$refresh","id_token":"$idToken","expires_in":3600,"token_type":"Bearer"}"""
        server.next(tokenRoute).reply(200, grant)
        signingIn.await()
    }

/** [test] over an account of [rig]'s whose own calls run on [ExecutorService]'s one thread, which the test can hold, and its follow's job. */
private suspend fun EngineFiles.onAHeldThread(rig: SignedRig, test: suspend (Account, ExecutorService, Job) -> Unit) {
    val pool = Executors.newSingleThreadExecutor()
    val held = CoroutineScope(SupervisorJob(scope.coroutineContext.job) + pool.asCoroutineDispatcher())
    try {
        val account = checkNotNull(Account.of(rig.engine, held, rig.clock))
        val following = scope.launch { account.run() }
        account.until { it.signedIn != null }
        test(account, pool, following)
    } finally {
        withTimeout(patience) { held.coroutineContext.job.cancelAndJoin() }
        pool.shutdown()
    }
}

/**
 * Delete account pressed on [account], whose calls run on [pool], the deletion's [first] request answered by [answering]
 * and the engine's own answer [expected], its last read of the sign-in a1's; then a sign-in lands, b1's, [another], or
 * a1's own again, before the account takes the answer, its thread held between the two so the sign-in lands there for
 * certain (AN9h's window), and [followed] by then or, its follow ended, not: what Delete account shows once it has.
 */
private suspend fun SignedRig.pressedAcrossASignIn(
    account: Account, pool: ExecutorService, following: Job, followed: Boolean, first: String, expected: AccountDeletion,
    another: Boolean = true, answering: suspend (Server.Exchange) -> Unit,
): Deleting {
    account.deleting { it.ask() }
    val pressed = scope.async { account.deleteAccount() }
    val sent = pastReads(first)
    val deletion = deleting() // the press's own, shared while it runs
    val letGo = CountDownLatch(1)
    pool.execute { letGo.await(patience.inWholeMilliseconds, TimeUnit.MILLISECONDS) }
    try {
        answering(sent)
        assertEquals(expected, deletion.answer())
        if (!followed) withTimeout(patience) { following.cancelAndJoin() }
        signStudentIn(scoped(if (another) "b1" else "a1"), refresh = "refresh-2")
        if (followed) account.until { it.age == AgeCheck.Answer.Checking } // the deletion's screen held meanwhile
    } finally {
        letGo.countDown()
    }
    withTimeout(patience) { pressed.await() }
    return account.state.value.deleting
}
