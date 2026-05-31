//
//  RootView.swift
//  Bali
//
//  The top-level phase gate. Builds the app environment once and switches the
//  whole UI on AuthStore.phase: loading → unauthenticated → onboarding → app.
//
//  Phase 2: AuthStore stubs straight to `.app`, so this lands in the tabbed
//  shell. Phase 3 wires real Cognito (login screen for `.unauthenticated`) and
//  Phase 5 wires the onboarding flow.
//

import SwiftUI

struct RootView: View {
    @State private var env = AppEnvironment()

    var body: some View {
        content
            .injectBaliEnvironment(env)
    }

    @ViewBuilder
    private var content: some View {
        switch env.auth.phase {
        case .loading:
            LaunchView()
        case .unauthenticated:
            // Phase 3 replaces this with LoginView.
            LaunchView(message: "Sign in arrives in Phase 3")
        case .onboarding:
            // Phase 5 replaces this with the onboarding flow.
            LaunchView(message: "Onboarding arrives in Phase 5")
        case .app:
            MainTabView()
        }
    }
}

/// Branded launch / placeholder surface for non-app phases.
struct LaunchView: View {
    var message: String? = nil

    var body: some View {
        ZStack {
            BaliColor.bg.ignoresSafeArea()
            VStack(spacing: BaliSpacing.s10) {
                Wordmark(size: 40, color: BaliColor.blue)
                BaliText(message ?? "Focus, made effortless.", .body)
            }
        }
    }
}

#Preview {
    RootView()
}
