import BaliCore
import BaliOutbox
import SwiftUI

/// Join (C2b; D1's JoinCode and ConsentPreview artboards), where the router sends a phone that
/// knows it has no classes — and which Home's Join a class opens (C3): the student types their
/// class's code, sees what it opens before anything is joined — the class, its teacher, and what
/// that teacher sees, the intro's own list — and joins it. A look or a join that did not finish is
/// said under its button, which is the way on (rule 5). The rules are `Joining`'s (BaliOutbox),
/// the calls `Phone`'s.
struct JoinView: View {
    let phone: Phone
    /// The field's text, kept as a code is written (`Joining.type`) at every keystroke.
    @State private var text: String
    @FocusState private var typing: Bool

    /// A look-up or a join under way: the code, the buttons and the way back wait for its answer.
    private var busy: Bool { phone.joining.busy }

    init(phone: Phone) {
        self.phone = phone
        _text = State(initialValue: phone.joining.code)
    }

    var body: some View {
        ScreenScaffold {
            if let preview = phone.joining.preview { previewing(preview) } else { entry }
        }
    }

    /// The code (D1's JoinCode): back to Home when Home opened it (C3) — at the router's root, a
    /// phone in no class, there is nowhere to go back to.
    @ViewBuilder private var entry: some View {
        if phone.canGoBack { back { phone.back() } }
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Join a class").textStyle(.label).textCase(.uppercase)
                        .foregroundStyle(Theme.textTertiary)
                    Text("Enter your class code").textStyle(.h1)
                    Text(
                        "Six letters and numbers. Your teacher has it on their screen or the board."
                    )
                    .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Class code").textStyle(TextStyle(size: 13, line: 18, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary).accessibilityHidden(true)
                    TextField("Class code", text: $text, prompt: Text(""))
                        .font(.system(.title, design: .monospaced, weight: .medium)).tracking(10)
                        .multilineTextAlignment(.center).foregroundStyle(Theme.text)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .keyboardType(.asciiCapable).submitLabel(.continue)
                        // Fixed while its look-up is under way; the keyboard back once it is over.
                        .focused($typing).disabled(busy)
                        .onChange(of: busy) { _, busy in if !busy { typing = true } }
                        .onChange(of: text) { _, typed in
                            phone.joining.type(typed)
                            text = phone.joining.code
                        }
                        .onSubmit { if phone.joining.complete { run(phone.lookUp) } }
                        .frame(minHeight: 64)
                        .background(Theme.card, in: .rect(cornerRadius: Theme.Radius.md))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.md)
                                .stroke(typing ? Theme.arc : Theme.borderStrong, lineWidth: 2)
                        )
                        .shadow(color: Theme.shadow, radius: 1, y: 1)
                    Text("Codes never use 0, O, 1, I or L, so there's nothing to mix up.")
                        .textStyle(.caption).foregroundStyle(Theme.textTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize).screenWide()
        .onAppear { typing = true }
        action(busy ? "Checking…" : "Continue", enabled: phone.joining.complete, phone.lookUp)
        // The router's own Join — a student in no class — reaches no tab bar, so not Me's: signed
        // in with the wrong account, this is the way out (the riders).
        if phone.offersSignOut {
            SignOutButton(phone: phone).disabled(busy).frame(maxWidth: .infinity).padding(.top, 8)
        }
    }

    /// What the code opens, before anything is joined (D1's ConsentPreview): "your teacher" when
    /// their account has no name (A6). Once the join is sent there is no going back — it is made.
    @ViewBuilder private func previewing(_ preview: JoinCodePreviewResponse) -> some View {
        let teacher = preview.teacher.displayName ?? "your teacher"
        back { phone.joining.back() }
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(preview.alreadyEnrolled ? "You're in this class already" : "You're joining")
                        .textStyle(.label).textCase(.uppercase).foregroundStyle(Theme.textTertiary)
                    Text(preview.class.name).textStyle(.h2)
                    Text("with \(teacher)").textStyle(.body).foregroundStyle(Theme.textSecondary)
                }
                ConsentCard(title: "What \(teacher) sees")
                Text("This list never grows without asking you again.")
                    .textStyle(.caption).foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize).screenWide()
        action(
            busy ? "Joining…" : preview.alreadyEnrolled ? "Continue" : "Join \(preview.class.name)",
            enabled: true, phone.join)
        Button("Not my class") { phone.joining.back() }
            .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
            .foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, minHeight: 44)
            .padding(.top, 4).disabled(busy)
    }

    /// The page's primary action, busy while it runs, and under it why the last try did not
    /// finish: pressing it again is the way on (rule 5).
    @ViewBuilder private func action(
        _ title: String, enabled: Bool, _ call: @escaping @MainActor () async -> Void
    ) -> some View {
        Button(title) { run(call) }.buttonStyle(PrimaryButtonStyle()).disabled(busy || !enabled)
            .padding(.top, 16)
        if let failure = phone.joining.failure {
            Text(failure).textStyle(.body).frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 12)
        }
    }

    /// D1's back arrow: `action`, once nothing is under way.
    private func back(_ action: @escaping () -> Void) -> some View {
        BackButton(action: action).disabled(busy)
    }

    /// `call` — one at a time, `Phone`'s to see to, the screen busy meanwhile.
    private func run(_ call: @escaping @MainActor () async -> Void) { Task { await call() } }
}

/// What a teacher sees of a student in their class, and never sees — the intro's second page (C1b)
/// and the preview before joining (C2b): one list, so the two never say different things, drawn
/// as D1's ConsentPreview draws it. `title` heads what they see: "Sees", or "What Ms. Rivera sees".
struct ConsentCard: View {
    let title: String
    /// One column for both lists' icons, so every line starts where the others do.
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 24

    /// The whole of it — the grid's silence and last-seen time too (owner, 2026-09-27).
    static let sees = [
        "Your focus status: focused, unlocked, or Screen Time off",
        "If Bali stops hearing from your phone during class, and when it last did",
        "When you tap in, and when class ends for you",
        "When you unlock, and the reason if you share one",
        "If you leave this class",
    ]
    static let neverSees = [
        "Your screen, your apps, or what's in them", "Your messages or where you are",
    ]

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text(title).textStyle(.label).textCase(.uppercase).foregroundStyle(Theme.brand)
                ForEach(Self.sees, id: \.self) {
                    row("checkmark.circle", Theme.brand, $0, Theme.text)
                }
                Rectangle().fill(Theme.border).frame(height: 1).padding(.vertical, 4)
                Text("Never sees").textStyle(.label).textCase(.uppercase)
                    .foregroundStyle(Theme.textTertiary)
                ForEach(Self.neverSees, id: \.self) {
                    row("eye.slash", Theme.textTertiary, $0, Theme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func row(_ icon: String, _ tint: Color, _ text: String, _ ink: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon).foregroundStyle(tint).frame(width: iconWidth)
                .accessibilityHidden(true)
            Text(text).textStyle(.body).foregroundStyle(ink)
        }
    }
}

#if DEBUG
    #Preview("Join") { RootView(phone: Phone(fixture: PreviewFixtures.all["join"]!)) }
    #Preview("Join — the preview") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["joinPreview"]!))
    }
    #Preview("Join — no such class") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["joinError"]!))
    }
    #Preview("Join — from Home") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["joinFromHome"]!))
    }
#endif
