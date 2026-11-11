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

// The History screen (C6a; D1's History), BaliOutbox's History.swift: the student's own moments as the pages of `GET
// /v1/me/history` came, and D1's days and cards of them, every failure and day title a type. Its rules alone: every word, the
// day titles' text and the time format are AN10's, the screen AS7's, and the call the engine's (SyncEngine.kt's `history`).
// It holds what the server answers and writes nothing: no state of the engine's, no record of the outbox's.

/**
 * The History screen (C6a; D1's History) as the phone keeps it: the student's own moments, as the pages of `GET
 * /v1/me/history` came, newest first, each moment once; the next page's cursor; and why the last read did not finish, as
 * types ([failure], [notUpdated]; rule 5). A value whose every step gives the next, as `Joining` is, where Swift's mutating
 * calls change it; its words are AN10's. The app keeps it while it runs (#141) and starts it afresh when who is signed in
 * changes. BaliOutbox's `History`.
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
    /** Why a read gave no page: its answer's [result] and its error's [reason], which AN10's words key on, never its message. */
    data class Failure(val result: SendResult, val reason: ApiErrorReason?)

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
            val failure = Failure(response.result, response.error?.error?.reason)
            if (failure.reason == ApiErrorReason.UnknownCursor && !fromTop) return copy(busy = false) to true
            return (if (fromTop && read) copy(busy = false, notUpdated = failure) else copy(busy = false, failure = failure)) to false
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

    /** A day's title, a type: its words and its date's format, with its year once that isn't this one, are AN10's. */
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

    /** A moment's note, where its record changed nothing or Screen Time was off (A7's `recordedAs`), each with words of its own (AN10's). */
    enum class Note {
        /** It reached the server after the class ended. */
        AfterSessionEnd,

        /** It arrived late, so it changed nothing. */
        Superseded,

        /** It reached the server after the student left this class. */
        NoLiveParticipation,

        /** Screen Time was off at the time: not "changed nothing", since Screen Time back on returns the student to it (#167). */
        ProtectionOff,
    }
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
