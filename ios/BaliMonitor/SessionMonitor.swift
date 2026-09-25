import BaliOutbox
import DeviceActivity
import Foundation

// The DeviceActivity monitor (ARCHITECTURE, "iOS app structure", decision 2; B5b): iOS wakes it at
// the end of the window the app registered — the bell, or decision 7's cap — with the app open or
// force-quit. What it does is `Bell.wake`'s, tested on Linux; this carries it out, synchronously,
// since iOS may suspend it the moment it returns. The window's start is nothing of Bali's: the app
// shields at the tap itself and registers the window after. Its principal class, named in its
// Info.plist.
final class SessionMonitor: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard let url = Outbox.appGroupURL else { return }
        let started = ContinuousClock.now
        #if DEBUG
            let cap = Bell.deviceCheckCap ?? SyncState.tapCap
        #else
            let cap = SyncState.tapCap
        #endif
        let wake = Bell.wake(outboxAt: url, now: Date(), cap: cap)
        var done = "cleared"
        switch wake {
        case .clear: Bell.clearShields()
        case .keep(let window), .retry(let window):
            let until = window.end.formatted(date: .omitted, time: .shortened)
            done = wake == .keep(window) ? "kept until \(until)" : "file not read — kept, again \(until)"
            do { try Bell.register(window) } catch { done += ", NOT registered: \(error)" }
        }
        let at = Date().formatted(date: .omitted, time: .standard)
        Bell.lastWake = "\(at) · \(done) · \(ContinuousClock.now - started)"
    }
}
