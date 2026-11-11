package com.bali.outbox

import java.time.Instant
import java.time.Month
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

// The 13+ check (C7), BaliOutbox's Age.swift: the question's answers and its picks, counted in the Gregorian
// calendar by java.time's ISO calendar, whatever calendar the phone's locale asks for. The question, its stop
// screen and the intro are AS2's, every word AN10's, and the server's yes, read and recorded, the engine's
// (SyncEngine.kt). Build 8's age notes have no twin here: no Android build ever kept one.

/**
 * The 13+ check (C7; the owner's rulings, 2026-10-04, 2026-10-05, 2026-10-07 and 2026-10-08): asked at every Sign up,
 * before the intro and the sign-up page, no account existing yet to have passed it: the birth month and year,
 * neutrally, by the FTC's COPPA guidance, nothing on it saying 13, hinting at the cutoff or picking an answer. 13 or
 * older is kept as a yes per account on Bali's server (C7-server), never the date: the sign-in a Sign up's page makes
 * is kept through the check, its yes recorded once it can be. Under 13 keeps nothing anywhere, on the phone or the
 * server, and sees a kind stop screen, with no way back to the question until the app is opened again: held in memory
 * for the run (AN9e's `Account`). A sign-in into an account Bali's server holds no yes for, made on Cognito's own pages
 * around the question or never confirmed, is asked first too, and gives Bali's API nothing until answered; under 13
 * there, the account is deleted as Delete account deletes one (the gap's fallback, the owner's decision 2026-10-06).
 * A value whose every step gives the next, where Swift's mutating call changes it. BaliOutbox's `AgeCheck`.
 */
data class AgeCheck(val answer: Answer) {
    /** The question as it stands this run, in memory only. */
    enum class Answer {
        /** Not asked: Sign in shows; signed in, the question, where Bali's server has no yes. */
        Unanswered,

        /** Sign up pressed: the question shows, and stays, answered 13 or older, while the sign-up page it opens is open. */
        Asked,

        /** 13 or older, this run: the Sign up under way goes on, and an account it was answered under has its yes recorded. */
        Passed,

        /** Under 13, this run: the stop screen, until the app is opened again; signed in, its account deleted first. */
        TooYoung,

        /** Signed in, the sign-in not through the check yet: Bali's server asked whether the account has its yes, the starting mark meanwhile. */
        Checking,
    }

    /**
     * The question answered with [month] and [year], judged at [today] in [zone]: passed or under 13, in memory alone.
     * Nothing is written here: a yes goes to Bali's server with its sign-in, and an answer under 13 is written nowhere,
     * ever.
     */
    fun answered(month: Int, year: Int, today: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): AgeCheck =
        AgeCheck(if (passes(month, year, today, zone)) Answer.Passed else Answer.TooYoung)

    companion object {
        /**
         * Whether someone born in [month] of [year] is 13 or older at [today], at month precision: only once the month
         * after their birth month has begun, 13 years on, when whoever was born in that month, on its last day too, has
         * had their 13th birthday. In the birth month itself, 13 years on, a student born on its last day is still 12
         * until that day, so no one passes: a 12-year-old never does. By java.time's ISO calendar, the Gregorian, in
         * [zone], the phone's, never a calendar its locale asks for: thirteen Islamic years, each eleven days short of a
         * solar one, would pass a 12-year-old, and a Buddhist year, 543 ahead, anyone.
         */
        fun passes(month: Int, year: Int, today: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): Boolean {
            val now = today.atZone(zone)
            return now.year * 12L + now.monthValue > (year + 13L) * 12 + month
        }
    }
}

/**
 * The age screen's picks (C7): the birth month and year as the student picks them, Gregorian, and what each menu
 * offers, every month and a hundred years, so the list hints at no cutoff, short of the future: with this year picked,
 * the months to this one; with a month past this one picked, the years to last year. So no pick can be a month that
 * hasn't come, and the question needs no error of its own. Counted by java.time's ISO calendar in the phone's zone,
 * whatever calendar its locale asks for; the names in its language. BaliOutbox's `Birth`.
 */
data class Birth(val month: Int? = null, val year: Int? = null) {
    /** Both picked: Continue answers. */
    val complete: Boolean get() = month != null && year != null

    /** The months the month menu offers at [today] in [zone]: all twelve, or, with this year picked, those up to this one. */
    fun months(today: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): List<Int> {
        val now = today.atZone(zone)
        val last = if (year == now.year) now.monthValue else 12
        return (1..last).toList()
    }

    /** The years the year menu offers at [today] in [zone], this year first and a hundred back, or, with a month past this one picked, last year first. */
    fun years(today: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): List<Int> {
        val now = today.atZone(zone)
        val newest = if ((month ?: 0) > now.monthValue) now.year - 1 else now.year
        return (newest downTo newest - 100).toList()
    }

    companion object {
        /**
         * Gregorian month [month]'s name in [locale], the phone's language, whatever calendar it asks for: java.time's
         * ISO month, in the form iOS's `monthSymbols` gives.
         */
        fun monthName(month: Int, locale: Locale = Locale.getDefault()): String = Month.of(month).getDisplayName(TextStyle.FULL, locale)
    }
}
