//
//  StudentModels.swift
//  Bali — models
//
//  Codable DTOs for the student JWT endpoints, mirroring `packages/shared`
//  (camelCase keys match the server, so no CodingKeys except where a key is a
//  Swift keyword). Endpoints return the object directly — there is no `{ data }`
//  envelope (server `json(x)` => `JSON.stringify(x)`); error bodies are
//  `{ error }`, mapped by APIError. All nonisolated so JSON decode runs off the
//  main actor.
//

import Foundation

// MARK: - Attendance

nonisolated enum AttendanceStatus: String, Codable, Equatable {
    case present, late, absent, excused

    var label: String {
        switch self {
        case .present: return "Present"
        case .late:    return "Late"
        case .absent:  return "Absent"
        case .excused: return "Excused"
        }
    }
}

/// Per-session blocking outcome shown in history (display-only; unknown → noData).
nonisolated enum SessionBlockingStatus: String, Codable, Equatable {
    case active
    case inactive
    case studentOverride = "student_override"
    case disabled
    case noData = "no_data"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SessionBlockingStatus(rawValue: raw) ?? .noData
    }
}

// MARK: - GET /students/me  ->  StudentSelf

nonisolated struct StudentSelf: Codable, Equatable {
    let student: Student
    let classes: [StudentClassSummary]
    let pendingInvites: [PendingInvite]
}

nonisolated struct StudentClassSummary: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let period: String?
    let teacherName: String
    let schoolName: String?
    let activeSession: ActiveSessionSummary?
    let attendanceRate: Double      // integer percent 0...100 from the server
    let totalSessions: Int

    /// 0...1 for the attendance ring.
    var attendanceFraction: Double { min(max(attendanceRate / 100, 0), 1) }
}

nonisolated struct ActiveSessionSummary: Codable, Equatable {
    let id: String
    let startedAt: String
    let blockingEnabled: Bool
    let checkedIn: Bool
    let attendanceStatus: AttendanceStatus?   // present | late | absent | excused | nil
}

nonisolated struct PendingInvite: Codable, Equatable, Identifiable {
    let inviteId: String
    let classId: String
    let className: String
    let period: String?
    let teacherName: String
    let schoolName: String?
    let invitedAt: String
    var id: String { inviteId }
}

// MARK: - GET /students/me/classes/{id}  ->  StudentClassDetail

nonisolated struct StudentClassDetail: Codable, Equatable {
    let classInfo: ClassInfo
    let attendance: AttendanceStats
    let activeSession: StudentActiveSessionInfo?
    let recentSessions: [StudentSessionHistoryEntry]
    let device: DeviceRef?

    nonisolated enum CodingKeys: String, CodingKey {
        case classInfo = "class"
        case attendance, activeSession, recentSessions, device
    }

    nonisolated struct ClassInfo: Codable, Equatable {
        let id: String
        let name: String
        let period: String?
        let teacherName: String
        let schoolName: String?
    }

    nonisolated struct DeviceRef: Codable, Equatable {
        let deviceId: String
        let friendlyName: String?
    }
}

nonisolated struct AttendanceStats: Codable, Equatable {
    let rate: Double      // integer percent 0...100
    let total: Int
    let present: Int
    let late: Int
    let absent: Int
    let excused: Int

    /// 0...1 for the attendance ring.
    var fraction: Double { min(max(rate / 100, 0), 1) }
}

nonisolated struct StudentActiveSessionInfo: Codable, Equatable {
    let id: String
    let startedAt: String
    let blockingEnabled: Bool
    let checkedIn: Bool
    let attendanceStatus: AttendanceStatus?   // present | late | nil
    let checkInAt: String?
    let blockingSnapshot: BlockingSnapshot
    let deviceBlockingStatus: DeviceBlockingStatus?

    nonisolated struct DeviceBlockingStatus: Codable, Equatable {
        let isBlocked: Bool
        let reportedAt: String
        let reportedBy: String     // manual | device | student_override
    }
}

nonisolated struct StudentSessionHistoryEntry: Codable, Equatable, Identifiable {
    let sessionId: String
    let startedAt: String
    let endedAt: String?
    let status: AttendanceStatus
    let checkInAt: String?
    let isOverride: Bool
    let blockingStatus: SessionBlockingStatus
    var id: String { sessionId }
}

// MARK: - Join / invites

nonisolated struct ClassJoinPreview: Codable, Equatable {
    let classId: String
    let className: String
    let period: String?
    let teacherName: String
    let schoolName: String?
    let alreadyEnrolled: Bool
}

// MARK: - Check-in
//
// Today the only student check-in path is POST .../simulate-check-in, which
// returns this shape (note: `checkInTime` + `blockingPolicy`, not the
// `checkInAt`/`blockingSnapshot` names used elsewhere). It is driven by a REAL
// Core NFC read behind CheckInService (Phase 6) — never a "simulate" UI control.

nonisolated struct CheckInResponse: Codable, Equatable {
    let success: Bool
    let sessionId: String
    let classId: String
    let attendanceStatus: AttendanceStatus   // present | late
    let checkInTime: String
    let blockingPolicy: BlockingSnapshot
}

// MARK: - POST /students/me  (profile update body)

nonisolated struct StudentProfileUpdate: Encodable, Equatable {
    let firstName: String
    let lastName: String
    let grade: String?
}
