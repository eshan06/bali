import BaliOutbox
import SwiftUI

/// Waiting (C3; D1's Waiting artboard): the phone tapped its teacher's block before the Start —
/// armed (decision 5) — so nothing is shielded yet. While Bali is open it reads the truth every
/// 30 s (decision 6, the owner's ruling) and shields the moment it finds the Start; a read that
/// gave no answer is said, with Try again (rule 5). Back to home opens the regular Home over it,
/// its card saying the wait (#151). An armed tap's answer names no teacher, so neither does the
/// screen.
struct WaitingView: View {
    let phone: Phone

    /// D1's two groups — the ring and its words; the cards and Back to home — at least 24 pt
    /// apart, each at its own height: only the spacers give, the one above the ring first, so a
    /// card more still fits the smallest iPhone, Back to home included (#149; C4's layout).
    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    VStack(spacing: 32) {
                        Circle().inset(by: 8).stroke(Theme.arcTrack, lineWidth: 10)
                            .overlay(alignment: .top) {
                                Circle().fill(Theme.arc).frame(width: 10, height: 10).offset(y: 3)
                            }
                            .frame(width: 176, height: 176).accessibilityHidden(true)
                        VStack(spacing: 12) {
                            Text("Ready — waiting for your teacher").textStyle(.h1)
                            Text(
                                "You tapped your teacher's block before class started. Your phone locks when class starts, as long as Bali is open. No need to tap again."
                            )
                            .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        }
                        .multilineTextAlignment(.center)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 24)
                    VStack(spacing: 16) {
                        Card(padding: 16) {
                            HStack(spacing: 12) {
                                Image(systemName: "info.circle").font(.system(size: 20))
                                    .foregroundStyle(Theme.brand).frame(width: 40, height: 40)
                                    .background(Theme.sunken, in: .circle).accessibilityHidden(true)
                                Text("Keep Bali open so it can start right away.").textStyle(.body)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let words = phone.sync?.refusedTapWords ?? phone.sync?.meWords {
                            Retry(words: words, phone: phone)
                        }
                        Button("Back to home") { phone.open(.home) }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

#if DEBUG
    #Preview("Waiting") { RootView(phone: Phone(fixture: PreviewFixtures.all["waiting"]!)) }
    #Preview("Waiting — no answer") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["waitingError"]!))
    }
#endif
