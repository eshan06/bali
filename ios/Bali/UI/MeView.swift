import BaliCore
import BaliOutbox
import SwiftUI
import UIKit

/// Me (C6b; D1's Me), where the router sends the Me tab: the name the student's teachers see,
/// edited in place (A8's `PATCH /v1/me`, `Naming`), the page's hero in DESIGN.md's tray (D2j);
/// their classes with each teacher, and Join a class over it with a way back (`ClassesSection`);
/// what Bali does in class, Screen Time's state and what a teacher sees (the intro's own page),
/// the portal's privacy policy and terms under it (`PolicyLinks`, C2b); and the account (#165):
/// whose sign-in this is (#147) and Sign out, which waits while an Emergency Unlock is unsent
/// (`SignOutWords`), in a card of their own; D1's Leave on each class, asked first, never while
/// the phone stands in that class's lesson (C6c, `Leaving`); and, at the very bottom, Delete
/// account, asked first too (C4b, `Deleting`). Every failure is said with its way on (rule 5).
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
                VStack(alignment: .leading, spacing: 24) {
                    Text("Me").textStyle(.h1).accessibilityAddTraits(.isHeader)
                    // Once a read has named the student: until then Classes says why not. The
                    // page's hero, in DESIGN.md's tray as Home's is (D2j).
                    if let me = phone.sync?.me {
                        Tray {
                            if phone.naming.editing { editing } else { name(me.user.displayName) }
                        }
                    }
                    ClassesSection(phone: phone, title: "Classes", leaves: true)
                    VStack(alignment: .leading, spacing: 8) {
                        about
                        // Above Sign out, never beside the red Delete account (C2b).
                        PolicyLinks(alignment: .leading)
                    }
                    account
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize).screenWide()
        }
        .sheet(isPresented: $consent) { ConsentSheet() }
    }

    /// A group's label, as Classes' is.
    private func label(_ words: String) -> some View {
        Text(words).textStyle(.label).textCase(.uppercase).foregroundStyle(Theme.textTertiary)
    }

    /// D1's name card, the page's hero (D2j): the name the student's teachers see, a card's title
    /// on the type scale, and the button that edits it, round as every button in the app is.
    private func name(_ name: String?) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                label("Name")
                Text(name ?? "No name yet").textStyle(.h3)
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
                    .frame(width: 44, height: 44).overlay(Circle().stroke(Theme.borderStrong))
            }
            .foregroundStyle(Theme.text).accessibilityLabel("Edit name")
        }
    }

    /// The name as the student edits it (DESIGN.md's input: the label above a sunken well under the
    /// focus ring, the helper and any error below), then Save — again, after a failure — or Cancel.
    private var editing: some View {
        let naming = phone.naming
        return VStack(alignment: .leading, spacing: 8) {
            label("Name").accessibilityHidden(true)
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
                .focusRing(typing, radius: Theme.Radius.sm)
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
        // Fixed while its save ran; the keyboard back once a save that failed is over (C6b-2's
        // review), as the Join screen's code does.
        .onChange(of: naming.busy) { _, busy in if !busy, phone.naming.editing { typing = true } }
        // Said to VoiceOver too, whose focus stays on Save (rule 5).
        .onChange(of: naming.failure) { _, words in
            if let words { AccessibilityNotification.Announcement(words).post() }
        }
    }

    private func save() { Task { await phone.saveName() } }

    /// D1's card of Bali in class: what pauses and what never does, Screen Time's state — Settings,
    /// where it changes; Off where the router shows Me over a standing not read (`meScreenTimeOff`;
    /// Riders-2's santa) — and what a teacher sees.
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
                            "Bali pauses every app. Calls, FaceTime, Messages and Emergency SOS always work, because iOS keeps them on."
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

    /// The account (#165): whose sign-in this is (#147) and Sign out, in a card of their own — Sign
    /// out a row with its icon, an action at a glance where a plain line under the cards read as a
    /// heading (D2a's audit), held while an Emergency Unlock is unsent, said why above the card with
    /// Try again — and under the card, Delete account, the screen's one red (C4b).
    private var account: some View {
        let held = phone.signOutHeld
        return VStack(alignment: .leading, spacing: 8) {
            label("Account")
            if let held { Retry(words: held, phone: phone) }
            Card(padding: 0) {
                VStack(spacing: 0) {
                    if let signedIn = SignOutWords.signedIn(phone.email) {
                        Text(signedIn).textStyle(.body).foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        Rectangle().fill(Theme.border).frame(height: 1)
                    }
                    Button {
                        Task { await phone.signOut() }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                            .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                            .foregroundStyle(Theme.brand).padding(.horizontal, 16)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain).disabled(held != nil).opacity(held == nil ? 1 : 0.6)
                }
            }
            if let failed = phone.signOutFailure { Text(failed).textStyle(.body) }
            DeleteAccountButton(phone: phone)
        }
    }
}

/// D1's Sign out on Join, where a student in no class reaches nothing else (`Phone.offersSignOut`):
/// held while an Emergency Unlock is unsent, said why with Try again, and why the last did not
/// finish (C6b). Me's is a row of its account card (D2j).
struct SignOutButton: View {
    let phone: Phone

