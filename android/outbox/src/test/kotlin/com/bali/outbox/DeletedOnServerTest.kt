package com.bali.outbox

import com.bali.core.AnswerResult
import com.bali.core.ApiClient
import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.EndEnrollmentRequest
import com.bali.core.EnrollmentJoinRequest
import com.bali.core.EventId
import com.bali.core.LiveLesson
import com.bali.core.NoAnswer
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.UpdateMeRequest
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

// AN9j, `409 account_deleted` read as signed out (the owner, 2026-11-12; DECISIONS 2026-11-13): over the engine as the app makes
// it, its sign-in gated as the app's is, the account, an enforcer over its fake lock and the router running as the app runs them,
// and the API and Cognito answered by hand. Each place the answer can arrive; the lock off as it's read; another account's 409 and
// every other 409 changing nothing; an Emergency Unlock kept apart; this phone's own deletion finished its own way; and two loops
// hearing it at once. No iOS twin yet: C4d, the Mac's.

/** Bali's server's answer to a call under a deleted account's old token (C3d). */
val deletedOnServer = Answer.refused("account_deleted")

private val historyRoute = "GET /v1/me/history"
private val joinRoute = "POST /v1/enrollments"
private val renameRoute = "PATCH /v1/me"
private val leaveRoute = "DELETE /v1/enrollments/e3"

/** The Emergency Unlocks [outbox] keeps apart from its queue, each by its event id, as their rows held them. */
suspend fun keptApart(outbox: Outbox): Map<String, JsonObject> =
    outbox.texts("SELECT value FROM outboxState WHERE key LIKE 'kept:%'")
        .map { BaliJson.parseToJsonElement(checkNotNull(it)).jsonObject }
        .associateBy { checkNotNull(it["eventId"]?.jsonPrimitive?.contentOrNull) }

/** [kept]'s field [name], as text; none for none. */
fun JsonObject.text(name: String): String? = get(name)?.jsonPrimitive?.contentOrNull

/** The access token Cognito's DeleteUser was sent, in its body. */
private fun Server.Exchange.deleteUserToken(): String? =
    request.body?.let { BaliJson.parseToJsonElement(it.decodeToString()).jsonObject["AccessToken"]?.jsonPrimitive?.contentOrNull }

/** The live lesson of session s, as the app's lesson half makes it: its own client over the engine's sign-in, the rig's server. */
private fun lessonOver(rig: SignedRig) =
    LiveLesson("s", ApiClient(URI("https://api.bali.test"), rig.signIn, rig.server), rig.clock::now) { awaitCancellation() }

/** The next request to [route], each read of the truth sent before it answered with [me], each check-in with session s live. */
private suspend fun past(rig: SignedRig, route: String, me: String = Answer.me()): Server.Exchange {
    while (true) {
        val next = rig.server.next()
        when (next.route) {
            route -> return next
            meRoute -> next.reply(200, me)
            checkInRoute -> next.reply(200, Answer.live())
            else -> fail("${next.route} on the way to $route")
        }
    }
}

/** a1 signed in and through the 13+ check, standing focused in session s till its bell, the lock on and the router on Focus. */
private suspend fun EngineFiles.inLesson(): Pair<SignedRig, Routed> {
    val rig = signedRig(gated = true)
    val routed = routed(rig.engine, rig.clock)
    rig.through(checkNotNull(routed.account), scoped("a1"), me = Answer.me())
    routed.until { it.screen == Screen.Focus }
    eventually { routed.lock.holds }
    return rig to routed
}

/**
 * Read as signed out, [what] naming the arrival: the router on Sign in, so no screen of the student's says the generic words; the
 * sign-in forgotten as Sign out forgets it; out of the session, the lock off.
 */
private suspend fun signedOut(rig: SignedRig, routed: Routed, what: String) {
    withTimeoutOrNull(patience) { routed.router.shown.first { it == Screen.Shown(Screen.SignIn, false) } }
        ?: fail("$what: the router stayed on ${routed.router.shown.value}")
    assertTrue(rig.keychain.isEmpty, what)
    assertNull(rig.signIn.account(), what)
    assertEquals(Standing.Out, rig.engine.updates.value.standing, what)
    assertFalse(routed.lock.holds, what)
}

