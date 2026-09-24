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

/// What the engine knows, for the screens (C1–C6): `SyncEngine.updates()`.
public struct SyncState: Sendable, Hashable {
    /// Every record queued, in the order the phone acted: a stuck one is shown with its last
    /// answer (rule 5).
    public var queued: [OutboxRecord] = []
    /// How the last exchange went — nil before the first — and when the server last answered, so
    /// a screen says how old its truth is instead of pretending.
    public var link: Link?
    public var heardAt: Date?
    /// When the outbox sends next; nil when nothing is queued or it waits on a ring.
    public var retryAt: Date?
    /// The last state change the server refused, dropped and never sent again: shown (rule 5).
    public var refused: Refusal?
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
/// server communication. It drains the outbox through the app's one `APIClient` and publishes how
/// that goes as `state` (the check-in and the reconcile are B3b-2's). The app records what the
/// phone did through `record`, never the outbox itself.
public actor SyncEngine {
    /// The app's one client, and its one URLSession: the screens' own calls go through it too.
    public nonisolated let client: APIClient
    let outbox: Outbox
    let clock: any SyncClock
    let refresh: @Sendable () async -> Bool

    public private(set) var state = SyncState() { didSet { if state != oldValue { publish() } } }
    private var watchers: [UUID: AsyncStream<SyncState>.Continuation] = [:]
    /// Whether a fresh token was already tried since the last answer that was not a 401.
    private var refreshed = false
    private var reauth: Task<Bool, Never>?
    private var running = false
    private var waiter: CheckedContinuation<Void, Never>?
    private var rung = false

    /// `refresh` is B4's: refresh the token the API rejected, true once a fresh one is ready.
    public init(
        outbox: Outbox, client: APIClient, clock: any SyncClock = SystemClock(),
        refresh: @escaping @Sendable () async -> Bool = { false }
    ) {
        (self.outbox, self.client, self.clock, self.refresh) = (outbox, client, clock, refresh)
    }

    /// Drains the outbox until cancelled. Once, for the app's life.
    public func run() async {
        guard !running else { return }
        running = true
        refreshQueue()
        await drain()
    }

    /// Queues what the phone just did — acted on at once — and sends it; nil when there is nothing
    /// to send (protection off already reported). Throws when it could not be written: the caller
    /// shows it (rule 5). An unlock names its session; one made while the phone's own tap is
    /// unanswered has none yet — open decision 11, settled before B6 and C5 make one.
    @discardableResult
    public func record(_ change: Change) throws -> OutboxRecord? {
        guard let record = try outbox.record(change, now: clock.now()) else { return nil }
        refreshQueue()
        ring()
        return record
    }

    /// Everything queued goes now: the student's "retry" (rule 5), and B4's once a sign-in gives it
    /// a token.
    public func retryNow() {
        refreshed = false
        sendNow()
    }

    /// The state now, then at each change — the newest only, for each screen.
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

    /// Changes the state in one step: no screen ever sees half of one.
    private func update(_ change: (inout SyncState) -> Void) {
        var next = state
        change(&next)
        state = next
    }

    /// The outbox, in order: the record due, sent and settled; then the next, or a wait for one.
    private func drain() async {
        while !Task.isCancelled {
            rung = false  // what this pass does answers every ring made before it
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
            await pause(until: wake)
        }
    }

    /// A change's answer, settled: a state change the server refused is dropped for good, so it is
    /// kept here to show (rule 5).
    private func answered(_ record: OutboxRecord, _ sent: Sent, _ disposition: Disposition?) async
    {
        await heard(sent.result, sent.noAnswer)
        let queued = try? outbox.records()
        update {
            $0.queued = queued ?? $0.queued
            if disposition == .stateChange(.drop) {
                $0.refused = Refusal(
                    change: record.change, status: sent.status,
                    reason: sent.error?.error.reason, message: sent.error?.error.message)
            }
        }
    }

    /// Any answer, or none, for `link`. A 401 is sign-in's: once per rejection, B4's `refresh`
    /// giving a fresh token sends everything again at once; a fresh token rejected too waits out
    /// the backoff, or for B4's `retryNow`.
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
            sendNow()
        }
    }

    private func sendNow() {
        do { try outbox.retryNow(now: clock.now()) } catch { _ = failed(error) }
        refreshQueue()
        ring()
    }

    private func refreshQueue() {
        if let queued = try? outbox.records() { state.queued = queued }
    }

    /// A storage failure: shown (rule 5), and tried again within a minute.
    private func failed(_ error: any Error) -> Date? {
        state.link = .storageFailed
        return clock.now() + Outbox.backoffCap
    }

    private func ring() {
        if let waiter {
            self.waiter = nil
            waiter.resume()
        } else {
            rung = true
        }
    }

    /// Waits for `deadline` (nil: none) or a ring, whichever comes first — a ring made while the
    /// drain was busy ends the wait at once.
    private func pause(until deadline: Date?) async {
        guard !rung else {
            rung = false
            return
        }
        let alarm = deadline.map { deadline in
            Task { [clock] in
                try await clock.sleep(until: deadline)
                ring()
            }
        }
        await withTaskCancellationHandler {
            await withCheckedContinuation { waiter = $0 }
        } onCancel: {
            Task { await self.ring() }
        }
        alarm?.cancel()
    }
}
