package com.bali.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A value of one of `@bali/shared`'s closed vocabularies, [wire] the API's own spelling of it.
 * Each vocabulary is an enum of them, named for its list and in its list's order.
 */
interface Vocabulary {
    val wire: String
}

/**
 * A vocabulary's own coding, by each value's [Vocabulary.wire]. It sends any value, but reads one
 * only where [readsAlone], BaliCore's Codable ones: what the phone keeps and sends, a value it
 * doesn't know refused, as Swift's raw values do. Every other vocabulary is read through
 * [OrUnknown] only, as BaliCore can't decode it alone: so an answer's field that forgets
 * [OrUnknown] fails on the first answer it reads, not on a newer server's value.
 */
abstract class VocabularySerializer<K : Vocabulary>(
    private val values: List<K>,
    private val readsAlone: Boolean = false,
) : KSerializer<K> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(values.first().javaClass.name, PrimitiveKind.STRING)

    /** The value spelled [wire], or none. */
    fun of(wire: String): K? = values.firstOrNull { it.wire == wire }

    override fun serialize(encoder: Encoder, value: K) = encoder.encodeString(value.wire)

    override fun deserialize(decoder: Decoder): K {
        if (!readsAlone) throw SerializationException("${descriptor.serialName} is read through OrUnknown only")
        val wire = decoder.decodeString()
        return of(wire) ?: throw SerializationException("${descriptor.serialName} has no value \"$wire\" in this build")
    }
}

/**
 * A value of one of `@bali/shared`'s closed vocabularies, or one this build doesn't know.
 *
 * `/v1` is additive-only and old apps call forever, so a value a newer server sends must never
 * fail a decode: it arrives as [Unknown], and the app does what that vocabulary says of a value
 * it doesn't know. The contract tests decode strictly ([StrictJson]) instead, so they go red when
 * the API sends a value this module lacks.
 */
@Serializable(with = OrUnknownSerializer::class)
sealed class OrUnknown<out K : Vocabulary> {
    /** The value as the API spelled it. */
    abstract val wire: String

    /** The value, if this build knows it. */
    abstract val known: K?

    data class Known<out K : Vocabulary>(val value: K) : OrUnknown<K>() {
        override val wire: String get() = value.wire
        override val known: K get() = value
    }

    data class Unknown(override val wire: String) : OrUnknown<Nothing>() {
        override val known: Nothing? get() = null
    }
}

/** [OrUnknown]'s coding: a known value read as itself, any other kept as sent and sent back so. */
class OrUnknownSerializer<K : Vocabulary>(known: KSerializer<K>) : KSerializer<OrUnknown<K>> {
    private val vocabulary =
        requireNotNull(known as? VocabularySerializer<K>) { "${known.descriptor.serialName} is no vocabulary" }

    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.bali.core.OrUnknown<${known.descriptor.serialName}>", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: OrUnknown<K>) = encoder.encodeString(value.wire)

    override fun deserialize(decoder: Decoder): OrUnknown<K> {
        val wire = decoder.decodeString()
        vocabulary.of(wire)?.let { return OrUnknown.Known(it) }
        if (decoder.strictVocabulary) {
            throw SerializationException("${vocabulary.descriptor.serialName} has no value \"$wire\" in this build")
        }
        return OrUnknown.Unknown(wire)
    }
}

// The vocabularies, each named for its `@bali/shared` list; a value's `wire` is its wire value.

/** `USER_ROLES`. */
@Serializable(with = UserRole.Wire::class)
enum class UserRole(override val wire: String) : Vocabulary {
    Teacher("teacher"), Student("student");
    object Wire : VocabularySerializer<UserRole>(entries)
}

/** `PARTICIPATION_STATES`: a stored state, which the phone's records keep; an answer's is [OrUnknown]. */
@Serializable(with = ParticipationState.Wire::class)
enum class ParticipationState(override val wire: String) : Vocabulary {
    Focused("focused"), Unlocked("unlocked"), ProtectionOff("protection_off");
    object Wire : VocabularySerializer<ParticipationState>(entries, readsAlone = true)
}