/** Each call a `409 account_deleted` can answer, made from where [inLesson] leaves the phone: its request, on its way. */
private val arrivals: List<Pair<String, suspend (SignedRig, CoroutineScope) -> Server.Exchange>> =
    listOf(
        "the drain's tap" to { rig, _ ->
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute)
        },
        "the drain's refocus" to { rig, _ ->
            rig.engine.record(Change.Refocus("s"))
            rig.server.next(refocusRoute)
        },
        "the drain's protection off" to { rig, _ ->
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute)
        },
        "the drain's lock back on" to { rig, _ ->
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.ProtectionOff) && it.queued.isEmpty() }
            assertNotNull(rig.engine.record(Change.ProtectionOn("s")))
            rig.server.next(protectionOnRoute)
        },
        "the check-in" to { rig, _ ->
            rig.engine.setScreenOn(true)
            rig.server.next(checkInRoute)
        },
        "the read of the truth" to { rig, _ ->
            rig.engine.retryNow()
            rig.server.next(meRoute)
        },
        "History" to { rig, scope ->
            scope.launch { rig.engine.history(null) }
            rig.server.next(historyRoute)
        },
        "Join" to { rig, scope ->
            scope.launch { rig.engine.join(EnrollmentJoinRequest("KWX49Q", EventId.mint(rig.clock.now()), rig.clock.now())) }
            rig.server.next(joinRoute)
        },
        "Leave" to { rig, scope ->
            scope.launch { rig.engine.leave("e3", EndEnrollmentRequest(EventId.mint(rig.clock.now()))) }
            rig.server.next(leaveRoute)
        },
        "Your name" to { rig, scope ->
            scope.launch { rig.engine.rename(UpdateMeRequest("Ana", EventId.mint(rig.clock.now()))) }
            rig.server.next(renameRoute)
        },
        "the lesson's answer" to { rig, scope ->
            val lesson = lessonOver(rig)
            scope.launch { lesson.answer("q", 1) }
            rig.server.next(answerRoute)
        },
        "the lesson's poll" to { rig, scope ->
            val lesson = lessonOver(rig)
            scope.launch { lesson.run() }
            rig.server.next(pollRoute)
        },
    )

class DeletedOnServerTest : EngineFiles() {
    @Test
    fun eachPlaceA409AccountDeletedCanArriveReadsAsSignedOutTheTokensForgottenTheRouterOnSignInTheLockOffNeverTheGenericWords(): Unit =
        runBlocking {
            // Today's server answers History and Leave otherwise (an empty page, `403 unknown_user`) and the lesson's poll `403`:
            // the rule is the answer's wherever it comes, so AN11's push token reads it too.
            for ((what, arrives) in arrivals) {
                val (rig, routed) = inLesson()
                arrives(rig, scope).reply(409, deletedOnServer)
                signedOut(rig, routed, what)
                rig.stop()
            }
        }

    @Test
    fun the13PlusChecksYesAndTheSignInsOwnFirstReadOfTheTruthEachReadAsSignedOutToo(): Unit =
        runBlocking {
            // The yes Sign up kept with its sign-in, sent at the read loop's wake (AgeFallbackTest's C7 case).
            val rig = signedRig(gated = true)
            val routed = routed(rig.engine, rig.clock)
            rig.signStudentIn(scoped("a1"), yes = "y1")
            past(rig, recordAgeCheckRoute, me = Answer.me(null)).reply(409, deletedOnServer)
            signedOut(rig, routed, "the 13+ check's yes")
            assertNull(rig.signIn.yes())
            rig.stop()

            // The sign-in's own first read, once Bali's yes let it through: the starting screen held for it, then Sign in.
            val first = signedRig(gated = true)
            val firstRouted = routed(first.engine, first.clock)
            first.signStudentIn(scoped("a1"))
            first.server.next(ageCheckRoute).reply(200, ageCheckPassed)
            first.server.next(meRoute).reply(409, deletedOnServer)
            signedOut(first, firstRouted, "the sign-in's own read")
            first.stop()
        }

