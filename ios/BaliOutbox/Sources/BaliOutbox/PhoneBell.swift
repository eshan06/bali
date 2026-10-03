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
        /// The marker's own store (F1b): never the shields', which the monitor clears at the bell.
        public static let baliMarker = Self("bali.marker")
    }

    extension Marker {
        /// The marker as this phone holds it now: its flag, in the app group's defaults, which a
        /// revocation leaves, and the marker itself, which iOS deletes with the rest of Bali's
        /// settings — "Removing unauthorized client record" (#144's experiment).
        public static var now: Marker {
            guard shared?.bool(forKey: "markerWritten") == true else { return .unwritten }
            return ManagedSettingsStore(named: .baliMarker).media.denyExplicitContent == nil
                ? .missing : .present
        }

        /// Writes the marker — explicit content not denied: the least any store can say, so it
        /// restricts nothing — and its flag and the monitor's note by `written`'s rule: the flag
        /// set, and the note forgotten, only once the marker reads back. After an authorization
        /// iOS confirmed, only.
        public static func write() {
            let store = ManagedSettingsStore(named: .baliMarker)
            store.media.denyExplicitContent = false
            let after = written(readBack: store.media.denyExplicitContent != nil, note: lostAt)
            shared?.set(after.flag, forKey: "markerWritten")
            lostAt = after.note
        }

        /// When the monitor, woken with the app closed, first found the marker gone since it was
        /// written: in the app group's defaults, for the app's next run to report (F1b).
        public static var lostAt: Date? {
            get { shared?.object(forKey: "markerLostAt") as? Date }
            set { shared?.set(newValue, forKey: "markerLostAt") }
        }

        /// The monitor's look at the marker at a wake, by `noting`'s rule — gone, with the shields'
        /// store empty too, it is noted at `date`, the first such wake's time kept. Whether it was
        /// gone.
        public static func noted(at date: Date) -> Bool {
            let shield = ManagedSettingsStore(named: .bali).shield
            let shielded = shield.applicationCategories != nil || shield.webDomainCategories != nil
            let look = noting(now, shielded: shielded, note: lostAt, at: date)
            if look.note != lostAt { lostAt = look.note }
            return look.lost
        }

        private static var shared: UserDefaults? { UserDefaults(suiteName: Outbox.appGroup) }
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
        /// The app's windows: the bell's at `window`'s end and its backup — or, nil, none — the
        /// monitor's own stopped once the bell's is new, by `register(_:in:)`'s rule. A window iOS
        /// takes ends the monitor's refusal: one is registered again — never a pass that asked for
        /// none, iOS holding both as they are (#103's review).
        public static func register(_ window: DateInterval?) throws {
            if try register(window, in: DeviceActivityCenter()) { monitorUnscheduled = nil }
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

        /// The end the monitor last asked for under each of its own names, in the app group's
        /// defaults: how it tells a stop's or a replacement's wake from its window's end
        /// (`carryOut`, B5b-5).
        public static var monitorAsked: [Name: Date] {
            get {
                let kept = shared?.dictionary(forKey: "monitorAsked") as? [String: Date] ?? [:]
                return kept.reduce(into: [:]) { asked, entry in
                    if let name = Name(rawValue: entry.key) { asked[name] = entry.value }
                }
            }
            set {
                let kept = newValue.reduce(into: [String: Date]()) { $0[$1.key.rawValue] = $1.value }
                shared?.set(kept, forKey: "monitorAsked")
            }
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
