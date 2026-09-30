import BaliCore
import BaliOutbox
import SwiftUI

/// Unlocked (C5a; D1's Unlocked), where the router sends a phone standing unlocked in a running
/// session: the class, what is open until the bell, the reason the student may give — sent with
/// the unlock, whose send waits a moment for it and never longer (`SyncEngine.reasonHold`) — and
/// the way back: Back to focus, or where protection off was reported here, a re-tap. In
/// `UnlockedWords`' words (BaliOutbox, tested on Linux).
struct UnlockedView: View {
    let phone: Phone
    /// The reason this screen gave or saw given, and whether it offered the three: what the card
    /// says once the unlock has gone, and the phone's queue no longer holds it.
    @State private var given: UnlockReason?
    @State private var asked = false
    /// Why the last reason, or Back to focus, did not go through (rule 5).
    @State private var failed: String?
    @State private var notBack: String?
    /// A reason on its way to the engine: one at a time, so the card shows the one kept (#121's
    /// review).
    @State private var explaining = false

    var body: some View {
        if let sync = phone.sync, let words = UnlockedWords(sync, given: given, asked: asked) {
            page(words).onChange(of: words.picker, initial: true) { _, picker in
                switch picker {
                case .given(let reason)?: given = reason
                case .open?, .late?: asked = true
                case nil: break
                }
            }
        } else {
            // The router shows this only where the words can be built; never a blank all the same
            // (#121's review).
            HomeView(phone: phone)
        }
    }

    /// D1's groups — the class; the state; the reason and the way back — at least 24 pt apart,
    /// each at its own height: only the spacers give (C4's layout).
    private func page(_ words: UnlockedWords) -> some View {
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 0) {
                    VStack(spacing: 2) {
                        Text(words.title).textStyle(.h3)
                        Text(words.subtitle).textStyle(.caption).foregroundStyle(Theme.textTertiary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    VStack(spacing: 16) {
                        Chip(kind: .unlocked, text: "Unlocked")
                        Text("You're unlocked").textStyle(.h1)
                        Text(words.body).textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    VStack(spacing: 24) {
                        if let stuck = words.stuck { Retry(words: stuck, phone: phone) }
                        if let picker = words.picker { reasons(picker) }
                        back(words)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.center)
            }
        }
    }

    /// D1's card: why, optional — the three while one can still go with the unlock, then the one
    /// given, or too late.
    private func reasons(_ picker: UnlockedWords.Picker) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text("Want to say why? Optional").textStyle(.label).textCase(.uppercase)
                    .foregroundStyle(Theme.textTertiary)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { choices(picker) }
                    VStack(spacing: 8) { choices(picker) }
                }
                // Too late, a failed try's words give way: there is nothing left to try.
                Text(
                    picker == .late
                        ? UnlockedWords.late
                        : failed ?? "Your teacher sees the reason with your unlock."
                )
                .textStyle(.caption)
                .foregroundStyle(failed == nil || picker == .late ? Theme.textTertiary : Theme.text)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .multilineTextAlignment(.leading)
    }

    private func choices(_ picker: UnlockedWords.Picker) -> some View {
        ForEach(UnlockReason.allCases, id: \.self) { reason in
            let chosen = picker == .given(reason)
            Button {
                // A second tap while the first is on its way: the first stands, as the engine
                // keeps it — never the card showing one reason and the record another.
                guard !explaining, given == nil else { return }
                explaining = true
                Task {
                    let words = await phone.explain(reason)
                    explaining = false
                    failed = words
                    if let words { announce(words) } else { given = reason }
                }
            } label: {
                // As wide as the widest: side by side only while all three fit whole (D1's thirds).
                ZStack {
                    ForEach(UnlockReason.allCases, id: \.self) {
                        Text($0.rawValue.capitalized).hidden().accessibilityHidden(true)
                    }
                    Text(reason.rawValue.capitalized)
                }
            }
            .buttonStyle(ReasonStyle(chosen: chosen)).disabled(picker != .open)
            .accessibilityAddTraits(chosen ? .isSelected : [])
        }
    }

    /// What did not go through, told to VoiceOver too: its focus stays on the button (rule 5).
    private func announce(_ words: String) { AccessibilityNotification.Announcement(words).post() }

    /// Back to focus — or, where protection off was reported here or Back to focus was refused, the
    /// block's scan — and D1's line.
    private func back(_ words: UnlockedWords) -> some View {
        VStack(spacing: 12) {
            if let retap = words.retap {
                Text(retap).textStyle(.body)
                TapIn(phone: phone)
            } else {
                Button("Back to focus") {
                    Task {
                        notBack = await phone.backToFocus()
                        if let notBack { announce(notBack) }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                if let notBack { Text(notBack).textStyle(.body) }
            }
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "checkmark.icloud").accessibilityHidden(true)
                Text("Saved on your phone first — it reaches your teacher as soon as there's signal.")
            }
            .textStyle(.caption).foregroundStyle(Theme.textTertiary).padding(.horizontal, 8)
            .multilineTextAlignment(.leading)
        }
    }
}

/// Tap in, the block's scan (`Phone.tapIn`), where a re-tap is the way back to focus (C5a, C5b) —
/// and why the last scan recorded no tap, told to VoiceOver too (rule 5).
struct TapIn: View {
    let phone: Phone

    var body: some View {
        Button {
            Task {
                await phone.tapIn()
                if let failed = phone.tapFailed {
                    AccessibilityNotification.Announcement(failed).post()
                }
            }
        } label: {
            Label(phone.scanning ? "Scanning…" : "Tap in", systemImage: "wave.3.right")
        }
        .buttonStyle(PrimaryButtonStyle()).disabled(phone.scanning)
        if let failed = phone.tapFailed { Text(failed).textStyle(.body) }
    }
}

/// D1's reason button: 48 pt tall, radius 10, the page's fill in a hairline — pressed, sunken. D1
/// draws none given: the one given takes the brand's fill, the others dimmed once one can no longer go.
private struct ReasonStyle: ButtonStyle {
    let chosen: Bool
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
            .foregroundStyle(chosen ? .white : Theme.text).padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                chosen ? Theme.brand : configuration.isPressed ? Theme.sunken : Theme.page,
                in: .rect(cornerRadius: Theme.Radius.sm)
            )
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).stroke(Theme.border))
            .opacity(enabled || chosen ? 1 : 0.6)
    }
}

#if DEBUG
    #Preview("Unlocked") { RootView(phone: Phone(fixture: PreviewFixtures.all["unlocked"]!)) }
    #Preview("Unlocked — a reason given") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["unlockedReason"]!))
    }
#endif
