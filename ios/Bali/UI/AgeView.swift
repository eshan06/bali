import BaliOutbox
import SwiftUI

/// The 13+ check (C7), the first screen on a first launch, before the intro: the birth month and
/// year, asked neutrally by the FTC's COPPA guidance — nothing here says 13, hints at the cutoff
/// or preselects an answer, so each menu starts empty and offers every month and a hundred years
/// (`Birth`). Continue answers once both are picked (`Phone.answerAge()`): 13 or older goes on to
/// the intro, and the check is never asked again; under 13 lands on `TooYoungView`. The rules are
/// `AgeCheck`'s and `Birth`'s (BaliOutbox); the look is the Sign in screen's, in D1's light tokens.
struct AgeView: View {
    let phone: Phone

    var body: some View {
        let today = Date()
        let picks = phone.birth
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 24) {
                        BaliMark(size: 72)
                        VStack(alignment: .leading, spacing: 12) {
                            Text("When were you born?").textStyle(.h1)
                            Text("Bali never saves or sends your birth month and year.")
                                .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            field("Month", picked: picks.month.map(Self.monthName)) {
                                ForEach(picks.months(at: today), id: \.self) { month in
                                    Button(Self.monthName(month)) { phone.birth.month = month }
                                }
                            }
                            field("Year", picked: picks.year.map { String($0) }) {
                                ForEach(picks.years(at: today), id: \.self) { year in
                                    Button(String(year)) { phone.birth.year = year }
                                }
                            }
                        }
                    }
                    Spacer()
                    Button("Continue") { phone.answerAge() }
                        .buttonStyle(PrimaryButtonStyle()).disabled(!picks.complete)
                }
            }
        }
    }

    /// A menu drawn as a field (D1's input look): `label` above, the pick or "Choose" inside,
    /// `items` in the menu. VoiceOver reads the label and the pick.
    private func field<Items: View>(
        _ label: String, picked: String?, @ViewBuilder items: () -> Items
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).textStyle(TextStyle(size: 13, line: 18, weight: .semibold))
                .foregroundStyle(Theme.textSecondary).accessibilityHidden(true)
            Menu(content: items) {
                HStack(spacing: 12) {
                    Text(picked ?? "Choose").textStyle(.bodyLg)
                        .foregroundStyle(picked == nil ? Theme.textTertiary : Theme.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                }
                .padding(.horizontal, 16).frame(maxWidth: .infinity, minHeight: 56)
                .background(Theme.card, in: .rect(cornerRadius: Theme.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.md).stroke(Theme.borderStrong)
                )
                .shadow(color: Theme.shadow, radius: 1, y: 1)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityValue(picked ?? "Nothing picked")
        }
    }

    /// The month's name in the phone's language.
    private static func monthName(_ month: Int) -> String {
        Calendar.current.monthSymbols[month - 1]
    }
}

/// The stop screen (C7) an answer under 13 gets: kind, and final for the run — no way back to the
/// question until the app is reopened, and nothing kept of the answer anywhere (the owner's
/// ruling, 2026-10-05).
struct TooYoungView: View {
    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 24) {
                    Spacer()
                    BaliMark(size: 72)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Bali isn't available for you yet").textStyle(.h1)
                        Text("Ask your teacher how to take part in class without the app.")
                            .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }
            }
        }
    }
}

#if DEBUG
    #Preview("Age") { RootView(phone: Phone(fixture: PreviewFixtures.all["age"]!)) }
    #Preview("Age — picked") { RootView(phone: Phone(fixture: PreviewFixtures.all["agePicked"]!)) }
    #Preview("Too young") { RootView(phone: Phone(fixture: PreviewFixtures.all["tooYoung"]!)) }
#endif
