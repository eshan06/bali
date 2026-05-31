//
//  FocusPolicyPreviewView.swift
//  Bali — Focus Policy Preview (stub, pushed)
//
//  Phase 2 stub. The real read-only policy view (paused / always-available app
//  grids) is built in Phase 4 from the session BlockingSnapshot.
//

import SwiftUI

struct FocusPolicyPreviewView: View {
    let classId: String

    var body: some View {
        DetailScaffold {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Focus policy")
                BaliText("Full Focus", .display)
            }
            StubPlaceholder(
                systemImage: "lock.fill",
                title: "Policy preview",
                note: "Paused-during-class and always-available app grids arrive in Phase 4."
            )
        }
    }
}

#Preview {
    NavigationStack { FocusPolicyPreviewView(classId: "sample") }
        .injectBaliEnvironment(AppEnvironment())
}
