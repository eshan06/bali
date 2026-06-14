import SwiftUI

/// T8 · Policies — list + editor. Create and edit policy descriptors from the phone.
/// The honesty model lives here: Phone is always-on and can't be shielded; exceptions are
/// display names the teacher types, never read from devices; delete is guarded when in use.
struct T8PoliciesView: View {
    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var policies: [TPolicy]?
    @State private var editorItem: PolicyEditorItem?

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Button { dismiss() } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold))
                            Text("Classes")
                        }
                        .font(.system(size: 16)).foregroundColor(Tokens.green700)
                    }
                    .padding(.top, 8)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Policies")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(Tokens.Light.textPrimary)
                        Text("What stays available while a class is focused. A policy can be shared by several classes.")
                            .font(.system(size: 14))
                            .foregroundColor(Tokens.Light.textSecondary)
                    }

                    if let policies {
                        if policies.isEmpty {
                            VStack(spacing: 14) {
                                Text("No policies yet")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundColor(Tokens.Light.textPrimary)
                                TPrimaryButton(title: "Create your first policy") { editorItem = PolicyEditorItem(policy: nil) }
                                    .frame(maxWidth: 280)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                        } else {
                            VStack(spacing: 10) {
                                ForEach(policies) { policy in policyRow(policy) }
                            }
                            TPrimaryButton(title: "New policy") { editorItem = PolicyEditorItem(policy: nil) }
                                .padding(.top, 4)
                        }
                    } else {
                        ProgressView().tint(Tokens.Light.textSecondary).padding(.top, 60).frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 36)
            }
            .refreshable { await load() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(item: $editorItem) { item in
            T8PolicyEditorView(policy: item.policy) { await load() }
        }
    }

    private func policyRow(_ policy: TPolicy) -> some View {
        Button { editorItem = PolicyEditorItem(policy: policy) } label: {
            HStack(spacing: 12) {
                Image(systemName: "checklist").font(.system(size: 17)).foregroundColor(Tokens.green600)
                VStack(alignment: .leading, spacing: 1) {
                    Text(policy.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Tokens.Light.textPrimary)
                    Text(allowedSummary(policy))
                        .font(.system(size: 12.5))
                        .foregroundColor(Tokens.Light.textSecondary)
                }
                Spacer()
                Text(usageLabel(policy.usedByClasses))
                    .font(.system(size: 12.5))
                    .foregroundColor(Tokens.Light.textTertiary)
                    .multilineTextAlignment(.trailing)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundColor(Tokens.Light.textTertiary)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 56)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        struct R: Decodable { var policies: [TPolicy] }
        policies = (try? await store.api.get("policies", as: R.self))?.policies
    }
}

func allowedSummary(_ policy: TPolicy) -> String {
    policy.allowedAppLabels.isEmpty ? "No extra apps" : policy.allowedAppLabels.joined(separator: ", ")
}

func usageLabel(_ n: Int) -> String {
    switch n {
    case 0: return "unused"
    case 1: return "1 class"
    default: return "\(n) classes"
    }
}

struct PolicyEditorItem: Identifiable {
    var policy: TPolicy?
    var id: String { policy?.id ?? "new" }
}

/// T8 · Editor — a SwiftUI Form. New (policy == nil) or edit.
struct T8PolicyEditorView: View {
    let policy: TPolicy?
    var onSaved: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var messagesAllowed: Bool
    @State private var labels: [String]
    @State private var draft = ""
    @State private var busy = false
    @State private var errorText: String?
    @State private var showInUseGuard = false
    @State private var confirmDelete = false

    private let explainer = "Students pick these apps on their own phones. Bali can't choose apps for them, and can't see which they picked — it only knows how many."

    init(policy: TPolicy?, onSaved: @escaping () async -> Void) {
        self.policy = policy
        self.onSaved = onSaved
        _name = State(initialValue: policy?.name ?? "")
        _messagesAllowed = State(initialValue: policy?.messagesAllowed ?? true)
        _labels = State(initialValue: policy?.allowedAppLabels ?? [])
    }

