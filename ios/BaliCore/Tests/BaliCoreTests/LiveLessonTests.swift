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
    /// `holds`: it waits on its way until the test lets it go (`release`). `echoes`: the pick its
    /// request sent, taken, as the server answers an answer it now holds.
    struct Reply {
        var status: Int?
        var headers: [String: String] = [:]
        var body = ""
        var cancels = false
        var holds = false
        var echoes = false

        static func ok(_ body: String, etag: String? = nil) -> Reply {
            Reply(status: 200, headers: etag.map { ["ETag": $0] } ?? [:], body: body)
        }
        static let notModified = Reply(status: 304)
        static let offline = Reply(status: nil)
        static let took = Reply(status: 200, echoes: true)
        /// This answer, held on its way until the test lets it go.
        var held: Reply {
            var reply = self
            reply.holds = true
            return reply
        }
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private var time: Date
    private var requests: [URLRequest] = []
    private var waits: [TimeInterval] = []
    private var holding: [CheckedContinuation<Void, Never>] = []

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
        if reply.holds {
            await withCheckedContinuation { held in lock.withLock { holding.append(held) } }
        }
        if reply.cancels { withUnsafeCurrentTask { $0?.cancel() } }
        guard let status = reply.status else { throw URLError(.notConnectedToInternet) }
        var body = reply.body
        if reply.echoes {
            let pick = try JSONDecoder().decode(AnswerRequest.self, from: try #require(request.httpBody))
            body = #"{"outcome":"answered","answer":{"option":\#(pick.option),"eventId":"\#(pick.eventId)"}}"#
        }
        let response = HTTPURLResponse(
            url: try #require(request.url), statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: reply.headers)
        return (Data(body.utf8), try #require(response))
    }

    /// Waits until `count` answers are held on their way.
    func held(_ count: Int) async throws {
        while lock.withLock({ holding.count }) < count { try await Task.sleep(for: .milliseconds(1)) }
    }

    /// Lets the first answer held go on.
    func release() { lock.withLock { holding.removeFirst() }.resume() }

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

/// A running lesson's read: question `id`, open, with the student's answer, if any.
private func asked(_ id: String = "q1", answer: StudentAnswer? = nil) -> String {
    let held = answer.map { #"{"option":\#($0.option),"eventId":"\#($0.eventId)"}"# } ?? "null"
    return #"""
        {"running":true,"question":{"id":"\#(id)","prompt":"Which planet is the largest?",\#
        "options":["Mars","Jupiter","Venus"],"open":true,"correctOption":null,"answer":\#(held)},\#
        "slide":null,"phone":null}
        """#
}

/// The ids of the answers `world` was sent, in the order sent.
private func answerIDs(_ world: LessonWorld) throws -> [String] {
    try world.sent.filter { $0.httpMethod == "POST" }.map { request in
        try JSONDecoder().decode(AnswerRequest.self, from: try #require(request.httpBody)).eventId
    }
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

    @Test(
        "A second run takes over: the first stops at its read, saying nothing of it, so the poll never runs twice",
        .timeLimit(.minutes(3)))
    func oneRunAtATime() async throws {
        let slide = try wire("presentation/slide.json")
        let world = LessonWorld([
            .ok(try wire("presentation/open.json"), etag: #""a""#),
            LessonWorld.Reply.ok(asked(), etag: #""stale""#).held,
            .ok(slide, etag: #""b""#),
        ])
        let lesson = world.lesson()
        let first = Task { await lesson.run() }
        try await world.held(1)
        // A second run, never cancelling the first: it reads, and waits (no answer left: stopped).
        await lesson.run()
        world.release()
        await first.value
        #expect(world.sent.count == 3)
        // The first run's one wait, and the second's: the first never waits, nor reads, again.
        #expect(world.slept == [2, 2])
        #expect(await lesson.state.presentation == (try decoded(slide)))
    }

    @Test("Once a read says the session is over, a read failing after it says nothing: over, never unreachable")
    func overStaysOver() async throws {
        let over = try wire("presentation/over.json")
        let world = LessonWorld([.ok(over, etag: #""b""#)])
        let lesson = world.lesson()
        await lesson.run()
        for reply in [LessonWorld.Reply.offline, LessonWorld.Reply(status: 500)] {
            world.then(reply)
            await lesson.run()
            let state = await lesson.state
            #expect(state.problem == nil)
            #expect(state.presentation == (try decoded(over)))
        }
        #expect(world.sent.count == 3)
        #expect(world.slept.isEmpty)
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

    @Test("A pick on one question never shows as the answer to the next: not through a read, nor landing late")
    func twoQuestions() async throws {
        let world = LessonWorld([.ok(asked(), etag: #""a""#)])
        let lesson = world.lesson()
        await lesson.run()
        world.then(.took)
        guard case .answered(let mine) = await lesson.answer(question: "q1", option: 1) else {
            Issue.record("the pick on q1 was not taken")
            return
        }
        #expect(await lesson.state.presentation?.question?.answer == mine)

        // The teacher opens q2: its read shows no answer yet.
        world.then(.ok(asked("q2"), etag: #""b""#))
        await lesson.run()
        #expect(await lesson.state.presentation?.question?.id == "q2")
        #expect(await lesson.state.presentation?.question?.answer == nil)

        // A tap on q1's card made before it changed, landing now: taken, and kept off q2's card.
        world.then(.took)
        let late = await lesson.answer(question: "q1", option: 2)
        #expect(late == .answered(StudentAnswer(option: 2, eventId: try answerIDs(world)[1])))
        #expect(await lesson.state.presentation?.question?.answer == nil)
    }

    @Test(
        "An answer landing while a poll is out stays on the card when that poll's older read comes back",
        .timeLimit(.minutes(3)))
    func answerDuringPoll() async throws {
        // The second read is the server's from before the answer landed: it holds none.
        let world = LessonWorld([
            .ok(asked(), etag: #""a""#), LessonWorld.Reply.ok(asked(), etag: #""b""#).held, .took,
        ])
        let lesson = world.lesson()
        let polling = Task { await lesson.run() }
        try await world.held(1)
        guard case .answered(let mine) = await lesson.answer(question: "q1", option: 1) else {
            Issue.record("the pick was not taken")
            return
        }
        world.release()
        await polling.value
        #expect(await lesson.state.presentation?.question?.answer == mine)
    }

    @Test(
        "Two quick taps from a clock a minute behind land in order: the second minted after the first, and kept whichever answer comes back last",
        .timeLimit(.minutes(3)))
    func quickTaps() async throws {
        let held = StudentAnswer(option: 0, eventId: EventID.mint(at: start + 60))
        let world = LessonWorld([.ok(asked(answer: held), etag: #""a""#)], now: start)
        let lesson = world.lesson()
        await lesson.run()
        world.then(LessonWorld.Reply.took.held, .took)
        let first = Task { await lesson.answer(question: "q1", option: 2) }
        try await world.held(1)
        let second = await lesson.answer(question: "q1", option: 1)
        world.release()
        let answered = await first.value

        let ids = try answerIDs(world)
        let held48 = try #require(time(held.eventId))
        #expect(ids.map(time) == [held48 + 1, held48 + 2])
        #expect(answered == .answered(StudentAnswer(option: 2, eventId: ids[0])))
        #expect(second == .answered(StudentAnswer(option: 1, eventId: ids[1])))
        // The first tap's answer came back last; the second's, sorting after it, is the one kept.
        #expect(
            await lesson.state.presentation?.question?.answer
                == StudentAnswer(option: 1, eventId: ids[1]))
    }
}

/// A deck's bytes in a test, and their SHA-256 as the API gives a slide's.
private let pdf = "%PDF-1.7 Factoring quadratics"
private let pdfSHA256 = "bb00f1264482b1749c27e894811b96e133b8f53a83f9794981f20455b7037afc"

/// A page of that deck, shown.
private func slide(page: Int = 4) -> Slide {
    Slide(deckId: "d1", sha256: pdfSHA256, page: page, pageCount: 12)
}

/// The bucket's answer: the deck's bytes.
private let bucket = LessonWorld.Reply(status: 200, body: pdf)

/// Where the download fixture sends the phone, and where the route is.
private let fixtureURL =
    "https://deck-storage.invalid/decks%2F00000000-0000-7000-8000-000000000001.pdf?signature=fixture"
private let route = "https://api.bali.test/v1/decks/d1/download"

@Suite("A slide's deck")
struct LessonDeckTests {
    @Test("It asks for a URL, fetches the bytes with no token, and keeps them: the next page asks nothing")
    func fetchesAndKeeps() async throws {
        let world = LessonWorld([.ok(try wire("download/shown.json")), bucket])
        let lesson = world.lesson()
        #expect(await lesson.deck(for: slide(page: 4)) == .ready(Data(pdf.utf8)))
        #expect(await lesson.deck(for: slide(page: 5)) == .ready(Data(pdf.utf8)))

        let sent = world.sent
        #expect(sent.map(\.url?.absoluteString) == [route, fixtureURL])
        #expect(sent.map(\.httpMethod) == ["GET", "GET"])
        #expect(sent.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer t", nil])
    }

    @Test("Bytes whose SHA-256 is not the slide's are refused and kept nowhere: the next ask fetches again")
    func mismatch() async throws {
        let shown = LessonWorld.Reply.ok(try wire("download/shown.json"))
        let world = LessonWorld([
            shown, LessonWorld.Reply(status: 200, body: "%PDF-1.7 Something else"), shown, bucket,
        ])
        let lesson = world.lesson()
        #expect(await lesson.deck(for: slide()) == .mismatch)
        #expect(await lesson.deck(for: slide()) == .ready(Data(pdf.utf8)))
        #expect(world.sent.count == 4)
    }

    @Test("A URL the bucket refuses, as it refuses one expired, is asked for again once; refused again, it is said")
    func expired() async throws {
        let expired = LessonWorld.Reply(
            status: 403,
            body: "<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>")
        let freshURL = "https://deck-storage.invalid/decks%2Fd1.pdf?signature=fresh"
        let fresh = LessonWorld.Reply.ok(#"{"url":"\#(freshURL)"}"#)
        let world = LessonWorld([.ok(try wire("download/shown.json")), expired, fresh, bucket])
        #expect(await world.lesson().deck(for: slide()) == .ready(Data(pdf.utf8)))
        #expect(world.sent.map(\.url?.absoluteString) == [route, fixtureURL, route, freshURL])

        // The fresh URL refused too: said, and never asked for a third time.
        world.then(fresh, expired, fresh, expired)
        #expect(await world.lesson().deck(for: slide()) == .refused(status: 403, reason: nil))
        #expect(world.sent.count == 8)
    }

    @Test(
        "Each refusal of the download is said by its status and reason, asked once, and kept nowhere",
        arguments: [
            ("download/403-not-shown.json", DeckResult.refused(status: 403, reason: nil)),
            ("download/404-deck-not-found.json", .refused(status: 404, reason: .deckNotFound)),
            ("download/503-deck-storage-off.json", .refused(status: 503, reason: .deckStorageOff)),
        ])
    func refusals(fixture: String, result: DeckResult) async throws {
        let refusal = LessonWorld.Reply(status: try Contract.load(fixture).status, body: try wire(fixture))
        let world = LessonWorld([refusal, refusal])
        let lesson = world.lesson()
        #expect(await lesson.deck(for: slide()) == result)
        #expect(await lesson.deck(for: slide()) == result)
        #expect(world.sent.count == 2)
    }

    @Test("No answer, an answer it cannot read, or the bucket's own refusal is said; with no token nothing is sent")
    func failures() async throws {
        let shown = LessonWorld.Reply.ok(try wire("download/shown.json"))
        let elsewhere = LessonWorld.Reply(status: 302, headers: ["Location": "https://elsewhere.test/"])
        let cases: [([LessonWorld.Reply], DeckResult)] = [
            ([.offline], .unreachable(.unreachable)),
            ([.ok("<html>OK</html>")], .refused(status: 200, reason: nil)),
            ([shown, .offline], .unreachable(.unreachable)),
            ([shown, LessonWorld.Reply(status: 500)], .refused(status: 500, reason: nil)),
            ([shown, elsewhere], .refused(status: 302, reason: nil)),
        ]
        for (replies, result) in cases {
            let world = LessonWorld(replies)
            #expect(await world.lesson().deck(for: slide()) == result)
            #expect(world.sent.count == replies.count)
        }
        let signedOut = LessonWorld([])
        #expect(await signedOut.lesson(token: nil).deck(for: slide()) == .unreachable(.noToken))
        #expect(signedOut.sent.isEmpty)
    }

    @Test("The session's end empties what it kept: once a read says it is over, the deck is asked for again")
    func sessionEnd() async throws {
        let world = LessonWorld([.ok(try wire("download/shown.json")), bucket])
        let lesson = world.lesson()
        #expect(await lesson.deck(for: slide()) == .ready(Data(pdf.utf8)))
        world.then(.ok(try wire("presentation/over.json"), etag: #""b""#))
        await lesson.run()

        world.then(LessonWorld.Reply(status: 403, body: try wire("download/403-not-shown.json")))
        #expect(await lesson.deck(for: slide()) == .refused(status: 403, reason: nil))
        #expect(world.sent.count == 4)
    }

    @Test("A deck still on its way when the session ends goes to its asker, and is kept nowhere", .timeLimit(.minutes(3)))
    func endsMidFetch() async throws {
        let world = LessonWorld([.ok(try wire("download/shown.json")), bucket.held])
        let lesson = world.lesson()
        let fetching = Task { await lesson.deck(for: slide()) }
        try await world.held(1)
        world.then(.ok(try wire("presentation/over.json"), etag: #""b""#))
        await lesson.run()
        world.release()
        #expect(await fetching.value == .ready(Data(pdf.utf8)))

        world.then(LessonWorld.Reply(status: 403, body: try wire("download/403-not-shown.json")))
        #expect(await lesson.deck(for: slide()) == .refused(status: 403, reason: nil))
        #expect(world.sent.count == 4)
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
