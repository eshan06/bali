package com.bali.outbox

import com.bali.core.BaliJson
import com.bali.core.ParticipationState
import com.bali.core.UnlockReason
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException

/**
 * Where the phone stands, and the form the outbox's file keeps it in: StandingKeptTests' `keptForm`,
 * UnreadUnlockTests' `filing`, and the standing's rules, which iOS's tests reach through its engine.
 */
class StandingTest : OutboxFiles() {
    private val focused = Standing.InSession(session(), ParticipationState.Focused)
    private val unlocked = Standing.InSession(session(), ParticipationState.Unlocked)

    @Test
    fun theStandingIsKeptInAFormOfItsOwnPinnedEachAsThisBuildWritesItAndAsEveryLaterBuildMustReadIt() {
        val view = session(endsAt = 1200)
        val inSession = """"standing":"in_session","sessionId":"s","classId":"c","endsAt":"2026-09-21T14:33:20.000Z""""
        val forms =
            listOf(
                Standing.Out to """{"standing":"out"}""",
                Standing.Waiting to """{"standing":"waiting"}""",
                Standing.InSession(view, ParticipationState.Focused) to """{$inSession,"state":"focused"}""",
                Standing.InSession(view, ParticipationState.Unlocked) to """{$inSession,"state":"unlocked"}""",
                Standing.InSession(view, ParticipationState.ProtectionOff) to """{$inSession,"state":"protection_off"}""",
                Standing.InSession(view, null) to "{$inSession}",
            )
        for ((standing, form) in forms) {
            assertEquals(BaliJson.parseToJsonElement(form), BaliJson.parseToJsonElement(standing.kept), form)
            assertEquals(standing, keptStanding(form), form)
        }
        // A key a later build adds is passed over, and a state it adds is none, never focus.
        assertEquals(Standing.InSession(view, null), keptStanding("""{$inSession,"state":"on_a_break","startsAt":"x"}"""))
        // Where the phone stands unread is never written over the file's truth.
        assertFailsWith<IllegalArgumentException> { Standing.Unread.kept }
    }

    @Test
    fun aKeptStandingThisBuildCannotReadThrowsNeverReadAsAnother() {
        for (text in listOf(
            "spoiled", "{}", """{"standing":"paused"}""", """{"standing":"unread"}""",
            """{"standing":"in_session","classId":"c","endsAt":"2026-09-21T14:33:20.000Z"}""",
            """{"standing":"in_session","sessionId":"s","endsAt":"2026-09-21T14:33:20.000Z"}""",
            """{"standing":"in_session","sessionId":"s","classId":"c"}""",
            """{"standing":"in_session","sessionId":"s","classId":"c","endsAt":"soon"}""",
        )) {
            assertFailsWith<SerializationException>(text) { keptStanding(text) }
        }
    }

    @Test
    fun thePhonesOwnChangeActsAtOnceOnTheSessionItIsInAnUnlockUnderATapOrNotFiledYetOnAnyATapOnNone() {
        val off = focused.copy(state = ParticipationState.ProtectionOff)
        val acts =
            listOf(
                Triple(focused, Change.Unlock("s", null), unlocked), Triple(focused, Change.Unlock("t", null), focused),
                Triple(focused, Change.UnlockUnderTap("tap", null), unlocked), Triple(focused, Change.UnlockUnfiled(null), unlocked),
                Triple(unlocked, Change.Refocus("s"), focused), Triple(unlocked, Change.Refocus("t"), unlocked),
                Triple(focused, Change.ProtectionOff("s"), off), Triple(focused, Change.ProtectionOff("t"), focused),
                // The lock back on returns to where the phone stood before protection off (#167): focused, not known.
                Triple(off, Change.ProtectionOn("s"), focused), Triple(off, Change.ProtectionOn("t"), off),
                Triple(focused, Change.Tap("tag"), focused), Triple(Standing.InSession(session(), null), Change.UnlockUnfiled(null), unlocked),
            )
        for ((standing, change, acted) in acts) assertEquals(acted, standing.acting(change), "$standing, $change")
        assertEquals(unlocked, off.acting(Change.ProtectionOn("s"), offFrom = ParticipationState.Unlocked))
        assertEquals(off, off.acting(Change.ProtectionOn("t"), offFrom = ParticipationState.Unlocked))
        // Out, waiting or unread, the phone's own change leaves it where it stands.
        for (standing in listOf(Standing.Out, Standing.Waiting, Standing.Unread)) {
            for ((_, change, _) in acts) assertEquals(standing, standing.acting(change, ParticipationState.Unlocked), "$standing, $change")
        }
        assertEquals(listOf("s", "s", null, null, null), listOf(focused, off, Standing.Out, Standing.Waiting, Standing.Unread).map { it.sessionId })
        assertTrue(focused.isFocused("s"))
        assertEquals(
            listOf(false, false, false, false),
            listOf(focused.isFocused("t"), unlocked.isFocused("s"), Standing.InSession(session(), null).isFocused("s"), Standing.Out.isFocused("s")),
        )
    }

    @Test
    fun filingInTheOutboxInTheSessionAStandingNamesNamingNoneUnderTheLastTapWithNoTapKnownNotAtAllAndUntilFiledWhereThePhoneStoodActsAsUnlocked(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            assertEquals(Standing.Out, outbox.standing())
            outbox.keep(focused)
            val first = record(outbox, Change.UnlockUnfiled(UnlockReason.Other))
            assertEquals(unlocked, outbox.standing())
            assertFalse(outbox.file(Standing.Out))
            assertEquals(Change.UnlockUnfiled(UnlockReason.Other), current(outbox, first.eventId)?.change)
            val tap = record(outbox, Change.Tap("tag"))
            assertTrue(outbox.file(Standing.Waiting))
            assertEquals(Change.UnlockUnderTap(tap.eventId, UnlockReason.Other), current(outbox, first.eventId)?.change)
            assertEquals(Standing.Waiting, outbox.standing())
            assertFalse(outbox.file(Standing.Waiting))
            val second = record(outbox, Change.UnlockUnfiled(null))
            assertTrue(outbox.file(unlocked))
            assertEquals(Change.Unlock("s", null), current(outbox, second.eventId)?.change)
            assertEquals(unlocked, outbox.standing())
        }

    @Test
    fun aStandingTheFileCannotGiveBackIsSaidNeverReadAsNoneAndRecordQueuesOverIt(): Unit =
        runBlocking {
            val (outbox, _) = makeOutbox()
            outbox.setState(Outbox.Key.Standing, "spoiled")
            assertFailsWith<SerializationException> { outbox.standing() }
            // One the file won't give back is where the phone stood before protection off: none.
            record(outbox, Change.ProtectionOff("s"))
            assertNull(outbox.offFrom())
            // Never written over by where the phone stands unread.
            assertFailsWith<IllegalArgumentException> { outbox.keep(Standing.Unread) }
            assertEquals("spoiled", outbox.state(Outbox.Key.Standing))
        }
}
