package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.net.URI
import java.time.Duration
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject

/** [t0] as the API writes a time: a record's `deviceTime`, when the phone acted. */
private const val SENT_AT = "2026-09-21T14:13:20.000Z"

/** In session s, ending [endsAt] seconds after [t0], in [state]. */
private fun inSession(state: ParticipationState, endsAt: Long = 3000) = Standing.InSession(session(endsAt = endsAt), state)

/** The drain: the outbox, sent through the one client. BaliOutbox's DrainTests, AN5b's and AN5c's parts. */
class DrainTest : EngineFiles() {
    @Test
    fun whatThePhoneDidGoesAtOnceCarryingItsEventIdAndLeavesOnceTheServerHasIt(): Unit =
        runBlocking {
            val rig = rig()
            assertEquals(URI("https://api.bali.test"), rig.engine.client.baseUrl)
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", UnlockReason.Nurse)))
            val sent = rig.server.next()
            assertEquals(listOf(unlockRoute, unlock.eventId, SENT_AT), listOf(sent.route, sent.eventId, sent.deviceTime))
            assertEquals("Bearer token-1", sent.token)
            assertEquals(setOf(unlock.eventId), rig.engine.updates.value.sending)
            sent.reply(200, Answer.unlocked())
            // Answered and gone from the queue in one step: no longer on its way either, and the phone in
            // the session the answer names.
            val state = rig.until { it.queued.isEmpty() }
            assertEquals(listOf(Link.Reached, t0, null, emptySet<String>()), listOf(state.link, state.heardAt, state.retryAt, state.sending))
            assertEquals(inSession(ParticipationState.Unlocked), state.standing)
            assertEquals(emptyList(), rig.outbox.records())
        }

    @Test
    fun noAnswerTheRecordBacksOff2sThen4sNothingGoesBeforeItIsDue(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next().reply(null)
            var state = rig.until { it.retryAt == at(2) }
            assertEquals(Link.Unreachable, state.link)
            assertNull(state.heardAt)
            assertEquals(listOf(1), state.queued.map { it.attempts })
            rig.sleeping(at(2))
            rig.clock.advance(Duration.ofMillis(1500))
            rig.sleeping(at(2))
            assertEquals(emptyList(), rig.server.waiting)
            rig.clock.advance(Duration.ofMillis(500))
            val again = rig.server.next()
            assertEquals(listOf(tap.eventId, SENT_AT), listOf(again.eventId, again.deviceTime))
            again.reply(503)
            state = rig.until { it.retryAt == at(6) }
            assertEquals(listOf(Link.Reached, at(2)), listOf(state.link, state.heardAt))
            rig.sleeping(at(6))
            assertEquals(emptyList(), rig.server.waiting)
        }

    @Test
    fun inTheOrderThePhoneActedAnUnlockGoesBeforeTheRefocusMadeAfterIt(): Unit =
        runBlocking {
            val rig = rig()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            val refocus = assertNotNull(rig.engine.record(Change.Refocus("s")))
            val first = rig.server.next()
            assertEquals(unlock.eventId, first.eventId)
            first.reply(200, Answer.unlocked())
            val second = rig.server.next()
            assertEquals(listOf(refocusRoute, refocus.eventId), listOf(second.route, second.eventId))
            second.reply(200, Answer.refocused())
            rig.until { it.queued.isEmpty() }
        }

    @Test
    fun aChangeMadeWhileAnotherIsInFlightGoesNextOnceThatOneIsAnswered(): Unit =
        runBlocking {
            // iOS's ringWhileBusy: the pass after an answer reads the file anyway, so its ring is the
            // next test's to pin.
            val rig = rig()
            rig.engine.record(Change.Tap("tag"))
            val tap = rig.server.next()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            tap.reply(200, Answer.joined())
            assertEquals(unlock.eventId, rig.server.next(unlockRoute).eventId)
        }

    @Test
    fun aChangeMadeWhileTheDrainWaitsRingsItItGoesAtOnceNotWhenTheWaitEnds(): Unit =
        runBlocking {
            // The drain waits 2 s for a refused tap, which holds nothing behind it, before a change is made.
            val rig = rig()
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(409, Answer.refused("event_id_conflict"))
            rig.sleeping(at(2))
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            assertEquals(unlock.eventId, rig.server.next(unlockRoute).eventId)
            assertEquals(t0, rig.clock.now())
        }

