package com.bali.outbox

import com.bali.core.ParticipationState
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.runBlocking

/**
 * A wait the server has dropped is Home, never Waiting (#166): the engine's half of BaliOutbox's
 * DroppedWaitTests, which screen shows AN10's.
 */
class DroppedWaitTest : EngineFiles() {
    /** Class c, its session running until 4000 s after [t0], as `GET /v1/me` names it (C3c). */
    private val inSession = """{"id":"c","name":"Class c","teacher":{"displayName":null},"liveSession":{"id":"s","endsAt":"${wire(at(4000))}"}}"""

    @Test
    fun aReadSayingNoTapOfTheStudentsWaitsItsSchoolDayOverOrTakenByAStartWhoseClassIsOverTooEndsTheWait(): Unit =
        runBlocking {
            // Home, never Waiting, and no wait said on it: AN10's.
            val rig = rig()
            rig.arm()
            rig.screenOn(Answer.me(null, classes = listOf(Answer.inClass("c")), armed = false))
            assertEquals(Standing.Out, rig.engine.updates.value.standing)
        }

    @Test
    fun aStartAfterTheTapsSchoolDayJoinsNothingTheReadNamesNoSessionAndNoTapWaitingAndTheClassInSession(): Unit =
        runBlocking {
            // Home's card, the class in session with Tap in (C3c), is AN10's: the class's session, which it reads, is here.
            val rig = rig()
            rig.arm()
            rig.screenOn(Answer.me(null, classes = listOf(Answer.inClass("c")), armed = true))
            assertEquals(Standing.Waiting, rig.engine.updates.value.standing)
            rig.clock.advance(30)
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(inSession), armed = false))
            val state = rig.until { it.standing != Standing.Waiting }
            assertEquals(Standing.Out, state.standing)
            assertEquals(at(4000), state.me?.classes?.single()?.liveSession?.endsAt)
        }

    @Test
    fun aReadNamingAClassOverByThePhonesClockTheSweepYetToRunAndNoTapWaitingIsThatClassNeverWaiting(): Unit =
        runBlocking {
            // A Start took the tap and the class has rung: Session over, AN10's (santa's round 1).
            val rig = rig()
            rig.arm()
            rig.screenOn(Answer.me(session(endsAt = -60), armed = false))
            assertEquals(Standing.InSession(session(endsAt = -60), ParticipationState.Focused), rig.engine.updates.value.standing)
        }

    @Test
    fun offlineTheWaitEndsWhereTheServerDropsTheTapTheEndOfTheDayItWasArmedByThePhonesClockAtTheNextWakeEachArmingMovesIt(): Unit =
        runBlocking {
            val rig = rig()
            rig.arm()
            // Armed again the next day: the end of that day.
            rig.clock.advance(86_400)
            rig.arm()
            val ends = assertNotNull(rig.engine.updates.value.waitEnds)
            assertEquals(SyncState.waitEnds(at(86_400), central), ends)
            rig.engine.setScreenOn(true)
            rig.server.next(meRoute).reply(null)
            rig.until { it.meFailed != null }
            rig.sleeping(at(86_430))
            // A second before it: still waiting.
            rig.clock.advance(Duration.between(rig.clock.now(), ends).minusSeconds(1))
            rig.server.next(meRoute).reply(null)
            rig.sleeping(ends.plusSeconds(29))
            assertEquals(Standing.Waiting, rig.engine.updates.value.standing)
            // Home, the screen's, is AN10's.
            rig.clock.advance(30)
            rig.until { it.standing == Standing.Out }
        }

    @Test
    fun anEndTheFileRefusesToKeepIsShownAfterTheAnswersStepNeverHiddenByItAndKeptInMemoryThePhoneWaiting(): Unit =
        runBlocking {
            // Rule 5. Armed again while waiting, where no write of the standing would say it (santa's round 2).
            val rig = rig()
            rig.arm()
            rig.outbox.execute(
                "CREATE TRIGGER refuse BEFORE INSERT ON outboxState WHEN NEW.key = 'waitEnds' BEGIN SELECT RAISE(ABORT, 'refused'); END",
            )
            rig.clock.advance(86_400)
            rig.engine.record(Change.Tap("tag"))
            rig.server.next(tapRoute).reply(200, Answer.armed)
            val state = rig.until { it.queued.isEmpty() && it.link == Link.StorageFailed }
            assertEquals(Standing.Waiting, state.standing)
            assertEquals(SyncState.waitEnds(at(86_400), central), state.waitEnds)
            assertEquals(SyncState.waitEnds(t0, central), rig.outbox.waitEnds())
        }

    @Test
    fun theEndIsKeptWithTheWaitBaliOpenedAgainPastItOfflineIsOutAndAWaitKeptWithNoEndWaitsUntilAReadEndsIt(): Unit =
        runBlocking {
            // Home, the screen's, is AN10's.
            val rig = rig()
            rig.arm()
            rig.stop()
            val relaunched = rig(rig.outbox)
            val ends = SyncState.waitEnds(t0, central)
            assertEquals(ends, relaunched.engine.updates.value.waitEnds)
            relaunched.clock.advance(Duration.between(t0, ends))
            relaunched.engine.setScreenOn(true)
            relaunched.server.next(meRoute).reply(null)
            relaunched.until { it.standing == Standing.Out }

            // A wait the file holds no end for, or none it can read (on iOS, an earlier build's): only a read ends it.
            val (earlier, _) = makeOutbox()
            earlier.keep(Standing.Waiting)
            val kept = rig(earlier)
            assertNull(kept.engine.updates.value.waitEnds)
            kept.clock.advance(7 * 86_400)
            kept.engine.setScreenOn(true)
            kept.server.next(meRoute).reply(null)
            kept.sleeping(at(7 * 86_400 + 30))
            assertEquals(Standing.Waiting, kept.engine.updates.value.standing)
            kept.clock.advance(30)
            kept.server.next(meRoute).reply(200, Answer.me(null, armed = false))
            kept.until { it.standing == Standing.Out }
        }

    @Test
    fun theEndIsTheMidnightAfterTheArmingInThePhonesOwnZoneADayAnHourShortOrAnHourLongToo() {
        // The school's, in class, as the server's armed tap ends at its zone's (decision 5).
        fun date(month: Int, day: Int, hour: Int = 0, minute: Int = 0): Instant =
            ZonedDateTime.of(2026, month, day, hour, minute, 0, 0, central).toInstant()
        // The owner's tap (#166): 7:10 PM on October 1.
        assertEquals(date(10, 2), SyncState.waitEnds(date(10, 1, 19, 10), central))
        // March 8, the clocks go forward: a day of 23 hours, ending at the next midnight, not 24 hours on.
        assertEquals(date(3, 9), SyncState.waitEnds(date(3, 8, 10), central))
        // November 1, the clocks go back: a day of 25 hours, which 24 hours on would end at 11 PM.
        assertEquals(date(11, 2), SyncState.waitEnds(date(11, 1, 10), central))
    }

    @Test
    fun eachArmingEndsItsWaitAtTheNextMidnightInTheZoneThePhoneIsInThenOnTheDayTheClocksGoBackTooNot24HoursOn(): Unit =
        runBlocking {
            // The zone the engine's clock gives at each arming, as iOS asks `Calendar.current` at each: never
            // the machine's, nor one read once.
            val rig = rig()
            // November 1, 9 AM in Chicago, the clocks gone back at 2.
            rig.clock.advance(Duration.between(t0, Instant.parse("2026-11-01T15:00:00Z")))
            rig.arm()
            // Its midnight, 25 hours after the day began: 24 on would end the wait at 11 PM.
            val chicago = Instant.parse("2026-11-02T06:00:00Z")
            assertEquals(chicago, rig.engine.updates.value.waitEnds)
            assertEquals(chicago, rig.outbox.waitEnds())
            // Taken to New York, an hour ahead, and armed again there: New York's midnight.
            rig.clock.travel(ZoneId.of("America/New_York"))
            rig.arm()
            val newYork = Instant.parse("2026-11-02T05:00:00Z")
            assertEquals(newYork, rig.engine.updates.value.waitEnds)
            assertEquals(newYork, rig.outbox.waitEnds())
        }
}

/** Waiting's Back to home, and the Start (#151): the engine's half of BaliOutbox's WaitingHomeTests, the screens' AN10's. */
class WaitingHomeTest : EngineFiles() {
    @Test
    fun baliOpenedAgainWhileWaitingStartsWaitingAndTheReadEvery30SWhileTheScreenIsOnFindsTheStartThePhoneInTheSession(): Unit =
        runBlocking {
            // Where the phone stands is kept in the file, and nothing the student opened is: the Home opened
            // over Waiting is no input of the engine's (#151). Which screen shows, and that Home closed, AN10's.
            val rig = rig()
            rig.arm()
            rig.stop()
            val relaunched = rig(rig.outbox)
            assertEquals(Standing.Waiting, relaunched.engine.updates.value.standing)
            relaunched.screenOn(Answer.me(null))
            relaunched.clock.advance(30)
            relaunched.server.next(meRoute).reply(200, Answer.me(session(endsAt = 4000)))
            val started = relaunched.until { it.standing != Standing.Waiting }
            assertEquals(Standing.InSession(session(endsAt = 4000), ParticipationState.Focused), started.standing)
        }
}
