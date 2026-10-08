import SwiftUI

/// The intro (C1b): the privacy contract, three pages Sign up shows before its page, where this
/// phone has not seen them (the approved Sign in & sign up design) — what Bali does, what the
/// teacher sees and never sees, how a class starts — swiped, or advanced with Continue; the last
/// page's button is Sign up, which opens Cognito's sign-up page over it (`Phone.sawIntro`), saying
/// so while it opens. D1's reference onboarding sheet in its light tokens; the words are v3's:
/// every app pauses, no allow-list (ARCHITECTURE, "What Bali is"), and the list is the consent
/// preview's own (`ConsentCard`, C2b), so the two never say different things. The last page links
/// the portal's privacy policy and terms under its button (`PolicyLinks`).
struct IntroView: View {
    let phone: Phone
    @Environment(\.webAuthenticationSession) private var browser
    /// The pages' tags, first to last.
    static let pages = 0...2
    @State private var page: Int
    /// Continue's turns of the page under Reduce Motion, each the next page fading in where the
    /// page view would slide (the approved motion spec).
    @State private var turns = 0

    /// Opened on `page` — the first, or a Debug launch's — as a test opens each (#135's review).
    init(phone: Phone, page: Int = IntroView.opening) {
        (self.phone, _page) = (phone, State(initialValue: page))
    }

    #if DEBUG
        static var opening: Int { page(from: CommandLine.arguments) }

        /// The page a Debug launch opens on — `-bali-intro-page 2` — for a screenshot of each: the
        /// page named, the nearest one that exists to a number past either end (#105's review), and
        /// the first when none is named.
        static func page(from arguments: [String]) -> Int {
            let named = PreviewFixtures.value(of: "-bali-intro-page", in: arguments)
            let page = named.flatMap { Int($0) } ?? pages.lowerBound
            return min(max(page, pages.lowerBound), pages.upperBound)
        }
    #else
        static let opening = pages.lowerBound
    #endif

    var body: some View {
        ScreenScaffold {
            // The pages as wide as the screen, so a page's scroll bar is at its edge: each in the
            // gutters its scroll view reaches past (`screenWide`).
            TabView(selection: $page) {
                PageScroll { first }.padding(.horizontal, Theme.gutter).tag(0)
                PageScroll { Self.consent }.padding(.horizontal, Theme.gutter).tag(1)
                PageScroll { third }.padding(.horizontal, Theme.gutter).tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never)).padding(.horizontal, -Theme.gutter)
            .keyframeAnimator(initialValue: 1.0, trigger: turns) { pages, shown in
                pages.opacity(shown)
            } keyframes: { _ in
                LinearKeyframe(0, duration: 0)
                LinearKeyframe(1, duration: 0.2, timingCurve: Motion.curve)
            }
            HStack(spacing: 8) {
                ForEach(Self.pages, id: \.self) { dot in
                    Circle().fill(dot == page ? Theme.brand : Theme.borderStrong)
                        .frame(width: 8, height: 8)
                }
            }
            // The dots cross-fade as the page turns: `fast`.
            .animation(Motion.standard(0.15), value: page)
            .frame(maxWidth: .infinity).padding(.bottom, 24)
            .accessibilityHidden(true)
            let last = page == Self.pages.upperBound
            // Held, the router gone on, the intro only waits for Bali or leaves: still busy.
            let opening = last && (phone.signingIn || phone.shown.screen != .intro)
            Button {
                if last {
                    Task { await phone.sawIntro(through: browser.hostedUI) }
                } else if UIAccessibility.isReduceMotionEnabled {
                    (page, turns) = (page + 1, turns + 1)
                } else {
                    // The page view's own slide, as a swipe plays it: `slow`.
                    withAnimation(Motion.standard(0.3)) { page += 1 }
                }
            } label: {
                // Its words change at once as the page turns, never cross-fading, under the
                // press's own release too.
                Text(last ? (opening ? "Signing up…" : "Sign up") : "Continue")
                    .transaction { $0.animation = nil }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(opening)
            // The portal's policy pages, under the button on the last page alone — their room kept
            // on every page, so the button never moves as the pages turn.
            PolicyLinks().padding(.top, 8)
                .opacity(last ? 1 : 0).accessibilityHidden(!last).allowsHitTesting(last)
                // As the button's words, at once: only the page slides.
                .animation(nil, value: page)
        }
    }

    private var first: some View {
        VStack(spacing: 32) {
            BaliMark(size: 160)
            words(
                "Your class, focused together",
                "During class, Bali pauses every app on your phone until the bell. Calls, FaceTime, Messages and Emergency SOS always work."
            )
        }
    }

    /// What a teacher sees: the second page, and Me's What your teacher sees (C6b) — one page, so
    /// the two never say different things.
    static var consent: some View {
        VStack(spacing: 24) {
            Text("What your teacher sees").textStyle(.h1).multilineTextAlignment(.center)
            ConsentCard(title: "Sees")
            Text("This is the whole list. It never grows without asking you again.")
                .textStyle(.caption).foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
    }

    private var third: some View {
        VStack(spacing: 32) {
            HStack(spacing: 20) {
                BaliMark(size: 72)
                Image(systemName: "wave.3.right")
                Image(systemName: "iphone")
            }
            .font(.system(size: 44, weight: .light)).foregroundStyle(Theme.brand)
            .accessibilityHidden(true)
            words(
                "Tap your teacher's block to start",
                "Everything comes back at the bell, or instantly with Emergency Unlock, any time. No questions asked."
            )
        }
    }

    private func words(_ title: String, _ body: String) -> some View {
        VStack(spacing: 12) {
            Text(title).textStyle(.h1)
            Text(body).textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
        }
        .multilineTextAlignment(.center)
    }
}

#if DEBUG
    #Preview("Intro") { RootView(phone: Phone(fixture: PreviewFixtures.all["intro"]!)) }
#endif