    @Test
    fun noTokenNothingIsSentOrSettledTheRecordWaitsOnSignInNeverDroppedNeverASignOutAndSignedInItGoesAtOnce(): Unit =
        runBlocking {
            val rig = rig()
            rig.tokens.set(null)
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            val waiting = rig.until { it.link == Link.SignIn && it.retryAt == at(60) }
            assertEquals(emptySet(), waiting.sending)
            assertEquals(emptyList(), rig.server.waiting)
            val kept = assertNotNull(current(rig.outbox, tap.eventId))
            assertEquals(listOf(0, t0, false), listOf(kept.attempts, kept.nextAttemptAt, kept.stuck))
            // Unrung, it asks again a minute on: still no token, still nothing sent or counted.
            rig.sleeping(at(60))
            rig.clock.advance(60)
            rig.until { it.retryAt == at(120) }
            assertEquals(emptyList(), rig.server.waiting)
            assertEquals(0, current(rig.outbox, tap.eventId)?.attempts)
            // A sign-in gives it one, and B4 rings.
            rig.tokens.set("token-9")
            rig.engine.retryNow()
            val sent = rig.server.next(tapRoute)
            assertEquals(listOf(tap.eventId, "Bearer token-9"), listOf(sent.eventId, sent.token))
        }

    @Test
    fun a401TheSignInRefreshesTheTokenAndEverythingGoesAgainAtOnceOncePerRejectionAFreshTokenRefusedTooWaitsOutTheBackoff(): Unit =
        runBlocking {
            val rig = rig()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next().reply(401)
            val again = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer token-2"), listOf(again.eventId, again.token))
            assertEquals(1, rig.tokens.refreshes)
            assertEquals(Link.SignIn, rig.engine.updates.value.link)
            again.reply(401)
            var state = rig.until { it.retryAt == at(4) }
            assertEquals(Link.SignIn, state.link)
            assertEquals(1, rig.tokens.refreshes)
            // Nothing but a 401 since: a later rejection waits too, with no new refresh.
            rig.clock.advance(4)
            rig.server.next(unlockRoute).reply(401)
            rig.until { it.retryAt == at(12) }
            assertEquals(1, rig.tokens.refreshes)
            // Any other answer ends the rejection: the next 401 refreshes again.
            rig.clock.advance(8)
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            state = rig.until { it.queued.isEmpty() }
            assertEquals(Link.Reached, state.link)
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute).reply(401)
            assertEquals("Bearer token-3", rig.server.next(protectionOffRoute).token)
            assertEquals(2, rig.tokens.refreshes)
        }

    @Test
    fun a401WithNoFreshTokenToBeHadIsSignInsNeverASignOutTheRecordKeptUncountedNothingSpinsAndTheNext401AsksAgain(): Unit =
        runBlocking {
            val rig = rig(refreshWorks = false)
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute).reply(401)
            var state = rig.until { it.retryAt == at(2) }
            assertEquals(listOf(Link.SignIn, t0), listOf(state.link, state.heardAt))
            assertEquals(listOf(listOf(1, 0, false)), state.queued.map { listOf(it.attempts, it.answers, it.stuck) })
            assertEquals(1, rig.tokens.refreshes)
            rig.sleeping(at(2))
            assertEquals(emptyList(), rig.server.waiting)
            // A backoff later, refused again: one more refresh, and the next backoff.
            rig.clock.advance(2)
            val again = rig.server.next(tapRoute)
            assertEquals(tap.eventId, again.eventId)
            again.reply(401)
            state = rig.until { it.retryAt == at(6) }
            assertEquals(Link.SignIn, state.link)
            assertEquals(2, rig.tokens.refreshes)
        }

    @Test
    fun aRefreshThatThrowsOrEndsInACancelOfItsOwnGivesNoTokenAndTheNext401AsksAgainNoneLeftUnderWayForGood(): Unit =
        runBlocking {
            // Its contract says it never does (`open`): a timeout inside the sign-in's refresh, say.
            for (refresh in listOf<suspend () -> Boolean>({ withTimeout(1) { awaitCancellation() } }, { error("broken") })) {
                val (outbox, _) = makeOutbox()
                val (server, clock, tokens) = Triple(Server(), TestClock(), Tokens())
                val asked = AtomicInteger()
                val engine = SyncEngine.open(outbox, client(server, tokens), scope, clock) { asked.incrementAndGet().let { refresh() } }
                val rig = Rig(engine, outbox, server, clock, tokens, scope)
                rig.engine.record(Change.Tap("tag"))
                server.next(tapRoute).reply(401)
                assertEquals(Link.SignIn, rig.until { it.retryAt == at(2) }.link)
                clock.advance(2)
                server.next(tapRoute).reply(401)
                rig.until { it.retryAt == at(6) }
                assertEquals(2, asked.get())
                rig.stop()
            }
        }

    @Test
    fun aFreshTokenRefusedTooIsNotRefreshedAgainUntilTheSignInsRetryNowAfterWhichTheNext401Refreshes(): Unit =
        runBlocking {
            // B4 owes the retry for every token it gets but through the refresh.
            val rig = rig()
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(401)
            rig.server.next(tapRoute).reply(401)
            rig.until { it.retryAt == at(4) }
            assertEquals(1, rig.tokens.refreshes)
            rig.engine.retryNow()
            rig.server.next(tapRoute).reply(401)
            assertEquals("Bearer token-3", rig.server.next(tapRoute).token)
            assertEquals(2, rig.tokens.refreshes)
        }

    @Test
    fun two401sAtOnceTheOutboxsAndACheckInsShareOneRefreshAndEverythingGoesAgainOnceWithTheFreshToken(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.screenOn()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            val sent = rig.server.next(unlockRoute)
            rig.clock.advance(30)
            val checkIn = rig.server.next(checkInRoute)
            rig.tokens.hold()
            sent.reply(401)
            eventually { rig.tokens.refreshes == 1 }
            // The check-in's 401, heard while that refresh runs: a second later, so the test sees it.
            rig.clock.advance(1)
            checkIn.reply(401)
            rig.until { it.heardAt == at(31) }
            // Past the unlock's backoff, nothing goes with the old token: both loops wait on the refresh.
            // (Real time for a loop that didn't to send.)
            rig.clock.advance(2)
            delay(100)
            assertEquals(emptyList(), rig.server.waiting)
            rig.tokens.release()
            val again = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer token-2"), listOf(again.eventId, again.token))
            assertEquals("Bearer token-2", rig.server.next(meRoute).token)
            assertEquals(1, rig.tokens.refreshes)
        }

    @Test
    fun aStateChangeTheServerRefusesIsDroppedNeverSentAgainAndShownUntilThePhonesNextChange(): Unit =
        runBlocking {
            val rig = rig()
            rig.engine.record(Change.ProtectionOff("s"))
            rig.server.next(protectionOffRoute).reply(409, Answer.refused("not_participating"))
            val state = rig.until { it.refused != null }
            assertEquals(Refusal(Change.ProtectionOff("s"), 409, ApiErrorReason.NotParticipating, "not_participating"), state.refused)
            assertEquals(emptyList(), state.queued)
            // And the truth is read again.
            rig.server.next(meRoute)
            // The student acts again: that refusal is history, no longer shown.
            rig.engine.record(Change.Tap("tag"))
            assertNull(rig.engine.updates.value.refused)
        }

    @Test
    fun anAnswerTheFileRefusesToSettleIsShownTheRecordKeptOnItsWayAndSentAgainWithinAMinute(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            val sent = rig.server.next(tapRoute)
            rig.outbox.execute("ALTER TABLE outbox RENAME TO gone")
            sent.reply(200, Answer.joined())
            // The file still counts it never sent, so it's still on its way: a reason given now
            // wouldn't go with it (C5c). Nothing of the answer applied.
            val state = rig.until { it.link == Link.StorageFailed && it.retryAt == at(60) }
            assertEquals(listOf(setOf(tap.eventId), listOf(tap.eventId), Standing.Out), listOf(state.sending, state.queued.map { it.eventId }, state.standing))
            rig.outbox.execute("ALTER TABLE gone RENAME TO outbox")
            rig.clock.advance(60)
            val again = rig.server.next(tapRoute)
            assertEquals(tap.eventId, again.eventId)
            again.reply(200, Answer.joined())
            val answered = rig.until { it.queued.isEmpty() }
            assertEquals(listOf(emptySet<String>(), inSession(ParticipationState.Focused)), listOf(answered.sending, answered.standing))
        }

    @Test
    fun aRunCancelledItsCoroutineTornDownRunsAgainNothingQueuedIsStranded(): Unit =
        runBlocking {
            val rig = rig()
            withTimeout(patience) { rig.running.cancelAndJoin() }
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            val again = scope.launch { rig.engine.run() }
            assertEquals(tap.eventId, rig.server.next(tapRoute).eventId)
            withTimeout(patience) { again.cancelAndJoin() }
        }

    @Test
    fun aRunCancelledMidSendLeavesItsRecordAsItWasDueAndOnItsWayItsAttemptUncountedAndTheNextRunSendsItAtOnce(): Unit =
        runBlocking {
            // A send cancelled with its caller makes no answer (AN4b), where iOS settles it as none.
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute)
            withTimeout(patience) { rig.running.cancelAndJoin() }
            val kept = assertNotNull(current(rig.outbox, tap.eventId))
            assertEquals(listOf(0, 0, t0, false, null), listOf(kept.attempts, kept.answers, kept.nextAttemptAt, kept.stuck, kept.lastStatus))
            // Still on its way: it may have reached the server, so a reason given now wouldn't go with it
            // (C5c). No answer is said.
            val state = rig.engine.updates.value
            assertEquals(listOf(setOf(tap.eventId), null), listOf(state.sending, state.link))
            // Due as it was: the next run sends it at once, under its event id, the clock unmoved, and its
            // answer takes it off its way.
            val again = scope.launch { rig.engine.run() }
            val sent = rig.server.next(tapRoute)
            assertEquals(tap.eventId, sent.eventId)
            sent.reply(200, Answer.joined())
            assertEquals(emptySet(), rig.until { it.queued.isEmpty() }.sending)
            withTimeout(patience) { again.cancelAndJoin() }
        }

    @Test
    fun anOutboxThatCantBeReadIsShownAndReadAgainWithinAMinuteTheRecordKeptAndSentOnceItCanBe(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute).reply(503)
            rig.sleeping(at(2))
            rig.outbox.execute("ALTER TABLE outbox RENAME TO gone")
            rig.clock.advance(2)
            val state = rig.until { it.link == Link.StorageFailed && it.retryAt == at(62) }
            assertEquals(listOf(tap.eventId), state.queued.map { it.eventId })
            // The student's retry, a second on, can't read it either: still shown, the queue as last read,
            // and read again a minute from then. (Waited for, so the file comes back after that read.)
            rig.clock.advance(1)
            rig.engine.retryNow()
            val retried = rig.engine.updates.value
            assertEquals(Link.StorageFailed, retried.link)
            assertEquals(listOf(tap.eventId), retried.queued.map { it.eventId })
            rig.until { it.retryAt == at(63) }
            rig.sleeping(at(63))
            assertEquals(emptyList(), rig.server.waiting)
            rig.outbox.execute("ALTER TABLE gone RENAME TO outbox")
            rig.clock.advance(60)
            val again = rig.server.next(tapRoute)
            assertEquals(tap.eventId, again.eventId)
            again.reply(200, Answer.joined())
            rig.until { it.queued.isEmpty() && it.link == Link.Reached }
        }

    @Test
    fun theStudentsRetrySendsEverythingAtOnceAStuckRecordTooWhichStaysStuck(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute).reply(409, Answer.refused("event_id_conflict"))
            var state = rig.until { it.retryAt == at(2) }
            assertEquals(listOf(true), state.queued.map { it.stuck })
            assertEquals(ApiErrorReason.EventIdConflict, state.queued.first().lastReason)
            assertNull(state.pendingTap)
            rig.engine.retryNow()
            val again = rig.server.next(tapRoute)
            assertEquals(tap.eventId, again.eventId)
            again.reply(503)
            state = rig.until { it.queued.firstOrNull()?.attempts == 2 }
            assertEquals(listOf(true), state.queued.map { it.stuck })
        }
}

