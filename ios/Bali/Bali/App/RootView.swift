//
//  RootView.swift
//  Bali
//
//  The top-level phase gate. Builds the app environment once, bootstraps the
//  auth session on launch, and switches the whole UI on AuthStore.phase:
//  loading → unauthenticated (Login) → onboarding → app (tabs).
//
//  Phase 5 replaces the onboarding placeholder with the real flow.
//

import SwiftUI

struct RootView: View {
    @State private var env = AppEnvironment()

    var body: some View {
        content
            .injectBaliEnvironment(env)
            .task { await env.auth.bootstrap() }
    }

    @ViewBuilder
    private var content: some View {
        switch env.auth.phase {
        case .loading:
            LaunchView()
        case .unauthenticated:
            LoginView()
        case .onboarding:
            OnboardingFlow()
        case .app:
            MainTabView()
        }
    }
}

/// Branded launch / placeholder surface for the loading & onboarding phases.
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

#Preview("Login") {
    RootView()
}
