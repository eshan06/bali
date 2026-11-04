@file:UseContextualSerialization(Instant::class)

package com.bali.core

import java.time.Instant
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseContextualSerialization

// The student endpoints' bodies, BaliCore's API.swift's twin: each mirrors its namesake in
// packages/shared/src/api.ts, which says what every field means. `/v1` is additive-only, so what
// is added there is added here: the contract tests decode every fixture in contracts/fixtures/ and
// go red until it is. Times are `Instant`s (BaliJson's `WireTime`); an answer reads its vocabulary
// through `OrUnknown`. A class is `class` on the wire, Kotlin's own word: here, `schoolClass`.

/**
 * The order the phone acted in (A12), on a counter no clock moves: [seq] is the action's place on
 * the counter of the outbox file [install] names, never reused or lowered. The server orders by it.
 */
@Serializable
data class ActionOrder(val install: String, val seq: Long)

/** A session as a student's phone sees it, to reconcile to: [endsAt] is its bell. */
@Serializable
data class SessionView(val id: String, val classId: String, val endsAt: Instant)

/**
 * A class, and what `GET /v1/me` adds under one: its [teacher] (C2a), the student's [enrollmentId]
 * (A19: what leaving deletes) and its [liveSession] by the server's clock (C3c). Each is none where
 * a class is named without them (a join's, a preview's, a history moment's), from an older API, on
 * a teacher's own class, and, for [liveSession], where none runs: an absent field is no refusal.
 */
@Serializable
data class MeClass(
    val id: String,
    val name: String,
    val teacher: TeacherView?,
    val enrollmentId: String?,
    val liveSession: LiveSession?,
)

/**
 * A class's session running now, as `GET /v1/me` names it under the class (C3c). Only the student
 * web reads [startedAt] (W3, additive), none from an older API.
 */
@Serializable
data class LiveSession(val id: String, val startedAt: Instant?, val endsAt: Instant)

@Serializable
data class MeUser(val id: String, val role: OrUnknown<UserRole>, val displayName: String?)

/** A teacher as a student's phone sees them: no display name when their account carries none. */
@Serializable
data class TeacherView(val displayName: String?)

/** `GET /v1/me`, the boot call. */
@Serializable
data class MeResponse(
    val user: MeUser,
    val classes: List<MeClass>,
    val session: Session?,
    /**
     * Whether a tap of the student's waits for a Start that would join them (#166): false once
     * none does, so a phone waiting for its teacher's Start stops waiting. None from an older API,
     * and in an answer the phone rebuilds (a join, a rename, a leave), its read already applied.
     */
    val armed: Boolean? = null,
) {
    /** The student's live session: a [SessionView] with its derived display state. */
    @Serializable
    data class Session(val id: String, val classId: String, val endsAt: Instant, val state: OrUnknown<DisplayState>)
}

/** `PATCH /v1/me`: a student sets their own display name. */
@Serializable
data class UpdateMeRequest(val displayName: String, val eventId: String)

