import BaliCore
import BaliOutbox
import SwiftUI

/// Unlocked (C5a; D1's Unlocked, and the owner's rulings of 2026-09-30, C5c), where the router
/// sends a phone standing unlocked in a running session: the class, what is open until the bell,
/// the reason the student may give and change — the check on the one on record, a light haptic as
/// one is picked — and the ways on: Home first, the apps still open, then Lock my apps again, or
/// where protection off was reported here, a re-tap. In `UnlockedWords`' words (BaliOutbox,
/// tested on Linux).
struct UnlockedView: View {
    let phone: Phone
    /// Why Lock my apps again did not go through (rule 5).
    @State private var notBack: String?

    var body: some View {
        if let sync = phone.sync, let words = UnlockedWords(sync) {
            page(words)
        } else {
            // The router shows this only where the words can be built; never a blank all the same
            // (#121's review).
            HomeView(phone: phone)
        }
    }

    /// D1's groups — the class; the state; the reason and the ways on — at least 24 pt apart,
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
                        ways(words)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.center)
            }
        }
    }

    /// D1's card: why, optional — the three, the check on the reason on record, or on the one
    /// picked while it is on its way; what a pick does, or why the last did not go.
    private func reasons(_ picker: UnlockedWords.Picker) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text("Want to say why? Optional").textStyle(.label).textCase(.uppercase)
                    .foregroundStyle(Theme.textTertiary)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { choices(picker) }
                    VStack(spacing: 8) { choices(picker) }
                }
                Text(phone.pickFailed ?? picker.caption).textStyle(.caption)
                    .foregroundStyle(phone.pickFailed == nil ? Theme.textTertiary : Theme.text)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .multilineTextAlignment(.leading)
        // The light tap of an iOS control, as a pick is pressed (the owner's ruling).
        .sensoryFeedback(.selection, trigger: phone.picking) { _, picked in picked != nil }
    }

    private func choices(_ picker: UnlockedWords.Picker) -> some View {
        let open = if case .open = picker { true } else { false }
        return ForEach(UnlockReason.allCases, id: \.self) { reason in
            let chosen = (phone.picking ?? picker.chosen) == reason
            Button {
                // The one chosen, chosen again, changes nothing: a selected control's press —
                // unless the last pick failed, its answer lost: the server may hold another.
                guard !chosen || phone.pickFailed != nil else { return }
                Task {
                    await phone.pick(reason)
                    if let failed = phone.pickFailed { announce(failed) }
                }
            } label: {
                ReasonLabel(reason: reason, chosen: chosen)
            }
            .buttonStyle(ReasonStyle(chosen: chosen))
            // Never tappable where a pick cannot act: the unlock on its way, or a pick on its way.
            .disabled(!open || phone.picking != nil && !chosen)
            .accessibilityAddTraits(chosen ? .isSelected : [])
        }
    }

    /// What did not go through, told to VoiceOver too: its focus stays on the button (rule 5).
    private func announce(_ words: String) { AccessibilityNotification.Announcement(words).post() }

    /// Home, the primary way on, the apps still open (the owner's ruling); then Lock my apps again
    /// — or, where protection off was reported here or the refocus was refused, the block's scan —
    /// and D1's line.
    private func ways(_ words: UnlockedWords) -> some View {
        VStack(spacing: 12) {
            Button {
                phone.open(.home)
            } label: {
                Label("Go to Home", systemImage: "house")
            }
            .buttonStyle(PrimaryButtonStyle())
            if let retap = words.retap {
                VStack(spacing: 8) {
                    Text(retap).textStyle(.body)
                    TapIn(phone: phone, primary: false)
                }
                .padding(.top, 8)
            } else {
                Button("Lock my apps again") {
                    Task {
                        notBack = await phone.backToFocus()
                        if let notBack { announce(notBack) }
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
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
/// the primary action, or second to Unlocked's Home (C5c) — and why the last scan recorded no tap,
/// told to VoiceOver too (rule 5).
struct TapIn: View {
    let phone: Phone
    var primary = true

    var body: some View {
        let scan = Button {
            Task {
                await phone.tapIn()
                if let failed = phone.tapFailed {
                    AccessibilityNotification.Announcement(failed).post()
                }
            }
        } label: {
            Label(phone.scanning ? "Scanning…" : "Tap in", systemImage: "wave.3.right")
        }
        Group {
            if primary {
                scan.buttonStyle(PrimaryButtonStyle())
            } else {
                scan.buttonStyle(SecondaryButtonStyle())
            }
        }
        .disabled(phone.scanning)
        if let failed = phone.tapFailed { Text(failed).textStyle(.body) }
    }
}

/// A reason as its button reads, the check before it where chosen (the owner's ruling) — as wide
/// as the widest with a check, so the three sit side by side only while all fit whole (D1's
/// thirds).
private struct ReasonLabel: View {
    let reason: UnlockReason
    let chosen: Bool
    @ScaledMetric(relativeTo: .body) private var check: CGFloat = 12

    var body: some View {
        ZStack {
            ForEach(UnlockReason.allCases, id: \.self) {
                text($0, check: true).hidden().accessibilityHidden(true)
            }
            text(reason, check: chosen)
        }
    }

    private func text(_ reason: UnlockReason, check: Bool) -> some View {
        HStack(spacing: 4) {
            if check {
                Image(systemName: "checkmark").font(.system(size: self.check, weight: .bold))
                    .accessibilityHidden(true)
            }
            Text(reason.rawValue.capitalized)
        }
    }
}

/// D1's reason button: 48 pt tall, radius 10, the page's fill in a hairline — pressed, sunken. D1
/// draws none chosen: the one chosen takes the brand's fill, the others dimmed while none can be
/// picked.
private struct ReasonStyle: ButtonStyle {
    let chosen: Bool
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
            .foregroundStyle(chosen ? .white : Theme.text).padding(.horizontal, 4)
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
    #Preview("Unlocked — the reason changed") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["unlockedChanged"]!))
    }
#endif
