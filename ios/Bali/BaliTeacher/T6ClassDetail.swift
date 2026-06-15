import SwiftUI

/// T6 · Class Detail — the per-class hub. Header (join code + context-aware primary), a
/// sticky segmented control, and a live banner pinned under the header on every segment.
/// Segments compose existing pieces: stat cards, RosterContent, the policy view, tag rows,
/// EventTimeline. Depth is participation and status only — no surface implies device contents.
struct T6ClassDetailView: View {
    let classId: String

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss

    @State private var card: TClassCard?
    @State private var overview: TClassOverview?
    @State private var roster: TRoster?
    @State private var policies: [TPolicy] = []
    @State private var tags: [TTag] = []
    @State private var liveDetail: TSessionDetail?
    @State private var events: [TEvent] = []
    @State private var eventsCursor: String?
    @State private var eventsLoaded = false
    @State private var segment = 0

    @State private var startSheet = false
    @State private var liveTarget: LiveTarget?
    @State private var showProject = false
    @State private var editClass = false
    @State private var recapTarget: String?
    @State private var editPolicy: PolicyEditorItem?
    @State private var writeTag = false
    @State private var deactivateTag: TTag?

    private let segments = ["Overview", "Roster", "Policy", "Tags", "Activity"]

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            if let card {
                ScrollView {
                    LazyVStack(spacing: 14, pinnedViews: [.sectionHeaders]) {
                        header(card)
                        if let live = liveDetail, card.live != nil {
                            LiveBanner(detail: live) { openLive(card) }
                        }
                        Section {
                            segmentBody(card).padding(.top, 12)
                        } header: {
                            SegPicker(items: segments, selection: $segment, fontSize: 12.5)
                                .padding(.vertical, 8)
                                .background(Tokens.Light.page)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 36)
                }
                .refreshable { await loadAll() }
            } else {
                ProgressView().tint(Tokens.Light.textSecondary)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await loadAll() }
        .onChange(of: segment) { seg in if seg == 4, !eventsLoaded { Task { await loadEvents(reset: true) } } }
        .sheet(isPresented: $startSheet) {
            if let card {
                T9StartSessionSheet(cls: card, onStarted: { detail in
                    await loadAll()
                    liveTarget = LiveTarget(classId: classId, sessionId: detail.session.id)
                }, onOpenLive: { sid in liveTarget = LiveTarget(classId: classId, sessionId: sid) })
            }
        }
        .fullScreenCover(item: $liveTarget) { target in
            T2LiveView(classId: target.classId, sessionId: target.sessionId) {
                liveTarget = nil
                Task { await loadAll() }
            }
        }
        .fullScreenCover(isPresented: $showProject) {
            if let card { ProjectCodeView(code: card.joinCode, className: card.name) }
        }
        .sheet(isPresented: $editClass) {
            if let card {
                EditClassSheet(card: card, policies: policies) { await loadAll() }
            }
        }
        .sheet(item: Binding(get: { recapTarget.map { RecapTarget(sessionId: $0) } }, set: { recapTarget = $0?.sessionId })) { target in
            T10RecapView(sessionId: target.sessionId) { segment = 4 }
        }
        .sheet(item: $editPolicy) { item in
            T8PolicyEditorView(policy: item.policy) { await loadPolicies() }
        }
        .sheet(isPresented: $writeTag) {
            WriteTagSheet(classId: classId) { await loadTags() }
                .presentationDetents([.medium])
        }
        .alert(
            "Deactivate “\(deactivateTag?.label ?? "")”?",
            isPresented: Binding(get: { deactivateTag != nil }, set: { if !$0 { deactivateTag = nil } })
        ) {
            Button("Cancel", role: .cancel) { deactivateTag = nil }
            Button("Deactivate", role: .destructive) {
                if let tag = deactivateTag { Task { await setTagActive(tag, false) } }
            }
        } message: {
            Text("Every printed copy of this tag stops working immediately. Students can still join by code.")
        }
    }

    // MARK: header

