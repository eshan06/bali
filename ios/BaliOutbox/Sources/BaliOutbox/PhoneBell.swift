#if os(iOS)
    @preconcurrency import DeviceActivity
    import Foundation
    @preconcurrency import ManagedSettings

    // The bell's calls into iOS (B5b), shared by the app, which registers the window, and the
    // monitor, which clears the shields at its end or asks to be woken again. Thin on purpose: what
    // to register, and when to clear, is `Bell`'s and `Enforcer`'s, tested on Linux.

    extension ManagedSettingsStore.Name {
        /// The app's one store: the app shields through it, and the monitor clears it.
        public static let bali = Self("bali")
    }

    extension DeviceActivityName {
        /// The window the shields are on: iOS wakes the monitor at its end.
        public static let bali = Self("bali")
    }

    extension Bell {
        /// Asks iOS to wake the monitor at `window`'s end — or, nil, at none — replacing the window
        /// asked for before, unless it is that one already: a replacement may itself wake the
        /// monitor, which asks again at each wake, and the two would never end.
        public static func register(_ window: DateInterval?) throws {
            let center = DeviceActivityCenter()
            guard let window else { return center.stopMonitoring([.bali]) }
            let calendar = Calendar.current
            if let held = center.schedule(for: .bali),
                calendar.date(from: held.intervalEnd) == window.end
            {
                return
            }
            let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
            try center.startMonitoring(
                .bali,
                during: DeviceActivitySchedule(
                    intervalStart: calendar.dateComponents(parts, from: window.start),
                    intervalEnd: calendar.dateComponents(parts, from: window.end), repeats: false))
        }

        /// Takes the shields off, as the monitor does when nothing keeps them on.
        public static func clearShields() { ManagedSettingsStore(named: .bali).clearAllSettings() }

        /// A Debug build's device check, in the app group's defaults that the app and the monitor
        /// share: the shorter cap on a tap not yet answered (`floor`, not 50 minutes), and what the
        /// monitor's last wake did.
        public static var deviceCheckCap: TimeInterval? {
            get { deviceCheck?.object(forKey: "deviceCheckCap") as? TimeInterval }
            set { deviceCheck?.set(newValue, forKey: "deviceCheckCap") }
        }
        public static var lastWake: String? {
            get { deviceCheck?.string(forKey: "lastWake") }
            set { deviceCheck?.set(newValue, forKey: "lastWake") }
        }
        private static var deviceCheck: UserDefaults? { UserDefaults(suiteName: Outbox.appGroup) }
    }
#endif
