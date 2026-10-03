import BaliOutbox
import DeviceActivity
import Foundation

#if DEBUG
    @preconcurrency import FamilyControls
    @preconcurrency import ManagedSettings
#endif

// The DeviceActivity monitor (ARCHITECTURE, "iOS app structure", decision 2; B5b): iOS wakes it at
// the end of the windows the app registered — the bell, or decision 7's cap, and its backup — and of
// the ones it asked for itself, with the app open or force-quit. What it does is `Bell.wake`'s and
// `Bell.carryOut`'s, tested on Linux; this carries it out, synchronously, since iOS may suspend it
// the moment it returns, and asks iOS for nothing else: every call it makes of DeviceActivity is
// `carryOut`'s, never for the window that woke it (B5b-3). The windows' start is nothing of Bali's:
// the app shields at the tap itself and registers the windows after. Its principal class, named in
// its Info.plist.
final class SessionMonitor: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        #if DEBUG
            let storeAtWake = Self.probeStore  // PROBE (#144's experiment build)
        #endif
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
        #if DEBUG
            Self.probe("intervalDidEnd", activity, store: storeAtWake, did: done)
        #endif
    }

    #if DEBUG
        // PROBE — #144's experiment build, never merged (`Probe`): every wake, logged after what
        // main does at it — the callback and window, this process's id, its own Family Controls
        // read and its store's, read at the wake. The start of a window wakes it too, which main
        // leaves to `DeviceActivityMonitor`'s own nothing.
        override func intervalDidStart(for activity: DeviceActivityName) {
            super.intervalDidStart(for: activity)
            Self.probe("intervalDidStart", activity, store: Self.probeStore)
        }

        private static var probeStore: String {
            ManagedSettingsStore(named: .bali).shield.applicationCategories != nil ? "on" : "off"
        }

        private static func probe(
            _ callback: String, _ activity: DeviceActivityName, store: String, did: String? = nil
        ) {
            Probe.log(
                "monitor \(callback) \(activity.rawValue) · pid \(ProcessInfo.processInfo.processIdentifier)"
                    + " · auth \(AuthorizationCenter.shared.authorizationStatus) · store \(store) at wake"
                    + (did.map { " · did \($0)" } ?? ""))
        }
    #endif

    private func carryOut(_ woken: Bell.Name?) -> String {
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
            refused: &Bell.monitorUnscheduled, asked: &Bell.monitorAsked)
    }
}