    @Test
    fun aPhoneLockedInALessonComesOffItsLockAsThe409IsReadNotAtTheBellOutOfTheSessionKeptSoForARelaunch(): Unit =
        runBlocking {
            val (rig, routed) = inLesson()
            assertEquals(session().endsAt, routed.enforcer.updates.value.until)
            rig.engine.setScreenOn(true)
            rig.server.next(checkInRoute).reply(409, deletedOnServer)
            eventually { !routed.lock.holds }
            assertTrue(rig.clock.now() < session().endsAt)
            assertEquals(Standing.Out, rig.outbox.standing())
            routed.until { it == Screen.Shown(Screen.SignIn, false) }
            rig.stop()
        }

    @Test
    fun a409ForAnAccountNoLongerSignedInChangesNothingForTheOneThatIsItsSignInItsQueueItsLockAndItsScreen(): Unit =
        runBlocking {
            // Two accounts on one phone are ruled impossible for the pilot; the rule SignIn.accountDeleted keeps holds all the same.
            val (rig, routed) = inLesson()
            val history = async { rig.engine.history(null) }
            val held = rig.server.next(historyRoute)
            assertEquals("Bearer ${scoped("a1")}", held.token)
            rig.signIn.signOut()
            rig.through(checkNotNull(routed.account), scoped("b1"), me = Answer.me())
            routed.until { it.screen == Screen.Focus }
            rig.engine.record(Change.Tap("tag"))
            assertEquals("Bearer ${scoped("b1")}", past(rig, tapRoute).token)
            eventually { routed.lock.holds }
            held.reply(409, deletedOnServer)
            assertEquals(SendResult.Status(409), history.await().result)
            assertEquals("b1", rig.signIn.account())
            assertFalse(rig.keychain.isEmpty)
            assertEquals(1, rig.outbox.records().size)
            assertTrue(routed.lock.holds)
            assertEquals(Screen.Focus, routed.router.shown.value.screen)
            rig.stop()
        }

    @Test
    fun everyOther409MeansWhatItMeantBeforeNoneSignsAnyoneOutTheQueueAsItsTableSaysTheLessonsLockKept(): Unit =
        runBlocking {
            val (rig, routed) = inLesson()
            // A tap's other refusal (tap step 10): kept, stuck and said, its re-read answered.
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(409, Answer.refused("event_id_conflict"))
            rig.until { it.queued.singleOrNull()?.refusedStatus == 409 }
            // Your name taken, Leave in session, History refused naming no reason, the lesson's answer too late.
            val name = async { rig.engine.rename(UpdateMeRequest("Ana", EventId.mint(rig.clock.now()))) }
            past(rig, renameRoute).reply(409, Answer.refused("display_name_taken"))
            assertEquals(ApiErrorReason.DisplayNameTaken, name.await().error?.error?.reason)
            val leave = async { rig.engine.leave("e3", EndEnrollmentRequest(EventId.mint(rig.clock.now()))) }
            past(rig, leaveRoute).reply(409, Answer.refused("class_in_session"))
            assertEquals(ApiErrorReason.ClassInSession, leave.await().error?.error?.reason)
            val history = async { rig.engine.history(null) }
            past(rig, historyRoute).reply(409, """{"error":{"code":"conflict","message":"no"}}""")
            assertEquals(SendResult.Status(409), history.await().result)
            val lesson = lessonOver(rig)
            val answer = async { lesson.answer("q", 1) }
            past(rig, answerRoute).reply(409, Answer.refused("question_closed"))
            assertEquals(AnswerResult.QuestionClosed, answer.await())
            assertEquals("a1", rig.signIn.account())
            assertFalse(rig.keychain.isEmpty)
            assertEquals(1, rig.outbox.records().size)
            assertTrue(routed.lock.holds)
            assertEquals(Screen.Focus, routed.router.shown.value.screen)
            rig.stop()

            // Delete account's own: a teacher's account with a class, its answer as before.
            val teacher = signedRig()
            teacher.signedIn()
            val deletion = teacher.deleting()
            teacher.server.next(deleteMeRoute).reply(409, Answer.refused("teacher_has_classes"))
            assertEquals(AccountDeletion.TeacherHasClasses, deletion.answer())
            assertEquals("a1", teacher.signIn.account())
            assertFalse(teacher.keychain.isEmpty)
            teacher.stop()
        }

