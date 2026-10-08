import BaliOutbox
import SwiftUI
import UIKit

/// The student app's one root: the screen `Screen.choose` picks from what the phone knows, and its
/// tab bar, in one ask (`Phone.shown`), light in every appearance — D1 is light. A Debug build
/// keeps the device check's readout (ios/README.md, rounds 1–4) behind a **Readout** button.
struct RootView: View {
    let phone: Phone
    /// Reduce Motion as the phone has it now, never the environment's, which drew the root again at
    /// any change of focus (`AppTests.reduceMotionBack`).
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }
    #if DEBUG
        @State private var readout = false
    #endif

    /// The last bell rung: at a bell nothing Unlocked or Protection off watches changes, as
    /// Focus's shields do, so the router is asked again then (C1a's hand-off) — by the phone's
    /// clock, as the router reads it, set forward past the bell too (C5b).
    @State private var rung: Date?
    /// What shows, and the move that brought it (`Stage`).
    @State private var stage = Stage()

    var body: some View {
        let _ = rung
        // The screen and its bar from one ask of the router (C6a's review), drawn as its move has
        // it (`Stage`), over the page's colour to the edges.
        let routed = Routed(phone.shown)
        let (shown, move) = stage.showing(routed, signedIn: phone.signedIn == true)
        ZStack { unit(shown, held: shown.screen != routed.screen, by: move) }
            .background(Theme.page.ignoresSafeArea())
            .task(id: routed) { await play(routed) }
            .task(id: phone.bell) {
                guard let bell = phone.bell else { return }
                await Screen.bell(bell, change: UIApplication.significantTimeChangeNotification)
                if !Task.isCancelled { rung = bell }
            }
            .preferredColorScheme(.light)
            #if DEBUG
                .overlay(alignment: .topTrailing) {
                    // Not over the deletion's screen (C4b): its Sign out, Join and Tap are what
                    // that screen keeps from happening.
                    if phone.engine != nil, shown.screen != .deleting {
                        Button("Readout") { readout = true }
                            .textStyle(.caption).foregroundStyle(Theme.textTertiary).padding(8)
                    }
                }
                .sheet(isPresented: $readout) { ReadoutSheet(phone: phone) }
            #endif
    }

    /// `shown` with its tab bar, one unit — Home and its bar arrive together, the bar read after
    /// it — coming or going `by` its move; `held`, the router gone on: no touch lands on it.
    private func unit(_ shown: Routed, held: Bool, by move: Screen.Move) -> some View {
        VStack(spacing: 0) {
            screen(shown.screen)
            if shown.tabbed { TabBar(phone: phone, shown: shown.screen) }
        }
        .allowsHitTesting(!held).id(shown.screen)
        .transition(Stage.transition(move, reduceMotion: reduceMotion))
    }

    @ViewBuilder private func screen(_ shown: Screen) -> some View {
        switch shown {
        case .starting:
            ScreenScaffold {
                BaliMark(size: 72).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        case .age: AgeView(phone: phone)
        case .tooYoung: TooYoungView()
        case .name: NameView(phone: phone)
        case .intro: IntroView(phone: phone)
        case .signIn: SignInView(phone: phone)
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
        case .deleting: DeletingView(phone: phone)
        case .storage(let problem): StorageView(problem: problem) { await phone.start() }
        }
    }

    /// The move to the router's `routed`, played once due (`Screen.Move.due`) unless the router has
    /// gone on meanwhile — the next answer's own then, as `task(id:)` cancels this one; a cut at
    /// once. Played, a screen the student opens fades as #150 has it.
    private func play(_ routed: Routed) async {
        let now = Date()
        guard let shown = stage.shown, shown.screen != routed.screen else {
            return stage.shown = routed
        }
        let move = stage.next(routed, signedIn: phone.signedIn == true)
        guard move != .cut else { return stage = Stage(shown: routed, since: now) }
        let due = move.due(
            from: shown.screen, shownAt: stage.since, routedAt: now, pageEnded: phone.pageEnded)
        guard (try? await Task.sleep(for: .seconds(due.timeIntervalSince(now)))) != nil,
            Routed(phone.shown) == routed
        else { return }
        let seconds = Motion.seconds(move, reduceMotion: reduceMotion)
        withAnimation(Motion.standard(seconds)) {
            stage = Stage(shown: routed, since: Date(), move: move)
        }
        guard (try? await Task.sleep(for: .seconds(seconds))) != nil else { return }
        stage.move = .cut
    }
}

/// The router's answer as `RootView` shows it: a screen, and whether its tab bar shows.
struct Routed: Hashable {
    let screen: Screen
    let tabbed: Bool

