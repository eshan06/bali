package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.EndEnrollmentRequest
import com.bali.core.EndEnrollmentResponse
import com.bali.core.EventId
import com.bali.core.MeClass
import com.bali.core.SendResult
import com.bali.core.UpdateMeRequest
import com.bali.core.UpdateMeResponse
import java.time.Instant

// The Me screen (C6b, C6c), BaliOutbox's Me.swift: the name as typed and saved, a class left, and Sign out's hold, every
// failure a type, and their words, each a function of its type (AN10g's; WordsTest reads every one). The screens are AS2's
// Your name and AS7's Me, and the calls the engine's (SyncEngine.kt's `rename`, `leave` and `unlockUnsent`).

/**
 * The Me screen's name (C6b; D1's Me, and AS2's Your name, which saves it as Me does) as the phone keeps it: whether the
 * student is editing it, the name as typed, and why the last save (A8's `PATCH /v1/me`) set no name ([failure], rule 5). A
 * value whose every step gives the next, as `Joining` is, where Swift's mutating calls change it; what it says is
 * [Failure.words]. BaliOutbox's `Naming`.
 */
data class Naming(
    val editing: Boolean = false,
    val name: String = "",
    /** Why the last save set no name, said under the field; none once a step clears it. */
    val failure: Failure? = null,
    /** A save under way, one at a time: the name stays as sent until its answer comes. */
    val busy: Boolean = false,
    /**
     * The last save's event id, kept while the name is the one it sent (rule 4): a retry after an answer that never came is
     * then answered as its replay, never a second rename.
     */
    val eventId: String? = null,
) {
    /** Why a save set no name, each with words of its own ([words]). */
    sealed interface Failure {
        /** Nothing to save: a name of blank space and characters that draw nothing, which the API refuses (`INVISIBLE`). */
        data object Blank : Failure

        /** The save's answer set no name: its [result] and its error's [reason], which the words key on, never its message. */
        data class NotSaved(val result: SendResult, val reason: ApiErrorReason?) : Failure

        /**
         * The phone's engine hasn't started, so nothing was sent: the app's to give, never the engine's, as Join's is (AN10d's
         * call; BaliApp.swift's `saveName`).
         */
        data object NotStarted : Failure
    }

    /** Something to save: a name with something in it a reader would see, never one of blank space and what draws nothing. */
    val complete: Boolean get() = !name.codePoints().allMatch { blank(it) || it.within(ignorable) }

    /** Editing begins on [current], the name `GET /v1/me` gives. */
    fun edit(current: String?): Naming = Naming(editing = true, name = current.orEmpty())

    /**
     * The student typed [text]: kept as a name can be sent, a pasted tab or line break the space it looks like and what a
     * name never carries left out ([printable]), so nothing unseen is sent and refused (C6b-1's review), and to the whole
     * characters that fit the longest name, each a BreakIterator's grapheme cluster as Swift's are, so no emoji is cut in two.
     * What went wrong with the name before no longer applies, and a name changed is a new save. Nothing changes while a save
     * is under way.
     */
    fun type(text: String): Naming {
        if (busy) return this
        var count = 0
        val kept =
            characters(printable(text)).takeWhile { character ->
                count += character.codePointCount(0, character.length)
                count <= MAX_LENGTH
            }.joinToString("")
        return copy(name = kept, failure = null, eventId = eventId.takeIf { kept == name })
    }

    /**
     * Save pressed, or the keyboard's Done: the next, and the request to send, the name as the API will store it ([tidy]), under
     * the last try's event id while the name is the same, busy until the answer comes, the last try's words gone. None while a
     * save is under way, nor for a name with nothing to save, said so ([Failure.Blank]): iOS's app checks both before its
     * `save` (BaliApp.swift's `saveName`).
     */
    fun save(now: Instant): Pair<Naming, UpdateMeRequest?> {
        if (busy) return this to null
        if (!complete) return copy(failure = Failure.Blank) to null
        val id = eventId ?: EventId.mint(now)
        return copy(busy = true, failure = null, eventId = id) to UpdateMeRequest(tidy(name), id)
    }

    /**
     * The answer to the save [request] sent: the next, and true once the name is set (applied, or a replay's name now), when
     * editing ends. Else why not, said under the field, the name kept for another try. One for a save this editing didn't send
     * (a sign-out meanwhile) is dropped.
     */
    fun saved(response: ApiResponse<UpdateMeResponse>, request: UpdateMeRequest): Pair<Naming, Boolean> =
        when {
            !busy || request.eventId != eventId -> this to false
            response.answer != null -> Naming() to true
            else -> copy(busy = false, failure = Failure.NotSaved(response.result, response.error?.error?.reason)) to false
        }

    companion object {
        /** The longest name, in code points: `DISPLAY_NAME_MAX_LENGTH` in `@bali/shared`. */
        const val MAX_LENGTH = 64
    }
}

