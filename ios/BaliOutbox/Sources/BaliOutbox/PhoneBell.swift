#if os(iOS)
    @preconcurrency import DeviceActivity
    import Foundation
    @preconcurrency import ManagedSettings

    // The bell's calls into iOS (B5b), shared by the app, which registers the windows, and the
    // monitor, which clears the shields at their end or asks to be woken again. Thin on purpose:
    // what to register, under which name, and when to clear, is `Bell`'s and `Enforcer`'s, tested
    // on Linux.

    extension ManagedSettingsStore.Name {
        /// The app's one store: the app shields through it, and the monitor clears it.
        public static let bali = Self("bali")
    }

    extension DeviceActivityCenter: BellCenter {
        public func heldEnd(_ name: Bell.Name) -> DateComponents? {
            schedule(for: DeviceActivityName(name.rawValue))?.intervalEnd
        }

        public func start(_ name: Bell.Name, _ start: DateComponents, _ end: DateComponents) throws
        {
            try startMonitoring(
                DeviceActivityName(name.rawValue),
                during: DeviceActivitySchedule(
                    intervalStart: start, intervalEnd: end, repeats: false))
        }

        /// Never with none: iOS reads an empty list as every activity.
        public func stop(_ names: [Bell.Name]) {
            guard !names.isEmpty else { return }
            stopMonitoring(names.map { DeviceActivityName($0.rawValue) })
        }
    }

    extension Bell {
        /// The app's windows: the bell's at `window`'s end and its backup — or, nil, none — and
        /// none of the monitor's own, by `register(_:in:)`'s rule. A window iOS takes ends the
        /// monitor's refusal: one is registered again.
        public static func register(_ window: DateInterval?) throws {
            try register(window, in: DeviceActivityCenter())
            if window != nil { monitorUnscheduled = nil }
        }

        /// Takes the shields off, as the monitor does when nothing keeps them on: whether the store
        /// held any — none, once another wake has cleared them.
        public static func clearShields() -> Bool {
            let store = ManagedSettingsStore(named: .bali)
            let held =
                store.shield.applicationCategories != nil || store.shield.webDomainCategories != nil
            store.clearAllSettings()
            return held
        }

        /// When iOS refused the monitor the window it asked for, woken with the app closed: nothing
        /// but the bell's backup wakes it again, so the shields it kept may outlive their end until
        /// the app is opened. In the app group's defaults, for the app to show at its next open
        /// (rule 5), until a window is registered again or a wake of the monitor's ends well.
        public static var monitorUnscheduled: Date? {
            get { shared?.object(forKey: "monitorUnscheduled") as? Date }
            set { shared?.set(newValue, forKey: "monitorUnscheduled") }
        }

        /// B5b's device check, in the app group's defaults that the app and the monitor share: the
        /// shorter cap on a tap not yet answered a Debug build may set (`floor`, not 50 minutes),
        /// and what the monitor's last wakes did (`logged`), which a Debug build's readout shows.
        public static var deviceCheckCap: TimeInterval? {
            get { shared?.object(forKey: "deviceCheckCap") as? TimeInterval }
            set { shared?.set(newValue, forKey: "deviceCheckCap") }
        }
        public static var wakes: [String] {
            get { shared?.stringArray(forKey: "wakes") ?? [] }
            set { shared?.set(newValue, forKey: "wakes") }
        }
        /// B5b-3's device check: the next wake of the bell's window lost on purpose — a Debug
        /// build's monitor does nothing at it, and turns this off — so its backup is seen clearing.
        public static var deviceCheckLosesBell: Bool {
            get { shared?.bool(forKey: "deviceCheckLosesBell") ?? false }
            set { shared?.set(newValue, forKey: "deviceCheckLosesBell") }
        }
        private static var shared: UserDefaults? { UserDefaults(suiteName: Outbox.appGroup) }
    }
#endif
