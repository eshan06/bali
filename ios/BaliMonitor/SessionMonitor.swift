import DeviceActivity

// The DeviceActivity monitor (ARCHITECTURE, "iOS app structure", decision 2): the app registers
// each session's window with iOS, and iOS runs this at its edges, with the app open or not. It
// shares the app group with the app, where B3 keeps the session and the outbox. Its principal
// class, named in its Info.plist.
final class SessionMonitor: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        // B5: the window opened — shield again from the session in the app group.
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // B5: the bell, or decision 7's 50-minute cap — clear the shields, even force-quit.
    }
}
