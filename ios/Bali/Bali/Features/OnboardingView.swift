import SwiftUI
#if canImport(FamilyControls)
import FamilyControls
#endif

/// S1 — three cards + the permission moment + the one-time allow-list. Card 2 (the
/// privacy contract) is the trust moment; its copy is verbatim and restated word-for-word
/// on S9 Privacy. After granting Screen Time the student picks, ONCE, the few apps that
/// stay open in every focus session — there is no per-class/per-session setup ever again.
/// The denied state stays calm and offers an honest status-only path.
struct OnboardingView: View {
    var onDone: () -> Void

    private enum Step { case what, contract, tapIn, permission, allowList, denied }
    @Environment(\.scenePhase) private var scenePhase
    @State private var step: Step
    @State private var asking = false
    @State private var pickerPresented = false
    #if canImport(FamilyControls)
    @State private var allowSelection = FamilyActivitySelection()
    #endif
    private let screenTime = ScreenTime.make()

    init(onDone: @escaping () -> Void) {
        self.onDone = onDone
        var initial: Step = .what
        #if DEBUG
        // Screenshot/test seam: `simctl launch ... com.bali.Bali -bali.onboardingStep N`
        switch UserDefaults.standard.integer(forKey: "bali.onboardingStep") {
        case 2: initial = .contract
        case 3: initial = .tapIn
        case 4: initial = .permission
        case 5: initial = .denied
        default: break
        }
        #endif
        _step = State(initialValue: initial)
    }

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            switch step {
            case .what:
                shell(dot: 1, cta: "Continue", action: { step = .contract }) {
                    OnboardingArcIllustration()
                    title("Your class, focused together")
                    body16("Bali quiets every app except the few you pick to keep open — until the bell.", maxWidth: 300)
                }
            case .contract:
                shell(dot: 2, cta: "Continue", action: { step = .tapIn }) {
                    title("What your teacher sees", maxWidth: 320)
                    PrivacyContractCard()
                    footnote("This is the whole list. It never grows without asking you again.", maxWidth: 300)
                }
            case .tapIn:
                shell(dot: 3, cta: "Continue", action: { step = .permission }) {
                    TapInIllustration()
                    title("Tap the desk tag to start")
                    body16("Everything comes back at the bell — or instantly, any time, with Emergency Unlock. No questions asked.", maxWidth: 310)
                }
            case .permission:
                shell(cta: asking ? "Asking…" : "Ask me", action: { ask() }, under: {
                    footnote("You can change this any time in Settings.")
                }) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 44, weight: .regular))
                        .foregroundColor(Tokens.green300)
                    title("iOS will ask for Screen Time permission", maxWidth: 320)
                    body16("That's the switch that lets Bali shield apps during a session. It stays on your phone, under your control — turning it off later is always possible, and your teacher simply sees \"permission off.\"", maxWidth: 312)
                }
            case .allowList:
                shell(cta: "Start using Bali", action: { saveAllowListAndFinish() }, under: {
                    footnote("Phone & Messages always work on iPhone. Change these any time in Settings.", maxWidth: 300)
                }) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 44, weight: .regular))
                        .foregroundColor(Tokens.green300)
                    title("Pick what stays open in focus", maxWidth: 320)
                    body16("Every other app pauses during a session. Choose the few you always want — like Camera, Notes, or a calculator. This is the only setup, and it's one time.", maxWidth: 320)
                    Button { pickerPresented = true } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "plus.circle")
                            Text(allowListButtonTitle)
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Tokens.green300)
                    }
                }
            case .denied:
                shell(cta: "Open Settings", action: { openSettings() }, under: {
                    VStack(spacing: 6) {
                        Button("Join without focus (status-only)") { finish() }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Tokens.Dark.textSecondary)
                        footnote("You'll show as \"not in\" during sessions, and apps stay unshielded.", maxWidth: 300)
                    }
                }) {
                    Image(systemName: "shield.slash")
                        .font(.system(size: 44, weight: .regular))
                        .foregroundColor(Tokens.Dark.textTertiary)
                    title("Screen Time stayed off", maxWidth: 320)
                    body16("No problem — Bali just can't shield apps without it. Turn it on whenever you're ready.", maxWidth: 312)
                }
            }
        }
        .preferredColorScheme(.dark)
        #if canImport(FamilyControls)
        .familyActivityPicker(isPresented: $pickerPresented, selection: $allowSelection)
        #endif
        .onChange(of: scenePhase) { phase in
            // Coming back from iOS Settings is a scene change, not a step change — this is
            // the only signal that the student turned Screen Time on out from under us.
            if phase == .active, step == .denied, screenTime.permissionOk { step = .allowList }
        }
    }

    private func ask() {
        asking = true
        Task {
            let granted = await screenTime.requestAuthorization()
            asking = false
            // Granted → the one-time allow-list pick; denied → the calm status-only path.
            if granted { step = .allowList } else { step = .denied }
        }
    }

    private var allowListButtonTitle: String {
        #if canImport(FamilyControls)
        let n = FocusAllowList.count(of: allowSelection)
        return n == 0 ? "Select apps to keep open" : "\(n) selected — tap to edit"
        #else
        return "Select apps to keep open"
        #endif
    }

    private func saveAllowListAndFinish() {
        #if canImport(FamilyControls)
        FocusAllowList.save(allowSelection)
        #endif
        finish()
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func finish() {
        UserDefaults.standard.set(true, forKey: OnboardingView.doneKey)
        onDone()
    }

    static let doneKey = "bali.onboarded.v1"
    static var isDone: Bool { UserDefaults.standard.bool(forKey: doneKey) }

    // ---------- layout shell ----------

    @ViewBuilder
    private func shell<Content: View, Under: View>(
        dot: Int? = nil,
        cta: String,
        action: @escaping () -> Void,
        @ViewBuilder under: () -> Under = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 90)
            VStack(spacing: 26) { content() }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
            Spacer()
            VStack(spacing: 16) {
                if let dot {
                    HStack(spacing: 7) {
                        ForEach(1 ... 3, id: \.self) { i in
                            Circle()
                                .fill(i == dot ? Tokens.Dark.textSecondary : Tokens.Dark.border)
                                .frame(width: 7, height: 7)
                        }
                    }
                    .padding(.bottom, 6)
                }
                Button(action: action) {
                    PrimaryButtonLabel(title: cta, busy: false)
                }
                under()
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 48)
        }
    }

    private func title(_ text: String, maxWidth: CGFloat = 300) -> some View {
        Text(text)
            .font(.system(size: 28, weight: .semibold))
            .foregroundColor(Tokens.Dark.textPrimary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: maxWidth)
    }

    private func body16(_ text: String, maxWidth: CGFloat = 300) -> some View {
        Text(text)
            .font(.system(size: 16))
            .foregroundColor(Tokens.Dark.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: maxWidth)
    }

    private func footnote(_ text: String, maxWidth: CGFloat = .infinity) -> some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundColor(Tokens.Dark.textTertiary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: maxWidth)
    }
}

