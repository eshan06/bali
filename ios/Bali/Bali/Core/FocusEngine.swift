import Foundation
import SwiftUI

/// The student-side session state machine (design doc 06):
/// tap-in → FOCUSED (shields on, 30s heartbeats) → unlock/pass/revoked/bell.
/// The emergency unlock is LOCAL-FIRST: shields drop immediately, the POST is
/// queued and replayed until acknowledged — it works fully offline.
@MainActor
final class FocusEngine: ObservableObject {
    enum FocusState: Equatable {
        case idle
        case focused
        case pass(endsAt: Date)
        case unlocked(pendingReasonUnlockId: String?)
        case ended
    }

    @Published private(set) var state: FocusState = .idle
    @Published private(set) var session: ResolvedSession?
    @Published var className = ""
    @Published var teacherDisplayName = ""

    private let api: APIClient
    private let screenTime: ScreenTimeService
    private var heartbeatTask: Task<Void, Never>?
    private let queueKey = "bali.pendingUnlocks"

    init(api: APIClient, screenTime: ScreenTimeService = ScreenTime.make()) {
        self.api = api
        self.screenTime = screenTime
    }

    var screenTimePermissionOk: Bool { screenTime.permissionOk }

    // MARK: tap-in

    func startFocus(session: ResolvedSession, className: String, teacher: String) async throws {
        let body = TapInBody(clientEventId: UUID().uuidString.lowercased(), tappedAt: nil)
        _ = try await api.post("sessions/\(session.sessionId)/tap-in", body: body, as: TapInResult.self)
        self.session = session
        self.className = className
        self.teacherDisplayName = teacher
        ShieldContext.set(teacher: teacher, endsAt: session.endsAt)
        screenTime.applyShields(allowedLabels: session.allowedAppLabels)
        SessionWatchdog.arm(endsAt: session.endsAt)
        state = .focused
        startHeartbeats()
        await flushUnlockQueue()
    }

    /// Re-attach to an already-focused session (app relaunch while focused).
    func resume(session: ResolvedSession, className: String, teacher: String, mine: MyParticipation?) {
        self.session = session
        self.className = className
        self.teacherDisplayName = teacher
        switch mine?.state {
        case "focused":
            ShieldContext.set(teacher: teacher, endsAt: session.endsAt)
            screenTime.applyShields(allowedLabels: session.allowedAppLabels)
            SessionWatchdog.arm(endsAt: session.endsAt)
            state = .focused
            startHeartbeats()
        case "pass":
            if let ends = mine?.passEndsAt {
                screenTime.clearShields()
                state = .pass(endsAt: ends)
                startHeartbeats()
            }
        case "emergency_unlocked":
            state = .unlocked(pendingReasonUnlockId: mine?.pendingUnlockId)
            startHeartbeats()
        default:
            break
        }
    }

    // MARK: emergency unlock — local-first, offline-safe

    func emergencyUnlock() {
        guard let session else { return }
        // 1) Unlock NOW, on-device, no network in the path.
        screenTime.clearShields()
        state = .unlocked(pendingReasonUnlockId: nil)

        // 2) Queue the notification and replay until the server has it.
        enqueueUnlock(sessionId: session.sessionId, eventId: UUID().uuidString.lowercased(), at: Date())
        Task { await flushUnlockQueue() }
    }

    func shareReason(_ reason: String) async {
        guard case let .unlocked(pendingId) = state, let unlockId = pendingId else { return }
        try? await api.postVoid("unlocks/\(unlockId)/reason", body: ReasonBody(reason: reason))
        state = .unlocked(pendingReasonUnlockId: nil)
    }

    func refocus() async {
        guard let session else { return }
        do {
            try await api.postVoid("sessions/\(session.sessionId)/refocus", body: nil as EmptyBody?)
            screenTime.applyShields(allowedLabels: session.allowedAppLabels)
            state = .focused
        } catch {
            // stay unlocked; next heartbeat reconciles
        }
    }

    func sessionEnded() {
        ShieldContext.clear()
        screenTime.clearShields()
        SessionWatchdog.disarm()
        heartbeatTask?.cancel()
        state = .ended
    }

    func reset() {
        ShieldContext.clear()
        screenTime.clearShields()
        SessionWatchdog.disarm()
        heartbeatTask?.cancel()
        state = .idle
        session = nil
    }

    // MARK: heartbeats — 30s cadence, carries permission honesty, syncs state back

    private func startHeartbeats() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.heartbeat()
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
        Task { await heartbeat() }
    }

    private func heartbeat() async {
        guard let session else { return }
        let body = HeartbeatBody(permissionOk: screenTime.permissionOk, shieldsApplied: screenTime.shieldsApplied)
        guard let result = try? await api.post("sessions/\(session.sessionId)/heartbeat", body: body, as: HeartbeatResult.self) else {
            return // offline: focus continues, the UI shows the reconnect pill
        }
        if result.session.endedAt != nil || result.session.endsAt <= Date() {
            sessionEnded()
            return
        }
        // Teacher extended the session: move the watchdog and the shield subtitle.
        if result.session.endsAt != session.endsAt {
            self.session?.endsAt = result.session.endsAt
            ShieldContext.set(teacher: teacherDisplayName, endsAt: result.session.endsAt)
            SessionWatchdog.arm(endsAt: result.session.endsAt)
        }
        // Server is the truth for cross-device transitions (passes granted, etc.)
        switch result.state {
        case "pass":
            if let ends = result.passEndsAt {
                if case .pass = state {} else { screenTime.clearShields() }
                state = .pass(endsAt: ends)
            }
        case "focused":
            if case .focused = state {} else if case .unlocked = state {
                // teacher can't force re-focus; ignore
            } else {
                screenTime.applyShields(allowedLabels: session.allowedAppLabels)
                state = .focused
            }
        default:
            break
        }
        await flushUnlockQueue()
    }

    // MARK: unlock queue (UserDefaults-backed, replayed until 2xx)

    private struct PendingUnlock: Codable {
        var sessionId: String
        var eventId: String
        var at: Date
    }

    private func enqueueUnlock(sessionId: String, eventId: String, at: Date) {
        var queue = loadQueue()
        queue.append(PendingUnlock(sessionId: sessionId, eventId: eventId, at: at))
        saveQueue(queue)
    }

    private func loadQueue() -> [PendingUnlock] {
        guard let data = UserDefaults.standard.data(forKey: queueKey) else { return [] }
        return (try? JSONDecoder().decode([PendingUnlock].self, from: data)) ?? []
    }

    private func saveQueue(_ queue: [PendingUnlock]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(queue), forKey: queueKey)
    }

    func flushUnlockQueue() async {
        var queue = loadQueue()
        guard !queue.isEmpty else { return }
        var remaining: [PendingUnlock] = []
        for item in queue {
            do {
                let result = try await api.post(
                    "sessions/\(item.sessionId)/unlock",
                    body: UnlockBody(clientEventId: item.eventId, at: item.at),
                    as: UnlockResult.self
                )
                // Surface the reason sheet for the unlock we just confirmed.
                if case .unlocked(nil) = state, let id = result.unlockId, result.recorded {
                    state = .unlocked(pendingReasonUnlockId: id)
                }
            } catch let err as APIError where (400 ..< 500).contains(err.status) {
                continue // permanently rejected (e.g. session gone) — drop it
            } catch {
                remaining.append(item) // network — retry later
            }
        }
        queue = remaining
        saveQueue(queue)
    }
}
