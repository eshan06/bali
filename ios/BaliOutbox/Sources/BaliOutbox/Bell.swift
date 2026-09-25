import Foundation

/// The bell with the app closed (ARCHITECTURE, "iOS app structure", decision 2 and "Decided later":
/// leaning (a); B5b): the window the shields are on is registered with iOS as a DeviceActivity
/// schedule, and iOS wakes the monitor extension at its end — the bell, or decision 7's cap — with
/// the app open or force-quit. The rules, apart from iOS: the enforcer registers the window, and the
/// monitor carries out `wake`.
public enum Bell {
    /// iOS's floor: no DeviceActivity interval is shorter.
    public static let floor: TimeInterval = 15 * 60
    /// How long the monitor waits for the outbox file — another process's coordinated open — before
    /// it gives up and keeps the shields: never so long that iOS kills it mid-wake.
    public static let patience: TimeInterval = 2
    /// The least the monitor waits for its next wake: to read a file it could not, or for shields
    /// still owed at a wake that came early.
    public static let retry: TimeInterval = 60

    /// The interval iOS is asked for, to wake the monitor at `until`. It ends at the first whole
    /// minute at or after `until`: never before it, where the shields are still owed — so no
    /// granularity iOS may keep wakes the monitor early — and less than a minute after. And it is
    /// exactly the floor long: its start moves back, never its end. So a window shorter than the
    /// floor (a tap in a session's last ten minutes) starts in the past, which iOS takes as an
    /// interval under way.
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
        /// which iOS may hold still, and the adapter would not ask for again.
        case keep(DateInterval)
        /// The file could not be read in time: the shields stay — never cleared over what the
        /// monitor cannot read — and iOS is to wake it again at this window's end, to try again.
        case retry(DateInterval)
    }

    /// The monitor's wake at `now`: the outbox file opened within `patience` (`bound`, for the tests),
    /// where the phone stood and what it queued read — with `cap`, decision 7's or a device check's —
    /// and the file closed, then decided by the phone's own clock (data model, decision 6).
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
}