@Serializable
data class UpdateMeResponse(val outcome: OrUnknown<Outcome>, val user: MeUser) {
    /** `UPDATE_ME_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Applied("applied"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `DELETE /v1/me`: the student deletes their own account (C3). */
@Serializable
data class DeleteMeRequest(val eventId: String)

@Serializable
data class DeleteMeResponse(val outcome: OrUnknown<Outcome>) {
    /** `DELETE_ME_OUTCOMES`: either way, this sign-in has no account now. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Deleted("deleted"), AlreadyDeleted("already_deleted");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/**
 * `GET` and `PUT /v1/me/age-check` (C7-server): whether this account confirmed it is 13 or older,
 * kept on the server, never the date. No account is `false`; a teacher's is always `true`.
 */
@Serializable
data class AgeCheckResponse(val passed: Boolean)

/** `PUT /v1/me/age-check`: the account's yes, sent only for 13 or older; under 13, nothing is. */
@Serializable
data class RecordAgeCheckRequest(val eventId: String)

/** `PUT /v1/me/push-token`: the student's push token (N3), APNs's until AN11 adds FCM's. */
@Serializable
data class RegisterPushTokenRequest(val token: String, val environment: PushEnvironment, val eventId: String)

@Serializable
data class RegisterPushTokenResponse(val outcome: OrUnknown<Outcome>, val environment: OrUnknown<PushEnvironment>) {
    /** `REGISTER_PUSH_TOKEN_OUTCOMES`: either way, the token is this account's now. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Registered("registered"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `DELETE /v1/me/push-token`: a student removes its phone's token. */
@Serializable
data class RemovePushTokenRequest(val token: String, val eventId: String)

@Serializable
data class RemovePushTokenResponse(val outcome: OrUnknown<Outcome>) {
    /** `REMOVE_PUSH_TOKEN_OUTCOMES`: either way, the token is not this account's now. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Removed("removed"), NotRegistered("not_registered");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `POST /v1/taps`. An order of none is left out of the body, as in every request. */
@Serializable
data class TapRequest(val tagId: String, val eventId: String, val deviceTime: Instant, val order: ActionOrder? = null)

@Serializable
data class TapResponse(
    val outcome: OrUnknown<TapOutcome>,
    val session: SessionView?,
    val state: OrUnknown<ParticipationState>?,
)

/** `POST /v1/sessions/{id}/checkin`: the 30-second "still here". */
@Serializable
data class CheckInRequest(val deviceTime: Instant)

@Serializable
data class CheckInResponse(
    val status: OrUnknown<Status>,
    val state: OrUnknown<ParticipationState>?,
    val session: SessionView?,
) {
    /** `CHECK_IN_STATUSES`. */
    @Serializable(with = Status.Wire::class)
    enum class Status(override val wire: String) : Vocabulary {
        Live("live"), Gone("gone");
        object Wire : VocabularySerializer<Status>(entries)
    }
}

/**
 * `POST /v1/sessions/{id}/unlock`, the emergency unlock, recorded whatever the answer, and
 * `POST /v1/taps/{eventId}/unlock`, the same under its own unanswered tap; no reason, none sent.
 */
@Serializable
data class UnlockRequest(
    val eventId: String,
    val deviceTime: Instant,
    val reason: UnlockReason? = null,
    val order: ActionOrder? = null,
)

@Serializable
data class UnlockResponse(
    val outcome: OrUnknown<UnlockOutcome>,
    val recordedAs: OrUnknown<UnlockRecordedAs>?,
    val state: OrUnknown<ParticipationState>?,
    val session: SessionView?,
    val reason: OrUnknown<UnlockReason>?,
)

/** `PATCH /v1/unlocks/{eventId}`: an unlock's new reason (A20), sent under an id of its own. */
@Serializable
data class UnlockReasonRequest(val reason: UnlockReason, val eventId: String)

/** The unlock's [reason] now: this change's, or on a replay the latest since. */
@Serializable
data class UnlockReasonResponse(val outcome: OrUnknown<Outcome>, val reason: OrUnknown<UnlockReason>) {
    /** `UNLOCK_REASON_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Applied("applied"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `POST /v1/sessions/{id}/refocus`: back to focus after an unlock. */
@Serializable
data class RefocusRequest(val eventId: String, val deviceTime: Instant, val order: ActionOrder? = null)

@Serializable
data class RefocusResponse(
    val outcome: OrUnknown<Outcome>,
    val state: OrUnknown<ParticipationState>?,
    val session: SessionView?,
) {
    /** `REFOCUS_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Applied("applied"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `POST /v1/sessions/{id}/protection-off`: the phone found Bali's lock switched off. */
@Serializable
data class ProtectionOffRequest(val eventId: String, val deviceTime: Instant, val order: ActionOrder? = null)

@Serializable
data class ProtectionOffResponse(
    val outcome: OrUnknown<Outcome>,
    val recordedAs: OrUnknown<ProtectionOffRecordedAs>?,
    val state: OrUnknown<ParticipationState>?,
    val session: SessionView?,
) {
    /** `PROTECTION_OFF_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Applied("applied"), Recorded("recorded"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `POST /v1/sessions/{id}/protection-on`: the lock back on, to the state before (#167). */
@Serializable
data class ProtectionOnRequest(val eventId: String, val deviceTime: Instant, val order: ActionOrder? = null)

/** [state]: where it returned the student, or on a replay the state now; none once they're out. */
@Serializable
data class ProtectionOnResponse(
    val outcome: OrUnknown<Outcome>,
    val state: OrUnknown<ParticipationState>?,
    val session: SessionView?,
) {
    /** `PROTECTION_ON_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Applied("applied"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `POST /v1/enrollments`: join a class by its code. */
@Serializable
data class EnrollmentJoinRequest(val joinCode: String, val eventId: String, val deviceTime: Instant)

@Serializable
data class EnrollmentJoinResponse(
    val outcome: OrUnknown<Outcome>,
    val enrollmentId: String,
    @SerialName("class") val schoolClass: MeClass,
) {
    /** `ENROLLMENT_JOIN_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Joined("joined"), AlreadyEnrolled("already_enrolled");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}

/** `DELETE /v1/enrollments/{id}`: leave a class (A19); `409 class_in_session` while one runs. */
@Serializable
data class EndEnrollmentRequest(val eventId: String)

@Serializable
data class EndEnrollmentResponse(
    val outcome: OrUnknown<Outcome>,
    val reason: OrUnknown<Reason>,
    val endedParticipation: Boolean,
) {
    /** `END_ENROLLMENT_OUTCOMES`. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Ended("ended"), AlreadyRemoved("already_removed");
        object Wire : VocabularySerializer<Outcome>(entries)
    }

    /** `END_ENROLLMENT_REASONS`: how the caller's action was classified. */
    @Serializable(with = Reason.Wire::class)
    enum class Reason(override val wire: String) : Vocabulary {
        LeftClass("left_class"), RemovedFromClass("removed_from_class");
        object Wire : VocabularySerializer<Reason>(entries)
    }
}

/** `GET /v1/join-codes/{code}`: what a join code opens, before joining it. */
@Serializable
data class JoinCodePreviewResponse(
    @SerialName("class") val schoolClass: MeClass,
    val teacher: TeacherView,
    val alreadyEnrolled: Boolean,
)

/**
 * One moment of `GET /v1/me/history`. Its [recordedAs] is an unlock's note, a protection off's or
 * a return's (A13): the last two are a subset of an unlock's.
 */
@Serializable
data class HistoryEvent(
    val eventId: String,
    val type: OrUnknown<HistoryEventType>,
    val occurredAt: Instant,
    @SerialName("class") val schoolClass: MeClass,
    val teacher: TeacherView,
    val session: Session?,
    val reason: OrUnknown<UnlockReason>?,
    val recordedAs: OrUnknown<UnlockRecordedAs>?,
    val countedIn: MeClass?,
) {
    /** Its window: [endsAt] the scheduled end, [endedAt] the real one, none while it runs. */
    @Serializable
    data class Session(val id: String, val startedAt: Instant, val endsAt: Instant, val endedAt: Instant?)
}

/** `GET /v1/me/history?before=&limit=`: a page of the student's own history, newest first. */
@Serializable
data class HistoryPage(val events: List<HistoryEvent>, val nextBefore: String?)

/**
 * `GET /v1/sessions/{id}/presentation`, a live lesson as the phone shows it (L4), polled while the
 * session runs: the open [question], or the last closed one until another opens; the teacher's
 * [slide] (M3b), never a URL; the student's [phone] as the grid shows it (W1), these two none from
 * an older API. Each is none until there is one, and once [running] is false: stop polling.
 */
@Serializable
data class Presentation(
    val running: Boolean,
    val question: StudentQuestion?,
    val slide: Slide?,
    val phone: StudentPhone?,
)

/**
 * A page of a deck a running session shows, [page] from 1 to [pageCount] (`PdfRenderer`'s index is
 * `page - 1`): the deck's bytes are checked against [sha256], lowercase hex, before they show.
 */
@Serializable
data class Slide(val deckId: String, val sha256: String, val page: Int, val pageCount: Int)

/** `GET /v1/decks/{id}/download` (M3b): [url], a presigned GET good for minutes, never cached. */
@Serializable
data class DeckDownload(val url: String)

/** The student's phone now, by the server's clock: never `ended`, and [lastSeenAt] once silent. */
@Serializable
data class StudentPhone(val state: OrUnknown<DisplayState>, val lastSeenAt: Instant?)

/**
 * A live lesson's question as a student sees it, never anyone's counts: 2 to 6 [options], an
 * answer naming one by its index and counting only while the question is [open], by the server's
 * clock; [correctOption] once the teacher's close revealed it; [answer], the student's own, if any.
 */
@Serializable
data class StudentQuestion(
    val id: String,
    val prompt: String,
    val options: List<String>,
    val open: Boolean,
    val correctOption: Int?,
    val answer: StudentAnswer?,
)

/** A student's answer now; the next is minted after its [eventId], in UUIDv7's order. */
@Serializable
data class StudentAnswer(val option: Int, val eventId: String)

/** `POST /v1/questions/{id}/answers`: sent once, never queued, so never ahead of an unlock. */
@Serializable
data class AnswerRequest(val eventId: String, val option: Int)

@Serializable
data class AnswerResponse(val outcome: OrUnknown<Outcome>, val answer: StudentAnswer) {
    /** `ANSWER_OUTCOMES`: either way, [answer] is the answer the server holds. */
    @Serializable(with = Outcome.Wire::class)
    enum class Outcome(override val wire: String) : Vocabulary {
        Answered("answered"), Replay("replay");
        object Wire : VocabularySerializer<Outcome>(entries)
    }
}
