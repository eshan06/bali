import Foundation

// Enforcement (ARCHITECTURE, "iOS app structure"; B5): the shields follow the sync engine's truth,
// and rule 3's check runs before each check-in. Screen Time itself is the app's, behind
// `ScreenTime`, so every rule here runs on Linux too.

/// The Screen Time permission, Family Controls' `.individual`: the student grants it with Face ID
/// or their passcode, and can take it back in Settings, where iOS drops every shield at once.
public enum Permission: Sendable, Hashable { case approved, denied, notDetermined }

/// Screen Time as the phone has it: the app's one `ManagedSettingsStore`, and its authorization.
public protocol ScreenTime: Sendable {
    /// Whether the store holds the shields now.
    func isShielding() async -> Bool
    /// Shields every app and website a third party can block (`.all()`): no picker, no allow-list.
    func shield() async
    func unshield() async
    func permission() async -> Permission
    /// Asks the student for the permission, with iOS's own prompt.
    func requestPermission() async throws
}

/// What a screen may claim of the shields: what the last check found (rule 3), never the standing
/// alone — a stuck report stops holding reads (B3a), so a read can say focused over no shield.
public struct Protection: Sendable, Hashable {
    public var permission = Permission.notDetermined
    /// Verified: the store holds the shields, and the permission keeps them there.
    public var shielded = false
    /// When they come off, while the engine's truth keeps them on.
    public var until: Date?
    /// Protection off was found, and could not be queued: shown, and tried again at the next check.
    public var unreported = false
}

extension SyncState {
    /// Decision 7: a tap the server has not answered shields at once, and for at most this long.
    public static let tapCap: TimeInterval = 50 * 60

    /// When the shields come off, while the phone's truth keeps them on at `now`; nil: off. On while
    /// focused in a session, until its end — and for a tap not yet answered, until decision 7's cap,
    /// unless the student unlocked since: an unlock is acted on at once (decision 11). Unlocked,
    /// protection off, a state this build does not know, waiting or out: off.
    public func shieldedUntil(_ now: Date) -> Date? {
        var ends: [Date] = []
        if case .inSession(let session, .focused?) = standing { ends.append(session.endsAt) }
        if let tap = pendingTap,
            !queued.drop(while: { $0.eventId != tap.eventId }).contains(where: {
                if case .unlock = $0.change { true } else { false }
            })
        {
            ends.append(tap.recordedAt + Self.tapCap)
        }
        return ends.filter { $0 > now }.max()
    }
}

/// Keeps the shields where the engine's truth says (B5): it follows `SyncEngine.updates()`, takes
/// them off at the end or the cap by the phone's own clock (data model, decision 6), and runs rule
/// 3's check before each check-in. The app has one.
public actor Enforcer {
    let engine: SyncEngine
    let screenTime: any ScreenTime
    let clock: any SyncClock

    public private(set) var protection = Protection() {
        didSet {
            guard protection != oldValue else { return }
            for watcher in watchers.values { watcher.yield(protection) }
        }
    }
    private var watchers: [UUID: AsyncStream<Protection>.Continuation] = [:]
    private var enforcing = false
    private var again = false
    private var alarm: Task<Void, Never>?
    /// When the checks in a row that read the permission not determined began; nil after any read
    /// that did not — a check's, or a pass's.
    private var undetermined: Date?

    public init(engine: SyncEngine, screenTime: any ScreenTime, clock: any SyncClock = SystemClock()) {
        (self.engine, self.screenTime, self.clock) = (engine, screenTime, clock)
    }

    /// Hands the engine rule 3's check, then follows its truth until cancelled.
    public func run() async {
        await engine.beforeEachCheckIn { [weak self] in await self?.check() }
        for await _ in await engine.updates() { await enforce() }
        alarm?.cancel()
    }

    /// Rule 3's check, before each check-in and as the app comes to the foreground: the shields go
    /// back on if they should be on and are not, and a permission found off in a session whose row
    /// is not protection off already is reported — once there (the outbox's), and again whenever
    /// the phone stands focused there (the engine's `record`, A13). Denied is off at once. Not
    /// determined is off only once checks have read it so for a check-in interval — two in a row:
    /// Family Controls can read it so for a moment just after a launch, and a phone never granted
    /// the permission reads it so for good.
    public func check() async {
        let permission = await screenTime.permission()
        let now = clock.now()
        // A clock turned back starts the run again, rather than stalling it.
        undetermined = permission == .notDetermined ? min(undetermined ?? now, now) : nil
        let off =
            permission == .denied
            || undetermined.map { now.timeIntervalSince($0) >= SyncEngine.checkInInterval } == true
        var unreported = false
        if off, case .inSession(let session, let state) = await engine.state.standing,
            state != .protectionOff
        {
            do { try await engine.record(.protectionOff(session: session.id)) } catch {
                unreported = true
            }
        }
        protection.unreported = unreported
        await enforce()
    }

    /// Asks the student for the Screen Time permission — C1's onboarding — and enforces with it.
    public func requestPermission() async throws {
        try await screenTime.requestPermission()
        await enforce()
    }

    /// What a screen may claim, now and at each change.
    public func updates() -> AsyncStream<Protection> {
        let (stream, watcher) = AsyncStream.makeStream(
            of: Protection.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        watchers[id] = watcher
        watcher.onTermination = { _ in Task { await self.forget(id) } }
        watcher.yield(protection)
        return stream
    }

    private func forget(_ id: UUID) { watchers[id] = nil }

    /// One pass at a time: a call made while one runs has it run again, on the newest truth.
    private func enforce() async {
        again = true
        guard !enforcing else { return }
        enforcing = true
        while again {
            again = false
            await apply()
        }
        enforcing = false
    }

    /// The shields as the engine's truth says now — put on, or taken off, where the store says
    /// otherwise, but never taken off while where the phone stood is unread: enforcement never
    /// begins from nothing — and what a screen may claim of them; then a wake at their end.
    private func apply() async {
        let state = await engine.state
        let until = state.shieldedUntil(clock.now())
        if await screenTime.isShielding() != (until != nil) {
            if until != nil {
                await screenTime.shield()
            } else if state.standing != .unread {
                await screenTime.unshield()
            }
        }
        let permission = await screenTime.permission()
        if permission != .notDetermined { undetermined = nil }
        let shielded = await screenTime.isShielding() && permission == .approved
        // Read after the last wait, so a check made meanwhile keeps what it found (`unreported`).
        var next = protection
        (next.permission, next.shielded, next.until) = (permission, shielded, until)
        protection = next
        alarm?.cancel()
        alarm = until.map { until in
            Task { [weak self, clock] in
                do { try await clock.sleep(until: until) } catch { return }
                await self?.enforce()
            }
        }
    }
}
