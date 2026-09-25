import BaliCore
import Foundation

/// The engine's clock: the time records are stamped with, and waiting on it — a test's own there.
public protocol SyncClock: Sendable {
    func now() -> Date
    /// Returns at `deadline`, or throws once the task is cancelled.
    func sleep(until deadline: Date) async throws
}

/// The phone's clock.
public struct SystemClock: SyncClock {
    public init() {}
    public func now() -> Date { Date() }
    public func sleep(until deadline: Date) async throws {
        try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow)))
    }
}

/// Where the phone stands: what the screens show and enforcement shields to.
public enum Standing: Sendable, Hashable {
    /// In no session: nothing to shield.
    case out
    /// Armed, waiting for the teacher's Start (decision 5): nothing to shield yet. No read shows an
    /// armed tap, so one naming no session leaves the phone waiting (open decision 6 is how it
    /// learns of the Start).
    case waiting
    /// In `session`: shielded only while `focused` (nil is a state this build does not know), and
    /// only until its `endsAt`, which the phone's own clock keeps (data model, decision 6).
    case inSession(SessionView, ParticipationState?)

    /// The phone's own change, at once: a state change of the session it is in. A tap changes
    /// nothing here — it is `SyncState.pendingTap` until answered.
    func acting(_ change: Change) -> Standing {
        guard case .inSession(let session, _) = self else { return self }
        switch change {
        case .unlock(session.id, _): return .inSession(session, .unlocked)
        case .refocus(session.id): return .inSession(session, .focused)
        case .protectionOff(session.id): return .inSession(session, .protectionOff)
        default: return self
        }
    }

    func isFocused(in session: String) -> Bool {
        if case .inSession(let view, .focused?) = self { view.id == session } else { false }
    }
}

/// What the engine knows, for the screens (C1–C6) and enforcement (B5): `SyncEngine.updates()`.
public struct SyncState: Sendable, Hashable {
    /// The server's truth as last reconciled, with the phone's own changes over it.
    public var standing = Standing.out
    /// Every record queued, in the order the phone acted: a stuck one is shown with its last
    /// answer (rule 5).
    public var queued: [OutboxRecord] = []
    /// How the last exchange went — nil before the first — and when the server last answered, so
    /// a screen says how old its truth is instead of pretending.
    public var link: Link?
    public var heardAt: Date?
    /// When the outbox sends next; nil when nothing is queued or it waits on a ring.
    public var retryAt: Date?
    /// The last state change the server refused, dropped and never sent again: shown (rule 5)
    /// until the phone's next change.
    public var refused: Refusal?

    /// A tap the server has not answered yet: shielded for at once, to decision 7's cap (B5).
    public var pendingTap: OutboxRecord? {
        queued.last { if case .tap = $0.change { !$0.stuck } else { false } }
    }
}

public enum Link: Sendable, Hashable {
    /// The server answered.
    case reached
    /// No answer came: "can't reach the server — retry".
    case unreachable
    /// No token to send, or the server rejected the one sent: waiting on sign-in (B4). Never a
    /// sign-out, and nothing is dropped for it.
    case signIn
    /// The outbox could not be read or written; tried again within a minute.
    case storageFailed
}

public struct Refusal: Sendable, Hashable {
    public let change: Change
    public let status: Int?
    public let reason: ApiErrorReason?
    public let message: String?
}

