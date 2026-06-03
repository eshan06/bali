//
//  BlockedAppsView.swift
//  Bali — Focus
//
//  One-time per-bucket app setup for Focus Mode. iOS shields opaque FamilyControls
//  tokens (never bundle ids — PLAN.md §9.3), and the app can't introspect a single
//  selection to find "the social ones", so the student labels apps PER BUCKET
//  (social, games) once. At session start RealScreenTimeService maps the teacher's
//  preset to the matching bucket(s): No Social Media -> social, No Games -> games,
//  Full Focus -> everything (no bucket needed). Each bucket persists via
//  FocusSelectionStore under its own key.
//
//  `isLive` is the ScreenTimeService's `isAvailable` — true only on a device with
//  the Family Controls entitlement; the Simulator shows an honest "device only"
//  placeholder (the picker can't return real tokens there).
//

import SwiftUI
#if canImport(FamilyControls)
import FamilyControls
#endif

struct BlockedAppsView: View {
    let isLive: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                #if canImport(FamilyControls)
                if isLive {
                    setup
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

    #if canImport(FamilyControls)
    private var setup: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BaliSpacing.m) {
                guidance
                VStack(spacing: BaliSpacing.s10) {
                    ForEach(FocusBucket.allCases) { bucket in
                        BucketRow(bucket: bucket)
                    }
                }
            }
            .padding(.horizontal, BaliSpacing.l)
            .padding(.vertical, BaliSpacing.m)
        }
        .background(BaliColor.bg)
    }

    private var guidance: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.s) {
            BaliText("Confirm two categories — once", .bodyStrong)
            BaliText("iOS won't reveal to an app which apps are social or games (it's a privacy rule), so tap each category below once. iOS then covers every app in it — including ones you install later. We never see your apps.", .foot)
                .foregroundStyle(BaliColor.ink3)
            BaliText("Full Focus blocks everything automatically — no setup needed.", .foot)
                .foregroundStyle(BaliColor.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(BaliSpacing.m)
        .background(BaliColor.blueTint)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))
    }
    #endif

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

#if canImport(FamilyControls)
/// One bucket's row + its FamilyActivityPicker sheet. The student picks the apps
/// that belong to this category; the selection persists per bucket.
private struct BucketRow: View {
    let bucket: FocusBucket
    @State private var selection: FamilyActivitySelection
    @State private var showPicker = false

    init(bucket: FocusBucket) {
        self.bucket = bucket
        _selection = State(initialValue: FocusSelectionStore.load(bucket))
    }

    private var count: Int {
        selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }

    var body: some View {
        Button { showPicker = true } label: {
            HStack(spacing: BaliSpacing.m14) {
                IconTile(systemImage: bucket.icon, tone: .coral, size: 38, glyphSize: 16)
                VStack(alignment: .leading, spacing: 2) {
                    BaliText(bucket.title, .bodyStrong)
                    BaliText(bucket.servesPolicy, .foot).foregroundStyle(BaliColor.ink3)
                }
                Spacer(minLength: BaliSpacing.s)
                BaliText(count > 0 ? "\(count)" : "None", .foot)
                    .foregroundStyle(count > 0 ? BaliColor.ink : BaliColor.ink4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BaliColor.ink4)
            }
            .padding(BaliSpacing.m)
            .frame(maxWidth: .infinity)
            .background(BaliColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous)
                    .stroke(BaliColor.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showPicker) {
            NavigationStack {
                VStack(spacing: 0) {
                    BaliText("Tap the “\(bucket.categoryHint)” category — it covers every app in it, now and later. You can also add specific apps.", .foot)
                        .foregroundStyle(BaliColor.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(BaliSpacing.m)
                        .background(BaliColor.blueTint)
                    FamilyActivityPicker(selection: $selection)
                        .onChange(of: selection) { _, newValue in
                            FocusSelectionStore.save(newValue, for: bucket)
                        }
                }
                .navigationTitle(bucket.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showPicker = false }
                    }
                }
            }
        }
    }
}
#endif
