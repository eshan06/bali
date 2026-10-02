import BaliOutbox
@preconcurrency import DeviceActivity
@preconcurrency import FamilyControls
import Foundation
@preconcurrency import ManagedSettings

/// Screen Time on this phone (B5), for the enforcer: the app's one `ManagedSettingsStore`, named so
/// the extensions open the same store, Family Controls' `.individual` authorization, and the
/// DeviceActivity window that wakes the monitor (B5b). Thin on purpose: what to shield, and when,
/// is `Enforcer`'s, tested on Linux.
@MainActor
final class PhoneScreenTime: ScreenTime {
    private let store = ManagedSettingsStore(named: .bali)

    func isShielding() -> Bool {
        store.shield.applicationCategories != nil && store.shield.webDomainCategories != nil
    }

    /// Every app and website a third party can block — no picker, no allow-list (2026-09-24). iOS
    /// itself keeps calls, FaceTime, Messages and Emergency SOS working.
    func shield() {
        store.shield.applicationCategories = .all()
        store.shield.webDomainCategories = .all()
    }

    func unshield() {
        store.shield.applicationCategories = nil
        store.shield.webDomainCategories = nil
    }

    func permission() -> Permission {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved: .approved
        case .denied: .denied
        default: .notDetermined
        }
    }

    /// iOS's own prompt; what it threw in the screen's words (C1b).
    func requestPermission() async throws {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
            throw ScreenTimeAskError(familyControls: error)
        }
    }

    func schedule(_ window: DateInterval?) throws {
        do {
            try Bell.register(window)
        } catch {
            #if DEBUG
                Self.found("window refused: \(error)")
            #endif
            if case .unauthorized? = error as? DeviceActivityCenter.MonitoringError {
                throw ScreenTimeUnauthorized()
            }
            throw error
        }
    }

    func holds(_ window: DateInterval) -> Bool {
        let held = Bell.holds(window, as: .bell, in: DeviceActivityCenter())
        #if DEBUG
            if !held { Self.found("bell window to \(Self.time(window.end)) gone from iOS") }
        #endif
        return held
    }

    func monitorUnscheduled() -> Date? { Bell.monitorUnscheduled }
}

#if DEBUG
    /// #144's device check, for the Debug readout: what the enforcer's checks found of iOS's
    /// DeviceActivity center, and the signals as iOS gives them now — which one flips when Screen
    /// Time access is taken back with the app running.
    extension PhoneScreenTime {
        /// A bell window gone, a window refused: newest first, three kept.
        static var findings: [String] = []

        static func found(_ finding: String) {
            findings = Bell.logged(
                "\(Date().formatted(date: .omitted, time: .standard)) · \(finding)", in: findings)
        }

        /// Family Controls' read now — which a running app keeps after the access is taken back —
        /// and the window iOS's center holds under each of Bali's names.
        static var signals: String {
            let center = DeviceActivityCenter()
            let held = Bell.Name.allCases.map { name in
                "\(name) \(center.heldEnd(name).flatMap(Calendar.current.date(from:)).map(time) ?? "none")"
            }
            return "Family Controls reads \(AuthorizationCenter.shared.authorizationStatus)"
                + " · iOS holds " + held.joined(separator: ", ")
        }

        static func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .standard) }
    }
#endif

extension ScreenTimeAskError {
    /// Family Controls' error from the ask, in the screen's words: Don't Allow — the permission
    /// reads denied then — is `cancelled`; anything else `failed`, what iOS said kept for the
    /// readout (C1b).
    init(familyControls error: any Error) {
        if case .authorizationCanceled? = error as? FamilyControlsError {
            self = .cancelled
        } else {
            self = .failed("\(error)")
        }
    }
}
