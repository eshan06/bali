import Foundation

#if canImport(CryptoKit)
    import CryptoKit
#else
    import Crypto  // swift-crypto: CryptoKit's API where there is no CryptoKit (Linux, the tests)
#endif
#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

// B4: the student's sign-in (ARCHITECTURE, Auth, decision 1). Cognito's hosted UI signs them in —
// the authorization-code grant with PKCE (S256) and a state nonce, as the portal does it
// (`apps/web/src/lib/auth.ts`), over the phone's own public client: no secret anywhere, and no
// token in any URL. `SignIn` keeps the tokens: the API client's `TokenProvider`, and the sync
// engine's `refresh`. Only a real "no" signs anyone out — Cognito refusing the refresh token.

/// Where this build signs in: Cognito's hosted UI and the phone's app client — public values, set
/// per environment in the app's build settings (`ios/project.yml`).
public struct Cognito: Sendable, Hashable {
    /// The hosted UI: `https://<prefix>.auth.<region>.amazoncognito.com`.
    public let domain: URL
    public let clientId: String
    /// Where the hosted UI sends its answer, `bali://auth/callback`: the sign-in's browser session
    /// catches it itself, so no other app or page can hand one to the app.
    public let redirectURI: URL

    public init(domain: URL, clientId: String, redirectURI: URL) {
        (self.domain, self.clientId, self.redirectURI) = (domain, clientId, redirectURI)
    }

    /// The hosted UI's sign-in page for `attempt`: its challenge and state, never its verifier.
    func authorizeURL(_ attempt: Attempt) -> URL? {
        URL(
            string: endpoint("oauth2/authorize") + "?"
                + form([
                    ("response_type", "code"), ("client_id", clientId),
                    ("redirect_uri", redirectURI.absoluteString), ("scope", "openid email profile"),
                    ("state", attempt.state), ("code_challenge", attempt.challenge),
                    ("code_challenge_method", "S256"),
                ]))
    }

    /// The code in the hosted UI's answer, `callback`: only at the redirect URI, only for `attempt`.
    func code(from callback: URL, for attempt: Attempt) throws(SignInError) -> String {
        var answer = URLComponents(url: callback, resolvingAgainstBaseURL: false)
        let items = answer?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        answer?.query = nil
        guard answer?.url == redirectURI, value("state") == attempt.state else {
            throw .refused(nil)
        }
        if let error = value("error") { throw .refused(error) }
        guard let code = value("code"), !code.isEmpty else { throw .refused(nil) }
        return code
    }

    func endpoint(_ path: String) -> String {
        var root = domain.absoluteString
        while root.hasSuffix("/") { root.removeLast() }
        return root + "/" + path
    }
}

/// One sign-in attempt's secrets (RFC 7636): the verifier, which leaves the phone only for the
/// token endpoint, and the state, which binds the hosted UI's answer to this attempt.
struct Attempt: Sendable {
    let verifier: String
    let state: String

    init(verifier: String = random(bytes: 32), state: String = random(bytes: 16)) {
        (self.verifier, self.state) = (verifier, state)
    }

    /// base64url(SHA-256(verifier)), unpadded (§4.2).
    var challenge: String { base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
}

/// `count` bytes from the system's cryptographically secure generator, as base64url: 32 of them
/// make a 43-character verifier (§4.1).
func random(bytes count: Int) -> String {
    base64url(Data((0..<count).map { _ in UInt8.random(in: .min ... .max) }))
}

/// base64url, unpadded (RFC 4648 §5).
func base64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

/// `fields` as a query or a form body, each value escaped as the API client escapes a path.
func form(_ fields: [(String, String)]) -> String {
    fields.map { "\($0)=\(escaped($1))" }.joined(separator: "&")
}

/// Why a sign-in did not finish, for C1's screen, which says so and offers another try (rule 5).
public enum SignInError: Error, Sendable, Hashable {
    /// The student closed the sign-in page, or it could not open.
    case cancelled
    /// Cognito did not answer: no network, a timeout, a server error.
    case unreachable
    /// Cognito said no — its OAuth error, such as `access_denied` — or answered another attempt.
    case refused(String?)
    /// The phone could not keep the tokens (the Keychain refused them): nothing changed.
    case notKept
}

/// What `SignIn` keeps, in the Keychain between launches.
struct Tokens: Codable, Sendable {
    let access: String
    let refresh: String
    /// Until when, by the phone's clock, the access token is given: its own lifetime from when it
    /// came, less a margin. The lifetime is `exp` − `iat`, both the server's clock, so a phone clock
    /// set wrong never makes a fresh token look expired, nor an expired one fresh (the server owns
    /// the clock). One it cannot read is no expiry the phone knows: the API refusing the token
    /// renews it (`SignIn.refresh`).
    var until: Date