    var body: some View {
        let held = phone.signOutHeld
        if let held { Retry(words: held, phone: phone) }
        VStack(alignment: .leading, spacing: 4) {
            Button("Sign out") { Task { await phone.signOut() } }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.textSecondary).frame(minHeight: 44)
                .disabled(held != nil).opacity(held == nil ? 1 : 0.6)
            if let failed = phone.signOutFailure { Text(failed).textStyle(.body) }
        }
    }
}

extension Phone {
    /// Why Sign out waits, said by it with Try again: an Emergency Unlock this phone recorded that
    /// the server has not (`SignOutWords.held`). Nil: nothing holds it.
    var signOutHeld: String? { sync.flatMap(SignOutWords.held) }

    /// Why the last Sign out did not finish, said under it: held, the hold is the one reason said,
    /// never a failure from before it (C6b-1's review).
    var signOutFailure: String? { signOutHeld == nil ? signOutFailed : nil }
}

/// Delete account (C4b; the owner's picks, 2026-10-05), at the very bottom of Me under Sign out and
/// whose sign-in it is: a text button in DESIGN.md's destructive red, the one red on the screen.
/// Pressed, it gives way to its question, asked as Leave asks its own (`LeaveQuestion`), on a card
/// of its own (D2j): what goes and what stays, in `body` where a caption was small for an act that
/// can't be undone, a red Delete account and Cancel. From there the deletion's own screen takes
/// over (`DeletingView`), and says every stop with its way on (rule 5); an Emergency Unlock still
/// unsent is one such stop, said there by the engine, which reads the file itself.
struct DeleteAccountButton: View {
    let phone: Phone

    var body: some View {
        if phone.deleting == .asking {
            Card {
                VStack(alignment: .leading, spacing: 8) {
                    Text(Deleting.question).textStyle(.h3)
                    Text(Deleting.consequence).textStyle(.body).foregroundStyle(Theme.textSecondary)
                    Button("Delete account") { Task { await phone.deleteAccount() } }
                        .buttonStyle(PrimaryButtonStyle(destructive: true)).padding(.top, 8)
                    Button("Cancel") { phone.deleting.cancel() }
                        .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, minHeight: 44)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 8)
            // Said to VoiceOver as it appears, as Leave's question is.
            .onAppear { AccessibilityNotification.Announcement(Deleting.question).post() }
        } else {
            Button("Delete account") { phone.deleting.ask() }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.destructive).frame(minHeight: 44).padding(.top, 8)
        }
    }
}

/// D1's Leave on a class of Me's (C6c): it asks its question under the class. Held, dimmed, while
/// the phone stands in that class's lesson (`held`, `Leaving.held` as `ClassesSection` judges it,
/// said under the class); none for a class named with no enrollment to leave by.
struct LeaveButton: View {
    let row: MeClass
    let phone: Phone
    let held: String?

    var body: some View {
        if row.enrollmentId != nil {
            let waits = held != nil || phone.leaving.busy
            Button("Leave") { phone.leaving.ask(row) }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.textSecondary).padding(.horizontal, 4).frame(minHeight: 44)
                .disabled(waits).opacity(waits ? 0.6 : 1)
                .accessibilityLabel("Leave \(row.name)")
        }
    }
}

/// Under a class of Me's (C6c): why its Leave is held (`held`, as `ClassesSection` judges it); or,
/// once pressed, its question — the class named, what leaving costs, why the last try did not
/// finish — with Leave class, the way to try again, and Cancel.
struct LeaveQuestion: View {
    let row: MeClass
    let phone: Phone
    let held: String?

    var body: some View {
        let leaving = phone.leaving
        if let held {
            Text(held).textStyle(.caption).foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16).padding(.bottom, 12)
        } else if leaving.asks(row) {
            VStack(alignment: .leading, spacing: 8) {
                Text(Leaving.question(row))
                    .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                Text(Leaving.consequence).textStyle(.caption)
                    .foregroundStyle(Theme.textSecondary)
                if let failure = leaving.failure { Text(failure).textStyle(.body) }
                Button(leaving.busy ? "Leaving…" : "Leave class") { Task { await phone.leave() } }
                    .buttonStyle(SecondaryButtonStyle()).disabled(leaving.busy).padding(.top, 4)
                Button("Cancel") { phone.leaving.cancel() }
                    .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, minHeight: 44)
                    .disabled(leaving.busy).opacity(leaving.busy ? 0.6 : 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.bottom, 16)
            // Said to VoiceOver as it appears, and a failure as it comes (rule 5).
            .onAppear { AccessibilityNotification.Announcement(Leaving.question(row)).post() }
            .onChange(of: leaving.failure) { _, words in
                if let words { AccessibilityNotification.Announcement(words).post() }
            }
        }
    }
}

/// What a teacher sees, from Me's row: the intro's own page, in a sheet with Done.
struct ConsentSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScreenScaffold {
            Button("Done") { dismiss() }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.brand)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
            ScrollView { IntroView.consent.padding(.vertical, 16) }
                .scrollBounceBehavior(.basedOnSize).screenWide()
        }
        .preferredColorScheme(.light)
    }
}

#if DEBUG
    #Preview("Me") { RootView(phone: Phone(fixture: PreviewFixtures.all["me"]!)) }
    #Preview("Me — editing") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["meEditing"]!))
    }
    #Preview("Me — leaving") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["meLeaveAsk"]!))
    }
    #Preview("Me — Delete account asked") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["meDeleteAsk"]!))
    }
#endif
