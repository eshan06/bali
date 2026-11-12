package com.bali.outbox

import com.bali.core.AnswerResult
import com.bali.core.PollProblem
import com.bali.core.SessionView
import com.bali.core.StudentQuestion
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// A live lesson on the phone (L8; ARCHITECTURE, "Live lesson", decisions 1, 2, 5 and 11), BaliOutbox's Lesson.swift: which
// session's lesson the phone follows, its class's heading, and the answer card's looks and line, each a function of its types
// (WordsTest reads every word), the iPhone's word for word and AS8's card boards'. Nothing here is kept or sent: the card's own
// state, the pick on its way, what the last one said and Hide, is the lesson half's (AN13d), and the card on screen, its
// Question, Hide, Correct answer and Your answer, AS8's, as AnswerCardView.swift draws iOS's.

/** The sessions the phone may follow: the one it stands in first, then each class's in session by `GET /v1/me`, in its order. */
private fun SyncState.lessons(): List<SessionView> =
    listOfNotNull((standing as? Standing.InSession)?.session) +
        me?.classes.orEmpty().mapNotNull { row -> row.liveSession?.let { SessionView(it.id, row.id, it.endsAt) } }

/**
 * The running session whose lesson the phone follows at [now] by its own clock: the one it stands in, checked first, whatever its
 * state, else the first class in session by `GET /v1/me`, tapped in or not (decision 2); each only while its bell is ahead, and
 * never one of [over], a read having said it is over. BaliOutbox's `lessonSession`.
 */
fun SyncState.lessonSession(now: Instant, over: Set<String>): String? = followedSession(now, over)?.id

/** The session [lessonSession] names, as the entry it took names it, its bell with it: where the lesson half wakes (Q7). */
internal fun SyncState.followedSession(now: Instant, over: Set<String>): SessionView? = lessons().firstOrNull { it.endsAt > now && it.id !in over }

/**
 * The class of the lesson the phone follows at [now] ([lessonSession]), headed as a session's screens head theirs
 * ([SyncState.heading]): its name, then its teacher and bell, in [time] at [zone] as the phone writes them ([FocusWords]); the line
 * over the card and the slide on the permission step (AS3-Lesson, the Screen Time ask's twin), as (title, subtitle). None with no
 * lesson to follow, or a class `GET /v1/me` doesn't name. BaliOutbox's `lessonHeading`.
 */
fun SyncState.lessonHeading(now: Instant, over: Set<String>, zone: ZoneId, time: DateTimeFormatter): Pair<String, String>? {
    val id = lessonSession(now, over) ?: return null
    // The first session of that id, the one the phone stands in before a class's, as the twin finds it.
    val session = lessons().firstOrNull { it.id == id } ?: return null
    val (title, subtitle) = heading(session, zone, time)
    return title?.let { it to subtitle }
}

/**
 * The answer card as AS8's boards draw it, state by state (L8): each answer's look and the line under them, for [question] as the
 * last read shows it, with [problem], the last poll's, the pick on its way, [sending] (its index), and what the last one [said],
 * both the card's own on this phone. A tap answers and another changes it until the close; closed, the correct answer is marked
 * once shown and the student's own as Your answer, never red; no count ever, and nothing of another student's, which the
 * presentation read never carries. BaliOutbox's `AnswerCard`.
 */
class AnswerCard(val question: StudentQuestion, problem: PollProblem?, sending: Int?, said: Said?) {
    /**
     * An answer [Open] to a tap, [Open.picked] the one on its way, else the one Bali holds; or [Closed]: [Closed.right], the
     * correct one once shown, and [Closed.mine], the student's own. An open card marks neither: the API sends the correct answer
     * only once shown, at the close.
     */
    sealed interface Look {
        data class Open(val picked: Boolean) : Look

        data class Closed(val right: Boolean, val mine: Boolean) : Look
    }

    /**
     * What the last pick's request said, other than taken: [TooLate] (`409 question_closed`), or that it [Failed] to send, with the
     * answer Bali held as it was made ([Failed.held], its event id, none for none).
     */
    sealed interface Said {
        data object TooLate : Said

        data class Failed(val held: String?) : Said

        companion object {
            /**
             * [result] for the card, [held] the answer Bali held as the pick was made: none once taken, the answer held then
             * showing; else as above. Every result is named, so one added later stops this compiling until it has its place.
             */
            fun of(result: AnswerResult, held: String?): Said? =
                when (result) {
                    is AnswerResult.Answered -> null
                    AnswerResult.QuestionClosed -> TooLate
                    AnswerResult.InvalidOption, AnswerResult.EventIdConflict, AnswerResult.AccountDeleted, is AnswerResult.Unreachable,
                    is AnswerResult.Refused,
                    -> Failed(held)
                }
        }
    }

    /** Open until a read says it closed, or Bali said the last pick came too late. */
    val open: Boolean = question.open && said != Said.TooLate

    /** Each answer's look, in the question's order. */
    val looks: List<Look>

    /**
     * The line under the answers, none on an open question with nothing picked and nothing wrong (the owner's cut, 2026-11-04):
     * the pick's own lines before the poll's, and once closed, the close's alone.
     */
    val line: String?

    /** Whether [line] says something didn't go, in the primary ink. */
    val alert: Boolean

    /** Whether [line] is the poll's no answer, drawn with its icon (AS8-Card-offline). */
    val offline: Boolean

    init {
        // A pick that didn't send is no news once Bali holds an answer made since: it landed, its reply lost, or one from another
        // device stands.
        val failed = said is Said.Failed && said.held == question.answer?.eventId
        val picked = sending ?: question.answer?.option
        looks =
            question.options.indices.map { index ->
                if (open) {
                    Look.Open(picked = index == picked)
                } else {
                    Look.Closed(right = index == question.correctOption, mine = index == question.answer?.option)
                }
            }
        // Each line one string, as the boards and iOS write it, with whether it alerts and whether it is the poll's.
        val (words, alerts, polled) =
            when {
                !open && said == Said.TooLate -> Triple("This question closed before your answer reached Bali, so it wasn't counted.", true, false)
                !open && question.correctOption == null -> Triple("Your teacher closed this question.", false, false)
                !open -> Triple("Your teacher closed it and showed the answer.", false, false)
                sending != null -> Triple("Sending your answer…", false, false)
                failed -> Triple("Bali couldn't send your answer. Check your connection and tap it again.", true, false)
                problem != null -> Triple("No connection right now, so Bali can't send your answer. It keeps trying.", true, true)
                question.answer != null -> Triple("Your answer is in. You can change it until the question closes.", false, false)
                else -> Triple(null, false, false)
            }
        line = words
        alert = alerts
        offline = polled
    }
}
