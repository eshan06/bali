package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.HistoryEventType
import com.bali.core.HistoryPage
import com.bali.core.OrUnknown
import com.bali.core.SendResult
import com.bali.core.UnlockReason
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.chrono.HijrahChronology
import java.time.chrono.HijrahDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoField
import java.util.Locale
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking

// The History screen's rules (C6a), over A7's fixtures: BaliOutbox's HistoryTests, the moments, the failures and the day titles
// as types, and their words (AN10h): iOS's word for word, but the lock's two kinds and its note, Android's (the Words board), on
// a US phone in New York, never the PC's zone or locale. New: days across a daylight-saving change, both ways, their titles too;
// the cursor each read sends; what packages/shared lists, each kind and reason a moment; a deleted sign-in's 409 (C3d); Show
// earlier's other failures, said in its place; a read with no engine started; which kind says a reason or a class; and a date's
// year judged in the calendar its pattern writes in. And a page through the engine (C6a): HistoryEngineTests.

/** A US phone's zone; [t0] there is Monday, September 21, 2026, 10:13:20 AM. */
private val ny: ZoneId = ZoneId.of("America/New_York")

/** How a US phone writes a day's date this year: Android's `getBestDateTimePattern` for en_US's weekday, month and day (Q6). */
val usDate: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US)

/** How a US phone writes a day's date in another year: the same, with its year (Q6). */
val usDateWithYear: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEE, MMMM d, y", Locale.US)

private val unreachable = History.Failure.NotRead(SendResult.NetworkError, null)

/** Each class a moment is in: 3 and 4 with Ms. Rivera, 5 with Mr. Okafor, 6 with a teacher who has no name. */
private val names = mapOf(3 to "Period 3 Algebra II", 4 to "Period 4 Statistics", 5 to "Period 5 Chemistry", 6 to "Period 6 Geometry")
private val teachers = mapOf(3 to "\"Ms. Rivera\"", 4 to "\"Ms. Rivera\"", 5 to "\"Mr. Okafor\"", 6 to "null")

/** A moment as `GET /v1/me/history` writes one: [type] at [time] (UTC), in Period [period]. BaliOutbox's HistoryTests' `moment`. */
private fun moment(type: String, time: String, period: Int = 3, reason: String? = null, recordedAs: String? = null, countedIn: Int? = null): String {
    fun quoted(text: String?) = text?.let { "\"$it\"" } ?: "null"
    val counted = countedIn?.let { """{"id":"p$it","name":"${names.getValue(it)}"}""" } ?: "null"
    return """{"eventId":"${UUID.randomUUID()}","type":"$type","occurredAt":"$time",""" +
        """"class":{"id":"p$period","name":"${names.getValue(period)}"},"teacher":{"displayName":${teachers.getValue(period)}},""" +
        """"session":null,"reason":${quoted(reason)},"recordedAs":${quoted(recordedAs)},"countedIn":$counted}"""
}

/** [response] answered: the next, never a read again from the top. */
private fun History.page(response: ApiResponse<HistoryPage>): History = answered(response).let { (next, again) -> next.also { assertFalse(again) } }

/** The screen with [moments] read from the top, newest first as the server gives them, and nothing after: HistoryTests' `read`. */
private suspend fun read(vararg moments: String): History =
    History().reading(more = false)!!.page(client(Canned(200, """{"events":[${moments.joinToString(",")}],"nextBefore":null}""")).history())

/**
 * What the screen will draw, as types: each day's title; each card's class and teacher; and each moment's time on the phone's
 * clock there, its kind, an unlock's reason, the class a declined tap counted in, and its note. HistoryTests' `drawn`.
 */
private fun drawn(days: List<History.Day>): List<String> =
    days.flatMap { day ->
        listOf(day.title.toString()) +
            day.cards.flatMap { card ->
                listOf("[${card.name} / ${card.teacher ?: "-"}]") +
                    card.moments.map { moment ->
                        val time = "%02d:%02d".format(Locale.ROOT, moment.at.hour, moment.at.minute)
                        listOfNotNull(time, moment.kind, moment.reason, moment.countedIn, moment.note?.let { "($it)" }).joinToString(" ")
                    }
            }
    }

/**
 * What the screen will say, on a US phone at [now] in [zone]: each day's title; each card's class and teacher; and each
 * moment's time and line, its note after it. HistoryTests' `drawn`, its times read through [plain].
 */
private fun said(days: List<History.Day>, now: Instant = t0, zone: ZoneId = ny): List<String> =
    days.flatMap { day ->
        listOf(day.title.words(now, zone, usDate, usDateWithYear)) +
            day.cards.flatMap { card ->
                listOf("[${card.name} · ${card.teacher ?: "-"}]") +
                    card.moments.map { moment -> plain("${moment.time(usShortTime)} ${moment.words}")!! + (moment.note?.let { " (${it.words})" } ?: "") }
            }
    }

