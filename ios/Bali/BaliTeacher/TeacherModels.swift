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
    // Addendum additions (always present from classCard; optional for decode resilience).
    var autoApprove: Bool?
    var archived: Bool?
    var lastMetLabel: String?

    /// "MWF · 9:50–10:45 · 28 students" — the T6 header / class-card meta line.
    var scheduleLabel: String { "\(daysLabel) · \(startTime)–\(endTime)" }
    var studentsLabel: String { "\(memberCount) student\(memberCount == 1 ? "" : "s")" }
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

struct UpdateClassBody: Encodable {
    var name: String?
    var daysLabel: String?
    var startTime: String?
    var endTime: String?
    var policyId: String?
    var requireApproval: Bool?
    var archived: Bool?
}

struct CreatePolicyBody: Encodable {
    var name: String
    var messagesAllowed: Bool
    var allowedAppLabels: [String]
}

struct UpdatePolicyBody: Encodable {
    var name: String?
    var messagesAllowed: Bool?
    var allowedAppLabels: [String]?
}

struct UpdateMembershipBody: Encodable { var defaultNoDevice: Bool }

// MARK: T1 portal home

struct THome: Codable {
    struct Teacher: Codable { var displayName: String; var schoolName: String }
    var teacher: Teacher
    var dateLabel: String
    var nextBell: String?
    var live: TSessionDetail?
    /// The class cards — folded into the hub payload so T1 loads in a single round-trip.
    var classes: [TClassCard]
    var today: [THomeRow]
    var approvals: [THomeApproval]
    var recent: [TEvent]
}

struct THomeRow: Codable, Identifiable {
    var kind: String            // "now" | "past" | "future"
    var classId: String
    var sessionId: String?
    var name: String
    var timeLabel: String
    var subtitle: String?
    var policyName: String?
    var startLabel: String?
    var endsAtIso: String?
    var id: String { classId }
}

struct THomeApproval: Codable, Identifiable {
    var membershipId: String
    var classId: String
    var name: String
    var className: String
    var requestedAt: Date
    var id: String { membershipId }
}

// MARK: T6 overview · T10 recap · T3 recent

struct TClassOverview: Codable {
    struct LastSession: Codable {
        var sessionId: String
        var dayLabel: String
        var durationMinutes: Int
        var durationLabel: String
        var focusedCount: Int
        var totalMembers: Int
    }
    var classId: String
    var memberCount: Int
    var sessionsThisWeek: Int
    var medianFocusMinutes: Int?
    var lastSession: LastSession?
}

struct TRecapEmergency: Codable, Identifiable {
    var studentId: String
    var studentName: String
    var shortName: String
    var atLabel: String
    var reasonLabel: String
    var refocusedLabel: String?
    var nudge: String
    var id: String { studentId + atLabel }
}

struct TRecap: Codable {
    var sessionId: String
    var classId: String
    var className: String
    var scheduleLabel: String
    var durationMinutes: Int
    var durationLabel: String
    var endReason: String?
    var endedEarly: Bool
    var isLive: Bool
    var focusedCount: Int
    var emergencyCount: Int
    var passCount: Int
    var permissionOffCount: Int
    var neverJoinedCount: Int
    var studentsTappedIn: Int
    var totalMembers: Int
    var medianFocusMinutes: Int?
    var noDeviceNames: [String]
    var clean: Bool
    var emergencies: [TRecapEmergency]
    var framing: String
}

struct TStudentHistoryRow: Codable, Identifiable {
    var sessionId: String
    var dayLabel: String
    var state: String
    var label: String
    var id: String { sessionId }
}

struct TStudentHistory: Codable {
    var studentId: String
    var studentName: String
    var shortName: String
    var rows: [TStudentHistoryRow]
    var framing: String
    var boundary: String
}

// MARK: T7 roster (full)

struct TRosterMember: Codable, Identifiable {
    var membershipId: String
    var studentId: String
    var name: String
    var joinedAt: Date
    var source: String
    var defaultNoDevice: Bool
    var current: TParticipant?
    var id: String { membershipId }
}

struct TJoinRequest: Codable, Identifiable {
    var membershipId: String
    var studentId: String
    var name: String
    var requestedAt: Date
    var source: String
    var id: String { membershipId }
}

struct TRoster: Codable {
    var cls: TClassCard
    var members: [TRosterMember]
    var pending: [TJoinRequest]
    enum CodingKeys: String, CodingKey { case cls = "class", members, pending }
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

/// "just now" / "2 min ago" / "3 hr ago" / "Mon" — approvals + roster recency.
func relativeAgo(_ date: Date, now: Date = Date()) -> String {
    let seconds = Int(now.timeIntervalSince(date))
    if seconds < 60 { return "just now" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes) min ago" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours) hr ago" }
    if Calendar.current.isDateInYesterday(date) { return "yesterday" }
    let fmt = DateFormatter()
    fmt.dateFormat = "EEE"
    return fmt.string(from: date)
}

extension TClassCard {
    /// True when "now" falls inside today's meeting window — drives the context-aware
    /// Start action on T1 cards (the live case is handled separately).
    var isScheduledNow: Bool {
        guard let start = Self.todayAt(startTime), let end = Self.todayAt(endTime) else { return false }
        let now = Date()
        return now >= start && now <= end
    }

    static func todayAt(_ hhmm: String) -> Date? {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date())
    }
}
