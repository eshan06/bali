import BaliOutbox
import DeviceActivity
import Foundation

// The DeviceActivity monitor (ARCHITECTURE, "iOS app structure", decision 2; B5b): iOS wakes it at
// the end of the windows the app registered — the bell, or decision 7's cap, and its backup — and of
// the ones it asked for itself, with the app open or force-quit. What it does is `Bell.wake`'s and
// `Bell.carryOut`'s, tested on Linux; this carries it out, synchronously, since iOS may suspend it
// the moment it returns, and asks iOS for nothing else: every call it makes of DeviceActivity is
// `carryOut`'s, never for the window that woke it (B5b-3). At a window's start it only looks at the
// marker (F1b): the app shields at the tap itself and registers the windows after. Its principal
// class, named in its Info.plist.
final class SessionMonitor: DeviceActivityMonitor {
    /// A window's start: the marker looked at, and found gone, noted for the app's next run (F1b) —
    /// nothing else read or asked.
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        _ = Marker.noted(at: Date())
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let started = ContinuousClock.now
        // Which window woke it: the bell's, its backup, or one it asked for itself (`tick`, `tock`).
        let woken = Bell.Name(rawValue: activity.rawValue)
        let name = woken.map { "\($0)" } ?? activity.rawValue
        let wake = "\(Date().formatted(date: .omitted, time: .standard)) · \(name)"
        // Kept before anything else, so a wake iOS ends before it finishes still shows.
        let begun = "\(wake) · not finished"
        Bell.wakes = Bell.logged(begun, in: Bell.wakes)
        let done = "\(wake) · \(carryOut(woken)) · \(ContinuousClock.now - started)"
        Bell.wakes = Bell.logged(done, replacing: begun, in: Bell.wakes)
    }

    private func carryOut(_ woken: Bell.Name?) -> String {
        // Screen Time access taken back — the marker gone (F1b) — is noted for the app, which
        // reports it at its next run; the wake then asks iOS for no next one.
        let accessLost = Marker.noted(at: Date())
        #if DEBUG
            if woken == .bell, Bell.deviceCheckLosesBell {
                Bell.deviceCheckLosesBell = false
                return "lost on purpose (device check) — nothing done"
            }
            let cap = Bell.deviceCheckCap ?? SyncState.tapCap
        #else
            let cap = SyncState.tapCap
        #endif
        guard let url = Outbox.appGroupURL else { return "no app group — nothing read, kept" }
        let wake = Bell.wake(outboxAt: url, now: Date(), cap: cap)
        // A wake iOS refuses is kept for the app to show at its next open (rule 5); the ends it
        // asked for, to tell a stop's or a replacement's wake from its window's end (B5b-5).
        return Bell.carryOut(
            wake, woken: woken, at: Date(), in: DeviceActivityCenter(), clearing: Bell.clearShields,
            refused: &Bell.monitorUnscheduled, asked: &Bell.monitorAsked, accessLost: accessLost)
    }
}