/** A moment of [kind] at [t0] in New York, with [reason], a class it [countedIn] and [note]. */
private fun line(kind: HistoryEventType, reason: UnlockReason? = null, countedIn: String? = null, note: History.Note? = null) =
    History.Moment("e", kind, t0.atZone(ny), reason, countedIn, note)

/** Every moment of the day, card after card. */
private fun History.Day.moments() = cards.flatMap { it.moments }

/** `@bali/shared`'s list [name] in `index.ts`, read in place (`bali.shared`), as core's VocabularyTest reads them. */
private fun shared(name: String): List<String> {
    val folder = checkNotNull(System.getProperty("bali.shared")) { "bali.shared is unset: run the tests through Gradle (android/README.md)" }
    val source = File(folder).resolve("index.ts").readText()
    val opening = "export const $name = ["
    check(opening in source) { "no $name" }
    val list = source.substringAfter(opening).substringBefore("]").lines().joinToString("\n") { it.substringBefore("//") }
    return Regex("'([^']*)'").findAll(list).map { it.groupValues[1] }.toList()
}

/** The History screen's rules (C6a): BaliOutbox's HistoryTests. */
class HistoryTest {
    @Test
    fun daysNewestFirstTodayYesterdayThenTheDateEachOldestFirstInCardsOfOneClassesMomentsInARowTheDayAndTheTimeInThePhonesZoneSoAMomentLateAtNightInNewYorkIsYesterdayThereAndTodayInUtc(): Unit =
        runBlocking {
            // New: Ms. Rivera's next class, Period 4, right after Period 3: a card of its own.
            val history =
                read(
                    moment("tap_in", "2026-09-21T14:00:00Z", period = 4),
                    moment("session_expired", "2026-09-21T13:45:00Z"),
                    moment("refocus", "2026-09-21T13:16:00Z"),
                    moment("unlock", "2026-09-21T13:12:00Z", reason = "bathroom"),
                    moment("tap_in", "2026-09-21T12:58:00Z"),
                    moment("enrollment_left", "2026-09-21T02:30:00Z"),
                    moment("armed_tap_skipped", "2026-09-20T18:48:00Z", period = 6, countedIn = 5),
                    moment("session_ended", "2026-09-20T17:50:00Z", period = 5),
                    moment("tap_in", "2026-09-20T17:02:00Z", period = 5),
                    moment("tap_in", "2026-09-16T15:00:00Z", period = 5),
                    moment("tap_in", "2025-12-15T14:00:00Z"),
                )
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II / Ms. Rivera]", "08:58 TapIn", "09:12 Unlock Bathroom", "09:16 Refocus",
                    "09:45 SessionExpired", "[Period 4 Statistics / Ms. Rivera]", "10:00 TapIn", "Yesterday",
                    "[Period 5 Chemistry / Mr. Okafor]", "13:02 TapIn", "13:50 SessionEnded",
                    "[Period 6 Geometry / -]", "14:48 ArmedTapSkipped Period 5 Chemistry", "[Period 3 Algebra II / Ms. Rivera]",
                    "22:30 EnrollmentLeft", "On(date=2026-09-16)", "[Period 5 Chemistry / Mr. Okafor]", "11:00 TapIn",
                    "On(date=2025-12-15)", "[Period 3 Algebra II / Ms. Rivera]", "09:00 TapIn",
                ),
                drawn(history.days(t0, ny)),
            )
            // As the screen says it: the date with its year once that isn't this one (Q6's patterns, a US phone's).
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II · Ms. Rivera]", "8:58 AM Tapped in", "9:12 AM Unlocked · Bathroom", "9:16 AM Locked apps again",
                    "9:45 AM Class ended", "[Period 4 Statistics · Ms. Rivera]", "10:00 AM Tapped in", "Yesterday",
                    "[Period 5 Chemistry · Mr. Okafor]", "1:02 PM Tapped in", "1:50 PM Class ended", "[Period 6 Geometry · -]",
                    "2:48 PM Tap not used. It already counted in Period 5 Chemistry.", "[Period 3 Algebra II · Ms. Rivera]",
                    "10:30 PM Left the class", "Wednesday, September 16", "[Period 5 Chemistry · Mr. Okafor]", "11:00 AM Tapped in",
                    "Monday, December 15, 2025", "[Period 3 Algebra II · Ms. Rivera]", "9:00 AM Tapped in",
                ),
                said(history.days(t0, ny)),
            )
            val utc = history.days(t0, ZoneOffset.UTC)
            assertEquals(
                listOf(History.Title.Today, History.Title.Yesterday, History.Title.On(LocalDate.of(2026, 9, 16)), History.Title.On(LocalDate.of(2025, 12, 15))),
                utc.map { it.title },
            )
            assertEquals(listOf("Today", "[Period 3 Algebra II / Ms. Rivera]", "02:30 EnrollmentLeft"), drawn(utc.take(1)).take(3))
            assertEquals(
                listOf("Today", "Yesterday", "Wednesday, September 16", "Monday, December 15, 2025"),
                utc.map { it.title.words(t0, ZoneOffset.UTC, usDate, usDateWithYear) },
            )
            assertEquals(listOf("Today", "[Period 3 Algebra II · Ms. Rivera]", "2:30 AM Left the class"), said(utc.take(1), zone = ZoneOffset.UTC).take(3))
            // Just after midnight, yesterday's moments are two days back, named by their date.
            val tomorrow = t0.plusSeconds(14 * 3600)
            assertEquals(listOf(History.Title.Yesterday, History.Title.On(LocalDate.of(2026, 9, 20))), history.days(tomorrow, ny).map { it.title }.take(2))
            assertEquals(listOf("Yesterday", "Sunday, September 20"), history.days(tomorrow, ny).take(2).map { it.title.words(tomorrow, ny, usDate, usDateWithYear) })
        }

    @Test
    fun aDayIsThePhonesWholeDayIn25HoursOr23AtADaylightSavingChangeItsTimesThereWithTheirOffsetAndTodayAndYesterdayByItsCalendarNever24HoursBack(): Unit =
        runBlocking {
            // New York falls back on Sunday, November 1, 2026 (1:30 AM comes twice), and springs forward on Sunday, March 8.
            val fall =
                read(
                    moment("tap_in", "2026-11-02T05:30:00Z"),
                    moment("session_ended", "2026-11-02T04:30:00Z"),
                    moment("refocus", "2026-11-01T06:30:00Z"),
                    moment("unlock", "2026-11-01T05:30:00Z"),
                    moment("tap_in", "2026-11-01T04:30:00Z"),
                    moment("tap_in", "2026-11-01T03:30:00Z"),
                )
            val days = fall.days(Instant.parse("2026-11-02T15:00:00Z"), ny)
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II / Ms. Rivera]", "00:30 TapIn", "Yesterday", "[Period 3 Algebra II / Ms. Rivera]",
                    "00:30 TapIn", "01:30 Unlock", "01:30 Refocus", "23:30 SessionEnded", "On(date=2026-10-31)",
                    "[Period 3 Algebra II / Ms. Rivera]", "23:30 TapIn",
                ),
                drawn(days),
            )
            assertEquals(listOf("-04:00", "-04:00", "-05:00", "-05:00"), days[1].moments().map { it.at.offset.id })
            // As the screen says it: 1:30 AM twice, its clock's, and the day before yesterday by its date (Q6).
            val now = Instant.parse("2026-11-02T15:00:00Z")
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II · Ms. Rivera]", "12:30 AM Tapped in", "Yesterday", "[Period 3 Algebra II · Ms. Rivera]",
                    "12:30 AM Tapped in", "1:30 AM Unlocked", "1:30 AM Locked apps again", "11:30 PM Class ended", "Saturday, October 31",
                    "[Period 3 Algebra II · Ms. Rivera]", "11:30 PM Tapped in",
                ),
                said(days, now),
            )
            // Each card known by its day's own start there: midnight, 25 hours apart.
            assertEquals(listOf("1793595600-p3-0", "1793505600-p3-0", "1793419200-p3-0"), days.flatMap { it.cards }.map { it.id })
            val spring =
                read(
                    moment("tap_in", "2026-03-09T04:15:00Z"),
                    moment("tap_in", "2026-03-08T07:30:00Z"),
                    moment("tap_in", "2026-03-08T05:30:00Z"),
                    moment("tap_in", "2026-03-08T04:30:00Z"),
                )
            val short = spring.days(Instant.parse("2026-03-09T04:30:00Z"), ny)
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II / Ms. Rivera]", "00:15 TapIn", "Yesterday", "[Period 3 Algebra II / Ms. Rivera]",
                    "00:30 TapIn", "03:30 TapIn", "On(date=2026-03-07)", "[Period 3 Algebra II / Ms. Rivera]", "23:30 TapIn",
                ),
                drawn(short),
            )
            // Just after midnight, the 23-hour day is yesterday, and the day before it by its date.
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II · Ms. Rivera]", "12:15 AM Tapped in", "Yesterday", "[Period 3 Algebra II · Ms. Rivera]",
                    "12:30 AM Tapped in", "3:30 AM Tapped in", "Saturday, March 7", "[Period 3 Algebra II · Ms. Rivera]", "11:30 PM Tapped in",
                ),
                said(short, Instant.parse("2026-03-09T04:30:00Z")),
            )
            assertEquals(listOf("1773028800-p3-0", "1772946000-p3-0"), short.take(2).flatMap { it.cards }.map { it.id })
        }

    @Test
    fun eachCardIsKnownByItsDayItsClassAndHowManyOfThatClassesCardsComeAfterItThatDaySoANewerMomentReadFromTheTopOrAnOlderOneFromShowEarlierJoinsItUnderTheSameId(): Unit =
        runBlocking {
            // So the screen keeps each card as it is (#139), and the one the student scrolled to stays (F5's review).
            val moments =
                listOf(
                    moment("unlock", "2026-09-21T13:12:00Z", reason = "bathroom"),
                    moment("tap_in", "2026-09-21T12:58:00Z"),
                    moment("session_ended", "2026-09-20T17:50:00Z", period = 5),
                    moment("tap_in", "2026-09-20T17:02:00Z", period = 5),
                    moment("tap_in", "2026-09-20T15:00:00Z"),
                )

            suspend fun cards(moments: List<String>) = read(*moments.toTypedArray()).days(t0, ny).flatMap { it.cards }
            val shown = cards(moments)
            assertEquals(3, shown.map { it.id }.toSet().size)
            val refocus = moment("refocus", "2026-09-21T13:16:00Z")
            val joined = cards(listOf(refocus) + moments)
            assertEquals(shown.map { it.id }, joined.map { it.id })
            assertEquals(3, joined[0].moments.size)
            val after = cards(listOf(moment("tap_in", "2026-09-21T13:20:00Z", period = 5), refocus) + moments)
            assertEquals(listOf<Any>(4, "Period 5 Chemistry"), listOf(after.size, after[1].name))
            assertEquals(listOf(shown[0].id, after[1].id) + shown.drop(1).map { it.id }, after.map { it.id })
            assertEquals(4, after.map { it.id }.toSet().size)
            // Show earlier: yesterday's Period 3 an hour earlier, at the top of yesterday's first card.
            val earlier = cards(moments + moment("tap_in", "2026-09-20T14:00:00Z"))
            assertEquals(shown.map { it.id }, earlier.map { it.id })
            assertEquals(2, earlier[1].moments.size)
        }

    @Test
    fun everyKindOfMomentA7ShowsThePageReversedNeverReSortedInACardPerClassInARowATeacherWithNoNameNoneANoteWhereTheRecordChangedNothingEachKindAndReasonSharedListsAMoment(): Unit =
        runBlocking {
            // A switch's leave comes before the tap it caused, though the two share one instant.
            val history = History().page(fixture("history/every-kind.json").history())
            val days = history.days(t0, ny)
            assertEquals(listOf<History.Title>(History.Title.On(LocalDate.of(1999, 12, 31))), days.map { it.title })
            assertEquals(
                listOf(
                    "[Class fx-hist-p3 / Ms. Rivera]", "19:25 TapIn", "19:24 Unlock Bathroom", "19:23 Refocus", "19:22 ProtectionOff",
                    "19:21 ProtectionOn", "19:20 TapIn", "19:19 ProtectionOff (AfterSessionEnd)", "19:17 SessionExpired",
                    "19:17 Unlock (AfterSessionEnd)", "[Class fx-hist-p5 / Mr. Okafor]", "19:16 TapIn", "19:15 Refocus (Superseded)",
                    "19:14 Unlock", "19:13 TapIn (Superseded)", "19:12 LeftForOtherSession", "[Class fx-hist-p6 / -]", "19:12 TapIn",
                    "19:09 SessionEnded", "[Class fx-hist-p3 / Ms. Rivera]", "19:08 TapIn", "[Class fx-hist-p6 / -]",
                    "19:07 ArmedTapSkipped Class fx-hist-p3", "[Class fx-hist-p3 / Ms. Rivera]", "19:05 EnrollmentRemoved",
                    "[Class fx-hist-p5 / Mr. Okafor]", "19:04 TapIn", "19:02 EnrollmentRemoved", "[Class fx-hist-p6 / -]",
                    "19:01 EnrollmentLeft",
                ),
                drawn(days).drop(1),
            )
            // In D1's words, iOS's, but the lock's own, the Words board's, where the iPhone names Screen Time.
            assertEquals(
                listOf(
                    "Friday, December 31, 1999", "[Class fx-hist-p3 · Ms. Rivera]", "7:25 PM Tapped in", "7:24 PM Unlocked · Bathroom",
                    "7:23 PM Locked apps again", "7:22 PM Lock off", "7:21 PM Lock back on", "7:20 PM Tapped in",
                    "7:19 PM Lock off (Arrived after class ended)", "7:17 PM Class ended", "7:17 PM Unlocked (Arrived after class ended)",
                    "[Class fx-hist-p5 · Mr. Okafor]", "7:16 PM Tapped in", "7:15 PM Locked apps again (Arrived late, so it changed nothing)",
                    "7:14 PM Unlocked", "7:13 PM Tapped in (Arrived late, so it changed nothing)", "7:12 PM Switched to another class",
                    "[Class fx-hist-p6 · -]", "7:12 PM Tapped in", "7:09 PM Class ended", "[Class fx-hist-p3 · Ms. Rivera]", "7:08 PM Tapped in",
                    "[Class fx-hist-p6 · -]", "7:07 PM Tap not used. It already counted in Class fx-hist-p3.", "[Class fx-hist-p3 · Ms. Rivera]",
                    "7:05 PM Removed from the class", "[Class fx-hist-p5 · Mr. Okafor]", "7:04 PM Tapped in", "7:02 PM Removed from the class",
                    "[Class fx-hist-p6 · -]", "7:01 PM Left the class",
                ),
                said(days),
            )
            // Each kind @bali/shared's history shows a moment of its own, and each reason an unlock gives that unlock's.
            assertEquals(shared("HISTORY_EVENT_TYPES").toSet(), days.single().moments().map { it.kind.wire }.toSet())
            val reasons = shared("UNLOCK_REASONS")
            val unlocks = read(*reasons.map { moment("unlock", "2026-09-21T13:00:00Z", reason = it) }.toTypedArray())
            assertEquals(reasons.reversed(), unlocks.days(t0, ny).single().moments().map { it.reason?.wire })
            // Each said by its name capitalized, as iOS's `capitalized` says the three.
            assertEquals(
                reasons.reversed().map { "Unlocked · ${it.replaceFirstChar(Char::uppercaseChar)}" },
                unlocks.days(t0, ny).single().moments().map { it.words },
            )
        }

    @Test
    fun whatThisBuildDoesntKnowStaysAsItCameNeverACrashOrADroppedPageAKindIsLeftOutOfTheDaysItsCardWithItAReasonOrANoteIsNoneADeclinedTapsUnnamedClassNone(): Unit =
        runBlocking {
            // `/v1` is additive-only: a newer server's kind, reason or note, each typed as unknown where the page keeps it.
            val history =
                read(
                    moment("went_to_mars", "2026-09-21T13:30:00Z", period = 5),
                    moment("unlock", "2026-09-21T13:20:00Z", reason = "dentist", recordedAs = "moonlit"),
                    moment("unlock", "2026-09-21T13:16:00Z", recordedAs = "no_live_participation"),
                    moment("unlock", "2026-09-21T13:14:00Z", reason = "nurse", recordedAs = "protection_off"),
                    moment("armed_tap_skipped", "2026-09-21T13:12:00Z"),
                )
            assertEquals(5, history.events.size)
            assertEquals(
                listOf(OrUnknown.Unknown("went_to_mars"), OrUnknown.Unknown("dentist"), OrUnknown.Unknown("moonlit")),
                listOf(history.events[0].type, history.events[1].reason, history.events[1].recordedAs),
            )
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II / Ms. Rivera]", "09:12 ArmedTapSkipped", "09:14 Unlock Nurse (ProtectionOff)",
                    "09:16 Unlock (NoLiveParticipation)", "09:20 Unlock",
                ),
                drawn(history.days(t0, ny)),
            )
            // Said as nothing, and a declined tap's class not named, another class.
            assertEquals(
                listOf(
                    "Today", "[Period 3 Algebra II · Ms. Rivera]", "9:12 AM Tap not used. It already counted in another class.",
                    "9:14 AM Unlocked · Nurse (The lock was off at the time)", "9:16 AM Unlocked (Arrived after you left this class)",
                    "9:20 AM Unlocked",
                ),
                said(history.days(t0, ny)),
            )
            // An unlock kept with no class is never in a class's history: its notes, any it came with, say nothing.
            val kept = shared("UNLOCK_RECORDED_AS") - listOf("after_session_end", "superseded", "no_live_participation", "protection_off")
            val notes = read(*kept.map { moment("unlock", "2026-09-21T13:00:00Z", recordedAs = it) }.toTypedArray())
            assertEquals(List(kept.size) { null }, notes.days(t0, ny).single().moments().map { it.note })
        }

    @Test
    fun pagesTheFirstFromTheTopWithNoCursorShowEarliersAfterItWithTheLastPagesEachMomentOnceNoneAtTheEndAFailedPageKeepsWhatWasReadSaidInItsOwnPlace(): Unit =
        runBlocking {
            var history = History()
            assertEquals(listOf<Any?>(false, emptyList<History.Day>(), true), listOf(history.read, history.days(t0, ny), history.fromTop))
            // Show earlier with no page after those read starts nothing, and one read at a time.
            assertNull(history.reading(more = true))
            history = history.reading(more = false)!!
            assertEquals(listOf<Any?>(true, true, null), listOf(history.busy, history.fromTop, history.before))
            assertEquals(listOf(null, null), listOf(history.reading(more = false), history.reading(more = true)))
            history = history.page(fixture("history/first-page.json").history())
            assertEquals(listOf<Any?>(true, false, 3), listOf(history.read, history.busy, history.events.size))
            assertEquals("00000000-0000-7000-8000-000000000006", history.nextBefore)
            history = history.reading(more = true)!!
            assertEquals(listOf<Any?>(true, false, "00000000-0000-7000-8000-000000000006"), listOf(history.busy, history.fromTop, history.before))
            // Beside Show earlier's under way, a read from the top goes ahead of it (#141), and nothing else goes.
            assertNull(history.reading(more = true))
            val ahead = history.reading(more = false)
            assertEquals(listOf<Any?>(true, true, null, 3), listOf(ahead?.busy, ahead?.fromTop, ahead?.before, ahead?.events?.size))
            history = history.page(fixture("history/first-page.json").history())
            assertEquals(3, history.events.size)
            history = history.page(client(Canned(null)).history(history.before))
            assertEquals(listOf<Any?>(3, true, unreachable), listOf(history.events.size, history.read, history.failure))
            assertEquals("Can't reach the server. Check your connection and try again.", history.failure?.words)
            // Show earlier's own: said where it was pressed, never above the moments as not updated.
            assertNull(history.notUpdated)
            history = history.page(fixture("history/next-page.json").history())
            assertEquals(listOf("01", "03", "06", "02", "05", "08"), history.events.map { it.eventId.takeLast(2) })
            assertEquals(listOf<Any?>(null, "00000000-0000-7000-8000-000000000008"), listOf(history.failure, history.nextBefore))
            history = history.page(fixture("history/empty.json").history())
            assertEquals(listOf<Any?>(6, null), listOf(history.events.size, history.nextBefore))
            // At the end: Show earlier sends nothing, where a read with no cursor would put the newest page after the oldest.
            assertNull(history.reading(more = true))
        }

    @Test
    fun readAgainFromTheTopWithNoCursorTheMomentsReadStayTillItsPageTakesTheirPlaceAFailureSaidAboveThemAsNotUpdatedThroughShowEarliersPagesUntilATopReadAnswers(): Unit =
        runBlocking {
            // #141; F4's review: the card's Try again saying it is reading, beside the words, is AN10's and AS7's.
            var history = History().page(fixture("history/first-page.json").history())
            history = history.reading(more = true)!!.page(fixture("history/next-page.json").history())
            assertEquals(listOf<Any?>(6, null), listOf(history.events.size, history.notUpdated))
            history = history.reading(more = false)!!
            assertEquals(listOf<Any?>(6, true, true, null), listOf(history.events.size, history.read, history.busy, history.before))
            history = history.page(client(Canned(null)).history())
            assertEquals(listOf<Any?>(6, true, false), listOf(history.events.size, history.read, history.busy))
            assertEquals("00000000-0000-7000-8000-000000000008", history.nextBefore)
            assertEquals(listOf<Any?>(unreachable, null), listOf(history.notUpdated, history.failure))
            val notUpdated = "Bali couldn't update your history. Can't reach the server. Check your connection and try again."
            assertEquals(notUpdated, history.notUpdated?.notUpdatedWords)
            // Show earlier meanwhile: its own failure in its place, and the newest still not read.
            history = history.reading(more = true)!!
            history = history.page(client(Canned(null)).history(history.before))
            assertEquals(listOf<Any?>(unreachable, unreachable), listOf(history.notUpdated, history.failure))
            history = history.reading(more = true)!!.page(fixture("history/empty.json").history())
            assertEquals(listOf<Any?>(unreachable, null, null), listOf(history.notUpdated, history.failure, history.nextBefore))
            // Try again from the top: what went wrong stays said while it reads, then why this one didn't finish.
            history = history.reading(more = false)!!
            assertEquals(listOf<Any?>(unreachable, true, true, 6), listOf(history.notUpdated, history.busy, history.fromTop, history.events.size))
            assertEquals(notUpdated, history.notUpdated?.notUpdatedWords)
            history = history.page(fixture("history/401-unauthorized.json").history())
            assertEquals(listOf<Any?>(History.Failure.NotRead(SendResult.Status(401), null), false, 6), listOf(history.notUpdated, history.busy, history.events.size))
            // A sign-in Bali couldn't check, in one sentence, never "Bali couldn't" twice.
            assertEquals("Bali couldn't check your sign-in to update your history. Try again.", history.notUpdated?.notUpdatedWords)
            // Again: its page leaves none.
            history = history.reading(more = false)!!.page(fixture("history/first-page.json").history())
            assertEquals(listOf<Any?>(3, null, null, true), listOf(history.events.size, history.failure, history.notUpdated, history.read))
            assertEquals("00000000-0000-7000-8000-000000000006", history.nextBefore)
        }

    @Test
    fun aReadThatGaveNoPageIsItsResultAndReasonA409AccountDeletedTooShowEarliersUnknownCursorIsReadAgainFromTheTopItsOtherFailuresAndATopReadsSaidInTheirPlace(): Unit =
        runBlocking {
            // A teacher's account is 403, a client's bug 400 invalid_request: each said keyed on the status, Join's words but a
            // teacher's account's own, each whole line pinned, so a change to Join's shows here too.
            var history = History().page(fixture("history/401-unauthorized.json").history())
            assertEquals(listOf<Any?>(History.Failure.NotRead(SendResult.Status(401), null), false), listOf(history.failure, history.read))
            assertEquals("Bali couldn't check your sign-in. Try again.", history.failure?.words)
            for ((status, words) in
                listOf(
                    403 to "This is a teacher's account, and History is only for students.",
                    429 to "Too many tries for now. Wait a minute, then try again.",
                    500 to "Something went wrong at Bali. Try again in a moment.",
                )) {
                history = history.page(client(Canned(status)).history())
                assertEquals<Any?>(History.Failure.NotRead(SendResult.Status(status), null), history.failure, "$status")
                assertEquals(words, history.failure?.words, "$status")
            }
            // A deleted sign-in's 409 kept as any 409 (C3d): the phone reads it as signed out since AN9j, so no screen says it.
            history = history.page(client(Canned(409, Answer.refused("account_deleted"))).history())
            assertEquals<Any?>(History.Failure.NotRead(SendResult.Status(409), ApiErrorReason.AccountDeleted), history.failure)
            assertEquals("Something went wrong at Bali. Try again in a moment.", history.failure?.words)
            history = history.page(fixture("history/400-bad-limit.json").history())
            assertEquals<Any?>(History.Failure.NotRead(SendResult.Status(400), ApiErrorReason.InvalidRequest), history.failure)
            assertEquals("Something went wrong at Bali. Try again in a moment.", history.failure?.words)
            history = history.page(fixture("history/first-page.json").history()).reading(more = true)!!
            val (unknown, readAgain) = history.answered(fixture("history/400-bad-cursor.json").history())
            assertTrue(readAgain)
            assertEquals(listOf<Any?>(3, true, false, null, null), listOf(unknown.events.size, unknown.read, unknown.busy, unknown.failure, unknown.notUpdated))
            // Show earlier's other failures stay in its place, where a Try again may answer.
            val failed = history.page(client(Canned(500)).history(history.before))
            assertEquals(listOf<Any?>(History.Failure.NotRead(SendResult.Status(500), null), null, 3), listOf(failed.failure, failed.notUpdated, failed.events.size))
            // A read from the top, no cursor sent, answered so is said, never read again: that would be refused again, forever
            // (C6a-2's review), over the moments read or over nothing.
            val cursor = History.Failure.NotRead(SendResult.Status(400), ApiErrorReason.UnknownCursor)
            val top = unknown.reading(more = false)!!.page(fixture("history/400-bad-cursor.json").history())
            assertEquals(listOf<Any?>(3, cursor, null, false), listOf(top.events.size, top.notUpdated, top.failure, top.busy))
            assertEquals("Bali couldn't update your history. Something went wrong at Bali. Try again in a moment.", top.notUpdated?.notUpdatedWords)
            val none = History().reading(more = false)!!.page(fixture("history/400-bad-cursor.json").history())
            assertEquals(listOf<Any?>(cursor, false, false, null), listOf(none.failure, none.read, none.busy, none.notUpdated))
            assertEquals("Something went wrong at Bali. Try again in a moment.", none.failure?.words)
        }

    @Test
    fun aReadWithNoEngineStartedSendsNothingAndSaysBaliIsStillStartingWhereThatReadsFailureWouldBeNothingBusy(): Unit =
        runBlocking {
            // The app's to give, asked before `reading` (BaliApp.swift's `readHistory`): nothing read, in the moments' place.
            val fresh = History().notStarted(more = false)
            assertEquals(listOf<Any?>(History.Failure.NotStarted, null, false, false), listOf(fresh?.failure, fresh?.notUpdated, fresh?.busy, fresh?.read))
            assertEquals("Bali is still starting. Try again in a moment.", fresh?.failure?.words)
            // Over the moments read, from the top: above them, as not updated, the moments kept.
            val read = History().page(fixture("history/first-page.json").history())
            val top = read.notStarted(more = false)
            assertEquals(listOf<Any?>(null, History.Failure.NotStarted, false, 3), listOf(top?.failure, top?.notUpdated, top?.busy, top?.events?.size))
            assertEquals("Bali couldn't update your history. Bali is still starting. Try again in a moment.", top?.notUpdated?.notUpdatedWords)
            // Show earlier's, in its place.
            val more = read.notStarted(more = true)
            assertEquals(listOf<Any?>(History.Failure.NotStarted, null, false), listOf(more?.failure, more?.notUpdated, more?.busy))
            // None where no read would start: Show earlier with no page after those read, or beside a read under way.
            assertEquals(listOf(null, null), listOf(History().notStarted(more = true), read.reading(more = true)?.notStarted(more = true)))
        }

    @Test
    fun theLocksTwoKindsAndItsNoteSayAndroidsWordsLockOffLockBackOnAndTheLockWasOffAtTheTimeWhereTheIphoneNamesScreenTime() {
        // The Words board's three History rows, for the ruled "Screen Time off", "Screen Time back on" and "Screen Time was off
        // at the time"; AS7's History board draws the first two.
        assertEquals(
            listOf("Lock off", "Lock back on", "The lock was off at the time"),
            listOf(line(HistoryEventType.ProtectionOff).words, line(HistoryEventType.ProtectionOn).words, History.Note.ProtectionOff.words),
        )
        assertEquals(
            listOf("Arrived after class ended", "Arrived late, so it changed nothing", "Arrived after you left this class", "The lock was off at the time"),
            History.Note.entries.map { it.words },
        )
    }

    @Test
    fun aReasonShowsOnAnUnlockAloneAndTheClassATapAlreadyCountedInOnADeclinedTapAloneEveryKindGivenBothAndNeither() {
        // The server names neither elsewhere (A7), but a kind given both says them only where iOS's words do.
        for (kind in HistoryEventType.entries) {
            val both = line(kind, UnlockReason.Nurse, "Period 5 Chemistry").words
            val neither = line(kind).words
            when (kind) {
                HistoryEventType.Unlock -> assertEquals("Unlocked · Nurse" to "Unlocked", both to neither)
                HistoryEventType.ArmedTapSkipped ->
                    assertEquals("Tap not used. It already counted in Period 5 Chemistry." to "Tap not used. It already counted in another class.", both to neither)
                else -> assertEquals(neither, both, "$kind")
            }
            assertFalse(kind != HistoryEventType.Unlock && "Nurse" in both, "$kind says a reason: $both")
            assertFalse(kind != HistoryEventType.ArmedTapSkipped && "Period 5" in both, "$kind says a class: $both")
        }
    }

    @Test
    fun acrossTheYearsMidnightInThePhonesZoneADecemberDateGainsItsYearNeverByUtcWhereNewYearsComesFiveHoursEarlier(): Unit =
        runBlocking {
            val december = read(moment("tap_in", "2026-12-31T15:00:00Z"), moment("tap_in", "2026-12-30T15:00:00Z"), moment("tap_in", "2026-12-20T15:00:00Z"))
            // At 8 PM on New Year's Eve in New York, already 2027 in UTC: the dates are this year's.
            val eve = Instant.parse("2027-01-01T01:00:00Z")
            assertEquals(listOf("Today", "Yesterday", "Sunday, December 20"), december.days(eve, ny).map { it.title.words(eve, ny, usDate, usDateWithYear) })
            // A minute after midnight there: yesterday, then last year's, with the year.
            val after = Instant.parse("2027-01-01T05:01:00Z")
            assertEquals(
                listOf("Yesterday", "Wednesday, December 30, 2026", "Sunday, December 20, 2026"),
                december.days(after, ny).map { it.title.words(after, ny, usDate, usDateWithYear) },
            )
        }

    @Test
    fun aDatesYearIsJudgedAsWrittenInTheCalendarItsPatternWritesInTheIsoCalendarWhereItNamesNone() {
        // January 15, 2026 is this year by the ISO calendar at t0, and last year by the Hijri one, which t0 is a year into.
        val january = LocalDate.of(2026, 1, 15)
        assertEquals(listOf(1447, 1448), listOf(january, t0.atZone(ny).toLocalDate()).map { HijrahDate.from(it).get(ChronoField.YEAR_OF_ERA) })
        assertEquals("Thursday, January 15", History.Title.On(january).words(t0, ny, usDate, usDateWithYear))
        val (hijri, hijriWithYear) = listOf(usDate, usDateWithYear).map { it.withChronology(HijrahChronology.INSTANCE) }
        assertEquals(hijriWithYear.format(january), History.Title.On(january).words(t0, ny, hijri, hijriWithYear))
        assertTrue(History.Title.On(january).words(t0, ny, hijri, hijriWithYear).endsWith("1447"))
    }
}