/**
 * What the name's card says when a save set no name (rule 5), under the field, the name kept to try again: a blank name, how to
 * save one; a refusal, keyed on its error's reason and its status, never its message, a teacher's account its own line, the rest
 * in Join's words; and Bali still starting. BaliOutbox's `Naming.blank` and `Naming.words`.
 */
val Naming.Failure.words: String
    get() =
        when (this) {
            Naming.Failure.Blank -> "Type a name to save it."
            is Naming.Failure.NotSaved ->
                when {
                    reason == ApiErrorReason.DisplayNameTaken -> "A classmate already uses that name. Try another, like adding your last initial."
                    reason == ApiErrorReason.DisplayNameInvalid -> "Bali can't use that name. Try another."
                    result == SendResult.Status(403) -> "This is a teacher's account, and only students change their name here."
                    else -> Joining.words(result, null)
                }
            Naming.Failure.NotStarted -> Joining.Failure.NotStarted.words
        }

/**
 * Leaving a class from the Me screen (C6c; D1's Leave, A19's `DELETE /v1/enrollments/{id}`) as the phone keeps it: the class
 * whose Leave was pressed, its question asked under it; the leave under way, one at a time; and why the last didn't finish,
 * said under the question, whose Leave class is the way to try again ([failure], rule 5). A value whose every step gives the
 * next; what it says is [question], [CONSEQUENCE], [inSession] and [Failure.words]. BaliOutbox's `Leaving`.
 */
data class Leaving(
    /** The class whose Leave was pressed: its question shows while this is set. */
    val asking: MeClass? = null,
    /** The leave under way: the question stays as it is until the answer comes. */
    val busy: Boolean = false,
    /** Why the last leave didn't finish, said under the question; none once a step clears it. */
    val failure: Failure? = null,
    /**
     * The last leave sent, kept while it is the same enrollment's (rule 4): a try after an answer that never came goes under its
     * event id, and is answered as its replay.
     */
    val sent: Leave? = null,
) {
    /** Why a leave didn't finish, each with words of its own ([words]). */
    sealed interface Failure {
        /** The leave's answer left the student in the class: its [result] and its error's [reason], which the words key on, never its message. */
        data class NotLeft(val result: SendResult, val reason: ApiErrorReason?) : Failure

        /**
         * The phone's engine hasn't started, so nothing was sent: the app's to give, never the engine's, as Join's is (AN10d's
         * call; BaliApp.swift's `leave`).
         */
        data object NotStarted : Failure
    }

    /** A leave to send: the enrollment it ends, and its request. */
    data class Leave(val enrollmentId: String, val request: EndEnrollmentRequest)

    /**
     * Leave pressed on [row]: its question asked, what went wrong before gone. Nothing while a leave is under way, nor for a class
     * named with no enrollment to leave by.
     */
    fun ask(row: MeClass): Leaving = if (busy || row.enrollmentId == null) this else copy(asking = row, failure = null)

    /**
     * Whether the question shows under [row]: asked about its enrollment. A class joined again since is another enrollment, which
     * shows none (santa's round 1): Leave class would send the old one's leave, answered as already out.
     */
    fun asks(row: MeClass): Boolean = asking?.enrollmentId?.let { it == row.enrollmentId } == true

    /** Cancel: no question, once a leave under way has its answer. */
    fun cancel(): Leaving = if (busy) this else copy(asking = null, failure = null)

    /**
     * Leave class pressed: the next, and the leave to send, busy until the answer comes, the last try's words gone, under the last
     * try's event id while it is the same enrollment's. None while one is under way, nor with nothing asked.
     */
    fun send(now: Instant): Pair<Leaving, Leave?> {
        val enrollmentId = asking?.enrollmentId
        if (busy || enrollmentId == null) return this to null
        val eventId = sent?.takeIf { it.enrollmentId == enrollmentId }?.request?.eventId ?: EventId.mint(now)
        val leave = Leave(enrollmentId, EndEnrollmentRequest(eventId))
        return copy(busy = true, failure = null, sent = leave) to leave
    }

    /**
     * The answer to the leave of [enrollmentId]: the next, and true once the student is out of the class (it ended, or they were
     * out already), when the question goes. Else why not, said under it, to try again. One for a leave this question didn't send
     * (a sign-out meanwhile) is dropped.
     */
    fun left(response: ApiResponse<EndEnrollmentResponse>, enrollmentId: String): Pair<Leaving, Boolean> =
        when {
            !busy || asking?.enrollmentId != enrollmentId -> this to false
            response.answer != null -> Leaving() to true
            else -> copy(busy = false, failure = Failure.NotLeft(response.result, response.error?.error?.reason)) to false
        }

    companion object {
        /** What leaving costs, said under [question]: the way back in. */
        const val CONSEQUENCE = "You'll need the class code to join it again."

        /**
         * Whether the phone holds [row]'s Leave, said why in [inSession]'s words: it stands in that class's lesson, whose bell hasn't
         * rung by its own clock at [now]. Not held: the server says no to a lesson the phone isn't in (`409 class_in_session`).
         */
        fun held(row: MeClass, state: SyncState, now: Instant): Boolean {
            val standing = state.standing as? Standing.InSession ?: return false
            return standing.session.classId == row.id && standing.session.endsAt > now
        }

        /** The question asked under [row] before it is left, its name as the teacher wrote it. */
        fun question(row: MeClass): String = "Leave ${row.name}?"

        /** Why [row] can't be left now, under it: it is in session, as the phone knows ([held]) or the server answered. */
        fun inSession(row: MeClass): String = "${row.name} is in session. You can leave it once class is over."
    }
}

