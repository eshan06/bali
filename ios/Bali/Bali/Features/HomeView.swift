import Combine
import SwiftUI

/// S3 · Home — "Today". StatusBanner on top, classes below. Dark-first.
/// Slice scope: Free/Focused/Unlocked banner states, join + tap-tag entry points.
struct HomeView: View {
    let student: StudentSelf

    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var deepLinks: DeepLinks
    @StateObject private var model = HomeModel()
    @State private var showJoin = false
    @State private var showTagEntry = false
    @State private var tapTarget: TagResolution?
    @State private var nfcHint: String?
    @State private var navPath = NavigationPath()

    init(student: StudentSelf) {
        self.student = student
        var path = NavigationPath()
        #if DEBUG
        // Screenshot/test seam: `simctl launch ... -bali.route settings|history`
        switch UserDefaults.standard.string(forKey: "bali.route") {
        case "settings": path.append("settings")
        case "history":
            path.append("settings")
            path.append(SettingsRoute.history)
        case "privacy":
            path.append("settings")
            path.append(SettingsRoute.privacy)
        default: break
        }
        #endif
        _navPath = State(initialValue: path)
    }

    var body: some View {
        NavigationStack(path: $navPath) {
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
            .navigationDestination(for: String.self) { route in
                if route == "settings" { SettingsView(student: student) }
            }
            .toolbar(.hidden, for: .navigationBar)
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
                // Only a real tap-in closes this sheet: a silent dismiss would look
                // exactly like focus starting.
                if await model.startFocus(api: auth.api, session: session, className: className, teacher: teacher) {
                    tapTarget = nil
                }
            }
            .overlay(alignment: .top) {
                if let message = model.startFocusError {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.red300)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Tokens.Dark.card)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .padding(.horizontal, 20)
                        .padding(.top, 16)
                }
            }
            .onDisappear { model.startFocusError = nil }
        }
        .onReceive(deepLinks.$pendingTagCode) { code in
            guard let code else { return }
            deepLinks.pendingTagCode = nil
            Task { await resolveTag(code: code) }
        }
    }

    /// One resolve path for NFC taps, deep links, and the Simulator's entry sheet.
    private func resolveTag(code: String) async {
        do {
            let resolution = try await auth.api.post("tags/resolve", body: ResolveBody(code: code), as: TagResolution.self)
            tapTarget = resolution
        } catch {
            nfcHint = "This tag isn't active — check with your teacher."
        }
    }

    /// Device: real NFC scan. Simulator / NFC-less device: the tag-entry sheet.
    private func tapDeskTag() {
        #if !targetEnvironment(simulator) && canImport(CoreNFC)
        if TagCodeReader.isAvailable {
            Task {
                do {
                    let code = try await TagCodeReader().scan()
                    await resolveTag(code: code)
                } catch {
                    if let message = (error as? LocalizedError)?.errorDescription { nfcHint = message }
                }
            }
            return
        }
        #endif
        showTagEntry = true
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Today")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                    Spacer()
                    NavigationLink(value: "settings") {
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
        let state = model.bannerState
        let classLine = model.liveClass.map { "\($0.className) · \($0.teacherDisplayName)" }
        HStack(spacing: 14) {
            switch state {
            case .free:
                bannerGlyph("circle", Tokens.Dark.textTertiary)
                bannerText("Free", model.freeHint)
                Spacer()
            case let .focused(endsAt):
                MiniArc(endsAt: endsAt, size: 36)
                bannerText(model.focusedTitle(endsAt: endsAt), classLine)
                Spacer()
            case let .pass(endsAt):
                // A pass is not focus: nothing is shielded until it ends, and the banner
                // may not draw the bell countdown as if something were.
                MiniArc(endsAt: endsAt, size: 36)
                bannerText(model.passTitle(endsAt: endsAt), classLine)
                Spacer()
            case let .unlocked(endsAt):
                MiniArc(endsAt: endsAt, size: 36)
                bannerText("Unlocked — focus when ready", classLine)
                Spacer()
                Button("Re-focus") {
                    Task { await model.refocus(api: auth.api) }
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Tokens.green300)
            case .permissionOff:
                // Amber, never red — same posture as PermissionHealthRow: the
                // permission is the student's to hold, not a punishment.
                bannerGlyph("shield.slash", Tokens.orange300)
                bannerText("Screen Time permission is off", "Nothing is shielded — turn it back on to focus.")
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 68)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(state.isUnlocked ? Tokens.Dark.stateEmergencyBg : Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func bannerGlyph(_ symbol: String, _ color: Color) -> some View {
        ZStack {
            Circle().fill(Tokens.Dark.sunken).frame(width: 40, height: 40)
            Image(systemName: symbol)
                .font(.system(size: 16))
                .foregroundColor(color)
        }
    }

    @ViewBuilder private func bannerText(_ title: String, _ subtitle: String?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(Tokens.Dark.textPrimary)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textSecondary)
            }
        }
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
            if let nfcHint {
                Text(nfcHint)
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textSecondary)
                    .frame(maxWidth: .infinity)
            }
            Button {
                tapDeskTag()
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
    @Published var startFocusError: String?
    private var engineChanges: AnyCancellable?

    /// What the banner may claim. A live session in the class says nothing about
    /// this student — only their own participation does.
    enum BannerState: Equatable {
        case free
        case focused(endsAt: Date)
        case pass(endsAt: Date)
        case unlocked(endsAt: Date)
        case permissionOff

        var isUnlocked: Bool { if case .unlocked = self { return true }; return false }
    }

    var liveClass: StudentClass? {
        classes.first { $0.live != nil && $0.membershipStatus == "active" }
    }

    var bannerState: BannerState {
        // The engine is the only thing that knows whether shields are ACTUALLY up — the
        // server payload knows what this phone last reported, which is not the same thing.
        // "Focused" is a claim about the phone, so only the engine may make it.
        if let engine, let session = engine.session {
            switch engine.state {
            case .focused: return .focused(endsAt: session.endsAt)
            case .pass(let endsAt): return .pass(endsAt: endsAt)
            case .statusOnly: return .permissionOff
            case .unlocked: return .unlocked(endsAt: session.endsAt)
            case .idle, .ended: break // no live participation on this device — fall through
            }
        }
        guard let live = liveClass?.live, let mine = live.mine else { return .free }
        // The one seven-value vocabulary (packages/shared/src/states.ts), all spelled out.
        switch mine.state {
        case "focused", "pass":
            // The engine is what applies shields; with no engine attached nothing on this
            // phone is shielded, whatever the server was last told. Say so.
            return .free
        case "emergency_unlocked": return .unlocked(endsAt: live.endsAt)
        case "revoked": return .permissionOff
        // no_device / ended / not_joined: nothing is shielded, so "Free".
        case "no_device", "ended", "not_joined": return .free
        default: return .free
        }
    }

    var nextHint: String? {
        classes.first.map { "Next: \($0.className) · \($0.scheduleLabel)" }
    }

    /// Free during a live class isn't "nothing on" — it's "you haven't tapped in yet".
    var freeHint: String? {
        if let live = liveClass { return "\(live.className) · tap the desk tag to focus" }
        return nextHint
    }

    func focusedTitle(endsAt: Date) -> String {
        "Focused until \(Self.clock(endsAt))"
    }

    func passTitle(endsAt: Date) -> String {
        "On a pass until \(Self.clock(endsAt))"
    }

    private static func clock(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }

    func load(api: APIClient) async {
        // Shields live in ManagedSettings and outlive the process, so the durable marker is
        // reconciled BEFORE the network call: a student whose app was killed — offline, or
        // already dropped from the class — must still land on a screen with the emergency
        // unlock on it. Offline fails SAFE toward the student keeping their exit.
        adoptShieldMarker(api: api)

        guard let home = try? await api.get("student/home", as: StudentHome.self) else {
            return // offline: the marker stands, and with it the way out
        }
        classes = home.classes
        loaded = true

        // Re-attach to a focus session in flight (e.g. app relaunch).
        if let live = liveClass, let session = live.live, let mine = session.mine,
           attachesEngine(mine.state) {
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
            focusPresented = presentsFocus(engine.state)
            return
        }

        // The server has spoken and it does not have this phone in a session: anything the
        // device is still holding — shields, the marker, the shield-screen context, the
        // DeviceActivity windows, the heartbeat — is orphaned, and only this device can
        // let it go. (We never get here offline: the marker stands instead.)
        // `shield.applied` is last because it is the one that cannot be argued with: the
        // engine and the marker both go quiet when a marker is missing or unreadable, and
        // that is exactly the case where the phone IS shielded and nothing is releasing it.
        let holdingSomething = (engine.map { $0.state != .idle } ?? false)
            || ShieldMarker.exists
            || ShieldFlag.isSet
        if holdingSomething {
            ensureEngine(api: api).reset()
            focusPresented = false
        }
    }

    /// Does this participation state mean the engine has to be running on this phone?
    /// `revoked` is in: it is the state whose only way out is a heartbeat reporting that
    /// Screen Time permission came back.
    private func attachesEngine(_ state: String) -> Bool {
        switch state {
        case "focused", "pass", "emergency_unlocked", "revoked": return true
        case "ended", "not_joined", "no_device": return false
        default: return false // unknown vocabulary: never hold a phone on a guess
        }
    }

    /// Shields survive force-quit, process death and going offline; nothing else in the app
    /// does. If the marker says this phone is holding shields — or that a hall pass ended
    /// while the app was dead, so they are due back — re-attach the engine from the marker
    /// alone, before and without any network call, so the focus screen and the emergency
    /// unlock on it are reachable even when the class has vanished from /home.
    private func adoptShieldMarker(api: APIClient) {
        guard engine == nil else { return }
        guard let marker = ShieldMarker.dueNow() else {
            // Shields with no marker are shields nobody owns — nothing on this phone knows
            // which session they belong to or when they lift, and offline we never reach the
            // orphan check below. Fail toward the student: let them go.
            if ShieldFlag.isSet { ensureEngine(api: api).reset() }
            return
        }
        let engine = ensureEngine(api: api)
        guard marker.endsAt > Date() else {
            // The bell has passed (the monitor extension has usually cleared the shields by
            // now): tidy the marker and the shields away rather than adopt a dead session.
            engine.reset()
            return
        }
        engine.adopt(marker: marker)
        focusPresented = presentsFocus(engine.state)
    }

    /// Returns false when the tap-in failed — the caller keeps the sheet up so the
    /// student can see it and retry (tap-in is idempotent, so retrying is safe).
    func startFocus(api: APIClient, session: ResolvedSession, className: String, teacher: String) async -> Bool {
        let engine = ensureEngine(api: api)
        startFocusError = nil
        do {
            try await engine.startFocus(session: session, className: className, teacher: teacher)
        } catch {
            startFocusError = (error as? APIError)?.message ?? "Couldn't start focus — check your connection and tap again."
            return false
        }
        focusPresented = presentsFocus(engine.state)
        await load(api: api)
        return true
    }

    func refocus(api: APIClient) async {
        let engine = ensureEngine(api: api)
        await engine.refocus()
        focusPresented = presentsFocus(engine.state)
        await load(api: api)
    }

    /// Presentation follows the ENGINE, not the server: the server can say
    /// "focused" while Screen Time is off and nothing is shielded. `.statusOnly`
    /// still opens the screen — the tap-in is real — and FocusActiveView renders
    /// that state honestly instead of drawing the countdown.
    private func presentsFocus(_ state: FocusEngine.FocusState) -> Bool {
        switch state {
        case .focused, .statusOnly, .pass: return true
        case .idle, .unlocked, .ended: return false
        }
    }

    private func ensureEngine(api: APIClient) -> FocusEngine {
        if let engine { return engine }
        let fresh = FocusEngine(api: api)
        // The banner reads the engine's state (only the engine knows whether shields are
        // really up), so Home has to re-render when the engine moves — a heartbeat that
        // ends the session must not leave a stale claim on screen.
        engineChanges = fresh.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
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
