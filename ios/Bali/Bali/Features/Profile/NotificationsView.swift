//
//  NotificationsView.swift
//  Bali — Notifications (stub, pushed)
//
//  Phase 2 stub. The real notifications list (4 event types, unread rings,
//  "Mark read") is built in Phase 8.
//

import SwiftUI

struct NotificationsView: View {
    var body: some View {
        DetailScaffold {
            BaliText("Notifications", .display)
            StubPlaceholder(
                systemImage: "bell.fill",
                title: "Notifications",
                note: "Class started, checked in, blocking failed, and session ended alerts arrive in Phase 8."
            )
        }
    }
}

#Preview {
    NavigationStack { NotificationsView() }
        .injectBaliEnvironment(AppEnvironment())
}
