#if DEBUG
    import BaliOutbox
    import Combine
    @preconcurrency import DeviceActivity
    @preconcurrency import FamilyControls
    import Foundation
    @preconcurrency import ManagedSettings
    import os
    import SwiftUI

    /// PROBE — #144's experiment build, never merged (`Probe`): in the app, Family Controls'
    /// publisher at each emission; the signals each second, logged at a change and every 10 s as a
    /// heartbeat, and at each change of the scene's phase; and iOS's prompt asked directly, from the
    /// readout. Debug builds only.
    @MainActor
    enum AppProbe {
        /// The enforcer's own Screen Time, whose long-lived store is read (`Phone.start`).
        static var screenTime: PhoneScreenTime?
        private static var published: AnyCancellable?
        private static var last: String?
        private static var lastLogged = Date.distantPast
        /// The scene's phase, for the publisher's sink on whatever thread iOS emits on.
        nonisolated private static let scenePhase = OSAllocatedUnfairLock(initialState: "launching")

        /// At launch (`BaliApp.init`): the publisher subscribed, and the signals read each second
        /// for as long as iOS lets the app run.
        static func start() {
            guard published == nil else { return }
            // Never isolated to the main actor: the thread iOS emits on is what is logged.
            published = AuthorizationCenter.shared.$authorizationStatus.sink { @Sendable status in
                let thread = Thread.isMainThread ? "main thread" : "off the main thread"
                Probe.log("publisher · \(scenePhase.withLock { $0 }) · \(status) · \(thread)")
            }
            Task {
                while true {
                    let now = signals
                    if now != last {
                        record("change", now)
                    } else if Date().timeIntervalSince(lastLogged) >= 10 {
                        record("heartbeat", now)
                    }
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        }

        /// The scene's phase changed: every signal, at once.
        static func phaseChanged(_ phase: ScenePhase) {
            scenePhase.withLock { $0 = "\(phase)" }
            record("phase", signals)
        }

        private static func record(_ kind: String, _ signals: String) {
            (last, lastLogged) = (signals, Date())
            Probe.log("\(kind) · \(scenePhase.withLock { $0 }) · \(signals)")
        }

        /// Family Controls' read; the enforcer's long-lived store and a fresh one; the windows iOS
        /// holds under the bell's and its backup's names — `schedule(for:)`, never `activities`,
        /// which hung the monitor on iOS 18.
        private static var signals: String {
            let center = DeviceActivityCenter()
            let held = [Bell.Name.bell, .backup].map { name in
                let end = center.heldEnd(name).flatMap(Calendar.current.date(from:))
                return "\(name) \(end.map(PhoneScreenTime.window) ?? "none")"
            }
            let fresh = ManagedSettingsStore(named: .bali).shield.applicationCategories != nil
            let enforcer = screenTime.map { $0.probeStoreRead ? "on" : "off" } ?? "not started"
            return "auth \(AuthorizationCenter.shared.authorizationStatus) · enforcer store \(enforcer)"
                + " · fresh store \(fresh ? "on" : "off") · " + held.joined(separator: " · ")
        }

        /// The readout's "Probe: ask iOS": iOS's prompt asked directly — not through the enforcer,
        /// whose state stays as it is — what came of it, and Family Controls' read right after.
        static func askIOS() async {
            Probe.log("ask iOS · start")
            let started = Date()
            let result: String
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                result = "returned"
            } catch let error as FamilyControlsError {
                result = "threw FamilyControlsError.\(error)"
            } catch {
                result = "threw \(error)"
            }
            let took = String(format: "%.2f s", Date().timeIntervalSince(started))
            Probe.log(
                "ask iOS · end after \(took) · \(result)"
                    + " · status now \(AuthorizationCenter.shared.authorizationStatus)")
        }
    }
#endif
