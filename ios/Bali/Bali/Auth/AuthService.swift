//
//  AuthService.swift
//  Bali — auth
//
//  The credential boundary: sign in/out, restore an existing session, and vend
//  the current JWT. Cognito specifics live behind this protocol so the app is
//  built and verified against a stub on the Simulator, then swapped to the real
//  AmplifyAuthService once the Amplify SPM package is added (see
//  AmplifyAuthService.swift) — with zero changes above this seam.
//

import Foundation

protocol AuthService: Sendable {
    /// True if a valid session was restored on launch.
    func restoreSession() async -> Bool
    func signIn(email: String, password: String) async throws
    func signInWithGoogle() async throws
    func signOut() async
    /// Current Cognito ID token (JWT), or nil when signed out.
    func currentJWT() async -> String?
}

/// Raised by AuthService implementations for credential failures.
enum AuthError: Error {
    case badCredentials
    case cancelled
    case unknown(String)

    var userMessage: String {
        switch self {
        case .badCredentials:
            return "We couldn't sign you in. Check your email and password."
        case .cancelled:
            return "Sign-in was cancelled."
        case .unknown:
            return "We couldn't sign you in. Please try again."
        }
    }
}

/// In-memory stub for Simulator development before Amplify is wired. Accepts any
/// non-empty credentials and vends a placeholder token so the full sign-in →
/// role-gate → app flow is exercisable without a backend or AWS.
actor StubAuthService: AuthService {
    private var signedIn = false

    func restoreSession() async -> Bool {
        // Start signed out so the Login screen is always reachable in dev.
        signedIn
    }

    func signIn(email: String, password: String) async throws {
        guard !email.trimmingCharacters(in: .whitespaces).isEmpty, !password.isEmpty else {
            throw AuthError.badCredentials
        }
        try? await Task.sleep(for: .milliseconds(600)) // mimic network latency
        signedIn = true
    }

    func signInWithGoogle() async throws {
        try? await Task.sleep(for: .milliseconds(600))
        signedIn = true
    }

    func signOut() async {
        signedIn = false
    }

    func currentJWT() async -> String? {
        signedIn ? "stub.jwt.token" : nil
    }
}
