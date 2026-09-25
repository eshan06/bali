import Foundation

/// The bell with the app closed (ARCHITECTURE, "iOS app structure", decision 2 and "Decided later":
/// leaning (a); B5b): the window the shields are on is registered with iOS as a DeviceActivity
/// schedule, and iOS wakes the monitor extension at its end — the bell, or decision 7's cap — with
/// the app open or force-quit. The rules, apart from iOS: the enforcer registers the window, and the
/// monitor carries out `wake`.
public enum Bell {
    /// iOS's floor: no DeviceActivity interval is shorter.
    public static let floor: TimeInterval = 15 * 60
    /// How long the extensions' whole read of the outbox file may take — its coordinated open,
    /// SQLite's locks, an open still under way: a ceiling (`Outbox.read`), a migration's own work
    /// alone waited out — before the monitor gives up and keeps the shields, and the shield says
    /// Bali's name alone: never so long that iOS kills the monitor mid-wake.
    public static let patience: TimeInterval = 2
    /// The least the monitor waits for its next wake: to read a file it could not, or for shields
    /// still owed at a wake that came early.
    public static let retry: TimeInterval = 60

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

    /// What the monitor does at a wake.
    public enum Wake: Sendable, Hashable {
        /// Nothing keeps the shields on: the store is cleared.
        case clear
        /// Something does — a session the standing says still runs, a later tap's cap — so they
        /// stay, and iOS is to wake the monitor again at this window's end: theirs, but never
        /// less than `retry` on, so a wake that came early never asks for the window that woke it —
        /// which iOS may hold still, and `register` would not ask for again.
        case keep(DateInterval)
        /// The file could not be read in time: the shields stay — never cleared over what the
        /// monitor cannot read — and iOS is to wake it again at this window's end, to try again.
        case retry(DateInterval)
    }

    /// The monitor's wake at `now`: the outbox file opened within `patience` (`bound`, for the tests),
    /// where the phone stood and what it queued read — with `cap`, decision 7's or a device check's —
    /// and the file closed, then decided by the phone's own clock (data model, decision 6). The
    /// one extension read that migrates a file this build has yet to (`Outbox.read`): the shield's
    /// never does.
    public static func wake(
        outboxAt url: URL, now: Date, cap: TimeInterval = SyncState.tapCap,
        within bound: TimeInterval = patience
    ) -> Wake {
        wake(now: now) {
            var state = try Outbox.read(url, within: bound, migrating: true)
            state.cap = cap
            return state
        }
    }

    static func wake(now: Date, reading read: () throws -> SyncState) -> Wake {
        guard let state = try? read() else { return .retry(window(until: now + retry)) }
        return state.shieldedUntil(now).map { .keep(window(until: max($0, now + retry))) } ?? .clear
    }

    /// The monitor's `wake` at `now`, carried out: nothing keeps the shields on — `clear` them;
    /// else its next wake asked of `center`. One iOS refuses leaves nothing to wake the monitor
    /// again, so the shields it keeps outlive their end with the app closed: `refused` is set to
    /// `now`, for the app to show from its next open (`Protection.monitorUnscheduled`), and a wake
    /// that ends well — cleared, or its next wake taken — sets it back to none (#92's review). What
    /// it did, for the Debug readout.
    public static func carryOut(
        _ wake: Wake, at now: Date, in center: some BellCenter, clearing clear: () -> Void,
        refused: inout Date?
    ) -> String {
        let next: (window: DateInterval, done: String)
        switch wake {
        case .clear:
            clear()
            refused = nil
            return "cleared"
        case .keep(let window): next = (window, "kept until")
        case .retry(let window): next = (window, "file not read — kept, again")
        }
        let said = "\(next.done) \(next.window.end.formatted(date: .omitted, time: .shortened))"
        do {
            try register(next.window, in: center)
            refused = nil
            return said
        } catch {
            refused = now
            return "\(said), NOT registered: \(error)"
        }
    }

    /// Asks `center` to wake the monitor at `window`'s end — or, nil, at none — replacing the window
    /// asked for before, unless iOS holds one ending there already: a replacement may itself wake
    /// the monitor, which asks again at each wake, and the two would never end. A window iOS
    /// refuses throws, and iOS keeps the one it held.
    public static func register(
        _ window: DateInterval?, in center: some BellCenter, calendar: Calendar = .current
    ) throws {
        guard let window else { return center.stop() }
        if let held = center.heldEnd(), calendar.date(from: held) == window.end { return }
        let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        try center.start(
            calendar.dateComponents(parts, from: window.start),
            calendar.dateComponents(parts, from: window.end))
    }
}

/// iOS's DeviceActivity center, as the bell asks it for wakes — behind a protocol, so `register`'s
/// rule is tested on Linux (#91's review). The phone's is `DeviceActivityCenter`, for one activity.
public protocol BellCenter {
    /// The end of the window iOS holds, as it was registered; nil: none.
    func heldEnd() -> DateComponents?
    /// Asks iOS to wake the monitor at the end of the interval from `start` to `end`, replacing the
    /// window it holds.
    func start(_ start: DateComponents, _ end: DateComponents) throws
    /// Asks iOS for no wake.
    func stop()
}
