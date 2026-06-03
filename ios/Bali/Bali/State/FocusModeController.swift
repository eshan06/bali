//
//  FocusModeController.swift
//  Bali — state
//
//  Owns the Focus Mode session: applies/clears shields through ScreenTimeService,
//  tracks the local blocking status (no JWT report route — §9.4), drives the
//  countdown, and polls the class while active so it tears down + shows the
//  Session Ended overlay when the teacher ends the session.
//

import SwiftUI

nonisolated struct SessionEndedInfo: Equatable {
    let className: String
    let appCount: Int
    let endedAt: Date
}

@MainActor
@Observable
final class FocusModeController {
    enum Status: Equatable { case unknown, applying, applied, failed }

    /// The DTO carries no session end (§9), so the countdown assumes a class block.
    static let assumedSessionMinutes = 50

    private(set) var status: Status = .unknown
    private(set) var activeClassId: String?
    private(set) var policy: BlockingSnapshot?
    private(set) var startedAt: Date?
    private(set) var endedInfo: SessionEndedInfo?
    var isExpanded = false

    private let service: ScreenTimeService
    private let model: AppModel
    private var pollTask: Task<Void, Never>?

    init(service: ScreenTimeService, model: AppModel) {
        self.service = service
        self.model = model
    }

    var isActive: Bool { activeClassId != nil }

    var activeClass: StudentClassSummary? {
        guard let id = activeClassId else { return nil }
        return model.classes.first { $0.id == id }
    }

    var sessionEnd: Date? {
        startedAt.map { $0.addingTimeInterval(Double(Self.assumedSessionMinutes) * 60) }
    }

    // MARK: - Lifecycle

    /// Begin (or no-op if already running) the focus session for a checked-in
    /// live class. Applies shields and starts polling.
    func start(for summary: StudentClassSummary) async {
        guard activeClassId != summary.id else { return }
        activeClassId = summary.id
        endedInfo = nil
        isExpanded = true
        startedAt = BaliFormat.date(summary.activeSession?.startedAt) ?? Date()
        status = .applying
        // Resolve the session's frozen policy from a fresh class-detail fetch before
        // shielding. Focus can activate from an optimistic check-in — or an already
        // checked-in session on launch — before the dashboard's warm-detail lands,
        // and start() runs once (guarded above). Reading a not-yet-cached policy here
        // would lock in the `.inactive` fallback, which shields only the student's
        // picked apps instead of the teacher's policy (e.g. Full Focus -> .all()).
        // The explicit fetch guarantees we apply the real session policy.
        let detail = await model.loadDetail(classId: summary.id, force: true)
        policy = detail?.activeSession?.blockingSnapshot
            ?? model.presentation(for: summary.id).policy
        let applied = await service.applyShields(for: policy ?? .inactive)
        status = applied ? .applied : .failed
        startPolling()
    }

    /// No live checked-in class — tear focus down if it was running.
    func syncInactive() {
        guard isActive else { return }
        Task { await teardown() }
    }

    func collapse() { isExpanded = false }
    func dismissEnded() { endedInfo = nil }

    // MARK: - Internals

    private func startPolling() {
        pollTask?.cancel()
        let target = activeClassId
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard let self else { return }
                await self.model.refresh()
                if self.model.focusActiveClass?.id != target {
                    await self.teardown()
                    return
                }
            }
        }
    }

    private func teardown() async {
        pollTask?.cancel(); pollTask = nil
        await service.clearShields()
        if let id = activeClassId {
            let count = (policy?.isAllowList == true ? policy?.allowedApps.count : policy?.blockedApps.count) ?? 0
            endedInfo = SessionEndedInfo(
                className: model.classes.first { $0.id == id }?.name ?? "Class",
                appCount: count, endedAt: Date())
        }
        activeClassId = nil
        policy = nil
        startedAt = nil
        status = .unknown
        isExpanded = false
    }

    #if DEBUG
    /// Verification aid: force the Session Ended overlay (`-baliSessionEnded YES`).
    func debugShowEnded() {
        endedInfo = SessionEndedInfo(className: "AP Biology", appCount: 7, endedAt: Date())
    }
    #endif
}
