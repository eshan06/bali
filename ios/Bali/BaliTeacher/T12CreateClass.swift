import SwiftUI

/// T12 · Create Class — iOS parity with the web's W3b. A sheet form (name, schedule,
/// most-used policy, auto-approve) that lands on the join-code reveal, because the next
/// physical act is putting the code on the board.
struct T12CreateClassSheet: View {
    var firstEver: Bool = false
    /// Called with the created class when the teacher taps "Open the class" → T6.
    var onOpenClass: (TClassCard) -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var meets = ""
    @State private var policies: [TPolicy] = []
    @State private var policyId: String?
    @State private var autoApprove = true
    @State private var busy = false
    @State private var errorText: String?
    @State private var created: TClassCard?
    @State private var showNewPolicy = false
    @State private var showProject = false

    private var selectedPolicy: TPolicy? { policies.first { $0.id == policyId } }
    private var canCreate: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !busy }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            if let created {
                reveal(created)
            } else {
                form
            }
        }
        .presentationDetents([.large])
        .sheet(isPresented: $showNewPolicy) {
            T8PolicyEditorView(policy: nil) { await loadPolicies() }
        }
        .fullScreenCover(isPresented: $showProject) {
            if let created { ProjectCodeView(code: created.joinCode, className: created.name) }
        }
        .task { await loadPolicies() }
    }

    // MARK: form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(spacing: 6) {
                    Text("New class")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(Tokens.Light.textPrimary)
                    if firstEver {
                        Text("Students join with a code you put on the board — that’s the whole setup.")
                            .font(.system(size: 14))
                            .foregroundColor(Tokens.Light.textSecondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 320)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 18)

                TSectionLabel("NAME")
                TeacherField("e.g. Period 4 — Precalculus", text: $name, contentType: .name)

                TSectionLabel("MEETS")
                TeacherField("e.g. TTh · 11:10–11:55", text: $meets)

                HStack {
                    Image(systemName: "checklist").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                    Text("Policy").font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                    Spacer()
                    Menu {
                        ForEach(policies) { p in Button(p.name) { policyId = p.id } }
                    } label: {
                        HStack(spacing: 6) {
                            Text(selectedPolicy?.name ?? "Choose")
                                .font(.system(size: 16, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                            if selectedPolicy != nil { Text("most used").font(.system(size: 13)).foregroundColor(Tokens.Light.textTertiary) }
                            Image(systemName: "chevron.down").font(.system(size: 12)).foregroundColor(Tokens.Light.textTertiary)
                        }
                    }
                }
                .padding(.horizontal, 16).frame(height: 56)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Button { showNewPolicy = true } label: {
                    Text(policyCaption)
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Light.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.plain)

                Toggle(isOn: $autoApprove) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Auto-approve joins")
                            .font(.system(size: 15, weight: .medium)).foregroundColor(Tokens.Light.textPrimary)
                        Text("Anyone with the code is in — no waiting on you")
                            .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
                    }
                }
                .tint(Tokens.green600)
                .padding(.horizontal, 16).frame(minHeight: 64)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                if let errorText {
                    Text(errorText).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
                }

                TPrimaryButton(title: "Create class", busy: busy, enabled: canCreate) { Task { await create() } }
                    .padding(.top, 2)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 36)
        }
    }

    private var policyCaption: String {
        guard let p = selectedPolicy else { return "…or create a new policy" }
        let allowed = p.allowedAppLabels.isEmpty ? "" : " — \(p.allowedAppLabels.joined(separator: ", ")) allowed"
        return "\(p.name)\(allowed) · or create a new policy"
    }

    // MARK: reveal

    private func reveal(_ cls: TClassCard) -> some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack {
                Circle().stroke(Tokens.green600, lineWidth: 8)
                Image(systemName: "checkmark").font(.system(size: 30, weight: .semibold)).foregroundColor(Tokens.green600)
            }
            .frame(width: 96, height: 96)
            Text("\(cls.name) is ready")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(Tokens.Light.textPrimary)
                .multilineTextAlignment(.center)
            Text("Put the join code on the board — students join from the Bali iOS app.")
                .font(.system(size: 15))
                .foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)

            Text(cls.joinCode)
                .font(.system(size: 40, weight: .bold, design: .monospaced))
                .kerning(3)
                .foregroundColor(Tokens.Light.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 22)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            HStack(spacing: 10) {
                TSecondaryButton(title: "Project this", systemImage: "rectangle.inset.filled") { showProject = true }
                ShareLink(item: cls.joinCode) {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 14, weight: .semibold))
                        Text("Share")
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Tokens.Light.card)
                    .foregroundColor(Tokens.Light.textPrimary)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Tokens.Light.borderStrong, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            Spacer()
            TPrimaryButton(title: "Open the class") {
                dismiss()
                onOpenClass(cls)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    // MARK: data

    private func loadPolicies() async {
        struct R: Decodable { var policies: [TPolicy] }
        if let r = try? await store.api.get("policies", as: R.self) {
            policies = r.policies
            policyId = policyId ?? r.policies.max(by: { $0.usedByClasses < $1.usedByClasses })?.id
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        let schedule = parseMeets(meets)
        do {
            let card = try await store.api.post("classes", body: CreateClassBody(
                name: name.trimmingCharacters(in: .whitespaces),
                daysLabel: schedule.days,
                startTime: schedule.start,
                endTime: schedule.end,
                policyId: policyId,
                requireApproval: !autoApprove
            ), as: TClassCard.self)
            created = card
        } catch {
            errorText = (error as? APIError)?.message ?? "Couldn’t create the class — try again."
        }
    }
}

/// Parse a free "Meets" string ("TTh · 11:10–11:55") into the stored days + 24h times.
/// Lenient: missing pieces fall back to sensible defaults so creation never blocks on format.
func parseMeets(_ raw: String) -> (days: String, start: String, end: String) {
    let trimmed = raw.trimmingCharacters(in: .whitespaces)
    var days = "Mon–Fri"
    var timePart = trimmed
    if let dot = trimmed.range(of: "·") {
        days = String(trimmed[..<dot.lowerBound]).trimmingCharacters(in: .whitespaces)
        timePart = String(trimmed[dot.upperBound...]).trimmingCharacters(in: .whitespaces)
        if days.isEmpty { days = "Mon–Fri" }
    } else if !trimmed.contains(":") {
        // No times at all — the whole string is the days label.
        return (trimmed.isEmpty ? "Mon–Fri" : trimmed, "09:00", "09:45")
    }

    let separators = CharacterSet(charactersIn: "–-—")
    let pieces = timePart.components(separatedBy: separators).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    let start = normalizeTime(pieces.first) ?? "09:00"
    let end = normalizeTime(pieces.count > 1 ? pieces[1] : nil) ?? "09:45"
    return (days, start, end)
}

private func normalizeTime(_ s: String?) -> String? {
    guard var str = s?.lowercased().trimmingCharacters(in: .whitespaces), !str.isEmpty else { return nil }
    var pmShift = 0
    if str.hasSuffix("pm") { pmShift = 12; str = String(str.dropLast(2)) }
    else if str.hasSuffix("am") { str = String(str.dropLast(2)) }
    str = str.trimmingCharacters(in: .whitespaces)
    let parts = str.split(separator: ":")
    guard let h0 = Int(parts.first ?? "") else { return nil }
    var hour = h0
    let minute = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
    if pmShift == 12 && hour < 12 { hour += 12 }
    if pmShift == 0 && hour == 12 && (s?.lowercased().hasSuffix("am") ?? false) { hour = 0 }
    guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
    return String(format: "%02d:%02d", hour, minute)
}
