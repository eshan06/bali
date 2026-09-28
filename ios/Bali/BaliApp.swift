import AuthenticationServices
import BaliCore
import BaliOutbox
import SwiftUI

// The student app (ARCHITECTURE, "iOS app structure"): its screens (C1–C6, `RootView`) over
// `Phone`, which starts the app's one sync engine over the student's Cognito sign-in (B4) and the
// shields' enforcer (B5).
@main
struct BaliApp: App {
    @Environment(\.scenePhase) private var phase
    @State private var phone = Phone.launched()

    var body: some Scene {
        WindowGroup {
            RootView(phone: phone).task { await phone.start() }
        }
        // The outbox is in the app group, shared with the extensions: suspended holding a lock on
        // it, the app would be killed (0xdead10cc). So it takes none behind the app, and takes them
        // again in front — where the engine checks in.
        .onChange(of: phase, initial: true) { _, phase in
            if phase == .background { Outbox.suspend() } else { Outbox.resume() }
            phone.setForeground(phase == .active)
        }
    }

    static let version = ["CFBundleShortVersionString", "CFBundleVersion"]
        .map { Bundle.main.object(forInfoDictionaryKey: $0) as? String ?? "?" }
        .joined(separator: " · ")
}

/// The app's one sign-in, sync engine and enforcer, started once for the app's life, and what they
/// say.
@MainActor @Observable
final class Phone {
    private(set) var signIn: SignIn?
    private(set) var engine: SyncEngine?
    private(set) var enforcer: Enforcer?
    /// Whether someone is signed in; nil until the Keychain can be read (the phone locked).
    private(set) var signedIn: Bool?
    /// The engine's state, for the screens; nil until it starts.
    private(set) var sync: SyncState?
    /// What a screen may claim of the shields (rule 3); nil until the enforcer starts.
    private(set) var protection: Protection?
    /// Why the engine did not start, shown with a way to try again (rule 5).
    private(set) var problem: String?
    /// What the scene's phase drives once the engine and the enforcer run: the engine's check-in,
    /// and rule 3's check as the app comes back. Theirs — a test's own in `BaliTests`.
    @ObservationIgnored
    var onPhase:
        (
            engine: @MainActor @Sendable (Bool) async -> Void,
            check: @MainActor @Sendable () async -> Void
        )?
    private var foreground = false
    private var starting = false
    /// A fixture's, frozen as it was made (Debug): never started.
    private var frozen = false
    /// Whether the student has seen the intro (C1): the phone's own flag, in its own defaults —
    /// not the app group's, which the extensions read.
    private(set) var introSeen = UserDefaults.standard.bool(forKey: Phone.introSeenKey)
    static let introSeenKey = "introSeen"
    /// Whether a pass has ever read the Screen Time permission approved (C1b), kept as `introSeen`
    /// is: Family Controls can read not determined for a moment after a launch (B5a-2), and with
    /// this set the router routes such a read as approved, so no Screen Time screen flashes on a
    /// phone that gave it. The check judging the permission off clears it — denied, or not
    /// determined for a check-in interval: a grant taken back, or one that did not come back with
    /// a restored backup, which restores these defaults — so the grant screen returns.
    private(set) var everApproved = UserDefaults.standard.bool(forKey: Phone.everApprovedKey)
    static let everApprovedKey = "screenTimeApproved"
    /// The last ask for the Screen Time permission that did not finish (C1b), said on its screen
    /// until the next ask (rule 5).
    private(set) var askFailed: ScreenTimeAskError?
    /// The Join screen's (C2b): the code as typed, what it opens, why a try did not finish.
    var joining = Joining()
    /// A screen the student opened over the router's (C3): Join, from Home's Join a class — Back
    /// closes it — or Home, from Waiting's Back to home. It ends once where the phone stands
    /// changes, or a tap is made or answered (`SyncState.keepsOpened`).
    private(set) var opened: Screen?
    /// Home's Tap in: a scan under way, and why the last recorded no tap (rule 5).
    private(set) var scanning = false
    private(set) var tapFailed: String?