/**
 * What the question under [row] says when a leave didn't finish (rule 5), Leave class there to try again: the class in session,
 * when it can be left; any 403 the route gives, whatever its reason, its no to this account leaving this enrollment, never Join's
 * words for a 403 (#134's review), as an enrollment not found or not the student's; the rest in Join's words; and Bali still
 * starting. Keyed on the error's reason and the status, never its message. BaliOutbox's `Leaving.words`.
 */
fun Leaving.Failure.words(row: MeClass): String =
    when (this) {
        is Leaving.Failure.NotLeft ->
            when {
                reason == ApiErrorReason.ClassInSession -> Leaving.inSession(row)
                reason == ApiErrorReason.EnrollmentNotFound || reason == ApiErrorReason.EnrollmentNotYours ||
                    reason == ApiErrorReason.UnknownUser || result == SendResult.Status(403) ->
                    "Bali couldn't find you in this class. It's checking your classes again."
                else -> Joining.words(result, null)
            }
        Leaving.Failure.NotStarted -> Joining.Failure.NotStarted.words
    }

/**
 * Why Me's Sign out waits (C6b), or didn't sign the student out: held, or a try that couldn't, its why said in its own words
 * ([words]), with Try again (rule 5). Only an Emergency Unlock holds it: signed out, one the server hasn't recorded would wait for
 * the next sign-in and go under whoever makes it (B4's rule), on a shared phone another student. The server records every unlock
 * that reaches it, so the hold ends once the phone is online. BaliOutbox's `SignOutWords.held`, and BaliApp.swift's `unsent`.
 */
enum class SignOutHold {
    /** An Emergency Unlock this phone recorded that the server hasn't. */
    UnlockUnsent,

    /** The outbox's file couldn't be read to say whether one waits: nothing changed. */
    Unread,

    /** The phone couldn't forget the sign-in right now (`SignIn.signOut` threw): nothing changed, the app's to give. */
    NotForgotten,

    /**
     * The phone's engine hasn't started, so nothing changed: the app's to give, never the engine's, as Join's is (AN10d's call;
     * BaliApp.swift's `signOut`).
     */
    NotStarted;

    companion object {
        /**
         * Sign out's hold in [state], as Me shows it: an Emergency Unlock queued, of any kind, tried and stuck or not; nothing
         * else queued holds it.
         */
        fun held(state: SyncState): SignOutHold? = UnlockUnsent.takeIf { state.queued.any { it.change.isUnlock } }

        /**
         * Sign out's hold at the press: the outbox's file asked itself ([SyncEngine.unlockUnsent]), so an unlock a failed read
         * left out of the engine's queue holds it too (santa's round 1), and a file that can't say holds it, said.
         */
        suspend fun asked(engine: SyncEngine): SignOutHold? =
            when (engine.unlockUnsent()) {
                false -> null
                true -> UnlockUnsent
                null -> Unread
            }
    }
}

/**
 * What Me says by Sign out while it waits, or once a try didn't sign the student out (rule 5), each with its why and Try again: an
 * Emergency Unlock not with the teacher yet, which goes first, never dropped; the outbox's file unread; the sign-in not forgotten;
 * and Bali still starting. BaliOutbox's `SignOutWords`.
 */
