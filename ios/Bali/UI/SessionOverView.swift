import BaliOutbox
import SwiftUI

/// Session over (C5b; D1's SessionOver), where the router sends a phone whose session's bell has
/// rung by its own clock: the class that ended and when, and every app back once rule 3's check
/// found no shield on. It leaves by itself once a read says where the phone stands; Done leaves
/// sooner, to Home.
struct SessionOverView: View {
    let phone: Phone

    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 24) {
                    Spacer()
                    VStack(spacing: 16) {
                        Chip(kind: .ended, text: "Ended")
                        Text("Class is over").textStyle(.h1)
                        if let words = phone.sync?.sessionOverWords(phone.protection) {
                            Text(words).textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .multilineTextAlignment(.center)
                    Spacer()
                    Button("Done") { phone.closeSessionOver() }.buttonStyle(PrimaryButtonStyle())
                }
            }
        }
    }
}

#if DEBUG
    #Preview("Session over") { RootView(phone: Phone(fixture: PreviewFixtures.all["sessionOver"]!)) }
#endif
