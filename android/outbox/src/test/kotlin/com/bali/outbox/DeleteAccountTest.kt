package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SignIn
import com.bali.core.TokenStore
import java.io.IOException
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

// C4: Delete account through the engine (AN9b), over the real sign-in: the API, Cognito's token endpoint and its
// DeleteUser all answered by hand by the rig's one server. BaliOutbox's DeleteAccountTests, and new: a run cancelled
// while its sends are out, the caller cancelled, a sign-in of another account landing meanwhile, Cognito's
// NotAuthorizedException then `invalid_grant`, and a token renewed for the deletion. And AN9h's (the owner, 2026-11-10:
// "Close it now"): another account's sign-in landing before `DELETE /v1/me` is answered deleted, which stops the
// deletion, nothing sent under that sign-in, and a renewal of the same account, which doesn't.

val deleteMeRoute = "DELETE /v1/me"

/** Cognito's DeleteUser, at `https://cognito-idp.us-east-1.amazonaws.com/`. */
val deleteUserRoute = "POST /"
val deletedAnswer = """{"outcome":"deleted"}"""

/** An access token from a sign-in that asked for the scope DeleteUser needs, its pool named, issued [issued] seconds after 1970. */
fun scoped(name: String, issued: Long = 1_000_000_000): String {
    val payload =
        """{"sub":"$name","iat":$issued,"exp":${issued + 3600},"scope":"openid email profile aws.cognito.signin.user.admin",""" +
            """"iss":"https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YTloqilwT"}"""
    return "eyJhbGciOiJSUzI1NiJ9.${Base64.getUrlEncoder().withoutPadding().encodeToString(payload.encodeToByteArray())}.signature"
}

/** Signed in with [access], by default a token that may delete itself, and the read of the truth the sign-in sends answered with [me]. */
suspend fun SignedRig.signedIn(access: String = scoped("a1"), me: String = Answer.me(null)) {
    signStudentIn(access)
    server.next(meRoute).reply(200, me)
}

/** Delete account pressed: the engine's answer, once it comes. */
fun SignedRig.deleting(): Deferred<AccountDeletion> = scope.async { engine.deleteAccount(signIn) }

/** The deletion's answer; none in time fails the test rather than hanging it. */
suspend fun Deferred<AccountDeletion>.answer(): AccountDeletion = withTimeoutOrNull(patience) { await() } ?: fail("the deletion never answered")

/** The routes [SignedRig.server] saw under [access], or renewing [refresh]: another account's sign-in, in these tests. */
fun SignedRig.sentUnder(access: String, refresh: String): List<String> =
    server.sent.filter { it.token == "Bearer $access" || "refresh_token=$refresh" in it.request.body?.decodeToString().orEmpty() }.map { it.route }

/** [call]'s answer once it comes, failing at once should anything be sent before it: the server sees nothing meanwhile. */
suspend fun <T> SignedRig.answerSendingNothing(call: Deferred<T>): T {
    eventually { call.isCompleted || server.waiting.isNotEmpty() }
    assertEquals(emptyList(), server.waiting, "sent once the sign-in changed")
    return call.await()
}

/** Delete account through the engine (C4): BaliOutbox's DeleteAccountTests. */
class DeleteAccountTest : EngineFiles() {
    @Test
    fun aSignInMadeBeforeThePhoneAskedForTheScopeDeleteUserNeedsSignsInAgainFirstNothingSentAnUnlockQueuedNotEvenTheSignInKept(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signedIn(accessToken("a1"))
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(null)
            rig.until { it.retryAt == at(2) }

            assertEquals(AccountDeletion.SignInFirst, rig.engine.deleteAccount(rig.signIn))
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            assertFalse(rig.keychain.isEmpty)
            rig.stop()
        }

