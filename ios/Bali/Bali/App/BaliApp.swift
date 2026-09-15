import SwiftUI

@main
struct BaliApp: App {
    @StateObject private var auth = AuthStore()
    @StateObject private var deepLinks = DeepLinks()

    init() {
        // Persist BALI_DEV_API_HOST from the launch env NOW — a signed-out first run
        // makes no API call, and a later icon-tap relaunch would fall back to localhost.
        _ = APIConfig.baseURL
        AmplifyAuth.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(deepLinks)
                .task { await auth.start() }
                .onOpenURL { deepLinks.handle($0) }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage(OnboardingView.doneKey) private var onboarded = false
    @Environment(\.scenePhase) private var scenePhase
    /// HELD, not recomputed every render. The unlock clears the marker, so a computed
    /// version tore this screen down the instant the student finished the hold — before the
    /// "Unlocked — <teacher> was notified" confirmation or the reason sheet.
    @State private var stranded: ShieldMarker.Marker?
    /// Set once the student has taken the exit from the stranded screen, so we hand the app
    /// back to its normal flow instead of re-presenting it.
    @State private var released = false

    var body: some View {
        Group {
            if let marker = stranded {
                // Shields survive process death. Offline, `GET /me` fails and AuthStore lands
                // on .needsName, so a shielded student would otherwise be shown a NAME FORM
                // while the shield screen tells them "Emergency? Open Bali" — shielded, told to
                // open the app, and given no exit. The unlock is local-first and queued, so it
                // works here with no network and no server participation.
                StrandedFocusView(marker: marker, api: auth.api) {
                    released = true
                    stranded = nil
                }
            } else {
                phaseBody
            }
        }
        .onAppear { adoptIfStranded() }
        // `AuthStore.Phase` is not Equatable, so watch the one thing that gates this screen.
        .onChange(of: canReachHome) { _ in adoptIfStranded() }
        // A relaunch is a fresh process, but a foreground is not: re-check after the student
        // may have changed something in iOS Settings and come back.
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                released = false
                adoptIfStranded()
            }
        }
    }

    /// Whether the normal flow lands on HomeView, which owns the marker itself (HomeModel
    /// .load adopts it into the ONE engine Home holds). `.loading` counts as reachable: it
    /// is the phase EVERY launch starts in, and stranding there built a second FocusEngine
    /// for the same session seconds before HomeModel built its own — two engines mutating
    /// one process-wide ManagedSettings, marker and DeviceActivity state, where a stale
    /// response from the losing one can re-shield a phone whose banner says "Free".
    /// Loading always settles: every AuthStore path assigns a phase, and requests time out.
    private var canReachHome: Bool {
        switch auth.phase {
        case .loading: return true
        case .ready: return onboarded
        case .signedOut, .needsName, .needsConfirmation: return false
        }
    }

    /// Only launches that genuinely cannot reach HomeView get this screen.
    private func adoptIfStranded() {
        guard stranded == nil, !released, !canReachHome else { return }
        guard let marker = ShieldMarker.dueNow(), marker.endsAt > Date() else {
            // Mirror HomeModel.adoptShieldMarker, which releases in exactly these two cases.
            // This is the ONLY exit surface on a launch that cannot reach HomeView — i.e. the
            // offline launch, where `GET /me` fails and auth lands on .needsName — so simply
            // returning leaves a shielded phone behind a name form with no unlock, while the
            // shield screen says "Emergency? Open Bali". Reachable whenever the bell has passed
            // but the padded DeviceActivity window has not fired yet. Fail toward the student.
            if ShieldMarker.exists || ShieldFlag.isSet { FocusEngine(api: auth.api).reset() }
            return
        }
        stranded = marker
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch auth.phase {
        case .loading:
            ZStack {
                Tokens.Dark.page.ignoresSafeArea()
                ProgressView().tint(Tokens.Dark.textSecondary)
            }
        case .signedOut:
            SignInView()
        case .needsName:
            NameView()
        case let .needsConfirmation(email, password):
            ConfirmCodeView(email: email, password: password)
        case let .ready(student):
            if onboarded {
                HomeView(student: student)
            } else {
                OnboardingView { onboarded = true }
            }
        }
    }
}

/// The focus screen rebuilt from the durable shield marker alone — no network, no server
/// participation, no auth. Its only job is to put the emergency unlock back on screen for a
/// student whose phone is shielded on a launch that cannot reach Home.
private struct StrandedFocusView: View {
    let marker: ShieldMarker.Marker
    var onReleased: () -> Void

    @StateObject private var engine: FocusEngine
    @State private var adopted = false

    init(marker: ShieldMarker.Marker, api: APIClient, onReleased: @escaping () -> Void) {
        self.marker = marker
        self.onReleased = onReleased
        _engine = StateObject(wrappedValue: FocusEngine(api: api))
    }

    var body: some View {
        FocusActiveView(engine: engine, onExit: onReleased)
            .onAppear {
                guard !adopted else { return }
                adopted = true
                engine.adopt(marker: marker)
            }
            .onChange(of: engine.state) { state in
                // The bell (or a reset) is over: hand the app back to its normal flow.
                // `.unlocked` is deliberately NOT here — the shields are already down, and
                // tearing the screen off at that instant skipped the "Unlocked — <teacher>
                // was notified" confirmation and the reason sheet, dropping an offline
                // student onto a name form. They leave with "Back to Today", which calls
                // FocusActiveView's onExit — this same closure.
                switch state {
                case .ended, .idle: onReleased()
                case .focused, .statusOnly, .pass, .unlocked: break
                }
            }
    }
}
