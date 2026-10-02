import Foundation

// Enforcement (ARCHITECTURE, "iOS app structure"; B5): the shields follow the sync engine's truth,
// and rule 3's check runs at each foreground wake of the engine — before each check-in, and out of
// a session too (C1c). Screen Time itself is the app's, behind `ScreenTime`, so every rule here
// runs on Linux too.

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
    /// Asks iOS to wake the monitor at `window`'s end — the bell with the app closed (B5b) — and at
    /// its backup's (B5b-3), replacing the windows asked for before, the monitor's own too; nil: at
    /// none (`Bell.register`). A window iOS takes ends the monitor's refusal (`monitorUnscheduled`).
    /// One refused for want of the permission throws `ScreenTimeUnauthorized`.
    func schedule(_ window: DateInterval?) async throws
    /// Whether iOS's DeviceActivity center holds `window` as the bell's, as it was asked for: only
    /// read, so no window is stopped or replaced, and the monitor is not woken (#144).
    func holds(_ window: DateInterval) async -> Bool
    /// When iOS refused the monitor the window it asked for, woken with the app closed, and no wake
    /// since ended well — so the shields it kept outlived their end — until a window is registered
    /// again; nil: none. The monitor keeps it in the app group, for the app's next open.
    func monitorUnscheduled() async -> Date?
}

/// iOS refused a window because Bali has no Screen Time access (DeviceActivity's `unauthorized`):
/// its own word, where a running app's read of the permission stays approved (#144).
public struct ScreenTimeUnauthorized: Error, Hashable {
    public init() {}
}

/// What a screen may claim of the shields: what the last check found (rule 3), never the standing
/// alone — a stuck report stops holding reads (B3a), so a read can say focused over no shield.
public struct Protection: Sendable, Hashable {
    public init() {}

    /// A pass has read the phone: what follows is what it found, not these defaults. Until then no
    /// screen is chosen on it (C1a) — the first value is the defaults, whose permission reads not
    /// determined, as a phone never asked does.
    public var checked = false
    /// Family Controls' read — but approved is not determined while iOS's DeviceActivity center
    /// says the access is gone, which a running app's read never does (#144).
    public var permission = Permission.notDetermined
    /// The permission as the check judges it — off: denied, refused by iOS's DeviceActivity center
    /// (#144), or not determined for `Enforcer.grace` of the phone's running (B5a-2, #145) — a
    /// phone never granted it, whose access is off, or whose grant did not come back with a
    /// restored backup — never a launch's moment. What is reported as protection off in a session,
    /// and what ends `Phone.everApproved` (C1b).
    public var permissionOff = false
    /// Verified: the store holds the shields, and the permission keeps them there.
    public var shielded = false
    /// When they come off, while the engine's truth keeps them on.
    public var until: Date?
    /// Protection off was found, and could not be queued: shown, and tried again at the next check.
    public var unreported = false
    /// iOS refused the window the shields are on, or its backup (B5b): with the app closed, nothing
    /// would take them off at its end, or make a lost wake again. Shown, and asked for again at the
    /// next pass.
    public var unscheduled = false
    /// When iOS refused the monitor its next window, the app closed (B5b), and no wake since ended
    /// well: the shields it kept outlived their end until the app was opened. Shown from the app's
    /// next open until a window is registered again (rule 5).
    public var monitorUnscheduled: Date?
}

extension SyncState {
    /// Decision 7: a tap the server has not answered shields at once, and for at most this long.
    public static let tapCap: TimeInterval = 50 * 60

    /// When the shields come off, while the phone's truth keeps them on at `now`; nil: off. On while
    /// focused in a session, until its end — and for a tap not yet answered, until its cap
    /// (`tapHeldUntil`). Unlocked, protection off, a state this build does not know, waiting or
    /// out: off.
    public func shieldedUntil(_ now: Date) -> Date? {
        var ends: [Date] = []
        if case .inSession(let session, .focused?) = standing { ends.append(session.endsAt) }
        if let end = tapHeldUntil { ends.append(end) }
        return ends.filter { $0 > now }.max()
    }