/** Applying answers: the phone's truth. BaliOutbox's AnswerTests, AN5b's and AN5c's parts. */
class AnswerTest : EngineFiles() {
    @Test
    fun aTapIsLockedForAtOnceWhileUnansweredThenThePhoneIsInTheSessionItsAnswerNamesInTheStateItNames(): Unit =
        runBlocking {
            val rig = rig()
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            var state = rig.until { it.pendingTap != null }
            assertEquals(tap, state.pendingTap)
            assertEquals(Standing.Out, state.standing)
            // A replay answers the state now: here, an unlock made since.
            rig.server.next(tapRoute).reply(200, Answer.replay(state = "unlocked"))
            state = rig.until { it.queued.isEmpty() }
            assertNull(state.pendingTap)
            assertEquals(inSession(ParticipationState.Unlocked), state.standing)
        }

    @Test
    fun thePhonesOwnChangeStandsAtOnceAnUnlockARefocusProtectionOff(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            assertEquals(inSession(ParticipationState.Unlocked), rig.engine.updates.value.standing)
            rig.engine.record(Change.Refocus("s"))
            assertEquals(inSession(ParticipationState.Focused), rig.engine.updates.value.standing)
            rig.engine.record(Change.ProtectionOff("s"))
            assertEquals(inSession(ParticipationState.ProtectionOff), rig.engine.updates.value.standing)
            // A change of another session leaves the phone's be.
            rig.engine.record(Change.Unlock("t", null))
            assertEquals(inSession(ParticipationState.ProtectionOff), rig.engine.updates.value.standing)
        }

