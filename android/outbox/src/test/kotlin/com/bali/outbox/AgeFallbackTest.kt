package com.bali.outbox

import com.bali.core.ParticipationState
import com.bali.core.SendResult
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

// The 13+ check after a sign-in (C7's fallback, the owner's decision 2026-10-06; its yes on Bali's server, C7-server,
// 2026-10-08): a sign-in not yet through the check, over the engine as the app makes it, its sign-in gated as the
// app's is, and the API and Cognito answered by hand. BaliOutbox's AgeFallbackTests, their 200 ms waits replaced by a
// point the rig or the state marks, and new: the check's own read renewed, a yes's 401, 408 and 429, a yes kept going
// nowhere while a deletion runs, a run cancelled while its yes is out, an ask that throws or ends in a cancel of its
// own, and the check never standing between a student and Emergency Unlock. And AN9h's: the read and the yes of one
// account never under another account's sign-in (the owner, 2026-11-10: "Close it now").

val ageCheckRoute = "GET /v1/me/age-check"
val recordAgeCheckRoute = "PUT /v1/me/age-check"
val ageCheckPassed = """{"passed":true}"""

/** The 13+ check after a sign-in, and its yes on Bali's server (C7): BaliOutbox's AgeFallbackTests. */
class AgeFallbackTest : EngineFiles() {
    @Test
    fun untilTheSignInIsThroughTheCheckItReachesBalisApiWithNothingButTheChecksOwnReadUnderItsTokenOnceThroughEverythingGoesAtOnce(): Unit =
        runBlocking {
            // C7-server: no read of the truth, no record sent, each kept and waiting on the sign-in.
            val rig = signedRig(gated = true)
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.signStudentIn(accessToken("a1"))
            // The sign-in sends everything and reads the truth at once: each finds no token to send.
            rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })

            val asking = async { rig.engine.ageCheck() }
            val read = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("a1")}", read.token)
            read.reply(200, """{"passed":false}""")
            assertEquals(false, asking.await().answer?.passed)
            // Not passed, nothing goes: the drain's next try and the read loop's next pass, each marked as it ends.
            rig.engine.setScreenOn(true)
            eventually { rig.clock.deadlines.contains(at(30)) }
            rig.clock.advance(1)
            rig.engine.retryNow()
            rig.until { it.retryAt == at(61) }
            eventually { rig.clock.deadlines.contains(at(31)) }
            assertEquals(emptyList(), rig.server.waiting)

            rig.signIn.passed("a1")
            rig.engine.retryNow()
            val sent = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer ${accessToken("a1")}"), listOf(sent.eventId, sent.token))
            val truth = rig.server.next(meRoute)
            assertEquals("Bearer ${accessToken("a1")}", truth.token)
            rig.stop()
        }

    @Test
    fun theChecksOwnReadRefusedWith401IsRenewedOnceAndReadAgainAnExpiredTokenIsRenewedFirstWithTheEngineLetGoTheRenewalTellingIt(): Unit =
        runBlocking {
            // No iOS twin: a renewal tells the engine through a call of its own (`retryNow`), which waits for the engine,
            // so a read made under it would wait on the renewal for good, as AN9b's deletion's own sends would.
            val rig = signedRig(gated = true)
            rig.signStudentIn(accessToken("a1"))
            rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            var asking = async { rig.engine.ageCheck() }
            rig.server.next(ageCheckRoute).reply(401)
            val renewal = rig.server.next(tokenRoute)
            assertTrue("refresh_token=refresh-1" in renewal.request.body?.decodeToString().orEmpty())
            renewal.reply(200, grant(accessToken("a2")))
            val again = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("a2")}", again.token)
            again.reply(200, ageCheckPassed)
            assertEquals(true, asking.await().answer?.passed)

            rig.clock.advance(3600) // a2 has expired
            asking = async { rig.engine.ageCheck() }
            rig.server.next(tokenRoute).reply(200, grant(accessToken("a3")))
            val read = rig.server.next(ageCheckRoute)
            assertEquals("Bearer ${accessToken("a3")}", read.token)
            read.reply(200, """{"passed":false}""")
            assertEquals(false, asking.await().answer?.passed)
            rig.stop()
        }

    @Test
    fun answeredUnder13TheAccountGoesAsDeleteAccountDeletesOneWhatThePhoneQueuedFirstEveryEmergencyUnlockFirstNoYesEverSentNothingLeftForTheNextSignIn(): Unit =
        runBlocking {
            // C4, the check not passed: under the deletion's own token, an unlock the server hasn't recorded holding the
            // deletion back, never let go; then DELETE /v1/me, then Cognito's DeleteUser. So the next sign-in on this
            // phone files nothing under its own account (Claude Review's blocker on iOS).
            val rig = signedRig(gated = true)
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.signStudentIn(scoped("a1"))
            rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
            assertEquals(emptyList(), rig.server.waiting)

            // The unlock first, ahead of the tap queued before it; no answer to it holds the deletion back.
            val held = rig.deleting()
            val unsent = rig.server.next()
            assertEquals(listOf(unlockRoute, unlock.eventId, "Bearer ${scoped("a1")}"), listOf(unsent.route, unsent.eventId, unsent.token))
            unsent.reply(null)
            val tapped = rig.server.next()
            assertEquals(listOf(tapRoute, tap.eventId), listOf(tapped.route, tapped.eventId))
            tapped.reply(200, Answer.armed)
            assertEquals(AccountDeletion.UnlockUnsent, held.answer())
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })
            assertEquals(emptyList(), rig.server.waiting)

            // Try again: the unlock lands, then the deletion, then the sign-in's.
            val deletion = rig.deleting()
            rig.server.next(unlockRoute).reply(200, Answer.recorded)
            val delete = rig.server.next()
            assertEquals(listOf(deleteMeRoute, "Bearer ${scoped("a1")}"), listOf(delete.route, delete.token))
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            assertEquals(emptyList(), rig.outbox.records())

            // Another student signs in on this phone, through the check: nothing of the last one's goes, only reads of
            // the truth, a second one when the read their sign-in's own wake sends asks for its token only once the check
            // has passed, as on a busy machine it can.
            rig.signStudentIn(accessToken("b1"))
            rig.signIn.passed("b1")
            rig.engine.retryNow()
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.until { it.me != null }
            assertTrue(rig.server.waiting.all { it == meRoute }, "${rig.server.waiting}")
            rig.stop()
        }

    @Test
    fun aSignUpsYesGoesToBalisServerAtTheEnginesWakesUnderItsOwnEventIdAndTheSignInsTokenKeptOnNoAnswerOrA5xxRecordedLetGoNeverSentAgain(): Unit =
        runBlocking {
            // C7-server: each time under the same event id; recorded, the sign-in still through the check.
            val rig = signedRig(gated = true)
            rig.signStudentIn(accessToken("a1"), yes = "y1")
            val yes = yesSent(rig, listOf(null to "", 500 to "", 200 to ageCheckPassed))
            assertEquals(listOf("y1", "y1", "y1"), yes.map { it.eventId })
            assertTrue(yes.all { it.token == "Bearer ${accessToken("a1")}" })
            eventually { rig.signIn.yes() == null }
            assertTrue(rig.signIn.checked())
            noYesAtTheNextWake(rig)
            rig.stop()
        }

    @Test
    fun aYesBalisServerRefusesForGoodTheAccountDeletedOnItsWayIsLetGoNeverSentAgainTheAccountAskedOnceMoreOnlyWhereTheServerHasNoYes(): Unit =
        runBlocking {
            // C7-server: `409 account_deleted`.
            val rig = signedRig(gated = true)
            rig.signStudentIn(accessToken("a1"), yes = "y1")
            yesSent(rig, listOf(409 to """{"error":{"code":"conflict","reason":"account_deleted","message":"gone"}}"""))
            eventually { rig.signIn.yes() == null }
            noYesAtTheNextWake(rig)
            rig.stop()
        }

    @Test
    fun aYesRefusedWith401IsRenewedOnceAndSentAgainUnderTheRenewedTokenA401ThenA3xxA408OrA429KeepsItForTheNextWakeUnderTheSameEventId(): Unit =
        runBlocking {
            // iOS's `record(yes:)`, which no iOS test reaches: none of them refuses it for good, nor records it (a 3xx,
            // which the transport never follows; santa's review).
            val rig = signedRig(gated = true)
            rig.signStudentIn(accessToken("a1"), yes = "y1")
            yesOnItsWay(rig).reply(401)
            rig.server.next(tokenRoute).reply(200, grant(accessToken("a2")))
            val renewed = rig.server.next(recordAgeCheckRoute)
            assertEquals(listOf("y1", "Bearer ${accessToken("a2")}"), listOf(renewed.eventId, renewed.token))
            renewed.reply(401)
            rig.engine.retryNow()
            val again = yesSent(rig, listOf(307 to "", 408 to "", 429 to "", 200 to ageCheckPassed))
            assertEquals(listOf("y1", "y1", "y1", "y1"), again.map { it.eventId })
            assertTrue(again.all { it.token == "Bearer ${accessToken("a2")}" })
            eventually { rig.signIn.yes() == null }
            rig.stop()
        }

    @Test
    fun aYesOnItsWayWhenDeleteAccountIsPressedLandsBeforeAnythingOfTheDeletionGoesSoNoYesEverReachesBaliAfterItsDeleteMe(): Unit =
        runBlocking {
            // C7-server: landing after DELETE /v1/me, it would make a fresh account.
            val rig = signedRig(gated = true)
            rig.signStudentIn(scoped("a1"), yes = "y1")
            val onItsWay = yesOnItsWay(rig)
            val deletion = rig.deleting()
            eventually { rig.engine.waitingOut() }
            assertEquals(emptyList(), rig.server.waiting) // the deletion waits for the yes
            onItsWay.reply(200, ageCheckPassed)
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertEquals(emptyList(), rig.server.waiting)
            assertTrue(rig.keychain.isEmpty)
            rig.stop()
        }

    @Test
    fun aYesKeptForTheNextWakeGoesNowhereWhileADeletionRunsAWakeWhileDeleteMeIsOutSendsNothingAndItGoesWithTheAccount(): Unit =
        runBlocking {
            // The point its held pass marks: its next wake, 30 s on, slept on as ever. The screen on first, so the read loop
            // waits for that wake as the sign-in lands, and the wake the sign-in rings reads the truth, then sends the yes.
            val rig = signedRig(gated = true)
            rig.engine.setScreenOn(true)
            eventually { rig.clock.deadlines == listOf(at(30)) }
            rig.signStudentIn(scoped("a1"), yes = "y1")
            rig.server.next(meRoute).reply(200, Answer.me(null))
            rig.server.next(recordAgeCheckRoute).reply(null) // no answer: kept
            eventually { rig.clock.deadlines == listOf(at(30)) }
            val deletion = rig.deleting()
            val delete = rig.server.next(deleteMeRoute)
            rig.clock.advance(30)
            eventually { rig.clock.deadlines.contains(at(60)) }
            assertEquals(emptyList(), rig.server.waiting)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun aRunCancelledWhileItsYesIsOutLeavesNothingForADeletionToWaitOnItGoesAtOnceAndTheYesGoesWithTheAccount(): Unit =
        runBlocking {
            // No iOS twin: the yes lands however its pass ends, its run's cancel too (AN9b's `counted`), so a deletion
            // waits out exactly what is on its way, and never forever.
            val rig = signedRig(gated = true)
            rig.signStudentIn(scoped("a1"), yes = "y1")
            yesOnItsWay(rig)
            withTimeout(patience) { rig.running.cancelAndJoin() }

            val deletion = rig.deleting()
            val delete = rig.server.next()
            assertEquals(deleteMeRoute, delete.route)
            delete.reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            assertTrue(rig.keychain.isEmpty)
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun theAppsOwnAskOfTheCheckAgainRunsAtEachWakeOfTheReadLoopNeverWhileADeletionRunsWhenNothingOfTheLoopsGoesAndAgainOnceItIsOver(): Unit =
        runBlocking {
            // #300's review, the owner's approval (2026-10-09): its first, a sign-in's token, a Try again, Bali's screen
            // to the front, the screen on, each 30 s while it is on.
            val (asks, checks) = AtomicInteger() to AtomicInteger()
            val rig = signedRig(gated = true, age = { asks.incrementAndGet() })
            rig.engine.atEachWake { checks.incrementAndGet() }
            eventually { asks.get() == 1 }
            rig.signStudentIn(scoped("a1"))
            eventually { asks.get() == 2 }
            rig.engine.retryNow()
            eventually { asks.get() == 3 }
            rig.engine.setInFront(true)
            eventually { asks.get() == 4 }
            rig.engine.setScreenOn(true)
            eventually { asks.get() == 5 }
            eventually { rig.clock.deadlines == listOf(at(30)) }
            rig.clock.advance(30)
            eventually { asks.get() == 6 }

            // Delete account, held at the unlock it sends first: two wakes meanwhile, rule 3's check run at each, the first
            // over before the second begins, and nothing asked at either.
            rig.engine.record(Change.Unlock("s", null))
            val deletion = rig.deleting()
            val unlock = rig.server.next(unlockRoute)
            val woken = checks.get()
            for (wake in 1..2) {
                rig.engine.retryNow()
                eventually { checks.get() == woken + wake }
            }
            assertEquals(6, asks.get())
            unlock.reply(200, Answer.recorded)
            rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
            rig.server.next(deleteUserRoute).reply(200, "{}")
            assertEquals(AccountDeletion.Deleted, deletion.answer())
            eventually { asks.get() > 6 }
            rig.stop()
        }

    @Test
    fun anAskThatThrowsOrEndsInACancelOfItsOwnAskedNothingAndTheLoopGoesOnItsReadAndTheYesStillGoingAndAskedAgainAtTheNextWake(): Unit =
        runBlocking {
            // Its contract says it never does (`askAgeAtEachWake`), as rule 3's check's says: no hook ends a loop (`hooked`).
            for (fails in listOf<suspend () -> Unit>({ error("broken") }, { throw CancellationException("its own") }, { withTimeout(1) { awaitCancellation() } })) {
                val asks = AtomicInteger()
                val rig =
                    signedRig(gated = true) {
                        asks.incrementAndGet()
                        fails()
                    }
                rig.signStudentIn(accessToken("a1"), yes = "y1")
                yesSent(rig, listOf(200 to ageCheckPassed))
                eventually { rig.signIn.yes() == null }
                // Asked again at the wakes after, each reading the truth.
                val before = asks.get()
                rig.engine.retryNow()
                rig.server.next(meRoute).reply(200, Answer.me(null))
                rig.engine.retryNow()
                rig.server.next(meRoute)
                assertTrue(asks.get() > before, "${asks.get()}")
                rig.stop()
            }
        }

    @Test
    fun theCheckNeverStandsBetweenAStudentAndEmergencyUnlockTheAskHeldTheChecksOwnReadOutThenTheYesOutTheLockComesOffAtOnceAndItsRecordGoes(): Unit =
        runBlocking {
            // ARCHITECTURE, C7: nothing in the read, the ask or the yes holds an unlock back or makes one wait, since each
            // goes with the engine let go.
            val holding = AtomicBoolean(true)
            val (asked, released) = CompletableDeferred<Unit>() to CompletableDeferred<Unit>()
            val rig =
                signedRig(gated = true) {
                    if (holding.compareAndSet(true, false)) {
                        asked.complete(Unit)
                        released.await()
                    }
                }
            withTimeout(patience) { asked.await() } // the run's first wake, its ask held
            withTimeout(patience) { rig.signStudentIn(accessToken("a1"), yes = "y1") }
            withTimeout(patience) { rig.engine.record(Change.Tap("tag")) }
            rig.server.next(tapRoute).reply(200, Answer.joined())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            val reading = async { rig.engine.ageCheck() }
            val read = rig.server.next(ageCheckRoute) // the check's own read, on its way

            assertNotNull(withTimeout(patience) { rig.engine.emergencyUnlock() })
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Unlocked) }
            val unlock = rig.server.next(unlockRoute)
            assertEquals("Bearer ${accessToken("a1")}", unlock.token)
            unlock.reply(200, Answer.unlocked())

            // The ask let go, its wake sends the yes; while that is out too, Back to focus, then Emergency Unlock again.
            released.complete(Unit)
            val yes = rig.server.next(recordAgeCheckRoute)
            withTimeout(patience) { rig.engine.backToFocus() }
            rig.server.next(refocusRoute).reply(200, Answer.refocused())
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Focused) }
            assertNotNull(withTimeout(patience) { rig.engine.emergencyUnlock() })
            rig.until { it.standing == Standing.InSession(session(), ParticipationState.Unlocked) }
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            yes.reply(200, ageCheckPassed)
            read.reply(200, ageCheckPassed)
            assertEquals(true, reading.await().answer?.passed)
            rig.stop()
        }

    @Test
    fun theChecksReadForOneAccountGoesUnderNoOtherAccountsTokenNorRenewsItsSignInOneLandingWhileItsRenewalOrTheReadIsOutAskedItself(): Unit =
        runBlocking {
            // The owner, 2026-11-10: "Close it now" (AN9h). a1's read refused with a 401, its renewal of a1's sign-in out as b1
            // signs in: the read isn't sent again under b1's token. Or b1 signs in while the read is out, then the 401: b1's
            // sign-in isn't renewed for it. b1 is asked itself, its own read under its own token.
            for (renewalOut in listOf(true, false)) {
                val rig = signedRig(gated = true)
                rig.signStudentIn(accessToken("a1"))
                rig.until { it.link == Link.SignIn && it.meFailed == SendResult.NetworkError }
                val asking = async { rig.engine.ageCheck() }
                val read = rig.server.next(ageCheckRoute)
                assertEquals("Bearer ${accessToken("a1")}", read.token, "$renewalOut")
                if (renewalOut) {
                    read.reply(401)
                    val renewal = rig.server.next(tokenRoute)
                    withTimeout(patience) { rig.signStudentIn(accessToken("b1"), refresh = "refresh-b") }
                    renewal.reply(200, grant(accessToken("a1")))
                } else {
                    withTimeout(patience) { rig.signStudentIn(accessToken("b1"), refresh = "refresh-b") }
                    read.reply(401)
                }
                val answer = rig.answerSendingNothing(asking)
                assertEquals(if (renewalOut) SendResult.NetworkError else SendResult.Status(401), answer.result, "$renewalOut")
                assertEquals(emptyList(), rig.sentUnder(accessToken("b1"), "refresh-b"), "$renewalOut")
                val own = async { rig.engine.ageCheck() }
                val asked = rig.server.next(ageCheckRoute)
                assertEquals("Bearer ${accessToken("b1")}", asked.token, "$renewalOut")
                asked.reply(200, """{"passed":false}""")
                assertEquals(false, own.await().answer?.passed, "$renewalOut")
                rig.stop()
            }
        }

    @Test
    fun aYesForOneAccountGoesUnderNoOtherAccountsTokenNorRenewsItsSignInOneSignedInMeanwhileAskedItselfNothingOfTheFirstsRecordedForIt(): Unit =
        runBlocking {
            // The owner, 2026-11-10: "Close it now" (AN9h). a1's yes refused with a 401, its renewal of a1's sign-in out as b1
            // signs in, is asked itself and passes: the yes isn't sent again under b1's token. Or b1 signs in and passes while
            // the yes is out, then the 401: b1's sign-in isn't renewed for it. The next request is b1's own read of the truth.
            for (renewalOut in listOf(true, false)) {
                val rig = signedRig(gated = true)
                rig.signStudentIn(accessToken("a1"), yes = "y1")
                val yes = yesOnItsWay(rig)
                assertEquals(listOf("y1", "Bearer ${accessToken("a1")}"), listOf(yes.eventId, yes.token), "$renewalOut")
                if (renewalOut) {
                    yes.reply(401)
                    val renewal = rig.server.next(tokenRoute)
                    b1AskedItselfAndPassed(rig)
                    renewal.reply(200, grant(accessToken("a1")))
                } else {
                    b1AskedItselfAndPassed(rig)
                    yes.reply(401)
                }
                val next = rig.server.next()
                assertEquals(listOf(meRoute, "Bearer ${accessToken("b1")}"), listOf(next.route, next.token), "$renewalOut")
                next.reply(200, Answer.me(null))
                noYesAtTheNextWake(rig)
                assertEquals(listOf("Bearer ${accessToken("a1")}"), rig.server.sent.filter { it.route == recordAgeCheckRoute }.map { it.token }, "$renewalOut")
                assertEquals(emptyList(), rig.server.sent.filter { "refresh_token=refresh-b" in it.request.body?.decodeToString().orEmpty() }.map { it.route })
                rig.stop()
            }
        }
}