    private func header(_ card: TClassCard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { dismiss() } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold))
                    Text("Classes")
                }
                .font(.system(size: 16)).foregroundColor(Tokens.green700)
            }
            .padding(.top, 8)

            Text(card.name)
                .font(.system(size: 30, weight: .bold))
                .foregroundColor(Tokens.Light.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(card.scheduleLabel) · \(card.studentsLabel)")
                .font(.system(size: 14))
                .foregroundColor(Tokens.Light.textSecondary)

            HStack(spacing: 10) {
                JoinCodeChip(code: card.joinCode) { showProject = true }
                primaryAction(card)
            }
            .padding(.top, 4)
        }
    }

    @ViewBuilder
    private func primaryAction(_ card: TClassCard) -> some View {
        switch classPrimaryAction(card, forceStart: true) {
        case .openLive:
            Button { openLive(card) } label: {
                Text("Open live grid")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity).frame(height: 44)
                    .background(Tokens.Light.actionPrimaryBg).foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        default:
            Button { startSheet = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill").font(.system(size: 13))
                    Text("Start session")
                }
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(Tokens.Light.actionPrimaryBg).foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    // MARK: segments

    @ViewBuilder
    private func segmentBody(_ card: TClassCard) -> some View {
        switch segment {
        case 1: rosterSegment
        case 2: policySegment(card)
        case 3: tagsSegment
        case 4: activitySegment
        default: overviewSegment(card)
        }
    }

    private func overviewSegment(_ card: TClassCard) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            StatGrid(cells: [
                ("\(overview?.memberCount ?? card.memberCount)", "members"),
                ("\(overview?.sessionsThisWeek ?? 0)", "sessions this week"),
                lastSessionCell,
                medianCell,
            ])
            Text("Focus minutes count time in session — nothing else is measured.")
                .font(.system(size: 12.5))
                .foregroundColor(Tokens.Light.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            if let last = overview?.lastSession {
                Button { recapTarget = last.sessionId } label: {
                    overviewRow(icon: "flag",
                                title: "Last session recap",
                                subtitle: "\(last.dayLabel) · \(last.durationLabel) · \(last.focusedCount) of \(last.totalMembers) focused")
                }
                .buttonStyle(.plain)
            }
            Button { editClass = true } label: {
                overviewRow(icon: "pencil", title: "Edit class", subtitle: "Name, schedule, auto-approve, default policy")
            }
            .buttonStyle(.plain)
        }
    }

    private var lastSessionCell: (String, String) {
        guard let last = overview?.lastSession else { return ("—", "last session") }
        return ("\(last.durationMinutes) min", "last session · \(last.dayLabel)")
    }
    private var medianCell: (String, String) {
        guard let m = overview?.medianFocusMinutes else { return ("—", "median focus per session") }
        return ("\(m) min", "median focus per session")
    }

    private func overviewRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 16)).foregroundColor(Tokens.green600).frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                Text(subtitle).font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundColor(Tokens.Light.textTertiary)
        }
        .padding(.horizontal, 16).frame(minHeight: 60)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private var rosterSegment: some View {
        if let roster {
            RosterContent(roster: roster, reload: { await loadRoster() })
        } else {
            ProgressView().tint(Tokens.Light.textSecondary).frame(maxWidth: .infinity).padding(.top, 30)
        }
    }

    @ViewBuilder
    private func policySegment(_ card: TClassCard) -> some View {
        let policy = policies.first { $0.id == card.policyId }
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(policy?.name ?? card.policyName ?? "Focus")
                        .font(.system(size: 17, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                    Text("default for this class")
                        .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
                }
                Text(allowedSummary(policy ?? fallbackPolicy(card)))
                    .font(.system(size: 14)).foregroundColor(Tokens.Light.textSecondary)
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle").font(.system(size: 13)).foregroundColor(Tokens.Light.textTertiary).padding(.top, 1)
                    Text("Phone & Messages always work — iOS can’t shield them. Every other app pauses except the few each student chose once during setup.")
                        .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(16)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            HStack(spacing: 10) {
                if let policy {
                    TSecondaryButton(title: "Edit policy", systemImage: "pencil") { editPolicy = PolicyEditorItem(policy: policy) }
                }
                Menu {
                    ForEach(policies) { p in Button(p.name) { Task { await changeDefault(p.id) } } }
                } label: {
                    Text("Change default")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(Tokens.Light.card).foregroundColor(Tokens.Light.textPrimary)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Tokens.Light.borderStrong, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }

            Text("Every session is full focus. Each student picks the few apps that stay open once on their own phone — Bali never sees the list.")
                .font(.system(size: 12.5))
                .foregroundColor(Tokens.Light.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            NavigationLink(value: TeacherRoute.policies) {
                HStack(spacing: 6) {
                    Image(systemName: "checklist").font(.system(size: 13, weight: .semibold))
                    Text("Manage all policies")
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Tokens.green700)
            }
            .padding(.top, 2)
        }
    }

    private func fallbackPolicy(_ card: TClassCard) -> TPolicy {
        TPolicy(id: "", name: card.policyName ?? "Focus", messagesAllowed: true, allowedAppLabels: card.allowedAppLabels, usedByClasses: 0)
    }

    private var tagsSegment: some View {
        VStack(alignment: .leading, spacing: 10) {
            if tags.isEmpty {
                Text("No tags for this class yet. Write one, stick it where students tap.")
                    .font(.system(size: 14)).foregroundColor(Tokens.Light.textSecondary).padding(.vertical, 6)
            } else {
                ForEach(tags) { tag in tagRow(tag) }
            }
            TPrimaryButton(title: "Write a new tag", height: 48) { writeTag = true }.padding(.top, 4)
            Text("Printing QR sheets happens on the web Tags page. Labels are only ever shown to you.")
                .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
        }
    }

    private func tagRow(_ tag: TTag) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "wave.3.right").font(.system(size: 17)).foregroundColor(tag.active ? Tokens.green600 : Tokens.Light.textTertiary)
            VStack(alignment: .leading, spacing: 1) {
                Text(tag.label).font(.system(size: 15, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                Text(tag.code).font(.system(size: 12, design: .monospaced)).kerning(0.8).foregroundColor(Tokens.Light.textTertiary)
            }
            Spacer()
            if tag.active {
                Text("Active").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Tokens.Light.stateFocusedFg)
                    .padding(.horizontal, 10).padding(.vertical, 3).background(Tokens.Light.stateFocusedBg).clipShape(Capsule())
            } else {
                Text("Off").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Tokens.Light.textTertiary)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .opacity(tag.active ? 1 : 0.62)
        .contentShape(Rectangle())
        .onTapGesture { if tag.active { deactivateTag = tag } }
    }

    private var activitySegment: some View {
        VStack(alignment: .leading, spacing: 14) {
            FramingLine()
            if !eventsLoaded {
                ProgressView().tint(Tokens.Light.textSecondary).frame(maxWidth: .infinity).padding(.top, 20)
            } else if events.isEmpty {
                Text("No activity yet — it fills in as sessions run.")
                    .font(.system(size: 14)).foregroundColor(Tokens.Light.textSecondary)
            } else {
                ForEach(groupedEvents(events), id: \.day) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        TSectionLabel(group.day.uppercased())
                        EventTimelineCard(events: group.items)
                    }
                }
                if eventsCursor != nil {
                    Button { Task { await loadEvents(reset: false) } } label: {
                        Text("Load earlier")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Tokens.green700)
                            .frame(maxWidth: .infinity).frame(height: 44)
                    }
                }
            }
        }
    }

    // MARK: actions / data

    private func openLive(_ card: TClassCard) {
        if let live = card.live { liveTarget = LiveTarget(classId: classId, sessionId: live.sessionId) }
    }

    private func loadAll() async {
        // The card (+ live detail), overview, and policy reads are independent — fan them out
        // instead of three sequential round-trips.
        async let card: Void = loadCard()
        async let overview: Void = loadOverview()
        async let policies: Void = loadPolicies()
        _ = await (card, overview, policies)
        if segment == 1 { await loadRoster() }
        if segment == 3 { await loadTags() }
        if segment == 4 { await loadEvents(reset: true) }
    }

    private func loadCard() async {
        card = try? await store.api.get("classes/\(classId)", as: TClassCard.self)
        if let live = card?.live {
            liveDetail = try? await store.api.get("sessions/\(live.sessionId)", as: TSessionDetail.self)
        } else {
            liveDetail = nil
        }
    }
    private func loadOverview() async { overview = try? await store.api.get("classes/\(classId)/overview", as: TClassOverview.self) }
    private func loadRoster() async { roster = try? await store.api.get("classes/\(classId)/roster", as: TRoster.self) }
    private func loadPolicies() async {
        struct R: Decodable { var policies: [TPolicy] }
        if let r = try? await store.api.get("policies", as: R.self) { policies = r.policies }
    }
    private func loadTags() async {
        if let r = try? await store.api.get("classes/\(classId)/tags", as: TTagList.self) { tags = r.tags }
    }
    private func loadEvents(reset: Bool) async {
        var path = "events?classId=\(classId)&limit=30"
        if !reset, let cursor = eventsCursor { path += "&cursor=\(cursor)" }
        struct R: Decodable { var events: [TEvent]; var nextCursor: String? }
        if let r = try? await store.api.get(path, as: R.self) {
            events = reset ? r.events : events + r.events
            eventsCursor = r.nextCursor
            eventsLoaded = true
        }
    }

    private func changeDefault(_ policyId: String) async {
        struct Resp: Decodable { var id: String }
        _ = try? await store.api.patch("classes/\(classId)", body: UpdateClassBody(policyId: policyId), as: Resp.self)
        await loadCard()
    }
    private func setTagActive(_ tag: TTag, _ active: Bool) async {
        struct Body: Encodable { var active: Bool }
        _ = try? await store.api.patch("tags/\(tag.id)", body: Body(active: active), as: TTag.self)
        deactivateTag = nil
        await loadTags()
    }

    private func groupedEvents(_ events: [TEvent]) -> [(day: String, items: [TEvent])] {
        var out: [(day: String, items: [TEvent])] = []
        for event in events {
            let label = dayGroupLabel(event.at)
            if out.last?.day == label { out[out.count - 1].items.append(event) }
            else { out.append((day: label, items: [event])) }
        }
        return out
    }
}