    @Test
    fun theOutboxGoesFirstEveryEmergencyUnlockAheadThenDeleteMeUnderTheSignInsTokenThenDeleteUserNothingBetweenDoneTheSignInForgotten(): Unit =
        runBlocking {
            // No GET /v1/me between them, which would make a fresh account; done, nothing more is sent.
            val rig = signedRig()
            rig.signedIn(me = Answer.me())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            rig.engine.record(Change.ProtectionOff("s"))
            // No answer: kept, and holding what the phone does after it.
            rig.server.next(protectionOffRoute).reply(null)
            rig.until { it.retryAt == at(2) }
            val unlock = assertNotNull(rig.engine.emergencyUnlock())

            val deletion = rig.deleting()
            val first = rig.server.next()
            assertEquals(listOf(unlockRoute, unlock.eventId), listOf(first.route, first.eventId))
            first.reply(200, Answer.unlocked())
            val second = rig.server.next()
            assertEquals(protectionOffRoute, second.route)
            second.reply(200, Answer.protectionOff())
            val delete = rig.server.next()
            assertEquals(listOf(deleteMeRoute, "Bearer ${scoped("a1")}"), listOf(delete.route, delete.token))
            delete.reply(200, deletedAnswer)
            val cognito = rig.server.next(deleteUserRoute)
            assertEquals(emptyList(), rig.server.waiting)
            // While DeleteUser is on its way, a read of the truth asked for sends nothing, nor does a tap made then,
            // which goes with the account as DeleteUser answers; the engine is the loops' and the screens' meanwhile.
            withTimeout(patience) { rig.engine.setInFront(true) }
            rig.until { it.link == Link.SignIn }
            withTimeout(patience) { rig.engine.record(Change.Tap("tag")) }
            rig.until { it.queued.size == 1 && it.retryAt == at(60) }
            assertEquals(emptyList(), rig.server.waiting)
            cognito.reply(200, "{}")

            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            assertEquals(emptyList(), rig.outbox.records())
            rig.engine.retryNow()
            rig.until { it.link == Link.SignIn && it.queued.isEmpty() && it.retryAt == null }
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun aDeletionEndsThePhonesSessionWithNoEmergencyUnlockTheLockComesOffTheStandingOutAndKeptNoUnlockRecordedNorSent(): Unit =
        runBlocking {
            // The owner's ruling, over the enforcer and its fake lock.
            val rig = signedRig()
            val lock = FakeLock(rig.clock)
            val enforcer = Enforcer(rig.engine, lock, scope, rig.clock)
            val enforcing = scope.launch(start = CoroutineStart.UNDISPATCHED) { enforcer.run() }
            rig.signedIn(me = Answer.me())
            eventually { lock.holds }

            val deletion = rig.deleting()
            // Nothing queued: the deletion is the first thing sent, and Cognito's the second.
            val delete = rig.server.next()
            assertEquals(deleteMeRoute, delete.route)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.server.waiting)

            eventually { !lock.holds }
            assertEquals(Standing.Out, rig.engine.updates.value.standing)
            assertEquals(Standing.Out, rig.outbox.standing())
            assertEquals(emptyList(), rig.outbox.records())
            withTimeout(patience) { enforcing.cancelAndJoin() }
            rig.stop()
        }

