//
//  AuthStore.swift
//  Bali
//
//  Owns the app's top-level phase: are we still checking the session, signed
//  out, mid-onboarding, or in the app? Phase 2 ships a stub that lands directly
//  in the app so the shell is reachable; Phase 3 wires real Cognito sign-in and
//  the student-role gate, and Phase 5 wires onboarding completion.
//

import SwiftUI

/// Top-level navigation phase. The gate in RootView switches on this.
enum AppPhase: Equatable {
    case loading        // checking for an existing session
    case unauthenticated
    case onboarding     // signed in, device/permissions not yet set up
    case app            // in the tabbed app
}

@MainActor
@Observable
final class AuthStore {
    private(set) var phase: AppPhase

    /// Phase 2 default: jump straight into the app shell so it's runnable.
    /// Phase 3 changes the initial phase to `.loading` and resolves a real
    /// Cognito session (→ `.unauthenticated` / `.onboarding` / `.app`).
    init(phase: AppPhase = .app) {
        self.phase = phase
    }

    // MARK: Stubbed transitions (replaced with real Cognito in Phase 3)

    func signInStub() { phase = .onboarding }
    func finishOnboardingStub() { phase = .app }
    func signOutStub() { phase = .unauthenticated }
}