    @Test
    fun anEmergencyUnlockQueuedAsTheAccountIsReadDeletedIsKeptApartWholeNeverSentUnderTheNextAccountNorHoldingItsQueueOrLock(): Unit =
        runBlocking {
            val (rig, routed) = inLesson()
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            rig.server.next(unlockRoute).reply(null)
            rig.until { it.retryAt == at(2) }
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(409, deletedOnServer)
            signedOut(rig, routed, "the read of the truth, an unlock queued")
            // Out of the queue, kept whole: its id, its session, its time and its place in what the phone did.
            assertEquals(emptyList(), rig.outbox.records())
            val kept = assertNotNull(keptApart(rig.outbox)[unlock.eventId])
            assertEquals(listOf("s", null, null), listOf(kept.text("sessionId"), kept.text("tapId"), kept.text("reason")))
            assertEquals(Times().text(unlock.recordedAt), kept.text("recordedAt"))
            assertEquals(unlock.order?.seq, kept["seq"]?.jsonPrimitive?.longOrNull)

            // b1 signs in on this phone, in session s too: the unlock never goes under b1, nor holds b1's read or tap back, nor
            // keeps b1's lock off (the unlock guard's `holdsUnlock`).
            rig.through(checkNotNull(routed.account), scoped("b1"), me = Answer.me())
            routed.until { it.screen == Screen.Focus }
            eventually { routed.lock.holds }
            rig.engine.record(Change.Tap("tag"))
            assertEquals("Bearer ${scoped("b1")}", past(rig, tapRoute).token)
            assertTrue(rig.server.sent.none { it.route == unlockRoute && it.token == "Bearer ${scoped("b1")}" })
            assertEquals(setOf(unlock.eventId), keptApart(rig.outbox).keys)
            rig.stop()
        }

    @Test
    fun aDeletionUnderWayFinishesItsOwnWayA409HeardMidwayOnTheLessonsOwnCallDeleteUserRunUnderTheSignInsToken(): Unit =
        runBlocking {
            // The lesson's calls still go while the deletion holds the loops (AN13g).
            val (rig, _) = inLesson()
            val deletion = rig.deleting()
            val delete = past(rig, deleteMeRoute)
            val lesson = lessonOver(rig)
            val answer = async { lesson.answer("q", 1) }
            rig.server.next(answerRoute).reply(409, deletedOnServer)
            assertEquals(AnswerResult.AccountDeleted, answer.await())
            assertFalse(rig.keychain.isEmpty)
            assertEquals("a1", rig.signIn.account())
            delete.reply(200, deletedAnswer)
            val cognito = rig.server.next(deleteUserRoute)
            assertEquals(scoped("a1"), cognito.deleteUserToken())
            cognito.reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            rig.stop()
        }

    @Test
    fun aDeletionWhoseAnswerWasLostIsFinishedByA409TheSignInKeptForDeleteUserTheLockOffAtOncePendingItsTryAgainRunsDeleteUser(): Unit =
        runBlocking {
            val (rig, routed) = inLesson()
            val account = checkNotNull(routed.account)
            account.deleting { it.ask() }
            val stopping = async { account.deleteAccount() }
            past(rig, deleteMeRoute).reply(null)
            withTimeout(patience) { stopping.await() }
            assertEquals(Deleting.Stopped(Deleting.Stop.NotDeleted(SendResult.NetworkError, NoAnswer.Unreachable)), account.state.value.deleting)
            // Back: the lesson's screen again, its lock on.
            account.deleting { it.close() }
            routed.until { it.screen == Screen.Focus }
            assertTrue(routed.lock.holds)
            rig.engine.setScreenOn(true)
            past(rig, checkInRoute).reply(409, deletedOnServer)
            // That deletion landing: out of the lesson, the lock off at once, the sign-in kept for DeleteUser and giving the API
            // nothing, and the deletion's own screen, Pending.
            eventually { rig.engine.updates.value.standing == Standing.Out }
            assertTrue(rig.signIn.deletionPending())
            assertFalse(rig.keychain.isEmpty)
            eventually { !routed.lock.holds }
            routed.until { it.screen == Screen.Deleting }
            assertEquals(Deleting.Pending, account.state.value.deleting)
            val finishing = async { account.deleteAccount() }
            val cognito = rig.server.next(deleteUserRoute)
            assertEquals(scoped("a1"), cognito.deleteUserToken())
            cognito.reply(200, "{}")
            withTimeout(patience) { finishing.await() }
            account.until { it.deleting == Deleting.Done && it.signedIn == false }
            assertTrue(rig.keychain.isEmpty)
            assertEquals(1, rig.server.sent.count { it.route == deleteMeRoute })
            rig.stop()
        }

