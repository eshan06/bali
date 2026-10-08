import BaliOutbox
import SwiftUI

/// Your name (the approved Sign in & sign up design; the owner's decision, 2026-10-07), where the
/// router sends a student's account `GET /v1/me` names with no name, after any sign-up or sign-in
/// and before Screen Time or Home: a teacher always sees a real name, never part of an account's
/// id. Required: Continue saves it as Me's card does (`Naming`, A8's `PATCH /v1/me`), Saving…
/// while it runs, and the router moves on once `me` has it; Sign out, Me's, is the only other way
/// on. A save that set no name is said under Continue in Me's words, Continue the way to try again
/// (rule 5).
struct NameView: View {
    let phone: Phone
    /// The field's text, kept as `Naming.type` keeps a name, at every keystroke.
    @State private var text: String
    @FocusState private var typing: Bool

    init(phone: Phone) {
        self.phone = phone
        _text = State(initialValue: phone.naming.name)
    }

    var body: some View {
        let naming = phone.naming
        ScreenScaffold {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("What's your name?").textStyle(.h1).accessibilityAddTraits(.isHeader)
                        Text("Add the name your teachers know you by.")
                            .textStyle(.bodyLg).foregroundStyle(Theme.textSecondary)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Name").textStyle(TextStyle(size: 13, line: 18, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary).accessibilityHidden(true)
                        field(busy: naming.busy)
                        Text("Your teachers see this name.").textStyle(.caption)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize).screenWide()
            Button(naming.busy ? "Saving…" : "Continue", action: save)
                .buttonStyle(PrimaryButtonStyle()).disabled(naming.busy || !naming.complete)
                .padding(.top, 16)
            if let failure = naming.failure {
                Text(failure).textStyle(.body).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12)
            }
            // Dimmed with Continue while a save runs, as the canvas draws it.
            SignOutButton(phone: phone).disabled(naming.busy).opacity(naming.busy ? 0.6 : 1)
                .frame(maxWidth: .infinity).padding(.top, 8)
        }
        .onAppear { typing = true }
        // Fixed while its save runs; the keyboard back once a save that failed is over, as on Me,
        // never once one set the name: the router moves on (#292's review).
        .onChange(of: naming.busy) { _, busy in
            if !busy, phone.naming.failure != nil { typing = true }
        }
        // Said to VoiceOver too, whose focus stays on Continue (rule 5).
        .onChange(of: naming.failure) { _, words in
            if let words { AccessibilityNotification.Announcement(words).post() }
        }
    }

    /// The canvas's field, Join's code field in the name's type: white, its edge green and 2 pt
    /// while typing, the strong border's 1 pt otherwise.
    private func field(busy: Bool) -> some View {
        // Read as "Name" by VoiceOver, the label over it hidden from it: an empty prompt leaves
        // the field no label of its own.
        TextField("Name", text: $text, prompt: Text("")).accessibilityLabel("Name")
            .textStyle(.bodyLg).textContentType(.name).textInputAutocapitalization(.words)
            .autocorrectionDisabled().submitLabel(.continue).tint(Theme.brand)
            .focused($typing).disabled(busy)
            .onChange(of: text) { _, typed in
                phone.naming.type(typed)
                text = phone.naming.name
            }
            .onSubmit(save)
            .padding(.horizontal, 17).padding(.vertical, 12).frame(minHeight: 56)
            .background(Theme.card, in: .rect(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(typing ? Theme.arc : Theme.borderStrong, lineWidth: typing ? 2 : 1)
            )
            .shadow(color: Theme.shadow, radius: 1, y: 1)
    }

    private func save() { Task { await phone.saveName() } }
}

#if DEBUG
    #Preview("Your name") { RootView(phone: Phone(fixture: PreviewFixtures.all["name"]!)) }
    #Preview("Your name — refused") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["nameTaken"]!))
    }
#endif