private struct RecapTarget: Identifiable { var sessionId: String; var id: String { sessionId } }

private func dayGroupLabel(_ date: Date) -> String {
    let cal = Calendar.current
    if cal.isDateInToday(date) { return "Today" }
    if cal.isDateInYesterday(date) { return "Yesterday" }
    let fmt = DateFormatter(); fmt.dateFormat = "EEEE, MMM d"; return fmt.string(from: date)
}

/// T6 · Edit class — name, schedule, auto-approve, default policy (Form sheet).
struct EditClassSheet: View {
    let card: TClassCard
    let policies: [TPolicy]
    var onSaved: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var meets: String
    @State private var autoApprove: Bool
    @State private var policyId: String?
    @State private var busy = false

    init(card: TClassCard, policies: [TPolicy], onSaved: @escaping () async -> Void) {
        self.card = card
        self.policies = policies
        self.onSaved = onSaved
        _name = State(initialValue: card.name)
        _meets = State(initialValue: "\(card.daysLabel) · \(card.startTime)–\(card.endTime)")
        _autoApprove = State(initialValue: card.autoApprove ?? !card.requireApproval)
        _policyId = State(initialValue: card.policyId)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") { TextField("Class name", text: $name) }
                Section("Meets") { TextField("e.g. MWF · 9:50–10:45", text: $meets).autocorrectionDisabled() }
                Section("Default policy") {
                    Picker("Policy", selection: Binding(get: { policyId ?? "" }, set: { policyId = $0.isEmpty ? nil : $0 })) {
                        ForEach(policies) { p in Text(p.name).tag(p.id) }
                    }
                }
                Section {
                    Toggle("Auto-approve joins", isOn: $autoApprove).tint(Tokens.green600)
                }
                Section {
                    Button { Task { await save() } } label: {
                        Text(busy ? "Saving…" : "Save changes")
                            .font(.system(size: 16, weight: .semibold)).frame(maxWidth: .infinity).foregroundColor(.white)
                    }
                    .listRowBackground(Tokens.Light.actionPrimaryBg)
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("Edit class")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let schedule = parseMeets(meets)
        struct Resp: Decodable { var id: String }
        _ = try? await store.api.patch("classes/\(card.id)", body: UpdateClassBody(
            name: name.trimmingCharacters(in: .whitespaces),
            daysLabel: schedule.days,
            startTime: schedule.start,
            endTime: schedule.end,
            policyId: policyId,
            requireApproval: !autoApprove
        ), as: Resp.self)
        dismiss()
        await onSaved()
    }
}
