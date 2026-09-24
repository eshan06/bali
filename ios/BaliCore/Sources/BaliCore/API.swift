import Foundation

// The student endpoints' bodies, each mirroring its namesake in packages/shared/src/api.ts, which
// says what every field means. `/v1` is additive-only, so what is added there is added here: the
// contract tests decode every fixture in contracts/fixtures/ and go red until it is. Ids are the
// API's strings, and times are `Date`s, coded as the API writes them by `BaliJSON`.

/// A session as a student's phone sees it, to reconcile to: `endsAt` is when its shields come off.
public struct SessionView: Codable, Sendable, Hashable {
    public let id: String
    public let classId: String
    public let endsAt: Date
    public init(id: String, classId: String, endsAt: Date) {
        (self.id, self.classId, self.endsAt) = (id, classId, endsAt)
    }
}

public struct MeClass: Codable, Sendable, Hashable {
    public let id: String
    public let name: String
}

public struct MeUser: Codable, Sendable, Hashable {
    public let id: String
    public let role: OrUnknown<UserRole>
    public let displayName: String?
}

/// A teacher as a student's phone sees them: no display name when their account carries none.
public struct TeacherView: Codable, Sendable, Hashable {
    public let displayName: String?
}

/// `GET /v1/me` — the boot call.
public struct MeResponse: Codable, Sendable, Hashable {
    /// The caller's live session: a `SessionView` with its derived display state.
    public struct Session: Codable, Sendable, Hashable {
        public let id: String
        public let classId: String
        public let endsAt: Date
        public let state: OrUnknown<DisplayState>
    }
    public let user: MeUser
    public let classes: [MeClass]
    public let session: Session?
}

/// `PATCH /v1/me` — a student sets their own display name.
public struct UpdateMeRequest: Codable, Sendable, Hashable {
    public let displayName: String
    public let eventId: String
    public init(displayName: String, eventId: String) {
        (self.displayName, self.eventId) = (displayName, eventId)
    }
}

public struct UpdateMeResponse: Codable, Sendable, Hashable {
    /// `UPDATE_ME_OUTCOMES`.
    public enum Outcome: String, CaseIterable, Sendable { case applied, replay }
    public let outcome: OrUnknown<Outcome>
    public let user: MeUser
}

/// `POST /v1/taps`.
public struct TapRequest: Codable, Sendable, Hashable {
    public let tagId: String
    public let eventId: String
    public let deviceTime: Date
    public init(tagId: String, eventId: String, deviceTime: Date) {
        (self.tagId, self.eventId, self.deviceTime) = (tagId, eventId, deviceTime)
    }
}

public struct TapResponse: Codable, Sendable, Hashable {
    public let outcome: OrUnknown<TapOutcome>
    public let session: SessionView?
    public let state: OrUnknown<ParticipationState>?
}

/// `POST /v1/sessions/{id}/checkin` — the every-30-seconds "still here".
public struct CheckInRequest: Codable, Sendable, Hashable {
    public let deviceTime: Date
    public init(deviceTime: Date) { self.deviceTime = deviceTime }
}

public struct CheckInResponse: Codable, Sendable, Hashable {
    /// `CHECK_IN_STATUSES`.
    public enum Status: String, CaseIterable, Sendable { case live, gone }
    public let status: OrUnknown<Status>
    public let state: OrUnknown<ParticipationState>?
    public let session: SessionView?
}

/// `POST /v1/sessions/{id}/unlock` — the emergency unlock, recorded whatever the answer — and
/// `POST /v1/taps/{eventId}/unlock`, the same unlock sent under the phone's own unanswered tap.
public struct UnlockRequest: Codable, Sendable, Hashable {
    public let eventId: String
    public let deviceTime: Date
    /// Optional and skippable; left out of the body when nil.
    public let reason: UnlockReason?
    public init(eventId: String, deviceTime: Date, reason: UnlockReason? = nil) {
        (self.eventId, self.deviceTime, self.reason) = (eventId, deviceTime, reason)
    }
}

public struct UnlockResponse: Codable, Sendable, Hashable {
    public let outcome: OrUnknown<UnlockOutcome>
    public let recordedAs: OrUnknown<UnlockRecordedAs>?
    public let state: OrUnknown<ParticipationState>?
    public let session: SessionView?
    public let reason: OrUnknown<UnlockReason>?
}

