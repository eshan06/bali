package com.bali.outbox

import com.bali.core.BaliJson
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import java.time.Instant
import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException

// Where the phone stands, SyncEngine.swift's `Standing`, and the form the outbox's file keeps it in.
// iOS keeps both beside its sync engine; here they're the store's, which keeps the standing (AN4d).
// The sync engine, which changes it, is AN5's.

/** Where the phone stands: what the screens show and what the lock covers apps for. */
sealed interface Standing {
    /** In no session: nothing to lock. */
    data object Out : Standing

    /**
     * Armed, waiting for the teacher's Start (decision 5): nothing to lock yet, never Waiting where no
     * Start would lock the phone (#166; the sync engine's to read and end, AN5).
     */
    data object Waiting : Standing

    /**
     * In [session]: locked only while [state] is focused (none: a state this build doesn't know), and
     * only until its `endsAt`, which the phone's own clock keeps (data model, decision 6).
     */
    data class InSession(val session: SessionView, val state: ParticipationState?) : Standing

    /**
     * Not known: the outbox's file wouldn't give back where the phone stood at launch, a storage
     * failure, shown. Nothing is kept over the file's standing until it is read again or the server's
     * truth says where the phone stands. Whether the file itself failed, or gave back a standing this
     * build can't read, is [SyncState.standingFailed]'s.
     */
    data object Unread : Standing
}

/**
 * The phone's own change, at once: a state change of the session it is in. A tap changes nothing
 * here, a tap waiting for its answer being the engine's (AN5); an unlock under it, or one not filed
 * yet, any session. The lock back on returns to [offFrom], where the phone stood before protection
 * off (#167), which the engine always names.
 */
internal fun Standing.acting(change: Change, offFrom: ParticipationState? = null): Standing {
    if (this !is Standing.InSession) return this
    val here = session.id
    val state =
        when (change) {
            is Change.Unlock -> ParticipationState.Unlocked.takeIf { change.session == here }
            is Change.UnlockUnderTap, is Change.UnlockUnfiled -> ParticipationState.Unlocked
            is Change.Refocus -> ParticipationState.Focused.takeIf { change.session == here }
            is Change.ProtectionOff -> ParticipationState.ProtectionOff.takeIf { change.session == here }
            is Change.ProtectionOn -> (offFrom ?: ParticipationState.Focused).takeIf { change.session == here }
            is Change.Tap -> null
        }
    return if (state == null) this else copy(state = state)
}

internal fun Standing.isFocused(session: String): Boolean =
    this is Standing.InSession && state == ParticipationState.Focused && this.session.id == session

/** The session it is in; none: none. */
internal val Standing.sessionId: String? get() = (this as? Standing.InSession)?.session?.id

/**
 * A standing as the outbox's file keeps it, for a relaunch: a form of its own, each key and value
 * spelled out, so no change to [Standing] can leave a kept one unreadable to the next build.
 * Additive only, as `/v1` is: a later build may add a key, never rename or drop one.
 */
@Serializable
private class Kept(
    val standing: String,
    val sessionId: String? = null,
    val classId: String? = null,
    @Contextual val endsAt: Instant? = null,
    val state: String? = null,
)

/** Its kept form. [Standing.Unread] is never kept: it would write over the file's truth from nothing. */
internal val Standing.kept: String
    get() {
        val kept =
            when (this) {
                Standing.Out -> Kept("out")
                Standing.Waiting -> Kept("waiting")
                is Standing.InSession -> Kept("in_session", session.id, session.classId, session.endsAt, state?.wire)
                Standing.Unread -> throw IllegalArgumentException("Where the phone stands unread is never kept")
            }
        return BaliJson.encodeToString(Kept.serializer(), kept)
    }

/**
 * The standing [text] keeps, as every later build must read it: a key a later build adds is passed
 * over, and a state it adds is none, never focus. One this build can't read throws.
 */
internal fun keptStanding(text: String): Standing {
    val kept = BaliJson.decodeFromString(Kept.serializer(), text)
    fun missing(key: String): Nothing = throw SerializationException("A standing in a session, with no $key")
    return when (kept.standing) {
        "out" -> Standing.Out
        "waiting" -> Standing.Waiting
        "in_session" ->
            Standing.InSession(
                SessionView(kept.sessionId ?: missing("sessionId"), kept.classId ?: missing("classId"), kept.endsAt ?: missing("endsAt")),
                kept.state?.let(ParticipationState.Wire::of),
            )
        else -> throw SerializationException("No standing ${kept.standing}")
    }
}
