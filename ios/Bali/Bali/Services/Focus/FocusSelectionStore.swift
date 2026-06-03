//
//  FocusSelectionStore.swift
//  Bali — services/focus
//
//  Persists the student's per-bucket FamilyActivityPicker selections (the opaque
//  ApplicationToken / ActivityCategoryToken sets `RealScreenTimeService` shields).
//  One keyed `FamilyActivitySelection` per `FocusBucket` (social, games). The
//  teacher's preset chooses which bucket(s) to enforce; the student labels the
//  apps at pick-time because iOS won't reveal token identities (PLAN.md §9.3).
//  FamilyControls compiles on both device and Simulator, but the selection only
//  ever holds real tokens on a device with Screen Time authorized.
//

#if canImport(FamilyControls)
import FamilyControls
import Foundation

enum FocusSelectionStore {
    static func load(_ bucket: FocusBucket) -> FamilyActivitySelection {
        guard let data = UserDefaults.standard.data(forKey: bucket.storageKey),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else { return FamilyActivitySelection() }
        return selection
    }

    static func save(_ selection: FamilyActivitySelection, for bucket: FocusBucket) {
        if let data = try? JSONEncoder().encode(selection) {
            UserDefaults.standard.set(data, forKey: bucket.storageKey)
        }
    }

    /// Apps + categories + web domains the student has picked for one bucket.
    static func count(_ bucket: FocusBucket) -> Int {
        let s = load(bucket)
        return s.applicationTokens.count + s.categoryTokens.count + s.webDomainTokens.count
    }

    /// Total picked across every bucket — drives the Settings "Apps to block" badge.
    static var totalCount: Int {
        FocusBucket.allCases.reduce(0) { $0 + count($1) }
    }
}
#endif