    /// Until when a tap not yet answered keeps the shields on: decision 7's cap after it (`cap`) —
    /// unless the student unlocked since, which is acted on at once (decision 11). nil: none does.
    public var tapHeldUntil: Date? {
        guard let tap = pendingTap,
            !queued.drop(while: { $0.eventId != tap.eventId }).contains(where: \.change.isUnlock)
        else { return nil }
        return tap.recordedAt + cap
    }

    /// Whether the student's Emergency Unlock has the last word on the shields: one after the tap
    /// not yet answered — this run's or the last's: that tap holds the queue, so nothing since can
    /// have put them back on — or with none, one made where the phone stood unread. Over a standing
    /// not read, it takes the last run's shields off too — the way out of shields the phone can no
    /// longer justify (B6b). A session's unlock the last run left queued alone does not: a tap
    /// answered since may have put them back on.
    public var unlockedLast: Bool { pendingTap == nil ? holdsUnfiled : tapHeldUntil == nil }
}

/// Keeps the shields where the engine's truth says (B5): it follows `SyncEngine.updates()`, takes
/// them off at the end or the cap by the phone's own clock (data model, decision 6), and runs rule
/// 3's check at each foreground wake of the engine — before each check-in, and out of a session
/// too (C1c). The app has one.
public actor Enforcer {
    /// How long Family Controls' read may say not determined before the check judges the permission
    /// off (B5a-2; #145): it can read so for a moment just after a launch, approved all along, and a
    /// phone whose access is off reads so for good. With access on, "Checking Screen Time…" showed
    /// about 2 s after a launch on the owner's iPhone (2026-10-01), the read settled within it: five
    /// times that. The Debug readout's `Launch:` line shows how long it lasts on a phone, to tune it.
    public static let grace: TimeInterval = 10
    /// Within the grace, how soon a check of Family Controls' own not determined is made again: the
    /// grace ends as iOS settles, or lasts, never waiting on the engine's next wake (#145).
    static let recheckAfter: TimeInterval = 1

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
    /// Callers of `enforce(awaited:)` waiting for the passes under way to end.
    private(set) var awaiting: [CheckedContinuation<Void, Never>] = []
    private var alarm: Task<Void, Never>?
    /// Within the grace, the check made again `recheckAfter` on (#145); nil: none due.
    private var recheck: Task<Void, Never>?
    /// When the checks in a row that read the permission not determined began, by how long the
    /// phone has run, which no setting of its clock moves; nil after any read that did not: a
    /// check's, or a pass's — and once a doubt over an approved read is over (`unverified`).
    private var undetermined: TimeInterval?
    /// Whether the store's shields are ones this enforcer put on, not the last run's: over a
    /// standing not read, those — a pending tap's — still come off at the cap. The last run's never
    /// do: a session they may be for may still be running (#91's review).
    private var putOn = false
    /// The window iOS was last asked to wake the monitor at, by this enforcer; nil: none.
    private var scheduled: DateInterval?
    /// #144: Screen Time access taken back is never read in a running app — Family Controls' read
    /// stays approved, the store's own values too, until a relaunch — but iOS ends the app's
    /// DeviceActivity windows. So a check found the bell's window gone from iOS's center, and asked
    /// for again, iOS took it without holding it. Another app's grant changing ends them too
    /// (Apple's forums, thread 749120), but those are held again once asked for. Until a window iOS
    /// takes is held, or its prompt is answered, an approved read is judged not determined: B5a-2's
    /// grace, then off. Wherever the doubt ends — at a pass too, after its read was judged — the
    /// run of not determined it was judged into ends with it, as at a read of approved, so a read
    /// of not determined after it has a grace of its own (F1's review).
    private var unverified = false {
        didSet { if oldValue, !unverified, !unauthorized { undetermined = nil } }
    }
    /// #144: iOS refused a window for want of the permission — its own word, where the read stays
    /// approved — until it takes one again, or its prompt is answered: off at once. Its end ends
    /// the run as `unverified`'s does.
    private var unauthorized = false {
        didSet { if oldValue, !unauthorized, !unverified { undetermined = nil } }
    }
    /// A check asked the next pass to see whether iOS still holds the window it took (`verify`).
    private var verifying = false

    public init(engine: SyncEngine, screenTime: any ScreenTime, clock: any SyncClock = SystemClock()) {
        (self.engine, self.screenTime, self.clock) = (engine, screenTime, clock)
    }

    /// Hands the engine rule 3's check, then follows its truth until cancelled.
    public func run() async {
        await engine.atEachWake { [weak self] in await self?.check() }
        for await _ in await engine.updates() { await enforce() }
        alarm?.cancel()
        recheck?.cancel()
    }

    /// Rule 3's check, at each foreground wake of the engine's read loop and as the app comes to
    /// the foreground: the shields go back on if they should be on and are not, and a permission
    /// found off in a session whose row is not protection off already, and which the phone's own
    /// clock says is not over, is reported — once there (the outbox's), and again whenever the
    /// phone stands focused there (the engine's `record`, A13). Denied is off at once. Not
    /// determined is off only once checks have read it so for `grace` of the phone's running:
    /// Family Controls can read it so for a moment just after a launch, and a phone never granted
    /// the permission, or whose access is off, reads it so for good — so meanwhile the check is
    /// made again every `recheckAfter`, never waiting on the next wake (#145). Approved is judged by
    /// iOS's DeviceActivity center too, at a pass of its own first (`verify`, `judged`; #144).
    public func check() async {
        if scheduled != nil, await screenTime.permission() == .approved {
            verifying = true
            await enforce(awaited: true)
        }
        let read = await screenTime.permission()
        let (permission, refused) = judged(read)
        undetermined = permission == .notDetermined ? undetermined ?? clock.uptime() : nil
        let off = permission == .denied || refused || undeterminedLasting
        var unreported: Bool? = false
        if off, case .inSession(let session, let state) = await engine.state.standing,
            state != .protectionOff, session.endsAt > clock.now()
        {
            do { try await engine.record(.protectionOff(session: session.id)) } catch {
                // Refused as the app is suspended, nothing is lost: the check as it comes back
                // finds it again.
                unreported = Outbox.isSuspension(error) ? nil : true
            }
        }
        if let unreported { protection.unreported = unreported }
        await enforce()
        // Family Controls' own not determined, within the grace: checked again a second on, so the
        // grace ends as iOS settles, or Screen Time off shows once it lasts. Not an approved read
        // doubted (#144): checked, iOS's center would be asked for the window again each second.
        recheck?.cancel()
        recheck = nil
        guard read == .notDetermined, undetermined != nil, !undeterminedLasting else { return }
        recheck = Task { [weak self, clock] in
            do { try await clock.sleep(until: clock.now() + Self.recheckAfter) } catch { return }
            await self?.check()
        }
    }

    /// Whether checks have read the permission not determined for the grace of the phone's running:
    /// not a launch's moment (B5a-2, #145).
    private var undeterminedLasting: Bool {
        undetermined.map { clock.uptime() - $0 >= Self.grace } == true
    }

    /// Family Controls' `read` as the check judges it (#144): approved, while iOS's DeviceActivity
    /// center says otherwise (`unverified`, `unauthorized`), is not determined — and `refused`, off
    /// at once, where iOS refused a window for want of it. Any other read is as read.
    private func judged(_ read: Permission) -> (permission: Permission, refused: Bool) {
        guard read == .approved, unverified || unauthorized else { return (read, false) }
        return (.notDetermined, unauthorized)
    }

    /// #144, at the pass a check asked for: whether iOS's DeviceActivity center still holds
    /// `window`, the bell's window it took — only read, so nothing is stopped or replaced and the
    /// monitor is not woken. Gone (`missing`) — more than a minute before its end, when iOS may
    /// have ended it on its own clock — it is forgotten, so the pass asks for it again, and iOS's
    /// answer decides (`apply`): a fresh start, iOS holding none, though `Bell.register` then stops
    /// the monitor's own next wake, which wakes it once to ask nothing (B5b-5). Whether it was gone.
    private func verify(_ window: DateInterval?) async -> Bool {
        verifying = false
        guard let window, window == scheduled, clock.now() < window.end - Bell.retry else {
            return false
        }
        guard await missing(window) else {
            unverified = false
            return false
        }
        scheduled = nil
        return true
    }

    /// Whether iOS's center does not hold `window`, the bell's — a sign only once the window has
    /// begun: iOS may not report one not begun yet, which a class longer than the floor asks for,
    /// so before then the permission read alone judges (F1's review). The Debug readout's `iOS:`
    /// line shows whether the phone reports one; if it does, this guard can go.
    private func missing(_ window: DateInterval) async -> Bool {
        guard window.start <= clock.now() else { return false }
        return await !screenTime.holds(window)
    }

    /// Asks the student for the Screen Time permission — C1's onboarding — and enforces with what
    /// it reads after, given or not: Don't Allow is a throw and a read of denied, which the screen
    /// shows at once, not a check-in later.
    public func requestPermission() async throws {
        let asked: Result<Void, any Error>
        do {
            try await screenTime.requestPermission()
            // iOS's own prompt answered: its read is fresh, whatever the windows said (#144).
            (unverified, unauthorized) = (false, false)
            asked = .success(())
        } catch {
            asked = .failure(error)
        }
        await enforce()
        try asked.get()
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

    /// One pass at a time: a call made while one runs has it run again, on the newest truth — and,
    /// `awaited`, returns once it has.
    private func enforce(awaited: Bool = false) async {
        again = true
        guard !enforcing else {
            if awaited { await withCheckedContinuation { awaiting.append($0) } }
            return
        }
        enforcing = true
        while again {
            again = false
            await apply()
        }
        enforcing = false
        for waiting in awaiting { waiting.resume() }
        awaiting = []
    }

    /// The shields as the engine's truth says now — put on, or taken off, where the store says
    /// otherwise, but while where the phone stood is unread, only the ones this enforcer put on
    /// taken off, or any once the student has unlocked over it: enforcement never begins from
    /// nothing — and what a screen may claim of them; then a wake at their end.
    private func apply() async {
        let state = await engine.state
        let until = state.shieldedUntil(clock.now())
        let shielding = await screenTime.isShielding()
        if until != nil, !shielding {
            await screenTime.shield()
            putOn = true
        } else if until == nil, shielding,
            state.standing != .unread || putOn || state.unlockedLast
        {
            await screenTime.unshield()
            putOn = false
        }
        let read = await screenTime.permission()
        // Ends a run of not determined at the read, as B5a-2 has it — never at the pass's end, over
        // a check's newer read made meanwhile; an approved read doubted (#144) does not, though the
        // doubt's end does, wherever it comes (`unverified`).
        if judged(read).permission != .notDetermined { undetermined = nil }
        let inStore = await screenTime.isShielding()
        // B5b: iOS wakes the monitor at the end of the shields the store holds, for a closed app —
        // asked again as the end moves (a new session, an extension, a re-tap) and cancelled once
        // they are off, or denied has iOS drop them; but never cancelled over what is not known —
        // where the phone stood unread (the last run's window may be what takes its shields off),
        // or a permission read not determined for a moment, the store's shields still on. By
        // Family Controls' read, not as judged, so a window gone from iOS is asked for again (#144).
        let window = inStore && read == .approved ? until.map(Bell.window) : nil
        let gone = verifying ? await verify(window) : false
        var unscheduled = protection.unscheduled
        if window == nil, state.standing == .unread || read == .notDetermined {
            unscheduled = false
        } else if window != scheduled || unscheduled {
            do {
                try await screenTime.schedule(window)
                (scheduled, unscheduled) = (window, false)
                // Taken, the permission is there (#144) — and where the bell's window was gone,
                // held again, nothing was wrong (another app's grant changed, say); not held, the
                // doubt stands, once the window has begun (`missing`). Refused otherwise, it is
                // unscheduled, as any refusal: no doubt.
                if let window {
                    unauthorized = false
                    if gone || unverified { unverified = await missing(window) }
                }
            } catch {
                unscheduled = true
                if error is ScreenTimeUnauthorized { unauthorized = true }
            }
        }
        let (permission, refused) = judged(read)
        let shielded = inStore && permission == .approved
        let monitorUnscheduled = await screenTime.monitorUnscheduled()
        // Read after the last wait, so a check made meanwhile keeps what it found (`unreported`).
        var next = protection
        (next.checked, next.permission, next.shielded) = (true, permission, shielded)
        next.permissionOff =
            permission == .denied || refused
            || (permission == .notDetermined && undeterminedLasting)
        (next.until, next.unscheduled, next.monitorUnscheduled) =
            (until, unscheduled, monitorUnscheduled)
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
