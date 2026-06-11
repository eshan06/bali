//
//  AuthStore.swift
//  Bali — auth
//
//  Owns the app's top-level phase and drives sign-in. On launch it restores any
//  existing session and runs the student-role gate; sign-in does the same after
//  authenticating. Credential mechanics live behind AuthService; the student
//  check lives behind RoleGate — so this logic is identical for stub and real
//  Cognito.
//

import SwiftUI

/// Top-level navigation phase. RootView switches on this.
enum AppPhase: Equatable {
    case loading        // checking for an existing session
    case unauthenticated
    case onboarding     // signed-in student without a completed profile/device
    case app            // in the tabbed app
}

@MainActor
@Observable
final class AuthStore {
    private(set) var phase: AppPhase = .loading
    private(set) var isWorking = false
    var errorMessage: String?

    private let auth: AuthService
    private let gate: RoleGate

    init(auth: AuthService, gate: RoleGate) {
        self.auth = auth
        self.gate = gate
    }

    /// Called once on launch to resolve the starting phase.
    func bootstrap() async {
        phase = .loading
        if await auth.restoreSession() {
            await runGate()
        } else {
            phase = .unauthenticated
        }
    }

    func signIn(email: String, password: String) async {
        await perform { try await self.auth.signIn(email: email, password: password) }
    }

    func signInWithGoogle() async {
        await perform { try await self.auth.signInWithGoogle() }
    }

    func signOut() async {
        await auth.signOut()
        errorMessage = nil
        phase = .unauthenticated
    }

    func currentJWT() async -> String? {
        await auth.currentJWT()
    }

    /// Advance from onboarding (device + permissions) into the tabbed app.
    func finishOnboarding() { phase = .app }

    // MARK: - Private

    /// Run a credential action, then the role gate, with shared loading/error.
    private func perform(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await action()
            await runGate()
        } catch let error as AuthError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = AuthError.unknown(String(describing: error)).userMessage
        }
    }

    private func runGate() async {
        switch await gate.resolve() {
        case .student(let hasProfile):
            phase = hasProfile ? .app : .onboarding
        case .notAStudent:
            await auth.signOut()
            errorMessage = "Bali is for students. Teachers manage classes on the web dashboard."
            phase = .unauthenticated
        case .failed(let message):
            await auth.signOut()
            errorMessage = message
            phase = .unauthenticated
        }
    }
}
