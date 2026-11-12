package com.bali.core

import java.time.Instant
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// A live lesson as the student's phone follows it (Phase 7; ARCHITECTURE, "Live lesson", decisions 1, 2 and 4 to 6), BaliCore's
// LiveLesson.swift (L5): the poll of what a running session shows, and the student's answer. No screen and no word: `outbox`
// words each outcome (AN13c), and the app's lesson half runs the poll only while Bali's screen is in front and sends each tap
// through `answer` (AN13d). The deck a slide names joins them here (AN13b). `core` can't see `outbox`, so no answer reaches it.

/** What the phone knows of a live lesson: a value, each change a copy. */
data class LessonState(
    /**
     * What the last read said, kept through each `304` and each failed poll, the student's own answer with it, and given each
     * answer the server takes since; none until the first read. [Presentation.running] false: the session is over, and the
     * poll has stopped.
     */
    val presentation: Presentation? = null,
    /**
     * Why the last poll brought nothing, said beside what is kept (rule 5) while the poll tries again by itself; none once one
     * is answered, and once the session is over.
     */
    val problem: PollProblem? = null,
)

/** Why a poll brought nothing. */
sealed interface PollProblem {
    /** No answer came: offline, a timeout, or no token to send. */
    data class Unreachable(val noAnswer: NoAnswer) : PollProblem

    /** `429`: over the account's budget, the poll waits out its `Retry-After` (decision 6). */
    data object RateLimited : PollProblem

    /** Any other answer than a `200` it can read or a `304`: its status, and the reason its error shape names, if any. */
    data class Refused(val status: Int, val reason: ApiErrorReason?) : PollProblem
}

/**
 * How an answer's one request ended: the answer the server holds, or why not, each a line the card says, and a tap sends it
 * again (rule 5). A refusal is known by its reason, never its message.
 */
sealed interface AnswerResult {
    /** The answer the server holds now: this one, or, a replay or an id sorting before the one held (decision 4), that one. */
    data class Answered(val answer: StudentAnswer) : AnswerResult

    /** `409 question_closed`: closed, or the bell rang, before it arrived; not counted. */
    data object QuestionClosed : AnswerResult

    /** `400 invalid_option`: the question has no such option. */
    data object InvalidOption : AnswerResult

    /** `409 event_id_conflict`: its id is spent elsewhere, nothing recorded; a tap mints another. */
    data object EventIdConflict : AnswerResult

    /** `409 account_deleted`: the account was deleted on its way; nothing recorded. */
    data object AccountDeleted : AnswerResult

    /** No answer came: the server may hold it or not, and a tap again settles which. */
    data class Unreachable(val noAnswer: NoAnswer) : AnswerResult

    /** Any other answer: its status, and the reason its error shape names, if any. */
    data class Refused(val status: Int, val reason: ApiErrorReason?) : AnswerResult
}

/**
 * One running session's live lesson, as the student's phone follows it: [run] keeps [state], and [answer] sends the student's
 * pick. Swift's actor is a lock each stretch holds ([alone]), let go at each call to the API, so a tap goes while a read is on
 * its way. Nothing is stored: the lesson lives in memory, and goes with its owner, as at sign-out.
 */
