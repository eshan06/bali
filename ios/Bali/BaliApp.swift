import AuthenticationServices
import BaliCore
import BaliOutbox
import SwiftUI

// The student app (ARCHITECTURE, "iOS app structure"). A placeholder until its screens (C1–C6): it
// shows that BaliCore and BaliOutbox are linked in and which build this is, and it starts the app's
// one sync engine over the student's Cognito sign-in (B4).
@main
struct BaliApp: App {
    @Environment(\.scenePhase) private var phase
    @State private var phone = Phone()

    var body: some Scene {
        WindowGroup {
            Placeholder(phone: phone).task { await phone.start() }
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
    private var foreground = false
    private var starting = false

    /// Starts the sign-in, the engine and the enforcer, unless they run already: a start that
    /// failed can be tried again.
    func start() async {
        guard engine == nil, !starting else { return }
        starting = true
        defer { starting = false }
        guard let cognito = Cognito.thisBuild,
            let api = Bundle.main.setting("BaliAPIURL").flatMap(URL.init(string:))
        else {
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
        let signIn = SignIn(cognito: cognito, store: KeychainTokenStore(), transport: transport)
        let engine = await SyncEngine.make(
            outbox: outbox, api: api, signIn: signIn, transport: transport)
        #if DEBUG
            await engine.setTapCap(Bell.deviceCheckCap)
        #endif
        // The shields follow the engine from its first state — where the phone stood when the app
        // last ran, kept in the app group — so a relaunch never takes them off (B5).
        let enforcer = Enforcer(engine: engine, screenTime: PhoneScreenTime())
        (self.signIn, self.engine, self.enforcer) = (signIn, engine, enforcer)
        Task { await engine.run() }
        Task { await enforcer.run() }
        Task { for await state in await engine.updates() { self.sync = state } }
        Task { for await protection in await enforcer.updates() { self.protection = protection } }
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
        guard let engine else { return }
        Task { await engine.setForeground(self.foreground) }
        if foreground, let enforcer { Task { if self.foreground { await enforcer.check() } } }
    }
}

extension Cognito {
    /// This build's, from its Info.plist — `ios/project.yml`'s settings; nil while one is not set.
    static var thisBuild: Cognito? {
        guard let domain = Bundle.main.setting("BaliCognitoDomain").flatMap(URL.init(string:)),
            let clientId = Bundle.main.setting("BaliCognitoClientID"),
            let redirect = Bundle.main.setting("BaliCognitoRedirectURI").flatMap(URL.init(string:))
        else { return nil }
        return Cognito(domain: domain, clientId: clientId, redirectURI: redirect)
    }
}

extension Bundle {
    /// The Info.plist's `key` as the build set it; nil when it is empty.
    func setting(_ key: String) -> String? {
        (object(forInfoDictionaryKey: key) as? String).flatMap { $0.isEmpty ? nil : $0 }
    }
}

struct Placeholder: View {
    let phone: Phone

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Bali").font(.largeTitle)
                // "BaliCore.APIClient" and "BaliOutbox.Outbox", read from the packages' own types.
                Text(String(reflecting: APIClient.self)).font(.body.monospaced())
                Text(String(reflecting: Outbox.self)).font(.body.monospaced())
                Text("Build \(BaliApp.version)").font(.footnote).foregroundStyle(.secondary)
                if let problem = phone.problem {
                    Text(problem).foregroundStyle(.red)
                    Button("Try again") { Task { await phone.start() } }
                }
                #if DEBUG
                    if let signIn = phone.signIn, let engine = phone.engine,
                        let enforcer = phone.enforcer
                    {
                        Readout(phone: phone, signIn: signIn, engine: engine, enforcer: enforcer)
                    }
                #endif
            }
        }
    }
}

#if DEBUG
    /// Temporary, for B5's device check, until C1–C6 draw the real screens and B6 reads the block:
    /// the engine's link, the sign-in, the standing and what rule 3's check found — with triggers in
    /// place of the screens and the NFC tap. Debug builds only.
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
                HStack {
                    TextField("Block tag", text: $tag)
                    Button("Tap") { run { try await act(.tap(tagId: tag)) } }.disabled(tag.isEmpty)
                }
                if case .inSession(let session, _) = phone.sync?.standing {
                    Button("Emergency Unlock") {
                        run { try await act(.unlock(session: session.id, reason: nil)) }
                    }
                }
                // B5b's device check: a tap not yet answered capped at the floor, not 50 minutes —
                // kept where the monitor reads it too — and what the monitor did at its last wake,
                // since it can show nothing itself.
                Toggle("Cap a tap at 15 min (device check)", isOn: $shortCap)
                    .onChange(of: shortCap) { _, on in
                        Bell.deviceCheckCap = on ? Bell.floor : nil
                        Task { await engine.setTapCap(Bell.deviceCheckCap) }
                    }
                Text("Monitor: \(Bell.lastWake ?? "not woken yet")")
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
            case .unread?: "not read from the phone yet — shields left as they were"
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

        /// Runs a trigger, and says how it went.
        private func run(_ trigger: @escaping @MainActor () async throws -> String) {
            Task {
                do { note = try await trigger() } catch { note = "Failed: \(error)" }
            }
        }

        /// What the phone did, through the engine, as the NFC tap and the screens will record it.
        private func act(_ change: Change) async throws -> String {
            try await engine.record(change) == nil ? "nothing new to send" : "recorded"
        }

        private func join() async -> String {
            let now = Date()
            let joined = await engine.client.join(
                EnrollmentJoinRequest(joinCode: code, eventId: EventID.mint(at: now), deviceTime: now))
            return joined.answer.map { "joined \($0.class.name)" }
                ?? "not joined: \(joined.result) \(joined.error?.error.message ?? "")"
        }

        /// Signs in through the hosted UI, in an ephemeral browser session: what happened.
        private func signingIn() async -> String {
            let (browser, scheme) = (browser, signIn.cognito.redirectURI.scheme ?? "")
            do {
                try await signIn.signIn { @MainActor url in
                    try await browser.authenticate(
                        using: url, callbackURLScheme: scheme, preferredBrowserSession: .ephemeral)
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
