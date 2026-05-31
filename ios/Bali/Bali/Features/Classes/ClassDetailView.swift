//
//  ClassDetailView.swift
//  Bali — Class Detail (stub, pushed)
//
//  Phase 2 stub. The real header card, session block, stats, device/policy
//  card, and recent sessions are built in Phase 4. The info button pushes the
//  Focus Policy Preview so navigation is real.
//

import SwiftUI

struct ClassDetailView: View {
    let classId: String
    @Environment(AppRouter.self) private var router

    var body: some View {
        DetailScaffold(trailingIcon: "info.circle") {
            router.push(.focusPolicyPreview(classId: classId))
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Period 1")
                BaliText("Class Detail", .h1)
            }
            StubPlaceholder(
                systemImage: "graduationcap.fill",
                title: "Class \(classId)",
                note: "Session block, attendance, assigned device, and recent sessions arrive in Phase 4."
            )
        }
    }
}

#Preview {
    NavigationStack { ClassDetailView(classId: "sample") }
        .injectBaliEnvironment(AppEnvironment())
}
