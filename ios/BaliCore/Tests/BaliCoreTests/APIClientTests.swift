import Foundation
import Testing

@testable import BaliCore

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif
#if canImport(Glibc)
    import Glibc
#elseif canImport(Darwin)
    import Darwin
#endif

/// A transport that answers each request from `reply`, with no network, and keeps what it sent.
actor TransportDouble: HTTPTransport {
    private(set) var sent: [URLRequest] = []
    private let reply: @Sendable (URLRequest) throws -> (status: Int, body: Data)

    init(_ reply: @escaping @Sendable (URLRequest) throws -> (status: Int, body: Data)) {
        self.reply = reply
    }

    /// Every request answered `status`, with `body`.
    init(status: Int, body: String = "") { self.init { _ in (status, Data(body.utf8)) } }

    /// No request answered at all: each throws `error`, as URLSession does.
    init(throwing error: any Error & Sendable) { self.init { _ in throw error } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        sent.append(request)
        let (status, body) = try reply(request)
        let response = HTTPURLResponse(
            url: try #require(request.url), statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: nil)
        return (body, try #require(response))
    }
}

/// A token provider that always gives `token` — or, nil, none.
struct FixedToken: TokenProvider {
    let token: String?
    func accessToken() async -> String? { token }
}

/// A token provider that gives a new token each time it is asked, as one refreshed would.
actor RefreshingToken: TokenProvider {
    private(set) var asked = 0
    func accessToken() -> String? {
        asked += 1
        return "token-\(asked)"
    }
}

extension Contract.Fixture {
    /// The endpoint's method: `POST` of `POST /v1/taps`.
    var method: String { String(endpoint.prefix { $0 != " " }) }

    /// The path's parameter, the `{id}` or `{code}` after its first two segments — empty when it
    /// has none, and then the path the client builds is not the fixture's.
    var parameter: String {
        let segments = request.path.prefix { $0 != "?" }
            .split(separator: "/", omittingEmptySubsequences: false)
        let raw = segments.count > 3 ? String(segments[3]) : ""
        return raw.removingPercentEncoding ?? raw
    }

    /// The value of `name` in the path's query, if it has one.
    func query(_ name: String) -> String? {
        let query = request.path.drop { $0 != "?" }.dropFirst()
        return query.split(separator: "&").first { $0.hasPrefix("\(name)=") }
            .map { String($0.dropFirst(name.count + 1)) }
    }

    /// The request's body, as the BaliCore type the phone sends.
    func sent<T: Decodable>(_: T.Type) throws -> T {
        try Contract.appDecode(T.self, try #require(request.body))
    }
}

@Suite("The API client sends each fixture's request and returns its answer")
struct APIClientFixtureTests {
    static let base = "https://api.bali.test"
    static let token = "token-fx"

    /// Each student endpoint's call, made from what a fixture's request holds. It checks the
    /// client's answer is the fixture's, and gives the disposition the endpoint's outbox table
    /// makes of that answer — none for an endpoint no outbox sends.
    static let calls: [String: @Sendable (APIClient, Contract.Fixture) async throws -> String?] = [
        "GET /v1/me": { client, fixture in try answered(await client.me(), fixture) },
        "PATCH /v1/me": { client, fixture in
            let request = try fixture.sent(UpdateMeRequest.self)
            return try answered(await client.updateMe(request), fixture)
        },
        "POST /v1/taps": { client, fixture in
            let request = try fixture.sent(TapRequest.self)
            let response = await client.tap(request)
            return try answered(
                response, fixture, tapDisposition(response.result, response.answer).rawValue)
        },
        "POST /v1/sessions/{id}/checkin": { client, fixture in
            let request = try fixture.sent(CheckInRequest.self)
            return try answered(await client.checkIn(session: fixture.parameter, request), fixture)
        },
        "POST /v1/sessions/{id}/unlock": { client, fixture in
            let request = try fixture.sent(UnlockRequest.self)
            let response = await client.unlock(session: fixture.parameter, request)
            return try answered(
                response, fixture, unlockDisposition(response.result, response.answer).rawValue)
        },
        "POST /v1/sessions/{id}/refocus": { client, fixture in
            let request = try fixture.sent(RefocusRequest.self)
            let response = await client.refocus(session: fixture.parameter, request)
            return try answered(
                response, fixture,
                stateChangeDisposition(response.result, response.answer).rawValue)
        },
        "POST /v1/sessions/{id}/protection-off": { client, fixture in
            let request = try fixture.sent(ProtectionOffRequest.self)
            let response = await client.protectionOff(session: fixture.parameter, request)
            return try answered(
                response, fixture,
                stateChangeDisposition(response.result, response.answer).rawValue)
        },
        "POST /v1/enrollments": { client, fixture in
            let request = try fixture.sent(EnrollmentJoinRequest.self)
            return try answered(await client.join(request), fixture)
        },
        "DELETE /v1/enrollments/{id}": { client, fixture in
            try answered(await client.leave(enrollment: fixture.parameter), fixture)
        },
        "GET /v1/join-codes/{code}": { client, fixture in
            try answered(await client.previewJoinCode(fixture.parameter), fixture)
        },
        "GET /v1/me/history": { client, fixture in
            let limit = try fixture.query("limit").map { try #require(Int($0)) }
            let response = await client.history(before: fixture.query("before"), limit: limit)
            return try answered(response, fixture)
        },
    ]

    /// Checks `response` is the fixture's answer — its status, and its body as the app decodes it:
    /// the endpoint's type on a 2xx, the error shape on any other — and passes `disposition` on.
    static func answered<Answer: Decodable & Equatable & Sendable>(
        _ response: APIResponse<Answer>, _ fixture: Contract.Fixture, _ disposition: String? = nil
    ) throws -> String? {
        #expect(response.result == .status(fixture.status))
        #expect(response.noAnswer == nil)
        if (200..<300).contains(fixture.status) {
            let answer = try Contract.appDecode(Answer.self, fixture.body)
            #expect(response.answer == answer)
            #expect(response.error == nil)
        } else {
            let error = try Contract.appDecode(ApiErrorBody.self, fixture.body)
            #expect(response.answer == nil)
            #expect(response.error == error)
        }
        return disposition
    }

    @Test(
        "Each fixture: the client sends its request, and returns its answer as the fixture's disposition",
        arguments: try Contract.fixturePaths())
    func fixture(_ path: String) async throws {
        let fixture = try Contract.load(path)
        let call = try #require(Self.calls[fixture.endpoint], "no call for \(fixture.endpoint)")
        let body = String(decoding: try JSONEncoder().encode(fixture.body), as: UTF8.self)
        let transport = TransportDouble(status: fixture.status, body: body)
        let client = APIClient(
            baseURL: try #require(URL(string: Self.base)), tokens: FixedToken(token: Self.token),
            transport: transport)

        // Fed the fixture's answer, the client returns what the outbox table reads as the TS did.
        let disposition = try await call(client, fixture)
        #expect(disposition == fixture.disposition)

        // Sent once, as the fixture was: its method, path and body, the token, and a body's type.
        let sent = await transport.sent
        try #require(sent.count == 1)
        let request = sent[0]
        #expect(request.httpMethod == fixture.method)
        #expect(request.url?.absoluteString == Self.base + fixture.request.path)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(Self.token)")
        #expect(request.timeoutInterval == APIClient.requestTimeout)
        if let body = fixture.request.body {
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            let wire = try JSONDecoder().decode(
                JSONValue.self, from: try #require(request.httpBody))
            #expect(wire == body)
        } else {
            // A DELETE with a JSON content type and no body is a 400 from Fastify.
            #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
            #expect(request.httpBody == nil)
        }
    }

    @Test("Every endpoint the fixtures hold has its call, and every call meets a fixture")
    func everyEndpoint() throws {
        let endpoints = try Contract.fixturePaths().map { try Contract.load($0).endpoint }
        #expect(Set(endpoints) == Set(Self.calls.keys))
    }
}

/// What one record's send came back as, and its outbox table's disposition of it.
struct Sent: Sendable {
    let result: SendResult
    let noAnswer: NoAnswer?
    let error: ApiErrorBody?
    let disposition: String
}

@Suite("The API client: no answer, an answer it cannot read, a 401, no token")
struct APIClientTests {
    static let base = URL(string: "https://api.bali.test")!
    static let at = Date(timeIntervalSince1970: 946_684_860)

    /// Each record an outbox sends, sent through `client` and read by its table.
    static let records: [String: @Sendable (APIClient) async -> Sent] = [
        "tap": { client in
            let r = await client.tap(TapRequest(tagId: "TAG-1", eventId: "e1", deviceTime: at))
            return Sent(
                result: r.result, noAnswer: r.noAnswer, error: r.error,
                disposition: tapDisposition(r.result, r.answer).rawValue)
        },
        "unlock": { client in
            let r = await client.unlock(
                session: "s1", UnlockRequest(eventId: "e1", deviceTime: at, reason: .nurse))
            return Sent(
                result: r.result, noAnswer: r.noAnswer, error: r.error,
                disposition: unlockDisposition(r.result, r.answer).rawValue)
        },
        "refocus": { client in
            let r = await client.refocus(
                session: "s1", RefocusRequest(eventId: "e1", deviceTime: at))
            return Sent(
                result: r.result, noAnswer: r.noAnswer, error: r.error,
                disposition: stateChangeDisposition(r.result, r.answer).rawValue)
        },
        "protection off": { client in
            let r = await client.protectionOff(
                session: "s1", ProtectionOffRequest(eventId: "e1", deviceTime: at))
            return Sent(
                result: r.result, noAnswer: r.noAnswer, error: r.error,
                disposition: stateChangeDisposition(r.result, r.answer).rawValue)
        },
    ]
    static let recordNames = records.keys.sorted()

    static func send(
        _ record: String, through transport: TransportDouble, tokens: any TokenProvider
    )
        async throws -> Sent
    {
        let call = try #require(records[record])
        return await call(APIClient(baseURL: base, tokens: tokens, transport: transport))
    }

    @Test(
        "No answer — offline, a timeout, a dropped connection, a cancelled call — is .networkError, and every table keeps the record",
        arguments: [
            URLError(.notConnectedToInternet), URLError(.timedOut),
            URLError(.networkConnectionLost), URLError(.cannotConnectToHost), URLError(.cancelled),
        ], recordNames)
    func noAnswer(error: URLError, record: String) async throws {
        let transport = TransportDouble(throwing: error)
        let sent = try await Self.send(record, through: transport, tokens: FixedToken(token: "t"))
        #expect(sent.result == .networkError)
        #expect(sent.noAnswer == .unreachable)
        #expect(sent.error == nil)
        #expect(sent.disposition == "retry")
        #expect(await transport.sent.count == 1)
    }

    @Test(
        "An answer that does not decode is none, and its status still stands: a 2xx keeps the record",
        arguments: [
            (200, "<html>Service Unavailable</html>", "retry"),
            (200, #"{"outcome":42}"#, "retry"),
            (201, "", "retry"),
            (401, "<html>Unauthorized</html>", "reauth"),
            (502, "<html>Bad Gateway</html>", "retry"),
        ] as [(status: Int, body: String, disposition: String)], recordNames)
    func undecodable(answer: (status: Int, body: String, disposition: String), record: String)
        async throws
    {
        let transport = TransportDouble(status: answer.status, body: answer.body)
        let sent = try await Self.send(record, through: transport, tokens: FixedToken(token: "t"))
        #expect(sent.result == .status(answer.status))
        #expect(sent.noAnswer == nil)
        #expect(sent.error == nil)
        #expect(sent.disposition == answer.disposition)
    }

    @Test(
        "A body is read only as its status's: a 2xx's as the answer, any other's as the error shape",
        arguments: [
            (409, #"{"outcome":"joined","session":null,"state":null}"#),
            (200, #"{"error":{"code":"conflict","message":"No."}}"#),
        ])
    func bodyOfItsStatus(status: Int, body: String) async throws {
        let transport = TransportDouble(status: status, body: body)
        let client = APIClient(
            baseURL: Self.base, tokens: FixedToken(token: "t"), transport: transport)
        let tap = await client.tap(TapRequest(tagId: "TAG-1", eventId: "e1", deviceTime: Self.at))
        #expect(tap.result == .status(status))
        #expect(tap.answer == nil)
        #expect(tap.error == nil)
    }

    @Test(
        "A 401 comes back as a value, sent once: the caller's reauth path runs, not the client's",
        arguments: recordNames)
    func unauthorized(record: String) async throws {
        let transport = TransportDouble(
            status: 401, body: #"{"error":{"code":"unauthorized","message":"token expired"}}"#)
        let tokens = RefreshingToken()
        let sent = try await Self.send(record, through: transport, tokens: tokens)
        #expect(sent.result == .status(401))
        #expect(sent.error?.error.code == .known(.unauthorized))
        #expect(sent.disposition == "reauth")
        // No refresh and no resend of its own: one token asked for, one request sent.
        #expect(await tokens.asked == 1)
        #expect(await transport.sent.count == 1)
    }

    @Test(
        "No token to give: nothing is sent, and it reads as no answer — never a sign-out, never a drop",
        arguments: [nil, ""] as [String?], recordNames)
    func noToken(token: String?, record: String) async throws {
        let transport = TransportDouble(status: 401)
        let sent = try await Self.send(record, through: transport, tokens: FixedToken(token: token))
        #expect(sent.result == .networkError)
        #expect(sent.noAnswer == .noToken)
        #expect(sent.disposition == "retry")
        #expect(await transport.sent.isEmpty)
    }

    @Test("A read with no token is no answer too, sending nothing")
    func readWithoutToken() async throws {
        let transport = TransportDouble(status: 200)
        let client = APIClient(
            baseURL: Self.base, tokens: FixedToken(token: nil), transport: transport)
        let me = await client.me()
        #expect(me.result == .networkError)
        #expect(me.noAnswer == .noToken)
        #expect(await transport.sent.isEmpty)
    }

    @Test("Each request asks for the token afresh, so a refreshed one goes on the next")
    func freshToken() async throws {
        let transport = TransportDouble(status: 200)
        let client = APIClient(baseURL: Self.base, tokens: RefreshingToken(), transport: transport)
        _ = await client.me()
        _ = await client.history()
        let sent = await transport.sent
        #expect(
            sent.map { $0.value(forHTTPHeaderField: "Authorization") } == [
                "Bearer token-1", "Bearer token-2",
            ])
    }

    @Test("Nothing typed changes the URL's shape: each path parameter and query value is escaped")
    func escaping() async throws {
        let transport = TransportDouble(status: 200)
        let client = APIClient(
            baseURL: Self.base, tokens: FixedToken(token: "t"), transport: transport)
        _ = await client.previewJoinCode(" 6bv/za5?x=1#é")
        _ = await client.leave(enrollment: "../me")
        _ = await client.checkIn(session: "s 1", CheckInRequest(deviceTime: Self.at))
        _ = await client.history(before: "e1&limit=50", limit: 5)
        let base = Self.base.absoluteString
        let paths = await transport.sent.map {
            $0.url?.absoluteString.replacingOccurrences(of: base, with: "")
        }
        #expect(
            paths == [
                "/v1/join-codes/%206bv%2Fza5%3Fx%3D1%23%C3%A9",
                "/v1/enrollments/%2E%2E%2Fme",
                "/v1/sessions/s%201/checkin",
                "/v1/me/history?limit=5&before=e1%26limit%3D50",
            ])
    }

    @Test(
        "The base URL may carry a path, with or without its trailing slash",
        arguments: ["https://api.bali.test/api", "https://api.bali.test/api/"])
    func basePath(base: String) async throws {
        let transport = TransportDouble(status: 200)
        let client = APIClient(
            baseURL: try #require(URL(string: base)), tokens: FixedToken(token: "t"),
            transport: transport)
        _ = await client.me()
        #expect(
            await transport.sent.map(\.url?.absoluteString) == ["https://api.bali.test/api/v1/me"])
    }
}

/// A server on a local port, for the real transport: it answers its first request with `answer`
/// — or, given none, never answers at all — and keeps the head of the request it read.
final class LocalServer: @unchecked Sendable {
    let port: UInt16
    private let listener: Int32
    private let lock = NSLock()
    private var received = ""
    var head: String { lock.withLock { received } }

    init(answer: String?) {
        #if canImport(Glibc)
            let fd = socket(AF_INET, Int32(SOCK_STREAM.rawValue), 0)
        #else
            let fd = socket(AF_INET, SOCK_STREAM, 0)
        #endif
        var address = sockaddr_in()
        #if canImport(Darwin)
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        #endif
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = bind(fd, $0, length)  // port 0: any free one
                _ = listen(fd, 8)
                _ = getsockname(fd, $0, &length)
            }
        }
        (listener, port) = (fd, UInt16(bigEndian: address.sin_port))
        // Given no answer, the connection waits in the listen backlog, never read or answered.
        guard let answer else { return }
        Thread.detachNewThread { [self] in
            let connection = accept(fd, nil, nil)
            var bytes: [UInt8] = []
            var buffer = [UInt8](repeating: 0, count: 4096)
            while !String(decoding: bytes, as: UTF8.self).contains("\r\n\r\n") {
                let count = read(connection, &buffer, buffer.count)
                if count <= 0 { break }
                bytes += buffer[..<count]
            }
            lock.withLock { received = String(decoding: bytes, as: UTF8.self) }
            let reply = Array(answer.utf8)
            _ = write(connection, reply, reply.count)
            close(connection)
        }
    }

    deinit { close(listener) }
}

@Suite("The URLSession transport, over a real socket")
struct URLSessionTransportTests {
    @Test("A real answer comes back: its status and body, with the token sent on the wire")
    func answers() async throws {
        let fixture = try Contract.load("me/in-session.json")
        let body = String(decoding: try JSONEncoder().encode(fixture.body), as: UTF8.self)
        let server = LocalServer(
            answer: "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)")
        let client = APIClient(
            baseURL: try #require(URL(string: "http://127.0.0.1:\(server.port)")),
            tokens: FixedToken(token: "token-real"))

        let me = await client.me()
        let answer = try Contract.appDecode(MeResponse.self, fixture.body)
        #expect(me.result == .status(200))
        #expect(me.answer == answer)
        #expect(server.head.hasPrefix("GET /v1/me HTTP/1.1\r\n"))
        #expect(server.head.contains("\r\nAuthorization: Bearer token-real\r\n"))
    }

    @Test("A server that never answers times out: .networkError, and the record kept")
    func timesOut() async throws {
        let server = LocalServer(answer: nil)
        let client = APIClient(
            baseURL: try #require(URL(string: "http://127.0.0.1:\(server.port)")),
            tokens: FixedToken(token: "t"), timeout: 1)
        let started = Date()
        let response = await client.unlock(
            session: "s1", UnlockRequest(eventId: "e1", deviceTime: started))
        #expect(response.result == .networkError)
        #expect(response.noAnswer == .unreachable)
        #expect(unlockDisposition(response.result, response.answer) == .retry)
        // Its own second, not the session's 15: on Linux, a timeout given to URLRequest's
        // initializer is ignored for the session's.
        #expect(Date().timeIntervalSince(started) < 10)
    }

    @Test("The default session caches nothing, and bounds a request's wait and a whole exchange")
    func defaultSession() {
        let configuration = URLSessionTransport.makeSession().configuration
        #expect(configuration.urlCache == nil)
        #expect(configuration.timeoutIntervalForRequest == APIClient.requestTimeout)
        #expect(configuration.timeoutIntervalForResource == URLSessionTransport.exchangeTimeout)
    }
}
