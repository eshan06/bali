import SwiftUI

/// The intro (C1b): the privacy contract, three pages before anything else — what Bali does, what
/// the teacher sees and never sees, how a class starts — swiped, or advanced with Continue, whose
/// last press is `done` (`Phone.sawIntro()`). D1's reference onboarding sheet in its light tokens;
/// the words are v3's: every app pauses, no allow-list (ARCHITECTURE, "What Bali is"), and the
/// list is the consent preview's own (`ConsentCard`, C2b), so the two never say different things.
struct IntroView: View {
    let done: () -> Void
    /// The pages' tags, first to last.
    static let pages = 0...2
    #if DEBUG
        @State private var page = IntroView.page(from: CommandLine.arguments)

        /// The page a Debug launch opens on — `-bali-intro-page 2` — for a screenshot of each: the
        /// page named, the nearest one that exists to a number past either end (#105's review), and
        /// the first when none is named.
        static func page(from arguments: [String]) -> Int {
            let named = PreviewFixtures.value(of: "-bali-intro-page", in: arguments)
            let page = named.flatMap { Int($0) } ?? pages.lowerBound
            return min(max(page, pages.lowerBound), pages.upperBound)
        }
    #else
        @State private var page = IntroView.pages.lowerBound
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
            HStack(spacing: 8) {
                ForEach(Self.pages, id: \.self) { dot in
                    Circle().fill(dot == page ? Theme.brand : Theme.borderStrong)
                        .frame(width: 8, height: 8)
                }
            }
            .frame(maxWidth: .infinity).padding(.bottom, 24)
            .accessibilityHidden(true)
            Button("Continue") {
                if page < Self.pages.upperBound { withAnimation { page += 1 } } else { done() }
            }
            .buttonStyle(PrimaryButtonStyle())
        }
    }

    private var first: some View {
        VStack(spacing: 32) {
            BaliMark(size: 160)
            words(
                "Your class, focused together",
                "Bali pauses every app on your phone during class — until the bell. Calls, FaceTime, Messages and Emergency SOS always work."
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
                "Everything comes back at the bell — or instantly, any time, with Emergency Unlock. No questions asked."
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
