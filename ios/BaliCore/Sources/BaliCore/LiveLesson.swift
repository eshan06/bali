import Foundation

#if canImport(CryptoKit)
    import CryptoKit
#else
    import Crypto  // swift-crypto: CryptoKit's API where there is no CryptoKit (Linux, the tests)
#endif
#if canImport(FoundationNetworking)
    import FoundationNetworking  // URLRequest, on Linux.
#endif

// A live lesson as the student's phone follows it (Phase 7, L5 and M7; ARCHITECTURE, "Live
// lesson", decisions 1, 2, 4–6, 8; "iOS app structure", decision 6): the poll of what a running
// session shows, the student's answer, and the deck a slide names. No screen here: the app's (L8,
// M8) shows `state` and a slide's deck, sends a tap through `answer`, and runs the poll only while
// the app is in front.

/// What the phone knows of a live lesson.
public struct LessonState: Sendable, Hashable {
    /// What the last read said — kept through each `304` and each failed poll, the student's own
    /// answer with it, and given each answer the server takes since — nil until the first read.
    /// `running` false: the session is over, and the poll has stopped.
    public internal(set) var presentation: Presentation?
    /// Why the last poll brought nothing, said beside what is kept (rule 5) while the poll tries
    /// again by itself; nil once one is answered, and once the session is over.
    public internal(set) var problem: PollProblem?
}

/// Why a poll brought nothing.
public enum PollProblem: Sendable, Hashable {
    /// No answer came (`NoAnswer`): offline, a timeout, or no token to send.
    case unreachable(NoAnswer)
    /// `429`: over the account's budget, the poll waits out its `Retry-After` (decision 6).
    case rateLimited
    /// Any other answer than a `200` it can read or a `304`: its status, and the reason its error
    /// shape names, if any.
    case refused(status: Int, reason: ApiErrorReason?)
}

/// How an answer's one request ended: the answer the server holds, or why not — each a line the
/// card says, and a tap sends it again (rule 5). A refusal is known by its reason, never its
/// message.
public enum AnswerResult: Sendable, Hashable {
    /// The answer the server holds now: this one, or — a replay, or an id that sorted before the
    /// one it held (decision 4) — that one.
    case answered(StudentAnswer)
    /// `409 question_closed`: closed, or the bell rang, before it arrived; not counted.
    case questionClosed
    /// `400 invalid_option`: the question has no such option.
    case invalidOption
    /// `409 event_id_conflict`: its id is spent elsewhere, nothing recorded; a tap mints another.
    case eventIdConflict
    /// `409 account_deleted`: the account was deleted on its way; nothing recorded.
    case accountDeleted
    /// No answer came (`NoAnswer`): the server may hold it or not, and a tap again settles which.
    case unreachable(NoAnswer)
    /// Any other answer: its status, and the reason its error shape names, if any.
    case refused(status: Int, reason: ApiErrorReason?)
}

/// How the deck a slide names came: its bytes, checked, or why not — each said on the slide with
/// a Try again (rule 5), and a failure kept nowhere, so the next ask fetches the deck anew.
public enum DeckResult: Sendable, Hashable {
    /// The PDF, its SHA-256 the slide's: the only bytes a slide view is given, rendered with no
    /// link in them followed (decision 8).
    case ready(Data)
    /// Bytes came, but their SHA-256 is not the slide's: refused, never rendered.
    case mismatch
    /// No answer came, from the API or the bucket (`NoAnswer`).
    case unreachable(NoAnswer)
    /// Any other answer, from the API or the bucket: its status, and the reason the API's error
    /// shape names, if any — `403` once no running session of the student's class shows the deck,
    /// `404 deck_not_found` once it is removed, `503 deck_storage_off`; or the bucket's own refusal
    /// of a fresh URL.
    case refused(status: Int, reason: ApiErrorReason?)
}

