//
//  FocusPolicyPreviewView.swift
//  Bali — Focus Policy Preview (pushed)
//
//  Read-only view of a class's frozen BlockingSnapshot. For an allow-list policy
//  (Full Focus / block_all_except) we show the always-available essentials and
//  note everything else is paused; for a block-specific policy we show the
//  paused apps as locked tiles. Renders REAL app/category data via AppCatalog —
//  never the prototype's placeholder brand names.
//

import SwiftUI

struct FocusPolicyPreviewView: View {
    let classId: String
    @Environment(AppModel.self) private var model

    private var policy: BlockingSnapshot? {
        model.presentation(for: classId).policy
            ?? model.detail(for: classId)?.activeSession?.blockingSnapshot
    }

    private var className: String {
        model.classes.first { $0.id == classId }?.name
            ?? model.detail(for: classId)?.classInfo.name ?? "Class"
    }

    var body: some View {
        DetailScaffold {
            if let policy {
                header(policy)
                if policy.isAllowList {
                    appsCard(title: "Always available", entries: policy.allowedApps, locked: false)
                    noteCard("Everything else on your phone is paused during class.")
                } else if policy.blockedApps.isEmpty {
                    noteCard("No apps are blocked for this class.")
                } else {
                    appsCard(title: "Paused during class", entries: policy.blockedApps, locked: true)
                    noteCard("Everything else stays available during class.")
                }
            } else {
                StubPlaceholder(systemImage: "lock.open.fill", title: "No focus policy",
                                note: "This class has no blocking policy right now.")
            }
        }
        .task { await model.loadDetail(classId: classId) }
    }

    private func header(_ policy: BlockingSnapshot) -> some View {
        VStack(alignment: .leading, spacing: BaliSpacing.s10) {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("\(className) · Focus Policy")
                BaliText(policy.preset.title, .h1)
            }
            BaliText("\(policy.preset.summary) Your teacher controls this — you can't change it during class.", .body)
        }
    }

    private func appsCard(title: String, entries: [BlockingAppEntry], locked: Bool) -> some View {
        VStack(alignment: .leading, spacing: BaliSpacing.m) {
            HStack(spacing: 6) {
                BaliText(title, .h3)
                BaliText("· \(entries.count)", .h3, color: BaliColor.ink4)
            }
            Card {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: BaliSpacing.m), count: 4),
                    spacing: BaliSpacing.l
                ) {
                    ForEach(entries) { entry in
                        AppTile(visual: AppCatalog.visual(for: entry), locked: locked)
                    }
                }
            }
        }
    }

    private func noteCard(_ text: String) -> some View {
        HStack(spacing: BaliSpacing.s10) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(BaliColor.ink4)
            BaliText(text, .foot)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliColor.line2)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))
    }
}

#Preview {
    NavigationStack { FocusPolicyPreviewView(classId: "cls-bio") }
        .injectBaliEnvironment(.preview())
}