/// `POST /v1/sessions/{id}/refocus` — back to focus after an unlock.
public struct RefocusRequest: Codable, Sendable, Hashable {
    public let eventId: String
    public let deviceTime: Date
    public init(eventId: String, deviceTime: Date) {
        (self.eventId, self.deviceTime) = (eventId, deviceTime)
    }
}

public struct RefocusResponse: Codable, Sendable, Hashable {
    /// `REFOCUS_OUTCOMES`.
    public enum Outcome: String, CaseIterable, Sendable { case applied, replay }
    public let outcome: OrUnknown<Outcome>
    public let state: OrUnknown<ParticipationState>?
    public let session: SessionView?
}

/// `POST /v1/sessions/{id}/protection-off` — the phone found its Screen Time permission revoked.
public struct ProtectionOffRequest: Codable, Sendable, Hashable {
    public let eventId: String
    public let deviceTime: Date
    public init(eventId: String, deviceTime: Date) {
        (self.eventId, self.deviceTime) = (eventId, deviceTime)
    }
}

public struct ProtectionOffResponse: Codable, Sendable, Hashable {
    /// `PROTECTION_OFF_OUTCOMES`.
    public enum Outcome: String, CaseIterable, Sendable { case applied, recorded, replay }
    public let outcome: OrUnknown<Outcome>
    public let recordedAs: OrUnknown<ProtectionOffRecordedAs>?
    public let state: OrUnknown<ParticipationState>?
    public let session: SessionView?
}

/// `POST /v1/enrollments` — join a class by its code.
public struct EnrollmentJoinRequest: Codable, Sendable, Hashable {
    public let joinCode: String
    public let eventId: String
    public let deviceTime: Date
    public init(joinCode: String, eventId: String, deviceTime: Date) {
        (self.joinCode, self.eventId, self.deviceTime) = (joinCode, eventId, deviceTime)
    }
}

public struct EnrollmentJoinResponse: Codable, Sendable, Hashable {
    /// `ENROLLMENT_JOIN_OUTCOMES`.
    public enum Outcome: String, CaseIterable, Sendable {
        case joined, alreadyEnrolled = "already_enrolled"
    }
    public let outcome: OrUnknown<Outcome>
    public let enrollmentId: String
    public let `class`: MeClass
}

/// `DELETE /v1/enrollments/{id}` — leave a class.
public struct EndEnrollmentResponse: Codable, Sendable, Hashable {
    /// `END_ENROLLMENT_OUTCOMES`.
    public enum Outcome: String, CaseIterable, Sendable {
        case ended, alreadyRemoved = "already_removed"
    }
    /// `END_ENROLLMENT_REASONS`: how the caller's action was classified.
    public enum Reason: String, CaseIterable, Sendable {
        case leftClass = "left_class", removedFromClass = "removed_from_class"
    }
    public let outcome: OrUnknown<Outcome>
    public let reason: OrUnknown<Reason>
    public let endedParticipation: Bool
}

/// `GET /v1/join-codes/{code}` — what a join code opens, before joining it.
public struct JoinCodePreviewResponse: Codable, Sendable, Hashable {
    public let `class`: MeClass
    public let teacher: TeacherView
    public let alreadyEnrolled: Bool
}

/// One moment of `GET /v1/me/history`.
public struct HistoryEvent: Codable, Sendable, Hashable {
    /// Its session's window: `endsAt` the scheduled end, `endedAt` the real one (nil if running).
    public struct Session: Codable, Sendable, Hashable {
        public let id: String
        public let startedAt: Date
        public let endsAt: Date
        public let endedAt: Date?
    }
    public let eventId: String
    public let type: OrUnknown<HistoryEventType>
    public let occurredAt: Date
    public let `class`: MeClass
    public let teacher: TeacherView
    public let session: Session?
    public let reason: OrUnknown<UnlockReason>?
    /// An unlock's note or a protection off's — whose notes are a subset of an unlock's.
    public let recordedAs: OrUnknown<UnlockRecordedAs>?
    public let countedIn: MeClass?
}

/// `GET /v1/me/history?before=&limit=` — a page of the student's own history, newest first.
public struct HistoryPage: Codable, Sendable, Hashable {
    public let events: [HistoryEvent]
    public let nextBefore: String?
}