    /// Whether the student is in any class, as the engine's `GET /v1/me` says — a join made since
    /// counted at once — nil until a read answers (C3). The router shows Join while it is false.
    var hasClasses: Bool? { sync?.hasClasses }

    init() {}

    /// The app's phone: the live one — or, in a Debug build launched with `-bali-screen <name>`,
    /// one frozen in that fixture (`PreviewFixtures`).
    static func launched() -> Phone {
        #if DEBUG
            if let fixture = PreviewFixtures.chosen() { return Phone(fixture: fixture) }
        #endif
        return Phone()
    }

    #if DEBUG
        init(fixture: PreviewFixtures.State) {
            (problem, introSeen, signedIn) = (fixture.problem, fixture.introSeen, fixture.signedIn)
            (protection, sync, frozen) = (fixture.protection, fixture.sync, true)
            (everApproved, askFailed, joining) = (false, fixture.askFailed, fixture.joining)
            opened = fixture.opened
        }
    #endif

    /// The screen to show now: `Screen.choose`, the one place that decides, over what the phone
    /// knows. A session just over is a later step's (C5): nil until then.
    var screen: Screen {
        Screen.choose(
            problem: problem, introSeen: introSeen, signedIn: signedIn, protection: protection,
            everApproved: everApproved, sync: sync, hasClasses: hasClasses, lastSessionOver: nil,
            opened: opened, now: Date())
    }

    /// Opens `screen` over the router's — nil closes it. A Join closed starts over.
    func open(_ screen: Screen?) {
        if opened == .join, screen == nil, !joining.busy { joining = Joining() }
        opened = screen
    }

    /// The engine's state as it comes: a screen opened over another ends once where the phone
    /// stands changes, or a tap is made or answered.
    func synced(_ state: SyncState) {
        if !state.keepsOpened(from: sync) { opened = nil }
        sync = state
    }

    /// Home's Tap in (B6's scan): a Bali block's code is the tap — recorded, shielded at once and
    /// sent — and anything else is said under the button (rule 5), nothing recorded. A phone whose
    /// engine has not started says so.
    func tapIn() async {
        guard !scanning else { return }
        guard let engine else { return tapFailed = Joining.notStarted }
        (tapFailed, scanning) = (nil, true)
        defer { scanning = false }
        let read = await BlockReader().read()
        do {
            try await engine.tap(read)
            tapFailed = read.words
        } catch {
            tapFailed = BlockRead.notKept
        }
    }

    /// The student's Try again (rule 5): everything queued goes now, and the truth is read again.
    func retry() async { await engine?.retryNow() }

    /// Looks the typed code up (`GET /v1/join-codes/{code}`), through the engine: what it opens, or
    /// why not — the last try's words gone meanwhile, the code kept as sent until the answer comes.
    /// A phone whose engine has not started — a frozen one too — says so (rule 5).
    func lookUp() async {
        guard !joining.busy else { return }
        guard let engine else { return joining.failure = Joining.notStarted }
        let code = joining.code
        (joining.failure, joining.busy) = (nil, true)
        let answer = await engine.lookUp(code)
        joining.busy = false
        joining.looked(answer, for: code)
    }

    /// Joins the class the code opens (`POST /v1/enrollments`), through the engine — its event id
    /// minted per press, as the server knows a join's retry by its enrollment: once in, the class
    /// is the engine's at once, so the router moves on; else why not, said. A phone whose engine
    /// has not started — a frozen one too — says so (rule 5).
    func join() async {
        guard !joining.busy else { return }
        guard let engine else { return joining.failure = Joining.notStarted }
        let now = Date()
        let request = EnrollmentJoinRequest(
            joinCode: joining.code, eventId: EventID.mint(at: now), deviceTime: now)
        (joining.failure, joining.busy) = (nil, true)
        let answer = await engine.join(request)
        joining.busy = false
        if joining.joined(answer) { opened = nil }
    }

