import BaliOutbox
import SwiftUI

/// Delete account's own screen (C4b; `Deleting`), where the router sends the phone from the press on
/// Me's question to the end, over every other screen: the deletion under way, with nothing to press;
/// stopped with nothing deleted, why and Try again where another try can help, and Back; the account
/// deleted and its sign-in not yet, at a relaunch too, with Try again alone; and done, with OK, which
/// leaves to Sign in. Laid out as Sign in is: the mark, a title, a line under it, the way on at the
/// bottom. Every stop is said with its way on (rule 5).
struct DeletingView: View {
    let phone: Phone

    var body: some View {
        let deleting = phone.deleting
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 24) {
                        BaliMark(size: 72)
                        if let said = deleting.said {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(said.title).textStyle(.h1).accessibilityAddTraits(.isHeader)
                                Text(said.body).textStyle(.bodyLg)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                    Spacer()
                    VStack(spacing: 4) {
                        switch deleting {
                        case .stopped(_, _, retries: true), .pending:
                            Button("Try again") { Task { await phone.deleteAccount() } }
                                .buttonStyle(PrimaryButtonStyle())
                        case .stopped(_, _, retries: false):
                            Button("Back") { phone.deleting.close() }
                                .buttonStyle(PrimaryButtonStyle())
                        case .done:
                            Button("OK") { phone.deleting.close() }.buttonStyle(PrimaryButtonStyle())
                        case .none, .asking, .busy: EmptyView()
                        }
                        if case .stopped(_, _, retries: true) = deleting {
                            Button("Back") { phone.deleting.close() }
                                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                }
            }
        }
        // The words change in place as the deletion stops or ends, with nothing to press until
        // then: said to VoiceOver as they come, as Leave's and the name's failures are (rule 5;
        // santa's round 1).
        .onChange(of: deleting) { _, now in
            if let said = now.said {
                AccessibilityNotification.Announcement("\(said.title). \(said.body)").post()
            }
        }
    }
}

#if DEBUG
    #Preview("Deleting") { RootView(phone: Phone(fixture: PreviewFixtures.all["deleting"]!)) }
    #Preview("Deleting — can't reach the server") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["deletingNotDeleted"]!))
    }
    #Preview("Deleting — the sign-in still to go") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["deletingPending"]!))
    }
    #Preview("Deleting — done") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["deletingDone"]!))
    }
#endif