/// The verbatim privacy contract — S1.2 and S9 Privacy render this same card.
/// "Sees" uses brand green; "never sees" stays deliberately plain. No red anywhere.
struct PrivacyContractCard: View {
    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 12) {
                label("SEES", color: Tokens.green300)
                row("checkmark.circle", "Your focus status", green: true)
                row("checkmark.circle", "When you tap in and out", green: true)
                row("checkmark.circle", "When you unlock, and the reason if you share one", green: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 12) {
                label("NEVER SEES", color: Tokens.Dark.textTertiary)
                row("eye.slash", "Your screen", green: false)
                row("eye.slash", "Your apps or what's in them", green: false)
                row("eye.slash", "Your messages or location", green: false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 18)
            .overlay(alignment: .leading) {
                Rectangle().fill(Tokens.Dark.border).frame(width: 1)
            }
        }
        .padding(.vertical, 22)
        .padding(.horizontal, 20)
        .background(Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func label(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 13, weight: .semibold))
            .tracking(0.65)
            .foregroundColor(color)
    }

    private func row(_ icon: String, _ text: String, green: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundColor(green ? Tokens.green300 : Tokens.Dark.textTertiary)
                .padding(.top, 2)
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(green ? Tokens.Dark.textPrimary : Tokens.Dark.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// S1.1 — the arc the student will live with on S6: 150pt, 72%, check center.
private struct OnboardingArcIllustration: View {
    var body: some View {
        ZStack {
            Circle().stroke(Tokens.Dark.arcTrack, lineWidth: 9)
            Circle()
                .trim(from: 0, to: 0.72)
                .stroke(Tokens.Dark.arcFill, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: "checkmark.circle")
                .font(.system(size: 40, weight: .regular))
                .foregroundColor(Tokens.green300)
        }
        .frame(width: 150, height: 150)
    }
}

/// S1.3 — NFC gesture in simple shapes: the tag is the circle, the phone reaches it.
private struct TapInIllustration: View {
    var body: some View {
        ZStack {
            Circle()
                .stroke(Tokens.Dark.borderStrong, lineWidth: 2)
                .frame(width: 96, height: 96)
                .overlay(
                    Text("TAG")
                        .font(.system(size: 11, design: .monospaced))
                        .tracking(1.1)
                        .foregroundColor(Tokens.Dark.textTertiary)
                )
                .offset(x: -37, y: 37)
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Tokens.Dark.card)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Tokens.Dark.borderStrong, lineWidth: 1)
                )
                .frame(width: 64, height: 118)
                .rotationEffect(.degrees(18))
                .offset(x: 47, y: -26)
            Image(systemName: "wave.3.right")
                .font(.system(size: 22))
                .foregroundColor(Tokens.green300)
                .rotationEffect(.degrees(45))
                .offset(x: 16, y: 16)
        }
        .frame(width: 170, height: 170)
    }
}
