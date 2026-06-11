import Foundation

// Wire models — Swift mirrors of @bali/shared DTOs. Dates as ISO-8601 strings.

struct StudentHome: Codable {
    var student: StudentSelf
    var classes: [StudentClass]
}

struct StudentSelf: Codable {
    var id: String
    var firstName: String
    var lastName: String
}

struct StudentClass: Codable, Identifiable {
    var membershipId: String
    var membershipStatus: String
    var classId: String
    var className: String
    var scheduleLabel: String
    var teacherDisplayName: String
    var live: LiveSession?
    var id: String { classId }
}

struct LiveSession: Codable {
    var sessionId: String
    var endsAt: Date
    var allowedAppLabels: [String]
    var messagesAllowed: Bool
    var policyName: String
    var mine: MyParticipation?
}

struct MyParticipation: Codable {
    var state: String
    var passEndsAt: Date?
    var pendingUnlockId: String?
}

struct JoinResult: Codable {
    var membershipStatus: String
    var classId: String
    var className: String
    var teacherDisplayName: String
    var scheduleLabel: String
    var allowedAppLabels: [String]
    var messagesAllowed: Bool
}

struct TagResolution: Codable, Identifiable {
    var variant: String // ready | not_member | session_not_started
    var classId: String
    var className: String
    var joinCode: String
    var teacherDisplayName: String
    var membershipStatus: String?
    var session: ResolvedSession?
    var id: String { classId + variant + (session?.sessionId ?? "") }

    private enum CodingKeys: String, CodingKey {
        case variant, classId, className, joinCode, teacherDisplayName, membershipStatus, session
    }
}

struct ResolvedSession: Codable {
    var sessionId: String
    var endsAt: Date
    var allowedAppLabels: [String]
    var messagesAllowed: Bool
    var policyName: String
}

struct TapInResult: Codable {
    var state: String
    var alreadyIn: Bool
}

struct HeartbeatResult: Codable {
    struct SessionInfo: Codable {
        var endsAt: Date
        var endedAt: Date?
    }
    var session: SessionInfo
    var state: String
    var passEndsAt: Date?
    var allowedAppLabels: [String]
    var messagesAllowed: Bool
}

struct UnlockResult: Codable {
    var unlockId: String?
    var recorded: Bool
}

struct BootstrapResult: Codable {
    var role: String
}