    private var isNew: Bool { policy == nil }
    private var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !busy }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                }

                Section("System") {
                    HStack {
                        Image(systemName: "iphone").foregroundColor(Tokens.Light.textSecondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Phone").foregroundColor(Tokens.Light.textPrimary)
                            Text("Always available — iOS can't shield it")
                                .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
                        }
                        Spacer()
                        Toggle("", isOn: .constant(true)).labelsHidden().disabled(true).tint(Tokens.green600)
                    }
                    Toggle(isOn: Binding(get: { !messagesAllowed }, set: { messagesAllowed = !$0 })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Messages").foregroundColor(Tokens.Light.textPrimary)
                            Text("Shielded during focus")
                                .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
                        }
                    }
                    .tint(Tokens.green600)
                }

                Section("Allowed during focus") {
                    FlowChips(labels: labels) { idx in labels.remove(at: idx) }
                    TextField("Add an app name…", text: $draft)
                        .autocorrectionDisabled()
                        .onSubmit(addLabel)
                    Text(explainer)
                        .font(.system(size: 12.5))
                        .foregroundColor(Tokens.Light.textSecondary)
                }

                if let errorText {
                    Section { Text(errorText).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary) }
                }

                Section {
                    Button(action: { Task { await save() } }) {
                        Text(busy ? "Saving…" : "Save policy")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .foregroundColor(.white)
                    }
                    .listRowBackground(Tokens.Light.actionPrimaryBg)
                    .disabled(!canSave)

                    if !isNew {
                        Button(role: .destructive, action: deleteTapped) {
                            Text("Delete policy")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .foregroundColor(Tokens.Light.red600)
                        }
                    }
                }
            }
            .navigationTitle(isNew ? "New policy" : "Edit policy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .alert("\(policy?.name ?? "Policy") is in use", isPresented: $showInUseGuard) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("\(usageSentence) Give them a different policy first, then delete.")
            }
            .alert("Delete \(policy?.name ?? "policy")?", isPresented: $confirmDelete) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) { Task { await delete() } }
            } message: {
                Text("This can't be undone. Past sessions keep their own record.")
            }
        }
    }

    private var usageSentence: String {
        let n = policy?.usedByClasses ?? 0
        return n == 1 ? "1 class uses it as its default." : "\(n) classes use it as their default."
    }

    private func addLabel() {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, labels.count < 12, !labels.contains(trimmed) else { draft = ""; return }
        labels.append(trimmed)
        draft = ""
    }

    private func deleteTapped() {
        if (policy?.usedByClasses ?? 0) > 0 { showInUseGuard = true } else { confirmDelete = true }
    }

    private func save() async {
        addLabel() // fold any half-typed name in
        busy = true
        defer { busy = false }
        do {
            if let policy {
                _ = try await store.api.patch("policies/\(policy.id)", body: UpdatePolicyBody(name: name, messagesAllowed: messagesAllowed, allowedAppLabels: labels), as: TPolicy.self)
            } else {
                _ = try await store.api.post("policies", body: CreatePolicyBody(name: name, messagesAllowed: messagesAllowed, allowedAppLabels: labels), as: TPolicy.self)
            }
            dismiss()
            await onSaved()
        } catch {
            errorText = (error as? APIError)?.message ?? "Couldn’t save — try again."
        }
    }

    private func delete() async {
        guard let policy else { return }
        do {
            _ = try await store.api.delete("policies/\(policy.id)")
            dismiss()
            await onSaved()
        } catch {
            // In-use races land here — surface the guard rather than a raw error.
            showInUseGuard = true
        }
    }
}

/// Wrapping chip row for the policy editor's app-name exceptions (each removable with ×).
struct FlowChips: View {
    let labels: [String]
    var onRemove: (Int) -> Void

    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(Array(labels.enumerated()), id: \.offset) { idx, label in
                HStack(spacing: 6) {
                    Text(label).font(.system(size: 14, weight: .medium)).foregroundColor(Tokens.Light.textPrimary)
                    Button { onRemove(idx) } label: {
                        Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundColor(Tokens.Light.textTertiary)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Tokens.Light.sunken)
                .clipShape(Capsule())
            }
        }
    }
}

/// Minimal flow layout so the exception chips wrap (iOS 16 Layout).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0; y += rowHeight + lineSpacing; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.minX + maxWidth, x > bounds.minX {
                x = bounds.minX; y += rowHeight + lineSpacing; rowHeight = 0
            }
            sub.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
