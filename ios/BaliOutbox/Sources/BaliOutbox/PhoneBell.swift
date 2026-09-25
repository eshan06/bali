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

    extension DeviceActivityCenter: BellCenter {
        public func heldEnd() -> DateComponents? { schedule(for: .bali)?.intervalEnd }

        public func start(_ start: DateComponents, _ end: DateComponents) throws {
            try startMonitoring(
                .bali,
                during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false))
        }

        public func stop() { stopMonitoring([.bali]) }
    }

    extension Bell {
        /// Asks iOS to wake the monitor at `window`'s end — or, nil, at none — by `register(_:in:)`'s
        /// rule. A window iOS takes ends the monitor's refusal: one is registered again.
        public static func register(_ window: DateInterval?) throws {
            try register(window, in: DeviceActivityCenter())
            if window != nil { monitorUnscheduled = nil }
        }

        /// Takes the shields off, as the monitor does when nothing keeps them on.
        public static func clearShields() { ManagedSettingsStore(named: .bali).clearAllSettings() }

        /// When iOS refused the monitor the window it asked for, woken with the app closed: nothing
        /// wakes it again, so the shields it kept outlive their end until the app is opened. In the
        /// app group's defaults, for the app to show at its next open (rule 5), until a window is
        /// registered again or a wake of the monitor's ends well.
        public static var monitorUnscheduled: Date? {
            get { shared?.object(forKey: "monitorUnscheduled") as? Date }
            set { shared?.set(newValue, forKey: "monitorUnscheduled") }
        }

        /// B5b's device check, in the app group's defaults that the app and the monitor share: the
        /// shorter cap on a tap not yet answered a Debug build may set (`floor`, not 50 minutes),
        /// and what the monitor's last wake did, which a Debug build's readout shows.
        public static var deviceCheckCap: TimeInterval? {
            get { shared?.object(forKey: "deviceCheckCap") as? TimeInterval }
            set { shared?.set(newValue, forKey: "deviceCheckCap") }
        }
        public static var lastWake: String? {
            get { shared?.string(forKey: "lastWake") }
            set { shared?.set(newValue, forKey: "lastWake") }
        }
        private static var shared: UserDefaults? { UserDefaults(suiteName: Outbox.appGroup) }
    }
#endif
