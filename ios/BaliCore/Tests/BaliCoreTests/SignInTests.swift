import Foundation
import Testing

@testable import BaliCore

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

// B4: the sign-in and the tokens it keeps — against a token endpoint answered by hand and the
// Keychain's stand-in, with a clock the test sets.

let cognito = Cognito(
    domain: URL(string: "https://bali-dev.auth.us-east-1.amazoncognito.com")!,
    clientId: "phone-client", redirectURI: URL(string: "bali://auth/callback")!)
let tokenEndpoint = "https://bali-dev.auth.us-east-1.amazoncognito.com/oauth2/token"
/// RFC 7636's own example (appendix B).
let rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
let rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

/// The phone's clock in these tests: 2026, while the tokens' own claims are the server's, in 2001 —
/// the lifetime alone says how long a token lives.
let t0 = Date(timeIntervalSince1970: 1_790_000_000)

/// An access token as Cognito's reads on the phone: a payload with `iat` and `exp`, unsigned — the
/// phone never checks the signature.
func jwt(_ name: String, lifetime: TimeInterval = 3600) -> String {
    let iat = 1_000_000_000
    let payload = #"{"sub":"\#(name)","iat":\#(iat),"exp":\#(iat + Int(lifetime))}"#
    return "eyJhbGciOiJSUzI1NiJ9.\(base64url(Data(payload.utf8))).signature"
}

/// The token endpoint's answer: the tokens, a refresh token only when given.
func granted(_ access: String, refresh: String? = nil) -> String {
    let refresh = refresh.map { #""refresh_token":"\#($0)","# } ?? ""
    return
        #"{"id_token":"id","access_token":"\#(access)",\#(refresh)"expires_in":3600,"token_type":"Bearer"}"#
}

/// Its OAuth refusal.
func refusal(_ error: String) -> String { #"{"error":"\#(error)"}"# }

/// The hosted UI, as the browser session hands it back: the student signed in and sent back to
/// the redirect URI with a code for the attempt the page was opened for.
let signsIn: @Sendable (URL) async throws -> URL = { url in
    let state =
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "state" }?.value ?? ""
    return URL(string: "bali://auth/callback?code=the-code&state=\(state)")!
}

/// A form body's fields.
func fields(_ body: Data?) -> [String: String] {
    let pairs = String(decoding: body ?? Data(), as: UTF8.self).split(separator: "&").map {
        $0.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? "" }
    }
    return Dictionary(uniqueKeysWithValues: pairs.map { ($0[0], $0.count > 1 ? $0[1] : "") })
}

/// The Keychain's stand-in: memory, which can be locked as a locked phone's Keychain is.
final class MemoryStore: TokenStore, @unchecked Sendable {
    struct Locked: Error {}
    private let lock = NSLock()
    private var saved: Data?
    private var isLocked = false

    var data: Data? { lock.withLock { saved } }
    var tokens: Tokens? { data.flatMap { try? JSONDecoder().decode(Tokens.self, from: $0) } }
    func setLocked(_ locked: Bool) { lock.withLock { isLocked = locked } }

    func load() throws -> Data? {
        try lock.withLock { if isLocked { throw Locked() } else { saved } }
    }
    func save(_ tokens: Data) throws { try change(tokens) }
    func clear() throws { try change(nil) }
    private func change(_ data: Data?) throws {
        try lock.withLock { if isLocked { throw Locked() } else { saved = data } }
    }

    /// A store holding `tokens`, as a sign-in at `now` left it.
    static func holding(_ access: String, refresh: String = "refresh-1", at now: Date = t0)
        throws -> MemoryStore
    {
        let store = MemoryStore()
        try store.save(JSONEncoder().encode(Tokens(access: access, refresh: refresh, at: now)))
        return store
    }
}

/// A clock the test sets.
final class Now: @unchecked Sendable {
    private let lock = NSLock()
    private var date = t0
    func callAsFunction() -> Date { lock.withLock { date } }
    func set(_ seconds: TimeInterval) { lock.withLock { date = t0 + seconds } }
}

/// How many times the sign-in told the engine of a token.
actor Told {
    private(set) var count = 0
    func add() { count += 1 }
}

