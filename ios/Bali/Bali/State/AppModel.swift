//
//  AppModel.swift
//  Bali — state
//
//  The dashboard store: the signed-in student, their classes + pending invites,
//  a per-class detail cache, and derived view state (the live class, whether
//  focus is active, average attendance). Talks only to StudentRepository; views
//  read it via @Environment(AppModel.self). @MainActor (it drives the UI); the
//  repository it calls is nonisolated, so network + JSON run off the main actor.
//

import SwiftUI

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case idle, loading, loaded, failed }

    private(set) var phase: Phase = .idle
    private(set) var student: Student?
    private(set) var classes: [StudentClassSummary] = []
    private(set) var invites: [PendingInvite] = []
    private(set) var extras = StudentExtras()
    private(set) var detailCache: [String: StudentClassDetail] = [:]
    var errorMessage: String?

    /// Session IDs checked in during this app run. Real Core NFC sets this in
    /// Phase 6 so the UI reflects a check-in immediately, before the next poll.
    private(set) var locallyCheckedIn: Set<String> = []

    private let repo: StudentRepository

    init(repo: StudentRepository) { self.repo = repo }

    // MARK: - Derived

    /// The class with an active session right now (if any).
    var liveClass: StudentClassSummary? { classes.first { $0.activeSession != nil } }

    /// The live class the student has checked into with blocking on — Focus Mode.
    var focusActiveClass: StudentClassSummary? {
        classes.first { summary in
            guard let s = summary.activeSession, s.blockingEnabled else { return false }
            return isCheckedIn(summary)
        }
    }

    /// Average attendance across classes, 0...100.
    var averageAttendance: Double {
        guard !classes.isEmpty else { return 0 }
        return classes.map(\.attendanceRate).reduce(0, +) / Double(classes.count)
    }

    var hasLoaded: Bool { phase == .loaded }

    func isCheckedIn(_ summary: StudentClassSummary) -> Bool {
        guard let s = summary.activeSession else { return false }
        return s.checkedIn || locallyCheckedIn.contains(s.id)
    }

    func presentation(for classId: String) -> ClassPresentation {
        extras.presentations[classId] ?? ClassPresentation()
    }

    func detail(for classId: String) -> StudentClassDetail? { detailCache[classId] }

    /// The student's registered device — from whatever class detail is cached
    /// (the device is the same across classes; GET /students/me omits it).
    var registeredDevice: StudentClassDetail.DeviceRef? {
        detailCache.values.compactMap(\.device).first
    }

    /// The student's seat/block label, preferring the live class (sidecar — §9.8).
    var assignedSeat: String? {
        if let live = liveClass, let seat = presentation(for: live.id).seat { return seat }
        return classes.compactMap { presentation(for: $0.id).seat }.first
    }

    // MARK: - Loading

    /// First load (shows the loading state); safe to call repeatedly.
    func load() async {
        if phase == .idle { phase = .loading }
        await reload()
    }

    /// Pull-to-refresh / poll — never flips back to the loading spinner.
    func refresh() async { await reload() }

    private func reload() async {
        do {
            async let selfTask = repo.fetchSelf()
            async let extrasTask = repo.fetchExtras()
            let data = try await selfTask
            let extrasData = await extrasTask
            student = data.student
            classes = data.classes
            invites = data.pendingInvites
            extras = extrasData
            errorMessage = nil
            phase = .loaded
            // Warm the primary class detail so device info + the live policy are
            // available app-wide (Profile "Device linked", Settings, device screen)
            // without first opening a class. Silent — a prefetch miss isn't shown.
            if let target = liveClass ?? classes.first, detailCache[target.id] == nil {
                _ = try? await fetchAndCacheDetail(target.id)
            }
        } catch let error as APIError {
            errorMessage = error.userMessage
            if phase != .loaded { phase = .failed }
        } catch {
            errorMessage = "Something went wrong. Pull to refresh."
            if phase != .loaded { phase = .failed }
        }
    }

    /// Load (and cache) a class's detail. Returns the cached copy unless `force`.
    @discardableResult
    func loadDetail(classId: String, force: Bool = false) async -> StudentClassDetail? {
        if !force, let cached = detailCache[classId] { return cached }
        do {
            return try await fetchAndCacheDetail(classId)
        } catch let error as APIError {
            errorMessage = error.userMessage
            return nil
        } catch {
            errorMessage = "Couldn't load this class."
            return nil
        }
    }

    /// Fetch a detail, cache it, and enrich the sidecar policy from its active
    /// session. Throws (callers decide whether to surface the error).
    @discardableResult
    private func fetchAndCacheDetail(_ classId: String) async throws -> StudentClassDetail {
        let detail = try await repo.fetchClassDetail(classId: classId)
        detailCache[classId] = detail
        if let snap = detail.activeSession?.blockingSnapshot {
            var p = extras.presentations[classId] ?? ClassPresentation()
            p.policy = snap
            extras.presentations[classId] = p
        }
        return detail
    }

    /// Save profile edits (POST /students/me returns the refreshed self).
    func saveProfile(firstName: String, lastName: String, grade: String?) async -> Bool {
        do {
            let update = StudentProfileUpdate(firstName: firstName, lastName: lastName, grade: grade)
            let data = try await repo.updateProfile(update)
            student = data.student
            classes = data.classes
            invites = data.pendingInvites
            return true
        } catch let error as APIError {
            errorMessage = error.userMessage
            return false
        } catch {
            errorMessage = "Couldn't save your profile."
            return false
        }
    }

    // MARK: - Join / invites

    /// Look up a class to join from a code or link-extracted classId.
    func joinPreview(token: String) async -> ClassJoinPreview? {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        do {
            return try await repo.joinPreview(trimmed)
        } catch let error as APIError {
            errorMessage = error.userMessage; return nil
        } catch {
            errorMessage = "We couldn't find that class."; return nil
        }
    }

    @discardableResult
    func joinClass(_ preview: ClassJoinPreview) async -> Bool {
        do {
            try await repo.joinClass(classId: preview.classId)
            addToRoster(id: preview.classId, name: preview.className, period: preview.period,
                        teacher: preview.teacherName, school: preview.schoolName)
            return true
        } catch let error as APIError {
            errorMessage = error.userMessage; return false
        } catch {
            errorMessage = "Couldn't join this class."; return false
        }
    }

    @discardableResult
    func acceptInvite(_ invite: PendingInvite) async -> Bool {
        do {
            try await repo.acceptInvite(inviteId: invite.inviteId)
            invites.removeAll { $0.inviteId == invite.inviteId }
            addToRoster(id: invite.classId, name: invite.className, period: invite.period,
                        teacher: invite.teacherName, school: invite.schoolName)
            return true
        } catch let error as APIError {
            errorMessage = error.userMessage; return false
        } catch {
            errorMessage = "Couldn't accept this invite."; return false
        }
    }

    /// Optimistically add a freshly joined/accepted class so it appears at once;
    /// a later refresh reconciles with the server. Drops any matching invite.
    private func addToRoster(id: String, name: String, period: String?,
                             teacher: String, school: String?) {
        invites.removeAll { $0.classId == id }
        guard !classes.contains(where: { $0.id == id }) else { return }
        classes.append(StudentClassSummary(
            id: id, name: name, period: period, teacherName: teacher, schoolName: school,
            activeSession: nil, attendanceRate: 0, totalSessions: 0))
        classes.sort { $0.name < $1.name }
    }

    /// Record a successful (real NFC) check-in so the UI updates immediately.
    func markCheckedIn(sessionId: String) { locallyCheckedIn.insert(sessionId) }

    /// Clear all state on sign-out.
    func reset() {
        phase = .idle
        student = nil
        classes = []
        invites = []
        extras = StudentExtras()
        detailCache = [:]
        locallyCheckedIn = []
        errorMessage = nil
    }
}

#if DEBUG
extension AppModel {
    /// A synchronously-populated model for SwiftUI previews (sample fixtures).
    static var preview: AppModel {
        let model = AppModel(repo: SampleStudentRepository())
        let data = SampleStudentRepository.sampleSelf()
        model.student = data.student
        model.classes = data.classes
        model.invites = data.pendingInvites
        model.extras = SampleStudentRepository.sampleExtras()
        model.detailCache["cls-bio"] = SampleStudentRepository.detail(classId: "cls-bio")
        model.detailCache["cls-hist"] = SampleStudentRepository.detail(classId: "cls-hist")
        model.detailCache["cls-alg"] = SampleStudentRepository.detail(classId: "cls-alg")
        model.phase = .loaded
        return model
    }
}
#endif
