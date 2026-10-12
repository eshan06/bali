import Foundation

// A live lesson as the student's phone follows it (Phase 7, L5; ARCHITECTURE, "Live lesson",
// decisions 1, 2, 4–6; "iOS app structure", decision 6): the poll of what a running session shows,
// and the student's answer. No screen here: the app's (L8) shows `state`, sends a tap through
// `answer`, and runs the poll only while the app is in front.

/// What the phone knows of a live lesson.
public struct LessonState: Sendable, Hashable {
    /// What the last read said — kept through each `304` and each failed poll, the student's own
    /// answer with it, and given each answer the server takes since — nil until the first read.
    /// `running` false: the session is over, and the poll has stopped.
    public internal(set) var presentation: Presentation?
    /// Why the last poll brought nothing, said beside what is kept (rule 5) while the poll tries
    /// again by itself; nil once one is answered.
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

/// One running session's live lesson, as the student's phone follows it: the poll keeps `state`,
/// and `answer` sends the student's pick.
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
    /// behind the app — one run at a time: two would poll twice as often.
    public func run() async {
        while let wait = await poll() {
            do { try await sleep(wait) } catch { return }
        }
    }

    /// One read, kept, and the wait before the next; nil to stop.
    private func poll() async -> TimeInterval? {
        let read = await client.presentation(session: session, ifNoneMatch: etag)
        // Cancelled on its way, the app gone behind: nothing is said of a read it stopped.
        if Task.isCancelled { return nil }
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
        state = next
        return next.presentation?.running == false ? nil : wait
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
}

/// Of two answers to one question, the one the server took last: it replaces an answer only with
/// one whose id sorts after (decision 4), so the id that sorts last is the answer now.
private func later(_ held: StudentAnswer?, _ other: StudentAnswer?) -> StudentAnswer? {
    guard let held, let other else { return held ?? other }
    return other.eventId > held.eventId ? other : held
}
