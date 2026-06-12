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
    /// Whether S5 policy setup has been completed for this label set.
    func hasSelection(forLabels labels: [String]) -> Bool
    /// Shield everything except the student's locally-chosen apps for these labels.
    func applyShields(allowedLabels: [String])
    func clearShields()
}

final class StubScreenTimeService: ScreenTimeService {
    private(set) var shieldsApplied = false
    var permissionOk: Bool { true }
    func requestAuthorization() async -> Bool { true }
    func hasSelection(forLabels _: [String]) -> Bool { true } // no picker in the Simulator
    func applyShields(allowedLabels _: [String]) { shieldsApplied = false } // honest: nothing is shielded
    func clearShields() { shieldsApplied = false }
}

#if canImport(FamilyControls)
/// Per-policy "buckets": the student's FamilyActivitySelection stored locally, keyed
/// by the policy's label set. Labels stay semantic server-side; the actual apps exist
/// ONLY on this phone — Bali never sees anyone's app list.
enum PolicyBuckets {
    private static func key(for labels: [String]) -> String {
        "bali.bucket." + labels.map { $0.lowercased() }.sorted().joined(separator: "|")
    }

    static func load(for labels: [String]) -> FamilyActivitySelection? {
        guard let data = UserDefaults.standard.data(forKey: key(for: labels)) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    static func save(_ selection: FamilyActivitySelection, for labels: [String]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(selection), forKey: key(for: labels))
    }

    static func exists(for labels: [String]) -> Bool {
        UserDefaults.standard.data(forKey: key(for: labels)) != nil
    }

    /// How many things the student picked (apps + categories + sites).
    static func count(of selection: FamilyActivitySelection) -> Int {
        selection.applications.count + selection.categories.count + selection.webDomains.count
    }
}

/// Device implementation. Shields all app categories EXCEPT the student's stored
/// selection for the session's policy labels (S5 setup). Phone can't be shielded by
/// iOS at all — honesty the policy editor states outright.
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

    func hasSelection(forLabels labels: [String]) -> Bool {
        // A policy with no extra labels needs no picker trip.
        labels.isEmpty || PolicyBuckets.exists(for: labels)
    }

    func applyShields(allowedLabels labels: [String]) {
        guard permissionOk else { return }
        if let selection = PolicyBuckets.load(for: labels), PolicyBuckets.count(of: selection) > 0 {
            store.shield.applicationCategories = .all(except: selection.applicationTokens)
            store.shield.webDomainCategories = .all(except: selection.webDomainTokens)
        } else {
            // No bucket (status-only setup skipped, or zero-label policy): shield everything.
            store.shield.applicationCategories = .all()
            store.shield.webDomainCategories = .all()
        }
        shieldsApplied = true
    }

    func clearShields() {
        store.shield.applicationCategories = nil
        store.shield.applications = nil
        store.shield.webDomainCategories = nil
        store.shield.webDomains = nil
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
