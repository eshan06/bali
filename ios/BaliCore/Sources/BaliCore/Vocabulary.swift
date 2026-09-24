import Foundation

/// A value of one of `@bali/shared`'s closed vocabularies, or one this build does not know.
///
/// `/v1` is additive-only and old apps call forever, so a value a newer server sends must never
/// fail a decode: it arrives as `.unknown`, and the app does what that vocabulary says of a value
/// it does not know. The contract tests decode strictly (`strictVocabulary`) instead, so they go
/// red when the API sends a value this package lacks.
public enum OrUnknown<Known: RawRepresentable & Sendable & Hashable>: Sendable, Hashable
where Known.RawValue == String {
    case known(Known)
    case unknown(String)

    public init(rawValue: String) {
        self = Known(rawValue: rawValue).map { .known($0) } ?? .unknown(rawValue)
    }

    public var rawValue: String {
        switch self {
        case .known(let value): value.rawValue
        case .unknown(let value): value
        }
    }

    public var known: Known? { if case .known(let value) = self { value } else { nil } }
}

extension OrUnknown: Codable {
    public init(from decoder: any Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
        if known == nil, decoder.userInfo[.strictVocabulary] as? Bool == true {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "\(Known.self) has no value \"\(rawValue)\" in this build"))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

extension CodingUserInfoKey {
    /// True: a vocabulary value this build does not know fails the decode (the contract tests).
    static let strictVocabulary = CodingUserInfoKey(rawValue: "bali.strictVocabulary")!
}

// The vocabularies, each named for its `@bali/shared` list; a case's raw value is its wire value.

/// `USER_ROLES`.
public enum UserRole: String, CaseIterable, Sendable { case teacher, student }
/// `PARTICIPATION_STATES`: a participation's stored state.
public enum ParticipationState: String, CaseIterable, Sendable {
    case focused, unlocked, protectionOff = "protection_off"
}
/// `DisplayState`: a stored state, or one derived from it and the time (never stored).
public enum DisplayState: String, CaseIterable, Sendable {
    case focused, unlocked, protectionOff = "protection_off", ended, silent
}
/// `TAP_OUTCOMES`.
public enum TapOutcome: String, CaseIterable, Sendable {
    case joined, switched, armed, alreadyArmed = "already_armed", replay
}
/// `UNLOCK_RECORDED_OUTCOMES`: every one means the unlock is recorded.
public enum UnlockOutcome: String, CaseIterable, Sendable { case applied, recorded, replay }
/// `STATE_CHANGE_OUTCOMES`: every outcome a refocus or a protection-off report answers with, as
/// `stateChangeDisposition` reads both.
public enum StateChangeOutcome: String, CaseIterable, Sendable { case applied, recorded, replay }
/// `UNLOCK_RECORDED_AS`: why an unlock was recorded without flipping a participation.
public enum UnlockRecordedAs: String, CaseIterable, Sendable {
    case noLiveParticipation = "no_live_participation", afterSessionEnd = "after_session_end"
    case unknownSession = "unknown_session", notEnrolled = "not_enrolled"
    case protectionOff = "protection_off"
}
/// `PROTECTION_OFF_RECORDED_AS`: why a protection-off report was recorded without marking one.
public enum ProtectionOffRecordedAs: String, CaseIterable, Sendable {
    case afterSessionEnd = "after_session_end"
}
/// `UNLOCK_REASONS`. Codable because the phone sends one; an answer carries it as `OrUnknown`.
public enum UnlockReason: String, CaseIterable, Sendable, Codable { case bathroom, nurse, other }
/// `HISTORY_EVENT_TYPES`: the moments a student's history shows; the app skips an unknown one.
public enum HistoryEventType: String, CaseIterable, Sendable {
    case tapIn = "tap_in", refocus, unlock, protectionOff = "protection_off"
    case leftForOtherSession = "left_for_other_session", enrollmentLeft = "enrollment_left"
    case enrollmentRemoved = "enrollment_removed", armedTapSkipped = "armed_tap_skipped"
    case sessionEnded = "session_ended", sessionExpired = "session_expired"
}
/// `ApiErrorCode`: the keys of `API_ERROR_STATUS`, each a status's class.
public enum ApiErrorCode: String, CaseIterable, Sendable {
    case badInput = "bad_input", unauthorized, forbidden, notFound = "not_found", conflict
    case rateLimited = "rate_limited", unavailable, `internal`
}
/// `API_ERROR_REASONS`: which refusal an error is, where its status alone does not say.
public enum ApiErrorReason: String, CaseIterable, Sendable, Encodable {
    case sessionNotFound = "session_not_found", sessionNotRunning = "session_not_running"
    case notParticipating = "not_participating", invalidExtension = "invalid_extension"
    case eventIdConflict = "event_id_conflict", classNotFound = "class_not_found"
    case enrollmentNotFound = "enrollment_not_found", protectionOff = "protection_off"
    case unknownUser = "unknown_user", enrollmentNotYours = "enrollment_not_yours"
    case invalidRequest = "invalid_request", unknownCursor = "unknown_cursor"
    case displayNameInvalid = "display_name_invalid", displayNameTaken = "display_name_taken"
}
