import BaliOutbox
import SwiftUI
import UIKit

/// Protection off (C5b; D1's ProtectionOff), where the router sends a phone in a running session
/// whose Screen Time permission is off, or was: what happened, that the teacher sees it, and the
/// way back — Screen Time on again, in Settings or at iOS's prompt, then the block tapped again. A
/// refocus out of protection off is refused (A2), so there is no way back but the re-tap. In
/// `ProtectionOffWords`' words (BaliOutbox, tested on Linux).
struct ProtectionOffView: View {
    let phone: Phone
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let sync = phone.sync, let words = ProtectionOffWords(sync, phone.protection) {
            page(words)
        }
    }

    /// D1's groups — the class; the state; the steps and the way on — at least 24 pt apart, each
    /// at its own height: only the spacers give (C4's layout).
    private func page(_ words: ProtectionOffWords) -> some View {
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
                        Chip(kind: .protectionOff, text: "Screen Time off")
                        Text(words.headline).textStyle(.h1)
                        Text(words.body).textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        if let refused = words.refused { Text(refused).textStyle(.body) }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    VStack(spacing: 24) {
                        // What Unlocked or Home would have said, kept here (C5b's review).
                        if !words.problems.isEmpty {
                            Retry(words: words.problems.joined(separator: "\n"), phone: phone)
                                .multilineTextAlignment(.leading)
                        }
                        steps(backOn: words.way == .retap)
                        action(words.way)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.center)
            }
        }
    }

    /// D1's card: the two steps back to class, the first ticked off once Screen Time reads on.
    private func steps(backOn: Bool) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Text("To rejoin class").textStyle(.label).textCase(.uppercase)
                    .foregroundStyle(Theme.textTertiary)
                step("1", "Turn Screen Time back on for Bali", done: backOn)
                step("2", "Tap your teacher's block again", done: false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .multilineTextAlignment(.leading)
    }

    /// A step: its number in D1's 28-pt sunken circle — a tick once done — and what to do.
    private func step(_ number: String, _ text: String, done: Bool) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.sunken)
                if done {
                    Image(systemName: "checkmark").foregroundStyle(Theme.brand)
                        .accessibilityLabel("Done")
                } else {
                    Text(number)
                }
            }
            .textStyle(TextStyle(size: 14, line: 20, weight: .semibold))
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge).frame(width: 28, height: 28)
            Text(text).textStyle(.body)
        }
        .accessibilityElement(children: .combine)
    }

    /// D1's primary action, Turn on Screen Time — in Settings, or at iOS's own prompt where it was
    /// never given here, an ask that did not finish said under it — or, once it reads on, the
    /// block's scan; none while the check has not read it yet. Then D1's line.
    @ViewBuilder private func action(_ way: ProtectionOffWords.Way) -> some View {
        VStack(spacing: 12) {
            switch way {
            case .retap: TapIn(phone: phone)
            case .ask:
                AskScreenTime(phone: phone, label: "Turn on Screen Time")
                    .buttonStyle(PrimaryButtonStyle())
                if let failure = phone.askFailed?.words(.notDetermined) {
                    Text(failure).textStyle(.body)
                }
            case .settings:
                Button("Turn on Screen Time") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(PrimaryButtonStyle())
            case .checking: EmptyView()
            }
            Text("It's always your call. Bali only makes sure your teacher sees the truth.")
                .textStyle(.caption).foregroundStyle(Theme.textTertiary)
        }
    }
}

#if DEBUG
    #Preview("Protection off") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["protectionOff"]!))
    }
    #Preview("Protection off — Screen Time back on") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["protectionOffBackOn"]!))
    }
#endif
