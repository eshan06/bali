import Foundation

/// The bell with the app closed (ARCHITECTURE, "iOS app structure", decision 2 and "Decided later":
/// leaning (a); B5b): the window the shields are on is registered with iOS as a DeviceActivity
/// schedule, and iOS wakes the monitor extension at its end — the bell, or decision 7's cap — with
/// the app open or force-quit; and a backup window beside it, so a wake that dies does not keep the
/// shields past the bell until the app is opened (B5b-3). The rules, apart from iOS: the enforcer
/// registers the windows, and the monitor carries out `wake`.
public enum Bell {
    /// iOS's floor: no DeviceActivity interval is shorter.
    public static let floor: TimeInterval = 15 * 60
    /// How long the monitor's whole read of the outbox file may take — its coordinated open,
    /// SQLite's locks, an open still under way: a ceiling (`Outbox.read`), a migration's own work
    /// alone waited out — before it gives up and keeps the shields: never so long that iOS kills
    /// it mid-wake.
    public static let patience: TimeInterval = 2
    /// The least the monitor waits for its next wake: to read a file it could not, or for shields
    /// still owed at a wake that came early.
    public static let retry: TimeInterval = 60
    /// How long after the bell's window its backup's ends: past the monitor's own next wake a
    /// minute on (`retry`), so a wake that came early has cleared the shields by then — and no
    /// longer, since a wake lost keeps them on this much past the bell.
    public static let backupAfter: TimeInterval = 2 * 60

    /// The windows iOS wakes the monitor at, each an activity of its own with iOS, so that no wake
    /// of the monitor's ever asks for the window that woke it: on iOS 18, `startMonitoring` called
    /// inside `intervalDidEnd` for the same activity deadlocks (Apple's forums, FB14664238). The
    /// app asks for the bell's and its backup; the monitor, for its own two, in turn
    /// (`next(after:)`).
    public enum Name: String, CaseIterable, Sendable {
        /// The bell's window: the shields' end — B5b's one activity, under its name.
        case bell = "bali"
        /// The bell's backup, `backupAfter` later: a wake of the bell's that died — hung, killed,
        /// or its next wake refused — is made again, and reads and clears as the bell's does.
        case backup = "bali.backup"
        /// The monitor's own next wakes, asked for in turn.
        case tick = "bali.tick"
        case tock = "bali.tock"
    }

    /// The name the monitor asks for its next wake under, woken under `woken` (nil: a name this
    /// build does not know): never the one that woke it.
    public static func next(after woken: Name?) -> Name { woken == .tick ? .tock : .tick }

    /// The interval iOS is asked for, to wake the monitor at `until`. It ends at the first whole
    /// minute at or after `until`: never before it, where the shields are still owed — so no
    /// granularity iOS may keep wakes the monitor early — and less than a minute after. And it is
    /// exactly the floor long: its start moves back, never its end. So a window shorter than the
    /// floor (a tap in a session's last ten minutes) starts in the past, which iOS takes as an
    /// interval under way. With the app closed, the shields so come off less than a minute past
    /// the bell — or, when iOS wakes the monitor before the bell after all, less than two: it keeps
    /// them, and is woken again a minute on, at the whole minute (`wake`).
    public static func window(until: Date) -> DateInterval {
        let end = Date(timeIntervalSince1970: (until.timeIntervalSince1970 / 60).rounded(.up) * 60)
        return DateInterval(start: end - floor, end: end)
    }

    /// The backup of the bell's window `window`: `backupAfter` later, as long.
    public static func backup(of window: DateInterval) -> DateInterval {
        DateInterval(start: window.start + backupAfter, end: window.end + backupAfter)
    }

    /// What the monitor does at a wake.
    public enum Wake: Sendable, Hashable {
        /// Nothing keeps the shields on: the store is cleared.
        case clear
        /// Something does — a session the standing says still runs, a later tap's cap — so they
        /// stay, and iOS is to wake the monitor again at this window's end: theirs, but never
        /// less than `retry` on, so a wake that came early asks for a window a whole minute on,
        /// never for the end it was just woken at — which iOS, keeping its own time, ended early
        /// once already.
        case keep(DateInterval)
        /// The file could not be read in time: the shields stay — never cleared over what the
        /// monitor cannot read — and iOS is to wake it again at this window's end, to try again.
        case retry(DateInterval)
    }

