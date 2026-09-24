import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// How long, in real time, a test waits for the engine before it fails instead of hanging: well
/// past the iOS Simulator's stalls on GitHub's runner (up to thirteen seconds, DECISIONS B2).
let patience = Duration.seconds(30)

/// A clock that moves only when the test moves it.
final class TestClock: SyncClock, @unchecked Sendable {
    struct Sleeper {
        let id: UUID
        let deadline: Date
        let wake: CheckedContinuation<Void, any Error>
    }

    private let lock = NSLock()
    private var current: Date
    private var sleepers: [Sleeper] = []

    init(_ start: Date = t0) { current = start }

    func now() -> Date { lock.withLock { current } }

    /// The deadlines slept on now, soonest first.
    var deadlines: [Date] { lock.withLock { sleepers.map(\.deadline).sorted() } }

    func sleep(until deadline: Date) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (wake: CheckedContinuation<Void, any Error>) in
                enqueue(Sleeper(id: id, deadline: deadline, wake: wake))
            }
        } onCancel: {
            cancel(id)
        }
    }

    private func enqueue(_ sleeper: Sleeper) {
        lock.lock()
        defer { lock.unlock() }
        if Task.isCancelled {
            sleeper.wake.resume(throwing: CancellationError())
        } else if sleeper.deadline <= current {
            sleeper.wake.resume()
        } else {
            sleepers.append(sleeper)
        }
    }

    private func cancel(_ id: UUID) {
        lock.lock()
        let index = sleepers.firstIndex { $0.id == id }
        let sleeper = index.map { sleepers.remove(at: $0) }
        lock.unlock()
        sleeper?.wake.resume(throwing: CancellationError())
    }

    /// Moves the clock on, waking every sleep that is then due.
    func advance(by seconds: TimeInterval) {
        lock.lock()
        current += seconds
        let now = current
        let due = sleepers.filter { $0.deadline <= now }
        sleepers.removeAll { $0.deadline <= now }
        lock.unlock()
        for sleeper in due { sleeper.wake.resume() }
    }
}

/// The API, answered by hand: each request waits until the test answers it.
actor Server: HTTPTransport {
    /// The request's answer, given once: the test's, or no answer when the server closes.
    final class Reply: @unchecked Sendable {
        private let lock = NSLock()
        private var answer: CheckedContinuation<(status: Int?, body: Data), Never>?

        init(_ answer: CheckedContinuation<(status: Int?, body: Data), Never>) {
            self.answer = answer
        }

        func callAsFunction(_ status: Int?, _ body: Data) {
            lock.lock()
            let answer = self.answer
            self.answer = nil
            lock.unlock()
            answer?.resume(returning: (status, body))
        }
    }

    struct Exchange: Sendable {
        let request: URLRequest
        let answer: Reply

        var route: String { "\(request.httpMethod ?? "?") \(request.url?.path() ?? "?")" }
        var token: String? { request.value(forHTTPHeaderField: "Authorization") }
        var eventId: String? { body?.eventId }
        var deviceTime: String? { body?.deviceTime }
        private var body: EventBody? {
            request.httpBody.flatMap { try? JSONDecoder().decode(EventBody.self, from: $0) }
        }

        /// Answers with `status` and `body`, or with no answer at all when `status` is nil.
        func reply(_ status: Int?, _ body: String = "") { answer(status, Data(body.utf8)) }
    }

    struct EventBody: Decodable {
        let eventId: String?
        let deviceTime: String?
    }

    /// No request to the route came in time.
    struct NoRequest: Error {
        let route: String
    }

    private var unanswered: [Exchange] = []
    private var takers: [(id: UUID, route: String?, take: CheckedContinuation<Exchange?, Never>)] =
        []
    private var replies: [Reply] = []
    private var closed = false

    /// The routes of the requests sent and not yet taken by `next`.
    var waiting: [String] { unanswered.map(\.route) }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (status, body) = await withCheckedContinuation {
            (answer: CheckedContinuation<(status: Int?, body: Data), Never>) in
            let exchange = Exchange(request: request, answer: Reply(answer))
            replies.append(exchange.answer)
            if closed { return exchange.reply(nil) }
            if let index = takers.firstIndex(where: { $0.route == nil || $0.route == exchange.route })
            {
                takers.remove(at: index).take.resume(returning: exchange)
            } else {
                unanswered.append(exchange)
            }
        }
        guard let status, let url = request.url,
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)
        else { throw URLError(.notConnectedToInternet) }
        return (body, response)
    }

    /// The next request the engine sends — the next to `route`, when one is named — once it has;
    /// none in time fails the test rather than hanging it.
    func next(_ route: String? = nil) async throws -> Exchange {
        if let index = unanswered.firstIndex(where: { route == nil || $0.route == route }) {
            return unanswered.remove(at: index)
        }
        let id = UUID()
        let timer = Task {
            try await Task.sleep(for: patience)
            expire(id)
        }
        defer { timer.cancel() }
        let exchange = await withCheckedContinuation { takers.append((id, route, $0)) }
        guard let exchange else { throw NoRequest(route: route ?? "any") }
        return exchange
    }

    private func expire(_ id: UUID) {
        guard let index = takers.firstIndex(where: { $0.id == id }) else { return }
        takers.remove(at: index).take.resume(returning: nil)
    }

    /// No answer to anything from now on — a request in flight included, taken or not — so none
    /// holds the engine up.
    func close() {
        closed = true
        for reply in replies { reply(nil, Data()) }
        unanswered = []
    }
}

