import Foundation
import SwiftUI

/// Student auth. Production path is Cognito SRP via Amplify Swift (lands with the
/// device pass — same pool/flows the legacy app proved; config stays untracked).
/// DEBUG builds can also use the API's dev-token mode so the Simulator slice runs
/// end-to-end without real credentials.
@MainActor
final class AuthStore: ObservableObject {
    enum Phase {
        case loading
        case signedOut
        case needsName
        case ready(StudentSelf)
    }

    @Published var phase: Phase = .loading

    private let tokenKey = "bali.devToken"
    private(set) lazy var api = APIClient { [weak self] in self?.currentToken() }

    nonisolated private func currentToken() -> String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    func start() async {
        guard currentToken() != nil else {
            phase = .signedOut
            return
        }
        await loadProfile()
    }

    /// DEBUG dev sign-in: identity is `dev:<sub>` + the chosen name; the API adopts
    /// the seed student with that name (e.g. "Jordan Park" becomes the persona).
    func devSignIn(firstName: String, lastName: String) async {
        #if DEBUG
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
            phase = .signedOut
        }
        #endif
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        phase = .signedOut
    }

    private func loadProfile() async {
        struct Me: Decodable {
            var role: String?
            var student: StudentSelf?
        }
        do {
            let me = try await api.get("me", as: Me.self)
            if let student = me.student {
                phase = .ready(student)
            } else {
                phase = .needsName
            }
        } catch {
            phase = .signedOut
        }
    }
}
