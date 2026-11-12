package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.HistoryEvent
import com.bali.core.HistoryEventType
import com.bali.core.HistoryPage
import com.bali.core.SendResult
import com.bali.core.UnlockReason
import com.bali.core.UnlockRecordedAs
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoField

// The History screen (C6a; D1's History), BaliOutbox's History.swift: the student's own moments as the pages of `GET
// /v1/me/history` came, and D1's days and cards of them, every failure and day title a type, and their words, each a
// function of its type (AN10h's; WordsTest reads every one): a read's failures, each moment and its note, a day's title and
// a moment's time, from the phone's own patterns. The screen and its own words are AS7's, and the call the engine's
// (SyncEngine.kt's `history`). It holds what the server answers and writes nothing: no state of the engine's, no record of
// the outbox's.

/**
 * The History screen (C6a; D1's History) as the phone keeps it: the student's own moments, as the pages of `GET
 * /v1/me/history` came, newest first, each moment once; the next page's cursor; and why the last read did not finish, as
 * types ([failure], [notUpdated]; rule 5). A value whose every step gives the next, as `Joining` is, where Swift's mutating
 * calls change it; what it says is [Failure.words] and [Failure.notUpdatedWords]. The app keeps it while it runs (#141) and
 * starts it afresh when who is signed in changes. BaliOutbox's `History`.
 */
