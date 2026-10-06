import BaliOutbox
import SwiftUI
import UIKit

/// Focus (C4; D1's Focus, FocusFinal and FocusOffline), where the router sends a phone whose
/// shields are on by the enforcer's rule: the class, the countdown by the phone's own clock to when
/// they come off, and Emergency Unlock. It claims only what rule 3's check verified — no countdown
/// ticks over nothing shielded — in `FocusWords`' words (BaliOutbox, tested on Linux).
struct FocusView: View {
    let phone: Phone
    @Environment(\.openURL) private var openURL

    var body: some View {
        let (sync, protection, signedIn) = (phone.sync, phone.protection, phone.signedIn)
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let sync {
                page(FocusWords(sync, protection, now: context.date, signedIn: signedIn))
            }
        }
    }

    /// D1's three groups — the class; the state, the ring and the claim; and Emergency Unlock —
    /// at least D1's 24 pt apart, each at its own height: only the spacers give, since a group
    /// offered less than its own height, the ring's fixed, would cut its lines instead.
    private func page(_ focus: FocusWords) -> some View {
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 0) {
                    VStack(spacing: 2) {
                        Text(focus.title).textStyle(.h3)
                        Text(focus.subtitle).textStyle(.caption).foregroundStyle(Theme.textTertiary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    middle(focus).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    lower(focus).fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.center)
            }
        }
    }

    /// The state as chips — the claim's, never the standing's; side by side, or one above the
    /// other once the text size outgrows the row — then the ring and the claim.
    private func middle(_ focus: FocusWords) -> some View {
        VStack(spacing: 20) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { chips(focus) }
                VStack(spacing: 8) { chips(focus) }
            }
            if focus.claim == .paused { Ring(focus: focus) }
            VStack(spacing: 8) {
                if focus.final, focus.claim == .paused {
                    Text("Almost done").textStyle(.h3).foregroundStyle(Theme.brand)
                }
                Text(focus.claimWords).textStyle(.body).foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 12)
            }
            // D1's ProtectionOff draws the way back as the primary action.
            if focus.claim == .screenTimeOff {
                Button("Turn on Screen Time") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    @ViewBuilder private func chips(_ focus: FocusWords) -> some View {
        switch focus.claim {
        case .paused: Chip(kind: .focused, text: "Focused")
        case .screenTimeOff: Chip(kind: .protectionOff, text: "Screen Time off")
        case .unverified: EmptyView()
        }
        if focus.offline != nil { Chip(kind: .notIn, icon: "wifi.slash", text: "No connection") }
    }

    /// Why an unlock gave way (C5a); why nothing reaches the teacher; offline, D1's card; a wake
    /// iOS refused; then Emergency Unlock and its line.
    private func lower(_ focus: FocusWords) -> some View {
        VStack(spacing: 24) {
            ForEach([focus.superseded, focus.stalled].compactMap { $0 }, id: \.self) { words in
                Card { Text(words).textStyle(.body).frame(maxWidth: .infinity, alignment: .leading) }
                    .multilineTextAlignment(.leading)
            }
            if let offline = focus.offline {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("While offline").textStyle(.label).textCase(.uppercase)
                            .foregroundStyle(Theme.textTertiary)
                        Text(offline).textStyle(.body)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .multilineTextAlignment(.leading)
            }
            if let note = focus.unscheduled {
                Text(note).textStyle(.caption).foregroundStyle(Theme.textSecondary)
            }
            EmergencyUnlock(phone: phone, caption: focus.caption, paused: focus.claim == .paused)
        }
    }
}

/// Emergency Unlock and the line under it — or why the last press did not go through, which
/// VoiceOver, left on the control, is told as well (rule 5): the Focus screen's, and Home's over
/// the last run's shields where the phone stood unread (B6b). `paused`: the check verified the
/// shields on, all a failure may say of them.
struct EmergencyUnlock: View {
    let phone: Phone
    let caption: String
    let paused: Bool
    @State private var failed: UnlockFailure?

    var body: some View {
        VStack(spacing: 12) {
            UnlockControl {
                Task {
                    let failure = await phone.emergencyUnlock()
                    failed = failure
                    if let words = failure?.words(paused: paused) {
                        AccessibilityNotification.Announcement(words).post()
                    }
                }
            }
            Text(failed?.words(paused: paused) ?? caption).textStyle(.caption)
                .foregroundStyle(failed == nil ? Theme.textTertiary : Theme.text)
        }
    }
}

