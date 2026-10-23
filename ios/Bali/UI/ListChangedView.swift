import SwiftUI

/// Once, after the update (L8a; the app canvas's ListChanged board), where the router sends a
/// student it lists in a class who has not seen the consent list as it stands on this phone
/// (`Screen.listChanged`): the list promises it "never grows without asking you again", so the two
/// lines a live lesson's questions added, under what a teacher sees and never sees. See the whole
/// list opens it as Me's What your teacher sees does; Continue is the way on, and keeps it seen
/// (`Phone.sawList`). Never over a session's screens, which hold Emergency Unlock: the router's.
struct ListChangedView: View {
    let phone: Phone
    @State private var whole = false

    var body: some View {
        ScreenScaffold {
            PageScroll {
                VStack(spacing: 24) {
                    BaliMark(size: 72).accessibilityHidden(true)
                    VStack(spacing: 12) {
                        Text("Your teacher can ask questions now").textStyle(.h1)
                            .accessibilityAddTraits(.isHeader)
                        Text(
                            "During class, you can answer them here on Bali. That adds two lines to the list of what your teacher sees."
                        )
                        .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                    }
                    .multilineTextAlignment(.center)
                    ConsentCard(title: "Sees", lines: ConsentCard.added)
                    // 12 under the card, as drawn: the column's 24 less 12.
                    Button("See the whole list") { whole = true }
                        .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                        .foregroundStyle(Theme.brand).padding(.horizontal, 12).frame(minHeight: 44)
                        .padding(.top, -12)
                }
            }
            Button("Continue") { phone.sawList() }.buttonStyle(PrimaryButtonStyle())
                .padding(.top, 24)
        }
        .sheet(isPresented: $whole) { ConsentSheet() }
    }
}

#if DEBUG
    #Preview("Once, after the update") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["listChanged"]!))
    }
#endif
