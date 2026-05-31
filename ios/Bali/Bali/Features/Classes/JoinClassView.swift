//
//  JoinClassView.swift
//  Bali — Join Class (stub, pushed)
//
//  Phase 2 stub. The real Code/Link/QR segmented flow + confirm step is built
//  in Phase 5.
//

import SwiftUI

struct JoinClassView: View {
    var body: some View {
        DetailScaffold {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Add a class")
                BaliText("Join class", .display)
            }
            StubPlaceholder(
                systemImage: "plus.circle.fill",
                title: "Join a class",
                note: "Code / Link / QR join with a confirm step arrives in Phase 5."
            )
        }
    }
}

#Preview {
    NavigationStack { JoinClassView() }
        .injectBaliEnvironment(AppEnvironment())
}
