//
//  FocusSelectionStore.swift
//  Bali — services/focus
//
//  Persists the student's one-time FamilyActivityPicker selection (the opaque
//  ApplicationToken / ActivityCategoryToken set that `RealScreenTimeService`
//  shields). FamilyControls compiles on both device and Simulator, but the
//  selection only ever has real tokens on a device with Screen Time authorized;
//  `BlockedAppsView` writes it, `RealScreenTimeService` reads it (PLAN.md §9.3).
//

#if canImport(FamilyControls)
import FamilyControls
import Foundation

enum FocusSelectionStore {
    private static let key = "bali.focus.selection"

    static func load() -> FamilyActivitySelection {
        guard let data = UserDefaults.standard.data(forKey: key),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else { return FamilyActivitySelection() }
        return selection
    }

    static func save(_ selection: FamilyActivitySelection) {
        if let data = try? JSONEncoder().encode(selection) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    /// Apps + categories + web domains the student has picked to shield.
    static var count: Int {
        let selection = load()
        return selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }
}
#endif
