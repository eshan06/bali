import SwiftUI
#if canImport(FamilyControls)
import FamilyControls
#endif

/// S5 — one-time policy setup, shaped by the honesty constraint: iOS keeps the app
/// list private, so the student picks matching apps locally; Bali only ever stores
/// the selection ON THIS PHONE (PolicyBuckets). Routes here from a tag tap whenever
/// the session's label set has no stored bucket yet.
struct PolicySetupView: View {
    var labels: [String]
    var teacherDisplayName: String
    var onConfirmed: () -> Void

    #if canImport(FamilyControls)
    @State private var selection = FamilyActivitySelection()
    #endif
    @State private var pickerPresented = false
    @State private var returnedFromPicker = false

    private var labelList: String { labels.joined(separator: ", ") }

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 90)
                content
                    .padding(.horizontal, 20)
                Spacer()
                bottom
                    .padding(.horizontal, 20)
                    .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
        #if canImport(FamilyControls)
        .familyActivityPicker(isPresented: $pickerPresented, selection: $selection)
        .onChange(of: pickerPresented) { presented in
            if !presented { returnedFromPicker = true }
        }
        .onAppear {
            if let existing = PolicyBuckets.load(for: labels) { selection = existing }
        }
        #endif
    }

    private var pickedCount: Int {
        #if canImport(FamilyControls)
        return PolicyBuckets.count(of: selection)
        #else
        return 0
        #endif
    }

    private var countsMatch: Bool { pickedCount == labels.count }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 26) {
            if !returnedFromPicker {
                // The ask
                Image(systemName: "checklist")
                    .font(.system(size: 40))
                    .foregroundColor(Tokens.green300)
                title("One-time setup for \(teacherDisplayName)'s policy")
                bodyText(askBody)
                AllowedAppsRow(labels: labels, messagesAllowed: false)
            } else if countsMatch {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 40))
                    .foregroundColor(Tokens.green300)
                title("You picked \(pickedCount) \(pickedCount == 1 ? "app" : "apps")")
                bodyText(Text("iOS will keep exactly these available during focus."))
            } else {
                Image(systemName: "text.magnifyingglass")
                    .font(.system(size: 40))
                    .foregroundColor(Tokens.orange300)
                title("You picked \(pickedCount) \(pickedCount == 1 ? "app" : "apps")")
                bodyText(mismatchBody)
            }
        }
    }

    private var askBody: Text {
        Text("This policy allows ")
            + Text(labelList).fontWeight(.semibold).foregroundColor(Tokens.Dark.textPrimary)
            + Text(". iOS keeps your app list private, so you pick the matching apps yourself:")
    }

    private var mismatchBody: Text {
        Text("The policy lists ")
            + Text("\(labels.count)").fontWeight(.semibold).foregroundColor(Tokens.Dark.textPrimary)
            + Text(" — \(labelList). We can't see which apps you chose, so double-check your picks match the list.")
    }

    @ViewBuilder
    private var bottom: some View {
        VStack(spacing: 12) {
            if !returnedFromPicker {
                Button { pickerPresented = true } label: {
                    PrimaryButtonLabel(title: "Select apps on my phone", busy: false)
                }
                Text("Opens the iOS app picker. Bali never sees the list.")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textTertiary)
                    .multilineTextAlignment(.center)
            } else {
                if !countsMatch {
                    Button { pickerPresented = true } label: {
                        Text("Re-open picker")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Tokens.Dark.card)
                            .foregroundColor(Tokens.Dark.textPrimary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Tokens.Dark.borderStrong, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
                Button { confirm() } label: {
                    PrimaryButtonLabel(title: countsMatch ? "Confirm" : "Looks right — confirm", busy: false)
                }
            }
        }
    }

    private func confirm() {
        #if canImport(FamilyControls)
        PolicyBuckets.save(selection, for: labels)
        #endif
        onConfirmed()
    }

    private func title(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 28, weight: .semibold))
            .foregroundColor(Tokens.Dark.textPrimary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 320)
    }

    private func bodyText(_ text: Text) -> some View {
        text
            .font(.system(size: 16))
            .foregroundColor(Tokens.Dark.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 312)
    }
}
