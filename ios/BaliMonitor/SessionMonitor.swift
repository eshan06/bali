import BaliOutbox
import DeviceActivity
import Foundation

// The DeviceActivity monitor (ARCHITECTURE, "iOS app structure", decision 2; B5b): iOS wakes it at
// the end of the window the app registered — the bell, or decision 7's cap — with the app open or
// force-quit. What it does, and in what order, is `Bell.carryOut`'s, tested on Linux; this carries
// it out, synchronously, since iOS may suspend it the moment it returns. The window's start is
// nothing of Bali's: the app shields at the tap itself and registers the window after. Its
// principal class, named in its Info.plist.
final class SessionMonitor: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let started = ContinuousClock.now
        let at = { Date().formatted(date: .omitted, time: .standard) }
        guard let url = Outbox.appGroupURL else {
            Bell.lastWake = "\(at()) · no app group — nothing read, kept"
            return
        }
        #if DEBUG
            let cap = Bell.deviceCheckCap ?? SyncState.tapCap
        #else
            let cap = SyncState.tapCap
        #endif
        // Its next wake asked for before the file is read; one iOS refuses kept for the app to show
        // at its next open, as it is refused (rule 5).
        let done = Bell.carryOut(
            outboxAt: url, at: Date(), cap: cap, in: DeviceActivityCenter(),
            clearing: Bell.clearShields, refused: { Bell.monitorUnscheduled = $0 })
        Bell.lastWake = "\(at()) · \(done) · \(ContinuousClock.now - started)"
    }
}
