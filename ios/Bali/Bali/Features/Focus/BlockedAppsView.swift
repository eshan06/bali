//
//  BlockedAppsView.swift
//  Bali — Focus
//
//  The one-time app-selection step for Focus Mode. iOS shields apps through
//  opaque FamilyControls tokens (never bundle ids — PLAN.md §9.3), so the
//  student picks the apps/categories to block once via the system
//  FamilyActivityPicker; the selection is persisted by FocusSelectionStore and
//  enforced by RealScreenTimeService while a class session is live.
//
//  `isLive` is the ScreenTimeService's `isAvailable` — true only on a device
//  with the Family Controls entitlement. The Simulator path shows an honest
//  "device only" placeholder (the picker can't return real tokens there).
//

import SwiftUI
#if canImport(FamilyControls)
import FamilyControls
#endif

struct BlockedAppsView: View {
    let isLive: Bool
    @Environment(\.dismiss) private var dismiss

    #if canImport(FamilyControls)
    @State private var selection = FocusSelectionStore.load()
    #endif

    var body: some View {
        NavigationStack {
            Group {
                #if canImport(FamilyControls)
                if isLive {
                    FamilyActivityPicker(selection: $selection)
                        .onChange(of: selection) { _, newValue in
                            FocusSelectionStore.save(newValue)
                        }
                } else {
                    unavailable
                }
                #else
                unavailable
                #endif
            }
            .navigationTitle("Apps to Block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var unavailable: some View {
        VStack {
            StubPlaceholder(
                systemImage: "iphone.gen3.slash",
                title: "Available on device",
                note: "Choosing which apps to block uses Apple Screen Time, which only runs on a physical iPhone with Focus permissions granted.")
            Spacer()
        }
        .padding(.horizontal, BaliSpacing.l)
        .padding(.top, BaliSpacing.contentTop)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BaliColor.bg)
    }
}