/** b1 signs in, is asked itself, its own read under its own token, and passes (C7-server). */
private suspend fun b1AskedItselfAndPassed(rig: SignedRig) {
    withTimeout(patience) { rig.signStudentIn(accessToken("b1"), refresh = "refresh-b") }
    val asking = rig.scope.async { rig.engine.ageCheck() }
    val read = rig.server.next(ageCheckRoute)
    assertEquals("Bearer ${accessToken("b1")}", read.token)
    read.reply(200, ageCheckPassed)
    assertEquals(true, asking.await().answer?.passed)
    rig.signIn.passed("b1")
}

/**
 * The yes the engine sends, answered in turn from [answered], a status and a body, none no answer, each read of the
 * truth its wakes send meanwhile answered too, in whatever order they come, and a wake asked for after each answer but
 * the last: the yes's requests, in order. BaliOutbox's tests' `yesSent`.
 */
private suspend fun yesSent(rig: SignedRig, answered: List<Pair<Int?, String>>): List<Server.Exchange> {
    val answers = answered.toMutableList()
    val sent = mutableListOf<Server.Exchange>()
    while (answers.isNotEmpty()) {
        val next = rig.server.next()
        if (next.route != recordAgeCheckRoute) {
            assertEquals(meRoute, next.route)
            next.reply(200, Answer.me(null))
            continue
        }
        sent += next
        val (status, body) = answers.removeAt(0)
        next.reply(status, body)
        if (answers.isNotEmpty()) rig.engine.retryNow()
    }
    return sent
}

/**
 * The yes the sign-in's wake sends, on its way, each read of the truth sent meanwhile answered: a sign-in landing while
 * a pass of the read loop has taken its wake has that pass send the yes ahead of the read its ring asks for, as on iOS.
 */
private suspend fun yesOnItsWay(rig: SignedRig): Server.Exchange {
    while (true) {
        val next = rig.server.next()
        if (next.route == recordAgeCheckRoute) return next
        assertEquals(meRoute, next.route)
        next.reply(200, Answer.me(null))
    }
}

/**
 * No yes goes at the read loop's next wake: that pass's read of the truth answered, the read of the pass after shows it
 * ended, which a yes it sent, held unanswered here, would never let it.
 */
private suspend fun noYesAtTheNextWake(rig: SignedRig) {
    rig.engine.retryNow()
    rig.server.next(meRoute).reply(200, Answer.me(null))
    rig.engine.retryNow()
    rig.server.next(meRoute)
    assertFalse(recordAgeCheckRoute in rig.server.waiting, "${rig.server.waiting}")
}