/** `DisplayState`: a stored state, or one derived from it and the time (never stored). */
@Serializable(with = DisplayState.Wire::class)
enum class DisplayState(override val wire: String) : Vocabulary {
    Focused("focused"), Unlocked("unlocked"), ProtectionOff("protection_off"), Ended("ended"), Silent("silent");
    object Wire : VocabularySerializer<DisplayState>(entries)
}

/** `TAP_OUTCOMES`. */
@Serializable(with = TapOutcome.Wire::class)
enum class TapOutcome(override val wire: String) : Vocabulary {
    Joined("joined"), Switched("switched"), Armed("armed"), AlreadyArmed("already_armed"), Replay("replay");
    object Wire : VocabularySerializer<TapOutcome>(entries)
}

/** `UNLOCK_RECORDED_OUTCOMES`: every one means the unlock is recorded. */
@Serializable(with = UnlockOutcome.Wire::class)
enum class UnlockOutcome(override val wire: String) : Vocabulary {
    Applied("applied"), Recorded("recorded"), Replay("replay");
    object Wire : VocabularySerializer<UnlockOutcome>(entries)
}

/**
 * `STATE_CHANGE_OUTCOMES`: every outcome a refocus, a protection-off report or Screen Time back on
 * answers with, as `stateChangeDisposition` reads them all.
 */
@Serializable(with = StateChangeOutcome.Wire::class)
enum class StateChangeOutcome(override val wire: String) : Vocabulary {
    Applied("applied"), Recorded("recorded"), Replay("replay");
    object Wire : VocabularySerializer<StateChangeOutcome>(entries)
}

/**
 * `UNLOCK_RECORDED_AS`: why an unlock was recorded without flipping a participation.
 * [Superseded]: a late unlock, the student's own refocus or tap gone ahead of it, whose answer
 * names the state it left alone while the student is still in the session. [TapArmed] and
 * [UnknownTap]: an unlock sent under its tap kept with no session: the tap waits for its
 * teacher's Start, or the server has no tap of the student's by that id.
 */
@Serializable(with = UnlockRecordedAs.Wire::class)
enum class UnlockRecordedAs(override val wire: String) : Vocabulary {
    NoLiveParticipation("no_live_participation"), AfterSessionEnd("after_session_end"),
    UnknownSession("unknown_session"), NotEnrolled("not_enrolled"),
    ProtectionOff("protection_off"), Superseded("superseded"),
    TapArmed("tap_armed"), UnknownTap("unknown_tap");
    object Wire : VocabularySerializer<UnlockRecordedAs>(entries)
}

/** `PROTECTION_OFF_RECORDED_AS`: why a protection-off report was recorded without marking one. */
@Serializable(with = ProtectionOffRecordedAs.Wire::class)
enum class ProtectionOffRecordedAs(override val wire: String) : Vocabulary {
    AfterSessionEnd("after_session_end");
    object Wire : VocabularySerializer<ProtectionOffRecordedAs>(entries)
}

/**
 * `RETURN_RECORDED_AS`: why a return to focus, a refocus or a tap, was recorded without being
 * applied. [Superseded]: the phone made it before an unlock the server already had (A13), which
 * stands; the answer is its retry's, the truth now. So too Screen Time back on made before a
 * protection off the server already had (#167). A history shows it as `recordedAs`.
 */
@Serializable(with = ReturnRecordedAs.Wire::class)
enum class ReturnRecordedAs(override val wire: String) : Vocabulary {
    Superseded("superseded");
    object Wire : VocabularySerializer<ReturnRecordedAs>(entries)
}

