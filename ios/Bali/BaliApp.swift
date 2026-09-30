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
    /// The screens the student opened over the router's, in order (C3): Home, from Waiting's Back
    /// to home; Join, from Home's Join a class. Back closes the last; `synced`, as the state says.
    private(set) var opened: [Screen] = []
    /// Home's Tap in: a scan under way, and why the last recorded no tap (rule 5).
    private(set) var scanning = false
    private(set) var tapFailed: String?
    /// The tab chosen in D1's tab bar (C6a): the router's input, as `opened` is — Home, History or
    /// Me, honoured in place of its own Home only. Home again once `synced` closes what was opened,
    /// or who is signed in changes.
    private(set) var tab = Screen.home
    /// The History screen's (C6a): the moments read, and why a read did not finish. `reads` counts
    /// them, and the history forgotten, so an answer to a read the student has left is dropped.
    private(set) var history = History()
    private(set) var reads = 0
    /// The session whose Session over the student closed, as it was then (C5b): Home past its bell,
    /// until the bell moves — an extension rings one of its own (C5b's review).
    private(set) var sessionOverClosed: SessionView?
    /// The Me screen's (C6b): the name as the student edits it, and why the last Sign out did not
    /// finish (rule 5).
    var naming = Naming()
    private(set) var signOutFailed: String?
    /// Me's Leave (C6c): the class whose Leave was pressed, its question, and why the last leave
    /// did not finish.
    var leaving = Leaving()

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
            (opened, tab, history) = (fixture.opened, fixture.tab, fixture.history)
            (naming, signOutFailed) = (fixture.naming, fixture.signOutFailed)
            leaving = fixture.leaving
        }

        /// A phone over a sign-in and an engine a test made, never started (BaliTests): the calls
        /// `start` wires between them and the screens, tested over stand-ins for the Keychain and
        /// the server (C6a-2's and C6b-1's reviews).
        init(signIn: SignIn, engine: SyncEngine) { (self.signIn, self.engine) = (signIn, engine) }
    #endif

    /// The screen to show now, and whether D1's tab bar shows under it (C6a): `Screen.choose`, the
    /// one place that decides, over what the phone knows — asked once, so the two never disagree,
    /// at a bell either (C6a's review). The bar shows wherever the router honours a tab, but while
    /// Me shows its name being edited, whose ways on are Save and Cancel, and whose keyboard it
    /// would otherwise ride above (C6b). Anywhere else — Home, where a change of standing sends the
    /// tab mid-edit — it shows. A view drawing both reads this once.
    var shown: (screen: Screen, tabbed: Bool) {
        let shown = Screen.choose(
            problem: problem, introSeen: introSeen, signedIn: signedIn, protection: protection,
            everApproved: everApproved, sync: sync, hasClasses: hasClasses,
            sessionOverClosed: sessionOverClosed, opened: opened, tab: tab, now: Date())
        return (shown.screen, shown.tabbed && !(naming.editing && shown.screen == .me))
    }

    var screen: Screen { shown.screen }
    var tabbed: Bool { shown.tabbed }

    /// A tab chosen (C6a) — or `synced`'s Home. A change of tab forgets the history read, and any
    /// answer on its way, so History is read anew each time the student comes to it: its screen
    /// reads whenever it shows none (`readHistory`). The tab shown, chosen again, changes nothing
    /// (santa's round 1: nothing read a history forgotten so).
    func select(_ tab: Screen) {
        if tab != self.tab { forgetHistory() }
        self.tab = tab
    }

    /// Reads the student's history through the engine: from the top, or `more`, the page after
    /// those read. A phone whose engine has not started — a frozen one too — says so (rule 5).
    func readHistory(more: Bool = false) async {
        guard !history.busy, !more || history.nextBefore != nil else { return }
        guard let engine else { return history.failure = Joining.notStarted }
        let before = more ? history.nextBefore : nil
        if !more { forgetHistory() }
        (history.busy, history.failure, reads) = (true, nil, reads + 1)
        let read = reads
        await historyRead(await engine.history(before: before), for: read)
    }

    /// The answer to read `read`: kept while no read has started since nor the history been
    /// forgotten — a tab changed, a sign-out — and with a cursor the history does not hold, the
    /// history read again from the top.
    func historyRead(_ page: APIResponse<HistoryPage>, for read: Int) async {
        guard read == reads else { return }
        if history.answered(page) { await readHistory() }
    }

    /// No history read, and none under way that could still land: History's screen, gone from the
    /// phone by any way — a tab, or the router taking it away (Screen Time off, say) — forgets it,
    /// so it is read anew when it shows again (C6a-2's review).
    func forgetHistory() { (history, reads) = (History(), reads + 1) }

    /// Whose tokens these are (`SignIn.account`), the last one known: another student's sign-in
    /// is known by it, whether or not the sign-out between them was seen.
    private var account: String?

    /// Who is signed in, as the Keychain says — `account`, theirs, where the sign-in could say: a
    /// change starts the tabs over at Home, and the history read, a name being edited, a failed
    /// Sign out and a class code typed go with it; so, where another student signs in, does the
    /// engine's `me` — keyed on the account (C6b-1's review): a sign-out the stream let go by
    /// between two sign-ins is no matter. With no account to tell by, on a sign-in after a sign-out.
    /// Another student's is never shown (C6a, C6b).
    func signed(in signedIn: Bool?, as account: String? = nil) {
        let another =
            account.map { self.account != nil && $0 != self.account }
            ?? (signedIn == true && self.signedIn == false)
        if signedIn != self.signedIn || another {
            tab = .home
            forgetHistory()
            (naming, signOutFailed, leaving) = (Naming(), nil, Leaving())
            if !joining.busy { joining = Joining() }
        }
        if another { Task { await engine?.forgetMe() } }
        if let account { self.account = account }
        self.signedIn = signedIn
    }

    /// Saves the name as typed (`PATCH /v1/me`), through the engine: set, editing ends and the name
    /// is `me`'s; else why not, said under the field. A phone whose engine has not started — a
    /// frozen one too — says so (rule 5).
    func saveName() async {
        guard !naming.busy else { return }
        guard naming.complete else { return naming.failure = Naming.blank }
        guard let engine else { return naming.failure = Joining.notStarted }
        let request = naming.save(at: Date())
        let answer = await engine.rename(request)
        naming.saved(answer, for: request)
    }

    /// Leave class (C6c): the class asked about is left (`DELETE /v1/enrollments/{id}`, A19) through
    /// the engine — under its last try's event id while it is the same class's, so a try after no
    /// answer is its replay. Out, the class is gone from `me` at once; else why not, said under the
    /// question (rule 5). A phone whose engine has not started — a frozen one too — says so.
    func leave() async {
        guard leaving.asking != nil, !leaving.busy else { return }
        guard let engine else { return leaving.failure = Joining.notStarted }
        guard let sent = leaving.send(at: Date()) else { return }
        leaving.left(
            await engine.leave(enrollment: sent.enrollmentId, sent.request), for: sent.enrollmentId)
    }

    /// Me's Sign out (C6b): the sign-in's tokens forgotten — never where the phone stands, its
    /// shields or a queued record (B4) — so Sign in shows, or Focus while the shields are on. Never
    /// while an Emergency Unlock is unsent (`SignOutWords.held`, which the screen says), nor while
    /// the outbox file, asked itself, holds one or cannot say (santa's round 1: a failed read of
    /// the queue shows none); that, a Keychain that cannot forget the tokens now, or a phone not
    /// started, is said (rule 5).
    func signOut() async {
        // The last try's words go, whatever this one does: never two reasons at once (C6b-1's
        // review).
        signOutFailed = nil
        guard sync.flatMap(SignOutWords.held) == nil else { return }
        guard let signIn, let engine else { return signOutFailed = Joining.notStarted }
        switch await engine.unlockUnsent() {
        case false?: break
        case true?: return signOutFailed = SignOutWords.unsent
        case nil: return signOutFailed = SignOutWords.unread
        }
        do {
            try await signIn.signOut()
            signOutFailed = nil
        } catch {
            signOutFailed = SignOutWords.failed
        }
    }

    /// The bell of the session the phone stands in, where the router chooses again (C5a).
    var bell: Date? {
        if case .inSession(let session, _)? = sync?.standing { session.endsAt } else { nil }
    }

    /// Session over's Done (C5b): Home, until a read says where the phone stands. Only a session
    /// whose bell has rung by the phone's clock is closed: one a read put the phone in as Done was
    /// pressed is not the one that ended (C5b's review). Whether it closed one.
    @discardableResult
    func closeSessionOver() -> Bool {
        guard case .inSession(let session, _)? = sync?.standing, session.endsAt <= Date() else {
            return false
        }
        sessionOverClosed = session
        return true
    }

    /// Session over's See history (D1): closed, and History chosen — which the read after the bell
    /// keeps (`keepsOpened`; C5b's hand-off) — over anything opened before the bell, which the
    /// router would show in its place (santa's round 1). Nothing chosen where nothing closed: a
    /// read put the phone in a new class meanwhile.
    func seeHistory() {
        guard closeSessionOver() else { return }
        if opened.contains(.join), !joining.busy { joining = Joining() }
        opened = []
        select(.history)
    }

    /// Opens `screen` over what shows.
    func open(_ screen: Screen) { opened.append(screen) }

    /// Whether the screen shown was opened over another, so it draws a way back to it (C3).
    var canGoBack: Bool { opened.last == screen }

    /// Whether the screen shown offers Sign out (C6b): Me, and Join where it is the router's own —
    /// a student in no class reaches no tab bar, so not Me: signed in with the wrong account, it is
    /// their way out (the riders).
    var offersSignOut: Bool { screen == .me || screen == .join && !canGoBack }

    /// Back from the screen opened last. A Join closed starts over, unless a try is under way.
    func back() {
        guard let closed = opened.popLast() else { return }
        if closed == .join, !joining.busy { joining = Joining() }
    }

    /// The engine's state as it comes: the screens opened over another end as `keepsOpened` says,
    /// a Join among them starting over unless it still shows, the router's own now (santa, 2) —
    /// and the tab chosen with them, Home again (C6a).
    func synced(_ state: SyncState) {
        let keeps = state.keepsOpened(from: sync, at: Date())
        let wasHeld = sync.flatMap(SignOutWords.held) != nil
        sync = state
        // An unlock that held Sign out has gone: saying it has not would be stale — but only once
        // a hold ends: "unsent" is said where the file holds one the engine's queue does not show,
        // which the next publish would not change (Riders-2's santa, rounds 1 and 2).
        if signOutFailed == SignOutWords.unsent, wasHeld, SignOutWords.held(state) == nil {
            signOutFailed = nil
        }
        guard !keeps else { return }
        select(.home)
        guard !opened.isEmpty else { return }
        let hadJoin = opened.contains(.join)
        opened = []
        if hadJoin, screen != .join, !joining.busy { joining = Joining() }
    }

    /// Home's Tap in (B6's scan, `SyncEngine.tapIn`): a Bali block's code is the tap — recorded,
    /// shielded at once and sent — and anything else is said under the button (rule 5), nothing
    /// recorded. A phone whose engine has not started says so.
    func tapIn() async {
        guard !scanning else { return }
        guard let engine else { return tapFailed = Joining.notStarted }
        (tapFailed, scanning) = (nil, true)
        defer { scanning = false }
        tapFailed = await engine.tapIn(await BlockReader().read())
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
        joined(await engine.join(request))
    }

    /// A join's answer: in, a Join opened over Home closes, back to what it was opened over; else
    /// why not, said on it.
    func joined(_ answer: APIResponse<EnrollmentJoinResponse>) {
        joining.busy = false
        if joining.joined(answer), opened.last == .join { opened.removeLast() }
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

    /// Emergency Unlock (C4), always allowed: recorded where decision 11 files it — the shields off
    /// at once, the record queued, never waiting on the network — or why not (rule 5), which the
    /// screen says: a phone whose engine has not started, a frozen one too, an outbox refusing, or
    /// nothing left to unlock (`SyncEngine.pressUnlock`).
    func emergencyUnlock() async -> UnlockFailure? {
        guard let engine else { return .notStarted }
        return await engine.pressUnlock()
    }

    /// The reason for the latest Emergency Unlock (C5a), sent with it while it has never been
    /// sent — or what the Unlocked screen says (rule 5); a phone not started says so.
    func explain(_ reason: UnlockReason) async -> String? {
        guard let engine else { return Joining.notStarted }
        return await engine.explain(reason)
    }

    /// Back to focus from an Emergency Unlock (C5a) — or what the Unlocked screen says (rule 5).
    func backToFocus() async -> String? {
        guard let engine else { return Joining.notStarted }
        return await engine.backToFocus()
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
        Task {
            for await signedIn in await signIn.signedIn() {
                self.signed(in: signedIn, as: signedIn ? await signIn.account() : nil)
            }
        }
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
