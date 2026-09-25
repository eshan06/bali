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

/// The app's one sign-in and one sync engine, started once for the app's life, and what they say.
@MainActor @Observable
final class Phone {
    private(set) var signIn: SignIn?
    private(set) var engine: SyncEngine?
    /// Whether someone is signed in; nil until the Keychain can be read (the phone locked).
    private(set) var signedIn: Bool?
    /// The engine's state, for the screens; nil until it starts.
    private(set) var sync: SyncState?
    /// Why the engine did not start, shown with a way to try again (rule 5).
    private(set) var problem: String?
    private var foreground = false
    private var starting = false

    /// Starts the sign-in and the engine, unless they run already: a start that failed can be tried
    /// again.
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
        (self.signIn, self.engine) = (signIn, engine)
        Task { await engine.run() }
        Task { for await state in await engine.updates() { self.sync = state } }
        Task { for await signedIn in await signIn.signedIn() { self.signedIn = signedIn } }
        await engine.setForeground(foreground)
    }

    /// The scene's phase: the engine checks in only in the foreground. Each hop sends the phase as
    /// it is then, so two in quick succession can never leave the engine on the older one.
    func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        guard let engine else { return }
        Task { await engine.setForeground(self.foreground) }
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
                if let signIn = phone.signIn { Readout(phone: phone, signIn: signIn) }
            #endif
        }
    }
}

#if DEBUG
    /// Temporary, for B5's device check, until C1–C6 draw the real screens: whether the engine
    /// reaches the API and when it last answered, whether someone is signed in, and the sign-in's
    /// trigger. Debug builds only.
    struct Readout: View {
        let phone: Phone
        let signIn: SignIn
        @Environment(\.webAuthenticationSession) private var browser
        @State private var note = ""

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
                .buttonStyle(.bordered)
                Text(note)
            }
            .font(.footnote.monospaced())
            .padding(.top)
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
