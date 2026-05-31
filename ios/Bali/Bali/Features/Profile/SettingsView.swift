//
//  SettingsView.swift
//  Bali — Settings (stub, pushed)
//
//  Phase 2 stub with real navigation: the Registered device row pushes Device
//  Info. Full grouped settings are built in Phase 4.
//

import SwiftUI

struct SettingsView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        DetailScaffold {
            BaliText("Settings", .display)

            Button {
                router.push(.deviceInfo)
            } label: {
                StubPlaceholder(
                    systemImage: "gearshape.fill",
                    title: "Settings",
                    note: "Account, device & focus, notifications, and about arrive in Phase 4. Tap to preview Device Info."
                )
            }
            .buttonStyle(.plain)
        }
    }
}

#Preview {
    NavigationStack { SettingsView() }
        .injectBaliEnvironment(AppEnvironment())
}
