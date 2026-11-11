package com.bali.outbox

import java.lang.reflect.Modifier
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.chrono.Chronology
import java.util.Calendar
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The 13+ check's rules (C7): BaliOutbox's AgeTests, but `keeps`' second half, build 8's notes, which no Android
// build ever kept.

private val utc: ZoneId = ZoneOffset.UTC

/** A day in the Gregorian calendar, at noon UTC, so the month a test names is the month read. */
private fun day(year: Int, month: Int, day: Int): Instant = LocalDate.of(year, month, day).atTime(12, 0).toInstant(ZoneOffset.UTC)

/** Whether a birth in [month] of [year] passes at [today], in UTC. */
private fun passes(month: Int, year: Int, today: Instant): Boolean = AgeCheck.passes(month, year, today, utc)

/** The 13+ check (C7): BaliOutbox's AgeTests. */
class AgeTest {
    @Test
    fun atMonthPrecision13OrOlderOnlyOnceTheMonthAfterTheBirthMonthHasBegun13YearsOnTheWholeBirthMonthStillNoAcrossAYearsEndAndALeapDayInThePhonesZone() {
        // Born in October 2013: 13 some day in October 2026, so the whole of October says no.
        assertFalse(passes(10, 2013, day(2026, 10, 1)))
        assertFalse(passes(10, 2013, day(2026, 10, 31)))
        assertTrue(passes(10, 2013, day(2026, 11, 1)))
        // Born in September 2013: 13 on every day of October 2026.
        assertTrue(passes(9, 2013, day(2026, 10, 1)))
        assertFalse(passes(9, 2013, day(2026, 9, 30)))
        // The year's end: born in December 2012, 13 only from January 2026.
        assertFalse(passes(12, 2012, day(2025, 12, 31)))
        assertTrue(passes(12, 2012, day(2026, 1, 1)))
        // Born in January 2013: 13 from February 2026, never in January.
        assertFalse(passes(1, 2013, day(2026, 1, 31)))
        assertTrue(passes(1, 2013, day(2026, 2, 1)))
        // Born on 29 February 2012: 13 from 1 March 2025, whichever day the law counts the birthday on; 28 February
        // says no.
        assertFalse(passes(2, 2012, day(2025, 2, 28)))
        assertTrue(passes(2, 2012, day(2025, 3, 1)))
        // A 12-year-old never passes, nor anyone younger; an adult always does.
        assertFalse(passes(10, 2014, day(2026, 10, 15)))
        assertFalse(passes(10, 2026, day(2026, 10, 15)))
        assertFalse(passes(12, 2027, day(2026, 10, 15)))
        assertTrue(passes(10, 2000, day(2026, 10, 15)))
        assertTrue(passes(1, 1950, day(2026, 10, 15)))
        // The month is the phone's zone's: 1 November in UTC is still 31 October at the school.
        val evening = Instant.parse("2026-11-01T03:00:00Z")
        assertTrue(AgeCheck.passes(10, 2013, evening, utc))
        assertFalse(AgeCheck.passes(10, 2013, evening, central))
    }

