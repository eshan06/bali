package com.bali.core

import java.io.IOException
import java.net.URI
import java.net.URISyntaxException
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.Dispatchers
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

// A live lesson as the student's phone follows it (Phase 7; ARCHITECTURE, "Live lesson", decisions 1, 2, 4 to 6 and 8),
// BaliCore's LiveLesson.swift (L5 and M7): the poll of what a running session shows, the student's answer, and the deck a slide
// names. No screen and no word: `outbox` words each outcome (AN13c), and the app's lesson half runs the poll only while Bali's
// screen is in front, sends each tap through `answer` (AN13d) and asks for a slide's deck (AN13e). `core` can't see `outbox`, so
// no answer reaches it.

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
 * How the deck a slide names came: its bytes, checked, or why not, each said on the slide with a Try again (rule 5), and a
 * failure kept nowhere, so the next ask fetches the deck anew.
 */
sealed interface DeckResult {
    /**
     * The PDF, its SHA-256 the slide's: the only bytes a slide is given, drawn with no link in them followed (decision 8).
     * Equal by the bytes' content, as Swift's `Data` is, where a data class would compare the array itself.
     */
    class Ready(internal val bytes: ByteArray) : DeckResult {
        /**
         * The bytes, read-only: the array is the one the lesson keeps for its next ask, never a copy, so each deck is in memory
         * once, as Swift's `Data` shares its buffer, and nothing given it can change a kept deck past its check.
         */
        fun buffer(): ByteBuffer = ByteBuffer.wrap(bytes).asReadOnlyBuffer()

        override fun equals(other: Any?) = other is Ready && bytes.contentEquals(other.bytes)

        override fun hashCode() = bytes.contentHashCode()

        override fun toString() = "Ready(${bytes.size} bytes)"
    }

    /** Bytes came, but their SHA-256 is not the slide's: refused, never drawn. */
    data object Mismatch : DeckResult

    /** No answer came, from the API or the bucket: offline, a timeout, or no token to send. */
    data class Unreachable(val noAnswer: NoAnswer) : DeckResult

    /**
     * Any other answer, from the API or the bucket: its status, and the reason the API's error shape names, if any: `403` once
     * no running session of the student's class shows the deck, `404 deck_not_found` once it is removed, `503
     * deck_storage_off`; or the bucket's own refusal of a fresh URL.
     */
    data class Refused(val status: Int, val reason: ApiErrorReason?) : DeckResult
}

/**
 * One running session's live lesson, as the student's phone follows it: [run] keeps [state], [answer] sends the student's pick,
 * and [deck] fetches the deck a slide names. Swift's actor is a lock each stretch holds ([alone]), let go at each call to the
 * API or the bucket, so a tap goes while a read is on its way. Nothing is stored: the lesson lives in memory, its decks too, and
 * goes with its owner, as at sign-out.
 */
class LiveLesson(
    /** The running session whose lesson this is. */
    val session: String,
    /**
     * The client it reads and answers through, never the outbox (decision 5): in the app the lesson's own, over a transport
     * apart from the engine's ([OkHttpTransport.apart]), so none of its calls holds an Emergency Unlock's send (AN13d).
     */
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
     * The decks this session showed, checked, by their SHA-256: in memory alone, never on disk, emptied once a read says the
     * session is over, and gone with the lesson when its owner drops it, as at sign-out (decision 8). Every deck the session
     * showed stays, each at most 25 MB, as the twin keeps them (Q5): keep only the slide's own if lessons ever show more than a
     * few.
     */
    private val decks = mutableMapOf<String, ByteArray>()

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
            // Over is over: a read failing after it never says Bali can't be reached, and no deck outlives it.
            if (over) decks.clear()
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
     * The deck [slide] names, its bytes checked against the slide's SHA-256 before anything can draw them (decisions 6, 8): kept
     * from this session's fetch, else fetched through `GET /v1/decks/{id}/download`'s presigned GET. Its owner asks once per
     * deck, not per page: a second ask while one is out fetches the deck again.
     */
    suspend fun deck(slide: Slide): DeckResult {
        alone { decks[slide.sha256] }?.let { return DeckResult.Ready(it) }
        val fetched = fetch(slide)
        if (fetched is DeckResult.Ready) {
            alone {
                // One that ends after a read said the session is over is kept nowhere (decision 8).
                if (published.value.presentation?.running != false) decks[slide.sha256] = fetched.bytes
            }
        }
        return fetched
    }

    /**
     * A fresh URL for the deck, then its bytes, sent with no token: the URL is its own credential, never kept, logged or said,
     * and the client's transport follows no redirect. The bytes are asked for as stored (`Accept-Encoding: identity`), so OkHttp
     * asks for no gzip and decodes nothing before the hash sees them, as the API asks S3 (Q6). A bucket refusing the URL, as it
     * refuses one expired, is asked for a fresh one once.
     */
    private suspend fun fetch(slide: Slide, again: Boolean = true): DeckResult {
        val download = client.download(slide.deckId)
        val result = download.result as? SendResult.Status
            ?: return DeckResult.Unreachable(download.noAnswer ?: NoAnswer.Unreachable)
        val url = download.answer?.url?.let(::address)
        if (result.code !in 200..299 || url == null) return DeckResult.Refused(result.code, download.error?.error?.reason)
        val request = HttpRequest("GET", url, mapOf("Accept-Encoding" to "identity"), null, client.timeout)
        val bucket =
            try {
                client.transport.send(request)
            } catch (error: IOException) {
                return DeckResult.Unreachable(NoAnswer.Unreachable)
            }
        return when {
            bucket.status == 200 && sha256(bucket.body) == slide.sha256 -> DeckResult.Ready(bucket.body)
            bucket.status == 200 -> DeckResult.Mismatch
            bucket.status == 403 && again -> fetch(slide, again = false)
            else -> DeckResult.Refused(bucket.status, null)
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

/** [url] as the address the bucket's request goes to, exactly as the API wrote it; none when it can't be read as one. */
private fun address(url: String): URI? =
    try {
        URI(url)
    } catch (error: URISyntaxException) {
        null
    }

/**
 * [bytes]' SHA-256 in lower-case hex, as the API gives a slide's, its hex written by hand, since `HexFormat` needs Android 14:
 * worked out off its caller's thread, which may be a screen's, as a deck is up to 25 MB and Swift's actor is never the main one.
 */
private suspend fun sha256(bytes: ByteArray): String =
    withContext(Dispatchers.Default) {
        buildString {
            for (byte in MessageDigest.getInstance("SHA-256").digest(bytes)) {
                append(HEX_DIGITS[byte.toInt() shr 4 and 0x0F]).append(HEX_DIGITS[byte.toInt() and 0x0F])
            }
        }
    }

private const val HEX_DIGITS = "0123456789abcdef"
