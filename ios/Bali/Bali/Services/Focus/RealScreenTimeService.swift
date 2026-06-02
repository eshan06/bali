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
        let selection = FocusSelectionStore.load()
        let apps = selection.applicationTokens
        let categories = selection.categoryTokens
        guard !apps.isEmpty || !categories.isEmpty else { return false }   // nothing picked yet
        store.shield.applications = apps.isEmpty ? nil : apps
        store.shield.applicationCategories = categories.isEmpty ? nil : .specific(categories)
        return true
    }

    func clearShields() async {
        store.shield.applications = nil
        store.shield.applicationCategories = nil
    }
}
#endif
