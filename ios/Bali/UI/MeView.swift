import BaliOutbox
import SwiftUI
import UIKit

/// Me (C6b; D1's Me), where the router sends the Me tab: the name the student's teachers see,
/// edited in place (A8's `PATCH /v1/me`, `Naming`); their classes with each teacher, and Join a
/// class over it with a way back (`ClassesSection`); what Bali does in class, Screen Time's state
/// and what a teacher sees (the intro's own page); and Sign out, which waits while an Emergency
/// Unlock is unsent (`SignOutWords`). Every failure is said with its way on (rule 5). D1's Leave
/// is not here: `GET /v1/me`'s classes carry no enrollment to leave by.
struct MeView: View {
    let phone: Phone
    /// The field's text, kept as `Naming.type` keeps a name, at every keystroke.
    @State private var text: String
    @State private var consent = false
    @FocusState private var typing: Bool
    @Environment(\.openURL) private var openURL

    init(phone: Phone) {
        self.phone = phone
        _text = State(initialValue: phone.naming.name)
    }

    var body: some View {
        ScreenScaffold {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Me").textStyle(.h1).accessibilityAddTraits(.isHeader)
                    // Once a read has named the student: until then Classes says why not.
                    if let me = phone.sync?.me {
                        Card(padding: 0) {
                            Group {
                                if phone.naming.editing { editing } else { name(me.user.displayName) }
                            }
                            .padding(.vertical, 14).padding(.horizontal, 16)
                        }
                    }
                    ClassesSection(phone: phone, title: "Classes")
                    about
                    signOut
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .sheet(isPresented: $consent) { ConsentSheet() }
    }

    private var label: some View {
        Text("Name").textStyle(.label).textCase(.uppercase).foregroundStyle(Theme.textTertiary)
    }

    /// D1's name card: the name the student's teachers see, and the button that edits it.
    private func name(_ name: String?) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                label
                Text(name ?? "No name yet").textStyle(TextStyle(size: 17, line: 26, weight: .semibold))
                    .foregroundStyle(name == nil ? Theme.textTertiary : Theme.text)
                Text(
                    name == nil
                        ? "Add the name your teachers know you by." : "Your teachers see this name."
                )
                .textStyle(.caption).foregroundStyle(Theme.textTertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
            Button {
                text = name ?? ""
                phone.naming.edit(name)
            } label: {
                Image(systemName: "pencil").font(.system(size: 18, weight: .medium))
                    .frame(width: 44, height: 44)
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).stroke(Theme.borderStrong))
            }
            .foregroundStyle(Theme.text).accessibilityLabel("Edit name")
        }
    }

    /// The name as the student edits it (DESIGN.md's input: the label above a sunken well, the
    /// helper and any error below), then Save — again, after a failure — or Cancel.
    private var editing: some View {
        let naming = phone.naming
        return VStack(alignment: .leading, spacing: 8) {
            label.accessibilityHidden(true)
            TextField("Name", text: $text, prompt: Text(""))
                .textStyle(.bodyLg).textContentType(.name).textInputAutocapitalization(.words)
                .autocorrectionDisabled().submitLabel(.done).tint(Theme.brand)
                // Fixed while its save is under way.
                .focused($typing).disabled(naming.busy)
                .onChange(of: text) { _, typed in
                    phone.naming.type(typed)
                    text = phone.naming.name
                }
                .onSubmit(save)
                .padding(.horizontal, 12).padding(.vertical, 8).frame(minHeight: 48)
                .background(Theme.sunken, in: .rect(cornerRadius: Theme.Radius.sm))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.sm)
                        .stroke(typing ? Theme.arc : .clear, lineWidth: 2))
            Text("Your teachers see this name.").textStyle(.caption)
                .foregroundStyle(Theme.textTertiary)
            if let failure = naming.failure { Text(failure).textStyle(.body) }
            Button(naming.busy ? "Saving…" : "Save", action: save)
                .buttonStyle(PrimaryButtonStyle()).disabled(naming.busy || !naming.complete)
                .padding(.top, 8)
            Button("Cancel") { phone.naming = Naming() }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, minHeight: 44)
                .disabled(naming.busy)
        }
        .onAppear { typing = true }
        // Said to VoiceOver too, whose focus stays on Save (rule 5).
        .onChange(of: naming.failure) { _, words in
            if let words { AccessibilityNotification.Announcement(words).post() }
        }
    }

    private func save() { Task { await phone.saveName() } }

    /// D1's card of Bali in class: what pauses and what never does, Screen Time's state — Settings,
    /// where it changes — and what a teacher sees.
    private var about: some View {
        let off = phone.protection?.permissionOff == true
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "shield").font(.system(size: 20)).foregroundStyle(Theme.brand)
                        .frame(width: 40, height: 40).background(Theme.sunken, in: .circle)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("During class")
                            .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                        Text(
                            "Bali pauses every app. Calls, FaceTime, Messages and Emergency SOS always work — iOS keeps them on."
                        )
                        .textStyle(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 14).padding(.horizontal, 16)
                .accessibilityElement(children: .combine)
                Rectangle().fill(Theme.border).frame(height: 1)
                row("Screen Time", value: off ? ("Off", Theme.textSecondary) : ("On", Theme.brand)) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                Rectangle().fill(Theme.border).frame(height: 1)
                row("What your teacher sees") { consent = true }
            }
        }
    }

    /// One of D1's rows: its title, any value in its ink, and a chevron: a way on.
    private func row(
        _ title: String, value: (String, Color)? = nil, _ action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).textStyle(.body).foregroundStyle(Theme.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if case let (words, ink)? = value {
                    Text(words).textStyle(TextStyle(size: 15, line: 22, weight: .medium))
                        .foregroundStyle(ink)
                }
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary).accessibilityHidden(true)
            }
            .padding(.horizontal, 16).frame(minHeight: 52).contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// D1's Sign out — held while an Emergency Unlock is unsent, said why with Try again — and
    /// why the last did not finish.
    @ViewBuilder private var signOut: some View {
        let held = phone.sync.flatMap(SignOutWords.held)
        if let held { Retry(words: held, phone: phone) }
        VStack(alignment: .leading, spacing: 4) {
            Button("Sign out") { Task { await phone.signOut() } }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.textSecondary).frame(minHeight: 44)
                .disabled(held != nil).opacity(held == nil ? 1 : 0.6)
            if let failed = phone.signOutFailed { Text(failed).textStyle(.body) }
        }
    }
}

/// What a teacher sees, from Me's row: the intro's own page, in a sheet with Done.
private struct ConsentSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScreenScaffold {
            Button("Done") { dismiss() }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
            ScrollView { IntroView.consent.padding(.vertical, 16) }
                .scrollBounceBehavior(.basedOnSize)
        }
        .preferredColorScheme(.light)
    }
}

#if DEBUG
    #Preview("Me") { RootView(phone: Phone(fixture: PreviewFixtures.all["me"]!)) }
    #Preview("Me — editing") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["meEditing"]!))
    }
#endif