    init(_ shown: (screen: Screen, tabbed: Bool)) { (screen, tabbed) = shown }
}

/// What `RootView` shows (the approved Sign in & sign up design's motion spec): the router's answer
/// once the move to it has played, `since` it showed, and the move that brought it, `cut` again
/// once played. A cut shows at once: Focus, a session's screens and Emergency Unlock never wait.
struct Stage {
    var shown: Routed?
    var since = Date()
    var move = Screen.Move.cut

    /// The move from the screen showing to the router's `routed`; a cut where none shows yet.
    func next(_ routed: Routed, signedIn: Bool) -> Screen.Move {
        guard let shown else { return .cut }
        return Screen.Move(
            from: (shown.screen, shown.tabbed), to: (routed.screen, routed.tabbed),
            signedIn: signedIn)
    }

    /// What to draw for `routed`, and the move its screen comes or goes by: `routed` where it shows
    /// already or comes by a cut; else the screen showing, held until the move plays.
    func showing(_ routed: Routed, signedIn: Bool) -> (Routed, Screen.Move) {
        guard let shown, shown.screen != routed.screen else { return (routed, move) }
        let coming = next(routed, signedIn: signedIn)
        return coming == .cut ? (routed, .cut) : (shown, coming)
    }

    /// `moving` as a transition: one shape for every move, only its values differ (`Moving`).
    @MainActor static func transition(_ move: Screen.Move, reduceMotion: Bool) -> AnyTransition {
        let (arriving, leaving) = moving(move, reduceMotion: reduceMotion)
        return .asymmetric(
            insertion: .modifier(active: arriving, identity: arriving.shown),
            removal: .modifier(active: leaving, identity: leaving.shown))
    }

    /// How a screen comes in by `move`, and how the one it replaces goes: a step slides 24 pt
    /// (`space-6`) as it fades in, the one leaving gone by the step's first 100 ms; an arrival or
    /// the mark fades in as the one leaving fades out (by 150 ms for an arrival); under Reduce
    /// Motion, cross-fades; a cut — a screen the student opens (#150) — fades in over the page's
    /// colour, the one it replaces gone at once.
    @MainActor static func moving(_ move: Screen.Move, reduceMotion: Bool) -> (
        arriving: Moving, leaving: Moving
    ) {
        // The share of a 300 ms move, on the standard easing, done by its first 100 ms and 150 ms.
        let (by100, by150) = (0.73, 0.88)
        return switch move {
        case .cut: (Moving(page: true), Moving(fadesBy: 0, away: true))
        case _ where reduceMotion: (Moving(), Moving(away: true))
        case .forward: (Moving(slide: 24), Moving(slide: -24, fadesBy: by100, away: true))
        case .back: (Moving(slide: -24), Moving(slide: 24, fadesBy: by100, away: true))
        case .arrive: (Moving(), Moving(fadesBy: by150, away: true))
        case .mark: (Moving(), Moving(away: true))
        }
    }
}

/// A screen coming or going by a move: one modifier for every move, only its values set by the
/// move — SwiftUI keeps a screen's transition from its insertion unless a later one has the same
/// shape. `gone`, 1 before it arrives and once it has left; `slide`, how far it has moved then;
/// `fadesBy`, the share of the move by which it has faded out, 0 at once; `page`, the page's colour
/// under it from the start (#150); `away`, leaving: no touch nor VoiceOver from its first frame,
/// so a fast tap meant for the screen arriving cannot land on it (#161's review).
struct Moving: ViewModifier, Animatable {
    var gone = 1.0
    var slide: CGFloat = 0
    var fadesBy = 1.0
    var page = false
    var away = false

    nonisolated var animatableData: Double {
        get { gone }
        set { gone = newValue }
    }

    /// Itself as shown: nothing moved or faded.
    var shown: Moving {
        var shown = self
        shown.gone = 0
        return shown
    }

    func body(content: Content) -> some View {
        let left = away && gone > 0
        content.opacity(fadesBy > 0 ? max(0, 1 - gone / fadesBy) : (gone > 0 ? 0 : 1))
            .offset(x: slide * gone)
            .background(Theme.page.opacity(page ? 1 : 0).ignoresSafeArea())
            .allowsHitTesting(!left).accessibilityHidden(left)
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
/// Laid out as Sign in is, scrolling once the phone's text size outgrows it (santa's round 1).
struct StorageView: View {
    let problem: String
    let retry: () async -> Void

    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Bali couldn't start").textStyle(.h2)
                        Text(problem).textStyle(.body).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    Button("Try again") { Task { await retry() } }
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
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
