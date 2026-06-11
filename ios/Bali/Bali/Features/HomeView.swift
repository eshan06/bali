import SwiftUI

/// S3 · Home — "Today". StatusBanner on top, classes below. Dark-first.
/// Slice scope: Free/Focused/Unlocked banner states, join + tap-tag entry points.
struct HomeView: View {
    let student: StudentSelf

    @EnvironmentObject private var auth: AuthStore
    @StateObject private var model = HomeModel()
    @State private var showJoin = false
    @State private var showTagEntry = false
    @State private var tapTarget: TagResolution?

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()

            if let engine = model.engine, model.focusPresented {
                FocusActiveView(engine: engine) {
                    model.focusPresented = false
                    model.engine?.reset()
                    Task { await model.load(api: auth.api) }
                }
            } else {
                content
            }
        }
        .preferredColorScheme(.dark)
        .task { await model.load(api: auth.api) }
        .sheet(isPresented: $showJoin) {
            JoinView { await model.load(api: auth.api) }
        }
        .sheet(isPresented: $showTagEntry) {
            TagEntrySheet { resolution in
                showTagEntry = false
                tapTarget = resolution
            }
        }
        .sheet(item: $tapTarget) { resolution in
            TapInView(resolution: resolution) { session, className, teacher in
                tapTarget = nil
                await model.startFocus(api: auth.api, session: session, className: className, teacher: teacher)
            }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Today")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                    Spacer()
                    Button {
                        auth.signOut()
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 20))
                            .foregroundColor(Tokens.Dark.textSecondary)
                    }
                    .accessibilityLabel("Settings")
                }
                .padding(.top, 12)

                banner

                if !model.classes.isEmpty {
                    Text("CLASSES")
                        .font(.system(size: 12, weight: .semibold))
                        .kerning(0.72)
                        .foregroundColor(Tokens.Dark.textTertiary)

                    VStack(spacing: 1) {
                        ForEach(model.classes) { cls in
                            classRow(cls)
                        }
                    }
                    .background(Tokens.Dark.card)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                }

                if model.classes.isEmpty && model.loaded {
                    emptyState
                }

                actions
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 48)
        }
        .refreshable { await model.load(api: auth.api) }
    }

    // MARK: pieces

    @ViewBuilder private var banner: some View {
        let live = model.liveClass
        HStack(spacing: 14) {
            if let live, let session = live.live {
                MiniArc(endsAt: session.endsAt, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.bannerTitle(for: live))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                    Text("\(live.className) · \(live.teacherDisplayName)")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textSecondary)
                }
                Spacer()
                if model.isUnlocked(live) {
                    Button("Re-focus") {
                        Task { await model.refocus(api: auth.api) }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Tokens.green300)
                }
            } else {
                ZStack {
                    Circle().fill(Tokens.Dark.sunken).frame(width: 40, height: 40)
                    Image(systemName: "circle")
                        .font(.system(size: 16))
                        .foregroundColor(Tokens.Dark.textTertiary)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Free")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                    if let next = model.nextHint {
                        Text(next)
                            .font(.system(size: 13))
                            .foregroundColor(Tokens.Dark.textSecondary)
                    }
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 68)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(model.liveClass.flatMap { model.isUnlocked($0) ? Tokens.Dark.stateEmergencyBg : nil } ?? Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func classRow(_ cls: StudentClass) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(cls.className)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text(cls.scheduleLabel)
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textTertiary)
            }
            Spacer()
            if cls.membershipStatus == "pending" {
                Text("Pending")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textSecondary)
                    .padding(.horizontal, 11).padding(.vertical, 4)
                    .background(Tokens.Dark.stateNeutralBg)
                    .clipShape(Capsule())
            } else if cls.live != nil {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 12))
                    Text("Live")
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Tokens.green300)
                .padding(.horizontal, 11).padding(.vertical, 4)
                .background(Tokens.Dark.stateFocusedBg)
                .clipShape(Capsule())
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Tokens.Dark.textTertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
        .onTapGesture {
            if let session = cls.live, cls.membershipStatus == "active" {
                tapTarget = TagResolution(
                    variant: "ready",
                    classId: cls.classId,
                    className: cls.className,
                    joinCode: "",
                    teacherDisplayName: cls.teacherDisplayName,
                    membershipStatus: cls.membershipStatus,
                    session: ResolvedSession(
                        sessionId: session.sessionId,
                        endsAt: session.endsAt,
                        allowedAppLabels: session.allowedAppLabels,
                        messagesAllowed: session.messagesAllowed,
                        policyName: session.policyName
                    )
                )
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            ArcMarkView(size: 56, trackColor: Tokens.Dark.border, fillColor: Tokens.Dark.border)
            Text("No classes yet")
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(Tokens.Dark.textPrimary)
            Text("Join with the code your teacher put on the board.")
                .font(.system(size: 14))
                .foregroundColor(Tokens.Dark.textSecondary)
            Button("Join a class") { showJoin = true }
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(Tokens.Dark.actionPrimaryBg)
                .foregroundColor(Tokens.Dark.actionPrimaryFg)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            Button {
                showTagEntry = true
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "wave.3.right.circle")
                    Text("Tap the desk tag")
                }
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(Tokens.Dark.actionPrimaryBg)
                .foregroundColor(Tokens.Dark.actionPrimaryFg)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            Button("Join a class") { showJoin = true }
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Tokens.green300)
        }
        .padding(.top, 8)
    }
}