private val historyRoute = "GET /v1/me/history"

/** History through the engine (C6a): BaliOutbox's HistoryEngineTests. */
class HistoryEngineTest : EngineFiles() {
    @Test
    fun aPageGoesThroughTheEnginesOneClientOlderThanTheCursorItIsGivenNoneFromTheTopItsTokenRenewedOnceOnA401ByTheEnginesOwnRefreshAndItAppliesNothing(): Unit =
        runBlocking {
            val rig = rig()
            rig.screenOn(Answer.me(null))
            val state = rig.engine.updates.value
            val answer = async { rig.engine.history("e1") }
            val refused = rig.server.next(historyRoute)
            assertEquals("before=e1", refused.request.url.rawQuery)
            refused.reply(401)
            val again = rig.server.next(historyRoute)
            assertEquals(listOf<Any?>("Bearer token-2", "before=e1"), listOf(again.token, again.request.url.rawQuery))
            again.reply(200, """{"events":[],"nextBefore":null}""")
            assertEquals(emptyList(), answer.await().answer?.events)
            assertEquals(1, rig.tokens.refreshes)
            val top = async { rig.engine.history(null) }
            val newest = rig.server.next(historyRoute)
            assertNull(newest.request.url.rawQuery)
            newest.reply(200, """{"events":[${moment("unlock", "2026-09-21T13:00:00Z", reason = "nurse")}],"nextBefore":null}""")
            assertEquals(1, top.await().answer?.events?.size)
            // A read: the engine's state and its outbox as they were, and no read asked for, which the loop's next wake in no
            // class would have sent.
            rig.clock.advance(30)
            rig.sleeping(at(60))
            assertEquals(listOf<Any?>(state, emptyList<String>(), emptyList<OutboxRecord>()), listOf(rig.engine.updates.value, rig.server.waiting, rig.outbox.records()))
            rig.stop()
        }
}
