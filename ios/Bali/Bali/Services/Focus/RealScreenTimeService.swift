//
//  RealScreenTimeService.swift
//  Bali — services/focus
//
//  Device Screen Time (excluded from the Simulator slice). Requests Family
//  Controls authorization and applies/clears ManagedSettings shields over a
//  FamilyActivitySelection the student grants once. The policy's bundle ids
//  RENDER the UI; opaque tokens enforce (PLAN.md §9.3). DeviceActivity scheduling
//  is a device follow-up.
//
//  Requires (device, user's account): the Family Controls capability +
//  `com.apple.developer.family-controls` entitlement (Apple approval — §9.12).
//  Not compile-verified here (Sim-excluded).
//

#if !targetEnvironment(simulator) && canImport(FamilyControls)
import FamilyControls
import ManagedSettings
import Foundation

nonisolated final class RealScreenTimeService: ScreenTimeService, @unchecked Sendable {
    private let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("bali.focus"))

    var isAvailable: Bool { true }
    var blockedSelectionCount: Int { FocusSelectionStore.count }

    func authorizationStatus() async -> FocusAuthorization {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved: return .approved
        case .denied:   return .denied
        default:        return .notDetermined
        }
    }

    func requestAuthorization() async -> FocusAuthorization {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            return .approved
        } catch {
            return .denied
        }
    }

    func applyShields(for snapshot: BlockingSnapshot) async -> Bool {
        // Full Focus / allow-list: shield ALL app categories straight from the
        // policy — no picker selection needed. iOS never shields system essentials
        // (Phone, Messages, Settings), so "everything but essentials" falls out.
        if snapshot.preset == .fullFocus || snapshot.isAllowList {
            store.shield.applicationCategories = .all()
            store.shield.applications = nil
            store.shield.webDomains = nil
            return true
        }
        // Specific policies (No Social Media, No Games, Custom): iOS can only shield
        // opaque tokens the student picked, so enforce the student's selection —
        // guided to the policy's category in BlockedAppsView (presets → categories).
        let selection = FocusSelectionStore.load()
        let apps = selection.applicationTokens
        let categories = selection.categoryTokens
        let domains = selection.webDomainTokens
        // nothing picked yet
        guard !apps.isEmpty || !categories.isEmpty || !domains.isEmpty else { return false }
        store.shield.applications = apps.isEmpty ? nil : apps
        store.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
        store.shield.webDomains = domains.isEmpty ? nil : domains
        return true
    }

    func clearShields() async {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
        store.shield.webDomains = nil
    }
}
#endif