/// A sign-in over `store` and `endpoint`, the engine's side counted by `told`.
func signIn(_ store: MemoryStore, _ endpoint: any HTTPTransport, now: Now = Now(), told: Told)
    async -> SignIn
{
    let signIn = SignIn(cognito: cognito, store: store, transport: endpoint, now: { now() })
    await signIn.whenTokenArrives { await told.add() }
    return signIn
}

/// The first value `stream` gives, waited for on the stream itself, never raced against a clock: a
/// loaded simulator can stall a test for longer than any moment (38 and 100 seconds on #86's runs),
/// so the suite's time limit is the wait's only bound.
func first(_ stream: AsyncStream<Bool>) async -> Bool? {
    await stream.first { _ in true }
}

/// Whether `stream` has nothing to give within a moment — a look that cannot wait, so it ends the
/// stream. A stall can only make it see nothing, never make it see a value that is not there.
func nothingYet(_ stream: AsyncStream<Bool>) async -> Bool {
    await withTaskGroup(of: Bool?.self) { group in
        group.addTask { await stream.first { _ in true } }
        group.addTask {
            try? await Task.sleep(for: .milliseconds(200))
            return nil
        }
        let value = await group.next() ?? nil
        group.cancelAll()
        return value == nil
    }
}

// A test waiting on something that never comes fails in three minutes rather than hanging a CI job.
@Suite("Signing in: PKCE, the hosted UI and the token endpoint (B4)", .timeLimit(.minutes(3)))
struct SignInTests {
    @Test("the S256 challenge is RFC 7636's own example")
    func challenge() {
        #expect(Attempt(verifier: rfcVerifier, state: "s").challenge == rfcChallenge)
    }

    @Test("the app reads where the hosted UI answers without a hop, as its browser session needs")
    func redirect() {
        // This module is not BaliCore, as the app is not: without `nonisolated` it does not compile.
        let signIn = SignIn(
            cognito: cognito, store: MemoryStore(), transport: TransportDouble(status: 500))
        #expect(signIn.cognito.redirectURI.scheme == "bali")
    }

    @Test("every attempt's verifier and state are fresh, URL-safe and long enough")
    func fresh() {
        let (one, two) = (Attempt(), Attempt())
        #expect(one.verifier != two.verifier && one.state != two.state)
        let urlSafe = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        for value in [one.verifier, one.state] { #expect(value.allSatisfy(urlSafe.contains)) }
        #expect(one.verifier.count == 43)  // 32 random bytes: RFC 7636's minimum is 43 characters
        #expect(one.state.count == 22)
    }

    @Test("the hosted UI's sign-in page carries the challenge and the state, never the verifier")
    func authorize() throws {
        let url = try #require(cognito.authorizeURL(Attempt(verifier: rfcVerifier, state: "st")))
        #expect(
            url.absoluteString
                == "https://bali-dev.auth.us-east-1.amazoncognito.com/oauth2/authorize"
                + "?response_type=code&client_id=phone-client"
                + "&redirect_uri=bali%3A%2F%2Fauth%2Fcallback&scope=openid%20email%20profile"
                + "&state=st&code_challenge=\(rfcChallenge)&code_challenge_method=S256")
        #expect(!url.absoluteString.contains(rfcVerifier))
        // A domain set with a trailing slash names the same endpoints.
        let slashed = Cognito(
            domain: try #require(URL(string: "https://bali-dev.auth.us-east-1.amazoncognito.com/")),
            clientId: "phone-client", redirectURI: cognito.redirectURI)
        #expect(slashed.endpoint("oauth2/token") == tokenEndpoint)
    }