// MARK: model

@MainActor
final class HomeModel: ObservableObject {
    @Published var classes: [StudentClass] = []
    @Published var loaded = false
    @Published var engine: FocusEngine?
    @Published var focusPresented = false

    var liveClass: StudentClass? {
        classes.first { $0.live != nil && $0.membershipStatus == "active" }
    }

    var nextHint: String? {
        classes.first.map { "Next: \($0.className) · \($0.scheduleLabel)" }
    }

    func bannerTitle(for cls: StudentClass) -> String {
        if isUnlocked(cls) { return "Unlocked — focus when ready" }
        let fmt = DateFormatter()
        fmt.timeStyle = .short
        if let ends = cls.live?.endsAt { return "Focused until \(fmt.string(from: ends))" }
        return "Focused"
    }

    func isUnlocked(_ cls: StudentClass) -> Bool {
        cls.live?.mine?.state == "emergency_unlocked"
    }

    func load(api: APIClient) async {
        if let home = try? await api.get("student/home", as: StudentHome.self) {
            classes = home.classes
            loaded = true
            // Re-attach to a focus session in flight (e.g. app relaunch).
            if let live = liveClass, let session = live.live,
               let mine = session.mine, ["focused", "pass", "emergency_unlocked"].contains(mine.state) {
                let engine = ensureEngine(api: api)
                engine.resume(
                    session: ResolvedSession(
                        sessionId: session.sessionId,
                        endsAt: session.endsAt,
                        allowedAppLabels: session.allowedAppLabels,
                        messagesAllowed: session.messagesAllowed,
                        policyName: session.policyName
                    ),
                    className: live.className,
                    teacher: live.teacherDisplayName,
                    mine: mine
                )
                focusPresented = mine.state != "emergency_unlocked"
            }
        }
    }

    func startFocus(api: APIClient, session: ResolvedSession, className: String, teacher: String) async {
        let engine = ensureEngine(api: api)
        do {
            try await engine.startFocus(session: session, className: className, teacher: teacher)
            focusPresented = true
        } catch {
            // surfaced via UI on next load; tap-in is idempotent so retry is safe
        }
        await load(api: api)
    }

    func refocus(api: APIClient) async {
        let engine = ensureEngine(api: api)
        await engine.refocus()
        if case .focused = engine.state { focusPresented = true }
        await load(api: api)
    }

    private func ensureEngine(api: APIClient) -> FocusEngine {
        if let engine { return engine }
        let fresh = FocusEngine(api: api)
        engine = fresh
        return fresh
    }
}

/// Mini live arc for the StatusBanner (36pt, ticking).
struct MiniArc: View {
    let endsAt: Date
    var size: CGFloat = 36
    @State private var now = Date()
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Circle().stroke(Tokens.Dark.arcTrack, lineWidth: 4)
            Circle()
                .trim(from: 0, to: pct)
                .stroke(Tokens.Dark.arcFill, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
        .onReceive(timer) { now = $0 }
    }

    private var pct: CGFloat {
        let total: TimeInterval = 50 * 60
        let remain = max(0, endsAt.timeIntervalSince(now))
        return CGFloat(min(1, remain / total))
    }
}
