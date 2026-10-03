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
    /// Asks iOS for the permission: its own prompt — or, where access is on, nothing shown at all,
    /// answered at once (the device experiment, 2026-10-02).
    func requestPermission() async throws
    /// Asks iOS to wake the monitor at `window`'s end — the bell with the app closed (B5b) — and at
    /// its backup's (B5b-3), replacing the windows asked for before, the monitor's own too; nil: at
    /// none (`Bell.register`). A window iOS takes ends the monitor's refusal (`monitorUnscheduled`).
    func schedule(_ window: DateInterval?) async throws
    /// When iOS refused the monitor the window it asked for, woken with the app closed, and no wake
    /// since ended well — so the shields it kept outlived their end — until a window is registered
    /// again; nil: none. The monitor keeps it in the app group, for the app's next open.
    func monitorUnscheduled() async -> Date?
    /// What the marker says of Bali's Screen Time access (F1b, #144).
    func marker() async -> Marker
    /// Writes the marker, and its flag, and forgets the monitor's note: after an authorization iOS
    /// confirmed, only.
    func writeMarker() async
    /// When the monitor, woken with the app closed, found the marker gone; nil: not since it was
    /// last written.
    func markerLostAt() async -> Date?
}

/// Bali's Screen Time access as the marker tells it (F1b, #144) — never by Family Controls' read,
/// which a running app keeps reading approved after the access is taken back. The marker is a value
/// of no effect in a store of its own, written once iOS has confirmed the authorization; taking the
/// access back, iOS deletes it with the rest of Bali's settings, while the flag saying it was
/// written, in the app group's defaults, stays (the device experiment, #144, 2026-10-02).
public enum Marker: Sendable, Hashable {
    /// None written on this phone yet — a first run, or a build before F1b's — so the read judges.
    case unwritten
    /// Written, and there: the access stands.
    case present
    /// Written, and gone: the access was taken back.
    case missing

    /// The monitor's look at the marker at a wake (`noted(at:)` on the phone): access lost — the
    /// marker gone since it was written, the shields' store empty too, as iOS leaves both (a store
    /// still holding shields is a misread, never a revocation) — is noted at `now`, the first such
    /// wake's time kept. The note after it, and whether access was lost.
    public static func noting(_ marker: Marker, shielded: Bool, note: Date?, at now: Date)
        -> (lost: Bool, note: Date?)
    {
        guard marker == .missing, !shielded else { return (false, note) }
        return (true, note ?? now)
    }

    /// The flag and the monitor's note after the marker is written (`write()` on the phone): the
    /// flag set only once the marker reads back, so a marker iOS would not keep never reads as
    /// access taken back — and the note forgotten only then, so a loss the monitor found with Bali
    /// closed outlives a write that did not take (#169's review).
    public static func written(readBack: Bool, note: Date?) -> (flag: Bool, note: Date?) {
        (readBack, readBack ? nil : note)
    }
}

/// What a screen may claim of the shields: what the last check found (rule 3), never the standing
/// alone — a stuck report stops holding reads (B3a), so a read can say focused over no shield.
public struct Protection: Sendable, Hashable {
    public init() {}