/// One running session's live lesson, as the student's phone follows it: the poll keeps `state`,
/// `answer` sends the student's pick, and `deck(for:)` fetches the deck a slide names.
public actor LiveLesson {
    /// How often the poll reads: about every 2 s (decision 2), 30 of the account's 120 a minute
    /// (decision 6).
    public static let interval: TimeInterval = 2
    /// The longest a `429` holds the poll: the account's budget refills within its minute, so a
    /// longer `Retry-After`, or none, waits this.
    public static let longestWait: TimeInterval = 60

    /// The running session whose lesson this is.
    public nonisolated let session: String
    /// Each change of `state`, the newest kept until read: what the owner shows. It ends with the
    /// lesson.
    public nonisolated let updates: AsyncStream<LessonState>
    public private(set) var state = LessonState() {
        didSet { if state != oldValue { changed.yield(state) } }
    }

    let client: APIClient
    let now: @Sendable () -> Date
    let sleep: @Sendable (TimeInterval) async throws -> Void
    private let changed: AsyncStream<LessonState>.Continuation
    /// The last `200`'s `ETag`, sent back as `If-None-Match`.
    private var etag: String?
    /// The last answer minted here, and its question: the next is minted after it, as after the one
    /// held, so two taps sort in the order made however far behind the phone's clock stands.
    private var minted: (question: String, eventId: String)?
    /// The newest `run()`'s number: an older run stops at its next read, saying nothing of it.
    private var runs = 0
    /// The decks this session showed, checked, by their SHA-256: in memory alone, never on disk,
    /// emptied once a read says the session is over, and gone with the lesson when its owner drops
    /// it, as at sign-out (decision 8).
    /// ponytail: every deck the session showed stays (each at most 25 MB); keep only the slide's
    /// own if lessons ever show more than a few.
    private var decks: [String: Data] = [:]

    /// `client` is the app's one client: an answer never goes through the outbox (decision 5).
    /// `now` and `sleep` are the phone's clock and its wait, a test's own there.
    public init(
        session: String, client: APIClient, now: @escaping @Sendable () -> Date = { Date() },
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = {
            try await Task.sleep(for: .seconds($0))
        }
    ) {
        (self.session, self.client, self.now, self.sleep) = (session, client, now, sleep)
        let (stream, continuation) = AsyncStream.makeStream(
            of: LessonState.self, bufferingPolicy: .bufferingNewest(1))
        (updates, changed) = (stream, continuation)
    }

    deinit { changed.finish() }

    /// Polls until a read says the session is not running, or the task is cancelled. Its owner
    /// runs it while the app is in front and cancels it as the app goes behind, so nothing polls
    /// behind the app. One run at a time: a newer one takes over and the older stops at its next
    /// read, so the poll never comes twice as often, nor stops because an older run was still
    /// winding down as the app came back to the front.
    public func run() async {
        runs += 1
        let run = runs
        while let wait = await poll(run) {
            do { try await sleep(wait) } catch { return }
        }
    }

    /// One read for `run`, kept, and the wait before the next; nil to stop.
    private func poll(_ run: Int) async -> TimeInterval? {
        let read = await client.presentation(session: session, ifNoneMatch: etag)
        // Cancelled on its way, the app gone behind, or a newer run under way: nothing is said of
        // a read it stopped.
        if Task.isCancelled || run != runs { return nil }
        var next = LessonState(presentation: state.presentation)
        var wait = Self.interval
        switch (read.result, read.answer) {
        case (.status(304), _): break
        case (.status(200..<300), var body?):
            // A read the server made before an answer landed lacks it: the later answer is kept.
            let fresh = body.question
            if let shown = next.presentation?.question, shown.id == fresh?.id {
                body.question?.answer = later(shown.answer, fresh?.answer)
            }
            (next.presentation, etag) = (body, read.etag)
        case (.status(429), _):
            next.problem = .rateLimited
            let asked = read.retryAfter.map { TimeInterval($0) } ?? Self.longestWait
            wait = min(max(asked, Self.interval), Self.longestWait)
        case (.status(let status), _):
            next.problem = .refused(status: status, reason: read.error?.error.reason)
        case (.networkError, _):
            next.problem = .unreachable(read.noAnswer ?? .unreachable)
        }
        let over = next.presentation?.running == false
        // Over is over: a read failing after it never says Bali can't be reached, and no deck
        // outlives it.
        if over { (next.problem, decks) = (nil, [:]) }
        state = next
        return over ? nil : wait
    }

    /// Sends the student's pick for `question` in one request, never through the outbox, so no
    /// answer ever waits there ahead of an Emergency Unlock (decisions 1, 5), under an id minted
    /// after the answer held and after the last minted here (decision 4), and keeps the answer the
    /// server says it holds.
    public func answer(question: String, option: Int) async -> AnswerResult {
        let shown = state.presentation?.question
        let held = [
            shown?.id == question ? shown?.answer?.eventId : nil,
            minted?.question == question ? minted?.eventId : nil,
        ].compactMap { $0 }.max()
        let eventId = EventID.mint(at: now(), after: held)
        minted = (question, eventId)
        let sent = await client.answer(
            question: question, AnswerRequest(eventId: eventId, option: option))
        switch (sent.result, sent.answer, sent.error?.error.reason) {
        case (.networkError, _, _): return .unreachable(sent.noAnswer ?? .unreachable)
        case (.status(200..<300), let answered?, _):
            if let shown = state.presentation?.question, shown.id == question {
                state.presentation?.question?.answer = later(shown.answer, answered.answer)
            }
            return .answered(answered.answer)
        case (_, _, .questionClosed?): return .questionClosed
        case (_, _, .invalidOption?): return .invalidOption
        case (_, _, .eventIdConflict?): return .eventIdConflict
        case (_, _, .accountDeleted?): return .accountDeleted
        case (.status(let status), _, let reason): return .refused(status: status, reason: reason)
        }
    }

    /// The deck `slide` names, its bytes checked against the slide's SHA-256 before anything can
    /// render them (decisions 6, 8): kept from this session's fetch, else fetched through
    /// `GET /v1/decks/{id}/download`'s presigned GET. Its owner asks once per deck, not per page:
    /// a second ask while one is out fetches the deck again.
    public func deck(for slide: Slide) async -> DeckResult {
        if let bytes = decks[slide.sha256] { return .ready(bytes) }
        let fetched = await fetch(slide)
        // One that ends after a read said the session is over is kept nowhere (decision 8).
        if case .ready(let bytes) = fetched, state.presentation?.running != false {
            decks[slide.sha256] = bytes
        }
        return fetched
    }

    /// A fresh URL for the deck, then its bytes, sent with no token: the URL is its own credential,
    /// and the client's transport follows no redirect. A bucket refusing the URL, as it refuses one
    /// expired, is asked for a fresh one once.
    private func fetch(_ slide: Slide, again: Bool = true) async -> DeckResult {
        let download = await client.download(deck: slide.deckId)
        switch (download.result, download.answer.flatMap { URL(string: $0.url) }) {
        case (.networkError, _): return .unreachable(download.noAnswer ?? .unreachable)
        case (.status(200..<300), let url?):
            var request = URLRequest(url: url)
            request.timeoutInterval = client.timeout
            // ponytail: a deck rides the client's transport, its whole exchange bounded at 30 s
            // (`URLSessionTransport.exchangeTimeout`), so 25 MB needs about 7 Mbit/s; give decks a
            // session of their own if M8's device check finds a classroom's Wi-Fi slower.
            guard case let (bytes, answer)? = try? await client.transport.send(request) else {
                return .unreachable(.unreachable)
            }
            switch answer.statusCode {
            case 200:
                let sha256 = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
                return sha256 == slide.sha256 ? .ready(bytes) : .mismatch
            case 403 where again: return await fetch(slide, again: false)
            case let status: return .refused(status: status, reason: nil)
            }
        case (.status(let status), _):
            return .refused(status: status, reason: download.error?.error.reason)
        }
    }
}

/// Of two answers to one question, the one the server took last: it replaces an answer only with
/// one whose id sorts after (decision 4), so the id that sorts last is the answer now.
private func later(_ held: StudentAnswer?, _ other: StudentAnswer?) -> StudentAnswer? {
    guard let held, let other else { return held ?? other }
    return other.eventId > held.eventId ? other : held
}