/// B4's stand-in: a token to give, or none, and a refresh that mints a fresh one.
actor Tokens: TokenProvider {
    private(set) var token: String? = "token-1"
    private(set) var refreshes = 0
    let refreshWorks: Bool
    /// Refreshes under way, held until `release()`; nil when refreshes are not held.
    private var held: [CheckedContinuation<Void, Never>]?

    init(refreshWorks: Bool = true) { self.refreshWorks = refreshWorks }

    func accessToken() -> String? { token }
    func set(_ token: String?) { self.token = token }

    /// Every refresh from now on runs until `release()`: one under way, for as long as the test says.
    func hold() { held = [] }

    func release() {
        let waiting = held ?? []
        held = nil
        for refresh in waiting { refresh.resume() }
    }

    func refresh() async -> Bool {
        refreshes += 1
        if held != nil { await withCheckedContinuation { held?.append($0) } }
        guard refreshWorks else { return false }
        token = "token-\(refreshes + 1)"
        return true
    }
}

/// An engine running over a fresh outbox, a hand-answered server, a test clock and B4's stand-in.
struct Rig {
    let engine: SyncEngine
    let outbox: Outbox
    let server = Server()
    let clock = TestClock()
    let tokens: Tokens
    let running: Task<Void, Never>

    init(outbox: Outbox? = nil, refreshWorks: Bool = true) throws {
        let outbox = try outbox ?? makeOutbox().outbox
        let tokens = Tokens(refreshWorks: refreshWorks)
        let client = APIClient(
            baseURL: URL(string: "https://api.bali.test")!, tokens: tokens, transport: server)
        let engine = SyncEngine(
            outbox: outbox, client: client, clock: clock, refresh: { await tokens.refresh() })
        (self.engine, self.outbox, self.tokens) = (engine, outbox, tokens)
        running = Task { await engine.run() }
    }

    /// Waits for a state `condition` holds for, and returns it; none in time fails the test.
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

    /// Waits until the clock has exactly these sleeps: the engine is waiting on them.
    func sleeping(_ deadlines: [Date]) async throws {
        try await eventually { clock.deadlines == deadlines }
    }

    /// Taps into `view` as the server answers it: the phone in that session, focused.
    func tapIn(_ view: SessionView = session()) async throws {
        try await engine.record(.tap(tagId: "tag"))
        try await server.next(tapRoute).reply(200, Answer.joined(view))
        await until { $0.standing == .inSession(view, .focused) && $0.queued.isEmpty }
    }

