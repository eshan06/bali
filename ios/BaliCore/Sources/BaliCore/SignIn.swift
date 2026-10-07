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

    /// The hosted UI's sign-in page for `attempt`: its challenge and state, never its verifier. Its
    /// scopes are OpenID's and the one Cognito's DeleteUser needs (C4), which the phone's app client
    /// must allow, or the sign-in is refused.
    func authorizeURL(_ attempt: Attempt) -> URL? {
        URL(
            string: endpoint("oauth2/authorize") + "?"
                + form([
                    ("response_type", "code"), ("client_id", clientId),
                    ("redirect_uri", redirectURI.absoluteString),
                    ("scope", "openid email profile \(SignIn.deleteScope)"),
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

/// `count` random bytes as base64url, generated as a key is — by CryptoKit, or swift-crypto where
/// there is none — so they are cryptographically random by contract, where the standard library's
/// generator promises it only "whenever possible". 32 of them make a 43-character verifier (§4.1).
func random(bytes count: Int) -> String {
    let key = SymmetricKey(size: SymmetricKeySize(bitCount: count * 8))
    return base64url(key.withUnsafeBytes { Data($0) })
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
    /// The student closed the sign-in page: nothing changed.
    case cancelled
    /// The sign-in page could not open, or ended on its own — what the browser said, for the
    /// readout. The app's browser tells the two apart (C1b): only its own cancel is `cancelled`.
    case notOpened(String)
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
    /// The account's email, as the ID token in the same answer named it (#147): whose sign-in this
    /// is, for Me to say. Nil when it named none — and in tokens a build before it kept, until
    /// their first renewal. Asked for by `init`, with no default, so no way of making tokens can
    /// leave it out unseen (#159's review).
    let email: String?
    /// Until when, by the phone's clock, the access token is given: its own lifetime from when it
    /// came, less a margin. The lifetime is `exp` − `iat`, both the server's clock, so a phone clock
    /// set wrong never makes a fresh token look expired, nor an expired one fresh (the server owns
    /// the clock). One it cannot read is no expiry the phone knows: the API refusing the token
    /// renews it (`SignIn.refresh`).
    var until: Date
    /// The API has deleted the account and its Cognito sign-in waits to be (C4): no token goes to the
    /// API from then on — a request there makes a fresh account under the same sign-in — and only
    /// Cognito's DeleteUser takes one. Kept through a renewal; nil in tokens kept before it.
    var deleted: Bool?

    init(access: String, refresh: String, email: String?, at now: Date) {
        (self.access, self.refresh, self.email) = (access, refresh, email)
        until = Self.lifetime(of: access).map { now + $0 - SignIn.margin } ?? .distantFuture
    }

    /// `exp` − `iat` from the token's payload, unverified: the server verifies the token, and this
    /// only says when to stop sending it.
    static func lifetime(of token: String) -> TimeInterval? {
        struct Claims: Decodable { let iat, exp: TimeInterval }
        return claims(Claims.self, of: token).map { $0.exp - $0.iat }
    }

    /// `sub` from the token's payload, unverified: only ever to tell one account from another.
    static func subject(of token: String) -> String? {
        struct Claims: Decodable { let sub: String }
        return claims(Claims.self, of: token)?.sub
    }

    /// `email` from an ID token's payload, unverified: only ever shown, to say whose sign-in this is.
    static func email(of token: String) -> String? {
        struct Claims: Decodable { let email: String }
        return claims(Claims.self, of: token)?.email
    }

    /// Where the sign-in that gave access token `token` deletes itself (C4): Cognito's own endpoint
    /// in its pool's region, read unverified from its issuer and taken only when that is one,
    /// `cognito-idp.<region>.amazonaws.com` — so the token is sent nowhere else — while its scopes
    /// hold the one DeleteUser needs. Nil otherwise: a sign-in made before the phone asked for that
    /// scope, whose renewals keep the scopes it got.
    static func deleteEndpoint(of token: String) -> URL? {
        struct Claims: Decodable { let scope, iss: String }
        guard let claims = claims(Claims.self, of: token),
            claims.scope.split(separator: " ").contains(where: { $0 == SignIn.deleteScope }),
            let host = URLComponents(string: claims.iss)?.host,
            host.wholeMatch(of: /cognito-idp\.[a-z]{2}(-[a-z]+)+-[0-9]+\.amazonaws\.com/) != nil
        else { return nil }
        return URL(string: "https://\(host)/")
    }

    /// The token's payload read as `T`, unverified; nil when it cannot be.
    private static func claims<T: Decodable>(_ type: T.Type, of token: String) -> T? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        var payload = parts.count == 3 ? String(parts[1]) : ""
        payload = payload.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let json = Data(base64Encoded: payload) else { return nil }
        return try? JSONDecoder().decode(T.self, from: json)
    }
}

/// The student's sign-in on this phone, and the tokens it keeps (B4): the API client's
/// `TokenProvider` and the sync engine's `refresh`. The app has one.
public actor SignIn: TokenProvider {
    /// How long before its expiry an access token stops being given, so one sent arrives in time.
    static let margin: TimeInterval = 60
    /// The scope Cognito's DeleteUser needs in the access token it is given (C4).
    static let deleteScope = "aws.cognito.signin.user.admin"

    /// Nonisolated, so the app reads it without a hop: an actor's `let` is isolated outside its
    /// module.
    public nonisolated let cognito: Cognito
    let store: any TokenStore
    let transport: any HTTPTransport
    let now: @Sendable () -> Date
    /// Whether the phone's 13+ check has passed (C7), asked at each token the API is to be given:
    /// until it has, none is, but an account deletion's (`deletionToken`). So a sign-in made around
    /// the question — on Cognito's own pages, whose sign-in page links to its sign-up — reaches
    /// Bali's API with nothing until it is answered, and an answer under 13 deletes its account as
    /// Delete account does (the owner's decision, 2026-10-06).
    let cleared: @Sendable () -> Bool
    /// The tokens, once the store could be read (`loaded`); nil when nobody is signed in.
    private var tokens: Tokens?
    private var loaded = false
    /// The store is behind `tokens`, and catches up at the next ask: what the Keychain could not
    /// take then (the phone locked) is saved — a refresh token Cognito rotated is kept nowhere
    /// else — and a sign-out it could not make then is made. Only while the app runs: ended before
    /// that ask, it leaves the refresh token Cognito refused in the Keychain, and the next launch
    /// reads someone signed in until that token's renewal is refused again — the same no, one
    /// round trip late, and no queued record touched.
    private var unsaved = false
    /// The renewal under way, which every caller shares.
    private var renewing: Task<Bool, Never>?
    private var tokenArrived: (@Sendable () async -> Void)?
    private var watchers: [UUID: AsyncStream<Bool>.Continuation] = [:]

    public init(
        cognito: Cognito, store: any TokenStore,
        transport: any HTTPTransport = URLSessionTransport(),
        now: @escaping @Sendable () -> Date = { Date() },
        cleared: @escaping @Sendable () -> Bool = { true }
    ) {
        (self.cognito, self.store, self.transport, self.now) = (cognito, store, transport, now)
        self.cleared = cleared
    }

    /// Runs `action` after every token but one the engine's `refresh` asked for — a sign-in, a
    /// renewal of the sign-in's own — so the engine sends everything again at once (`retryNow`).
    public func whenTokenArrives(_ action: @escaping @Sendable () async -> Void) {
        tokenArrived = action
    }

    /// The access token to send now. Nil when nobody is signed in, when the Keychain cannot be read
    /// right now (the phone locked), when an expired one could not be renewed — never a sign-out,
    /// and never a token it knows has expired — once the API has deleted the account (C4), and
    /// while the phone's 13+ check has not passed (`cleared`).
    public func accessToken() async -> String? {
        cleared() ? await deletionToken() : nil
    }

    /// An account deletion's token (`TokenProvider.deletionToken`): the access token, the 13+ check
    /// passed or not.
    public func deletionToken() async -> String? {
        guard let tokens = current(), tokens.deleted != true else { return nil }
        if now() < tokens.until { return tokens.access }
        return await renew(telling: true) ? self.tokens?.access : nil
    }

    /// The engine's `refresh`, after the API refused the token it sent: that token is not given
    /// again — nor after a relaunch, so the store is told too — and a renewal is tried: true once a
    /// fresh one is ready. It never waits on the student: false when only a sign-in can give one.
    public func refresh() async -> Bool {
        guard current() != nil else { return false }
        tokens?.until = .distantPast
        unsaved = !keep(tokens)
        return await renew(telling: false)
    }

    /// Signs the student in through Cognito's hosted UI, replacing any tokens the phone had.
    /// `browser` opens the sign-in page and returns where the hosted UI sent the student back —
    /// C1's ephemeral `ASWebAuthenticationSession` — or throws why it did not, in its own words:
    /// the student's close `cancelled`, anything else `notOpened`; the code in that answer is
    /// exchanged for tokens.
    public func signIn(through browser: @Sendable (URL) async throws(SignInError) -> URL)
        async throws(SignInError)
    {
        let attempt = Attempt()
        // It cannot fail — the domain is a URL and the rest is escaped — but were it to, nothing
        // is sent.
        guard let url = cognito.authorizeURL(attempt) else { throw .unreachable }
        let callback = try await browser(url)
        let code = try cognito.code(from: callback, for: attempt)
        let grant = try await exchange([
            ("grant_type", "authorization_code"), ("client_id", cognito.clientId), ("code", code),
            ("redirect_uri", cognito.redirectURI.absoluteString),
            ("code_verifier", attempt.verifier),
        ]).get()
        guard let refresh = grant.refresh else { throw .refused(nil) }
        let tokens = Tokens(access: grant.access, refresh: refresh, email: grant.email, at: now())
        guard keep(tokens) else { throw .notKept }
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

    /// Whether this sign-in can delete its own account (C4): its access token carries the scope
    /// Cognito's DeleteUser needs, and names its pool (`Tokens.deleteEndpoint`). False when nobody
    /// is signed in, the Keychain cannot be read now, or the sign-in was made before the phone asked
    /// for that scope: a fresh sign-in first.
    public func mayDelete() -> Bool {
        current().flatMap { Tokens.deleteEndpoint(of: $0.access) } != nil
    }

    /// The API has deleted this sign-in's account (C4): from now on no token goes to the API — a
    /// request there would make a fresh account under the same sign-in — until DeleteUser deletes
    /// the sign-in, or a sign-out forgets it. Kept with the tokens, so a relaunch sends nothing
    /// either; a Keychain that cannot take it right now takes it at the next ask.
    public func accountDeleted() {
        guard current() != nil else { return }
        tokens?.deleted = true
        unsaved = !keep(tokens)
    }

    /// Whether the API has deleted this sign-in's account and its Cognito sign-in waits to be (C4).
    public func deletionPending() -> Bool { current()?.deleted == true }

    /// Cognito's DeleteUser (C4): the sign-in deletes itself with its own access token at its pool's
    /// endpoint — no AWS credential, as the API holds none. Deleted, the tokens are forgotten as a
    /// sign-out forgets them, and the answer is nil; else what Cognito answered, the tokens kept to
    /// try again. An expired token is renewed first, as `accessToken` renews one, and so, once, is
    /// one Cognito says it no longer takes: a sign-in it then refuses for good — deleted by a try
    /// whose answer never came — is forgotten by that renewal, and gone too.
    public func deleteUser() async -> SendResult? {
        var renewing = false
        while true {
            guard let held = current() else { return loaded ? nil : .networkError }
            if renewing || now() >= held.until {
                guard await renew(telling: false) else { return tokens == nil ? nil : .networkError }
            }
            guard let access = tokens?.access, let endpoint = Tokens.deleteEndpoint(of: access) else {
                return .networkError
            }
            switch await deleteUser(access, at: endpoint) {
            case (.status(200..<300), _), (_, "UserNotFoundException"?):
                adopt(nil, saved: keep(nil))
                return nil
            case (_, "NotAuthorizedException"?) where !renewing: renewing = true
            case (let result, _): return result
            }
        }
    }

    /// One DeleteUser call with `access` at `endpoint`, in Cognito's JSON protocol: the status, or no
    /// answer, and the error's type — its `__type`, past any namespace.
    private func deleteUser(_ access: String, at endpoint: URL) async -> (SendResult, String?) {
        struct Failure: Decodable {
            let type: String
            enum CodingKeys: String, CodingKey { case type = "__type" }
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = APIClient.requestTimeout
        request.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        request.setValue(
            "AWSCognitoIdentityProviderService.DeleteUser", forHTTPHeaderField: "X-Amz-Target")
        request.httpBody = try? JSONEncoder().encode(["AccessToken": access])
        guard let exchanged = try? await transport.send(request) else { return (.networkError, nil) }
        let type = (try? JSONDecoder().decode(Failure.self, from: exchanged.0))?.type
        return (.status(exchanged.1.statusCode), type?.split(separator: "#").last.map(String.init))
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

    /// Who is signed in: the account the tokens are for — their `sub`, read unverified, only ever
    /// to tell one student from another (C6b's review); nil when nobody is, the Keychain cannot be
    /// read yet, or the tokens name none — never a stand-in a renewal could change (santa's round
    /// 1: a rotated refresh token would read as another student at each renewal).
    public func account() -> String? {
        current().flatMap { Tokens.subject(of: $0.access) }
    }

    /// The account's email, as the tokens name it (#147): whose sign-in this is, which Me says, so
    /// the name a student's teachers see is never taken for it. Nil when nobody is signed in, the
    /// Keychain cannot be read yet, or the tokens name none.
    public func email() -> String? {
        current()?.email
    }

    /// The tokens, read from the store the first time it can be read. Only a store with nothing in
    /// it is nobody signed in: one that cannot be read right now — the Keychain while the phone is
    /// locked, or before its first unlock — is read again next time, never a sign-out and never
    /// cleared. Tokens it cannot decode are none: the student signs in again.
    private func current() -> Tokens? {
        if loaded {
            if unsaved { unsaved = !keep(tokens) }
            return tokens
        }
        do {
            let stored = try store.load()
            adopt(stored.flatMap { try? JSONDecoder().decode(Tokens.self, from: $0) })
        } catch {}
        return tokens
    }

    /// The phone's tokens from now on — nil: signed out — told to every watcher; `saved` when the
    /// store has them too.
    private func adopt(_ tokens: Tokens?, saved: Bool = true) {
        (self.tokens, loaded, unsaved) = (tokens, true, !saved)
        for watcher in watchers.values { watcher.yield(tokens != nil) }
    }

    /// Whether the store now holds `tokens`; nil forgets what it had.
    private func keep(_ tokens: Tokens?) -> Bool {
        guard let tokens else { return (try? store.clear()) != nil }
        return (try? store.save(JSONEncoder().encode(tokens))) != nil
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
            // A refresh token Cognito rotates replaces the one kept, which then stops working — so
            // tokens the Keychain cannot take right now are saved again at the next ask. The email
            // is the same account's: an answer naming none keeps it, as it keeps the refresh token,
            // and an account the API deleted stays deleted (C4).
            var fresh = Tokens(
                access: grant.access, refresh: grant.refresh ?? refresh,
                email: grant.email ?? tokens?.email, at: now())
            fresh.deleted = tokens?.deleted
            adopt(fresh, saved: keep(fresh))
            if telling { await tokenArrived?() }
            return true
        case .failure(.refused("invalid_grant")):
            // The one real "no": Cognito refused the refresh token — revoked, expired, the account
            // gone. Signed out, and nothing else: every queued record waits for the next sign-in.
            // A Keychain that cannot forget the tokens right now forgets them at the next ask.
            adopt(nil, saved: keep(nil))
            return false
        case .failure:
            // No answer, a server error, another refusal: no "no" about this student. The tokens
            // are kept, and the next request tries again.
            return false
        }
    }

    /// The token endpoint's answer to `fields` (RFC 6749 §4.1.3, §6): the tokens on a 2xx — and the
    /// email its ID token names (#147) — its OAuth error on a 4xx — a refusal — and anything else no
    /// answer (a 5xx, a proxy's page).
    private func exchange(_ fields: [(String, String)]) async
        -> Result<(access: String, refresh: String?, email: String?), SignInError>
    {
        struct Answer: Decodable { let accessToken, refreshToken, idToken, error: String? }
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
        case (200..<300, let access?, _):
            return .success(
                (access, answer?.refreshToken, answer?.idToken.flatMap { Tokens.email(of: $0) }))
        case (400..<500, _, let error?): return .failure(.refused(error))
        default: return .failure(.unreachable)
        }
    }
}