    @Test
    fun aChangesAnswerIsTheTruthAsOfThatChangeButALaterChangeOfThePhonesStillUnansweredStandsOverIt(): Unit =
        runBlocking {
            val rig = rig()
            rig.tapIn()
            rig.engine.record(Change.Unlock("s", null))
            val unlock = rig.server.next(unlockRoute)
            rig.engine.record(Change.Refocus("s"))
            unlock.reply(200, Answer.unlocked(session(endsAt = 4000)))
            // The drain has read the unlock's answer once it sends the refocus.
            val refocus = rig.server.next(refocusRoute)
            assertEquals(inSession(ParticipationState.Focused), rig.engine.updates.value.standing)
            refocus.reply(200, Answer.refocused(session(endsAt = 5000)))
            val state = rig.until { it.queued.isEmpty() }
            assertEquals(inSession(ParticipationState.Focused, endsAt = 5000), state.standing)
        }

    @Test
    fun aTapRecordedButNoLongerCurrentOrRefusedNamesNoWindowItsLockEndsAndTheTruthIsReadAgain(): Unit =
        runBlocking {
            for ((status, body) in listOf(200 to Answer.replayNoSession, 409 to Answer.refused("session_not_running"))) {
                val rig = rig()
                rig.tapIn()
                rig.engine.record(Change.Tap("tag"))
                rig.server.next(tapRoute).reply(status, body)
                rig.server.next(meRoute).reply(200, Answer.me(null))
                val state = rig.until { it.standing == Standing.Out }
                assertNull(state.pendingTap, "$status")
                rig.stop()
            }
        }