    /// The monitor's wake at `now`: the outbox file opened within `patience` (`bound`, for the tests),
    /// where the phone stood and what it queued read — with `cap`, decision 7's or a device check's —
    /// and the file closed, then decided by the phone's own clock (data model, decision 6) — a
    /// file this build has yet to migrate migrated first (`Outbox.read`). Whichever window woke
    /// it, the same: the backup's reads and clears as the bell's.
    public static func wake(
        outboxAt url: URL, now: Date, cap: TimeInterval = SyncState.tapCap,
        within bound: TimeInterval = patience
    ) -> Wake {
        wake(now: now) {
            var state = try Outbox.read(url, within: bound)
            state.cap = cap
            return state
        }
    }

    static func wake(now: Date, reading read: () throws -> SyncState) -> Wake {
        guard let state = try? read() else { return .retry(window(until: now + retry)) }
        return state.shieldedUntil(now).map { .keep(window(until: max($0, now + retry))) } ?? .clear
    }

    /// The monitor's `wake` at `now`, woken under `woken`, carried out: nothing keeps the shields on
    /// — `clear` them, which says whether the store held any, and ask iOS nothing; else its next
    /// wake asked of `center` under `next(after:)` — never the name that woke it — and nothing else
    /// asked of it. Asked for anew, every time, replacing whatever iOS holds under that name: a
    /// window of the monitor's own, which its wake there spent — iOS holds a window it has ended
    /// still — or one that is stale, since the truth read now decides. Skipped for one ending
    /// there already, as the app's are (`ask`), a wake would be dropped, and recorded nowhere: iOS
    /// ending its windows a minute early, the bell's wake asks for `tick` at the bell, `tick`'s
    /// for `tock` there, and `tock`'s would find `tick` — spent — ending there already (#99's
    /// review). One iOS refuses leaves nothing to wake the monitor again — but the bell's
    /// backup, when it is still to come — so the shields it keeps may outlive their end with the
    /// app closed: `refused` is set to `now`, for the app to show from its next open
    /// (`Protection.monitorUnscheduled`), and a wake that ends well — cleared, or its next wake
    /// taken, the backup's too — sets it back to none (#92's review). What it did, for the Debug
    /// readout.
    ///
    /// Stopping or replacing a window wakes the monitor under it at once (round 2,
    /// `docs/DECISIONS.md`, 2026-09-29) — its own asks' replacements too, so a wake that asked for
    /// a window iOS held under the other name could wake it again at once, and `tick` and `tock`
    /// each other, back to back (#113's review). So `asked` keeps the end it last asked for under
    /// each of its own names, and woken under one more than `retry` before that end — never that
    /// window's end, which iOS reaches no earlier than a minute before it (`window`) — the wake is a
    /// stop's or a replacement's, and asks nothing: what it asked for there is still to come, or the
    /// app stopped it, for a new bell window or with the shields off (B5b-5). A clear still clears.
    ///
    /// `accessLost` — the marker gone, its flag set, the shields' store empty (F1b, #144;
    /// `Marker.noted`) — asks nothing either: iOS deleted Bali's windows with the access, and the
    /// app reports it at its next run. A store still holding shields never reads as lost, and a
    /// clear still clears, so a misread never keeps the shields past their end.
    public static func carryOut(
        _ wake: Wake, woken: Name?, at now: Date, in center: some BellCenter,
        clearing clear: () -> Bool, refused: inout Date?, asked: inout [Name: Date],
        accessLost: Bool = false
    ) -> String {
        let next: (window: DateInterval, kept: String, then: String)
        switch wake {
        case .clear:
            let held = clear()
            refused = nil
            return held ? "cleared" : "nothing to clear"
        case .keep(let window): next = (window, "kept", " until")
        case .retry(let window): next = (window, "file not read — kept", ", again")
        }
        if accessLost { return "\(next.kept) — Screen Time access lost: nothing asked" }
        if let woken, let end = asked[woken], now < end - retry {
            return "\(next.kept) — its window stopped or replaced, not ended: nothing asked"
        }
        let said =
            "\(next.kept)\(next.then) \(next.window.end.formatted(date: .omitted, time: .shortened))"
        let name = self.next(after: woken)
        do {
            try start(next.window, as: name, in: center)
            asked[name] = next.window.end
            refused = nil
            return said
        } catch {
            refused = now
            return "\(said), NOT registered: \(error)"
        }
    }

