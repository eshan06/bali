import SwiftUI
import UserNotifications

/// T9 · Start Session — the pre-session "ready" beat. A confirmation sheet with detents
/// that prefills the next bell and the class default policy, shows the expected count, and
/// offers an on-device end reminder. Never starts a useless session (empty class → code path;
/// past end → inline validation; already active → blocked with a link to the live grid).
struct T9StartSessionSheet: View {
    let cls: TClassCard
    /// Opens the live grid for the class the session belongs to.
    var onStarted: (TSessionDetail) async -> Void
    /// Tapping the "End the current session first" link on the already-active block.
    var onOpenLive: ((String) -> Void)? = nil

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss

    @State private var endsAt: Date
    @State private var policies: [TPolicy] = []
    @State private var policyId: String?
    @State private var remind = true
    @State private var noDeviceCount = 0
    @State private var busy = false
    @State private var errorText: String?
    @State private var showProject = false
    @State private var now = Date()
    private let tick = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    init(cls: TClassCard, onStarted: @escaping (TSessionDetail) async -> Void, onOpenLive: ((String) -> Void)? = nil) {
        self.cls = cls
        self.onStarted = onStarted
        self.onOpenLive = onOpenLive
        // Prefill = today's bell; if it already rang, a 45-minute session.
        var bell = TClassCard.todayAt(cls.endTime) ?? Date().addingTimeInterval(45 * 60)
        if bell <= Date() { bell = Date().addingTimeInterval(45 * 60) }
        _endsAt = State(initialValue: bell)
        _policyId = State(initialValue: cls.policyId)
    }

