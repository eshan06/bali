//
//  AmplifyAuth.swift — real Cognito SRP via Amplify Swift (same pool/flows legacy proved).
//  Compiles in once the amplify-swift package resolves (`canImport(Amplify)`); the
//  AuthStore falls back to the DEBUG dev-token path when the wrapper reports unavailable.
//

import Foundation

#if canImport(Amplify) && canImport(AWSCognitoAuthPlugin)
import Amplify
import AuthenticationServices
import AWSCognitoAuthPlugin
import AWSPluginsCore
import UIKit

enum AmplifyAuth {
    static let isAvailable = true

    /// Call once at process start, before any other Amplify use.
    static func configure() {
        do {
            try Amplify.add(plugin: AWSCognitoAuthPlugin())
            try Amplify.configure()
        } catch {
            // Missing/placeholder amplifyconfiguration.json — sign-in will surface it.
            print("Amplify configuration failed: \(error)")
        }
    }

    static func isSignedIn() async -> Bool {
        (try? await Amplify.Auth.fetchAuthSession().isSignedIn) ?? false
    }

    /// The Cognito ID token the API verifies. Amplify refreshes it as needed.
    static func idToken() async -> String? {
        guard let session = try? await Amplify.Auth.fetchAuthSession(),
              let provider = session as? AuthCognitoTokensProvider,
              let tokens = try? provider.getCognitoTokens().get()
        else { return nil }
        return tokens.idToken
    }

    /// SRP sign-in. Returns true when fully signed in, false when Cognito wants
    /// email confirmation first (the store then routes to the code screen).
    static func signIn(email: String, password: String) async throws -> Bool {
        let result = try await Amplify.Auth.signIn(username: email, password: password)
        if case .confirmSignUp = result.nextStep { return false }
        return result.isSignedIn
    }

    /// Google via Cognito Hosted UI (ASWebAuthenticationSession). Reuses the
    /// `balistudent://callback/` redirect already registered on the app client —
    /// zero Cognito changes; federated users carry the same pool JWTs.
    @MainActor
    static func signInWithGoogle() async throws -> Bool {
        let result = try await Amplify.Auth.signInWithWebUI(for: .google, presentationAnchor: keyAnchor())
        return result.isSignedIn
    }

    @MainActor
    private static func keyAnchor() -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    /// Returns true when the account is immediately usable; false when a
    /// confirmation code was emailed.
    static func signUp(email: String, password: String, fullName: String) async throws -> Bool {
        let options = AuthSignUpRequest.Options(userAttributes: [
            AuthUserAttribute(.email, value: email),
            AuthUserAttribute(.name, value: fullName),
        ])
        let result = try await Amplify.Auth.signUp(username: email, password: password, options: options)
        if case .confirmUser = result.nextStep { return false }
        return result.isSignUpComplete
    }

    static func confirmSignUp(email: String, code: String) async throws {
        _ = try await Amplify.Auth.confirmSignUp(for: email, confirmationCode: code)
    }

    static func resendCode(email: String) async throws {
        _ = try await Amplify.Auth.resendSignUpCode(for: email)
    }

    static func signOut() async {
        _ = await Amplify.Auth.signOut()
    }

    /// Human copy for auth failures — calm, specific, never blames.
    static func describe(_ error: Error) -> String {
        if let authError = error as? AuthError {
            switch authError {
            case .notAuthorized:
                return "That email and password don't match."
            case .validation:
                return "Check the email format and an 8+ character password."
            case .service(let message, _, _):
                if message.lowercased().contains("exists") { return "That email already has an account — sign in instead." }
                if message.lowercased().contains("code") { return "That code didn't match — check the email and try again." }
                return message
            default:
                return authError.errorDescription
            }
        }
        return "Something went wrong — try again."
    }
}

#else

/// Package not resolved (or building in a context without it): the store keeps the
/// DEBUG dev path working and explains the production path is inactive.
enum AmplifyAuth {
    static let isAvailable = false
    static func configure() {}
    static func isSignedIn() async -> Bool { false }
    static func idToken() async -> String? { nil }
    static func signIn(email _: String, password _: String) async throws -> Bool { throw unavailable }
    static func signInWithGoogle() async throws -> Bool { throw unavailable }
    static func signUp(email _: String, password _: String, fullName _: String) async throws -> Bool { throw unavailable }
    static func confirmSignUp(email _: String, code _: String) async throws { throw unavailable }
    static func resendCode(email _: String) async throws { throw unavailable }
    static func signOut() async {}
    static func describe(_ error: Error) -> String { (error as NSError).localizedDescription }
    private static var unavailable: Error {
        NSError(domain: "Bali", code: 1, userInfo: [NSLocalizedDescriptionKey: "Real sign-in isn't set up in this build."])
    }
}

#endif