/** `UNLOCK_REASONS`, which the phone sends; an answer carries one as [OrUnknown]. */
@Serializable(with = UnlockReason.Wire::class)
enum class UnlockReason(override val wire: String) : Vocabulary {
    Bathroom("bathroom"), Nurse("nurse"), Other("other");
    object Wire : VocabularySerializer<UnlockReason>(entries, readsAlone = true)
}

/**
 * `PUSH_ENVIRONMENTS`: the environment a device token was issued for, which the phone sends: an
 * APNs token's today; what it means for an FCM token is AN11's (docs/PLAN-ANDROID.md).
 */
@Serializable(with = PushEnvironment.Wire::class)
enum class PushEnvironment(override val wire: String) : Vocabulary {
    Sandbox("sandbox"), Production("production");
    object Wire : VocabularySerializer<PushEnvironment>(entries, readsAlone = true)
}

/** `HISTORY_EVENT_TYPES`: the moments a student's history shows; the app skips an unknown one. */
@Serializable(with = HistoryEventType.Wire::class)
enum class HistoryEventType(override val wire: String) : Vocabulary {
    TapIn("tap_in"), Refocus("refocus"), Unlock("unlock"), ProtectionOff("protection_off"),
    LeftForOtherSession("left_for_other_session"), EnrollmentLeft("enrollment_left"),
    EnrollmentRemoved("enrollment_removed"), ArmedTapSkipped("armed_tap_skipped"),
    SessionEnded("session_ended"), SessionExpired("session_expired"), ProtectionOn("protection_on");
    object Wire : VocabularySerializer<HistoryEventType>(entries)
}

/** `ApiErrorCode`: the keys of `API_ERROR_STATUS`, each a status's class. */
@Serializable(with = ApiErrorCode.Wire::class)
enum class ApiErrorCode(override val wire: String) : Vocabulary {
    BadInput("bad_input"), Unauthorized("unauthorized"), Forbidden("forbidden"), NotFound("not_found"),
    Conflict("conflict"), RateLimited("rate_limited"), Unavailable("unavailable"), Internal("internal");
    object Wire : VocabularySerializer<ApiErrorCode>(entries)
}

/** `API_ERROR_REASONS`: which refusal an error is, where its status alone doesn't say. */
@Serializable(with = ApiErrorReason.Wire::class)
enum class ApiErrorReason(override val wire: String) : Vocabulary {
    SessionNotFound("session_not_found"), SessionNotRunning("session_not_running"),
    NotParticipating("not_participating"), InvalidExtension("invalid_extension"),
    EventIdConflict("event_id_conflict"), ClassNotFound("class_not_found"),
    EnrollmentNotFound("enrollment_not_found"), ProtectionOff("protection_off"),
    UnknownUser("unknown_user"), EnrollmentNotYours("enrollment_not_yours"),
    InvalidRequest("invalid_request"), UnknownCursor("unknown_cursor"),
    DisplayNameInvalid("display_name_invalid"), DisplayNameTaken("display_name_taken"),
    ClassInSession("class_in_session"),
    UnlockNotFound("unlock_not_found"), UnlockSuperseded("unlock_superseded"),
    ProtectionNotOff("protection_not_off"),
    InviteCodeInvalid("invite_code_invalid"), InviteNotFound("invite_not_found"),
    InviteUsed("invite_used"), InviteExpired("invite_expired"),
    AlreadyTeacher("already_teacher"), StudentInClass("student_in_class"),
    TeacherHasClasses("teacher_has_classes"), AccountDeleted("account_deleted"),
    QuestionNotFound("question_not_found"), QuestionClosed("question_closed"),
    InvalidOption("invalid_option"), SavedQuestionNotFound("saved_question_not_found"),
    DeckNotFound("deck_not_found"), DeckStorageOff("deck_storage_off"),
    DeckNotReady("deck_not_ready"), DeckRejected("deck_rejected"),
    PageOutOfRange("page_out_of_range"), DeckInUse("deck_in_use"),
    SessionTooLong("session_too_long");
    object Wire : VocabularySerializer<ApiErrorReason>(entries)
}
