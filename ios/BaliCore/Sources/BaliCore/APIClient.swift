import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking  // URLSession and URLRequest, on Linux.
#endif

// The API client both iOS apps call the API through (ARCHITECTURE, "iOS app structure", decision
// 5): one method per student endpoint, each taking its typed request and answering with an
// `APIResponse` — the send result and body the outbox tables take, unjudged. It never retries,
// refreshes a token, deletes a record or decides what an answer means: the sync engine does, with
// those tables (decision 4, B3). Nor does it mint an event id: each request carries the one the
// outbox minted when it wrote the record (rule 4).

/// Where the client gets the bearer token every request carries (auth decision 2): Cognito's
/// access token, from B4.
public protocol TokenProvider: Sendable {
    /// The token to send now, or nil when there is none to give right now — offline with an
    /// expired one, a refresh under way, nobody signed in yet.
    ///
    /// Nil is never a sign-out and never a reason to drop a record ("Only a real 'no' signs anyone
    /// out"): the client sends nothing and answers `.networkError`, `NoAnswer.noToken`, which every
    /// outbox table reads as retry, the record kept. It never sends a request without a token —
    /// that would earn a `401` nobody said — and never refreshes one: a `401` comes back as a
    /// value, and the caller's `reauth` path asks B4 for a fresh token.
    func accessToken() async -> String?
}

/// Why a call has no answer: `SendResult.networkError`, which every outbox table reads as retry.
public enum NoAnswer: Sendable, Hashable {
    /// The token provider had none to give, so nothing was sent — not "can't reach the server".
    case noToken
    /// No HTTP answer came: offline, a timeout, a dropped connection, a cancelled call — or, never
    /// in practice, a request that could not be built.
    case unreachable
}

/// One call's answer, as the outbox tables take it: `tapDisposition(response.result,
/// response.answer)`. A refusal is a value like any other answer, never a thrown error, so nothing
/// is lost on the way to the table that decides the record's fate.
public struct APIResponse<Answer: Decodable & Sendable>: Sendable {
    /// The status the server answered with, or `.networkError` when no answer came.
    public let result: SendResult
    /// On a 2xx, the body decoded as the endpoint's response type, as the app decodes one (a value
    /// this build does not know is `.unknown`). Nil on any other status, or when it does not
    /// decode: no known outcome, so each table keeps the record.
    public let answer: Answer?
    /// On any other status, the body decoded as the one error shape, whose `reason` a screen keys
    /// on. Nil on a 2xx, or when it does not decode (a proxy's own error page, say).
    public let error: ApiErrorBody?
    /// Why no answer came, when `result` is `.networkError`; nil when one did.
    public let noAnswer: NoAnswer?

    init(_ noAnswer: NoAnswer) {
        (result, answer, error, self.noAnswer) = (.networkError, nil, nil, noAnswer)
    }

    init(status: Int, body: Data) {
        let decoder = BaliJSON.makeDecoder()
        let succeeded = (200..<300).contains(status)
        result = .status(status)
        answer = succeeded ? (try? decoder.decode(Answer.self, from: body)) : nil
        error = succeeded ? nil : (try? decoder.decode(ApiErrorBody.self, from: body))
        noAnswer = nil
    }
}

extension APIResponse: Equatable where Answer: Equatable {}

/// How the client puts a request on the wire: a URLSession in the apps, a double in the tests.
public protocol HTTPTransport: Sendable {
    /// `request`'s answer: its body and response. Throws when no HTTP answer came.
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// The apps' transport, over a URLSession. It follows no redirect: a 3xx comes back as the
/// answer (see `NoRedirects`).
public struct URLSessionTransport: HTTPTransport {
    /// How long a whole exchange may take, however steadily its bytes arrive.
    public static let exchangeTimeout: TimeInterval = 30

    let session: URLSession

    /// `session` defaults to an ephemeral one with no cache: nothing about a student is kept on
    /// disk, and a read of the truth is never answered from a cache.
    public init(session: URLSession = URLSessionTransport.makeSession()) { self.session = session }

    public static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = APIClient.requestTimeout
        configuration.timeoutIntervalForResource = exchangeTimeout
        #if canImport(FoundationNetworking)
            // FoundationNetworking asks only the session's delegate about a redirect, never the
            // one `send` passes with the task — so on Linux the session carries it too.
            return URLSession(
                configuration: configuration, delegate: NoRedirects.delegate, delegateQueue: nil)
        #else
            return URLSession(configuration: configuration)
        #endif
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request, delegate: NoRedirects.delegate)
        guard let response = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, response)
    }
}

/// Declines every redirect, so its 3xx comes back as the answer: a status like any other, which
/// every outbox table reads as retry, the record kept. Followed, a redirect would carry every
/// header, the bearer token included, to whichever host its `Location` names — and a 301 or 302
/// would resend a POST as a GET with no body. The API never redirects: a 3xx is something else
/// answering in its place.
final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    static let delegate = NoRedirects()

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// The student endpoints, one call each. Each answers with what the server said, whatever it
/// said, and sends its request once: whether to send it again is the outbox's to decide.
public struct APIClient: Sendable {
    /// How long a request may wait for its next byte before it is no answer: well inside the
    /// 30-second check-in, and long enough for a school's Wi-Fi at the bell. A timeout is
    /// `.networkError` — retry — so a request the server did record goes again under its event id
    /// and is answered as a replay.
    public static let requestTimeout: TimeInterval = 15