    @Test
    fun anUnlockRecordedWithANoteNamesNoLiveSessionNoneOneOverOrNoneLeftLateOnceTheStudentHasLeftItSoTheTruthIsReadAgain(): Unit =
        runBlocking {
            for (answer in listOf(Answer.unlockKept("no_live_participation"), Answer.unlockAfterEnd(), Answer.supersededGone)) {
                val rig = rig()
                rig.tapIn()
                rig.engine.record(Change.Unlock("s", null))
                rig.server.next(unlockRoute).reply(200, answer)
                rig.server.next(meRoute).reply(200, Answer.me(null))
                rig.until { it.standing == Standing.Out && it.queued.isEmpty() }
                rig.stop()
            }
        }

    @Test
    fun theLateUnlocksAnswerTheseTestsHandWriteIsTheApisOwnAsItsFixtureRecordsIt() {
        // #119's review: recorded, superseded, no state, its session named.
        val real = fixtures("unlock").single { it.first == "recorded-superseded-gone.json" }.second.body.jsonObject
        val written = BaliJson.parseToJsonElement(Answer.supersededGone).jsonObject
        assertEquals(real.keys, written.keys)
        for (key in listOf("outcome", "recordedAs", "state", "reason")) assertEquals(real[key], written[key], key)
        assertTrue(real["session"] != JsonNull && written["session"] != JsonNull)
    }
}
