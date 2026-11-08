import BaliOutbox
import SwiftUI

/// A teacher's account (the owner, 2026-11-07; the Sign in & sign up canvas's Teacher boards,
/// intermediate states of sign-in): the app is the students', so it says so and points to the
/// portal, this build's `BaliPortalURL` (`PolicyLinks.portal`), opened in Safari, its address said
/// under the link. Sign out, Me's, is the other way on, held while an Emergency Unlock is unsent
/// (`SignOutButton`). Laid out as Sign in is, scrolling once the phone's text size outgrows it.
struct TeacherAccountView: View {
    let phone: Phone

    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer()
                    VStack(alignment: .leading, spacing: 24) {
                        BaliMark(size: 72)
                        VStack(alignment: .leading, spacing: 12) {
                            Text("You're signed in as a teacher").textStyle(.h1)
                                .accessibilityAddTraits(.isHeader)
                            Text("This app is for students. Teachers run their classes on the portal.")
                                .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    Spacer()
                    VStack(spacing: 12) {
                        if let portal = PolicyLinks.portal {
                            Link("Open the portal", destination: portal)
                                .buttonStyle(PrimaryButtonStyle())
                            Text(portal.host() ?? portal.absoluteString)
                                .textStyle(.caption).foregroundStyle(Theme.textTertiary)
                                .frame(maxWidth: .infinity).multilineTextAlignment(.center)
                        }
                        SignOutButton(phone: phone).frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }
}

#if DEBUG
    #Preview("A teacher's account") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["teacher"]!))
    }
    #Preview("A teacher's account — Sign out held") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["teacherSignOutHeld"]!))
    }
#endif
