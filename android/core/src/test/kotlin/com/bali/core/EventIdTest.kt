package com.bali.core

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A lower-case UUIDv7, as the API checks one. */
private val uuidV7 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

/** An id's time: its first 48 bits, in milliseconds. */
private fun time(id: String): Long? = id.replace("-", "").take(12).toLongOrNull(16)

private val start = Instant.ofEpochSecond(1_790_000_000)

/**
 * Event ids: OutboxTests.swift's `eventIds`, BaliOutbox's test of BaliCore's `EventID`, and
 * LiveLessonTests.swift's EventIDAfterTests.
 */
class EventIdTest {
    @Test
    fun eventIdsNeverRepeatAndCarryTheClockToTheMillisecond() {
        val ids = (0 until 2000).map { EventId.mint(start.plusMillis(it.toLong())) }
        assertEquals(ids.size, ids.toSet().size)
        assertTrue(ids.all { uuidV7.matches(it) }, ids.filterNot { uuidV7.matches(it) }.toString())
        assertEquals(ids.map { it.take(13) }.sorted(), ids.map { it.take(13) })
        assertEquals(1_790_000_000_250, time(EventId.mint(Instant.ofEpochMilli(1_790_000_000_250))))
    }

    @Test
    fun fromAClockBehindTheIdHeldOrAtItsMillisecondTheIdSortsAfterItAMillisecondOn() {
        val held = EventId.mint(start.plusSeconds(60))
        for (now in listOf(start, start.plusSeconds(60))) {
            val id = EventId.mint(now, after = held)
            assertTrue(uuidV7.matches(id), id)
            assertTrue(id > held, "$id after $held")
            assertEquals(checkNotNull(time(held)) + 1, time(id))
        }
    }

    @Test
    fun fromAClockAheadItIsTheClocksOwnTimeAndAnIdItCannotReadIsPassedOver() {
        val held = EventId.mint(start)
        assertEquals(1_790_000_001_000, time(EventId.mint(start.plusSeconds(1), after = held)))
        assertEquals(1_790_000_000_000, time(EventId.mint(start, after = "not an id")))
        assertEquals(1_790_000_000_000, time(EventId.mint(start, after = null)))
    }
}
