package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SignIn
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
// NotAuthorizedException then `invalid_grant`, and a token renewed for the deletion.

val deleteMeRoute = "DELETE /v1/me"

/** Cognito's DeleteUser, at `https://cognito-idp.us-east-1.amazonaws.com/`. */
val deleteUserRoute = "POST /"
val deletedAnswer = """{"outcome":"deleted"}"""

/** An access token from a sign-in that asked for the scope DeleteUser needs, its pool named. */
fun scoped(name: String): String {
    val payload =
        """{"sub":"$name","iat":1000000000,"exp":1000003600,"scope":"openid email profile aws.cognito.signin.user.admin",""" +
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

    private companion object {
        /** The outbox's read of everything queued, as Room's DAO prepares it. */
        const val RECORDS = "ORDER BY COALESCE(orderSeq, seq), seq"
    }
}