    @Test("the answer's code is taken only at the redirect URI, for this attempt, with no error")
    func callback() throws {
        let attempt = Attempt(verifier: rfcVerifier, state: "st")
        let code = { (url: String) throws(SignInError) in
            try cognito.code(from: URL(string: url)!, for: attempt)
        }
        #expect(try code("bali://auth/callback?code=c0de&state=st") == "c0de")
        #expect(throws: SignInError.refused("access_denied")) {
            try code("bali://auth/callback?error=access_denied&state=st")
        }
        for other in [
            "bali://auth/callback?code=c0de&state=another-attempt",
            "bali://auth/callback?code=c0de",
            "bali://auth/elsewhere?code=c0de&state=st",
            "evil://auth/callback?code=c0de&state=st",
            "bali://auth/callback?state=st",
            "bali://auth/callback?code=&state=st",
        ] {
            #expect(throws: SignInError.refused(nil), "\(other)") { try code(other) }
        }
    }

    @Test(
        "a sign-in exchanges its code and verifier at the token endpoint, no secret, and keeps both tokens"
    )
    func exchange() async throws {
        let endpoint = TransportDouble { _ in
            (200, Data(granted(jwt("a1"), refresh: "refresh-1").utf8))
        }
        let (store, told) = (MemoryStore(), Told())
        let opened = Opened()
        let signIn = await signIn(store, endpoint, told: told)

        try await signIn.signIn { url in
            await opened.set(url)
            return try await signsIn(url)
        }

        let sent = try #require(await endpoint.sent.first)
        #expect(await endpoint.sent.count == 1)
        #expect(sent.httpMethod == "POST" && sent.url?.absoluteString == tokenEndpoint)
        #expect(sent.timeoutInterval == APIClient.requestTimeout)  // no answer in time is no answer
        #expect(
            sent.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == nil)
        let form = fields(sent.httpBody)
        #expect(
            Set(form.keys) == ["grant_type", "client_id", "code", "redirect_uri", "code_verifier"])
        #expect(form["grant_type"] == "authorization_code" && form["client_id"] == "phone-client")
        #expect(form["code"] == "the-code" && form["redirect_uri"] == "bali://auth/callback")
        // The verifier sent is the one whose challenge the sign-in page was opened with.
        let page = try #require(await opened.url)
        let challenge = URLComponents(url: page, resolvingAgainstBaseURL: false)?.queryItems?
            .first { $0.name == "code_challenge" }?.value
        #expect(
            challenge == Attempt(verifier: try #require(form["code_verifier"]), state: "").challenge
        )

        #expect(store.tokens?.access == jwt("a1") && store.tokens?.refresh == "refresh-1")
        #expect(await signIn.accessToken() == jwt("a1"))
        #expect(await first(signIn.signedIn()) == true)
        #expect(await told.count == 1)  // the engine sends what waited on the sign-in at once
    }

    @Test(
        "a sign-in that does not finish keeps nothing and tells nobody",
        arguments: [
            (nil, nil, SignInError.cancelled),
            ("error=access_denied", nil, .refused("access_denied")),
            (nil, (400, refusal("invalid_grant")), .refused("invalid_grant")),
            (nil, (500, "oops"), .unreachable),
            (nil, (200, granted(jwt("a1"))), .refused(nil)),  // no refresh token: nothing to keep
        ] as [(String?, (Int, String)?, SignInError)])
    func unfinished(answer: String?, endpoint reply: (Int, String)?, error: SignInError) async {
        let endpoint = TransportDouble { _ in
            let (status, body) = try #require(reply)
            return (status, Data(body.utf8))
        }
        let (store, told) = (MemoryStore(), Told())
        let signIn = await signIn(store, endpoint, told: told)
        await #expect(throws: error) {
            try await signIn.signIn { url in
                guard reply != nil || answer != nil else { throw CancellationError() }
                let state =
                    URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                    .first { $0.name == "state" }?.value ?? ""
                return URL(string: "bali://auth/callback?\(answer ?? "code=c")&state=\(state)")!
            }
        }
        #expect(store.data == nil)
        #expect(await signIn.accessToken() == nil)
        #expect(await told.count == 0)
    }

    @Test(
        "a sign-in that cannot reach Cognito, or whose tokens the Keychain refuses, keeps nothing")
    func unkept() async throws {
        let (store, told) = (MemoryStore(), Told())
        let offline = await signIn(
            store, TransportDouble(throwing: URLError(.notConnectedToInternet)), told: told)
        await #expect(throws: SignInError.unreachable) {
            try await offline.signIn(through: signsIn)
        }

        store.setLocked(true)
        let endpoint = TransportDouble { _ in (200, Data(granted(jwt("a1"), refresh: "r").utf8)) }
        let locked = await signIn(store, endpoint, told: told)
        await #expect(throws: SignInError.notKept) { try await locked.signIn(through: signsIn) }
        store.setLocked(false)
        #expect(store.data == nil)
        #expect(await locked.accessToken() == nil)
        #expect(await told.count == 0)
    }
}

