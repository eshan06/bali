import BaliOutbox
import SwiftUI
import UIKit

/// The student app's one root: the screen `Screen.choose` picks from what the phone knows, and its
/// tab bar, in one ask (`Phone.shown`), light in every appearance — D1 is light. A Debug build
/// keeps the device check's readout (ios/README.md, rounds 1–4) behind a **Readout** button.
struct RootView: View {
    let phone: Phone
    #if DEBUG
        @State private var readout = false
    #endif

    /// The last bell rung: at a bell nothing Unlocked or Protection off watches changes, as
    /// Focus's shields do, so the router is asked again then (C1a's hand-off) — by the phone's
    /// clock, as the router reads it, set forward past the bell too (C5b).
    @State private var rung: Date?

    var body: some View {
        let _ = rung
        // The screen and its bar from one ask of the router (C6a's review). A screen the student
        // opens over another fades in, and the one under it fades back in at Back (`Phone.fade`,
        // #150).
        let shown = phone.shown
        ZStack { screen(shown.screen).transition(Opening.transition) }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if shown.tabbed { TabBar(phone: phone, shown: shown.screen) }
            }
            .task(id: phone.bell) {
                guard let bell = phone.bell else { return }
                await Screen.bell(bell, change: UIApplication.significantTimeChangeNotification)
                if !Task.isCancelled { rung = bell }
            }
            .preferredColorScheme(.light)
            #if DEBUG
                .overlay(alignment: .topTrailing) {
                    if phone.engine != nil {
                        Button("Readout") { readout = true }
                            .textStyle(.caption).foregroundStyle(Theme.textTertiary).padding(8)
                    }
                }
                .sheet(isPresented: $readout) { ReadoutSheet(phone: phone) }
            #endif
    }

    @ViewBuilder private func screen(_ shown: Screen) -> some View {
        switch shown {
        case .starting:
            ScreenScaffold {
                BaliMark(size: 72).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        case .intro: IntroView { phone.sawIntro() }
        case .signIn: SignInView(signIn: phone.signIn)
        case .screenTime: ScreenTimeView(phone: phone)
        case .join: JoinView(phone: phone)
        case .home: HomeView(phone: phone)
        case .waiting: WaitingView(phone: phone)
        case .focus: FocusView(phone: phone)
        case .unlocked: UnlockedView(phone: phone)
        case .protectionOff: ProtectionOffView(phone: phone)
        case .sessionOver: SessionOverView(phone: phone)
        case .history: HistoryView(phone: phone)
        case .me: MeView(phone: phone)
        case .storage(let problem): StorageView(problem: problem) { await phone.start() }
        }
    }
}

/// A screen fading in (#150): its content over the page's own colour, there from the start. The
/// screen it replaces is gone at once — SwiftUI keeps that one until the fade ends, drawing itself
/// anew from what the phone says now, the next screen's — so it leaves unseen, with no animation,
/// and this one's colour covers it too, whichever of the two is drawn above.
struct Opening: ViewModifier {
    static var transition: AnyTransition {
        .asymmetric(
            insertion: .modifier(active: Opening(shown: false), identity: Opening(shown: true)),
            removal: .opacity.animation(nil))
    }

    let shown: Bool

    func body(content: Content) -> some View {
        content.opacity(shown ? 1 : 0).background(Theme.page.ignoresSafeArea())
    }
}

/// D1's tab bar, where the router honours a tab (C6a; `Phone.shown`): the one `shown` in the
/// brand's ink, the others in the tertiary, on white under a hairline. As iOS's own tab bar does,
/// its text grows no larger than the largest standard size and shows large on a long press, and
/// VoiceOver reads it as tabs.
struct TabBar: View {
    let phone: Phone
    let shown: Screen

    var body: some View {
        HStack(spacing: 0) {
            ForEach(
                [
                    (Screen.home, "Home", "house"), (.history, "History", "clock.arrow.circlepath"),
                    (.me, "Me", "person.crop.circle"),
                ], id: \.0
            ) { tab, title, icon in
                Button {
                    phone.select(tab)
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: icon).font(.system(size: 22)).frame(height: 24)
                            .accessibilityHidden(true)
                        Text(title).textStyle(
                            TextStyle(size: 12, line: 16, weight: shown == tab ? .semibold : .medium))
                    }
                    .frame(maxWidth: .infinity, minHeight: 44).contentShape(.rect)
                }
                .buttonStyle(.plain).foregroundStyle(shown == tab ? Theme.brand : Theme.textTertiary)
                .accessibilityAddTraits(shown == tab ? .isSelected : [])
                .accessibilityShowsLargeContentViewer()
            }
        }
        .accessibilityElement(children: .contain).accessibilityAddTraits(.isTabBar)
        .padding(.top, 8).background(Theme.card.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// The app could not start (rule 5): why, and **Try again** — `Phone.start()`, which runs again.
struct StorageView: View {
    let problem: String
    let retry: () async -> Void

    var body: some View {
        ScreenScaffold {
            Spacer()
            VStack(alignment: .leading, spacing: 12) {
                Text("Bali couldn't start").textStyle(.h2)
                Text(problem).textStyle(.body).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Button("Try again") { Task { await retry() } }.buttonStyle(PrimaryButtonStyle())
        }
    }
}

#if DEBUG
    /// The device check's readout, unchanged, in a sheet: every trigger and toggle as before, and
    /// this build's version.
    private struct ReadoutSheet: View {
        let phone: Phone

        var body: some View {
            ScrollView {
                VStack(spacing: 8) {
                    Text("Build \(BaliApp.version)").font(.footnote).foregroundStyle(.secondary)
                    if let signIn = phone.signIn, let engine = phone.engine,
                        let enforcer = phone.enforcer
                    {
                        Readout(phone: phone, signIn: signIn, engine: engine, enforcer: enforcer)
                    }
                }
            }
        }
    }

    #Preview("Storage") { RootView(phone: Phone(fixture: PreviewFixtures.all["storage"]!)) }
#endif