    private var expecting: Int { max(0, cls.memberCount - noDeviceCount) }
    private var endInPast: Bool { endsAt <= now }
    private var selectedPolicy: TPolicy? { policies.first { $0.id == policyId } }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 0) {
                grabber
                header
                if cls.live != nil {
                    alreadyActive
                } else if cls.memberCount == 0 {
                    noMembers
                } else {
                    form
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
        }
        .presentationDetents([.large])
        .onReceive(tick) { now = $0 }
        .fullScreenCover(isPresented: $showProject) {
            ProjectCodeView(code: cls.joinCode, className: cls.name)
        }
        .task {
            struct R: Decodable { var policies: [TPolicy] }
            if let r = try? await store.api.get("policies", as: R.self) { policies = r.policies }
            if let roster = try? await store.api.get("classes/\(cls.id)/roster", as: TRoster.self) {
                noDeviceCount = roster.members.filter { $0.defaultNoDevice }.count
            }
        }
    }

    private var grabber: some View {
        Capsule().fill(Tokens.Light.borderStrong).frame(width: 36, height: 5).padding(.top, 10).padding(.bottom, 8)
    }

    private var header: some View {
        VStack(spacing: 3) {
            Text("Start a session")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text(cls.name)
                .font(.system(size: 15))
                .foregroundColor(Tokens.Light.textSecondary)
        }
        .padding(.bottom, 18)
    }

    // MARK: form (default / validation)

    private var form: some View {
        VStack(spacing: 12) {
            // Ends at
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Image(systemName: "bell").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                    Text("Ends at").font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                    Spacer()
                    DatePicker("", selection: $endsAt, displayedComponents: .hourAndMinute).labelsHidden()
                    Text("next bell").font(.system(size: 13)).foregroundColor(Tokens.Light.textTertiary)
                }
                .padding(.horizontal, 16)
                .frame(height: 56)
            }
            .background(Tokens.Light.card)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(endInPast ? Tokens.Light.red600 : Color.clear, lineWidth: 1.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            if endInPast {
                Text("That’s already past — pick a time after \(hmm(now)).")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Light.red600)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }

            // Policy
            HStack(spacing: 12) {
                Image(systemName: "checklist").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                Text("Policy").font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                Spacer()
                Menu {
                    ForEach(policies) { p in Button(p.name) { policyId = p.id } }
                } label: {
                    HStack(spacing: 6) {
                        Text(selectedPolicy?.name ?? cls.policyName ?? "Focus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Tokens.Light.textPrimary)
                        Image(systemName: "chevron.down").font(.system(size: 12)).foregroundColor(Tokens.Light.textTertiary)
                    }
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 56)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            if let labels = selectedPolicy?.allowedAppLabels, !labels.isEmpty {
                Text("\(selectedPolicy?.name ?? "") — \(labels.joined(separator: ", ")) allowed")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Light.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }

            // Expecting
            HStack(spacing: 12) {
                Image(systemName: "person.2").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                Text("Expecting").font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                Spacer()
                Text("\(expecting) student\(expecting == 1 ? "" : "s")")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                if noDeviceCount > 0 {
                    Text("\(noDeviceCount) no-device").font(.system(size: 13)).foregroundColor(Tokens.Light.textTertiary)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 56)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            // Remind me
            Toggle(isOn: $remind) {
                HStack(spacing: 12) {
                    Image(systemName: "alarm").font(.system(size: 16)).foregroundColor(Tokens.Light.textSecondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Remind me at the end")
                            .font(.system(size: 16)).foregroundColor(Tokens.Light.textPrimary)
                        Text("A notification on this phone, nothing else")
                            .font(.system(size: 12.5)).foregroundColor(Tokens.Light.textTertiary)
                    }
                }
            }
            .tint(Tokens.green600)
            .padding(.horizontal, 16)
            .frame(minHeight: 64)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            if let errorText {
                Text(errorText).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
            }

            TPrimaryButton(title: "Start session", busy: busy, enabled: !endInPast) { Task { await start() } }
                .padding(.top, 2)
        }
    }

    // MARK: no-members (join-code path)

    private var noMembers: some View {
        VStack(spacing: 16) {
            Spacer().frame(height: 8)
            ZStack {
                Circle().fill(Tokens.Light.sunken)
                Image(systemName: "person.badge.plus").font(.system(size: 26)).foregroundColor(Tokens.Light.textTertiary)
            }
            .frame(width: 72, height: 72)
            Text("No students have joined yet")
                .font(.system(size: 19, weight: .semibold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text("Share the join code first — students join from the Bali iOS app, then you can start.")
                .font(.system(size: 15))
                .foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
            HStack(spacing: 8) {
                JoinCodeChip(code: cls.joinCode) { showProject = true }
                ShareLink(item: cls.joinCode) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 16)).foregroundColor(Tokens.green700)
                        .frame(width: 44, height: 44).background(Tokens.Light.sunken).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
            }
            TSecondaryButton(title: "Show it big to project", systemImage: "rectangle.inset.filled") { showProject = true }
                .frame(maxWidth: 280)
            Spacer()
        }
        .padding(.top, 8)
    }

    // MARK: already-active block

    private var alreadyActive: some View {
        VStack(spacing: 14) {
            Spacer().frame(height: 8)
            Image(systemName: "play.circle").font(.system(size: 40)).foregroundColor(Tokens.green600)
            Text("A session is already running")
                .font(.system(size: 19, weight: .semibold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text("End the current session first — you can only run one at a time per class.")
                .font(.system(size: 15))
                .foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
            if let live = cls.live {
                TPrimaryButton(title: "Open the live grid") {
                    dismiss()
                    onOpenLive?(live.sessionId)
                }
                .frame(maxWidth: 280)
            }
            Spacer()
        }
        .padding(.top, 8)
    }

    // MARK: actions

    private func start() async {
        busy = true
        defer { busy = false }
        do {
            let detail = try await store.api.post(
                "classes/\(cls.id)/sessions",
                body: StartSessionBody(endsAt: endsAt, policyId: policyId),
                as: TSessionDetail.self
            )
            if remind { LocalReminders.scheduleEnd(sessionId: detail.session.id, className: cls.name, at: endsAt) }
            dismiss()
            await onStarted(detail)
        } catch {
            errorText = (error as? APIError)?.message ?? "Couldn’t start — try again."
        }
    }
}

/// On-device end-of-session reminders (T9 toggle). Local notifications only — no APNs in v1.
enum LocalReminders {
    static func scheduleEnd(sessionId: String, className: String, at date: Date) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted, date > Date() else { return }
            let content = UNMutableNotificationContent()
            content.title = "\(className) — session ending"
            content.body = "The bell time you set has arrived. Shields lift now."
            content.sound = .default
            let interval = max(1, date.timeIntervalSinceNow)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            let request = UNNotificationRequest(identifier: identifier(sessionId), content: content, trigger: trigger)
            center.add(request)
        }
    }

    /// Cancel on Extend/End so the reminder never fires after the fact.
    static func cancelEnd(sessionId: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier(sessionId)])
    }

    private static func identifier(_ sessionId: String) -> String { "bali.session.end.\(sessionId)" }
}