val SignOutHold.words: String
    get() =
        when (this) {
            SignOutHold.UnlockUnsent -> "Your Emergency Unlock hasn't reached your teacher yet. You can sign out once it has."
            SignOutHold.Unread -> "Bali can't read what your phone saved right now, so it can't sign you out yet. Try again in a moment."
            SignOutHold.NotForgotten -> "Bali couldn't sign you out. Try again."
            SignOutHold.NotStarted -> Joining.Failure.NotStarted.words
        }

/**
 * Whose sign-in this is, said by Sign out (#147): the account's email, as the sign-in that landed names it (AN10b), so the name a
 * student's teachers see is never taken for what they sign in with. None where no email is known: nothing said, never a guess, and
 * never the last student's. BaliOutbox's `SignOutWords.signedIn`.
 */
val Account.State.signedInAs: String? get() = email?.takeIf { it.isNotEmpty() }?.let { "You're signed in as $it." }

/**
 * [text] without what a name never carries, as the API refuses it (`UNPRINTABLE`, apps/api/src/display-name.ts): control and
 * format characters, but the joiners Persian, Arabic and Indic names and emoji need, line and paragraph separators, and a lone
 * surrogate half, which a Kotlin string can hold and a Swift one can't; those that are blank space made a space. By the phone's
 * own Unicode (`Character.getType`): a format character newer than it is kept and sent, and the API's refusal of it said, as Q6
 * has it for whatever slips past.
 */
private fun printable(text: String): String =
    buildString {
        text.codePoints().forEach {
            when {
                Character.getType(it) !in unprintable || it == 0x200C || it == 0x200D -> appendCodePoint(it)
                it.within(whiteSpace) -> append(' ')
            }
        }
    }

private val unprintable =
    listOf(Character.CONTROL, Character.FORMAT, Character.LINE_SEPARATOR, Character.PARAGRAPH_SEPARATOR, Character.SURROGATE)
        .map { it.toInt() }

/**
 * The name as the API stores it (`tidyDisplayName`): each run of blank space one space, and none at either end, split on the
 * whole characters that are all blank, as Swift's `split` is.
 */
private fun tidy(name: String): String {
    val words = mutableListOf(StringBuilder())
    for (character in characters(name)) {
        if (character.codePoints().allMatch { blank(it) }) words += StringBuilder() else words.last().append(character)
    }
    return words.filter { it.isNotEmpty() }.joinToString(" ")
}

/** Blank space, as `tidyDisplayName` counts it: White_Space, the blank braille cell and the musical null notehead. */
private fun blank(codePoint: Int) = codePoint.within(whiteSpace) || codePoint == 0x2800 || codePoint == 0x1D159

private fun Int.within(ranges: List<IntRange>) = ranges.any { this in it }

// The API's blank test (`INVISIBLE`) as tables, Unicode's own lists, which neither the JDK's `Character` nor its regex has whole:
// no ICU4J (DECISIONS 2026-11-05, Q6). apps/api/test/display-name.test.ts reads them from this file and holds every range, and
// every code point between them, to the API's own regex.

/** Unicode's White_Space, as Swift's `isWhitespace` and the API's `\p{White_Space}` read it; the JDK's `isWhitespace` isn't it. */
private val whiteSpace =
    listOf(
        0x9..0xD, 0x20..0x20, 0x85..0x85, 0xA0..0xA0, 0x1680..0x1680, 0x2000..0x200A, 0x2028..0x2029, 0x202F..0x202F,
        0x205F..0x205F, 0x3000..0x3000,
    )

/**
 * Unicode's Default_Ignorable_Code_Point (DerivedCoreProperties.txt): characters that draw nothing, as the API's
 * `\p{Default_Ignorable_Code_Point}` and Swift's `isDefaultIgnorableCodePoint` read them.
 */
private val ignorable =
    listOf(
        0xAD..0xAD, 0x34F..0x34F, 0x61C..0x61C, 0x115F..0x1160, 0x17B4..0x17B5, 0x180B..0x180F, 0x200B..0x200F, 0x202A..0x202E,
        0x2060..0x206F, 0x3164..0x3164, 0xFE00..0xFE0F, 0xFEFF..0xFEFF, 0xFFA0..0xFFA0, 0xFFF0..0xFFF8, 0x1BCA0..0x1BCA3,
        0x1D173..0x1D17A, 0xE0000..0xE0FFF,
    )
