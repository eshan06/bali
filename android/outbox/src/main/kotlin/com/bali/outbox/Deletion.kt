package com.bali.outbox

import com.bali.core.NoAnswer
import com.bali.core.SendResult

// Delete account (C4), BaliOutbox's Deletion.swift: where Me's deletion stands, and the outbox's order
// before one. Its rules, every failure a type, and its words, each a function of its type (AN10g's; WordsTest
// reads every one); the screen is AS7's, and the deletion itself the engine's (AN9b).

/**
 * Where Me's Delete account stands (C4): the engine's answer to it (AN9b's `deleteAccount`), in states, which
 * the Me screen says (C4b), each failure with a way to try again (rule 5). BaliOutbox's `AccountDeletion`.
 */
sealed interface AccountDeletion {
    /** Done: the account deleted, and its Cognito sign-in; the phone signed out, in no session. */
    data object Deleted : AccountDeletion

    /**
     * This sign-in can't delete itself: made before the phone asked for the scope Cognito's DeleteUser needs,
     * or no sign-in can be read now. A fresh sign-in first; nothing sent or deleted.
     */
    data object SignInFirst : AccountDeletion

    /** An Emergency Unlock the server hasn't recorded: it lands first, never let go, and never sent once the account is gone. Nothing deleted. */
    data object UnlockUnsent : AccountDeletion

    /** The outbox file couldn't be read, so whether an unlock waits isn't known. Nothing deleted. */
    data object Unread : AccountDeletion

    /** A teacher with a class or a block (`409 teacher_has_classes`): the school deletes that account. */
    data object TeacherHasClasses : AccountDeletion

    /**
     * The last answer, [result], when something else the phone queued, or the deletion itself, got none that
     * settled it: nothing deleted that the phone knows of, though a deletion with no answer may have landed,
     * which a try again settles, deleting too any account a read has made since (C3). [noAnswer], why none came
     * when none did: [NoAnswer.NoToken] when the sign-in gave the try no token, so nothing went, said as the
     * sign-in, never as no connection, though one of its reasons is a token run out partway that the phone
     * couldn't renew offline (Q7; #553's review).
     */
    data class NotDeleted(val result: SendResult, val noAnswer: NoAnswer? = null) : AccountDeletion

    /**
     * The account deleted on the server, but not its Cognito sign-in: what Cognito answered, [result]. The
     * sign-in is kept to try again, and gives the API no token meanwhile.
     */
    data class SignInNotDeleted(val result: SendResult) : AccountDeletion

    /**
     * Another account's sign-in landed before `DELETE /v1/me` was answered deleted (the owner, 2026-11-10: "Close it
     * now"): nothing more of the deletion sent, every record kept, and nothing sent for the sign-in now held. Nothing
     * deleted that the phone knows of, though a `DELETE /v1/me` with no answer may have landed for the account that
     * pressed, which its own next deletion settles (C3). Never [Deleted], nor a stop whose Try again would delete the
     * account signed in now.
     */
    data object SignInChanged : AccountDeletion
}

/**
 * Me's Delete account as the phone keeps it (C4b): the question asked under the button, the deletion under way,
 * where one stopped, with its way on (rule 5), and done. From the press to the end the app shows the deletion's
 * own screen and nothing else ([shows]): a join or a rename landing after the deletion would make a fresh
 * account, a tap or an Emergency Unlock made meanwhile would wait for the next sign-in, and Sign out while
 * DeleteUser waits would leave the person in Cognito (`docs/DECISIONS.md`, C4a). BaliOutbox's `Deleting`, a
 * value whose every step gives the next, as Swift's mutating calls change it; what its screen says is [said].
 */
sealed interface Deleting {
    /** Nothing under way: Me shows the button. */
    data object None : Deleting

    /** Delete account pressed: Me asks under the button, with Delete account and Cancel. */
    data object Asking : Deleting

    /** The deletion under way: its screen, with nothing to press until the answer comes. */
    data object Busy : Deleting

    /** Stopped with nothing deleted that the phone knows of: why, [stop], said on its screen, with Back. */
    data class Stopped(val stop: Stop) : Deleting

    /**
     * The account deleted, its sign-in not yet ([AccountDeletion.SignInNotDeleted], or the sign-in's
     * `deletionPending` at a relaunch): its screen, with Try again alone, until the sign-in is deleted too.
     */
    data object Pending : Deleting

    /** Deleted, the sign-in too: the done screen, until OK. */
    data object Done : Deleting

    /**
     * Why a deletion stopped, each its own title and line on the screen ([said]). A deletion sent by a try
     * before, its answer lost, may have landed (C4a), so only a refusal before anything could ever be sent says
     * the account isn't deleted.
     */
    sealed interface Stop {
        /** The sign-in can't delete itself, or none can be read now: a fresh one first. Nothing sent. */
        data object SignInFirst : Stop

        /** A teacher with a class or a block: the school deletes that account. */
        data object TeacherHasClasses : Stop

        /**
         * The phone's engine hasn't started, so nothing was sent: the app's to give, never the engine's, as Join's is
         * (AN10d's call; BaliApp.swift's `deleteAccount`).
         */
        data object NotStarted : Stop

