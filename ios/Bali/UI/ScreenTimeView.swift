import BaliOutbox
import SwiftUI
import UIKit

/// The Screen Time grant (C1b), after the sign-in, until the permission reads approved: iOS's own
/// prompt, through the enforcer (`Phone.askScreenTime()`), and what stands in the way said in
/// place (rule 5) — the permission denied, at the prompt or in Settings, with the way back:
/// **Open Settings** first, the ask second, since iOS may not prompt again (#105's review); an ask
/// iOS could not make, with the way on. The reference onboarding sheet's last page, in D1's light
/// tokens; the words are `Permission.screenTimeWords` and `ScreenTimeAskError.words`. In Home's place
/// for a student not tapped in while a class of theirs is in session, its lesson shows under the
/// words, as Home would show it: the class's name over the answer card and the slide (M8b; the app
/// canvas's ScreenTimeAskQuestion and the intermediate states drawn beside it).
struct ScreenTimeView: View {
    let phone: Phone
    @Environment(\.openURL) private var openURL

    private var permission: Permission { phone.protection?.permission ?? .notDetermined }

    var body: some View {
        let words = permission.screenTimeWords
        // Home's lesson, for a student not tapped in: never in Waiting's place or Session over's.
        // Out of any session the lesson is a class `GET /v1/me` lists, so its heading always has a
        // name to show.
        let out = phone.sync?.standing == .out
        let (card, slide) = out ? (phone.card, phone.slideShown) : (nil, nil)
        let heading = card != nil || slide != nil ? phone.lessonHeading : nil
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 0) {
                    // With a lesson the groups sit the board's 24 apart at the least, none above them.
                    Spacer(minLength: heading == nil ? nil : 0)
                    VStack(spacing: 24) {
                        Image(systemName: "checkmark.shield")
                            .font(.system(size: 56, weight: .light)).foregroundStyle(Theme.brand)
                            .accessibilityHidden(true)
                        VStack(spacing: 12) {
                            Text("Let Bali pause apps during class").textStyle(.h1)
                            Text(words.body).textStyle(.bodyLg)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .frame(maxWidth: .infinity).multilineTextAlignment(.center)
                    Spacer(minLength: heading == nil ? nil : 24)
                    if let heading {
                        lesson(heading, card, slide)
                        Spacer(minLength: 24)
                    }
                    VStack(spacing: 12) {
                        if let settings = words.settings {
                            Button(settings) {
                                if let url = URL(string: UIApplication.openSettingsURLString) {
                                    openURL(url)
                                }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            AskScreenTime(phone: phone, label: words.ask)
                                .buttonStyle(SecondaryButtonStyle())
                        } else {
                            AskScreenTime(phone: phone, label: words.ask)
                                .buttonStyle(PrimaryButtonStyle())
                        }
                        if let failure = phone.askFailed?.words(permission) {
                            Text(failure).textStyle(.body)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Text("You can change this any time in Settings.")
                            .textStyle(.caption).foregroundStyle(Theme.textTertiary)
                            .frame(maxWidth: .infinity).multilineTextAlignment(.center)
                    }
                }
            }
        }
    }

    /// The lesson as the ask shows it: the class's name, its teacher and bell under it, as Unlocked's
    /// top line, since nothing else here says which class is asking; 12 under it the card, then the
    /// slide 24 under that, the question first (decision 11).
    private func lesson(
        _ heading: (title: String, subtitle: String), _ card: AnswerCard?, _ slide: SlideShown?
    ) -> some View {
        VStack(spacing: 12) {
            VStack(spacing: 2) {
                Text(heading.title).textStyle(.h3)
                Text(heading.subtitle).textStyle(.caption).foregroundStyle(Theme.textTertiary)
            }
            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 24) {
                if let card { AnswerCardView(card: card, phone: phone) }
                if let slide { SlideView(shown: slide, phone: phone) }
            }
        }
    }
}

/// The ask for the Screen Time permission, labelled `label`: iOS's own prompt, through the enforcer
/// (`Phone.askScreenTime()`), one at a time, busy while it is up — the grant screen's (C1b), and
/// Protection off's where the permission was never given on this phone (C5b).
struct AskScreenTime: View {
    let phone: Phone
    let label: String
    @State private var busy = false

    var body: some View {
        Button(busy ? "Asking…" : label) {
            Task {
                guard !busy else { return }
                busy = true
                await phone.askScreenTime()
                busy = false
            }
        }
        .disabled(busy)
    }
}

#if DEBUG
    #Preview("Screen Time") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["screenTime"]!))
    }
    #Preview("Screen Time — denied") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["screenTimeDenied"]!))
    }
    #Preview("Screen Time — the ask failed") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["screenTimeError"]!))
    }
#endif