    @Test
    fun whileItsDeleteUserWaitsA409ChangesNothingTheSignInKeptForItsTryAgainWhichDeletesItThen(): Unit =
        runBlocking {
            val (rig, routed) = inLesson()
            val account = checkNotNull(routed.account)
            account.deleting { it.ask() }
            val deleting = async { account.deleteAccount() }
            val delete = past(rig, deleteMeRoute)
            // The lesson's answer, on its way before the deletion's answer, answered once DeleteUser waits.
            val lesson = lessonOver(rig)
            val answer = async { lesson.answer("q", 1) }
            val late = rig.server.next(answerRoute)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(null)
            withTimeout(patience) { deleting.await() }
            assertEquals(Deleting.Pending, account.state.value.deleting)
            late.reply(409, deletedOnServer)
            assertEquals(AnswerResult.AccountDeleted, answer.await())
            assertTrue(rig.signIn.deletionPending())
            assertFalse(rig.keychain.isEmpty)
            assertEquals(Deleting.Pending, account.state.value.deleting)
            val again = async { account.deleteAccount() }
            val cognito = rig.server.next(deleteUserRoute)
            assertEquals(scoped("a1"), cognito.deleteUserToken())
            cognito.reply(200, "{}")
            withTimeout(patience) { again.await() }
            account.until { it.deleting == Deleting.Done }
            assertTrue(rig.keychain.isEmpty)
            rig.stop()
        }

    @Test
    fun twoLoopsHearingItAtOnceReadItOnceTheSameWayAndADeletionsLostAnswerHeardTwiceKeepsItsSignInForDeleteUser(): Unit =
        runBlocking {
            // The drain's tap and the screen's check-in, each answered 409 at once.
            val (rig, routed) = inLesson()
            val signIns = checkNotNull(routed.account).state.value.signIns
            rig.engine.record(Change.Tap("tag"))
            val tap = rig.server.next(tapRoute)
            rig.engine.setScreenOn(true)
            val checkIn = past(rig, checkInRoute)
            tap.reply(409, deletedOnServer)
            checkIn.reply(409, deletedOnServer)
            signedOut(rig, routed, "two loops at once")
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(signIns + 1, checkNotNull(routed.account).state.value.signIns)
            rig.stop()

            // This phone's deletion, its answer lost: both read as that deletion landing, its sign-in kept for DeleteUser.
            val (lost, lostRouted) = inLesson()
            val account = checkNotNull(lostRouted.account)
            account.deleting { it.ask() }
            val stopping = async { account.deleteAccount() }
            past(lost, deleteMeRoute).reply(null)
            withTimeout(patience) { stopping.await() }
            account.deleting { it.close() }
            lost.engine.record(Change.Tap("tag"))
            val lostTap = past(lost, tapRoute)
            lost.engine.setScreenOn(true)
            val lostCheckIn = past(lost, checkInRoute)
            lostTap.reply(409, deletedOnServer)
            lostCheckIn.reply(409, deletedOnServer)
            eventually { lost.engine.updates.value.standing == Standing.Out }
            assertTrue(lost.signIn.deletionPending())
            assertFalse(lost.keychain.isEmpty)
            lostRouted.until { it.screen == Screen.Deleting }
            val finishing = async { account.deleteAccount() }
            val cognito = lost.server.next(deleteUserRoute)
            assertEquals(scoped("a1"), cognito.deleteUserToken())
            cognito.reply(200, "{}")
            withTimeout(patience) { finishing.await() }
            account.until { it.deleting == Deleting.Done }
            lost.stop()
        }
}
