import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

// B4's contract with the engine, over the real sign-in: the engine made as the app makes it
// (`SyncEngine.make`), Cognito's token endpoint and the API both answered by hand, and a clock the
// test moves.

let tokenRoute = "POST /oauth2/token"

/// An access token as Cognito's reads on the phone: `iat` and `exp` in its payload, unsigned.
func accessToken(_ name: String) -> String {
    let payload = #"{"sub":"\#(name)","iat":1000000000,"exp":1000003600}"#
    let encoded = Data(payload.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJSUzI1NiJ9.\(encoded).signature"
}

/// The token endpoint's answer; a refresh token only when given.
func grant(_ access: String, refresh: String? = nil) -> String {
    let refresh = refresh.map { #""refresh_token":"\#($0)","# } ?? ""
    return #"{"access_token":"\#(access)",\#(refresh)"expires_in":3600,"token_type":"Bearer"}"#
}

/// The Keychain's stand-in.
final class MemoryKeychain: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var saved: Data?
    var isEmpty: Bool { lock.withLock { saved == nil } }
    func load() throws -> Data? { lock.withLock { saved } }
    func save(_ tokens: Data) throws { lock.withLock { saved = tokens } }
    func clear() throws { lock.withLock { saved = nil } }
}

/// The hosted UI, handing back a code for the attempt it was opened for.
let hostedUI: @Sendable (URL) async throws -> URL = { url in
    let state =
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "state" }?.value ?? ""
    return URL(string: "bali://auth/callback?code=the-code&state=\(state)")!
}

/// An engine as the app starts it, over the student's sign-in, with nobody signed in yet.
struct SignedRig {
    let engine: SyncEngine
    let signIn: SignIn
    let outbox: Outbox
    let server = Server()
    let clock = TestClock()
    let keychain = MemoryKeychain()
    let running: Task<Void, Never>

    init() async throws {
        outbox = try makeOutbox().outbox
        let cognito = Cognito(
            domain: URL(string: "https://bali-dev.auth.us-east-1.amazoncognito.com")!,
            clientId: "phone-client", redirectURI: URL(string: "bali://auth/callback")!)
        let clock = clock
        signIn = SignIn(cognito: cognito, store: keychain, transport: server, now: { clock.now() })
        let engine = await SyncEngine.make(
            outbox: outbox, api: URL(string: "https://api.bali.test")!, signIn: signIn,
            transport: server, clock: clock)
        self.engine = engine
        running = Task { await engine.run() }
    }

    /// The student signs in, Cognito answering with `access`.
    func signStudentIn(_ access: String, refresh: String = "refresh-1") async throws {
        let signIn = self.signIn
        let signingIn = Task { try await signIn.signIn(through: hostedUI) }
        try await server.next(tokenRoute).reply(200, grant(access, refresh: refresh))
        try await signingIn.value
    }

    /// Waits for a state `condition` holds for; none in time fails the test.
    @discardableResult
    func until(_ condition: @escaping @Sendable (SyncState) -> Bool) async -> SyncState {
        let engine = self.engine
        let reached = await withTaskGroup(of: SyncState?.self) { group in
            group.addTask {
                for await state in await engine.updates() where condition(state) { return state }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: patience)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        if let reached { return reached }
        Issue.record("the engine never reached the state waited for")
        return await engine.state
    }

    func stop() async {
        running.cancel()
        await server.close()
        await running.value
    }
}

@Suite("B4's contract with the engine, over the real sign-in", .timeLimit(.minutes(3)))
struct SignInEngineTests {
    @Test("Signed out, a record waits on sign-in, never dropped; the sign-in sends it at once")
    func signInSendsAtOnce() async throws {
        let rig = try await SignedRig()
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        await rig.until { $0.link == .signIn && $0.retryAt == at(60) }
        #expect(await rig.server.waiting.isEmpty)
        // Read from another module without a hop, as the app reads its browser session's scheme.
        #expect(rig.signIn.cognito.redirectURI.scheme == "bali")

        try await rig.signStudentIn(accessToken("a1"))
        let sent = try await rig.server.next(unlockRoute)
        #expect(sent.eventId == unlock.eventId && sent.token == "Bearer \(accessToken("a1"))")
        #expect(rig.clock.now() == t0)  // at once, not a minute on
        await rig.stop()
    }

    @Test(
        "A 401: the sign-in renews the token with its refresh token, and everything goes again at once"
    )
    func reauthRenews() async throws {
        let rig = try await SignedRig()
        try await rig.signStudentIn(accessToken("a1"))
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.server.next(unlockRoute).reply(401)

        let renewal = try await rig.server.next(tokenRoute)
        let form = String(decoding: renewal.request.httpBody ?? Data(), as: UTF8.self)
        #expect(
            form.contains("grant_type=refresh_token") && form.contains("refresh_token=refresh-1"))
        renewal.reply(200, grant(accessToken("a2")))
        let again = try await rig.server.next(unlockRoute)
        #expect(again.eventId == unlock.eventId && again.token == "Bearer \(accessToken("a2"))")
        #expect(rig.clock.now() == t0)
        again.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "Cognito refusing the refresh token signs the student out: the record is kept, sends nothing, and goes at the next sign-in"
    )
    func refusedWaitsForSignIn() async throws {
        let rig = try await SignedRig()
        try await rig.signStudentIn(accessToken("a1"))
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.server.next(unlockRoute).reply(401)
        try await rig.server.next(tokenRoute).reply(400, #"{"error":"invalid_grant"}"#)

        // Signed out: the record backs off as a rejection, then waits on sign-in, unsent.
        await rig.until { $0.link == .signIn && $0.retryAt == at(2) }
        #expect(rig.keychain.isEmpty)
        rig.clock.advance(by: 2)
        await rig.until { $0.retryAt == at(62) }
        #expect(await rig.server.waiting.allSatisfy { $0 == meRoute })
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])

        try await rig.signStudentIn(accessToken("a3"), refresh: "refresh-2")
        let sent = try await rig.server.next(unlockRoute)
        #expect(sent.eventId == unlock.eventId && sent.token == "Bearer \(accessToken("a3"))")
        #expect(rig.clock.now() == at(2))
        await rig.stop()
    }

    @Test("A token the sign-in renews on its own sends what waited on it at once")
    func ownRenewalSendsAtOnce() async throws {
        let rig = try await SignedRig()
        try await rig.signStudentIn(accessToken("a1"))
        // The sign-in's re-read goes out with a1 before the clock moves: the only renewal next is
        // the drain's, not one the re-read would start and the test answer in its place.
        _ = try await rig.server.next(meRoute)
        rig.clock.advance(by: 3600)  // a1 has expired
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        // The drain's own request found it expired and renewed it first: Cognito out of reach, so
        // no token — the record waits on sign-in, unsent.
        try await rig.server.next(tokenRoute).reply(nil)
        await rig.until { $0.link == .signIn && $0.retryAt == at(3660) }

        // A screen's own call through the engine's client renews it.
        let client = rig.engine.client
        let screen = Task { await client.me() }
        try await rig.server.next(tokenRoute).reply(200, grant(accessToken("a2")))
        let sent = try await rig.server.next(unlockRoute)
        #expect(sent.eventId == unlock.eventId && sent.token == "Bearer \(accessToken("a2"))")
        #expect(rig.clock.now() == at(3600))  // at once, not the minute the drain waits
        await rig.stop()
        _ = await screen.value
    }
}
