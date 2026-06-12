import Foundation
import SwiftUI

// Teacher wire models — Swift mirrors of @bali/shared DTOs + classCard payloads.

struct TClassCard: Codable, Identifiable {
    struct Live: Codable {
        var sessionId: String
        var endsAt: Date
        var endsAtLabel: String
    }

    var id: String
    var name: String
    var daysLabel: String
    var startTime: String
    var endTime: String
    var joinCode: String
    var requireApproval: Bool
    var memberCount: Int
    var policyId: String?
    var policyName: String?
    var allowedAppLabels: [String]
    var live: Live?
}

struct TPolicy: Codable, Identifiable {
    var id: String
    var name: String
    var messagesAllowed: Bool
    var allowedAppLabels: [String]
    var usedByClasses: Int
}

struct TParticipant: Codable, Identifiable {
    var participationId: String?
    var studentId: String
    var firstName: String
    var lastName: String
    var shortName: String
    var state: String
    var passRemainingSeconds: Int?
    var passEndsAt: Date?
    var staleSeconds: Int?
    var isStale: Bool
    var tappedInAt: Date?
    var pendingUnlockId: String?
    var id: String { studentId }
}

struct TSessionDTO: Codable {
    var id: String
    var classId: String
    var className: String
    var policyName: String
    var allowedAppLabels: [String]
    var messagesAllowed: Bool
    var startedAt: Date
    var endsAt: Date
    var endedAt: Date?
}

struct TSessionDetail: Codable {
    var session: TSessionDTO
    var participants: [TParticipant]
    var counts: [String: Int]
}

struct TTag: Codable, Identifiable {
    var id: String
    var classId: String
    var className: String
    var label: String
    var code: String
    var active: Bool
}

struct TTagList: Codable {
    var tags: [TTag]
}

struct TSettings: Codable {
    var name: String
    var displayName: String
    var email: String
    var schoolName: String
    var notifyEmergency: Bool
    var notifyRevoked: Bool
    var notifyWeekly: Bool
    var notifyPassEndings: Bool
}

struct TEvent: Codable, Identifiable {
    var id: String
    var type: String
    var at: Date
    var title: String
    var subtitle: String?
}

// Bodies
struct StartSessionBody: Encodable {
    var endsAt: Date
    var policyId: String?
}

struct ExtendBody: Encodable { var minutes: Int }
struct PassBody: Encodable {
    var studentId: String
    var minutes: Int
    var reason: String?
}

struct NoDeviceBody: Encodable {
    var studentId: String
    var on: Bool
}

struct CreateTagBody: Encodable { var label: String }
struct CreateClassBody: Encodable {
    var name: String
    var daysLabel: String
    var startTime: String
    var endTime: String
    var policyId: String?
    var requireApproval: Bool
}

// MARK: chip styling shared by T2/T3/T5

enum TChip {
    /// state key → (icon, label, fg, bg) in the light theme.
    static func style(_ state: String) -> (icon: String, label: String, fg: Color, bg: Color) {
        switch state {
        case "focused":
            return ("checkmark.circle", "Focused", Tokens.Light.stateFocusedFg, Tokens.Light.stateFocusedBg)
        case "pass":
            return ("ticket", "Pass", Tokens.Light.statePassFg, Tokens.Light.statePassBg)
        case "emergency_unlocked":
            return ("lock.open", "Unlocked", Tokens.Light.stateEmergencyFg, Tokens.Light.stateEmergencyBg)
        case "revoked":
            return ("shield.slash", "Perm. off", Tokens.Light.stateRevokedFg, Tokens.Light.stateRevokedBg)
        case "no_device":
            return ("iphone.slash", "No device", Tokens.Light.stateNodeviceFg, .clear)
        case "ended":
            return ("flag", "Ended", Tokens.Light.stateEndedFg, Tokens.Light.stateEndedBg)
        default:
            return ("circle", "Not in", Tokens.Light.stateNotjoinedFg, Tokens.Light.stateNotjoinedBg)
        }
    }
}

let mmss: (TimeInterval) -> String = { interval in
    let s = max(0, Int(interval))
    return String(format: "%d:%02d", s / 60, s % 60)
}

let hmm: (Date) -> String = { date in
    let fmt = DateFormatter()
    fmt.timeStyle = .short
    return fmt.string(from: date)
}