    init(access: String, refresh: String, at now: Date) {
        (self.access, self.refresh) = (access, refresh)
        until = Self.lifetime(of: access).map { now + $0 - SignIn.margin } ?? .distantFuture
    }

    /// `exp` − `iat` from the token's payload, unverified: the server verifies the token, and this
    /// only says when to stop sending it.
    static func lifetime(of token: String) -> TimeInterval? {
        struct Claims: Decodable { let iat, exp: TimeInterval }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        var payload = parts.count == 3 ? String(parts[1]) : ""
        payload = payload.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let json = Data(base64Encoded: payload),
            let claims = try? JSONDecoder().decode(Claims.self, from: json)
        else { return nil }
        return claims.exp - claims.iat
    }
}

/// The student's sign-in on this phone, and the tokens it keeps (B4): the API client's
/// `TokenProvider` and the sync engine's `refresh`. The app has one.
public actor SignIn: TokenProvider {
    /// How long before its expiry an access token stops being given, so one sent arrives in time.
    static let margin: TimeInterval = 60

    let cognito: Cognito
    let store: any TokenStore
    let transport: any HTTPTransport
    let now: @Sendable () -> Date
    /// The tokens, once the store could be read (`loaded`); nil when nobody is signed in.
    private var tokens: Tokens?
    private var loaded = false
    /// The renewal under way, which every caller shares.
    private var renewing: Task<Bool, Never>?
    private var tokenArrived: (@Sendable () async -> Void)?
    private var watchers: [UUID: AsyncStream<Bool>.Continuation] = [:]

    public init(
        cognito: Cognito, store: any TokenStore,
        transport: any HTTPTransport = URLSessionTransport(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        (self.cognito, self.store, self.transport, self.now) = (cognito, store, transport, now)
    }

    /// Runs `action` after every token but one the engine's `refresh` asked for — a sign-in, a
    /// renewal of the sign-in's own — so the engine sends everything again at once (`retryNow`).
    public func whenTokenArrives(_ action: @escaping @Sendable () async -> Void) {
        tokenArrived = action
    }

    /// The access token to send now. Nil when nobody is signed in, when the Keychain cannot be read
    /// right now (the phone locked), or when an expired one could not be renewed — never a
    /// sign-out, and never a token it knows has expired.
    public func accessToken() async -> String? {
        guard let tokens = current() else { return nil }
        if now() < tokens.until { return tokens.access }
        return await renew(telling: true) ? self.tokens?.access : nil
    }

    /// The engine's `refresh`, after the API refused the token it sent: that token is not given
    /// again, and a renewal is tried — true once a fresh one is ready. It never waits on the
    /// student: false when only a sign-in can give one.
    public func refresh() async -> Bool {
        guard current() != nil else { return false }
        tokens?.until = .distantPast
        return await renew(telling: false)
    }

    /// Signs the student in through Cognito's hosted UI, replacing any tokens the phone had.
    /// `browser` opens the sign-in page and returns where the hosted UI sent the student back —
    /// C1's ephemeral `ASWebAuthenticationSession`; the code in that answer is exchanged for tokens.
    public func signIn(through browser: @Sendable (URL) async throws -> URL)
        async throws(SignInError)
    {
        let attempt = Attempt()
        // It cannot fail — the domain is a URL and the rest is escaped — but were it to, nothing
        // is sent.
        guard let url = cognito.authorizeURL(attempt) else { throw .unreachable }
        let callback: URL
        do { callback = try await browser(url) } catch { throw .cancelled }
        let code = try cognito.code(from: callback, for: attempt)
        let grant = try await exchange([
            ("grant_type", "authorization_code"), ("client_id", cognito.clientId), ("code", code),
            ("redirect_uri", cognito.redirectURI.absoluteString),
            ("code_verifier", attempt.verifier),
        ]).get()
        guard let refresh = grant.refresh else { throw .refused(nil) }
        let tokens = Tokens(access: grant.access, refresh: refresh, at: now())
        guard (try? store.save(JSONEncoder().encode(tokens))) != nil else { throw .notKept }
        adopt(tokens)
        await tokenArrived?()
    }

    /// Signs the student out of this phone: the tokens are forgotten — never a queued record, which
    /// waits for the next sign-in. Throws when the Keychain cannot forget them right now; then
    /// nothing changed, and the screen says so (rule 5).
    public func signOut() throws {
        try store.clear()
        adopt(nil)
    }

    /// Whether someone is signed in on this phone: now — once the Keychain could be read — then at
    /// each change. C1 shows its sign-in screen when not; a token that cannot be given right now
    /// (offline, the phone locked) is still signed in.
    public func signedIn() -> AsyncStream<Bool> {
        let (stream, watcher) = AsyncStream.makeStream(
            of: Bool.self, bufferingPolicy: .bufferingNewest(1))
        _ = current()
        if loaded { watcher.yield(tokens != nil) }
        let id = UUID()
        watchers[id] = watcher
        watcher.onTermination = { _ in Task { await self.unwatch(id) } }
        return stream
    }

    private func unwatch(_ id: UUID) { watchers[id] = nil }

    /// The tokens, read from the store the first time it can be read. One that cannot be read right
    /// now — the Keychain while the phone is locked — is read again next time: never a sign-out.
    /// Tokens it cannot decode are none: the student signs in again.
    private func current() -> Tokens? {
        guard !loaded else { return tokens }
        do {
            let stored = try store.load()
            adopt(stored.flatMap { try? JSONDecoder().decode(Tokens.self, from: $0) })
        } catch {}
        return tokens
    }

    /// The phone's tokens from now on — nil: signed out — told to every watcher.
    private func adopt(_ tokens: Tokens?) {
        (self.tokens, loaded) = (tokens, true)
        for watcher in watchers.values { watcher.yield(tokens != nil) }
    }

    /// A renewal with the refresh token, one at a time, which every caller shares — `telling` the
    /// engine of its token unless the engine's own `refresh` asked for it.
    private func renew(telling: Bool) async -> Bool {
        if let renewing { return await renewing.value }
        let task = Task { await self.renewal(telling: telling) }
        renewing = task
        defer { renewing = nil }
        return await task.value
    }

    private func renewal(telling: Bool) async -> Bool {
        guard let refresh = tokens?.refresh else { return false }
        let answer = await exchange([
            ("grant_type", "refresh_token"), ("client_id", cognito.clientId),
            ("refresh_token", refresh),
        ])
        // Signed out, or in again, while it ran: the answer is about tokens the phone let go.
        guard tokens?.refresh == refresh else { return tokens != nil }
        switch answer {
        case .success(let grant):
            // The refresh token stays Cognito's own unless the client rotates it, so the store keeps
            // working with the one it has whether or not the fresh access token lands in it.
            let fresh = Tokens(access: grant.access, refresh: grant.refresh ?? refresh, at: now())
            _ = try? store.save(JSONEncoder().encode(fresh))
            adopt(fresh)
            if telling { await tokenArrived?() }
            return true
        case .failure(.refused("invalid_grant")):
            // The one real "no": Cognito refused the refresh token — revoked, expired, the account
            // gone. Signed out, and nothing else: every queued record waits for the next sign-in.
            _ = try? store.clear()
            adopt(nil)
            return false
        case .failure:
            // No answer, a server error, another refusal: no "no" about this student. The tokens
            // are kept, and the next request tries again.
            return false
        }
    }

    /// The token endpoint's answer to `fields` (RFC 6749 §4.1.3, §6): the tokens on a 2xx, its
    /// OAuth error on a 4xx — a refusal — and anything else no answer (a 5xx, a proxy's page).
    private func exchange(_ fields: [(String, String)]) async
        -> Result<(access: String, refresh: String?), SignInError>
    {
        struct Answer: Decodable { let accessToken, refreshToken, error: String? }
        guard let url = URL(string: cognito.endpoint("oauth2/token")) else {
            return .failure(.unreachable)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = APIClient.requestTimeout
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(form(fields).utf8)
        guard let exchanged = try? await transport.send(request) else {
            return .failure(.unreachable)
        }
        let (body, response) = exchanged
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let answer = try? decoder.decode(Answer.self, from: body)
        switch (response.statusCode, answer?.accessToken, answer?.error) {
        case (200..<300, let access?, _): return .success((access, answer?.refreshToken))
        case (400..<500, _, let error?): return .failure(.refused(error))
        default: return .failure(.unreachable)
        }
    }
}
