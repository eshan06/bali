package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import java.net.URI
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** [t0] as the API writes a time: a record's `deviceTime`, when the phone acted. */
private const val SENT_AT = "2026-09-21T14:13:20.000Z"

/** In session s, ending [endsAt] seconds after [t0], in [state]. */
private fun inSession(state: ParticipationState, endsAt: Long = 3000) = Standing.InSession(session(endsAt = endsAt), state)

/** The drain: the outbox, sent through the one client. BaliOutbox's DrainTests, AN5b's part. */
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
    fun a401IsSignInsTheServerHeardItNeverASignOutTheRecordKeptUncountedAndSentAgainOnceDue(): Unit =
        runBlocking {
            // A fresh token is AN5c's to ask for; none to be had, it waits out the backoff as here.
            val rig = rig(refreshWorks = false)
            val tap = assertNotNull(rig.engine.record(Change.Tap("tag")))
            rig.server.next(tapRoute).reply(401)
            val state = rig.until { it.retryAt == at(2) }
            assertEquals(listOf(Link.SignIn, t0), listOf(state.link, state.heardAt))
            assertEquals(listOf(listOf(1, 0, false)), state.queued.map { listOf(it.attempts, it.answers, it.stuck) })
            rig.clock.advance(2)
            assertEquals(tap.eventId, rig.server.next(tapRoute).eventId)
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

/** Applying answers: the phone's truth. BaliOutbox's AnswerTests, AN5b's part. */
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
}