/// The sign-in page the browser was opened on.
actor Opened {
    private(set) var url: URL?
    func set(_ url: URL) { self.url = url }
}

@Suite(
    "The tokens: given, renewed, and signed out only by Cognito's own no (B4)",
    .timeLimit(.minutes(3)))
struct TokenTests {
    @Test(
        "the access token is given until a minute before its own lifetime ends, whatever the phone's clock"
    )
    func given() async throws {
        let endpoint = TransportDouble { _ in (200, Data(granted(jwt("a2")).utf8)) }
        let (now, told) = (Now(), Told())
        let signIn = await signIn(try .holding(jwt("a1")), endpoint, now: now, told: told)

        now.set(3600 - 61)
        #expect(await signIn.accessToken() == jwt("a1"))
        #expect(await endpoint.sent.isEmpty)
        now.set(3600 - 59)  // inside the margin: renewed, never sent as it is
        #expect(await signIn.accessToken() == jwt("a2"))
        #expect(await endpoint.sent.count == 1)
    }

    @Test(
        "an expired token is renewed with the refresh token before one is given, and the engine told"
    )
    func renewed() async throws {
        let endpoint = TransportDouble { _ in (200, Data(granted(jwt("a2")).utf8)) }
        let (store, now, told) = (try MemoryStore.holding(jwt("a1")), Now(), Told())
        let signIn = await signIn(store, endpoint, now: now, told: told)
        now.set(4000)

        #expect(await signIn.accessToken() == jwt("a2"))
        let sent = try #require(await endpoint.sent.first)
        #expect(sent.httpMethod == "POST" && sent.url?.absoluteString == tokenEndpoint)
        #expect(
            fields(sent.httpBody)
                == [
                    "grant_type": "refresh_token", "client_id": "phone-client",
                    "refresh_token": "refresh-1",
                ])
        #expect(await told.count == 1)
        // The refresh token is kept when the answer brings none; a fresh token lives its own hour.
        #expect(store.tokens?.access == jwt("a2") && store.tokens?.refresh == "refresh-1")
        now.set(4000 + 3539)
        #expect(await signIn.accessToken() == jwt("a2"))
        #expect(await endpoint.sent.count == 1)
    }

    @Test("a refresh token Cognito rotates replaces the one kept")
    func rotated() async throws {
        let endpoint = TransportDouble { _ in
            (200, Data(granted(jwt("a2"), refresh: "refresh-2").utf8))
        }
        let (store, now) = (try MemoryStore.holding(jwt("a1")), Now())
        let signIn = await signIn(store, endpoint, now: now, told: Told())
        now.set(4000)
        #expect(await signIn.accessToken() == jwt("a2"))
        #expect(store.tokens?.refresh == "refresh-2")
    }

    @Test("a rotated refresh token the Keychain cannot take right then is saved at the next ask")
    func rotatedUnsaved() async throws {
        let endpoint = TransportDouble { _ in
            (200, Data(granted(jwt("a2"), refresh: "refresh-2").utf8))
        }
        let (store, now) = (try MemoryStore.holding(jwt("a1")), Now())
        let signIn = await signIn(store, endpoint, now: now, told: Told())
        #expect(await signIn.accessToken() == jwt("a1"))  // read while the phone is unlocked

        store.setLocked(true)
        now.set(4000)
        #expect(await signIn.accessToken() == jwt("a2"))  // renewed: the old refresh token is spent
        #expect(store.tokens?.refresh == "refresh-1")  // the Keychain refused the new one

        store.setLocked(false)
        #expect(await signIn.accessToken() == jwt("a2"))
        #expect(store.tokens?.refresh == "refresh-2" && store.tokens?.access == jwt("a2"))
        #expect(await endpoint.sent.count == 1)
    }

    @Test("Cognito refusing the refresh token signs the student out — the one real no")
    func refused() async throws {
        let endpoint = TransportDouble { _ in (400, Data(refusal("invalid_grant").utf8)) }
        let (store, now, told) = (try MemoryStore.holding(jwt("a1")), Now(), Told())
        let signIn = await signIn(store, endpoint, now: now, told: told)
        let watching = await signIn.signedIn()
        now.set(4000)

        #expect(await signIn.accessToken() == nil)
        #expect(store.data == nil)
        #expect(await first(watching) == false)  // the newest a watcher was told
        // Signed out: only a sign-in can give a token, so the engine's refresh is false at once.
        #expect(await signIn.refresh() == false)
        #expect(await endpoint.sent.count == 1)
        #expect(await told.count == 0)
    }

    @Test(
        "a sign-out the Keychain cannot make right then is made at the next ask: the refused refresh token is never read back"
    )
    func refusedUnforgotten() async throws {
        let endpoint = TransportDouble { _ in (400, Data(refusal("invalid_grant").utf8)) }
        let (store, now) = (try MemoryStore.holding(jwt("a1")), Now())
        let phone = await signIn(store, endpoint, now: now, told: Told())
        #expect(await phone.accessToken() == jwt("a1"))  // read while the phone is unlocked

        store.setLocked(true)
        now.set(4000)
        #expect(await phone.accessToken() == nil)  // Cognito's no
        #expect(await first(phone.signedIn()) == false)
        #expect(store.tokens?.refresh == "refresh-1")  // the Keychain could not forget it then

        store.setLocked(false)
        #expect(await phone.accessToken() == nil)
        #expect(store.data == nil)  // forgotten at this ask
        let relaunched = await signIn(store, endpoint, now: now, told: Told())
        #expect(await first(relaunched.signedIn()) == false)
        #expect(await endpoint.sent.count == 1)
    }

    @Test("the token the API refused is not given after a relaunch either, though no renewal came")
    func refusedAcrossLaunch() async throws {
        let answers = Answers(nil)  // Cognito out of reach
        let endpoint = TransportDouble { _ in
            let (status, body) = try answers.next()
            return (status, Data(body.utf8))
        }
        let store = try MemoryStore.holding(jwt("a1"))
        let before = await signIn(store, endpoint, told: Told())
        #expect(await before.refresh() == false)

        let relaunched = await signIn(store, endpoint, told: Told())
        #expect(await relaunched.accessToken() == nil)  // renewed first, never a1 again
        answers.set((200, granted(jwt("a2"))))
        #expect(await relaunched.accessToken() == jwt("a2"))
        #expect(await endpoint.sent.count == 3)
    }

    @Test(
        "no answer, a server error, throttling or another refusal keeps the tokens: no one said no",
        arguments: [
            nil, (500, "{}"), (503, "<html>"), (429, refusal("too_many_requests")),
            (400, refusal("invalid_client")), (400, refusal("unauthorized_client")),
            (200, "not json"), (302, refusal("invalid_grant")),  // a redirect is not Cognito
        ] as [(Int, String)?])
    func kept(reply: (Int, String)?) async throws {
        let answers = Answers(reply)
        let endpoint = TransportDouble { _ in
            let (status, body) = try answers.next()
            return (status, Data(body.utf8))
        }
        let (store, now, told) = (try MemoryStore.holding(jwt("a1")), Now(), Told())
        let signIn = await signIn(store, endpoint, now: now, told: told)
        now.set(4000)

        #expect(await signIn.accessToken() == nil)  // expired, and not renewed: none right now
        #expect(store.tokens?.refresh == "refresh-1")
        #expect(await first(signIn.signedIn()) == true)
        #expect(await told.count == 0)
        // The next request tries again, and a renewal then gives one.
        answers.set((200, granted(jwt("a2"))))
        #expect(await signIn.accessToken() == jwt("a2"))
        #expect(await told.count == 1)
    }

    @Test("the engine's refresh: the refused token is never given again, and a fresh one is true")
    func refresh() async throws {
        let answers = Answers((200, granted(jwt("a2"))))
        let endpoint = TransportDouble { _ in
            let (status, body) = try answers.next()
            return (status, Data(body.utf8))
        }
        let told = Told()
        let signIn = await signIn(try .holding(jwt("a1")), endpoint, told: told)

        #expect(await signIn.refresh() == true)
        #expect(await signIn.accessToken() == jwt("a2"))
        #expect(await told.count == 0)  // the engine sends everything again itself

        // Refused again, and Cognito out of reach: false, and the token the API refused is not
        // given — until a renewal can give a fresh one, which the engine is told of.
        answers.set(nil)
        #expect(await signIn.refresh() == false)
        #expect(await signIn.accessToken() == nil)
        answers.set((200, granted(jwt("a3"))))
        #expect(await signIn.accessToken() == jwt("a3"))
        #expect(await told.count == 1)
    }

    @Test(
        "the engine's refresh is false at once when nobody is signed in: only the student can sign in"
    )
    func refreshSignedOut() async {
        let endpoint = TransportDouble(status: 200, body: granted(jwt("a1")))
        let signIn = await signIn(MemoryStore(), endpoint, told: Told())
        #expect(await signIn.refresh() == false)
        #expect(await signIn.accessToken() == nil)
        #expect(await endpoint.sent.isEmpty)
    }

    @Test("one renewal at a time, shared by every caller")
    func shared() async throws {
        let endpoint = HeldEndpoint()
        let (now, told) = (Now(), Told())
        let signIn = await signIn(try .holding(jwt("a1")), endpoint, now: now, told: told)
        now.set(4000)

        let one = Task { await signIn.accessToken() }
        await endpoint.received(1)
        let two = Task { await signIn.accessToken() }
        let three = Task { await signIn.refresh() }
        try await Task.sleep(for: .milliseconds(100))
        #expect(await endpoint.sent == 1)
        await endpoint.answer(200, granted(jwt("a2")))
        let (a, b, c) = (await one.value, await two.value, await three.value)
        #expect(a == jwt("a2") && b == jwt("a2") && c)
        #expect(await endpoint.sent == 1)
        #expect(await told.count == 1)
    }

    @Test("a renewal the engine's refresh started is shared too, and the engine is not told of it")
    func sharedFromRefresh() async throws {
        let endpoint = HeldEndpoint()
        let told = Told()
        let signIn = await signIn(try .holding(jwt("a1")), endpoint, told: told)

        let refreshing = Task { await signIn.refresh() }
        await endpoint.received(1)
        let asking = Task { await signIn.accessToken() }
        try await Task.sleep(for: .milliseconds(100))
        #expect(await endpoint.sent == 1)
        await endpoint.answer(200, granted(jwt("a2")))
        let (fresh, given) = (await refreshing.value, await asking.value)
        #expect(fresh && given == jwt("a2"))
        #expect(await endpoint.sent == 1)
        #expect(await told.count == 0)  // refresh's true: the engine sends everything again itself
    }

    @Test("a Keychain that cannot be read right now is never a sign-out")
    func locked() async throws {
        let store = try MemoryStore.holding(jwt("a1"))
        let endpoint = TransportDouble(status: 200, body: granted(jwt("a2")))
        let signIn = await signIn(store, endpoint, told: Told())
        store.setLocked(true)

        #expect(await signIn.accessToken() == nil)
        #expect(await signIn.refresh() == false)
        // A watcher's first look cannot wait, so it ends that stream: each look gets its own.
        let (now, later) = (await signIn.signedIn(), await signIn.signedIn())
        #expect(await nothingYet(now))  // not known yet: neither in nor out

        store.setLocked(false)
        #expect(await signIn.accessToken() == jwt("a1"))
        #expect(await first(later) == true)  // told once the Keychain could be read
        #expect(await endpoint.sent.isEmpty)
    }

    @Test("signing out forgets the tokens; a Keychain that cannot forget them now changes nothing")
    func signOut() async throws {
        let store = try MemoryStore.holding(jwt("a1"))
        let signIn = await signIn(store, TransportDouble(status: 500), told: Told())
        #expect(await signIn.accessToken() == jwt("a1"))

        store.setLocked(true)
        await #expect(throws: MemoryStore.Locked.self) { try await signIn.signOut() }
        #expect(await signIn.accessToken() == jwt("a1"))
        store.setLocked(false)

        let watching = await signIn.signedIn()
        try await signIn.signOut()
        #expect(store.data == nil)
        #expect(await signIn.accessToken() == nil)
        #expect(await first(watching) == false)
    }

    @Test("a sign-out while a renewal runs is not undone by its answer")
    func signOutMidRenewal() async throws {
        let endpoint = HeldEndpoint()
        let (store, now) = (try MemoryStore.holding(jwt("a1")), Now())
        let signIn = await signIn(store, endpoint, now: now, told: Told())
        now.set(4000)

        let renewal = Task { await signIn.accessToken() }
        await endpoint.received(1)
        try await signIn.signOut()
        await endpoint.answer(200, granted(jwt("a2")))
        #expect(await renewal.value == nil)
        #expect(store.data == nil)
        #expect(await signIn.accessToken() == nil)
    }

    @Test(
        "a sign-in while a renewal runs stands, even when Cognito refuses the refresh token let go")
    func signInMidRenewal() async throws {
        let endpoint = HeldEndpoint()
        let (store, now, told) = (try MemoryStore.holding(jwt("a1")), Now(), Told())
        let signIn = await signIn(store, endpoint, now: now, told: told)
        now.set(4000)

        let renewal = Task { await signIn.accessToken() }
        await endpoint.received(1)
        let signingIn = Task { try await signIn.signIn(through: signsIn) }
        await endpoint.received(2)
        await endpoint.answer(200, granted(jwt("b1"), refresh: "refresh-b"), newestOnly: true)
        try await signingIn.value
        await endpoint.answer(400, refusal("invalid_grant"))  // the renewal's, about refresh-1

        #expect(await renewal.value == jwt("b1"))  // the sign-in's token, the one there is now
        #expect(store.tokens?.refresh == "refresh-b")
        #expect(await first(signIn.signedIn()) == true)
        #expect(await told.count == 1)  // the sign-in's
    }

    @Test("a token whose lifetime cannot be read is given until the API refuses it")
    func unreadable() async throws {
        let endpoint = TransportDouble(status: 200, body: granted(jwt("a2")))
        let now = Now()
        let signIn = await signIn(try .holding("opaque"), endpoint, now: now, told: Told())
        now.set(30 * 86_400)
        #expect(await signIn.accessToken() == "opaque")
        #expect(await signIn.refresh() == true)
        #expect(await signIn.accessToken() == jwt("a2"))
    }
}

