import SwiftUI

/// Push destinations off the hub.
enum TeacherRoute: Hashable {
    case classDetail(String)
    case roster(String)
    case policies
}

/// T1 · Teacher Home — the daily hub (W3a portal on the phone). Top to bottom: greeting,
/// live-now card, approvals row, today's schedule with one-tap Start, loaded class cards,
/// and a cross-class activity feed. Same components and density as the brief's T1.
struct T1HomeView: View {
    @EnvironmentObject private var store: TeacherStore

    @State private var home: THome?
    @State private var classes: [TClassCard]?
    @State private var path = NavigationPath()
    @State private var startTarget: TClassCard?
    @State private var liveTarget: LiveTarget?
    @State private var showCreate = false
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                Tokens.Light.page.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        greeting
                        if let classes {
                            if classes.isEmpty {
                                emptyState
                            } else {
                                hub(classes)
                            }
                        } else {
                            ProgressView().tint(Tokens.Light.textSecondary).frame(maxWidth: .infinity).padding(.top, 80)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 36)
                }
                .refreshable { await load() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: TeacherRoute.self) { route in
                switch route {
                case .classDetail(let id): T6ClassDetailView(classId: id)
                case .roster(let id): T7RosterView(classId: id)
                case .policies: T8PoliciesView()
                }
            }
            .task { await load() }
            .sheet(item: $startTarget) { cls in
                T9StartSessionSheet(cls: cls, onStarted: { detail in
                    await load()
                    liveTarget = LiveTarget(classId: detail.session.classId, sessionId: detail.session.id)
                }, onOpenLive: { sid in
                    liveTarget = LiveTarget(classId: cls.id, sessionId: sid)
                })
            }
            .fullScreenCover(item: $liveTarget) { target in
                T2LiveView(classId: target.classId, sessionId: target.sessionId) {
                    liveTarget = nil
                    Task { await load() }
                }
            }
            .sheet(isPresented: $showCreate) {
                T12CreateClassSheet(firstEver: classes?.isEmpty ?? false) { card in
                    Task { await load() }
                    path.append(TeacherRoute.classDetail(card.id))
                }
            }
            .confirmationDialog("Sign out of Bali?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { store.signOut() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    // MARK: greeting

    private var greeting: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greetingTitle)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundColor(Tokens.Light.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let meta = metaLine {
                    Text(meta).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
                }
            }
            Spacer()
            Button { confirmSignOut = true } label: {
                Image(systemName: "gearshape.2").font(.system(size: 20)).foregroundColor(Tokens.Light.textSecondary)
            }
            .accessibilityLabel("Settings")
        }
        .padding(.top, 12)
    }

    private var greetingTitle: String {
        let name = home?.teacher.displayName ?? "there"
        let hour = Calendar.current.component(.hour, from: Date())
        let part = hour < 12 ? "morning" : (hour < 17 ? "afternoon" : "evening")
        return "Good \(part), \(name)"
    }

    private var metaLine: String? {
        guard let home else { return nil }
        if home.live != nil, let bell = home.nextBell { return "\(home.dateLabel) · next bell \(stripMeridiem(bell))" }
        if let next = home.today.first(where: { $0.kind == "future" }) {
            let short = next.name.split(separator: "—").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? next.name
            return "\(home.dateLabel) · \(short) starts \(next.timeLabel)"
        }
        return home.dateLabel
    }

    private func stripMeridiem(_ s: String) -> String {
        s.replacingOccurrences(of: " AM", with: "").replacingOccurrences(of: " PM", with: "")
    }

    /// "8:05" → "08:05" so the meridiem-less Today column is an exact HH:MM grid: colons,
    /// minutes, and left edges all line up, and no single-digit-hour row is indented. Minutes
    /// already arrive 2-digit from the server.
    private func zeroPadHour(_ label: String) -> String {
        let parts = label.split(separator: ":", maxSplits: 1)
        guard parts.count == 2, let hour = Int(parts[0]) else { return label }
        return String(format: "%02d:%@", hour, String(parts[1]))
    }

    // MARK: hub body

    @ViewBuilder
    private func hub(_ classes: [TClassCard]) -> some View {
        if let live = home?.live { liveNowCard(live) }
        if let approvals = home?.approvals, !approvals.isEmpty { approvalsRow(approvals) }
        if let today = home?.today, !today.isEmpty { todaySchedule(today, classes: classes) }

        VStack(alignment: .leading, spacing: 12) {
            TSectionLabel("CLASSES")
            ForEach(classes) { cls in classCard(cls) }
            Button { showCreate = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 14, weight: .semibold))
                    Text("New class")
                }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(Tokens.green700)
            }
            .padding(.top, 2)
        }

        if let recent = home?.recent, !recent.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                TSectionLabel("RECENT ACTIVITY")
                EventTimelineCard(events: Array(recent.prefix(4)))
            }
        }
    }

    private func liveNowCard(_ live: TSessionDetail) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = context.date
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    ArcRing(progress: sessionProgress(start: live.session.startedAt, end: live.session.endsAt, now: now), size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(live.session.className)
                            .font(.system(size: 17, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                        HStack(spacing: 6) {
                            LiveDot()
                            Text("Live · \(mmss(live.session.endsAt.timeIntervalSince(now))) · ends \(hmm(live.session.endsAt))")
                                .font(.system(size: 13, weight: .medium).monospacedDigit())
                                .foregroundColor(Tokens.Light.textSecondary)
                        }
                    }
                    Spacer()
                }
                SummaryChips(counts: live.counts)
                Button {
                    liveTarget = LiveTarget(classId: live.session.classId, sessionId: live.session.id)
                } label: {
                    Text("Open live grid")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(Tokens.Light.actionPrimaryBg).foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(16)
            .background(Tokens.Light.card)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Tokens.green200, lineWidth: 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    private func approvalsRow(_ approvals: [THomeApproval]) -> some View {
        let newest = approvals[0]
        return Button { path.append(TeacherRoute.roster(newest.classId)) } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Tokens.Light.sunken)
                    Image(systemName: "person.badge.plus").font(.system(size: 17)).foregroundColor(Tokens.green600)
                }
                .frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(approvals.count) student\(approvals.count == 1 ? "" : "s") want to join")
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                    Text("\(newest.className) · newest \(relativeAgo(newest.requestedAt))")
                        .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundColor(Tokens.Light.textTertiary)
            }
            .padding(14)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func todaySchedule(_ rows: [THomeRow], classes: [TClassCard]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TSectionLabel("TODAY")
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                    HStack(spacing: 14) {
                        Text(zeroPadHour(row.timeLabel))
                            .font(.system(size: 15, weight: .semibold).monospacedDigit())
                            .foregroundColor(Tokens.Light.textPrimary)
                            // Exact HH:MM grid (08:05 / 10:00 / 12:05 / 02:50), left-aligned —
                            // every row the same width, so nothing is ragged or indented.
                            .frame(width: 52, alignment: .leading)
                        Text(row.name)
                            .font(.system(size: 15))
                            .foregroundColor(row.kind == "past" ? Tokens.Light.textTertiary : Tokens.Light.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        scheduleAction(row, classes: classes)
                    }
                    .frame(minHeight: 48)
                    if idx < rows.count - 1 {
                        Rectangle().fill(Tokens.Light.border).frame(height: 0.5)
                    }
                }
            }
            .padding(.horizontal, 16)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    @ViewBuilder
    private func scheduleAction(_ row: THomeRow, classes: [TClassCard]) -> some View {
        if row.kind == "now" {
            HStack(spacing: 6) {
                LiveDot(size: 7)
                Text("Live now").font(.system(size: 13, weight: .semibold)).foregroundColor(Tokens.green700)
            }
        } else if row.kind == "future" {
            Button {
                startTarget = classes.first { $0.id == row.classId }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "play.fill").font(.system(size: 11))
                    Text("Start")
                }
                .font(.system(size: 14, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                .padding(.horizontal, 12).frame(height: 32)
                .background(Tokens.Light.card)
                .overlay(Capsule().stroke(Tokens.Light.borderStrong, lineWidth: 1))
                .clipShape(Capsule())
            }
        }
    }

    private func classCard(_ cls: TClassCard) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                Text(cls.name)
                    .font(.system(size: 17, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundColor(Tokens.Light.textTertiary)
            }
            Text(cardMeta(cls))
                .font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)

            let action = classPrimaryAction(cls)
            if action != .none {
                HStack(spacing: 10) {
                    switch action {
                    case .openLive:
                        cardButton("Open live grid", primary: true) {
                            if let live = cls.live { liveTarget = LiveTarget(classId: cls.id, sessionId: live.sessionId) }
                        }
                    default:
                        cardButton("Start session", primary: true) { startTarget = cls }
                    }
                    cardButton("Roster", primary: false) { path.append(TeacherRoute.roster(cls.id)) }
                }
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: Color.black.opacity(0.05), radius: 3, y: 1)
        .contentShape(Rectangle())
        .onTapGesture { path.append(TeacherRoute.classDetail(cls.id)) }
    }

    private func cardButton(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: primary ? .infinity : nil)
                .frame(height: 40)
                .padding(.horizontal, primary ? 0 : 18)
                .background(primary ? Tokens.Light.actionPrimaryBg : Tokens.Light.card)
                .foregroundColor(primary ? .white : Tokens.Light.textPrimary)
                .overlay(primary ? nil : RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Tokens.Light.borderStrong, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func cardMeta(_ cls: TClassCard) -> String {
        var parts = ["\(cls.daysLabel) · \(cls.startTime)", cls.studentsLabel]
        if cls.live == nil, let last = cls.lastMetLabel { parts.append("last met \(last)") }
        return parts.joined(separator: " · ")
    }

    // MARK: empty

    private var emptyState: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().stroke(Tokens.Light.border, lineWidth: 8)
                Image(systemName: "plus").font(.system(size: 28)).foregroundColor(Tokens.Light.textTertiary)
            }
            .frame(width: 120, height: 120)
            Text("Set up your first class")
                .font(.system(size: 22, weight: .semibold)).foregroundColor(Tokens.Light.textPrimary)
            Text("A class takes about a minute: name it, pick a policy, and put the join code on the board.")
                .font(.system(size: 15)).foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center).frame(maxWidth: 290)
            TPrimaryButton(title: "Create a class") { showCreate = true }.frame(maxWidth: 240)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    // MARK: data

    private func load() async {
        // Single round-trip: portal/home now carries the class cards too.
        home = try? await store.api.get("portal/home", as: THome.self)
        classes = home?.classes
    }
}