    /// Where the API is: a scheme and host, and the path it sits under, if any.
    public let baseURL: URL
    let tokens: any TokenProvider
    let transport: any HTTPTransport
    let timeout: TimeInterval

    public init(
        baseURL: URL, tokens: any TokenProvider,
        transport: any HTTPTransport = URLSessionTransport(),
        timeout: TimeInterval = APIClient.requestTimeout
    ) {
        (self.baseURL, self.tokens, self.transport, self.timeout) =
            (baseURL, tokens, transport, timeout)
    }

    /// `GET /v1/me` — the boot call; a read of the truth, for `readMayReconcile`.
    public func me() async -> APIResponse<MeResponse> { await send("GET", "/v1/me") }

    /// `PATCH /v1/me` — the student sets their own display name.
    public func updateMe(_ request: UpdateMeRequest) async -> APIResponse<UpdateMeResponse> {
        await send("PATCH", "/v1/me", request)
    }

    /// `POST /v1/taps` — for `tapDisposition`.
    public func tap(_ request: TapRequest) async -> APIResponse<TapResponse> {
        await send("POST", "/v1/taps", request)
    }

    /// `POST /v1/sessions/{id}/checkin` — a read of the truth, for `readMayReconcile`.
    public func checkIn(session id: String, _ request: CheckInRequest) async
        -> APIResponse<CheckInResponse>
    {
        await send("POST", "/v1/sessions/\(escaped(id))/checkin", request)
    }

    /// `POST /v1/sessions/{id}/unlock` — for `unlockDisposition`.
    public func unlock(session id: String, _ request: UnlockRequest) async
        -> APIResponse<UnlockResponse>
    {
        await send("POST", "/v1/sessions/\(escaped(id))/unlock", request)
    }

    /// `POST /v1/sessions/{id}/refocus` — for `stateChangeDisposition`.
    public func refocus(session id: String, _ request: RefocusRequest) async
        -> APIResponse<RefocusResponse>
    {
        await send("POST", "/v1/sessions/\(escaped(id))/refocus", request)
    }

    /// `POST /v1/sessions/{id}/protection-off` — for `stateChangeDisposition`.
    public func protectionOff(session id: String, _ request: ProtectionOffRequest) async
        -> APIResponse<ProtectionOffResponse>
    {
        await send("POST", "/v1/sessions/\(escaped(id))/protection-off", request)
    }

    /// `POST /v1/enrollments` — join a class by its code.
    public func join(_ request: EnrollmentJoinRequest) async -> APIResponse<EnrollmentJoinResponse>
    {
        await send("POST", "/v1/enrollments", request)
    }

    /// `DELETE /v1/enrollments/{id}` — leave a class.
    public func leave(enrollment id: String) async -> APIResponse<EndEnrollmentResponse> {
        await send("DELETE", "/v1/enrollments/\(escaped(id))")
    }

    /// `GET /v1/join-codes/{code}` — what a code opens, before joining it. The code goes as typed:
    /// the server reads case and surrounding whitespace as noise, as the join does.
    public func previewJoinCode(_ code: String) async -> APIResponse<JoinCodePreviewResponse> {
        await send("GET", "/v1/join-codes/\(escaped(code))")
    }

    /// `GET /v1/me/history` — a page of the student's own history, newest first: the moments
    /// before `before` (the last page's `nextBefore`), at most `limit` of them; nil for the
    /// server's defaults.
    public func history(before: String? = nil, limit: Int? = nil) async -> APIResponse<HistoryPage>
    {
        let query = [limit.map { "limit=\($0)" }, before.map { "before=\(escaped($0))" }]
            .compactMap { $0 }.joined(separator: "&")
        return await send("GET", "/v1/me/history" + (query.isEmpty ? "" : "?" + query))
    }

    /// One request, sent once, and its answer as the tables take it.
    private func send<Answer: Decodable & Sendable>(
        _ method: String, _ path: String, _ body: (any Encodable & Sendable)? = nil
    ) async -> APIResponse<Answer> {
        guard let token = await tokens.accessToken(), !token.isEmpty else { return .init(.noToken) }
        // Neither the URL nor the body can fail — `path` is ASCII the client escaped, and every
        // body is strings, times and closed vocabularies — but were either to, nothing is sent and
        // the record is kept: never a request without its body, which a state change's table
        // would drop as a 400.
        var root = baseURL.absoluteString
        while root.hasSuffix("/") { root.removeLast() }
        guard let url = URL(string: root + path) else { return .init(.unreachable) }
        var request = URLRequest(url: url)
        // Set, not passed to the initializer: FoundationNetworking ignores an initializer's timeout
        // for its session's.
        request.timeoutInterval = timeout
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            guard let data = try? BaliJSON.makeEncoder().encode(body) else {
                return .init(.unreachable)
            }
            // Only with a body: Fastify refuses a JSON content type on an empty one — a DELETE's —
            // with a 400.
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = data
        }
        do {
            let (data, response) = try await transport.send(request)
            return .init(status: response.statusCode, body: data)
        } catch {
            return .init(.unreachable)
        }
    }
}

/// `value` as one path segment or query value: every byte but an ASCII letter or digit, `-`, `_`
/// or `~` percent-encoded, so nothing a student types — a space, a `/`, a `?`, a `..` — changes
/// the URL's shape.
private func escaped(_ value: String) -> String {
    value.utf8.map { byte in
        switch byte {
        case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
            UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "-"), UInt8(ascii: "_"),
            UInt8(ascii: "~"):
            String(UnicodeScalar(byte))
        default: String(format: "%%%02X", byte)
        }
    }.joined()
}
