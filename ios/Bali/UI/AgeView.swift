import AuthenticationServices
import BaliOutbox
import SwiftUI

/// The 13+ check (C7), in Sign in's place at every Sign up (the approved Sign in & sign up design)
/// — and first after a sign-in into an account that has not passed it on this phone, the gap's
/// fallback: the birth month and year, asked neutrally by the
/// FTC's COPPA guidance — nothing here says 13, hints at the cutoff or preselects an answer, so
/// each menu starts empty and offers every month and a hundred years (`Birth`, Gregorian whatever
/// calendar the phone shows, the names in its language). Continue answers once both are picked
/// (`Phone.answerAge(through:)`): 13 or older goes on at once to the intro, or to the sign-up page,
/// Continue saying Signing up… and taking no press while it opens; signed in it carries on, the
/// account never asked again on this phone. Under 13 lands on `TooYoungView`, or signed in on the
/// account's deletion (`DeletingView`). The rules are `AgeCheck`'s and `Birth`'s
/// (BaliOutbox); the look is the Sign in screen's, in D1's light tokens.
struct AgeView: View {
    let phone: Phone
    @Environment(\.webAuthenticationSession) private var browser
    /// What the question last showed while the router showed it: once the router has gone on, it
    /// holds still as it waits for Bali or leaves (the motion spec); the phone lets the picks go.
    @State private var still = Asked()

    /// What the question shows of the phone: the picks, and whether a page opens from Continue.
    private struct Asked: Equatable {
        var birth = Birth()
        var busy = false
    }

    var body: some View {
        let today = Date()
        let live = Asked(birth: phone.birth, busy: phone.signingIn)
        let asking = phone.shown.screen == .age
        let shows = asking ? live : still
        let picks = shows.birth
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
                            field("Month", picked: picks.month.map { Birth.monthName($0) }) {
                                ForEach(picks.months(at: today), id: \.self) { month in
                                    Button(Birth.monthName(month)) { phone.birth.month = month }
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
                    // Answered signed in, it only waits for Bali or leaves: Continue dims, as busy.
                    Button(shows.busy ? "Signing up…" : "Continue") {
                        Task { await phone.answerAge(through: browser.hostedUI) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!picks.complete || shows.busy || (!asking && phone.signedIn == true))
                }
            }
        }
        .onChange(of: live, initial: true) { _, live in if asking { still = live } }
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
}

/// The stop screen (C7) an answer under 13 gets, in Sign in's place: kind, and final for the run —
/// no way back to the question or to Sign in until the app is reopened, and nothing kept of the
/// answer anywhere (the owner's ruling, 2026-10-05).
struct TooYoungView: View {
    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 24) {
                    Spacer()
                    BaliMark(size: 72)
                    VStack(alignment: .leading, spacing: 12) {
                        Text(AgeCheck.notYet).textStyle(.h1)
                        Text(AgeCheck.askTeacher)
                            .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                }
                // On the gutter, as Sign in's words are: never centred as a block narrower than it.
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

#if DEBUG
    #Preview("Age") { RootView(phone: Phone(fixture: PreviewFixtures.all["age"]!)) }
    #Preview("Age — picked") { RootView(phone: Phone(fixture: PreviewFixtures.all["agePicked"]!)) }
    #Preview("Too young") { RootView(phone: Phone(fixture: PreviewFixtures.all["tooYoung"]!)) }
    #Preview("Age — after a sign-in") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["ageAfterSignIn"]!))
    }
#endif