data class History(
    /** The moments read, newest first, as the server answered them: one of a kind this build doesn't know kept as it came. */
    val events: List<HistoryEvent> = emptyList(),
    /** The next, older page's cursor: none at the end, and before any answer. */
    val nextBefore: String? = null,
    /** Whether a page has answered: until then the screen says it is reading, or why it could not. */
    val read: Boolean = false,
    /** A read under way: set by [reading], cleared as its answer comes. */
    val busy: Boolean = false,
    /** Why the last read did not finish, said in its place: with nothing read, in the moments'; else Show earlier's, where it was pressed. */
    val failure: Failure? = null,
    /**
     * Why reading again from the top did not finish, said above the moments read (#141): they may not be the newest. It stays
     * through Show earlier's pages too, come or not, and while a read from the top is under way, until one answers.
     */
    val notUpdated: Failure? = null,
    /**
     * Whether the read under way, or the last one, is from the top, sending no cursor, not Show earlier's page (#141): its
     * page takes the place of the moments read, which show until it comes.
     */
    val fromTop: Boolean = true,
) {
    /** Why a read gave no page, each said in words of its own ([words] in its place, [notUpdatedWords] over the moments read). */
    sealed interface Failure {
        /** The read's answer gave no page: its [result] and its error's [reason], never its message. */
        data class NotRead(val result: SendResult, val reason: ApiErrorReason?) : Failure

        /**
         * The phone's engine hasn't started, so nothing was sent: the app's to give ([notStarted]), never the engine's, as Join's
         * is (AN10d's call; BaliApp.swift's `readHistory`).
         */
        data object NotStarted : Failure
    }

    /**
     * The cursor the read [reading] started sends: none from the top, the next page's for Show earlier, which starts only while
     * there is one. BaliApp.swift's `readHistory` picks it there; here, so it is tested.
     */
    val before: String? get() = if (fromTop) null else nextBefore

    /**
     * A read starts, from the top or [more], Show earlier's page: the next, busy until its answer comes, the last one's failure
     * gone but not [notUpdated], which stays until a read from the top answers. None, nothing to send, for Show earlier with
     * no page after those read, nor while a read is under way, but for one from the top, which goes ahead of Show earlier's
     * (#141): BaliApp.swift's `readHistory` checks both before its `reading`, and drops the answer to a read no longer the
     * latest, one sent before who is signed in changed among them (`reads`, AS7's).
     */
    fun reading(more: Boolean): History? =
        when {
            more && nextBefore == null -> null
            busy && (more || fromTop) -> null
            else -> copy(fromTop = !more, busy = true, failure = null)
        }

    /**
     * The read [reading] would start, with no engine started to send it (the app's to give, asked before [reading]; BaliApp.swift's
     * `readHistory`): nothing sent, and why said where that read's own failure would be, as [answered] says one, nothing busy.
     * None where [reading] would start none. The app counts it as the latest read all the same (`reads`, AS7's), as iOS's does, so
     * the answer to a Show earlier still on its way is dropped, never taken as this read's page from the top.
     */
    fun notStarted(more: Boolean): History? = reading(more)?.failed(Failure.NotStarted)

    /** [failure] said where it belongs, no read under way: over the moments read, for a read from the top; else in its place. */
    private fun failed(failure: Failure): History =
        if (fromTop && read) copy(busy = false, notUpdated = failure) else copy(busy = false, failure = failure)

    /**
     * A page came back: the next, and true when the history must be read again from the top. One from the top takes the
     * place of the moments read (a newer moment added after older ones would be drawn out of order, and one read before may
     * have changed since: an unlock's reason, A20); Show earlier's goes after them, each moment once. No page: why, said
     * where it belongs, the moments read kept: over them, for a read from the top; else in its own place. But Show earlier's
     * cursor one the history doesn't hold (`unknown_cursor`), whose Try again would only be refused again, is true, said
     * nothing; never a read from the top answered so, which would be read again forever (C6a-2's review): that is said as any
     * other failure is.
     */
    fun answered(response: ApiResponse<HistoryPage>): Pair<History, Boolean> {
        val page = response.answer
        if (page == null) {
            val failure = Failure.NotRead(response.result, response.error?.error?.reason)
            if (failure.reason == ApiErrorReason.UnknownCursor && !fromTop) return copy(busy = false) to true
            return failed(failure) to false
        }
        val kept = if (fromTop) History() else this
        val known = kept.events.map { it.eventId }.toSet()
        val events = kept.events + page.events.filter { it.eventId !in known }
        return kept.copy(events = events, nextBefore = page.nextBefore, read = true, busy = false, failure = null) to false
    }

    /**
     * The moments read, in D1's grouping: days newest first, each oldest first, the page reversed and never re-sorted (A7: a
     * switch's two moments share one instant), in cards of one class's moments in a row. A day is the phone's, in [zone],
     * whole whatever its length, as its title is at [now]: today, yesterday or its date. A moment of a kind this build doesn't
     * know is left out, as A7 asks, its card with it where it was alone, and stays in [events].
     */
    fun days(now: Instant, zone: ZoneId): List<Day> {
        val today = now.atZone(zone).toLocalDate()
        val shown = events.mapNotNull { event -> moment(event, zone)?.let { event to it } }
        return shown.runs { it.second.at.toLocalDate() }.map { day ->
            val date = day[0].second.at.toLocalDate()
            val start = date.atStartOfDay(zone).toEpochSecond()
            val classes = day.asReversed().runs { it.first.schoolClass.id }
            val cards =
                classes.mapIndexed { index, run ->
                    val first = run[0].first
                    val later = classes.subList(index + 1, classes.size).count { it[0].first.schoolClass.id == first.schoolClass.id }
                    Card("$start-${first.schoolClass.id}-$later", first.schoolClass.name, first.teacher.displayName, run.map { it.second })
                }
            val title =
                when (date) {
                    today -> Title.Today
                    today.minusDays(1) -> Title.Yesterday
                    else -> Title.On(date)
                }
            Day(title, cards)
        }
    }

    /** A day as D1 draws it: its title, and its cards. */
    data class Day(val title: Title, val cards: List<Card>)

    /** A day's title, a type: what it says is [words], its date's with its year once that isn't this one. */
    sealed interface Title {
        data object Today : Title

        data object Yesterday : Title

        /** Any other day: its date in the phone's zone. */
        data class On(val date: LocalDate) : Title
    }

    /**
     * One class's moments in a row, under its name and its teacher's (none when unnamed). Known by its [id]: its day, its
     * class and how many of that class's cards come after it that day, never a moment at either end, so it stays the card it
     * was (#139) whether a newer moment joins it, read from the top, or an older one, Show earlier's (F5's review). Only a
     * class come back to after another, read from the top, renews its earlier cards that day.
     */
    data class Card(val id: String, val name: String, val teacher: String?, val moments: List<Moment>)

    /**
     * A moment's line: its event's [id]; its [kind], for its icon and its words; its time, [at], in the zone its day is in; and
     * what its words name, each none where the server named none or this build doesn't know it: an unlock's [reason], the
     * class a declined tap already counted in ([countedIn]), and a [note] where the record changed nothing (A7's `recordedAs`).
     */
    data class Moment(
        val id: String,
        val kind: HistoryEventType,
        val at: ZonedDateTime,
        val reason: UnlockReason?,
        val countedIn: String?,
        val note: Note?,
    )

    /** A moment's note, where its record changed nothing or the lock was off (A7's `recordedAs`), each with words of its own ([words]). */
    enum class Note {
        /** It reached the server after the class ended. */
        AfterSessionEnd,

        /** It arrived late, so it changed nothing. */
        Superseded,

        /** It reached the server after the student left this class. */
        NoLiveParticipation,

        /** The lock was off at the time (iOS's Screen Time): not "changed nothing", since the lock back on returns the student to it (#167). */
        ProtectionOff,
    }
}

/**
 * What History says where a read gave no page (rule 5), in the moments' place or Show earlier's, with Try again: a teacher's
 * account its own line on a 403, the rest in Join's words keyed on the status alone; and Bali still starting. BaliOutbox's
 * `History.words`.
 */
val History.Failure.words: String
    get() =
        when (this) {
            is History.Failure.NotRead ->
                if (result == SendResult.Status(403)) {
                    "This is a teacher's account, and History is only for students."
                } else {
                    Joining.words(result, null)
                }
            History.Failure.NotStarted -> Joining.Failure.NotStarted.words
        }

/**
 * What History says above the moments read when reading them again from the top didn't finish (#141), so they may not be the
 * newest: why, in one sentence with it where it is a sign-in Bali couldn't check, never "Bali couldn't" twice (F4's review).
 * BaliOutbox's `History.notUpdated`.
 */