    @Test
    fun anEmergencyUnlockTheServerHasntRecordedHoldsTheDeletionBackNoAnswerOrRefusedKeptNeverLetGoDeleteMeNeverSentRecordedItGoes(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signedIn()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(null)
            rig.until { it.retryAt == at(2) }

            for ((status, body) in listOf(null to "", 400 to Answer.refused("invalid_request"))) {
                val deletion = rig.deleting()
                rig.server.next(unlockRoute).reply(status, body)
                assertEquals(AccountDeletion.UnlockUnsent, deletion.answer(), "$status")
                assertEquals(emptyList(), rig.server.waiting, "$status")
                assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId }, "$status")
            }

            val deletion = rig.deleting()
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            rig.stop()
        }

    @Test
    fun anyEmergencyUnlockStillQueuedHoldsTheDeletionBackOneTriedAndStuckWhichHoldsNothingBehindItAndOneNotFiledWhichGoesNowhere(): Unit =
        runBlocking {
            // AN9a's note for AN9b: `nextBeforeDeletion` passes over an unlock tried and stuck, so the deletion refuses
            // while any unlock is queued, or it would leave one the deleted account could never send.
            val rig = signedRig()
            rig.signedIn()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            rig.until { it.queued.singleOrNull()?.stuck == true }
            val off = assertNotNull(rig.engine.record(Change.ProtectionOff("s")))
            rig.server.next(protectionOffRoute).reply(null)
            rig.until { it.queued.size == 2 && it.sending.isEmpty() }

            val deletion = rig.deleting()
            rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request")) // tried, and stuck again
            // Behind it, the report goes and lands: the stuck unlock holds nothing back but the deletion.
            val report = rig.server.next(protectionOffRoute)
            assertEquals(off.eventId, report.eventId)
            report.reply(200, Answer.protectionOff())
            assertEquals(AccountDeletion.UnlockUnsent, deletion.answer())
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            rig.stop()

            // An unlock not filed yet, which nothing sends before the phone knows where it goes (B6b), the same.
            val unfiled = signedRig()
            unfiled.signedIn()
            val press = assertNotNull(unfiled.engine.record(Change.UnlockUnfiled(null)))
            assertEquals(AccountDeletion.UnlockUnsent, unfiled.deleting().answer())
            assertEquals(emptyList(), unfiled.server.waiting)
            assertEquals(listOf(press.eventId), unfiled.outbox.records().map { it.eventId })
            unfiled.stop()
        }

    @Test
    fun aTapTheServerRefusedHoldsNothingBackItGoesOnceMoreAndIsLetGoWithTheAccountAnythingElseNoAnswerSettlesHoldsTheDeletionBack(): Unit =
        runBlocking {
            // Said by its last answer. A read the deletion held goes once it ends.
            val rig = signedRig()
            rig.signedIn()
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(404, Answer.unknownBlock)
            rig.server.next(meRoute).reply(200, Answer.me(null)) // the refusal's re-read
            rig.until { it.queued.firstOrNull()?.stuck == true }
            rig.engine.record(Change.Refocus("s"))
            rig.server.next(refocusRoute).reply(503)
            rig.until { it.queued.size == 2 && it.retryAt != null }

            var deletion = rig.deleting()
            rig.server.next(tapRoute).reply(404, Answer.unknownBlock)
            rig.server.next(refocusRoute).reply(503)
            assertEquals(AccountDeletion.NotDeleted(SendResult.Status(503)), deletion.answer())
            rig.server.next(meRoute).reply(200, Answer.me(null)) // the tap's re-read, held till now

            deletion = rig.deleting()
            rig.server.next(tapRoute).reply(404, Answer.unknownBlock)
            rig.server.next(refocusRoute).reply(200, Answer.refocused())
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(emptyList(), rig.engine.updates.value.queued)
            assertEquals(emptyList(), rig.server.waiting) // the re-read this one held, never sent
            rig.stop()
        }

    @Test
    fun deleteMeWithNoAnswerGoesAgainUnderTheSameEventIdOnceMoreUnderAFreshOneAt409EventIdConflictATeachersClassesItsOwnAnswer(): Unit =
        runBlocking {
            // Rule 4; a teacher with a class or a block is its own answer, nothing else sent.
            val rig = signedRig()
            rig.signedIn()
            var deletion = rig.deleting()
            val lost = rig.server.next(deleteMeRoute)
            lost.reply(null)
            assertEquals(AccountDeletion.NotDeleted(SendResult.NetworkError), deletion.answer())

            deletion = rig.deleting()
            rig.server.next(deleteMeRoute).reply(409, Answer.refused("teacher_has_classes"))
            assertEquals(AccountDeletion.TeacherHasClasses, deletion.answer())
            assertEquals(emptyList(), rig.server.waiting)

            deletion = rig.deleting()
            val again = rig.server.next(deleteMeRoute)
            assertEquals(lost.eventId, again.eventId)
            again.reply(409, Answer.refused("event_id_conflict"))
            val fresh = rig.server.next(deleteMeRoute)
            assertNotNull(fresh.eventId)
            assertNotEquals(lost.eventId, fresh.eventId)
            fresh.reply(200, """{"outcome":"already_deleted"}""")
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            rig.stop()
        }

    @Test
    fun deleteUserFailingAfterTheApiDeletedTheAccountIsSaidTheSignInKeptNothingToTheApiMeanwhileTheNextPressTriesDeleteUserAlone(): Unit =
        runBlocking {
            // A relaunch's sign-in gives the API nothing either; tried until it is done.
            val rig = signedRig()
            rig.signedIn()
            var deletion = rig.deleting()
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(null)
            assertEquals(AccountDeletion.SignInNotDeleted(SendResult.NetworkError), deletion.answer())
            assertFalse(rig.keychain.isEmpty)
            assertTrue(rig.signIn.deletionPending())

            rig.engine.setInFront(true)
            rig.until { it.link == Link.SignIn }
            assertEquals(emptyList(), rig.server.waiting)
            val relaunched = SignIn(rig.signIn.cognito, rig.keychain, scope, rig.server, rig.clock::now, gated = false)
            assertNull(relaunched.accessToken())

            deletion = rig.deleting()
            rig.server.next(deleteUserRoute).reply(500, """{"__type":"InternalErrorException"}""")
            assertEquals(AccountDeletion.SignInNotDeleted(SendResult.Status(500)), deletion.answer())
            deletion = rig.deleting()
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            assertEquals(emptyList(), rig.server.waiting) // DeleteUser alone: no drain, no deletion again
            rig.stop()
        }

    @Test
    fun aReadOfTheTruthOnItsWayWhenDeleteAccountIsPressedLandsBeforeAnythingOfTheDeletionGoesThenItGoes(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signStudentIn(scoped("a1"))
            val read = rig.server.next(meRoute)
            val deletion = rig.deleting()
            eventually { rig.engine.waitingOut() }
            assertEquals(emptyList(), rig.server.waiting) // nothing of the deletion while the read is out
            read.reply(200, Answer.me(null))
            val delete = rig.server.next()
            assertEquals(deleteMeRoute, delete.route)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            rig.stop()
        }

    @Test
    fun aRecordTheDrainHasOnItsWayLandsBeforeAnythingOfTheDeletionGoesNeverSentTwiceAndTheDrainSendsNothingWhileTheDeletionRuns(): Unit =
        runBlocking {
            // A record made meanwhile goes with the account.
            val rig = signedRig()
            rig.signedIn(me = Answer.me())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            rig.engine.emergencyUnlock()
            val onItsWay = rig.server.next(unlockRoute)
            val deletion = rig.deleting()
            eventually { rig.engine.waitingOut() }
            assertEquals(emptyList(), rig.server.waiting) // neither the unlock again nor the deletion
            onItsWay.reply(200, Answer.unlocked())
            val delete = rig.server.next()
            assertEquals(deleteMeRoute, delete.route)
            withTimeout(patience) { rig.engine.record(Change.ProtectionOff("s")) }
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(emptyList(), rig.server.waiting) // the report never sent
            rig.stop()
        }

    @Test
    fun aCheckInOnItsWayWhenDeleteAccountIsPressedLandsBeforeAnythingOfTheDeletionGoes(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signedIn(me = Answer.me())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            rig.engine.setScreenOn(true)
            rig.server.next(checkInRoute).reply(200, Answer.live()) // the screen's own, at once
            eventually { rig.clock.deadlines.contains(at(30)) }
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            val deletion = rig.deleting()
            eventually { rig.engine.waitingOut() }
            assertEquals(emptyList(), rig.server.waiting)
            checkIn.reply(200, Answer.live())
            val delete = rig.server.next()
            assertEquals(deleteMeRoute, delete.route)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            rig.stop()
        }

    @Test
    fun anOutboxFileThatCantBeReadHoldsTheDeletionBackWhetherAnUnlockWaitsIsntKnownNothingSentTheSignInKept(): Unit =
        runBlocking {
            // A statement the watched driver refuses, as a failing disk would, where iOS's test renames the table.
            val refusing = AtomicBoolean(false)
            val outbox = open(temporaryFile(), driver = Watching(stepping = { if (refusing.get() && RECORDS in it) throw SQLiteException("refused") }))
            val rig = signedRig(outbox)
            rig.signedIn()
            refusing.set(true)
            assertEquals(AccountDeletion.Unread, rig.engine.deleteAccount(rig.signIn))
            assertEquals(emptyList(), rig.server.waiting)
            assertTrue(rig.signIn.mayDelete())
            refusing.set(false)
            rig.stop()
        }

    @Test
    fun pressedAgainWhileADeletionIsUnderWayThePressSharesItsAnswerOneDeleteMeAndOneDeleteUserNeverASecondDeletionBesideTheFirst(): Unit =
        runBlocking {
            // A second's end would let the loops go while the first's DELETE /v1/me is on its way.
            val rig = signedRig()
            rig.signedIn()
            val (first, second) = rig.deleting() to rig.deleting()
            val delete = rig.server.next(deleteMeRoute)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, first.answer())
            // A second deletion beside it would have sent its own by now, which no one answers.
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(AccountDeletion.Deleted, second.answer())
            rig.stop()
        }

    @Test
    fun aRunCancelledWhileItsSendsAreOutLeavesNothingForADeletionToWaitOnItGoesAtOnceTheRecordSentAgainUnderItsEventId(): Unit =
        runBlocking {
            // No iOS twin: each of the loops' requests lands however it ends, its run's cancel too, so a deletion
            // waits out exactly what is on its way, and never forever.
            val rig = signedRig()
            rig.signStudentIn(scoped("a1"))
            rig.server.next(meRoute) // the read loop's, on its way
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute) // the drain's, on its way
            withTimeout(patience) { rig.running.cancelAndJoin() }

            val deletion = rig.deleting()
            val again = rig.server.next()
            assertEquals(listOf(tapRoute, tap.eventId), listOf(again.route, again.eventId))
            again.reply(200, Answer.joined())
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.outbox.records())
            rig.stop()
        }

    @Test
    fun deleteAccountsCallerCancelledStopsWaitingAndTheDeletionGoesOnInTheEnginesScopeAPressMeanwhileSharingIt(): Unit =
        runBlocking {
            // No iOS twin: Swift's caller can't stop waiting on its task. A screen gone never stops a deletion.
            val rig = signedRig()
            rig.signedIn()
            val caller = launch { rig.engine.deleteAccount(rig.signIn) }
            val delete = rig.server.next(deleteMeRoute)
            caller.cancelAndJoin()
            val again = rig.deleting()
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, again.answer())
            assertTrue(caller.isCancelled)
            assertTrue(rig.keychain.isEmpty)
            assertEquals(Standing.Out, rig.outbox.standing())
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun aSignInOfAnotherAccountLandingWhileDeleteMeIsOnItsWayIsNeitherMarkedDeletedNorDeletedFromCognitoItsTokensKept(): Unit =
        runBlocking {
            // No iOS twin (AN9a's note for AN9b): the deletion holds the account it began with, which DELETE /v1/me
            // removed; that sign-in has left the phone, its Cognito user the server's to delete (C3-cognito).
            val rig = signedRig()
            rig.signedIn()
            val deletion = rig.deleting()
            val delete = rig.server.next(deleteMeRoute)
            assertEquals("Bearer ${scoped("a1")}", delete.token)
            withTimeout(patience) { rig.signStudentIn(scoped("b1"), refresh = "refresh-b") }
            delete.reply(200, deletedAnswer)
            // The read b1's sign-in asked for, which the deletion held: under b1's token, never one taken away.
            val read = rig.server.next(meRoute)
            assertEquals("Bearer ${scoped("b1")}", read.token)
            read.reply(200, Answer.me(null))
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.server.waiting) // no DeleteUser for b1's
            assertFalse(rig.signIn.deletionPending())
            assertEquals("b1", rig.signIn.account())
            assertFalse(rig.keychain.isEmpty)
            rig.stop()
        }

    @Test
    fun cognitoRefusingTheTokenThenTheRefreshTokenForGoodReadsAsDeletedTheSignInGoneNothingMoreSentTheServersDeleterHasTheRest(): Unit =
        runBlocking {
            // iOS's C4a limit, kept (DECISIONS 2026-11-10): the Cognito user may still be there, which the server's own
            // deleter, queued in the deletion's transaction, deletes (C3-cognito); no try of the phone's ever could.
            val rig = signedRig()
            rig.signedIn()
            val deletion = rig.deleting()
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(400, """{"__type":"NotAuthorizedException","message":"no"}""")
            rig.server.next(tokenRoute).reply(400, """{"error":"invalid_grant"}""") // renewed once, refused for good
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            assertNull(rig.signIn.account())
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun aTokenThatExpiredIsRenewedForTheDeletionWithTheEngineLetGoTheRenewalTellingTheEngineAsEveryOneTellsItTheDeletionThenGoes(): Unit =
        runBlocking {
            // A renewal tells the engine through a call of its own (`retryNow`), which waits for the engine: held
            // through the deletion's send, the two would wait on each other for good.
            val rig = signedRig()
            rig.signedIn()
            rig.clock.advance(3600) // a1 has expired
            val deletion = rig.deleting()
            val renewal = rig.server.next(tokenRoute)
            assertTrue("refresh_token=refresh-1" in renewal.request.body?.decodeToString().orEmpty())
            renewal.reply(200, grant(scoped("a1")))
            val delete = rig.server.next()
            assertEquals(deleteMeRoute, delete.route)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            rig.stop()
        }

    @Test
    fun a401ToTheDeletionsOwnSendsRenewsTheTokenTheRestOfTheOutboxGoesUnderTheRenewedOneAndDeleteMeOnceMoreUnderItsEventId(): Unit =
        runBlocking {
            // Santa's review: the deletion's refresh waited for, and `DELETE /v1/me` renewed once (rule 4).
            val rig = signedRig()
            rig.signedIn()
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(404, Answer.unknownBlock) // refused for good: stuck, holding nothing back
            rig.server.next(meRoute).reply(200, Answer.me(null)) // the refusal's re-read
            rig.until { it.queued.firstOrNull()?.stuck == true }
            val off = assertNotNull(rig.engine.record(Change.ProtectionOff("s")))
            rig.server.next(protectionOffRoute).reply(null)
            rig.until { it.queued.size == 2 && it.sending.isEmpty() }

            val deletion = rig.deleting()
            rig.server.next(tapRoute).reply(401)
            val renewed = scoped("a1", issued = 1_000_000_100)
            rig.server.next(tokenRoute).reply(200, grant(renewed))
            val report = rig.server.next()
            assertEquals(listOf(protectionOffRoute, off.eventId, "Bearer $renewed"), listOf(report.route, report.eventId, report.token))
            report.reply(200, Answer.protectionOff())
            val delete = rig.server.next(deleteMeRoute)
            assertEquals("Bearer $renewed", delete.token)
            delete.reply(401)
            val again = scoped("a1", issued = 1_000_000_200)
            rig.server.next(tokenRoute).reply(200, grant(again))
            val resent = rig.server.next(deleteMeRoute)
            assertEquals(listOf(delete.eventId, "Bearer $again"), listOf(resent.eventId, resent.token))
            resent.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            rig.stop()
        }

    @Test
    fun theDrainSendsNothingWhileTheDeletionRunsARecordMadeWhileDeleteMeIsOutWaitsNeverSentAndGoesWithTheAccount(): Unit =
        runBlocking {
            // The point its held pass marks (santa's review): the backoff it showed ends, the drain then waiting on a ring.
            val rig = signedRig()
            rig.signedIn()
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute).reply(null)
            rig.until { it.retryAt == at(2) }
            val deletion = rig.deleting()
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            val delete = rig.server.next(deleteMeRoute)
            assertEquals(at(2), rig.engine.updates.value.retryAt) // the drain asleep since, unrung
            withTimeout(patience) { rig.engine.record(Change.Tap("tag")) }
            rig.until { it.retryAt == null && it.queued.size == 1 }
            assertEquals(emptyList(), rig.server.waiting)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.outbox.records())
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun theReadLoopSendsNothingWhileTheDeletionRunsACheckInDueWhileDeleteMeIsOutWaitsForItsEndNeverSentUnderTheDeletedAccount(): Unit =
        runBlocking {
            // The point its held pass marks (santa's review): its next wake, 30 s on, slept on as ever.
            val rig = signedRig()
            rig.signedIn(me = Answer.me())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            rig.engine.setScreenOn(true)
            rig.server.next(checkInRoute).reply(200, Answer.live()) // the screen's own, at once
            eventually { rig.clock.deadlines.contains(at(30)) }
            val deletion = rig.deleting()
            val delete = rig.server.next(deleteMeRoute)
            rig.clock.advance(30) // a check-in due
            eventually { rig.clock.deadlines.contains(at(60)) }
            assertEquals(emptyList(), rig.server.waiting)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun aSignInThatCantBeReadAsTheDeletionStartsSignsInAgainFirstNothingSentThoughAMomentLaterItCanBe(): Unit =
        runBlocking {
            // Santa's review: the account it holds to read as none would leave the mark to miss, so none is as
            // `mayDelete`'s none. A relaunch's sign-in over the same keychain, its first read failing (the Keystore
            // busy, say), then reading.
            val rig = signedRig()
            rig.signedIn()
            val store =
                object : TokenStore {
                    private val failed = AtomicBoolean(false)

                    override fun load(): ByteArray? = if (failed.compareAndSet(false, true)) throw IOException("busy") else rig.keychain.load()

                    override fun save(tokens: ByteArray) = rig.keychain.save(tokens)

                    override fun clear() = rig.keychain.clear()
                }
            val relaunched = SignIn(rig.signIn.cognito, store, scope, rig.server, rig.clock::now, gated = false)
            assertEquals(AccountDeletion.SignInFirst, scope.async { rig.engine.deleteAccount(relaunched) }.answer())
            assertEquals(emptyList(), rig.server.waiting)
            assertTrue(relaunched.mayDelete()) // readable now: the next press goes
            assertFalse(relaunched.deletionPending())
            rig.stop()
        }

    @Test
    fun aSignInOfAnotherAccountLandingAsTheOutboxGoesStopsTheDeletionNothingMoreSentNorRenewedUnderItNobodyDeletedOrMarkedEveryRecordKept(): Unit =
        runBlocking {
            // The owner, 2026-11-10: "Close it now" (AN9h). b1 signs in while the unlock the deletion sends first is out, which
            // then gets no answer, or a 401: the report behind it would go under b1's token, or the 401 renew b1's sign-in.
            // Neither goes, and the deletion stops with an answer of its own, whose screen has no Try again.
            for (status in listOf(null, 401)) {
                val rig = signedRig()
                val (off, unlock) = rig.queuedThenHeld()
                val deletion = rig.deleting()
                val sent = rig.server.next(unlockRoute)
                assertEquals(listOf(unlock.eventId, "Bearer ${scoped("a1")}"), listOf(sent.eventId, sent.token), "$status")
                withTimeout(patience) { rig.signStudentIn(scoped("b1"), refresh = "refresh-b") }
                sent.reply(status)
                assertEquals("SignInChanged", "${rig.answerSendingNothing(deletion)}", "$status")
                rig.nobodyDeleted("$status")
                assertEquals(setOf(off.eventId, unlock.eventId), rig.outbox.records().map { it.eventId }.toSet(), "$status")
                rig.stop()
            }
        }

    @Test
    fun aSignInOfAnotherAccountLandingWhileASendsRenewalIsOutStopsTheDeletionTheRenewalAboutTokensLetGoNothingMoreSentEveryRecordKept(): Unit =
        runBlocking {
            // AN9h: the unlock refused with a 401, the renewal of a1's sign-in out as b1 signs in.
            val rig = signedRig()
            val (off, unlock) = rig.queuedThenHeld()
            val deletion = rig.deleting()
            rig.server.next(unlockRoute).reply(401)
            val renewal = rig.server.next(tokenRoute)
            assertTrue("refresh_token=refresh-1" in renewal.request.body?.decodeToString().orEmpty())
            withTimeout(patience) { rig.signStudentIn(scoped("b1"), refresh = "refresh-b") }
            renewal.reply(200, grant(scoped("a1", issued = 1_000_000_100)))
            assertEquals("SignInChanged", "${rig.answerSendingNothing(deletion)}")
            rig.nobodyDeleted("the renewal out")
            assertEquals(setOf(off.eventId, unlock.eventId), rig.outbox.records().map { it.eventId }.toSet())
            rig.stop()
        }

    @Test
    fun aSignInOfAnotherAccountLandingAsDeleteMesTokenIsRenewedStopsTheDeletionNoDeleteMeEverSentNobodyDeleted(): Unit =
        runBlocking {
            // AN9h: nothing queued, so DELETE /v1/me is the deletion's first send, its token expired and renewed first as b1
            // signs in.
            val rig = signedRig()
            rig.signedIn()
            withTimeout(patience) { rig.running.cancelAndJoin() }
            rig.clock.advance(3600) // a1 has expired
            val deletion = rig.deleting()
            val renewal = rig.server.next(tokenRoute)
            withTimeout(patience) { rig.signStudentIn(scoped("b1"), refresh = "refresh-b") }
            renewal.reply(200, grant(scoped("a1", issued = 1_000_003_600)))
            assertEquals("SignInChanged", "${rig.answerSendingNothing(deletion)}")
            rig.nobodyDeleted("the token renewed")
            assertTrue(rig.server.sent.none { it.route == deleteMeRoute })
            rig.stop()
        }

    @Test
    fun aSignInOfAnotherAccountLandingWhileDeleteMeIsOutThenAnsweredAnythingButDeletedStopsTheDeletionItsRenewalNeverTheOthers(): Unit =
        runBlocking {
            // AN9h: AN9b's call stands for a DELETE /v1/me answered deleted (above). A 401, whose renewal would be b1's, or no
            // answer, whose Try again would delete b1, stops the deletion with nothing more sent.
            for (status in listOf(401, null)) {
                val rig = signedRig()
                rig.signedIn()
                withTimeout(patience) { rig.running.cancelAndJoin() }
                val deletion = rig.deleting()
                val delete = rig.server.next(deleteMeRoute)
                assertEquals("Bearer ${scoped("a1")}", delete.token, "$status")
                withTimeout(patience) { rig.signStudentIn(scoped("b1"), refresh = "refresh-b") }
                delete.reply(status)
                assertEquals("SignInChanged", "${rig.answerSendingNothing(deletion)}", "$status")
                rig.nobodyDeleted("$status")
                rig.stop()
            }
        }

    @Test
    fun aRenewalOfTheSameAccountDuringTheDeletionKeepsItGoingUnderTheRenewedTokenARotatedRefreshTokenTooDeleteUserSendingTheSignInsOwn(): Unit =
        runBlocking {
            // AN9h: the account is the sign-in's `sub`, so the deletion goes on through its renewals, its refresh token rotated
            // or not; DeleteUser sends the tokens of the refresh token held as it begins (Q4).
            val rig = signedRig()
            rig.signedIn()
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute).reply(null)
            rig.until { it.retryAt == at(2) }
            withTimeout(patience) { rig.running.cancelAndJoin() }
            rig.clock.advance(3600) // a1 has expired: renewed for the report the deletion sends
            val deletion = rig.deleting()
            val first = rig.server.next(tokenRoute)
            assertTrue("refresh_token=refresh-1" in first.request.body?.decodeToString().orEmpty())
            val renewed = scoped("a1", issued = 1_000_003_600)
            first.reply(200, grant(renewed))
            val report = rig.server.next(protectionOffRoute)
            assertEquals("Bearer $renewed", report.token)
            rig.clock.advance(3600) // expired again as the report lands: renewed for DELETE /v1/me, Cognito rotating the refresh token
            report.reply(200, Answer.protectionOff())
            val second = rig.server.next(tokenRoute)
            assertTrue("refresh_token=refresh-1" in second.request.body?.decodeToString().orEmpty())
            val again = scoped("a1", issued = 1_000_007_200)
            second.reply(200, grant(again, refresh = "refresh-2"))
            val delete = rig.server.next(deleteMeRoute)
            assertEquals("Bearer $again", delete.token)
            delete.reply(200, deletedAnswer)
            val cognito = rig.server.next(deleteUserRoute)
            assertTrue(again in cognito.request.body?.decodeToString().orEmpty())
            cognito.reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            rig.stop()
        }

    private companion object {
        /** The outbox's read of everything queued, as Room's DAO prepares it. */
        const val RECORDS = "ORDER BY COALESCE(orderSeq, seq), seq"
    }
}

