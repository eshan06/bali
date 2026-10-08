import AuthenticationServices
import BaliCore
import BaliOutbox
import SwiftUI

/// Sign in (C1a; the approved Sign in & sign up design), a first launch's screen and shown until
/// someone is signed in: Sign up, filled, and Sign in, outlined — each Cognito's hosted UI in an
/// ephemeral browser session (no cookie kept, so a sign-out asks the password again) through
/// `Phone.signIn`, the one gate, which asks the 13+ check and shows the intro first for Sign up.
/// While a page opens its button says so, and neither takes a press. A page that did not finish
/// is said under the buttons, in `SignInError.words` (rule 5); one the student closed changed
/// nothing, and says nothing. Under its caption, the portal's privacy policy and terms
/// (`PolicyLinks`, C2b).
struct SignInView: View {
    let phone: Phone
    @Environment(\.webAuthenticationSession) private var browser

    var body: some View {
        // Signed in, Sign in only ever waits for Bali or leaves (`RootView`): its page's button
        // stays busy, as the screen under the page holds still (the approved motion spec).
        let opening = phone.signingIn || phone.signedIn == true ? phone.hostedPage : nil
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 24) {
                        BaliMark(size: 72)
                        VStack(alignment: .leading, spacing: 12) {
                            // Each way's two words kept on one line, as the canvas keeps them.
                            Text("Sign\u{A0}up or sign\u{A0}in").textStyle(.h1)
                            Text("You only do this once. After that, Bali remembers you.")
                                .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    Spacer()
                    VStack(spacing: 12) {
                        Button(opening == .signUp ? "Signing up…" : "Sign up") {
                            Task { await phone.signIn(.signUp, through: browser.hostedUI) }
                        }
                        .buttonStyle(PrimaryButtonStyle()).disabled(opening != nil)
                        Button(opening == .signIn ? "Signing in…" : "Sign in") {
                            Task { await phone.signIn(.signIn, through: browser.hostedUI) }
                        }
                        .buttonStyle(SecondaryButtonStyle()).disabled(opening != nil)
                        if let failure = phone.signInFailed?.words(on: phone.hostedPage) {
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

}

extension WebAuthenticationSession {
    /// The hosted UI at `url`, in an ephemeral session, for `Phone.signIn(through:)`: where it
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
