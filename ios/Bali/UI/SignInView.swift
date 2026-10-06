import AuthenticationServices
import BaliCore
import BaliOutbox
import SwiftUI

/// Sign in (D1's Main artboard; C1a), shown until someone is signed in: Cognito's hosted UI in an
/// ephemeral browser session — no cookie kept, so a sign-out asks the password again — through
/// `SignIn`, as the readout did (B4c). A sign-in that did not finish is said under the button, in
/// `SignInError.words` (rule 5); one the student closed changed nothing, and says nothing. Under
/// its caption, the portal's privacy policy and terms (`PolicyLinks`, C2b).
struct SignInView: View {
    /// nil in a preview or a fixture, where nothing signs in.
    let signIn: SignIn?
    @Environment(\.webAuthenticationSession) private var browser
    @State private var busy = false
    @State private var failure: String?

    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 24) {
                        BaliMark(size: 72)
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Sign in").textStyle(.h1)
                            Text(
                                "Use the account your school gave you. You only do this once — after that, Bali remembers you."
                            )
                            .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    Spacer()
                    VStack(spacing: 12) {
                        Button(busy ? "Signing in…" : "Sign in") { Task { await go() } }
                            .buttonStyle(PrimaryButtonStyle()).disabled(busy)
                        if let failure {
                            Text(failure).textStyle(.body)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Text("Trouble signing in? Ask your teacher.")
                            .textStyle(.caption).foregroundStyle(Theme.textTertiary)
                            .frame(maxWidth: .infinity).multilineTextAlignment(.center)
                        PolicyLinks()
                    }
                }
            }
        }
    }

    /// One attempt: the hosted UI in the ephemeral session, and what did not finish said in place.
    private func go() async {
        guard let signIn, !busy else { return }
        (busy, failure) = (true, nil)
        defer { busy = false }
        let (browser, scheme) = (browser, signIn.cognito.redirectURI.scheme ?? "")
        do {
            try await signIn.signIn { @MainActor url throws(SignInError) in
                try await browser.hostedUI(url, scheme: scheme)
            }
        } catch {
            failure = error.words
        }
    }
}

extension WebAuthenticationSession {
    /// The hosted UI at `url`, in an ephemeral session, for `SignIn.signIn(through:)`: where it
    /// sent the student back, or why not, in the sign-in's words (C1b).
    func hostedUI(_ url: URL, scheme: String) async throws(SignInError) -> URL {
        do {
            return try await authenticate(
                using: url, callbackURLScheme: scheme, preferredBrowserSession: .ephemeral)
        } catch {
            throw SignInError(browser: error)
        }
    }
}

extension SignInError {
    /// The browser session's error in the sign-in's words: its own cancel — the student closed the
    /// page — is `cancelled`, which says nothing; anything else `notOpened`, which is said, what
    /// the browser said kept for the readout (rule 5; C1b). The cancel is read off the error's
    /// domain and code, so it is known however SwiftUI's session hands it over: the typed error,
    /// the `NSError` behind it, or another error type bridging to both, which a cast to the typed
    /// error misses (#105's review).
    init(browser error: any Error) {
        let bridged = error as NSError
        if bridged.domain == ASWebAuthenticationSessionError.errorDomain,
            bridged.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
        {
            self = .cancelled
        } else {
            self = .notOpened("\(error)")
        }
    }
}

#if DEBUG
    #Preview("Sign in") { RootView(phone: Phone(fixture: PreviewFixtures.all["signIn"]!)) }
#endif