    func sawIntro() {
        introSeen = true
        UserDefaults.standard.set(true, forKey: Phone.introSeenKey)
    }

    /// Keeps `everApproved` as a pass read the permission: set at approved, cleared once the check
    /// judges it off, left at a read not determined for a moment — the read it is there to see
    /// past.
    func remember(_ protection: Protection) {
        let approved = protection.permission == .approved
        guard approved || protection.permissionOff, everApproved != approved else { return }
        everApproved = approved
        UserDefaults.standard.set(approved, forKey: Phone.everApprovedKey)
    }

    /// Asks iOS for the Screen Time permission — its own prompt, through the enforcer — and keeps
    /// why it did not finish. Nothing on a frozen phone.
    func askScreenTime() async {
        guard let enforcer else { return }
        askFailed = nil
        do { try await enforcer.requestPermission() } catch {
            askFailed = error as? ScreenTimeAskError ?? .failed("\(error)")
        }
    }

    /// Starts the sign-in, the engine and the enforcer, unless they run already: a start that
    /// failed can be tried again.
    func start() async {
        guard engine == nil, !starting, !frozen else { return }
        starting = true
        defer { starting = false }
        guard let config = AppConfig(info: Bundle.main.infoDictionary ?? [:]) else {
            problem = "Sign-in is not set up in this build: ios/project.yml, docs/DEPLOY.md"
            return
        }
        let outbox: Outbox
        do {
            guard let url = Outbox.appGroupURL else { throw CocoaError(.fileNoSuchFile) }
            outbox = try Outbox(at: url)
        } catch {
            problem = "The outbox could not be opened: \(error)"
            return
        }
        problem = nil
        let transport = URLSessionTransport()
        let signIn = SignIn(
            cognito: config.cognito, store: KeychainTokenStore(), transport: transport)
        let engine = await SyncEngine.make(
            outbox: outbox, api: config.api, signIn: signIn, transport: transport)
        #if DEBUG
            await engine.setTapCap(Bell.deviceCheckCap)
        #endif
        // The shields follow the engine from its first state — where the phone stood when the app
        // last ran, kept in the app group — so a relaunch never takes them off (B5).
        let enforcer = Enforcer(engine: engine, screenTime: PhoneScreenTime())
        (self.signIn, self.engine, self.enforcer) = (signIn, engine, enforcer)
        onPhase = ({ await engine.setForeground($0) }, { await enforcer.check() })
        Task { await engine.run() }
        Task { await enforcer.run() }
        Task { for await state in await engine.updates() { self.synced(state) } }
        Task {
            for await protection in await enforcer.updates() {
                self.protection = protection
                self.remember(protection)
            }
        }
        Task { for await signedIn in await signIn.signedIn() { self.signedIn = signedIn } }
        await engine.setForeground(foreground)
    }

    /// The scene's phase: the engine checks in only in the foreground, and coming back runs rule
    /// 3's check at once — Settings may have taken the permission. Each hop reads the phase as it
    /// is then, so two in quick succession can never leave the engine on the older one, nor run a
    /// check once the app has gone behind: its report refused by the suspended file, it would show
    /// a failure that is none.
    func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        guard let onPhase else { return }
        Task { await onPhase.engine(self.foreground) }
        if foreground { Task { if self.foreground { await onPhase.check() } } }
    }
}