/**
 * Signed in as a1 in session `s`, a report tried and kept, then an Emergency Unlock held behind it, and the loops ended,
 * so the deletion's are the only sends from here: the report and the unlock, as the outbox holds them.
 */
private suspend fun SignedRig.queuedThenHeld(): Pair<OutboxRecord, OutboxRecord> {
    signedIn(me = Answer.me())
    until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
    val off = assertNotNull(engine.record(Change.ProtectionOff("s")))
    server.next(protectionOffRoute).reply(null)
    until { it.retryAt == at(2) }
    val unlock = assertNotNull(engine.emergencyUnlock())
    withTimeout(patience) { running.cancelAndJoin() }
    return off to unlock
}

/** b1, signed in as a1's deletion ran: nothing sent under b1's sign-in, nothing deleted but by a1's token, b1 neither marked nor gone. */
private suspend fun SignedRig.nobodyDeleted(case: String) {
    assertEquals(emptyList(), sentUnder(scoped("b1"), "refresh-b"), case)
    assertTrue(server.sent.none { it.route == deleteMeRoute && it.token != "Bearer ${scoped("a1")}" || it.route == deleteUserRoute }, case)
    assertFalse(signIn.deletionPending(), case)
    assertEquals("b1", signIn.account(), case)
    assertFalse(keychain.isEmpty, case)
}
