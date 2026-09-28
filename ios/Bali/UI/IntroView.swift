import SwiftUI

/// The intro (C1b): the privacy contract, three pages before anything else — what Bali does, what
/// the teacher sees and never sees, how a class starts — swiped, or advanced with Continue, whose
/// last press is `done` (`Phone.sawIntro()`). D1's reference onboarding sheet in its light tokens;
/// the words are v3's: every app pauses, no allow-list (ARCHITECTURE, "What Bali is"), and the
/// list is the consent preview's own (`ConsentCard`, C2b), so the two never say different things.
struct IntroView: View {
    let done: () -> Void
    #if DEBUG
        /// The page a Debug launch opens on — `-bali-intro-page 2` — for a screenshot of each.
        @State private var page = Int(PreviewFixtures.value(of: "-bali-intro-page") ?? "") ?? 0
    #else
        @State private var page = 0
    #endif

    var body: some View {
        ScreenScaffold {
            TabView(selection: $page) {
                PageScroll { first }.tag(0)
                PageScroll { second }.tag(1)
                PageScroll { third }.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            HStack(spacing: 8) {
                ForEach(0..<3) { dot in
                    Circle().fill(dot == page ? Theme.brand : Theme.borderStrong)
                        .frame(width: 8, height: 8)
                }
            }
            .frame(maxWidth: .infinity).padding(.bottom, 24)
            .accessibilityHidden(true)
            Button("Continue") {
                if page < 2 { withAnimation { page += 1 } } else { done() }
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

    private var second: some View {
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