val History.Failure.notUpdatedWords: String
    get() =
        if (this is History.Failure.NotRead && result == SendResult.Status(401)) {
            "Bali couldn't check your sign-in to update your history. Try again."
        } else {
            "Bali couldn't update your history. $words"
        }

/**
 * A day's title (D1's History): Today, Yesterday, or its date as the phone writes one, in [thisYear]'s pattern, or with its
 * year in [anotherYear]'s once that isn't this one at [now] in [zone]: the year as written, in the calendar [thisYear] writes
 * in (the ISO calendar where it names none), as iOS judges it in the phone's. Each pattern the phone's own for its locale (Q6:
 * `DateFormat.getBestDateTimePattern`'s for iOS's weekday, month and day, without the year and with it), since Android 10's
 * java.time has no localized skeleton. BaliOutbox's `History.title`.
 */
fun History.Title.words(now: Instant, zone: ZoneId, thisYear: DateTimeFormatter, anotherYear: DateTimeFormatter): String =
    when (this) {
        History.Title.Today -> "Today"
        History.Title.Yesterday -> "Yesterday"
        is History.Title.On -> {
            val calendar = thisYear.chronology ?: IsoChronology.INSTANCE
            val year = { day: LocalDate -> calendar.date(day).get(ChronoField.YEAR_OF_ERA) }
            (if (year(date) == year(now.atZone(zone).toLocalDate())) thisYear else anotherYear).format(date)
        }
    }

/** A moment's time as the phone writes one, [time] its own pattern, as Focus's is (AN10e), at the moment's day's zone. */
fun History.Moment.time(time: DateTimeFormatter): String = time.format(at)

/**
 * A moment's line (D1's History; AS7's board), iOS's words but for the lock's two kinds, Android's (the Words board: "Lock off"
 * and "Lock back on" for the ruled "Screen Time off" and "Screen Time back on"): an unlock's reason on an unlock alone, and the
 * class a declined tap already counted in on a declined tap alone, "another class" where the server named none, as iOS's rule
 * is. BaliOutbox's `History.Moment` words.
 */
val History.Moment.words: String
    get() =
        when (kind) {
            HistoryEventType.TapIn -> "Tapped in"
            HistoryEventType.Refocus -> "Locked apps again"
            HistoryEventType.Unlock -> reason?.let { "Unlocked · ${it.label}" } ?: "Unlocked"
            HistoryEventType.ProtectionOff -> "Lock off"
            HistoryEventType.ProtectionOn -> "Lock back on"
            HistoryEventType.LeftForOtherSession -> "Switched to another class"
            HistoryEventType.EnrollmentLeft -> "Left the class"
            HistoryEventType.EnrollmentRemoved -> "Removed from the class"
            // D1's words, in two sentences on the owner's ruling (2026-09-30): a class named with a dash of its own read as one
            // line of two dashes.
            HistoryEventType.ArmedTapSkipped -> "Tap not used. It already counted in ${countedIn ?: "another class"}."
            HistoryEventType.SessionEnded, HistoryEventType.SessionExpired -> "Class ended"
        }

/** An unlock's reason as its moment names it, iOS's: its name capitalized. */
private val UnlockReason.label: String
    get() =
        when (this) {
            UnlockReason.Bathroom -> "Bathroom"
            UnlockReason.Nurse -> "Nurse"
            UnlockReason.Other -> "Other"
        }

/** A moment's note, under its line: iOS's, but the lock off's, Android's (the Words board, for "Screen Time was off at the time"). */
val History.Note.words: String
    get() =
        when (this) {
            History.Note.AfterSessionEnd -> "Arrived after class ended"
            History.Note.Superseded -> "Arrived late, so it changed nothing"
            History.Note.NoLiveParticipation -> "Arrived after you left this class"
            History.Note.ProtectionOff -> "The lock was off at the time"
        }

/** [event]'s line, at its time in [zone]; none for a kind this build doesn't know. BaliOutbox's `History.Moment.init`. */
private fun moment(event: HistoryEvent, zone: ZoneId): History.Moment? {
    val kind = event.type.known ?: return null
    val note =
        when (event.recordedAs?.known) {
            UnlockRecordedAs.AfterSessionEnd -> History.Note.AfterSessionEnd
            UnlockRecordedAs.Superseded -> History.Note.Superseded
            UnlockRecordedAs.NoLiveParticipation -> History.Note.NoLiveParticipation
            UnlockRecordedAs.ProtectionOff -> History.Note.ProtectionOff
            // Never in a class's history (an unlock kept with none), or a note this build doesn't know.
            else -> null
        }
    return History.Moment(event.eventId, kind, event.occurredAt.atZone(zone), event.reason?.known, event.countedIn?.name, note)
}

/** [this] in runs of neighbours with the same [key], in order. */
private fun <T> List<T>.runs(key: (T) -> Any?): List<List<T>> {
    val runs = mutableListOf<MutableList<T>>()
    for (item in this) {
        val last = runs.lastOrNull()
        if (last != null && key(last.last()) == key(item)) last += item else runs += mutableListOf(item)
    }
    return runs
}
