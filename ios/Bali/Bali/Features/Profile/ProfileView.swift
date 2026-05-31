//
//  ProfileView.swift
//  Bali — Profile tab (stub)
//
//  Phase 2 stub: the editable profile form is built in Phase 4. The gear pushes
//  Settings so the tab's navigation is real.
//

import SwiftUI

struct ProfileView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        BaliScreen {
            ScreenHeader(eyebrow: "Account", title: "Profile") {
                IconButton(systemImage: "gearshape") {
                    router.push(.settings)
                }
            }

            StubPlaceholder(
                systemImage: "person.fill",
                title: "Profile",
                note: "Avatar, name, grade, and editable details arrive in Phase 4. Tap the gear for Settings."
            )
        }
    }
}

#Preview {
    NavigationStack { ProfileView() }
        .injectBaliEnvironment(AppEnvironment())
}
