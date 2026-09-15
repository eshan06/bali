import Foundation
import SwiftUI

/// Student auth. Production path is Cognito SRP via Amplify Swift (same pool/flows
/// the legacy app proved; config stays untracked). DEBUG builds can also use the
/// API's dev-token mode so the Simulator slice runs without real credentials.
@MainActor
final class AuthStore: ObservableObject {
    enum Phase {
        case loading
        case signedOut
        /// Signed in to Cognito but no student row yet — collect first/last name.
        case needsName
        /// Cognito emailed a confirmation code at sign-up.
        case needsConfirmation(email: String, password: String)
        case ready(StudentSelf)
    }

    @Published var phase: Phase = .loading
    @Published var authError: String?

    private let tokenKey = "bali.devToken"
    private(set) lazy var api = APIClient { [weak self] in await self?.currentToken() }

    private nonisolated func devToken() -> String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    /// Dev token wins in DEBUG (Simulator slice); otherwise the live Cognito ID token.
    nonisolated func currentToken() async -> String? {
        #if DEBUG
        if let dev = devToken() { return dev }
        #endif
        return await AmplifyAuth.idToken()
    }

    func start() async {
        #if DEBUG
        if devToken() != nil {
            await loadProfile()
            return
        }
        #endif
        if AmplifyAuth.isAvailable, await AmplifyAuth.isSignedIn() {
            await loadProfile()
        } else {
            phase = .signedOut
        }
    }

    // ---------- real Cognito (S0) ----------

    func signIn(email: String, password: String) async {
        authError = nil
        do {
            let complete = try await AmplifyAuth.signIn(email: email, password: password)
            if complete {
                await loadProfile(for: email)
            } else {
                try await AmplifyAuth.resendCode(email: email)
                phase = .needsConfirmation(email: email, password: password)
            }
        } catch {
            authError = AmplifyAuth.describe(error)
        }
    }

    func signUp(email: String, password: String, firstName: String, lastName: String) async {
        authError = nil
        // Names travel with bootstrap (DB-authoritative), not just the Cognito attribute.
        stashName(first: firstName, last: lastName, for: email)
        do {
            let complete = try await AmplifyAuth.signUp(
                email: email, password: password, fullName: "\(firstName) \(lastName)"
            )
            if complete {
                _ = try? await AmplifyAuth.signIn(email: email, password: password)
                await loadProfile(for: email)
            } else {
                phase = .needsConfirmation(email: email, password: password)
            }
        } catch {
            // Sign-up never happened — the name has no account left to belong to.
            clearStashedName()
            authError = AmplifyAuth.describe(error)
        }
    }

    func confirmSignUp(email: String, password: String, code: String) async {
        authError = nil
        do {
            try await AmplifyAuth.confirmSignUp(email: email, code: code)
            _ = try await AmplifyAuth.signIn(email: email, password: password)
            await loadProfile(for: email)
        } catch {
            authError = AmplifyAuth.describe(error)
        }
    }

    /// `needsName` exit: provision the student row (adopts a seeded roster student
    /// when the name matches — WIRING_PLAN seed-adoption rule).
    func submitName(firstName: String, lastName: String) async {
        authError = nil
        // No stash here: the names go straight to bootstrap under the account already
        // signed in, so a stash left behind could only ever land on the next one.
        do {
            _ = try await api.post(
                "auth/bootstrap",
                body: BootstrapBody(role: "student", firstName: firstName, lastName: lastName),
                as: BootstrapResult.self
            )
            await loadProfile()
        } catch {
            authError = (error as? APIError)?.message ?? "Couldn't finish setting up — try again."
        }
    }

    // ---------- DEBUG dev sign-in ----------

    /// Identity is `dev:<sub>` + the chosen name; the API adopts the seed student
    /// with that name (e.g. "Jordan Park" becomes the persona).
    func devSignIn(firstName: String, lastName: String) async {
        #if DEBUG
        authError = nil
        let slug = "\(firstName)-\(lastName)".lowercased()
            .replacingOccurrences(of: " ", with: "-")
        UserDefaults.standard.set("dev:s-\(slug)::\(firstName) \(lastName)", forKey: tokenKey)
        do {
            _ = try await api.post(
                "auth/bootstrap",
                body: BootstrapBody(role: "student", firstName: firstName, lastName: lastName),
                as: BootstrapResult.self
            )
            await loadProfile()
        } catch {
            UserDefaults.standard.removeObject(forKey: tokenKey)
            let host = APIConfig.baseURL.host ?? "?"
            authError = (error as? APIError)?.message
                ?? "Couldn't reach the dev API at \(host):3001 — \(error.localizedDescription)"
            phase = .signedOut
        }
        #endif
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        // A pending name must never follow the next account signed in on a shared device.
        clearStashedName()
        Task { await AmplifyAuth.signOut() }
        phase = .signedOut
    }

    // ---------- profile ----------

    private let firstNameKey = "bali.pendingFirstName"
    private let lastNameKey = "bali.pendingLastName"
    /// The account the pending name was typed for — a stash tagged for anyone else is ignored.
    private let nameOwnerKey = "bali.pendingNameOwner"

    private func stashName(first: String, last: String, for owner: String) {
        UserDefaults.standard.set(first, forKey: firstNameKey)
        UserDefaults.standard.set(last, forKey: lastNameKey)
        UserDefaults.standard.set(owner.lowercased(), forKey: nameOwnerKey)
    }

    private func clearStashedName() {
        UserDefaults.standard.removeObject(forKey: firstNameKey)
        UserDefaults.standard.removeObject(forKey: lastNameKey)
        UserDefaults.standard.removeObject(forKey: nameOwnerKey)
    }

    /// The pending name, only for the account it was typed for: bootstrap adopts an
    /// unclaimed roster row by name, so a stranger's stash would hand them this account.
    private func stashedName(for owner: String?) -> (first: String, last: String)? {
        guard let owner,
              UserDefaults.standard.string(forKey: nameOwnerKey) == owner.lowercased(),
              let first = UserDefaults.standard.string(forKey: firstNameKey),
              let last = UserDefaults.standard.string(forKey: lastNameKey),
              !first.isEmpty, !last.isEmpty
        else { return nil }
        return (first, last)
    }

    /// `owner` is the account being signed in; without one (relaunch, dev sign-in) any
    /// stashed name is skipped and the student is asked for it again.
    private func loadProfile(for owner: String? = nil) async {
        struct Me: Decodable {
            var role: String?
            var student: StudentSelf?
        }
        do {
            // Bootstrap first when this account has a stashed name (idempotent; provisions or adopts).
            if let name = stashedName(for: owner) {
                _ = try? await api.post(
                    "auth/bootstrap",
                    body: BootstrapBody(role: "student", firstName: name.first, lastName: name.last),
                    as: BootstrapResult.self
                )
            }
            let me = try await api.get("me", as: Me.self)
            if let student = me.student {
                clearStashedName()
                phase = .ready(student)
            } else {
                phase = .needsName
            }
        } catch {
            // Signed in to Cognito but the API is unreachable or refused: the name
            // screen retries bootstrap; signed-out is wrong here only if a session exists.
            if await AmplifyAuth.isSignedIn() || devToken() != nil {
                phase = .needsName
            } else {
                phase = .signedOut
            }
        }
    }
}