#if DEBUG
    /// The device checks' (B5, B6; ios/README.md, rounds 1–4), in a sheet behind `RootView`'s
    /// Readout button: the engine's link, the sign-in, the standing, what rule 3's check found and
    /// the queue — with triggers beside the screens: the block's scan, and a typed tag for rounds
    /// 1–3. Debug builds only.
    struct Readout: View {
        let phone: Phone
        let signIn: SignIn
        let engine: SyncEngine
        let enforcer: Enforcer
        @Environment(\.webAuthenticationSession) private var browser
        @State private var note = ""
        @State private var code = ""
        @State private var tag = ""
        @State private var shortCap = Bell.deviceCheckCap != nil
        @State private var losesBell = Bell.deviceCheckLosesBell

        var body: some View {
            VStack(spacing: 4) {
                Text("Debug readout — temporary").bold()
                Text("Link: \(link)")
                Text("Server last answered: \(heard)")
                Text("Signed in: \(signedIn)")
                HStack {
                    Button("Sign in") { Task { note = await signingIn() } }
                    Button("Sign out") { Task { note = await signingOut() } }
                }
                Text("Standing: \(standing)")
                Text("Screen Time: \(shields)")
                Button("Allow Screen Time") {
                    run {
                        try await enforcer.requestPermission()
                        return "asked"
                    }
                }
                HStack {
                    TextField("Join code", text: $code)
                    Button("Join") { run { await join() } }.disabled(code.isEmpty)
                }
                // B6: the block read over NFC and tapped — or only read, to register it on dev.
                HStack {
                    Button("Scan") {
                        run {
                            let read = await BlockReader().read()
                            let tapped = try await engine.tap(read) != nil
                            return said(read, tapped ? "tap recorded" : "")
                        }
                    }
                    Button("Read block code") {
                        run { said(await BlockReader().read(), "read only, nothing recorded") }
                    }
                }
                HStack {
                    TextField("Block tag", text: $tag)
                    Button("Tap") { run { try await act(.tap(tagId: tag)) } }.disabled(tag.isEmpty)
                }
                // Filed where decision 11 says: under a tap not yet answered, else the session.
                if phone.sync?.emergencyUnlock(reason: nil) != nil {
                    Button("Emergency Unlock") {
                        run { try await engine.emergencyUnlock() == nil ? "nothing" : "recorded" }
                    }
                }
                Text("Outbox: \(queue)")
                Button("History") { run { await history() } }
                // B5b's device check: a tap not yet answered capped at the floor, not 50 minutes —
                // kept where the monitor reads it too — the bell's next wake lost on purpose, for
                // its backup (B5b-3), and what the monitor did at its last wakes, newest first,
                // since it can show nothing itself.
                Toggle("Cap a tap at 15 min (device check)", isOn: $shortCap)
                    .onChange(of: shortCap) { _, on in
                        Bell.deviceCheckCap = on ? Bell.floor : nil
                        Task { await engine.setTapCap(Bell.deviceCheckCap) }
                    }
                Toggle("Lose the bell's next wake (device check)", isOn: $losesBell)
                    .onChange(of: losesBell) { _, on in Bell.deviceCheckLosesBell = on }
                Text("Monitor: \(monitor)")
                Text(note)
            }
            .font(.footnote.monospaced())
            .buttonStyle(.bordered)
            .textFieldStyle(.roundedBorder)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding()
        }

        private var link: String {
            switch phone.sync?.link {
            case .reached?: "reached"
            case .unreachable?: "unreachable"
            case .signIn?: "sign-in"
            case .storageFailed?: "storage failed"
            case nil: "no exchange yet"
            }
        }

        private var heard: String {
            phone.sync?.heardAt?.formatted(date: .omitted, time: .standard) ?? "never"
        }

        private var signedIn: String {
            phone.signedIn.map { $0 ? "yes" : "no" } ?? "not known yet (the phone locked?)"
        }

        private var standing: String {
            switch phone.sync?.standing {
            case .inSession(let session, let state)?:
                "\(state?.rawValue ?? "unknown") until \(time(session.endsAt))"
            case .waiting?: "waiting for the teacher's Start"
            case .unread?: "not read from the phone yet — Emergency Unlock still works"
            case .out?, nil: "in no session"
            }
        }

        /// What rule 3's check found — never the standing alone.
        private var shields: String {
            guard let protection = phone.protection else { return "not checked yet" }
            var line =
                "\(protection.permission) · shields \(protection.shielded ? "on" : "off")"
                + (protection.until.map { ", due until \(time($0))" } ?? "")
                + (protection.unreported ? " · protection off NOT recorded" : "")
                + (protection.unscheduled ? " · bell NOT scheduled" : "")
            if let refused = protection.monitorUnscheduled {
                line += " · the monitor's bell NOT scheduled at \(time(refused)), app closed"
            }
            return line
        }

        private func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }

        /// What the monitor did at its last wakes, newest first — which window woke it, too.
        private var monitor: String {
            Bell.wakes.isEmpty ? "not woken yet" : Bell.wakes.joined(separator: "\n")
        }

        /// Runs a trigger, and says how it went.
        private func run(_ trigger: @escaping @MainActor () async throws -> String) {
            Task {
                do { note = try await trigger() } catch { note = "Failed: \(error)" }
            }
        }

        /// What the phone did, through the engine, as the screens will record it.
        private func act(_ change: Change) async throws -> String {
            try await engine.record(change) == nil ? "nothing new to send" : "recorded"
        }

        /// A scan, in words: a block's code and `then`, or why nothing was recorded.
        private func said(_ read: BlockRead, _ then: String) -> String {
            switch read {
            case .block(let code): "block \(code): \(then)"
            case .notBali: "not a Bali block — nothing recorded"
            case .cancelled: "scan cancelled — nothing recorded"
            case .unsupported: "this iPhone cannot read NFC — nothing recorded"
            case .failed(let why): "scan failed: \(why) — nothing recorded"
            }
        }

        /// What is queued, in the order the phone acted: a stuck record with its last answer.
        private var queue: String {
            let queued = (phone.sync?.queued ?? []).map { record in
                let kind =
                    switch record.change {
                    case .tap: "tap"
                    case .unlock: "unlock"
                    case .unlockUnderTap: "unlock under its tap"
                    case .unlockUnfiled: "unlock, its class not known yet"
                    case .refocus: "refocus"
                    case .protectionOff: "protection off"
                    }
                let answer = record.lastStatus.map { "\($0)" } ?? "no answer"
                return kind + (record.stuck ? " (stuck: \(answer))" : "")
            }
            return queued.isEmpty ? "empty" : queued.joined(separator: " · ")
        }

        /// The student's latest moments, as `GET /v1/me/history` gives them: newest first.
        private func history() async -> String {
            let page = await engine.client.history(limit: 5)
            guard let events = page.answer?.events else {
                return "history not read: \(page.result)"
            }
            return events.map { "\($0.type.rawValue) \(time($0.occurredAt))" }
                .joined(separator: " · ")
        }

        /// A class joined through the engine, as the Join screen joins one: in `me` at once.
        private func join() async -> String {
            let now = Date()
            let joined = await engine.join(
                EnrollmentJoinRequest(joinCode: code, eventId: EventID.mint(at: now), deviceTime: now))
            return joined.answer.map { "joined \($0.class.name)" }
                ?? "not joined: \(joined.result) \(joined.error?.error.message ?? "")"
        }

        /// Signs in through the hosted UI, in an ephemeral browser session: what happened.
        private func signingIn() async -> String {
            let (browser, scheme) = (browser, signIn.cognito.redirectURI.scheme ?? "")
            do {
                try await signIn.signIn { @MainActor url throws(SignInError) in
                    try await browser.hostedUI(url, scheme: scheme)
                }
                return "Signed in"
            } catch {
                return "Sign-in failed: \(error)"
            }
        }

        /// Signs out of this phone: what happened.
        private func signingOut() async -> String {
            do {
                try await signIn.signOut()
                return "Signed out"
            } catch {
                return "Sign-out failed: \(error)"
            }
        }
    }
#endif
