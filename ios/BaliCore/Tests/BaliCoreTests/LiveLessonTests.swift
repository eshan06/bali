import Foundation
import Testing

@testable import BaliCore

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// When a lesson test starts, by the phone's clock.
private let start = Date(timeIntervalSince1970: 1_790_000_000)

/// A live lesson's world in a test: the server's answers in order, and a clock that moves only
/// when the poll waits. Once no answer is left, the next wait throws, as the owner's cancel would.
final class LessonWorld: HTTPTransport, @unchecked Sendable {
    /// One answer: a status, its headers and body — or, with no status, none at all (offline).
    /// `cancels`: the task that sent it is cancelled on its way, as the app going behind does.
    struct Reply {
        var status: Int?
        var headers: [String: String] = [:]
        var body = ""
        var cancels = false

        static func ok(_ body: String, etag: String? = nil) -> Reply {
            Reply(status: 200, headers: etag.map { ["ETag": $0] } ?? [:], body: body)
        }
        static let notModified = Reply(status: 304)
        static let offline = Reply(status: nil)
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private var time: Date
    private var requests: [URLRequest] = []
    private var waits: [TimeInterval] = []

    init(_ replies: [Reply], now: Date = start) { (self.replies, time) = (replies, now) }

    var sent: [URLRequest] { lock.withLock { requests } }
    var slept: [TimeInterval] { lock.withLock { waits } }
    func now() -> Date { lock.withLock { time } }
    func then(_ more: Reply...) { lock.withLock { replies += more } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let next = lock.withLock {
            requests.append(request)
            return replies.isEmpty ? nil : replies.removeFirst()
        }
        let reply = try #require(next, "a request with no answer left: \(request.url!)")
        if reply.cancels { withUnsafeCurrentTask { $0?.cancel() } }
        guard let status = reply.status else { throw URLError(.notConnectedToInternet) }
        let response = HTTPURLResponse(
            url: try #require(request.url), statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: reply.headers)
        return (Data(reply.body.utf8), try #require(response))
    }

    /// The poll's wait: noted, and the clock moved on — and, once no answer is left, a throw. A
    /// poll that never takes the answers left (no token) is stopped at 20 waits, never spun.
    func sleep(_ seconds: TimeInterval) throws {
        try lock.withLock {
            waits.append(seconds)
            time += seconds
            if replies.isEmpty || waits.count >= 20 { throw CancellationError() }
        }
    }

    /// Session `s1`'s lesson in this world, its client signed in with `token`.
    func lesson(token: String? = "t") -> LiveLesson {
        LiveLesson(
            session: "s1",
            client: APIClient(
                baseURL: URL(string: "https://api.bali.test")!, tokens: FixedToken(token: token),
                transport: self),
            now: { self.now() }, sleep: { try self.sleep($0) })
    }
}

/// A fixture's body, as the API sends it.
private func wire(_ fixture: String) throws -> String {
    String(decoding: try JSONEncoder().encode(Contract.load(fixture).body), as: UTF8.self)
}

private func decoded(_ body: String) throws -> Presentation {
    try BaliJSON.makeDecoder().decode(Presentation.self, from: Data(body.utf8))
}

/// A running lesson's read: question `q1`, open, with the student's answer, if any.
private func asked(answer: StudentAnswer? = nil) -> String {
    let held = answer.map { #"{"option":\#($0.option),"eventId":"\#($0.eventId)"}"# } ?? "null"
    return #"""
        {"running":true,"question":{"id":"q1","prompt":"Which planet is the largest?",\#
        "options":["Mars","Jupiter","Venus"],"open":true,"correctOption":null,"answer":\#(held)},\#
        "slide":null,"phone":null}
        """#
}

/// A lower-case UUIDv7, as the API checks one.
private func isEventID(_ id: String) -> Bool {
    id.wholeMatch(of: /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/) != nil
}

/// An id's time: its first 48 bits, in milliseconds.
private func time(_ id: String) -> UInt64? {
    UInt64(id.replacing("-", with: "").prefix(12), radix: 16)
}

@Suite("A live lesson's poll")
struct LessonPollTests {
    @Test(
        "It reads every 2 s with the last ETag, and a 304 keeps the last read, the student's answer with it"
    )
    func cadence() async throws {
        let answer = StudentAnswer(option: 1, eventId: EventID.mint(at: start))
        let world = LessonWorld([.ok(asked(answer: answer), etag: #""a""#), .notModified, .notModified])
        let lesson = world.lesson()
        await lesson.run()

        let sent = world.sent
        #expect(sent.allSatisfy { $0.httpMethod == "GET" })
        #expect(
            sent.map(\.url?.absoluteString)
                == Array(repeating: "https://api.bali.test/v1/sessions/s1/presentation", count: 3))
        #expect(sent.map { $0.value(forHTTPHeaderField: "If-None-Match") } == [nil, #""a""#, #""a""#])
        #expect(world.slept == [2, 2, 2])
        let state = await lesson.state
        #expect(state.presentation == (try decoded(asked(answer: answer))))
        #expect(state.presentation?.question?.answer == answer)
        #expect(state.problem == nil)
        // The owner reads each change, the newest kept.
        var changes = lesson.updates.makeAsyncIterator()
        #expect(await changes.next() == state)
    }

    @Test("It stops by itself once a read says the session is not running, waiting no more")
    func stops() async throws {
        let world = LessonWorld([
            .ok(try wire("presentation/open.json"), etag: #""a""#),
            .ok(try wire("presentation/over.json"), etag: #""b""#),
        ])
        let lesson = world.lesson()
        await lesson.run()
        #expect(world.sent.count == 2)
        #expect(world.slept == [2])
        #expect(await lesson.state.presentation == (try decoded(wire("presentation/over.json"))))

        // Run again, it reads once, its 304 says the same, and it stops again.
        world.then(.notModified)
        await lesson.run()
        #expect(world.sent.last?.value(forHTTPHeaderField: "If-None-Match") == #""b""#)
        #expect(world.sent.count == 3)
        #expect(world.slept == [2])
    }

    @Test(
        "A 429 holds the poll for its Retry-After, from 2 s to a minute at most, the last read kept",
        arguments: [
            ("7", 7), (nil, 60), ("600", 60), ("1", 2), ("-5", 2),
            ("Wed, 21 Oct 2026 07:28:00 GMT", 60),
        ] as [(String?, TimeInterval)])
    func rateLimited(retryAfter: String?, wait: TimeInterval) async throws {
        let body = try wire("presentation/open.json")
        let world = LessonWorld([
            .ok(body, etag: #""a""#),
            LessonWorld.Reply(
                status: 429, headers: retryAfter.map { ["Retry-After": $0] } ?? [:],
                body: #"{"error":{"code":"rate_limited","message":"over budget"}}"#),
        ])
        let lesson = world.lesson()
        await lesson.run()
        #expect(world.slept == [2, wait])
        let state = await lesson.state
        #expect(state.problem == .rateLimited)
        #expect(state.presentation == (try decoded(body)))
    }

    @Test("Its wait over, the poll goes on every 2 s, and the next read ends the problem")
    func afterRateLimit() async throws {
        let world = LessonWorld([
            .ok(try wire("presentation/open.json"), etag: #""a""#),
            LessonWorld.Reply(status: 429, headers: ["Retry-After": "7"]),
            .notModified,
        ])
        let lesson = world.lesson()
        await lesson.run()
        #expect(world.slept == [2, 7, 2])
        #expect(world.sent.last?.value(forHTTPHeaderField: "If-None-Match") == #""a""#)
        #expect(await lesson.state.problem == nil)
    }

    @Test("A poll that fails says why and keeps the last read, trying again in 2 s; a read answered ends it")
    func failures() async throws {
        let body = try wire("presentation/open.json")
        let world = LessonWorld([.ok(body, etag: #""a""#), .offline])
        let lesson = world.lesson()
        await lesson.run()
        #expect(await lesson.state.problem == .unreachable(.unreachable))

        let refusals: [(LessonWorld.Reply, PollProblem)] = [
            (
                LessonWorld.Reply(status: 404, body: try wire("presentation/404-session-not-found.json")),
                .refused(status: 404, reason: .sessionNotFound)
            ),
            (
                LessonWorld.Reply(status: 403, body: try wire("presentation/403-not-enrolled.json")),
                .refused(status: 403, reason: nil)
            ),
            (LessonWorld.Reply(status: 502, body: "<html>Bad Gateway</html>"), .refused(status: 502, reason: nil)),
            (.ok("<html>OK</html>"), .refused(status: 200, reason: nil)),
        ]
        for (reply, problem) in refusals {
            world.then(reply)
            await lesson.run()
            let state = await lesson.state
            #expect(state.problem == problem)
            #expect(state.presentation == (try decoded(body)))
        }

        world.then(.notModified)
        await lesson.run()
        #expect(await lesson.state.problem == nil)
        #expect(world.slept == Array(repeating: 2, count: 7))
        #expect(world.sent.last?.value(forHTTPHeaderField: "If-None-Match") == #""a""#)
    }

    @Test("With no token to send, nothing is sent and it says so")
    func noToken() async throws {
        let world = LessonWorld([])
        let lesson = world.lesson(token: nil)
        await lesson.run()
        #expect(world.sent.isEmpty)
        #expect(await lesson.state.problem == .unreachable(.noToken))
    }

    @Test("Cancelled, as the app goes behind, it stops at once, keeping nothing of the read under way")
    func cancelled() async throws {
        let body = try wire("presentation/open.json")
        var over = LessonWorld.Reply.ok(try wire("presentation/over.json"), etag: #""b""#)
        over.cancels = true
        let world = LessonWorld([.ok(body, etag: #""a""#), over])
        let lesson = world.lesson()
        await Task { await lesson.run() }.value
        #expect(world.sent.count == 2)
        #expect(world.slept == [2])
        #expect(await lesson.state.presentation == (try decoded(body)))
    }
}

@Suite("A live lesson's answer")
struct LessonAnswerTests {
    @Test(
        "Each refusal the API answers with is known by its reason",
        arguments: [
            ("answers/409-question-closed.json", AnswerResult.questionClosed),
            ("answers/400-invalid-option.json", .invalidOption),
            ("answers/409-event-id-conflict.json", .eventIdConflict),
            ("answers/403-not-enrolled.json", .refused(status: 403, reason: nil)),
            ("answers/404-question-not-found.json", .refused(status: 404, reason: .questionNotFound)),
        ])
    func refusals(fixture: String, result: AnswerResult) async throws {
        let status = try Contract.load(fixture).status
        let world = LessonWorld([LessonWorld.Reply(status: status, body: try wire(fixture))])
        #expect(await world.lesson().answer(question: "q1", option: 0) == result)
        #expect(world.sent.count == 1)
    }

    @Test(
        "A refusal is known by its reason, never its message; a body it cannot read is the status alone",
        arguments: [
            (409, "account_deleted", "account deleted", AnswerResult.accountDeleted),
            (409, "event_id_conflict", "the question is closed", .eventIdConflict),
            (409, nil, "the question is closed", .refused(status: 409, reason: nil)),
            (429, nil, "over budget", .refused(status: 429, reason: nil)),
        ] as [(Int, String?, String, AnswerResult)])
    func byReason(status: Int, reason: String?, message: String, result: AnswerResult)
        async throws
    {
        let code = status == 429 ? "rate_limited" : "conflict"
        let said = reason.map { #","reason":"\#($0)""# } ?? ""
        let body = #"{"error":{"code":"\#(code)"\#(said),"message":"\#(message)"}}"#
        let world = LessonWorld([LessonWorld.Reply(status: status, body: body)])
        #expect(await world.lesson().answer(question: "q1", option: 0) == result)
    }

    @Test("An answer it cannot read is its status alone, never an answer")
    func unreadable() async throws {
        let world = LessonWorld([.ok("<html>OK</html>")])
        #expect(await world.lesson().answer(question: "q1", option: 0) == .refused(status: 200, reason: nil))
    }

    @Test("No answer is said so: offline, sent once, or no token, nothing sent")
    func noAnswer() async throws {
        let offline = LessonWorld([.offline])
        #expect(await offline.lesson().answer(question: "q1", option: 0) == .unreachable(.unreachable))
        #expect(offline.sent.count == 1)
        let signedOut = LessonWorld([])
        #expect(await signedOut.lesson(token: nil).answer(question: "q1", option: 0) == .unreachable(.noToken))
        #expect(signedOut.sent.isEmpty)
    }

    @Test(
        "Each pick is one request, under an id minted after the answer held from a clock a minute behind it, and after the pick before"
    )
    func mintsAfterHeld() async throws {
        // The laptop answered a minute ahead of this phone's clock.
        let held = StudentAnswer(option: 0, eventId: EventID.mint(at: start + 60))
        let world = LessonWorld([.ok(asked(answer: held), etag: #""a""#)], now: start)
        let lesson = world.lesson()
        await lesson.run()
        world.then(.offline, .offline)
        #expect(await lesson.answer(question: "q1", option: 2) == .unreachable(.unreachable))
        #expect(await lesson.answer(question: "q1", option: 1) == .unreachable(.unreachable))

        let answers = world.sent.dropFirst()
        #expect(answers.count == 2)
        let bodies = try answers.map { request in
            #expect(request.httpMethod == "POST")
            #expect(request.url?.absoluteString == "https://api.bali.test/v1/questions/q1/answers")
            return try JSONDecoder().decode(AnswerRequest.self, from: try #require(request.httpBody))
        }
        #expect(bodies.map(\.option) == [2, 1])
        let ids = bodies.map(\.eventId)
        #expect(ids.allSatisfy(isEventID))
        #expect(ids[0] > held.eventId)
        #expect(ids[1] > ids[0])
        // A millisecond on each time: random bits never decide the order.
        let held48 = try #require(time(held.eventId))
        #expect(ids.map(time) == [held48 + 1, held48 + 2])
    }

    @Test("The answer the server holds is kept, and a read made before it landed never takes it back")
    func keepsAnswer() async throws {
        let world = LessonWorld([.ok(asked(), etag: #""a""#)])
        let lesson = world.lesson()
        await lesson.run()

        let mine = StudentAnswer(option: 1, eventId: EventID.mint(at: start))
        world.then(.ok(#"{"outcome":"answered","answer":{"option":1,"eventId":"\#(mine.eventId)"}}"#))
        #expect(await lesson.answer(question: "q1", option: 1) == .answered(mine))
        #expect(await lesson.state.presentation?.question?.answer == mine)

        // A read the server made before the answer landed: the answer stays.
        world.then(.ok(asked(), etag: #""b""#))
        await lesson.run()
        #expect(await lesson.state.presentation?.question?.answer == mine)

        // The laptop's later answer, read: that one is the answer now.
        let laptop = StudentAnswer(option: 2, eventId: EventID.mint(at: start + 5))
        world.then(.ok(asked(answer: laptop), etag: #""c""#))
        await lesson.run()
        #expect(await lesson.state.presentation?.question?.answer == laptop)

        // A replay answering the laptop's, older than what is held, changes nothing kept.
        world.then(.ok(#"{"outcome":"replay","answer":{"option":1,"eventId":"\#(mine.eventId)"}}"#))
        #expect(await lesson.answer(question: "q1", option: 1) == .answered(mine))
        #expect(await lesson.state.presentation?.question?.answer == laptop)
    }
}

@Suite("Event ids minted after one held")
struct EventIDAfterTests {
    @Test("From a clock behind the id held, or at its millisecond, the id sorts after it, a millisecond on")
    func behind() throws {
        let held = EventID.mint(at: start + 60)
        for now in [start, start + 60] {
            let id = EventID.mint(at: now, after: held)
            #expect(isEventID(id))
            #expect(id > held)
            #expect(time(id) == (try #require(time(held))) + 1)
        }
    }

    @Test("From a clock ahead it is the clock's own time, and an id it cannot read is passed over")
    func ahead() {
        let held = EventID.mint(at: start)
        #expect(time(EventID.mint(at: start + 1, after: held)) == 1_790_000_001_000)
        #expect(time(EventID.mint(at: start, after: "not an id")) == 1_790_000_000_000)
        #expect(time(EventID.mint(at: start, after: nil)) == 1_790_000_000_000)
    }
}
