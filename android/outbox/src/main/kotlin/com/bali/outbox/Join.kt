package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.EnrollmentJoinResponse
import com.bali.core.JoinCodePreviewResponse
import com.bali.core.SendResult
import java.text.BreakIterator
import java.util.Locale

// The Join screen (C2b), BaliOutbox's Join.swift: the code as codes are written, what it opens, and why a look or a join
// gave no class, as types; and a screen's own call, renewed once on a 401 (`send`). Its rules alone: every word is AN10's,
// the screen with its consent preview AS4's, and the calls the engine's (SyncEngine.kt's `lookUp` and `join`).

/**
 * The Join screen (C2b) as the phone keeps it: the code as the student typed it; what it opens, once looked up (`GET
 * /v1/join-codes/{code}`): the class, its teacher and whether they are in it already, which the preview shows, the consent
 * list beside it, before anything is joined; and why the last look or join gave no class ([failure], rule 5). A value
 * whose every step gives the next, as AN9a's `Deleting` is, where Swift's mutating calls change it; its words are AN10's.
 * BaliOutbox's `Joining`.
 */
data class Joining(
    val code: String = "",
    /** What the code opens: the preview shows while it is set, the code's entry while it is none. */
    val preview: JoinCodePreviewResponse? = null,
    /** Why the last look or join gave no class, said under the button that tries again; none once a step clears it. */
    val failure: Failure? = null,
    /**
     * A look-up or a join under way, one at a time, set by the app as it sends one and cleared as its answer comes: the
     * code stays as sent until then, since typed over, the answer would be dropped with nothing said (#106's review).
     */
    val busy: Boolean = false,
) {
    /** Why a look or a join gave no class: its answer's [result] and its error's [reason], which AN10's words key on, never its message. */
    data class Failure(val result: SendResult, val reason: ApiErrorReason?)

    /** A whole code, which Continue looks up. */
    val complete: Boolean get() = code.length == CODE_LENGTH

    /**
     * The student typed [text]: kept as a code is written, ASCII letters and digits in upper case, at most a code's length,
     * so a pasted `kwx 49q` is `KWX49Q`, each whole character judged as Swift's are, a BreakIterator's grapheme cluster: a
     * letter with an accent made of two code points is no letter, nor a digit made a keycap. What went wrong with the code
     * before no longer applies. Nothing changes while a look-up or a join is under way.
     */
    fun type(text: String): Joining {
        if (busy) return this
        val breaks = BreakIterator.getCharacterInstance(Locale.ROOT).apply { setText(text) }
        val characters = generateSequence(breaks.first()) { breaks.next().takeIf { it != BreakIterator.DONE } }.zipWithNext(text::substring)
        val kept = characters.filter { it.length == 1 && (it[0] in 'A'..'Z' || it[0] in 'a'..'z' || it[0] in '0'..'9') }
        return copy(code = kept.joinToString("").uppercase().take(CODE_LENGTH), failure = null)
    }

    /**
     * The preview of [code] came back: what it opens, or why not. One for a code the student has typed over since is
     * dropped: its class isn't the one they would join.
     */
    fun looked(response: ApiResponse<JoinCodePreviewResponse>, code: String): Joining =
        if (code != this.code) this else copy(preview = response.answer, failure = response.failure.takeIf { response.answer == null })

    /**
     * The join came back: the next, and whether the student is in the class, joined or in it already, when the screen
     * starts over. Else why not, said on the preview; a code that opens no class any more (archived, or its teacher made a
     * new one) goes back to the code.
     */
    fun joined(response: ApiResponse<EnrollmentJoinResponse>): Pair<Joining, Boolean> {
        if (response.answer != null) return Joining() to true
        val gone = response.error?.error?.reason == ApiErrorReason.ClassNotFound
        return copy(preview = preview.takeUnless { gone }, failure = response.failure) to false
    }

    /** Back, or "Not my class": the code again, as typed, once a join under way has its answer. */
    fun back(): Joining = if (busy) this else copy(preview = null, failure = null)

    companion object {
        /** Every class's code is this long: `JOIN_CODE_LENGTH` in `@bali/shared`. */
        const val CODE_LENGTH = 6

        /**
         * A screen's own call, [send]: sent once more when the API refused its token and [renewing] renewed it, as the
         * engine's loops do for their own, which a screen's never passes through; a renewal that gives none leaves the 401,
         * said. Each caller names its renewal: the engine's own refresh for a screen's call, an account's own sign-in for a
         * call held to that account (AN9h). One that throws, or ends in a cancel of its own, renewed nothing ([hooked]).
         * Nothing else renews. It runs in its caller's coroutine. iOS's `Joining.send(renewing:)`.
         */
        suspend fun <A> send(renewing: suspend () -> Boolean, send: suspend () -> ApiResponse<A>): ApiResponse<A> {
            val answer = send()
            return if (answer.result == SendResult.Status(401) && hooked(false, renewing)) send() else answer
        }
    }
}

/** Why an answer gave no class, as [Joining.Failure] keeps it. */
private val ApiResponse<*>.failure: Joining.Failure get() = Joining.Failure(result, error?.error?.reason)
