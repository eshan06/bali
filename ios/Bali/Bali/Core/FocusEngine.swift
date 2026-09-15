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
        /// Tapped in and reporting status, but Screen Time is off so NOTHING is
        /// shielded — the honest destination for the "join without focus" path.
        case statusOnly
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
    private var passRestoreTask: Task<Void, Never>?
    private let queueKey = "bali.pendingUnlocks"

    init(api: APIClient, screenTime: ScreenTimeService = ScreenTime.make()) {
        self.api = api
        self.screenTime = screenTime
    }

    /// Nothing else cancels these. An engine released WITHOUT an explicit reset()/
    /// sessionEnded() — the stranded launch screen's engine, once the student leaves it —
    /// otherwise leaves `while !Task.isCancelled { … sleep(30s) }` beating for the life of
    /// the process, with self already nil and no way to stop it.
    deinit {
        heartbeatTask?.cancel()
        passRestoreTask?.cancel()
    }

    var screenTimePermissionOk: Bool { screenTime.permissionOk }

    // MARK: tap-in

    func startFocus(session: ResolvedSession, className: String, teacher: String) async throws {
        let body = TapInBody(clientEventId: UUID().uuidString.lowercased(), tappedAt: nil)
        _ = try await api.post("sessions/\(session.sessionId)/tap-in", body: body, as: TapInResult.self)
        self.session = session
        self.className = className
        self.teacherDisplayName = teacher
        // The tap-in stands either way — the teacher sees an honest chip — but we only
        // claim focus if the shields actually went up.
        beginFocus()
        await flushUnlockQueue()
    }

    /// Re-attach to an already-focused session (app relaunch while focused).
    ///
    /// `mine.state` is the ONE seven-value vocabulary shared with the server
    /// (packages/shared/src/states.ts). Every value is spelled out: a state that falls
    /// through the bottom leaves a shielded phone with no engine, no heartbeat and no
    /// release — which is exactly how a student ends up stuck.
    func resume(session: ResolvedSession, className: String, teacher: String, mine: MyParticipation?) {
        self.session = session
        self.className = className
        self.teacherDisplayName = teacher
        switch mine?.state {
        case "focused":
            beginFocus()
        case "pass":
            // The server sweeper runs on an interval, so for up to one sweep after a pass
            // expires the state still reads "pass" with passEndsAt null or already past.
            // That is not a pass any more — shields belong back on, not left off with the
            // engine idle while the banner counts down to the bell.
            guard let ends = mine?.passEndsAt, ends > Date() else {
                beginFocus()
                return
            }
            SessionWatchdog.arm(endsAt: session.endsAt)
            dropShields() // a pass means the phone is genuinely free
            state = .pass(endsAt: ends)
            schedulePassRestore(at: ends)
            startHeartbeats()
        case "emergency_unlocked":
            // The student took their exit: nothing may be shielded here.
            dropShields()
            state = .unlocked(pendingReasonUnlockId: mine?.pendingUnlockId)
            startHeartbeats()
        case "revoked":
            // Screen Time is off, so nothing is shielded — but the engine still has to run.
            // The heartbeat is what puts the shields back the moment permission returns and
            // what stops the teacher's grid reading "permission off" for the whole period.
            // beginFocus() lands on .statusOnly while permission is missing, which is honest.
            beginFocus()
        case "ended", "not_joined", "no_device":
            // The server says this participation is over (bell, removed, left, or never
            // counted). Only this device can lift the shields it applied.
            sessionEnded()
        case .some, .none:
            // Unknown vocabulary, or no participation at all: never keep a phone shielded
            // on a state we cannot reason about.
            sessionEnded()
        }
    }

    /// Re-attach from the durable shield marker alone — no network, no server participation.
    /// This is the path that matters when the app was killed and the class has vanished
    /// (offline, or the student was removed): the shields are real, so the focus screen and
    /// the emergency unlock on it must be real too. The first heartbeat that gets through
    /// corrects us; `ended`/`not_joined` releases the phone.
    func adopt(marker: ShieldMarker.Marker) {
        session = ResolvedSession(
            sessionId: marker.sessionId,
            endsAt: marker.endsAt,
            allowedAppLabels: [],
            messagesAllowed: false,
            policyName: ""
        )
        className = marker.className
        teacherDisplayName = marker.teacher
        beginFocus()
    }

    // MARK: emergency unlock — local-first, offline-safe

    func emergencyUnlock() {
        guard let session else { return }
        // 1) Unlock NOW, on-device, no network in the path.
        passRestoreTask?.cancel()
        PassRestoreWatchdog.disarm()
        dropShields()
        state = .unlocked(pendingReasonUnlockId: nil)

        // 2) Queue the notification and replay until the server has it.
        enqueueUnlock(sessionId: session.sessionId, eventId: UUID().uuidString.lowercased(), at: Date())
        Task { await flushUnlockQueue() }
    }

    func shareReason(_ reason: String) async {
        guard case let .unlocked(pendingId) = state, let unlockId = pendingId else { return }
        try? await api.postVoid("unlocks/\(unlockId)/reason", body: ReasonBody(reason: reason))
        // The bell may have rung while that was in flight; don't write over the state we
        // landed in afterwards.
        guard case .unlocked = state else { return }
        state = .unlocked(pendingReasonUnlockId: nil)
    }

    func refocus() async {
        guard let session else { return }
        let sessionId = session.sessionId
        do {
            try await api.postVoid("sessions/\(sessionId)/refocus", body: nil as EmptyBody?)
            // The await is a gap: the bell may have rung or the engine been reset while the
            // request was in flight. Never re-shield a session we have already left.
            guard stillRunning(sessionId) else { return }
            holdFocus()
        } catch {
            // stay unlocked; next heartbeat reconciles
        }
    }

    func sessionEnded() {
        stopEverything()
        state = .ended
    }

    func reset() {
        stopEverything()
        state = .idle
        session = nil
    }

    // MARK: shields — three facts that must never drift apart

    /// Shields, the durable marker and the shield-screen context go up together and come
    /// down together. A marker without shields strands a "you are shielded" screen; shields
    /// without a marker are shields no relaunched app knows it is holding.
    @discardableResult
    private func applyShields() -> Bool {
        guard let session, screenTime.applyFullFocus() else {
            // Screen Time is off: iOS shielded nothing, so nothing may claim otherwise.
            dropShields()
            return false
        }
        ShieldContext.set(teacher: teacherDisplayName, endsAt: session.endsAt)
        ShieldMarker.set(
            sessionId: session.sessionId,
            endsAt: session.endsAt,
            className: className,
            teacher: teacherDisplayName
        )
        return true
    }

    private func dropShields() {
        screenTime.clearShields()
        ShieldContext.clear()
        ShieldMarker.clear()
    }

    /// Shields on, honestly: `.focused` when iOS actually shielded, `.statusOnly` when
    /// Screen Time is off and nothing is.
    private func holdFocus() {
        passRestoreTask?.cancel()
        PassRestoreWatchdog.disarm()
        state = applyShields() ? .focused : .statusOnly
    }

    /// Enter (or re-enter) focus for `session`: watchdog armed, shields up, heartbeats
    /// running. Never call this from inside the heartbeat loop — it cancels that task.
    private func beginFocus() {
        guard let session else { return }
        SessionWatchdog.arm(endsAt: session.endsAt)
        holdFocus()
        startHeartbeats()
    }

    /// Re-check the one fact only this device can know, with NO network in the path: are the
    /// shields actually up? iOS drops them the instant Screen Time is switched off and tells
    /// nobody. The heartbeat normally catches that, but offline it never lands — so without
    /// this the focus screen counts down over a completely unshielded phone and the copy
    /// claims "Works without Wi-Fi", which is exactly backwards. Cheap enough to call on the
    /// focus screen's existing 1s tick and on foreground.
    func reconcileLocalShields() {
        switch state {
        case .focused:
            if !screenTime.shieldsApplied { state = .statusOnly }
        case .statusOnly:
            // Permission came back. Put the shields up ourselves rather than waiting for a
            // heartbeat that may never arrive.
            if screenTime.permissionOk { holdFocus() }
        case .idle, .pass, .unlocked, .ended:
            break
        }
    }

    /// Everything this device is holding, released together: shields, marker, shield-screen
    /// context, both DeviceActivity windows, the heartbeat loop and the pass timer.
    private func stopEverything() {
        dropShields()
        SessionWatchdog.disarm()
        PassRestoreWatchdog.disarm()
        heartbeatTask?.cancel()
        passRestoreTask?.cancel()
    }

    // MARK: pass expiry — restored on-device, no network in the path

    /// A pass has to end on the phone: the focus screen promises "works without Wi-Fi",
    /// and even online the server sweeper is up to a heartbeat late.
    ///
    /// Two mechanisms, because the in-app one alone is a lie: Bali declares no background
    /// modes, so during a real hall pass it is suspended within seconds and this timer does
    /// not fire until the student next looks at the phone. PassRestoreWatchdog is the part
    /// that runs with the app suspended or dead; the timer is the foreground fast path.
    private func schedulePassRestore(at endsAt: Date) {
        passRestoreTask?.cancel()
        if let session {
            PassRestoreWatchdog.arm(passEndsAt: endsAt, sessionEndsAt: session.endsAt)
            // Whoever restores the shields — this timer, the monitor extension, or the next
            // launch — needs to leave a marker behind, or they become shields no relaunched
            // app knows it is holding. Write it up front, while we still know the session.
            ShieldMarker.setPending(
                sessionId: session.sessionId,
                endsAt: session.endsAt,
                className: className,
                teacher: teacherDisplayName,
                restoreAt: endsAt
            )
        }
        // clamped: a pass never outlives a class period
        let delay = min(max(0, endsAt.timeIntervalSinceNow), 24 * 60 * 60)
        passRestoreTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.restoreAfterPass()
        }
    }

    /// Shields back on at passEndsAt; the heartbeat only reconciles afterwards.
    private func restoreAfterPass() {
        guard case .pass = state else { return }
        holdFocus() // also disarms the watchdog: we are awake and doing it ourselves
    }

    // MARK: heartbeats — 30s cadence, carries permission honesty, syncs state back

    private func startHeartbeats() {
        heartbeatTask?.cancel()
        // ONE tracked task. A second, untracked `Task { await heartbeat() }` alongside the
        // loop could not be cancelled: its response could land after sessionEnded()/reset()
        // and re-apply shields to a dead engine — shields with nothing left to lift them.
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.heartbeat()
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }

    /// True while `sessionId` is still the session this engine is running. Every await is a
    /// gap in which the bell can ring, the student can unlock, or Home can reset us; a
    /// response that lands afterwards must not touch shields or state.
    private func stillRunning(_ sessionId: String) -> Bool {
        guard !Task.isCancelled, session?.sessionId == sessionId else { return false }
        switch state {
        case .idle, .ended: return false
        case .focused, .statusOnly, .pass, .unlocked: return true
        }
    }

    private func heartbeat() async {
        guard let session else { return }
        let sessionId = session.sessionId
        let body = HeartbeatBody(permissionOk: screenTime.permissionOk, shieldsApplied: screenTime.shieldsApplied)
        let result: HeartbeatResult
        do {
            result = try await api.post("sessions/\(sessionId)/heartbeat", body: body, as: HeartbeatResult.self)
        } catch let err as APIError where err.status == 403 || err.status == 404 {
            // The server says outright that this phone is not in this session (participation
            // gone, session deleted, no longer a member). Swallowing that as "offline" is how
            // a phone stays shielded out of a class it is not in until the bell. A 401 or a
            // 5xx is NOT this: an auth or server blip must not unshield a whole class.
            guard stillRunning(sessionId) else { return }
            sessionEnded()
            return
        } catch {
            return // offline: focus continues, the UI shows the reconnect pill
        }
        // A response captured while the session was live can land after sessionEnded() or
        // reset(): nothing below may touch shields or state for a session we have left.
        guard stillRunning(sessionId) else { return }
        if result.session.endedAt != nil || result.session.endsAt <= Date() {
            sessionEnded()
            return
        }
        // Teacher extended the session: move the watchdog and the shield subtitle.
        if result.session.endsAt != self.session?.endsAt {
            self.session?.endsAt = result.session.endsAt
            SessionWatchdog.arm(endsAt: result.session.endsAt)
            // Only while shields are actually up: in .pass/.unlocked/.statusOnly they are
            // down, and writing either key there would claim a shield this phone is not
            // holding. The marker has to move too — the monitor extension reads its endsAt
            // to tell "the bell has rung" from "a later period owns these shields".
            if ShieldMarker.current != nil {
                ShieldContext.set(teacher: teacherDisplayName, endsAt: result.session.endsAt)
                ShieldMarker.set(
                    sessionId: sessionId,
                    endsAt: result.session.endsAt,
                    className: className,
                    teacher: teacherDisplayName
                )
            }
        }
        // Server is the truth for cross-device transitions (passes granted, etc.). All seven
        // values of the shared vocabulary (packages/shared/src/states.ts) are handled.
        switch result.state {
        case "pass":
            if case .unlocked = state { break } // an exit already taken is not re-shielded
            // passEndsAt null (or already past) while the state still reads "pass" means the
            // sweeper has not caught up: the pass is over on this device, so shields go back
            // on rather than the engine sitting idle with nothing shielded.
            guard let ends = result.passEndsAt, ends > Date() else {
                holdFocus()
                break
            }
            if case .pass = state {} else { dropShields() }
            state = .pass(endsAt: ends)
            schedulePassRestore(at: ends)
        case "focused":
            if case .unlocked = state { break } // teacher can't force re-focus; ignore
            // Neither the local state nor our own flag proves the shields are up: iOS
            // drops them the moment Screen Time is switched off and does not put them
            // back when it returns. Re-applying is idempotent, so do it every beat.
            holdFocus()
        case "revoked":
            // The server saw permissionOk:false. If permission has since come back, this
            // re-applies and reports focus honestly on the next beat; if it is still off,
            // holdFocus lands on .statusOnly and nothing claims to be shielded.
            if case .unlocked = state { break }
            holdFocus()
        case "emergency_unlocked":
            // A queued unlock finally landed, or one was recorded elsewhere. The exit has
            // been taken, so nothing may stay shielded.
            if case .unlocked = state { break }
            passRestoreTask?.cancel()
            PassRestoreWatchdog.disarm()
            dropShields()
            state = .unlocked(pendingReasonUnlockId: nil)
        case "ended", "not_joined", "no_device":
            // The student left, or the teacher removed them or flagged them as having no
            // device, while the period is still running: the server no longer counts this
            // phone as participating, and only this device can lift the shields it applied.
            // Without this the phone stays shielded out of a class they are no longer in
            // until the bell or their own emergency unlock.
            sessionEnded()
        default:
            // A state outside the shared vocabulary is one we cannot reason about, and we do
            // not hold a student's phone on a value we do not understand.
            sessionEnded()
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
