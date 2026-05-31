//
//  HomeView.swift
//  Bali — Home tab (stub)
//
//  Phase 2 stub: the real daily hub (hero states, stat row, class list, pending
//  invites) is built in Phase 4. This renders the header chrome + a placeholder
//  so the tab and its navigation (bell → Notifications) are real.
//

import SwiftUI

struct HomeView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        BaliScreen {
            // "Good morning," (sentence-case body) above the display greeting,
            // with the bell on the right.
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    BaliText("Good morning,", .body)
                    BaliText("Maya.", .display)
                }
                Spacer(minLength: BaliSpacing.m)
                IconButton(systemImage: "bell", showsBadge: true) {
                    router.push(.notifications)
                }
            }

            StubPlaceholder(
                systemImage: "house.fill",
                title: "Home",
                note: "Live class hero, attendance, streak, and your classes arrive in Phase 4."
            )
        }
    }
}

#Preview {
    NavigationStack { HomeView() }
        .injectBaliEnvironment(AppEnvironment())
}