/// D1's ring: the time left as an arc from the top, clockwise, over the mark's track — lighter and
/// thicker in the last two minutes, never red — and the digits inside, which stop growing at the
/// largest text size short of the accessibility ones: 64 pt already, and inside a ring that does
/// not grow; VoiceOver reads them whole. It draws in once, over 600 ms: the design system's one
/// sanctioned motion, none under Reduce Motion.
private struct Ring: View {
    let focus: FocusWords
    @State private var drawn = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(Theme.markTrack, lineWidth: 12)
            Circle().trim(from: 0, to: drawn ? focus.fraction : 0)
                .stroke(
                    focus.final ? Theme.arcFinal : Theme.arc,
                    style: StrokeStyle(lineWidth: focus.final ? 16 : 12, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 4) {
                Text(focus.countdown).textStyle(.countdown)
                Text(focus.until).textStyle(.body).foregroundStyle(Theme.textSecondary)
            }
            .lineLimit(1).minimumScaleFactor(0.5).padding(.horizontal, 20)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
        .padding(12).frame(width: 240, height: 240)
        .accessibilityElement(children: .ignore)
        // Spoken as a length of time — "1 minute, 52 seconds" — never as a clock's "one fifty-two".
        .accessibilityLabel(
            Duration.seconds(focus.secondsLeft)
                .formatted(.units(allowed: [.hours, .minutes, .seconds], width: .wide))
                + " left, \(focus.until)")
        .accessibilityAddTraits(.updatesFrequently)
        .onAppear {
            withAnimation(reduceMotion ? nil : .timingCurve(0.2, 0, 0, 1, duration: 0.6)) {
                drawn = true
            }
        }
    }
}

/// D1's Emergency Unlock: warm orange and round — never red — always there while the shields are.
/// Held for a second it unlocks, a finger drifting up to a touch target's width; let go early,
/// nothing happens and its progress springs back (the design system's spring) — under Reduce
/// Motion a still pressed look instead, never a ring that looks done a second early. VoiceOver's
/// own action unlocks in one step, and Voice Control knows it by the words on it too.
struct UnlockControl: View {
    let unlock: () -> Void
    @State private var holding = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let look = Chip.Kind.unlocked.look
        HStack(spacing: 12) {
            Image(systemName: "lock.open").font(.system(size: 20, weight: .semibold))
                .frame(width: 44, height: 44).background(Theme.card, in: .circle)
                .overlay {
                    Circle().trim(from: 0, to: holding && !reduceMotion ? 1 : 0)
                        .stroke(look.ink, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            UnlockWords().frame(maxWidth: .infinity).padding(.trailing, 12)
        }
        .multilineTextAlignment(.center).foregroundStyle(look.ink)
        .padding(10).frame(minHeight: 64)
        .background(look.fill, in: .capsule)
        .opacity(holding && reduceMotion ? 0.7 : 1)
        .onLongPressGesture(minimumDuration: 1, maximumDistance: 44, perform: unlock) { pressing in
            let motion: Animation =
                pressing ? .linear(duration: 1) : .timingCurve(0.34, 1.3, 0.64, 1, duration: 0.3)
            withAnimation(reduceMotion ? nil : motion) { holding = pressing }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Emergency Unlock. Your teacher will see it.")
        .accessibilityInputLabels(["Hold to unlock", "Emergency Unlock"])
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { unlock() }
    }
}

/// Emergency Unlock's words, D1's on two lines (D2i): the action in a button's label, who sees it
/// under it, each one line at the default text size, where the one sentence wrapped mid-phrase.
/// Each line keeps its whole height: offered a share of the pill's, the first was cut short at the
/// largest text size.
struct UnlockWords: View {
    var body: some View {
        VStack(spacing: 0) {
            Text("Hold to unlock").textStyle(.button).fixedSize(horizontal: false, vertical: true)
            Text("Your teacher will see it").textStyle(.body)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#if DEBUG
    #Preview("Focus") { RootView(phone: Phone(fixture: PreviewFixtures.all["focus"]!)) }
    #Preview("Focus — the last two minutes") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["focusFinal"]!))
    }
    #Preview("Focus — offline") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["focusOffline"]!))
    }
#endif