    /// Brings the app to the foreground, answering the read of the truth it makes at once; the
    /// read loop then waits for its next check-in.
    func foreground(_ me: String = Answer.me()) async throws {
        await engine.setForeground(true)
        try await server.next(meRoute).reply(200, me)
        try await eventually { clock.deadlines.contains(clock.now().addingTimeInterval(30)) }
    }

    /// Stops the engine: both loops must end.
    func stop() async {
        running.cancel()
        await server.close()
        await running.value
    }
}

/// Waits, in real time, for `condition`; never true in time fails the test.
func eventually(_ condition: () async -> Bool) async throws {
    let deadline = ContinuousClock.now + patience
    while ContinuousClock.now < deadline {
        if await condition() { return }
        try await Task.sleep(for: .milliseconds(1))
    }
    Issue.record("never came true")
}

/// `seconds` after `t0`.
func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

/// Session `id`, ending `endsAt` seconds after `t0`, as the phone keeps it and as an answer names it.
func session(_ id: String = "s", endsAt: TimeInterval = 3000) -> SessionView {
    SessionView(id: id, classId: "c", endsAt: at(endsAt))
}

func json(_ view: SessionView) -> String {
    #"{"id":"\#(view.id)","classId":"\#(view.classId)","endsAt":"\#(iso(view.endsAt))"}"#
}

/// A time as the API writes one.
func iso(_ date: Date) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
}

/// The answers the engine's tests send, as the API writes them.
enum Answer {
    static func joined(_ view: SessionView = session(), state: String = "focused") -> String {
        #"{"outcome":"joined","session":\#(json(view)),"state":"\#(state)"}"#
    }
    static func replay(_ view: SessionView = session(), state: String) -> String {
        #"{"outcome":"replay","session":\#(json(view)),"state":"\#(state)"}"#
    }
    static let armed = #"{"outcome":"armed","session":null,"state":null}"#
    static let replayNoSession = #"{"outcome":"replay","session":null,"state":null}"#
    static func unlocked(_ view: SessionView = session()) -> String {
        #"{"outcome":"applied","recordedAs":null,"state":"unlocked","session":\#(json(view)),"reason":null}"#
    }
    static let unlockNoted =
        #"{"outcome":"recorded","recordedAs":"no_live_participation","state":null,"session":null,"reason":null}"#
    static func unlockAfterEnd(_ view: SessionView = session()) -> String {
        #"{"outcome":"recorded","recordedAs":"after_session_end","state":null,"session":\#(json(view)),"reason":null}"#
    }
    /// A late unlock (A10): recorded, and the state the student's own later return left, named.
    static func unlockSuperseded(_ view: SessionView = session()) -> String {
        #"{"outcome":"recorded","recordedAs":"superseded","state":"focused","session":\#(json(view)),"reason":null}"#
    }
    static func refocused(_ view: SessionView = session()) -> String {
        #"{"outcome":"applied","state":"focused","session":\#(json(view))}"#
    }
    static func live(_ view: SessionView = session(), state: String = "focused") -> String {
        #"{"status":"live","state":"\#(state)","session":\#(json(view))}"#
    }
    static let gone = #"{"status":"gone","state":null,"session":null}"#
    static func me(_ view: SessionView? = session(), state: String = "focused") -> String {
        let live = view.map {
            #"{"id":"\#($0.id)","classId":"\#($0.classId)","endsAt":"\#(iso($0.endsAt))","state":"\#(state)"}"#
        }
        return
            #"{"user":{"id":"u","role":"student","displayName":null},"classes":[],"session":\#(live ?? "null")}"#
    }
    static func refused(_ reason: String) -> String {
        #"{"error":{"code":"conflict","reason":"\#(reason)","message":"\#(reason)"}}"#
    }
}