/// The sync engine (ARCHITECTURE, "iOS app structure", decision 4): the one owner of the phone's
/// server communication. It drains the outbox through the app's one `APIClient`, checks in every
/// 30 seconds while the app is in the foreground, and applies the server's answers — the
/// reconcile — to `state`. The app records what the phone did through `record`, never the outbox
/// itself: the reconcile counts every change.
public actor SyncEngine {
    /// The every-30-seconds "still here" (data model, decision 7).
    public static let checkInInterval: TimeInterval = 30

    /// The app's one client, and its one URLSession: the screens' own calls go through it too.
    public nonisolated let client: APIClient
    let outbox: Outbox
    let clock: any SyncClock
    let refresh: @Sendable () async -> Bool

    public private(set) var state = SyncState() { didSet { if state != oldValue { publish() } } }
    private var watchers: [UUID: AsyncStream<SyncState>.Continuation] = [:]
    /// `ReconcileStamp.changes`: each change the phone makes, and each answer to one.
    private var changes = 0
    private var foreground = false
    private var rereading = false
    /// Whether a fresh token was already tried since the last answer that was not a 401.
    private var refreshed = false
    /// The refresh under way, which every 401 heard while it runs shares: the drain's, a read's.
    private var reauth: Task<Bool, Never>?
    private var running = false
    private enum Loop { case drain, read }
    private var waiters: [Loop: CheckedContinuation<Void, Never>] = [:]
    private var rung: Set<Loop> = []

    /// `refresh` is B4's: refresh the token the API rejected, true once a fresh one is ready. It
    /// must return at once — false when only the student can give a token, whose sign-in then calls
    /// `retryNow` — because the drain waits on it: nothing is sent until it returns. It is asked
    /// once per rejection: a fresh token rejected too is not refreshed again until an answer that
    /// is not a 401, or `retryNow()`. From there recovery is B4's, by contract: `accessToken()`
    /// never gives a token it knows has expired, and every token B4 gets but through `refresh` —
    /// a sign-in, a refresh of its own — is followed by `retryNow()`.
    public init(
        outbox: Outbox, client: APIClient, clock: any SyncClock = SystemClock(),
        refresh: @escaping @Sendable () async -> Bool = { false }
    ) {
        (self.outbox, self.client, self.clock, self.refresh) = (outbox, client, clock, refresh)
    }

    /// The app's one engine, over the student's sign-in (B4): the API client's tokens are the
    /// sign-in's, and so is a 401's `refresh`; every token it gets otherwise — a sign-in, a renewal
    /// of its own — sends everything again at once.
    public static func make(
        outbox: Outbox, api: URL, signIn: SignIn,
        transport: any HTTPTransport = URLSessionTransport(), clock: any SyncClock = SystemClock()
    ) async -> SyncEngine {
        let client = APIClient(baseURL: api, tokens: signIn, transport: transport)
        let engine = SyncEngine(
            outbox: outbox, client: client, clock: clock, refresh: { await signIn.refresh() })
        await signIn.whenTokenArrives { [weak engine] in await engine?.retryNow() }
        return engine
    }

    /// Drains the outbox and reads the truth, until cancelled: one run at a time, and a run
    /// cancelled can run again.
    public func run() async {
        guard !running else { return }
        running = true
        defer { running = false }
        refreshQueue()
        await withDiscardingTaskGroup { group in
            group.addTask { await self.drain() }
            group.addTask { await self.read() }
        }
    }

    /// Queues what the phone just did — acted on at once — and sends it; nil when there is nothing
    /// to send (protection off already reported). Throws when it could not be written: the caller
    /// shows it (rule 5). The student acting again ends a refusal's showing. An unlock names its
    /// session; one made while the phone's own tap is unanswered is filed under that tap (decision
    /// 11) — A11's endpoint, which B6 and C5 use; until then there is none to send it to.
    @discardableResult
    public func record(_ change: Change) throws -> OutboxRecord? {
        guard let record = try outbox.record(change, now: clock.now()) else { return nil }
        changes += 1
        let queued = queue()
        update {
            $0.standing = $0.standing.acting(change)
            $0.queued = queued
            $0.refused = nil
        }
        ring(.drain)
        return record
    }

    /// Everything queued goes now, and the truth is read again: the student's "retry" (rule 5), and
    /// B4's once a sign-in gives it a token.
    public func retryNow() {
        refreshed = false
        sendAndReadNow()
    }

    /// The app entered the foreground, or left it. The check-in runs only in the foreground — iOS
    /// won't run a timer forever behind it — and coming back reads the truth at once.
    public func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        guard foreground else { return }
        reread()
        ring(.drain)
    }

    /// The state now, then at each change — the newest only, for each screen and for enforcement.
    public func updates() -> AsyncStream<SyncState> {
        let (stream, watcher) = AsyncStream.makeStream(
            of: SyncState.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        watchers[id] = watcher
        watcher.onTermination = { _ in Task { await self.forget(id) } }
        watcher.yield(state)
        return stream
    }

    private func forget(_ id: UUID) { watchers[id] = nil }
    private func publish() { for watcher in watchers.values { watcher.yield(state) } }

    /// Changes the state in one step: no screen, and no shield, ever sees half of one.
    private func update(_ change: (inout SyncState) -> Void) {
        var next = state
        change(&next)
        state = next
    }

    /// The outbox, in order: the record due, sent and settled; then the next, or a wait for one.
    private func drain() async {
        while !Task.isCancelled {
            rung.remove(.drain)  // what this pass does answers every ring made before it
            var wake: Date?
            do {
                switch try outbox.nextDue(now: clock.now()) {
                case .send(let record):
                    let sent = await record.send(through: client)
                    // No token: nothing went, so nothing is settled — the record waits on sign-in
                    // (a ring), or a minute. Never a sign-out, never a dropped record.
                    guard sent.noAnswer != .noToken else {
                        state.link = .signIn
                        wake = clock.now() + Outbox.backoffCap
                        break
                    }
                    let disposition = try outbox.settle(sent, now: clock.now())
                    await answered(record, sent, disposition)
                    continue
                case .wait(let until): wake = until
                case .idle: wake = nil
                }
            } catch {
                wake = failed(error)
            }
            state.retryAt = wake
            await pause(.drain, until: wake)
        }
    }

    /// A change's answer, settled. A change's own answer is the truth as of that change — but a
    /// later change of the phone's, still waiting for its own answer, stands over it until then.
    /// Every case by name: one BaliCore adds must be placed here.
    private func answered(_ record: OutboxRecord, _ sent: Sent, _ disposition: Disposition?) async
    {
        await heard(sent.result, sent.noAnswer)
        let queued = queue()
        let applies = stored(outbox.awaiting) == 0
        var next = state
        next.queued = queued
        defer { state = next }
        switch disposition {
        case .tap(.retry)?, .unlock(.retry)?, .stateChange(.retry)?, .tap(.reauth)?,
            .unlock(.reauth)?, .stateChange(.reauth)?:
            return
        // nil: superseded in flight, its answer older than the phone's truth. A refused unlock is
        // kept and shown, and still stands on the phone (`holdsUnlock`).
        case nil, .unlock(.retryAndSurface)?: break
        case .tap(.applySession)?, .unlock(.recorded)?, .stateChange(.applySession)?:
            // A live participation names its session and its state; a note (an unlock after the
            // end names the session it ended) names no window to be in.
            guard let session = sent.session, let participation = sent.state else {
                reread()
                break
            }
            if applies { next.standing = .inSession(session, participation) }
        case .tap(.waitForStart)?:
            // Arming ends nothing: a session the phone is in stays (decision 4).
            if case .inSession = next.standing {} else if applies { next.standing = .waiting }
        case .tap(.reread)?, .tap(.retryAndSurface)?, .stateChange(.reread)?: reread()
        case .stateChange(.drop)?:
            next.refused = Refusal(
                change: record.change, status: sent.status, reason: sent.error?.error.reason,
                message: sent.error?.error.message)
            reread()
        }
        changes += 1
    }

    /// Reads the truth: a re-read (`GET /v1/me`) when one was asked for — tried again at the next
    /// wake until it is answered — or, in the foreground, the check-in of the session the phone is
    /// in; then waits for the next.
    private func read() async {
        while !Task.isCancelled {
            rung.remove(.read)
            if let sent = stored(stamp) {
                if rereading {
                    rereading = false
                    let response = await client.me()
                    await heard(response.result, response.noAnswer)
                    if let me = response.answer {
                        reconcile(sent, standing(me))
                    } else {
                        rereading = true
                    }
                } else if foreground, case .inSession(let session, _) = state.standing {
                    let response = await client.checkIn(
                        session: session.id, CheckInRequest(deviceTime: clock.now()))
                    await heard(response.result, response.noAnswer)
                    switch response.answer?.status.known {
                    case .live?:
                        if let view = response.answer?.session {
                            reconcile(sent, .inSession(view, response.answer?.state?.known))
                        }
                    // Nothing live there any more — or no such session: where is the phone?
                    case .gone?: reread()
                    case nil: if response.result == .status(404) { reread() }
                    }
                }
            }
            await pause(.read, until: foreground ? clock.now() + Self.checkInInterval : nil)
        }
    }

    /// `GET /v1/me`'s answer, as a standing: its live session, or none.
    private func standing(_ me: MeResponse) -> Standing {
        guard let session = me.session else { return state.standing == .waiting ? .waiting : .out }
        let view = SessionView(id: session.id, classId: session.classId, endsAt: session.endsAt)
        return switch session.state.known {
        case .focused?, .silent?: .inSession(view, .focused)
        case .unlocked?: .inSession(view, .unlocked)
        case .protectionOff?: .inSession(view, .protectionOff)
        case .ended?: .out
        case nil: .inSession(view, nil)
        }
    }

    /// A read's answer — the truth as the server saw it — applied only when no change of the
    /// phone's can be newer (`readMayReconcile`). And no read turns a session's shields back on
    /// over an unrecorded emergency unlock (`holdsUnlock`): its window applies, its focus does not.
    private func reconcile(_ sent: ReconcileStamp, _ read: Standing) {
        guard let now = stored(stamp), readMayReconcile(sent: sent, now: now) else { return }
        var read = read
        if case .inSession(let session, .focused?) = read,
            !state.standing.isFocused(in: session.id),
            stored({ try outbox.holdsUnlock(session: session.id) }) ?? true
        {
            read = .inSession(session, .unlocked)
        }
        state.standing = read
    }

    private func stamp() throws -> ReconcileStamp {
        ReconcileStamp(changes: changes, awaiting: try outbox.awaiting())
    }

    /// Any answer, or none, for `link`. A 401 is sign-in's: once per rejection, B4's `refresh`
    /// giving a fresh token sends everything again at once; a fresh token rejected too waits out
    /// the backoff, or for B4's `retryNow`. A refresh that gives none is asked again at the next
    /// 401, a backoff later.
    private func heard(_ result: SendResult, _ noAnswer: NoAnswer?) async {
        guard case .status(let status) = result else {
            state.link = noAnswer == .noToken ? .signIn : .unreachable
            return
        }
        let now = clock.now()
        guard status == 401 else {
            refreshed = false
            return update { ($0.heardAt, $0.link) = (now, .reached) }
        }
        update { ($0.heardAt, $0.link) = (now, .signIn) }
        guard !refreshed else { return }
        let task = reauth ?? Task { await refresh() }
        reauth = task
        let fresh = await task.value
        reauth = nil
        if fresh, !refreshed {
            refreshed = true
            sendAndReadNow()
        }
    }

    private func reread() {
        rereading = true
        ring(.read)
    }

    private func sendAndReadNow() {
        do { try outbox.retryNow(now: clock.now()) } catch { _ = failed(error) }
        refreshQueue()
        reread()
        ring(.drain)
    }

    private func refreshQueue() { state.queued = queue() }

    /// Everything queued, for the screens; a read that fails is shown (rule 5), the last one kept.
    private func queue() -> [OutboxRecord] { stored(outbox.records) ?? state.queued }

    /// What `read` reads from the outbox; nil when it cannot be read, which is shown (rule 5).
    private func stored<T>(_ read: () throws -> T) -> T? {
        do { return try read() } catch {
            _ = failed(error)
            return nil
        }
    }

    /// A storage failure, shown (rule 5), and when to try again: within a minute — or, for a write
    /// refused while the app is suspended, once a ring says it is back.
    private func failed(_ error: any Error) -> Date? {
        if Outbox.isSuspension(error) { return nil }
        state.link = .storageFailed
        return clock.now() + Outbox.backoffCap
    }

    private func ring(_ loop: Loop) {
        if let waiter = waiters.removeValue(forKey: loop) {
            waiter.resume()
        } else {
            rung.insert(loop)
        }
    }

    /// Waits for `deadline` (nil: none) or a ring, whichever comes first — a ring made while the
    /// loop was busy ends the wait at once.
    private func pause(_ loop: Loop, until deadline: Date?) async {
        guard rung.remove(loop) == nil else { return }
        let alarm = deadline.map { deadline in
            Task { [clock] in
                try await clock.sleep(until: deadline)
                ring(loop)
            }
        }
        await withTaskCancellationHandler {
            await withCheckedContinuation { waiters[loop] = $0 }
        } onCancel: {
            Task { await self.ring(loop) }
        }
        alarm?.cancel()
    }
}
