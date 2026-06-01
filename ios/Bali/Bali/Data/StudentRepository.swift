//
//  StudentRepository.swift
//  Bali — data
//
//  The data-access seam between AppModel and the network. Wraps APIClient with
//  typed student operations. A SampleStudentRepository (sibling file) returns
//  canned fixtures so the whole dashboard runs on the Simulator without a
//  backend; live vs sample is chosen in AppEnvironment, same split as auth.
//  Nonisolated data layer (see APIClient.swift).
//
//  Sidecar metadata: the DTOs don't carry a class's focus policy on the list, a
//  seat / block name, a next-class time, or a streak (all flagged in PLAN.md §9).
//  `ClassPresentation` / `StudentExtras` carry those best-effort — empty for the
//  live API today; AppModel also enriches `policy` from a loaded active session.
//

import Foundation

nonisolated struct ClassPresentation: Equatable, Sendable {
    /// The class's focus policy (from the active session, or sample sidecar).
    var policy: BlockingSnapshot?
    /// Seat / block label, e.g. "Lab Bench 3" (no DTO field — §9.8).
    var seat: String?
    /// Next meeting label, e.g. "Tomorrow · 9:00 AM" (no DTO field — §9).
    var nextLabel: String?

    init(policy: BlockingSnapshot? = nil, seat: String? = nil, nextLabel: String? = nil) {
        self.policy = policy
        self.seat = seat
        self.nextLabel = nextLabel
    }
}

nonisolated struct StudentExtras: Equatable, Sendable {
    var presentations: [String: ClassPresentation]
    /// On-time streak in days (client-side / sample only — §9.9). nil = hide.
    var streak: Int?

    init(presentations: [String: ClassPresentation] = [:], streak: Int? = nil) {
        self.presentations = presentations
        self.streak = streak
    }
}

protocol StudentRepository: Sendable {
    func fetchSelf() async throws -> StudentSelf
    func fetchClassDetail(classId: String) async throws -> StudentClassDetail
    func updateProfile(_ update: StudentProfileUpdate) async throws -> StudentSelf
    /// Preview a class to join. `token` is a classId (links carry it; the design's
    /// short "code" has no resolver yet — §9, so today it's treated as a classId).
    func joinPreview(_ token: String) async throws -> ClassJoinPreview
    func joinClass(classId: String) async throws
    func acceptInvite(inviteId: String) async throws
    /// Best-effort sidecar metadata the DTOs lack. Empty by default (live API).
    func fetchExtras() async -> StudentExtras
}

extension StudentRepository {
    nonisolated func fetchExtras() async -> StudentExtras { StudentExtras() }
}

/// Real repository — talks to the student JWT endpoints via APIClient.
nonisolated struct LiveStudentRepository: StudentRepository {
    let api: any APIClient

    func fetchSelf() async throws -> StudentSelf {
        try await api.get("students/me", as: StudentSelf.self)
    }

    func fetchClassDetail(classId: String) async throws -> StudentClassDetail {
        try await api.get("students/me/classes/\(classId)", as: StudentClassDetail.self)
    }

    func updateProfile(_ update: StudentProfileUpdate) async throws -> StudentSelf {
        try await api.post("students/me", body: update, as: StudentSelf.self)
    }

    func joinPreview(_ token: String) async throws -> ClassJoinPreview {
        try await api.get("classes/\(token)/preview", as: ClassJoinPreview.self)
    }

    func joinClass(classId: String) async throws {
        try await api.postVoid("classes/\(classId)/join", body: nil)
    }

    func acceptInvite(inviteId: String) async throws {
        try await api.postVoid("invites/\(inviteId)/accept", body: nil)
    }
    // fetchExtras() uses the default (empty) — the live API carries no sidecar yet.
}