    @Test
    fun theRuleAndTheMenusCountInTheGregorianCalendarWhateverCalendarThePhonesLocaleAsksForOnlyItsZoneAndLanguageItsOwn() {
        // Santa's round 1, iOS's: thirteen Islamic years, each eleven days short of a solar one, would pass a 12-year-old;
        // a Japanese year is its era's, and a Buddhist year, 543 ahead, would pass anyone. Each asks for its calendar
        // on this JVM: java.util's Calendar takes the Buddhist and the Japanese, java.time's chronology the Islamic.
        assertEquals("buddhist", Calendar.getInstance(Locale.forLanguageTag("th-TH")).calendarType)
        assertEquals("japanese", Calendar.getInstance(Locale.forLanguageTag("ja-JP-u-ca-japanese")).calendarType)
        assertEquals("Hijrah-umalqura", Chronology.ofLocale(Locale.forLanguageTag("ar-SA-u-ca-islamic-umalqura")).id)
        val asking =
            listOf("ar-SA-u-ca-islamic-umalqura", "ar-u-ca-islamic", "ja-JP-u-ca-japanese", "th-TH", "th-TH-u-ca-buddhist", "zh-CN-u-ca-chinese")
                .map(Locale::forLanguageTag)
        val today = day(2026, 10, 5)
        val phone = Locale.getDefault()
        try {
            for (locale in asking) {
                // The phone's own locale, as a phone set so has it.
                Locale.setDefault(locale)
                // Born in January 2014: 12 years and 9 months old, thirteen lunar years on.
                assertFalse(AgeCheck.passes(1, 2014, today, utc), "$locale")
                assertEquals(AgeCheck.Answer.TooYoung, AgeCheck(AgeCheck.Answer.Asked).answered(1, 2014, today, utc).answer, "$locale")
                assertFalse(AgeCheck.passes(10, 2013, day(2026, 10, 31), utc), "$locale")
                assertTrue(AgeCheck.passes(10, 2013, day(2026, 11, 1), utc), "$locale")
                assertEquals((1..12).toList(), Birth().months(today, utc), "$locale")
                val years = Birth().years(today, utc)
                assertEquals(2026 to 1926, years.first() to years.last(), "$locale")
                assertEquals((1..10).toList(), Birth(year = 2026).months(today, utc), "$locale")
                assertEquals(2025, Birth(month = 12).years(today, utc).first(), "$locale")
                // The language's own Gregorian months, as the same locale asking for no calendar names them.
                val gregorian = Birth.monthName(3, locale.stripExtensions())
                assertEquals(gregorian, Birth.monthName(3, locale), "$locale")
                assertEquals(gregorian, Birth.monthName(3), "$locale")
            }
        } finally {
            Locale.setDefault(phone)
        }
        assertEquals("mars", Birth.monthName(3, Locale.forLanguageTag("fr-FR-u-ca-japanese")))
        val english = Locale.forLanguageTag("en-US-u-ca-islamic-umalqura")
        assertEquals("January", Birth.monthName(1, english))
        assertEquals("December", Birth.monthName(12, english))
    }

    @Test
    fun anAnswerKeepsNothing13OrOlderOrUnder13TheAnswerInMemoryAloneNeverTheMonthTheYearOrAnAge() {
        // C7: the phone keeps that the account passed, with its sign-in, never the date or an age, and nothing at all
        // for an answer under 13. The answer is a value holding nothing but itself, with no store to write to.
        val young = AgeCheck(AgeCheck.Answer.Asked).answered(10, 2014, day(2026, 10, 15), utc)
        val old = AgeCheck(AgeCheck.Answer.Asked).answered(10, 2000, day(2026, 10, 15), utc)
        assertEquals(AgeCheck.Answer.TooYoung to AgeCheck.Answer.Passed, young.answer to old.answer)
        assertEquals(listOf("answer"), AgeCheck::class.java.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.map { it.name })
        assertEquals("AgeCheck(answer=TooYoung)", "$young")
    }

    @Test
    fun whatTheMenusOfferInOctober2026EveryMonthAndThisYearWithAHundredBeforeItNewestFirstNeverAMonthThatHasntComeCompleteOnceBothArePicked() {
        // With this year picked, only the months to October; with a month past October picked, the years from last year;
        // a pick made, the other menu still offers what was picked.
        val today = day(2026, 10, 15)
        var birth = Birth()
        assertFalse(birth.complete)
        assertEquals((1..12).toList(), birth.months(today, utc))
        val years = birth.years(today, utc)
        assertEquals(Triple(2026, 1926, 101), Triple(years.first(), years.last(), years.size))
        birth = birth.copy(year = 2026)
        assertEquals((1..10).toList(), birth.months(today, utc))
        assertFalse(birth.complete)
        birth = Birth(month = 12)
        assertEquals(2025, birth.years(today, utc).first())
        assertEquals(101, birth.years(today, utc).size)
        assertEquals((1..12).toList(), birth.months(today, utc))
        birth = Birth(month = 10)
        assertEquals(2026, birth.years(today, utc).first())
        birth = birth.copy(year = 2026)
        assertTrue(birth.complete)
        assertTrue(10 in birth.months(today, utc))
        assertTrue(2026 in birth.years(today, utc))
        assertTrue(Birth(month = 3, year = 2009).complete)
    }
}