    /// A pass has read the phone: what follows is what it found, not these defaults. Until then no
    /// screen is chosen on it (C1a) — the first value is the defaults, whose permission reads not
    /// determined, as a phone never asked does.
    public var checked = false
    /// Family Controls' read as the marker judges it (F1b): approved while the marker is there — a
    /// launch's not determined too — and not determined once it is gone, whatever the read.
    public var permission = Permission.notDetermined
    /// The permission as the check judges it — off: denied, the marker gone (F1b), or, none written
    /// yet, not determined for `Enforcer.grace` of the phone's running (B5a-2, #145) — a phone never
    /// granted it, whose access is off, or whose grant did not come back with a restored backup —
    /// never a launch's moment. What is reported as protection off in a session, and what ends
    /// `Phone.everApproved` (C1b).
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
    /// Only while no marker is written (F1b): once one is, the marker decides at once.
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
    private var alarm: Task<Void, Never>?
    /// Within the grace, the check made again `recheckAfter` on (#145); nil: none due.
    private var recheck: Task<Void, Never>?
    /// When the checks in a row that read the permission not determined began, by how long the
    /// phone has run, which no setting of its clock moves; nil after any read that did not: a
    /// check's, or a pass's — and while a marker is written (F1b).
    private var undetermined: TimeInterval?
    /// Whether the store's shields are ones this enforcer put on, not the last run's: over a
    /// standing not read, those — a pending tap's — still come off at the cap. The last run's never
    /// do: a session they may be for may still be running (#91's review).
    private var putOn = false
    /// The window iOS was last asked to wake the monitor at, by this enforcer; nil: none.
    private var scheduled: DateInterval?
    /// While iOS is asked for the access, the calls waiting for that ask's answer (F1b): two asks at
    /// once throw `authorizationConflict`, so one made meanwhile — Turn on Screen Time pressed
    /// again, or over the silent check — has the answer of the one under way. Nil: none under way.
    private(set) var asking: [CheckedContinuation<Result<Void, any Error>, Never>]?
    /// Whether this run has asked iOS silently for the access (F1b): once a launch at most, so a
    /// phone whose marker never reads back is never asked at every check — where access was taken
    /// back, iOS would prompt at each (#169's review).
    private var askedSilently = false

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
    /// clock says is not over — or was not when the monitor found the marker gone (F1b) — is
    /// reported: once there (the outbox's), and again whenever the phone stands focused there (the
    /// engine's `record`, A13). The marker judges first (`judged`): gone, or denied, off at once.
    /// None written yet, an approved read is proven silently (`authorize`) — once a launch at most
    /// (`askedSilently`) — and not determined is off only once checks have read it so for `grace`
    /// of the phone's running:
    /// Family Controls can read it so for a moment just after a launch, and a phone never granted
    /// the permission, or whose access is off, reads it so for good — so meanwhile the check is
    /// made again every `recheckAfter`, never waiting on the next wake (#145).
    public func check() async {
        let (read, marker) = (await screenTime.permission(), await screenTime.marker())
        if marker == .unwritten, read == .approved, asking == nil, !askedSilently {
            askedSilently = true
            Task { try? await authorize() }
        }
        undetermined =
            marker == .unwritten && read == .notDetermined ? undetermined ?? clock.uptime() : nil
        let off = judged(read, marker).off
        let lost = await screenTime.markerLostAt().map { min($0, clock.now()) } ?? clock.now()
        var unreported: Bool? = false
        if off, case .inSession(let session, let state) = await engine.state.standing,
            state != .protectionOff, session.endsAt > lost
        {
            do { try await engine.record(.protectionOff(session: session.id)) } catch {
                // Refused as the app is suspended, nothing is lost: the check as it comes back
                // finds it again.
                unreported = Outbox.isSuspension(error) ? nil : true
            }
        }
        if let unreported { protection.unreported = unreported }
        if !off { await backOn() }
        await enforce()
        // Family Controls' own not determined, within the grace: checked again a second on, so the
        // grace ends as iOS settles, or Screen Time off shows once it lasts. By `off` as judged
        // above, not the grace read again: a pass that ended past the grace claims off, and the
        // report must follow it (santa's round 1).
        recheck?.cancel()
        recheck = nil
        guard !off, undetermined != nil else { return }
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

    /// Family Controls' `read` as the marker judges it (F1b, #144), and whether that is off: denied
    /// is, at once. Else the marker, once written, decides at once — there: approved, a launch's
    /// not determined too; gone: not determined, and off, whatever the read, which a running app
    /// keeps approved after a revocation. With none written yet, the read as read: not determined
    /// is off once it lasts the grace (B5a-2, #145).
    private func judged(_ read: Permission, _ marker: Marker) -> (permission: Permission, off: Bool) {
        if read == .denied { return (.denied, true) }
        switch marker {
        case .present: return (.approved, false)
        case .missing: return (.notDetermined, true)
        case .unwritten: return (read, read == .notDetermined && undeterminedLasting)
        }
    }

    /// Asks the student for the Screen Time permission — C1's onboarding, and Turn on Screen Time
    /// once access was taken back — and enforces with what it reads after, given or not: Don't
    /// Allow is a throw and a read of denied, which the screen shows at once, not a check-in later.
    /// Given, the marker is written again (`authorize`), the phone goes back where it stood in a
    /// class it was protection off in (`backOn`, #167), and the shields and the bell's window come
    /// back where the standing calls for them: the window asked for anew, as iOS deletes it with
    /// the access — one it holds still is asked nothing (`Bell.ask`).
    public func requestPermission() async throws {
        let asked: Result<Void, any Error>
        do {
            try await authorize()
            scheduled = nil
            asked = .success(())
            await backOn()
        } catch {
            asked = .failure(error)
        }
        await enforce()
        try asked.get()
    }

    /// Screen Time back on in the class the phone was protection off in (#167, the owner's
    /// decision 2026-10-02): with the marker there again — written only once iOS confirmed the
    /// access — and that class still running by the phone's own clock, the phone goes back where it
    /// stood before it, at once, and tells the server, which returns the row there too: no re-tap.
    /// Made once: the engine records it only out of protection off, so a check overlapping this one
    /// records none (`SyncEngine.record`). Not saved — the file refusing it — the next check makes
    /// it again, and meanwhile the screen offers the re-tap.
    /// Out of a class, or past its bell, nothing changes.
    private func backOn() async {
        guard await screenTime.marker() == .present,
            case .inSession(let session, .protectionOff?) = await engine.state.standing,
            session.endsAt > clock.now()
        else { return }
        _ = try? await engine.record(.protectionOn(session: session.id))
    }

    /// One ask of iOS for the access at a time (F1b): a call made while one is under way waits for
    /// it, and has its answer. Given, the marker is written.
    private func authorize() async throws {
        if asking != nil {
            return try await withCheckedContinuation { asking?.append($0) }.get()
        }
        asking = []
        let asked: Result<Void, any Error>
        do {
            try await screenTime.requestPermission()
            await screenTime.writeMarker()
            asked = .success(())
        } catch {
            asked = .failure(error)
        }
        for waiting in asking ?? [] { waiting.resume(returning: asked) }
        asking = nil
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
    /// otherwise, but while where the phone stood is unread, only the ones this enforcer put on
    /// taken off, or any once the student has unlocked over it: enforcement never begins from
    /// nothing — and what a screen may claim of them; then a wake at their end. Never put on over
    /// the marker gone (F1b): iOS would keep them, and enforce none.
    private func apply() async {
        let state = await engine.state
        let until = state.shieldedUntil(clock.now())
        let marker = await screenTime.marker()
        let shielding = await screenTime.isShielding()
        if until != nil, !shielding, marker != .missing {
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
        // a check's newer read made meanwhile.
        if read != .notDetermined || marker != .unwritten { undetermined = nil }
        let inStore = await screenTime.isShielding()
        // B5b: iOS wakes the monitor at the end of the shields the store holds, for a closed app —
        // asked again as the end moves (a new session, an extension, a re-tap) and cancelled once
        // they are off, or denied has iOS drop them; but never cancelled over what is not known —
        // where the phone stood unread (the last run's window may be what takes its shields off),
        // or a permission read not determined for a moment, the store's shields still on.
        let window = inStore && read == .approved ? until.map(Bell.window) : nil
        var unscheduled = protection.unscheduled
        if window == nil, state.standing == .unread || read == .notDetermined {
            unscheduled = false
        } else if window != scheduled || unscheduled {
            do {
                try await screenTime.schedule(window)
                (scheduled, unscheduled) = (window, false)
            } catch {
                unscheduled = true
            }
        }
        let (permission, off) = judged(read, marker)
        let shielded = inStore && permission == .approved
        let monitorUnscheduled = await screenTime.monitorUnscheduled()
        // Read after the last wait, so a check made meanwhile keeps what it found (`unreported`).
        var next = protection
        (next.checked, next.permission, next.shielded) = (true, permission, shielded)
        next.permissionOff = off
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
