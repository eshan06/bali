import BaliOutbox
import SwiftUI

/// The student app's one root: the screen `Screen.choose` picks from what the phone knows
/// (`Phone.screen`), light in every appearance — D1 is light. A screen a later step draws shows a
/// placeholder naming that step meanwhile, never a blank. A Debug build keeps the device check's
/// readout (ios/README.md, rounds 1–4) behind a **Readout** button.
struct RootView: View {
    let phone: Phone
    #if DEBUG
        @State private var readout = false
    #endif

    var body: some View {
        screen
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

    @ViewBuilder private var screen: some View {
        switch phone.screen {
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
        case .focus: StepPlaceholder("Focus — C4")
        case .unlocked: StepPlaceholder("Unlocked — C5")
        case .protectionOff: StepPlaceholder("Protection off — C5")
        case .sessionOver: StepPlaceholder("Session over — C5")
        case .storage(let problem): StorageView(problem: problem) { await phone.start() }
        }
    }
}

/// What a screen a later step draws shows meanwhile: the mark and the step's name.
struct StepPlaceholder: View {
    let step: String

    init(_ step: String) { self.step = step }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 24) {
                BaliMark(size: 40)
                Text(step).textStyle(.caption).foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
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
