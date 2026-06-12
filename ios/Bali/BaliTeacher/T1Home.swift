import SwiftUI

/// T1 · Home — class cards; the live one leads with "Open live grid".
struct T1HomeView: View {
    @EnvironmentObject private var store: TeacherStore
    @State private var classes: [TClassCard]?
    @State private var startTarget: TClassCard?
    @State private var liveTarget: TClassCard?
    @State private var showCreate = false
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            ZStack {
                Tokens.Light.page.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        HStack {
                            Text("Classes")
                                .font(.system(size: 34, weight: .bold))
                                .foregroundColor(Tokens.Light.textPrimary)
                            Spacer()
                            Button { confirmSignOut = true } label: {
                                Image(systemName: "gearshape.2")
                                    .font(.system(size: 20))
                                    .foregroundColor(Tokens.Light.textSecondary)
                            }
                            .accessibilityLabel("Settings")
                        }
                        .padding(.top, 12)

                        if let classes {
                            if classes.isEmpty {
                                emptyState
                            } else {
                                ForEach(classes) { cls in
                                    classCard(cls)
                                }
                                Button {
                                    showCreate = true
                                } label: {
                                    HStack(spacing: 6) {
                                        Image(systemName: "plus").font(.system(size: 14, weight: .semibold))
                                        Text("New class")
                                    }
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(Tokens.green700)
                                }
                                .padding(.top, 6)
                            }
                        } else {
                            ProgressView().tint(Tokens.Light.textSecondary).padding(.top, 80)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 36)
                }
                .refreshable { await load() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
            .sheet(item: $startTarget) { cls in
                StartSessionSheet(cls: cls) { detail in
                    startTarget = nil
                    await load()
                    liveTarget = classes?.first { $0.id == detail.session.classId }
                }
                .presentationDetents([.height(380)])
            }
            .fullScreenCover(item: $liveTarget) { cls in
                if let live = cls.live {
                    T2LiveView(classId: cls.id, sessionId: live.sessionId) {
                        liveTarget = nil
                        Task { await load() }
                    }
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateClassSheet {
                    showCreate = false
                    await load()
                }
            }
            .confirmationDialog("Sign out of Bali?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { store.signOut() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func load() async {
        struct R: Decodable { var classes: [TClassCard] }
        if let r = try? await store.api.get("classes", as: R.self) {
            classes = r.classes
            // keep an open grid's endsAt fresh after extend
            if let live = liveTarget { liveTarget = r.classes.first { $0.id == live.id } ?? nil }
            #if DEBUG
            // Screenshot/test seam: `simctl launch ... -bali.teacher.route live`
            if UserDefaults.standard.string(forKey: "bali.teacher.route") == "live", liveTarget == nil {
                UserDefaults.standard.removeObject(forKey: "bali.teacher.route")
                liveTarget = r.classes.first { $0.live != nil }
            }
            #endif
        }
    }

    private func classCard(_ cls: TClassCard) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                Text(cls.name)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Spacer()
                if let live = cls.live {
                    chip("checkmark.circle", "Live · ends \(live.endsAtLabel)", fg: Tokens.Light.stateFocusedFg, bg: Tokens.Light.stateFocusedBg)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Tokens.Light.textTertiary)
                }
            }
            Text(subtitle(cls))
                .font(.system(size: 13))
                .foregroundColor(Tokens.Light.textSecondary)

            if cls.live != nil {
                HStack(spacing: 10) {
                    Button {
                        liveTarget = cls
                    } label: {
                        Text("Open live grid")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(Tokens.Light.actionPrimaryBg)
                            .foregroundColor(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                }
                .padding(.top, 14)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: Color.black.opacity(0.05), radius: 3, y: 1)
        .contentShape(Rectangle())
        .onTapGesture {
            if cls.live != nil { liveTarget = cls } else { startTarget = cls }
        }
    }

    private func subtitle(_ cls: TClassCard) -> String {
        let base = "\(cls.memberCount) students"
        if cls.live != nil, let policy = cls.policyName { return "\(base) · \(policy) policy" }
        if cls.live != nil { return base }
        return "\(base) · next session \(cls.startTime)"
    }

    private func chip(_ icon: String, _ label: String, fg: Color, bg: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12))
            Text(label).font(.system(size: 13, weight: .medium).monospacedDigit())
        }
        .foregroundColor(fg)
        .padding(.horizontal, 11)
        .padding(.vertical, 4)
        .background(bg)
        .clipShape(Capsule())
    }

    private var emptyState: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().stroke(Tokens.Light.border, lineWidth: 8)
                Image(systemName: "plus").font(.system(size: 28)).foregroundColor(Tokens.Light.textTertiary)
            }
            .frame(width: 120, height: 120)
            Text("Set up your first class")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text("A class takes about a minute: name it, pick a policy, and put the join code on the board.")
                .font(.system(size: 15))
                .foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 290)
            Button("Create a class") { showCreate = true }
                .font(.system(size: 17, weight: .semibold))
                .padding(.horizontal, 26)
                .padding(.vertical, 13)
                .background(Tokens.Light.actionPrimaryBg)
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(.top, 100)
    }
}

/// T1 · Start Session sheet — two prefilled decisions (next bell + last policy).
struct StartSessionSheet: View {
    let cls: TClassCard
    var onStarted: (TSessionDetail) async -> Void

    @EnvironmentObject private var store: TeacherStore
    @State private var endsAt: Date
    @State private var policies: [TPolicy] = []
    @State private var policyId: String?
    @State private var busy = false
    @State private var errorText: String?