        /** An Emergency Unlock the server hasn't recorded: the next try sends it first. */
        data object UnlockUnsent : Stop

        /** The outbox file couldn't be read, so whether an unlock waits isn't known. */
        data object Unread : Stop

        /**
         * No answer settled what the phone queued, or the deletion: the last one, [result], said in Join's words for it, and
         * why none came, [noAnswer]: no token is said as Join's 401, never as no connection (Q7).
         */
        data class NotDeleted(val result: SendResult, val noAnswer: NoAnswer? = null) : Stop

        /**
         * The gap's fallback's (a sign-in around the 13+ question, answered under 13, C7): its deletion couldn't
         * reach Bali, said under the stop screen's title.
         */
        data object Unfinished : Stop

        /** Another account's sign-in landed before the deletion was done ([AccountDeletion.SignInChanged]): nothing more sent. */
        data object SignInChanged : Stop

        /**
         * Whether another try can help, so Try again shows: never for a sign-in from before the scope, nor a teacher's, nor
         * once another account's sign-in landed, when it would delete that account.
         */
        val retries: Boolean
            get() =
                when (this) {
                    SignInFirst, TeacherHasClasses, SignInChanged -> false
                    NotStarted, UnlockUnsent, Unread, is NotDeleted, Unfinished -> true
                }
    }

    /** Whether the deletion's own screen shows, over every other (AN10's router). */
    val shows: Boolean
        get() =
            when (this) {
                None, Asking -> false
                Busy, is Stopped, Pending, Done -> true
            }

    /** Delete account pressed on Me: its question asked. Nothing once anything is under way. */
    fun ask(): Deleting = if (this == None) Asking else this

    /** Cancel under the question: no question. */
    fun cancel(): Deleting = if (this == Asking) None else this

    /**
     * Delete account under the question, or Try again on the screen: [Busy], until the engine's answer, once
     * the deletion may begin; none where nothing may: a try that can't help, nothing asked, one under way.
     */
    fun start(): Deleting? =
        when (this) {
            Asking, Pending -> Busy
            is Stopped -> Busy.takeIf { stop.retries }
            None, Busy, Done -> null
        }

    /**
     * The engine's answer to the deletion under way; one to no deletion is dropped. [underThirteen], the gap's
     * fallback's: a deletion that couldn't reach Bali is its own stop ([Stop.Unfinished]), every other as Me's, one
     * with no token among them, said as the sign-in, never as no connection (Q7).
     */
    fun answered(answer: AccountDeletion, underThirteen: Boolean = false): Deleting {
        if (this != Busy) return this
        return when (answer) {
            AccountDeletion.Deleted -> Done
            is AccountDeletion.SignInNotDeleted -> Pending
            AccountDeletion.SignInFirst -> Stopped(Stop.SignInFirst)
            AccountDeletion.TeacherHasClasses -> Stopped(Stop.TeacherHasClasses)
            AccountDeletion.UnlockUnsent -> Stopped(Stop.UnlockUnsent)
            AccountDeletion.Unread -> Stopped(Stop.Unread)
            AccountDeletion.SignInChanged -> Stopped(Stop.SignInChanged)
            is AccountDeletion.NotDeleted -> {
                val unreached = answer.result == SendResult.NetworkError && answer.noAnswer != NoAnswer.NoToken
                Stopped(if (underThirteen && unreached) Stop.Unfinished else Stop.NotDeleted(answer.result, answer.noAnswer))
            }
        }
    }

    /**
     * Back after a stop that deleted nothing, or OK once done: the screen goes. Nothing while the deletion runs
     * or its sign-in waits to be deleted, which offer no way out but Try again.
     */
    fun close(): Deleting =
        when (this) {
            is Stopped, Done -> None
            None, Asking, Busy, Pending -> this
        }

    /**
     * Who is signed in changed: the question and a stop go with them, their words the last sign-in's. The
     * deletion under way, a sign-in waiting to be deleted and the done screen hold: the deletion's own end is
     * such a change, and its answer is still to come.
     */
    fun signInChanged(): Deleting =
        when (this) {
            Asking, is Stopped -> None
            None, Busy, Pending, Done -> this
        }

    companion object {
        /** The question Me asks under Delete account, pressed ([Asking]): the owner's words (2026-10-05). */
        const val QUESTION = "Delete your account?"

        /** What deleting costs, said under the question: what goes, what stays with no name on it, and that it isn't an Emergency Unlock. */
        const val CONSEQUENCE =
            "Bali deletes your account, your name and your sign-in. This can't be undone. Lessons you were in still count in your teachers' reports, with no name on them. If a class is running, you leave it now and your apps unlock. It isn't an Emergency Unlock."
    }
}

/** What a screen says: its [title], and the line under it. */
data class Said(val title: String, val body: String)

/** The title of a stop that refuses before anything could ever be sent: nothing deleted, for certain. */
private const val NOT_DELETED = "Your account isn't deleted"

/** The title of every other stop: a deletion sent by a try before, its answer lost, may have landed (C4a), so it claims neither. */
private const val NOT_FINISHED = "Bali couldn't finish deleting your account"

