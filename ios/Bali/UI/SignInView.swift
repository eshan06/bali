import AuthenticationServices
import BaliCore
import BaliOutbox
import SwiftUI

/// Sign in (C1a), a first launch's screen and shown until someone is signed in, as the sign-in
/// redesign's board "1 · Bali's Sign in screen" draws it (the owner's approval, 2026-11-12): on the
/// page, Bali, the session ring as art and "Quiet until the bell."; then a white sheet from the
/// screen's foot holding Sign up, filled, and Sign in, outlined — each Cognito's managed login in an
/// ephemeral browser session (no cookie kept, so a sign-out asks the password again) through
/// `Phone.signIn`, the one gate, which asks the 13+ check and shows the intro first for Sign up.
/// While a page opens its button says so, and neither takes a press. A page that did not finish is
/// said under the buttons, in `SignInError.words` (rule 5); one the student closed changed nothing,
/// and says nothing. Under its caption, the portal's privacy policy and terms (`PolicyLinks`, C2b).
/// Its intermediate states as the canvas's SignIn boards draw them (drawn there first): the ring
/// gives way so the sheet shows whole on the first screen — on an iPhone SE, or with a line under
/// the buttons — and at the accessibility text sizes it steps aside, so Sign up and Sign in stay on
/// an SE's first screen; past that the screen scrolls, never cutting a line.
struct SignInView: View {
    let phone: Phone
    @Environment(\.webAuthenticationSession) private var browser
    @Environment(\.dynamicTypeSize) private var textSize
    /// The screen's room under the safe area, the home indicator's: none on a phone with a Home
    /// button.
    @State private var homeIndicator: CGFloat = 0

    var body: some View {
        // Signed in, Sign in only ever waits for Bali or leaves (`RootView`): its page's button
        // stays busy, as the screen under the page holds still (the approved motion spec).
        let opening = phone.signingIn || phone.signedIn == true ? phone.hostedPage : nil
        let crowded = textSize.isAccessibilitySize
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 0) {
                    // A logotype, and the art's own line: each stops growing at the largest text
                    // size short of the accessibility ones, as Focus's countdown does.
                    Text("Bali").textStyle(.wordmark).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .fixedSize(horizontal: false, vertical: true)
                    if !crowded {
                        // The screen's width at most, as the board draws it, and what the rest
                        // leaves of the screen's height, but never under 160 pt: offered first,
                        // its own height counted as that least while the page is measured.
                        SessionRingArt().frame(minHeight: 160, idealHeight: 160).padding(.top, 4)
                            .padding(.horizontal, -Theme.gutter).layoutPriority(1)
                    }
                    Text("Quiet until the bell.").textStyle(.tagline)
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge).padding(.top, crowded ? 16 : 4)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    sheet(opening: opening, crowded: crowded)
                }
                .multilineTextAlignment(.center)
            }
            // Bali 4 pt under the status bar, where D1's screens start 16 pt under it: its letters'
            // top where the board's are.
            .padding(.top, -12)
        }
        .background {
            Color.clear.ignoresSafeArea()
                .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: {
                    homeIndicator = $0
                }
        }
    }

    /// The sheet: its words and buttons at the board's spacing, on white with its top corners round
    /// at 28 and the board's warm shadow over its edge; the white reaching the screen's sides and
    /// on past its foot, under the home indicator and any bounce.
    private func sheet(opening: HostedPage?, crowded: Bool) -> some View {
        VStack(spacing: 12) {
            // Each way's two words kept on one line, as the board keeps them.
            Text("Sign\u{A0}up or sign\u{A0}in").textStyle(.body)
                .foregroundStyle(Theme.textSecondary).padding(.bottom, 8)
            Button(opening == .signUp ? "Signing up…" : "Sign up") {
                Task { await phone.signIn(.signUp, through: browser.hostedUI) }
            }
            .buttonStyle(PillButtonStyle(filled: true)).disabled(opening != nil)
            Button(opening == .signIn ? "Signing in…" : "Sign in") {
                Task { await phone.signIn(.signIn, through: browser.hostedUI) }
            }
            .buttonStyle(PillButtonStyle(filled: false)).disabled(opening != nil)
            if let failure = phone.signInFailed?.words(on: phone.hostedPage) {
                Text(failure).textStyle(.body)
            }
            Text("Trouble signing in? Ask your teacher.").textStyle(.caption)
                .foregroundStyle(Theme.textTertiary).padding(.top, 6)
            // The links' words 12 pt under the caption's, as the board's: their 44-pt row's own
            // room over them, 13 pt at the usual sizes, taken back; at the accessibility ones the
            // row has none.
            PolicyLinks(underlined: true, dotted: true).padding(.top, crowded ? 0 : -11)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 30)
        // The links' words on the home indicator's line, as the board draws them, the row's room
        // under them reaching into its space; 24 pt over the screen's edge on a phone with none.
        .padding(.bottom, max(homeIndicator, 24) - homeIndicator - (crowded ? 0 : 13))
        .background(alignment: .top) {
            UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
                .fill(Theme.card.shadow(.drop(color: Theme.shadow, radius: 12, y: -8)))
                .padding(.horizontal, -Theme.gutter).padding(.bottom, -1000)
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
