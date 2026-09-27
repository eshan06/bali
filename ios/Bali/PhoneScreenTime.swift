import BaliOutbox
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

    func schedule(_ window: DateInterval?) throws { try Bell.register(window) }

    func monitorUnscheduled() -> Date? { Bell.monitorUnscheduled }
}

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
