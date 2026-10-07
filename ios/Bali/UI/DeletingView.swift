import BaliOutbox
import SwiftUI

/// Delete account's own screen (C4b; `Deleting`), where the router sends the phone from the press on
/// Me's question to the end, over every other screen: the deletion under way, with nothing to press;
/// stopped with nothing deleted, why and Try again where another try can help, and Back; the account
/// deleted and its sign-in not yet, at a relaunch too, with Try again alone; and done, with OK, which
/// leaves to Sign in. Laid out as Sign in is: the mark, a title, a line under it, the way on at the
/// bottom. Every stop is said with its way on (rule 5). After an answer under 13 this run it is the
/// gap's fallback's (the approved Sign in & sign up design): the stop screen's title over the
/// deletion under way and over done, final for the run, its words on the gutter; a stop as Me's
/// says it, Try again its way on where another try can help — Back too while the shields are on,
/// to Focus — and Back where none can.
struct DeletingView: View {
    let phone: Phone

    var body: some View {
        let deleting = phone.deleting
        let young = phone.underThirteen
        // The fallback's stop has no Back of its own (the canvas: no Me to go back to), but has one
        // while the shields are on, as C4b's stops do: it leads to Focus and its Emergency Unlock,
        // which this screen covers (santa's round 1).
        let back = !young || phone.sync?.shieldedUntil(Date()) != nil
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 24) {
                        BaliMark(size: 72)
                        if let said = young ? deleting.saidUnderThirteen : deleting.said {
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
                        case .done where !young:
                            Button("OK") { phone.deleting.close() }.buttonStyle(PrimaryButtonStyle())
                        case .none, .asking, .busy, .done: EmptyView()
                        }
                        if back, case .stopped(_, _, retries: true) = deleting {
                            Button("Back") { phone.deleting.close() }
                                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                }
                // The fallback's on the gutter with no button under it too, as the stop screen's
                // words are; C4b's own as approved (Claude Review).
                .frame(maxWidth: young ? .infinity : nil, alignment: .leading)
            }
        }
        // The words change in place as the deletion stops or ends, with nothing to press until
        // then: said to VoiceOver as they come, as Leave's and the name's failures are (rule 5;
        // santa's round 1).
        .onChange(of: deleting) { _, now in
            if let said = young ? now.saidUnderThirteen : now.said {
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
    #Preview("Deleting under 13") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["deletingUnderThirteen"]!))
    }
#endif
