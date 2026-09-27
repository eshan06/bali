import SwiftUI

/// The intro (C1b): the privacy contract, three pages before anything else — what Bali does, what
/// the teacher sees and never sees, how a class starts — swiped, or advanced with Continue, whose
/// last press is `done` (`Phone.sawIntro()`). D1's reference onboarding sheet in its light tokens;
/// the words are v3's: every app pauses, no allow-list (ARCHITECTURE, "What Bali is"), and the
/// list is the consent preview's (C2), so the two never say different things.
struct IntroView: View {
    let done: () -> Void
    @State private var page = 0

    var body: some View {
        ScreenScaffold {
            TabView(selection: $page) {
                IntroPage { first }.tag(0)
                IntroPage { second }.tag(1)
                IntroPage { third }.tag(2)
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
            Card(padding: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Sees").textStyle(.label).textCase(.uppercase).foregroundStyle(Theme.brand)
                    ForEach(IntroView.sees, id: \.self) {
                        row("checkmark.circle", Theme.brand, $0, Theme.text)
                    }
                    Text("Never sees").textStyle(.label).textCase(.uppercase)
                        .foregroundStyle(Theme.textTertiary).padding(.top, 8)
                    ForEach(IntroView.neverSees, id: \.self) {
                        row("eye.slash", Theme.textTertiary, $0, Theme.textSecondary)
                    }
                }
            }
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

    /// The consent preview's list (C2; D1's ConsentPreview artboard), the whole of it.
    static let sees = [
        "Your focus status — focused, unlocked, or Screen Time off",
        "When you tap in, and when class ends for you",
        "When you unlock, and the reason if you share one",
        "If you leave this class",
    ]
    static let neverSees = [
        "Your screen, your apps, or what's in them", "Your messages or where you are",
    ]

    private func words(_ title: String, _ body: String) -> some View {
        VStack(spacing: 12) {
            Text(title).textStyle(.h1)
            Text(body).textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
        }
        .multilineTextAlignment(.center)
    }

    private func row(_ icon: String, _ tint: Color, _ text: String, _ ink: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon).foregroundStyle(tint).accessibilityHidden(true)
            Text(text).textStyle(.body).foregroundStyle(ink)
        }
    }
}

/// One page: its content centred, scrolling once the phone's text size outgrows the page.
private struct IntroPage<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                content().frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
}

#if DEBUG
    #Preview("Intro") { RootView(phone: Phone(fixture: PreviewFixtures.all["intro"]!)) }
#endif
