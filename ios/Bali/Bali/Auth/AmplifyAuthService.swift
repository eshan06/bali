//
//  AmplifyAuthService.swift
//  Bali — auth (real Cognito)
//
//  The production AuthService backed by Amplify Swift + AWSCognitoAuthPlugin,
//  mirroring Android's AmplifyAuth (USER_SRP_AUTH; hosted-UI Google).
//
//  ── ONE-TIME XCODE SETUP (do this to activate real auth) ───────────────────
//  1. File ▸ Add Package Dependencies… → https://github.com/aws-amplify/amplify-swift
//     Add products: `Amplify` and `AWSCognitoAuthPlugin` to the Bali target.
//  2. Add `amplifyconfiguration.json` to the target (real Cognito values from
//     the root `.env`; keep it untracked — see Resources/amplifyconfiguration.example.json).
//  3. Register the iOS OAuth redirect URI (e.g. `balistudent://callback/`) on the
//     Cognito app client, and add the URL scheme to Info.plist.
//  Once the package resolves, `canImport(Amplify)` becomes true and this file
//  compiles in automatically; AppEnvironment then selects it over the stub.
//  Until then this file is intentionally empty to the compiler.
//

#if canImport(Amplify)
import Foundation
import Amplify
import AWSCognitoAuthPlugin
import AuthenticationServices

actor AmplifyAuthService: AuthService {
    /// Configures Amplify once at process start. Call from BaliApp init.
    static func configure() {
        do {
            try Amplify.add(plugin: AWSCognitoAuthPlugin())
            try Amplify.configure()
        } catch {
            assertionFailure("Amplify configuration failed: \(error)")
        }
    }

    func restoreSession() async -> Bool {
        (try? await Amplify.Auth.fetchAuthSession().isSignedIn) ?? false
    }

    func signIn(email: String, password: String) async throws {
        do {
            _ = try await Amplify.Auth.signIn(username: email, password: password)
        } catch {
            throw AuthError.badCredentials
        }
    }

    @MainActor
    func signInWithGoogle() async throws {
        let anchor = Self.presentationAnchor()
        do {
            _ = try await Amplify.Auth.signInWithWebUI(
                for: .google,
                presentationAnchor: anchor
            )
        } catch let e as AuthError {
            throw e
        } catch {
            throw AuthError.unknown(String(describing: error))
        }
    }

    func signOut() async {
        _ = await Amplify.Auth.signOut()
    }

    func currentJWT() async -> String? {
        guard let session = try? await Amplify.Auth.fetchAuthSession(),
              let cognito = session as? AuthCognitoTokensProvider,
              let tokens = try? cognito.getCognitoTokens().get() else {
            return nil
        }
        return tokens.idToken
    }

    @MainActor
    private static func presentationAnchor() -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}
#endif
