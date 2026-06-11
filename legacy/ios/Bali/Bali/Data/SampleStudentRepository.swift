//
//  SampleStudentRepository.swift
//  Bali — data
//
//  Canned fixtures (Maya Chen @ Lincoln High) so the full dashboard runs on the
//  Simulator with no backend. Three classes exercise the key states: AP Biology
//  is LIVE with a Full Focus policy (not yet checked in), World History uses No
//  Social Media, Algebra II uses No Games; a Chemistry invite is pending. Names,
//  periods, and rates mirror the design handoff screenshots. The sync `sample*`
//  builders are reused by AppModel.preview for instant previews.
//

import Foundation

nonisolated struct SampleStudentRepository: StudentRepository {
    func fetchSelf() async throws -> StudentSelf { Self.sampleSelf() }

    func fetchClassDetail(classId: String) async throws -> StudentClassDetail {
        Self.detail(classId: classId)
    }

    func updateProfile(_ update: StudentProfileUpdate) async throws -> StudentSelf {
        let base = Self.sampleSelf()
        let edited = Student(
            id: Self.student.id, firstName: update.firstName, lastName: update.lastName,
            email: Self.student.email, grade: update.grade, schoolId: Self.student.schoolId,
            externalId: nil, notes: Self.student.notes)
        return StudentSelf(student: edited, classes: base.classes, pendingInvites: base.pendingInvites)
    }

    func fetchExtras() async -> StudentExtras { Self.sampleExtras() }

    func joinPreview(_ token: String) async throws -> ClassJoinPreview {
        let key = token.uppercased().trimmingCharacters(in: .whitespaces)
        // The pending Chemistry invite, joinable by its sample code / link id.
        if ["7K2-Q9F", "7K2Q9F", "CHEM01", "CHEMISTRY", "CLS-CHEM"].contains(key) {
            return ClassJoinPreview(
                classId: "cls-chem", className: "Chemistry", period: "Period 6",
                teacherName: "Dr. Park", schoolName: "Lincoln High", alreadyEnrolled: false)
        }
        // An already-enrolled class (by id or name) — shows the "already joined" state.
        if let existing = Self.sampleSelf().classes
            .first(where: { $0.id.uppercased() == key || $0.name.uppercased() == key }) {
            return ClassJoinPreview(
                classId: existing.id, className: existing.name, period: existing.period,
                teacherName: existing.teacherName, schoolName: existing.schoolName,
                alreadyEnrolled: true)
        }
        throw APIError.http(status: 404, message: "We couldn't find a class for that code.")
    }

    func joinClass(classId: String) async throws { /* sample: AppModel adds optimistically */ }
    func acceptInvite(inviteId: String) async throws { /* sample: AppModel updates locally */ }

    // MARK: - Sync fixture builders (also used by AppModel.preview)

    static let student = Student(
        id: "stu-maya", firstName: "Maya", lastName: "Chen",
        email: "maya.chen@lincoln.edu", grade: "11", schoolId: "sch-lincoln",
        externalId: nil, notes: nil)

    static func sampleSelf(now: Date = Date()) -> StudentSelf {
        StudentSelf(
            student: student,
            classes: [
                StudentClassSummary(
                    id: "cls-bio", name: "AP Biology", period: "Period 1",
                    teacherName: "Mr. Okafor", schoolName: "Lincoln High",
                    activeSession: ActiveSessionSummary(
                        id: "ses-bio", startedAt: iso(now.addingTimeInterval(-8 * 60)),
                        blockingEnabled: true, checkedIn: false, attendanceStatus: nil),
                    attendanceRate: 96, totalSessions: 43),
                StudentClassSummary(
                    id: "cls-hist", name: "World History", period: "Period 3",
                    teacherName: "Ms. Reyes", schoolName: "Lincoln High",
                    activeSession: nil, attendanceRate: 88, totalSessions: 33),
                StudentClassSummary(
                    id: "cls-alg", name: "Algebra II", period: "Period 5",
                    teacherName: "Mr. Stein", schoolName: "Lincoln High",
                    activeSession: nil, attendanceRate: 92, totalSessions: 28),
            ],
            pendingInvites: [
                PendingInvite(
                    inviteId: "inv-chem", classId: "cls-chem", className: "Chemistry",
                    period: "Period 6", teacherName: "Dr. Park", schoolName: "Lincoln High",
                    invitedAt: iso(now.addingTimeInterval(-26 * 3600))),
            ])
    }

    static func sampleExtras() -> StudentExtras {
        StudentExtras(
            presentations: [
                "cls-bio": ClassPresentation(policy: fullFocus, seat: "Lab Bench 3", nextLabel: nil),
                "cls-hist": ClassPresentation(policy: noSocial, seat: "Row 2 · Seat 4", nextLabel: "Next 11:15 AM"),
                "cls-alg": ClassPresentation(policy: noGames, seat: "Seat 12", nextLabel: "Next 1:30 PM"),
            ],
            streak: 14)
    }

    static func detail(classId: String, now: Date = Date()) -> StudentClassDetail {
        switch classId {
        case "cls-bio":  return bioDetail(now: now)
        case "cls-alg":  return algDetail(now: now)
        default:         return histDetail(now: now)
        }
    }

    // MARK: - Policy snapshots (mirror resolveBlockingSnapshot output)

    static let fullFocus = BlockingSnapshot(
        preset: .fullFocus, mode: .blockAllExcept, blockingActive: true,
        blockedApps: [],
        allowedApps: [
            e("com.apple.mobilephone", "Phone"), e("com.apple.MobileSMS", "iMessage"),
            e("com.apple.calculator", "Calculator"), e("com.apple.camera", "Camera"),
            e("com.apple.clock", "Clock"), e("com.apple.mobilesafari", "Safari"),
            e("com.apple.mobilenotes", "Notes"),
        ])

    static let noSocial = BlockingSnapshot(
        preset: .noSocialMedia, mode: .blockSpecific, blockingActive: true,
        blockedApps: [
            e("com.burbn.instagram", "Instagram"), e("com.zhiliaoapp.musically", "TikTok"),
            e("com.toyopagroup.picaboo", "Snapchat"), e("com.facebook.Facebook", "Facebook"),
            e("com.atebits.Tweetie2", "Twitter/X"), e("com.google.ios.youtube", "YouTube"),
        ], allowedApps: [])

    static let noGames = BlockingSnapshot(
        preset: .noGames, mode: .blockSpecific, blockingActive: true,
        blockedApps: [
            e("com.supercell.laser", "Brawl Stars"), e("com.innersloth.amongus", "Among Us"),
            e("com.mojang.minecraftpe", "Minecraft"), e("com.roblox.robloxmobile", "Roblox"),
            e("com.supercell.scroll", "Clash Royale"),
        ], allowedApps: [])

    // MARK: - Details

    private static func bioDetail(now: Date) -> StudentClassDetail {
        StudentClassDetail(
            classInfo: .init(id: "cls-bio", name: "AP Biology", period: "Period 1",
                             teacherName: "Mr. Okafor", schoolName: "Lincoln High"),
            attendance: AttendanceStats(rate: 96, total: 43, present: 41, late: 1, absent: 1, excused: 0),
            activeSession: StudentActiveSessionInfo(
                id: "ses-bio", startedAt: iso(now.addingTimeInterval(-8 * 60)),
                blockingEnabled: true, checkedIn: false, attendanceStatus: nil,
                checkInAt: nil, blockingSnapshot: fullFocus, deviceBlockingStatus: nil),
            recentSessions: history(now: now),
            device: deviceRef)
    }

    private static func histDetail(now: Date) -> StudentClassDetail {
        StudentClassDetail(
            classInfo: .init(id: "cls-hist", name: "World History", period: "Period 3",
                             teacherName: "Ms. Reyes", schoolName: "Lincoln High"),
            attendance: AttendanceStats(rate: 88, total: 33, present: 27, late: 2, absent: 3, excused: 1),
            activeSession: nil,
            recentSessions: history(now: now),
            device: deviceRef)
    }

    private static func algDetail(now: Date) -> StudentClassDetail {
        StudentClassDetail(
            classInfo: .init(id: "cls-alg", name: "Algebra II", period: "Period 5",
                             teacherName: "Mr. Stein", schoolName: "Lincoln High"),
            attendance: AttendanceStats(rate: 92, total: 28, present: 25, late: 1, absent: 2, excused: 0),
            activeSession: nil,
            recentSessions: history(now: now),
            device: deviceRef)
    }

    private static let deviceRef = StudentClassDetail.DeviceRef(
        deviceId: "BALI-MC-7F3A", friendlyName: "iPhone 15")

    private static func history(now: Date) -> [StudentSessionHistoryEntry] {
        func day(_ d: Int) -> Date { now.addingTimeInterval(-Double(d) * 86400) }
        return [
            .init(sessionId: "h1", startedAt: iso(day(1)), endedAt: iso(day(1).addingTimeInterval(3000)),
                  status: .present, checkInAt: iso(day(1)), isOverride: false, blockingStatus: .active),
            .init(sessionId: "h2", startedAt: iso(day(2)), endedAt: iso(day(2).addingTimeInterval(3000)),
                  status: .present, checkInAt: iso(day(2)), isOverride: false, blockingStatus: .active),
            .init(sessionId: "h3", startedAt: iso(day(3)), endedAt: iso(day(3).addingTimeInterval(3000)),
                  status: .late, checkInAt: iso(day(3).addingTimeInterval(420)), isOverride: false, blockingStatus: .active),
            .init(sessionId: "h4", startedAt: iso(day(5)), endedAt: iso(day(5).addingTimeInterval(3000)),
                  status: .present, checkInAt: iso(day(5)), isOverride: false, blockingStatus: .inactive),
            .init(sessionId: "h5", startedAt: iso(day(8)), endedAt: iso(day(8).addingTimeInterval(3000)),
                  status: .absent, checkInAt: nil, isOverride: false, blockingStatus: .noData),
        ]
    }

    // MARK: - Helpers

    private static func e(_ bundleId: String, _ name: String) -> BlockingAppEntry {
        BlockingAppEntry(bundleId: bundleId, appName: name)
    }

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }
}
