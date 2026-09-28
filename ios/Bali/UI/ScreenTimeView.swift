import BaliOutbox
import SwiftUI
import UIKit

/// The Screen Time grant (C1b), after the sign-in, until the permission reads approved: iOS's own
/// prompt, through the enforcer (`Phone.askScreenTime()`), and what stands in the way said in
/// place (rule 5) — the permission denied, at the prompt or in Settings, with the way back:
/// **Open Settings** first, the ask second, since iOS may not prompt again (#105's review); an ask
/// iOS could not make, with the way on. The reference onboarding sheet's last page, in D1's light
/// tokens; the words are `Permission.screenTimeWords` and `ScreenTimeAskError.words`.
struct ScreenTimeView: View {
    let phone: Phone
    @Environment(\.openURL) private var openURL
    @State private var busy = false

    private var permission: Permission { phone.protection?.permission ?? .notDetermined }

    var body: some View {
        let words = permission.screenTimeWords
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 0) {
                    Spacer()
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
                    Spacer()
                    VStack(spacing: 12) {
                        if let settings = words.settings {
                            Button(settings) {
                                if let url = URL(string: UIApplication.openSettingsURLString) {
                                    openURL(url)
                                }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            askButton(words.ask).buttonStyle(SecondaryButtonStyle())
                        } else {
                            askButton(words.ask).buttonStyle(PrimaryButtonStyle())
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

    /// The ask's button, labelled `label` — busy while iOS's prompt is up.
    private func askButton(_ label: String) -> some View {
        Button(busy ? "Asking…" : label) { Task { await ask() } }.disabled(busy)
    }

    /// One ask: iOS's prompt, the button busy meanwhile.
    private func ask() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await phone.askScreenTime()
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