class LiveLesson(
    /** The running session whose lesson this is. */
    val session: String,
    /** The app's one client: an answer never goes through the outbox (decision 5). */
    private val client: ApiClient,
    /** The phone's clock, a test's own there. */
    private val now: () -> Instant = { Instant.now() },
    /** The poll's wait, a test's own there: it throws once its coroutine is cancelled. */
    private val sleep: suspend (Duration) -> Unit = { delay(it) },
) {
    private val mutex = Mutex()
    private val published = MutableStateFlow(LessonState())

    /**
     * What the phone knows of the lesson now, then at each change, the newest only: what its owner shows. Swift's `state` and
     * `updates` in one; it never ends, so its owner's scope ends what reads it.
     */
    val state: StateFlow<LessonState> = published.asStateFlow()

    /** The last `200`'s `ETag`, sent back as `If-None-Match`. */
    private var etag: String? = null

    /**
     * The last answer minted here, its question and its id: the next is minted after it, as after the one held, so two taps
     * sort in the order made however far behind the phone's clock stands.
     */
    private var minted: Pair<String, String>? = null

    /** The newest [run]'s number: an older run stops at its next read, saying nothing of it. */
    private var runs = 0

    /**
     * Polls until a read says the session is not running, or its coroutine is cancelled, which it ends by throwing, as
     * coroutines do. Its owner runs it while Bali's screen is in front and cancels it as the screen goes behind, so nothing
     * polls behind the app. One run at a time: a newer one takes over and the older stops at its next read, so the poll never
     * comes twice as often, nor stops because an older run was still winding down as the app came back to the front.
     */
    suspend fun run() {
        val run = alone { ++runs }
        while (true) sleep(poll(run) ?: return)
    }

    /** One read for [run], kept, and the wait before the next; none to stop. */
    private suspend fun poll(run: Int): Duration? {
        val read = client.presentation(session, ifNoneMatch = alone { etag })
        // Cancelled on its way, the app gone behind: nothing is said of a read it stopped.
        currentCoroutineContext().ensureActive()
        return alone {
            // A newer run under way: this one stops, saying nothing of its read either.
            if (run != runs) return@alone null
            var presentation = published.value.presentation
            var problem: PollProblem? = null
            var wait = INTERVAL
            val result = read.result
            val body = read.answer
            when {
                result !is SendResult.Status -> problem = PollProblem.Unreachable(read.noAnswer ?: NoAnswer.Unreachable)
                result.code == 304 -> Unit
                result.code in 200..299 && body != null -> {
                    // A read the server made before an answer landed lacks it: the later answer is kept.
                    val shown = presentation?.question
                    val fresh = body.question
                    presentation =
                        if (shown == null || fresh == null || shown.id != fresh.id) body
                        else body.copy(question = fresh.copy(answer = later(shown.answer, fresh.answer)))
                    etag = read.etag
                }
                result.code == 429 -> {
                    problem = PollProblem.RateLimited
                    wait = (read.retryAfter?.seconds ?: LONGEST_WAIT).coerceIn(INTERVAL, LONGEST_WAIT)
                }
                else -> problem = PollProblem.Refused(result.code, read.error?.error?.reason)
            }
            val over = presentation?.running == false
            // Over is over: a read failing after it never says Bali can't be reached.
            published.value = LessonState(presentation, if (over) null else problem)
            if (over) null else wait
        }
    }

    /**
     * Sends the student's pick for [question] in one request, never through the outbox, so no answer ever waits there ahead
     * of an Emergency Unlock (decisions 1, 5), under an id minted after the answer held and after the last minted here
     * (decision 4), and keeps the answer the server says it holds.
     */
    suspend fun answer(question: String, option: Int): AnswerResult {
        val eventId =
            alone {
                val shown = published.value.presentation?.question
                val held = listOfNotNull(
                    shown?.takeIf { it.id == question }?.answer?.eventId,
                    minted?.takeIf { it.first == question }?.second,
                ).maxOrNull()
                EventId.mint(now(), after = held).also { minted = question to it }
            }
        val sent = client.answer(question, AnswerRequest(eventId, option))
        val result = sent.result as? SendResult.Status ?: return AnswerResult.Unreachable(sent.noAnswer ?: NoAnswer.Unreachable)
        val answered = sent.answer
        if (result.code in 200..299 && answered != null) {
            alone {
                val state = published.value
                val presentation = state.presentation
                val shown = presentation?.question
                if (presentation != null && shown != null && shown.id == question) {
                    val kept = shown.copy(answer = later(shown.answer, answered.answer))
                    published.value = state.copy(presentation = presentation.copy(question = kept))
                }
            }
            return AnswerResult.Answered(answered.answer)
        }
        return when (val reason = sent.error?.error?.reason) {
            ApiErrorReason.QuestionClosed -> AnswerResult.QuestionClosed
            ApiErrorReason.InvalidOption -> AnswerResult.InvalidOption
            ApiErrorReason.EventIdConflict -> AnswerResult.EventIdConflict
            ApiErrorReason.AccountDeleted -> AnswerResult.AccountDeleted
            else -> AnswerResult.Refused(result.code, reason)
        }
    }

    /**
     * Runs [block] with the lesson to itself, as a stretch of Swift's actor runs between two `await`s, and never cut short, so
     * a cancel lands after it. Never from inside another: the lock is no reentrant one.
     */
    private suspend fun <T> alone(block: () -> T): T = withContext(NonCancellable) { mutex.withLock { block() } }

    companion object {
        /** How often the poll reads: about every 2 s (decision 2), 30 of the account's 120 a minute (decision 6). */
        val INTERVAL: Duration = 2.seconds

        /**
         * The longest a `429` holds the poll: the account's budget refills within its minute, so a longer `Retry-After`, none,
         * or one that isn't a whole number of seconds (a date) waits this.
         */
        val LONGEST_WAIT: Duration = 60.seconds
    }
}

/**
 * Of two answers to one question, the one the server took last: it replaces an answer only with one whose id sorts after
 * (decision 4), so the id that sorts last is the answer now.
 */
private fun later(held: StudentAnswer?, other: StudentAnswer?): StudentAnswer? =
    if (held == null || other == null) held ?: other else if (other.eventId > held.eventId) other else held