/**
 * What the deletion's own screen says (C4b), its title and the line under it: each stop with its way on (rule 5), the deletion
 * under way, the sign-in still to go and done; none while no screen shows ([Deleting.shows]). BaliOutbox's `Deleting.said`.
 */
val Deleting.said: Said?
    get() =
        when (this) {
            Deleting.None, Deleting.Asking -> null
            Deleting.Busy -> Said("Deleting your account…", "Bali deletes your account first, then your sign-in. This takes a moment.")
            is Deleting.Stopped -> stop.said
            Deleting.Pending -> Said("Your account is deleted", "Bali's part is done, but your sign-in isn't deleted yet. Try again to finish.")
            Deleting.Done -> Said("Your account is deleted", "Your sign-in is gone too. If you join Bali again, you start fresh.")
        }

/**
 * What the screen says for the gap's fallback (the owner's words, 2026-10-06): a sign-in made around the 13+ question and answered
 * under 13, its account deleted as Me's deletion deletes one. The stop screen's title over the deletion under way and done, final
 * for the run; a stop, or its sign-in still to go, as [said] says it. BaliOutbox's `Deleting.saidUnderThirteen`.
 */
val Deleting.saidUnderThirteen: Said?
    get() =
        when (this) {
            Deleting.Busy -> Said(AgeCheck.NOT_YET, "Bali is deleting your account. This takes a moment.")
            Deleting.Done -> Said(AgeCheck.NOT_YET, "Bali deleted your account. ${AgeCheck.ASK_TEACHER}")
            Deleting.None, Deleting.Asking, is Deleting.Stopped, Deleting.Pending -> said
        }

/**
 * What a stop says (rule 5): its title, and why, with the way on, Back alone where no try can help ([Deleting.Stop.retries]).
 * Only a refusal before anything could be sent says the account isn't deleted. None says an Emergency Unlock goes: one the
 * server hasn't recorded holds the deletion back. A deletion with no token is said as Join's 401, the sign-in Bali couldn't
 * check, never as no connection (Q7); a sign-in from before the scope, or none read now, with no "older version" (Q8); and one
 * stopped once this phone is signed in to another account, with Back alone (AN9h). The three drawn first, as intermediate states
 * of Delete account (AS7-Del-notoken, AS7-Del-signinfirst, AS7-Del-changed; Q9).
 */
val Deleting.Stop.said: Said
    get() =
        when (this) {
            Deleting.Stop.SignInFirst ->
                Said(NOT_DELETED, "Bali can't delete your account with this sign-in. Sign out and sign in again, then delete your account.")
            Deleting.Stop.TeacherHasClasses ->
                Said(NOT_DELETED, "A teacher's account with classes or blocks is deleted through your school. Ask your school to arrange it.")
            Deleting.Stop.NotStarted -> Said(NOT_DELETED, Joining.Failure.NotStarted.words)
            Deleting.Stop.UnlockUnsent -> Said(NOT_FINISHED, "Your Emergency Unlock hasn't reached your teacher yet. Check your connection and try again.")
            Deleting.Stop.Unread ->
                Said(NOT_FINISHED, "Bali can't read what your phone saved right now, so it can't delete your account yet. Try again in a moment.")
            is Deleting.Stop.NotDeleted -> Said(NOT_FINISHED, Joining.words(if (noAnswer == NoAnswer.NoToken) SendResult.Status(401) else result, null))
            Deleting.Stop.Unfinished -> Said(AgeCheck.NOT_YET, "Bali couldn't finish deleting your account. Check your connection and try again.")
            Deleting.Stop.SignInChanged ->
                Said(NOT_FINISHED, "This phone is signed in to another account now, so Bali stopped. Sign out and sign in to your own account, then delete it.")
        }

/**
 * A tap the server refused: kept and retried (tap step 10), but never one it recorded, so it holds no account
 * deletion back (C4).
 */
internal val OutboxRecord.refusedForGood: Boolean get() = change is Change.Tap && refusedStatus != null

/**
 * The next record to send before an account deletion (C4), none of [tried]: every Emergency Unlock first, the
 * server placing each against what the phone did by its order (A12), but one filed under a tap still queued,
 * which goes after that tap, as the drain sends it (decision 11). Then the rest in the order the phone acted, as
 * [Outbox.nextDue] takes them: a record tried and still pending holds those behind it, a refocus waits for its
 * unlock, and an unlock not filed goes nowhere. Throws when the file can't be read.
 */
internal suspend fun Outbox.nextBeforeDeletion(tried: Set<String>): OutboxRecord? {
    val records = records()
    val queued = records.mapTo(HashSet()) { it.eventId }

    fun sendable(record: OutboxRecord) = record.eventId !in tried && !record.change.isUnfiled && record.follows !in queued
    val unlock = records.firstOrNull { sendable(it) && it.change.isUnlock && (it.change as? Change.UnlockUnderTap)?.tap !in queued }
    if (unlock != null) return unlock
    for (record in records) {
        if (sendable(record)) return record
        if (record.eventId in tried && !record.stuck) return null
    }
    return null
}
