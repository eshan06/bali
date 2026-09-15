import SwiftUI
#if canImport(FamilyControls)
import FamilyControls
#endif

/// S9 · Settings — permission health on top, the one-time allow-list, account + privacy,
/// classes (tap to see the policy or leave), about. The Privacy page restates the S1
/// contract verbatim.
struct SettingsView: View {
    let student: StudentSelf
    @EnvironmentObject private var auth: AuthStore

    @State private var classes: [StudentClass] = []
    @State private var selectedClass: StudentClass?
    @State private var confirmSignOut = false
    #if canImport(FamilyControls)
    @State private var allowPickerPresented = false
    @State private var allowSelection = FamilyActivitySelection()
    @State private var allowCount = FocusAllowList.load().map { FocusAllowList.count(of: $0) } ?? 0
    #endif
    private let screenTime = ScreenTime.make()

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Settings")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                        .padding(.top, 12)

                    PermissionHealthRow(ok: screenTime.permissionOk)

                    group {
                        #if canImport(FamilyControls)
                        // The one-time allow-list, editable — onboarding promises exactly this.
                        row(icon: "square.grid.2x2", title: "Apps that stay open", detail: allowDetail) {
                            allowSelection = FocusAllowList.load() ?? FamilyActivitySelection()
                            allowPickerPresented = true
                        }
                        divider
                        #endif
                        row(icon: "person", title: "Account", detail: "\(student.firstName) \(student.lastName)") {
                            confirmSignOut = true
                        }
                        divider
                        NavigationLink(value: SettingsRoute.privacy) {
                            rowLabel(icon: "lock", title: "Privacy", detail: nil)
                        }
                        .buttonStyle(.plain)
                        divider
                        NavigationLink(value: SettingsRoute.history) {
                            rowLabel(icon: "chart.bar", title: "History", detail: nil)
                        }
                        .buttonStyle(.plain)
                    }

                    if !classes.isEmpty {
                        group {
                            ForEach(Array(classes.enumerated()), id: \.element.id) { idx, cls in
                                if idx > 0 { divider }
                                row(icon: "person.2", title: cls.className, detail: cls.teacherDisplayName) {
                                    selectedClass = cls
                                }
                            }
                        }
                        Text("Tap a class to see its policy or leave it.")
                            .font(.system(size: 13))
                            .foregroundColor(Tokens.Dark.textTertiary)
                            .padding(.leading, 4)
                    }

                    group {
                        rowLabel(icon: "info.circle", title: "About Bali", detail: "1.0")
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
        #if canImport(FamilyControls)
        .familyActivityPicker(isPresented: $allowPickerPresented, selection: $allowSelection)
        .onChange(of: allowPickerPresented) { presented in
            // The picker edits the binding live; persist the student's pick when it closes.
            if !presented {
                FocusAllowList.save(allowSelection)
                allowCount = FocusAllowList.count(of: allowSelection)
            }
        }
        #endif
        .navigationDestination(for: SettingsRoute.self) { route in
            switch route {
            case .privacy: PrivacyView()
            case .history: HistoryView()
            }
        }
        .task {
            if let home = try? await auth.api.get("student/home", as: StudentHome.self) {
                classes = home.classes
            }
        }
        .sheet(item: $selectedClass) { cls in
            ClassDetailSheet(cls: cls) {
                selectedClass = nil
                if let home = try? await auth.api.get("student/home", as: StudentHome.self) {
                    classes = home.classes
                }
            }
        }
        .confirmationDialog("Sign out of Bali?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { auth.signOut() }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: pieces

    #if canImport(FamilyControls)
    /// "None" is the honest label for an empty pick: every app pauses in a session.
    private var allowDetail: String { allowCount == 0 ? "None" : "\(allowCount) selected" }
    #endif

    private func group<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Tokens.Dark.card)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var divider: some View {
        Rectangle().fill(Tokens.Dark.border).frame(height: 0.5).padding(.leading, 47)
    }

    private func row(icon: String, title: String, detail: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) { rowLabel(icon: icon, title: title, detail: detail) }
            .buttonStyle(.plain)
    }

    private func rowLabel(icon: String, title: String, detail: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 17))
                .foregroundColor(Tokens.Dark.textSecondary)
                .frame(width: 22)
            Text(title)
                .font(.system(size: 16))
                .foregroundColor(Tokens.Dark.textPrimary)
            Spacer()
            if let detail {
                Text(detail)
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Dark.textTertiary)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Tokens.Dark.textTertiary)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 50)
        .contentShape(Rectangle())
    }
}

enum SettingsRoute: Hashable {
    case privacy
    case history
}

/// PermissionHealthRow — ok is quiet reassurance; off is amber posture, never red.
struct PermissionHealthRow: View {
    var ok: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: ok ? "checkmark.shield" : "shield.slash")
                .font(.system(size: 19))
                .foregroundColor(ok ? Tokens.green300 : Tokens.orange300)
            VStack(alignment: .leading, spacing: 1) {
                Text(ok ? "Screen Time is on" : "Screen Time permission is off")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text(ok ? "Everything's ready for the next session." : "Focus can't start until it's back on.")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textSecondary)
            }
            Spacer()
            if !ok {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Tokens.Dark.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Tokens.Dark.raised)
                .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ok ? Tokens.Dark.card : Tokens.Dark.stateEmergencyBg)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// S9 · Privacy — the contract from day one, unchanged, plus the honest revocation note.
struct PrivacyView: View {
    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Privacy")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                        .padding(.top, 8)
                    Text("The contract from day one — unchanged.")
                        .font(.system(size: 16))
                        .foregroundColor(Tokens.Dark.textSecondary)

                    PrivacyContractCard()

                    Text("This is the whole list. It never grows without asking you again.")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textTertiary)

                    Text("Shielding runs through Apple's Screen Time on your phone. You can revoke it in iOS Settings at any time — your teacher would simply see \"permission off.\"")
                        .font(.system(size: 14))
                        .foregroundColor(Tokens.Dark.textSecondary)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Tokens.Dark.card)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .padding(.top, 6)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// Class sheet: the policy at a glance + the leave path ("You can leave any time").
private struct ClassDetailSheet: View {
    let cls: StudentClass
    var onChanged: () async -> Void

    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLeave = false
    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text(cls.className)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .padding(.top, 28)
                Text(cls.scheduleLabel)
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Dark.textSecondary)

                if cls.live != nil {
                    FocusScopeRow()
                        .padding(.top, 6)
                }

                Spacer()

                Button {
                    confirmLeave = true
                } label: {
                    Text("Leave this class…")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Tokens.red300)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Tokens.Dark.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium])
        .confirmationDialog(
            "Leave \(cls.className)?",
            isPresented: $confirmLeave,
            titleVisibility: .visible
        ) {
            Button("Leave class", role: .destructive) {
                busy = true
                Task {
                    try? await auth.api.postVoid("memberships/\(cls.membershipId)/leave", body: nil as EmptyBody?)
                    busy = false
                    dismiss()
                    await onChanged()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can rejoin any time with the class code.")
        }
    }
}