    init(cls: TClassCard, onStarted: @escaping (TSessionDetail) async -> Void) {
        self.cls = cls
        self.onStarted = onStarted
        // Prefill = the class bell today; if it already rang, a 45-minute session.
        let parts = cls.endTime.split(separator: ":").compactMap { Int($0) }
        var bell = Calendar.current.date(
            bySettingHour: parts.first ?? 0, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: Date()
        ) ?? Date()
        if bell <= Date() { bell = Date().addingTimeInterval(45 * 60) }
        _endsAt = State(initialValue: bell)
        _policyId = State(initialValue: cls.policyId)
    }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 12) {
                Capsule().fill(Tokens.Light.borderStrong).frame(width: 36, height: 5).padding(.top, 10)
                Text("Start a session")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text(cls.name)
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Light.textSecondary)

                VStack(spacing: 12) {
                    HStack(spacing: 12) {
                        Image(systemName: "bell").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                        Text("Ends at").font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                        Spacer()
                        DatePicker("", selection: $endsAt, displayedComponents: .hourAndMinute)
                            .labelsHidden()
                        Text("next bell").font(.system(size: 13)).foregroundColor(Tokens.Light.textTertiary)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                    .background(Tokens.Light.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    HStack(spacing: 12) {
                        Image(systemName: "checklist").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                        Text("Policy").font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                        Spacer()
                        Menu {
                            ForEach(policies) { p in
                                Button(p.name) { policyId = p.id }
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Text(policies.first { $0.id == policyId }?.name ?? cls.policyName ?? "Focus")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(Tokens.Light.textPrimary)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 12))
                                    .foregroundColor(Tokens.Light.textTertiary)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                    .background(Tokens.Light.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    if let labels = policies.first(where: { $0.id == policyId })?.allowedAppLabels, !labels.isEmpty {
                        Text("\(policies.first { $0.id == policyId }?.name ?? "") — \(labels.joined(separator: ", ")) allowed")
                            .font(.system(size: 13))
                            .foregroundColor(Tokens.Light.textTertiary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                    }

                    if let errorText {
                        Text(errorText).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
                    }

                    Button {
                        busy = true
                        Task {
                            do {
                                let detail = try await store.api.post(
                                    "classes/\(cls.id)/sessions",
                                    body: StartSessionBody(endsAt: endsAt, policyId: policyId),
                                    as: TSessionDetail.self
                                )
                                busy = false
                                await onStarted(detail)
                            } catch {
                                busy = false
                                errorText = (error as? APIError)?.message ?? "Couldn't start — try again."
                            }
                        }
                    } label: {
                        Group {
                            if busy { ProgressView().tint(.white) } else { Text("Start session") }
                        }
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Tokens.Light.actionPrimaryBg)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(busy || endsAt <= Date())
                }
                .padding(.top, 10)
                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .task {
            struct R: Decodable { var policies: [TPolicy] }
            if let r = try? await store.api.get("policies", as: R.self) { policies = r.policies }
        }
    }
}

/// Minimal create-class sheet (W3's dialog, phone-sized).
struct CreateClassSheet: View {
    var onCreated: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var startTime = Calendar.current.date(bySettingHour: 11, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var endTime = Calendar.current.date(bySettingHour: 11, minute: 45, second: 0, of: Date()) ?? Date()
    @State private var policies: [TPolicy] = []
    @State private var policyId: String?
    @State private var requireApproval = false
    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 14) {
                Text("New class")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                    .padding(.top, 24)

                TeacherField("Class name", text: $name, contentType: .name)

                HStack {
                    Text("Meets").font(.system(size: 15)).foregroundColor(Tokens.Light.textSecondary)
                    Spacer()
                    DatePicker("", selection: $startTime, displayedComponents: .hourAndMinute).labelsHidden()
                    Text("–").foregroundColor(Tokens.Light.textTertiary)
                    DatePicker("", selection: $endTime, displayedComponents: .hourAndMinute).labelsHidden()
                }
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                HStack {
                    Text("Policy").font(.system(size: 15)).foregroundColor(Tokens.Light.textSecondary)
                    Spacer()
                    Menu {
                        ForEach(policies) { p in
                            Button(p.name) { policyId = p.id }
                        }
                    } label: {
                        Text(policies.first { $0.id == policyId }?.name ?? "Choose")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Tokens.Light.textPrimary)
                    }
                }
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Toggle(isOn: $requireApproval) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Require approval to join")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(Tokens.Light.textPrimary)
                        Text("Otherwise the code admits anyone who has it")
                            .font(.system(size: 12.5))
                            .foregroundColor(Tokens.Light.textTertiary)
                    }
                }
                .tint(Tokens.green600)
                .padding(.horizontal, 16)
                .frame(height: 64)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Button {
                    busy = true
                    Task {
                        let fmt = DateFormatter()
                        fmt.dateFormat = "HH:mm"
                        _ = try? await store.api.post("classes", body: CreateClassBody(
                            name: name.trimmingCharacters(in: .whitespaces),
                            daysLabel: "Mon–Fri",
                            startTime: fmt.string(from: startTime),
                            endTime: fmt.string(from: endTime),
                            policyId: policyId,
                            requireApproval: requireApproval
                        ), as: TClassCard.self)
                        busy = false
                        dismiss()
                        await onCreated()
                    }
                } label: {
                    Group {
                        if busy { ProgressView().tint(.white) } else { Text("Create class") }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Tokens.Light.actionPrimaryBg)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                .opacity(name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)

                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .presentationDetents([.large])
        .task {
            struct R: Decodable { var policies: [TPolicy] }
            if let r = try? await store.api.get("policies", as: R.self) {
                policies = r.policies
                policyId = policyId ?? r.policies.max(by: { $0.usedByClasses < $1.usedByClasses })?.id
            }
        }
    }
}