    /// The app's windows (the enforcer's, through `ScreenTime.schedule`): the bell's at `window`,
    /// and its backup — or, nil, none — asked of `center`, each by `ask`'s rule, replacing those
    /// asked for before. Once the bell's is new, none of the monitor's own: aimed at the truth the
    /// app has just replaced, they are stale — stopped only once the app's are taken, so a refusal
    /// leaves a wake the monitor asked for in place. While iOS holds the bell's window as it is —
    /// a relaunch's first pass, a pass that takes the backup alone, refused before — the monitor's
    /// own stays: the bell's window may have woken it early already, spent, and its own next wake
    /// is then the one still to come, at the bell (#99's review: stopped over the backup alone, it
    /// left none there). A window iOS refuses throws, and iOS keeps the one it held. No callback of
    /// the monitor's runs in the app, so every name is the app's to ask for. Whether it asked for
    /// a window, which iOS took: a pass that asked none — iOS holding both as they are — registered
    /// nothing, so it ends no refusal of the monitor's (#103's review).
    @discardableResult
    public static func register(
        _ window: DateInterval?, in center: some BellCenter, calendar: Calendar = .current
    ) throws -> Bool {
        guard let window else {
            center.stop(Name.allCases)
            return false
        }
        let bellIsNew = try ask(window, as: .bell, in: center, calendar: calendar)
        let backupIsNew = try ask(backup(of: window), as: .backup, in: center, calendar: calendar)
        // Stopping and replacing windows wakes the monitor at once (round 2, `docs/DECISIONS.md`,
        // 2026-09-29): the bell's and backup's wakes ask for a `tick` at the new bell — one wake
        // there for nothing — and a stopped `tick` or `tock`'s, more than a minute before the end
        // it asked for there, asks nothing (`carryOut`, B5b-5).
        if bellIsNew { center.stop([.tick, .tock]) }
        return bellIsNew || backupIsNew
    }

    /// The app's ask of `center`, to wake the monitor at `window`'s end under `name`, replacing the
    /// window it holds there — unless it holds one ending there already: the app asks at every pass
    /// that finds nothing scheduled, a relaunch's first among them, and a window iOS holds is
    /// asked for nothing new (B5b's guard, #91's review). Whether it asked — the bell's being new
    /// is what `register` stops the monitor's own by. The monitor's own asks never skip
    /// (`carryOut`).
    static func ask(
        _ window: DateInterval, as name: Name, in center: some BellCenter,
        calendar: Calendar = .current
    ) throws -> Bool {
        if holds(window, as: name, in: center, calendar: calendar) { return false }
        try start(window, as: name, in: center, calendar: calendar)
        return true
    }

    /// Whether `center` holds a window ending at `window`'s end under `name`, read in `calendar` —
    /// the app's to read, never the monitor's (`BellCenter.heldEnd`).
    public static func holds(
        _ window: DateInterval, as name: Name, in center: some BellCenter,
        calendar: Calendar = .current
    ) -> Bool {
        center.heldEnd(name).flatMap(calendar.date(from:)) == window.end
    }

    /// Asks `center` to wake the monitor at `window`'s end under `name`, to the second in
    /// `calendar`, replacing the window it holds there.
    static func start(
        _ window: DateInterval, as name: Name, in center: some BellCenter,
        calendar: Calendar = .current
    ) throws {
        let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        try center.start(
            name, calendar.dateComponents(parts, from: window.start),
            calendar.dateComponents(parts, from: window.end))
    }

    /// The monitor's last wakes, newest first, as the Debug readout shows them: `line` in place of
    /// `old` where it is — a wake's outcome, over the note it began with — else first; three kept.
    public static func logged(_ line: String, replacing old: String? = nil, in log: [String])
        -> [String]
    {
        var log = log
        if let old, let index = log.firstIndex(of: old) {
            log[index] = line
        } else {
            log.insert(line, at: 0)
        }
        return Array(log.prefix(3))
    }
}

/// iOS's DeviceActivity center, as the bell asks it for wakes — behind a protocol, so the rules of
/// `register` and `carryOut` are tested on Linux (#91's review). The phone's is
/// `DeviceActivityCenter`, one activity for each name. No `activities`: on iOS 18 the monitor
/// deadlocked on it (FB14664238's thread), and nothing here needs it.
public protocol BellCenter {
    /// The end of the window iOS holds under `name`, as it was registered — held past its end too,
    /// spent, until it is stopped or replaced; nil: none. The app's to read (`Bell.ask`), never the
    /// monitor's.
    func heldEnd(_ name: Bell.Name) -> DateComponents?
    /// Asks iOS to wake the monitor at the end of the interval from `start` to `end`, under `name`,
    /// replacing the window it holds there.
    func start(_ name: Bell.Name, _ start: DateComponents, _ end: DateComponents) throws
    /// Asks iOS for no wake under `names`.
    func stop(_ names: [Bell.Name])
}
