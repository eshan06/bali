//
//  ProfileView.swift
//  Bali — Profile tab
//
//  Identity (avatar, name, grade · school, device/streak badges) over an
//  editable form: first/last name, a grade segmented control, and the read-only
//  school email. Save posts to /students/me via AppModel. The gear opens
//  Settings.
//

import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouter.self) private var router

    @State private var firstName = ""
    @State private var lastName = ""
    @State private var grade = "11"
    @State private var seeded = false
    @State private var isSaving = false
    @State private var justSaved = false

    private let grades = ["9", "10", "11", "12"]

    var body: some View {
        BaliScreen {
            ScreenHeader(eyebrow: "Account", title: "Profile") {
                IconButton(systemImage: "gearshape") { router.push(.settings, on: .profile) }
            }
            identityBlock
            form
        }
        .onAppear { if !seeded { seed() } }
        .onChange(of: model.student?.id) { _, _ in seed() }
    }

    // MARK: - Identity

    private var identityBlock: some View {
        VStack(spacing: BaliSpacing.m) {
            Circle()
                .fill(BaliGradient.avatar)
                .frame(width: 96, height: 96)
                .overlay {
                    Text(model.student?.initials ?? "··")
                        .font(BaliFont.at(32, 800))
                        .foregroundStyle(.white)
                }
                .baliShadow(.blue)
            VStack(spacing: 3) {
                BaliText(model.student?.fullName ?? "—", .h2)
                BaliText(subtitleLine, .foot)
                    .multilineTextAlignment(.center)
            }
            HStack(spacing: BaliSpacing.s) {
                if model.registeredDevice != nil {
                    Badge(text: "Device linked", tone: .green, showsDot: true)
                }
                if let streak = model.extras.streak { streakBadge(streak) }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, BaliSpacing.s)
    }

    private var subtitleLine: String {
        var parts: [String] = []
        if let g = model.student?.grade, !g.isEmpty { parts.append("Grade \(g)") }
        if let school = model.classes.first?.schoolName { parts.append(school) }
        return parts.isEmpty ? "Student" : parts.joined(separator: " · ")
    }

    private func streakBadge(_ n: Int) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "flame.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BaliColor.amber)
            Text("\(n)-day streak")
                .font(BaliFont.at(12.5, 650))
                .foregroundStyle(BaliColor.blue)
        }
        .padding(.horizontal, 11)
        .frame(height: 26)
        .background(BaliColor.blueTint)
        .clipShape(Capsule())
    }

    // MARK: - Form

    private var form: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            Eyebrow("Personal details", muted: true)

            HStack(alignment: .top, spacing: BaliSpacing.m) {
                VStack(alignment: .leading, spacing: BaliSpacing.s) {
                    FieldLabel("First name")
                    BaliTextField(placeholder: "First", text: $firstName,
                                  textContentType: .givenName, autocapitalization: .words)
                }
                VStack(alignment: .leading, spacing: BaliSpacing.s) {
                    FieldLabel("Last name")
                    BaliTextField(placeholder: "Last", text: $lastName,
                                  textContentType: .familyName, autocapitalization: .words)
                }
            }

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Grade")
                BaliSegmentedControl(items: grades, selection: $grade) { $0 }
            }

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                HStack(spacing: 6) {
                    BaliText("School email", .label)
                    BaliText("· read only", .foot, color: BaliColor.ink4)
                    Spacer(minLength: 0)
                }
                BaliReadOnlyField(value: model.student?.email ?? "—", icon: "envelope")
            }

            BaliButton(title: justSaved ? "Saved" : "Save changes",
                       icon: justSaved ? "checkmark" : nil,
                       variant: justSaved ? .secondary : .primary) { save() }
                .disabled(isSaving || !isDirty)
                .padding(.top, BaliSpacing.xxs)
        }
    }

    private var isDirty: Bool {
        guard let s = model.student else { return false }
        return firstName.trimmed != s.firstName
            || lastName.trimmed != s.lastName
            || grade != (s.grade ?? "")
    }

    // MARK: - Actions

    private func seed() {
        guard let s = model.student else { return }
        firstName = s.firstName
        lastName = s.lastName
        grade = grades.contains(s.grade ?? "") ? (s.grade ?? "11") : "11"
        seeded = true
    }

    private func save() {
        isSaving = true
        Task {
            let ok = await model.saveProfile(
                firstName: firstName.trimmed, lastName: lastName.trimmed, grade: grade)
            isSaving = false
            if ok {
                withAnimation { justSaved = true }
                try? await Task.sleep(for: .seconds(1.6))
                withAnimation { justSaved = false }
            }
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

#Preview {
    NavigationStack { ProfileView() }
        .injectBaliEnvironment(.preview())
}
