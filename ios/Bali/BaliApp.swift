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

/// The app's one sign-in and one sync engine, started once for the app's life.
@MainActor @Observable
final class Phone {
    private(set) var signIn: SignIn?
    private(set) var engine: SyncEngine?
    private(set) var signedIn = false
    /// Why the engine did not start, shown (rule 5).
    private(set) var problem: String?
    private var foreground = false
    private var started = false

    func start() async {
        guard !started else { return }
        started = true
        let api = Bundle.main.setting("BaliAPIURL").flatMap(URL.init(string:))
        guard let cognito = Cognito.thisBuild, let api else {
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
        let transport = URLSessionTransport()
        let signIn = SignIn(cognito: cognito, store: KeychainTokenStore(), transport: transport)
        let engine = await SyncEngine.make(
            outbox: outbox, api: api, signIn: signIn, transport: transport)
        (self.signIn, self.engine) = (signIn, engine)
        Task { await engine.run() }
        await engine.setForeground(foreground)
        for await signedIn in await signIn.signedIn() { self.signedIn = signedIn }
    }

    /// The scene's phase: the engine checks in only in the foreground.
    func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        guard let engine else { return }
        Task { await engine.setForeground(foreground) }
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
    @Environment(\.webAuthenticationSession) private var browser
    @State private var note = ""

    var body: some View {
        VStack(spacing: 8) {
            Text("Bali").font(.largeTitle)
            // "BaliCore.APIClient" and "BaliOutbox.Outbox", read from the packages' own types.
            Text(String(reflecting: APIClient.self)).font(.body.monospaced())
            Text(String(reflecting: Outbox.self)).font(.body.monospaced())
            Text("Build \(BaliApp.version)").font(.footnote).foregroundStyle(.secondary)
            if let problem = phone.problem { Text(problem).foregroundStyle(.red) }
            #if DEBUG
                // B4's trigger, until C1 draws the sign-in screen.
                if let signIn = phone.signIn {
                    Button(phone.signedIn ? "Sign out" : "Sign in") {
                        Task { note = await toggle(signIn) }
                    }
                    Text(note).font(.footnote)
                }
            #endif
        }
    }

    #if DEBUG
        /// Signs in through the hosted UI in an ephemeral browser session, or out: what happened.
        private func toggle(_ signIn: SignIn) async -> String {
            let (browser, scheme) = (browser, signIn.cognito.redirectURI.scheme ?? "")
            do {
                if phone.signedIn {
                    try await signIn.signOut()
                    return "Signed out"
                }
                try await signIn.signIn { @MainActor url in
                    try await browser.authenticate(
                        using: url, callbackURLScheme: scheme, preferredBrowserSession: .ephemeral)
                }
                return "Signed in"
            } catch {
                return "\(error)"
            }
        }
    #endif
}
