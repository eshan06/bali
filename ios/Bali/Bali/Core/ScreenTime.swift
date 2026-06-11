import Foundation
#if canImport(FamilyControls)
import FamilyControls
import ManagedSettings
#endif

/// Shield control behind a protocol — the proven legacy seam. Real implementation
/// uses FamilyControls/ManagedSettings (device + entitlement); the stub keeps the
/// Simulator slice honest (reports shieldsApplied=false, permissionOk=true).
protocol ScreenTimeService {
    /// Whether Screen Time authorization is currently granted.
    var permissionOk: Bool { get }
    /// Whether shields are actually applied right now.
    var shieldsApplied: Bool { get }
    func requestAuthorization() async -> Bool
    func applyShields()
    func clearShields()
}

final class StubScreenTimeService: ScreenTimeService {
    private(set) var shieldsApplied = false
    var permissionOk: Bool { true }
    func requestAuthorization() async -> Bool { true }
    func applyShields() { shieldsApplied = false } // honest: nothing is shielded in the Simulator
    func clearShields() { shieldsApplied = false }
}

#if canImport(FamilyControls)
/// Device implementation. The policy's allowed apps stay SEMANTIC LABELS server-side;
/// the student picks matching apps locally via FamilyActivityPicker (S5) and we shield
/// everything except that selection — Bali never sees anyone's app list.
final class RealScreenTimeService: ScreenTimeService {
    private let store = ManagedSettingsStore()
    private(set) var shieldsApplied = false

    var permissionOk: Bool {
        AuthorizationCenter.shared.authorizationStatus == .approved
    }

    func requestAuthorization() async -> Bool {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            return true
        } catch {
            return false
        }
    }

    func applyShields() {
        guard permissionOk else { return }
        // Slice scope: shield all applications except the system-allowed set.
        // The S5 policy-setup picker (build pass 2c) narrows this to the student's
        // locally-chosen allowed apps, matching the policy labels.
        store.shield.applicationCategories = .all()
        shieldsApplied = true
    }

    func clearShields() {
        store.shield.applicationCategories = nil
        store.shield.applications = nil
        shieldsApplied = false
    }
}
#endif

enum ScreenTime {
    /// Real on a device with the entitlement; stub everywhere else.
    static func make() -> ScreenTimeService {
        #if targetEnvironment(simulator)
        return StubScreenTimeService()
        #elseif canImport(FamilyControls)
        return RealScreenTimeService()
        #else
        return StubScreenTimeService()
        #endif
    }
}