/// The token endpoint's next answer — nil for none at all — which a test changes as it goes.
final class Answers: @unchecked Sendable {
    private let lock = NSLock()
    private var reply: (Int, String)?
    init(_ reply: (Int, String)?) { self.reply = reply }
    func set(_ reply: (Int, String)?) { lock.withLock { self.reply = reply } }
    func next() throws -> (Int, String) {
        guard let reply = lock.withLock({ reply }) else { throw URLError(.notConnectedToInternet) }
        return reply
    }
}

/// A token endpoint that holds every request until the test answers it.
actor HeldEndpoint: HTTPTransport {
    private(set) var sent = 0
    private var waiting: [CheckedContinuation<(Int, String), Never>] = []
    private var arrivals: [(count: Int, wake: CheckedContinuation<Void, Never>)] = []

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        sent += 1
        let (status, body) = await withCheckedContinuation {
            waiting.append($0)
            let due = arrivals.filter { $0.count <= sent }
            arrivals.removeAll { $0.count <= sent }
            for arrival in due { arrival.wake.resume() }
        }
        let response = HTTPURLResponse(
            url: try #require(request.url), statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: nil)
        return (Data(body.utf8), try #require(response))
    }

    /// Returns once `count` requests have come, each held for its answer: the requests' own signal,
    /// never a clock a loaded simulator can outrun (#86) — the suite's time limit bounds the wait.
    func received(_ count: Int) async {
        guard sent < count else { return }
        await withCheckedContinuation { arrivals.append((count, $0)) }
    }

    /// Answers every request waiting, or only the newest.
    func answer(_ status: Int, _ body: String, newestOnly: Bool = false) {
        let answering = newestOnly ? [waiting.removeLast()] : waiting
        if !newestOnly { waiting = [] }
        for request in answering { request.resume(returning: (status, body)) }
    }
}
