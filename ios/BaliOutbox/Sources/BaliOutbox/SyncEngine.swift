import BaliCore
import Foundation

/// The engine's clock: the time records are stamped with, and waiting on it — a test's own there.
public protocol SyncClock: Sendable {
    func now() -> Date
    /// How long the phone has run, by a clock no setting of the time moves: for a span that a clock
    /// set forward or back must neither shrink nor stretch.
    func uptime() -> TimeInterval
    /// Returns at `deadline`, or throws once the task is cancelled.
    func sleep(until deadline: Date) async throws
}

/// The phone's clock.
public struct SystemClock: SyncClock {
    public init() {}
    public func now() -> Date { Date() }
    public func uptime() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
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
    /// Not known: the outbox file would not give back where the phone stood at launch — a storage
    /// failure, shown. Enforcement never begins from nothing: the shields are left as they are,
    /// and nothing is kept over the file's standing, until it is read again or the server's truth
    /// says where the phone stands.
    case unread

    /// The phone's own change, at once: a state change of the session it is in. A tap changes
    /// nothing here — it is `SyncState.pendingTap` until answered; an unlock under it, any session.
    func acting(_ change: Change) -> Standing {
        guard case .inSession(let session, _) = self else { return self }
        switch change {
        case .unlock(session.id, _), .unlockUnderTap: return .inSession(session, .unlocked)
        case .refocus(session.id): return .inSession(session, .focused)
        case .protectionOff(session.id): return .inSession(session, .protectionOff)
        default: return self
        }
    }

    func isFocused(in session: String) -> Bool {
        if case .inSession(let view, .focused?) = self { view.id == session } else { false }
    }

    /// The session it is in; nil: none.
    var sessionId: String? { if case .inSession(let view, _) = self { view.id } else { nil } }
}

/// As the outbox file keeps it (`Outbox.standing()`), for a relaunch and the extensions (B5): a
/// form of its own, each key and value spelled out, so no change to the enum can leave a kept
/// standing unreadable to the next build. Additive only, as `/v1` is: a later build may add a key,
/// never rename or drop one. `.unread` is never kept: it would write over the file's truth from
/// nothing.
extension Standing: Codable {
    private enum Key: String, CodingKey { case standing, sessionId, classId, endsAt, state }

    public init(from decoder: any Decoder) throws {
        let kept = try decoder.container(keyedBy: Key.self)
        switch try kept.decode(String.self, forKey: .standing) {
        case "out": self = .out
        case "waiting": self = .waiting
        case "in_session":
            let session = SessionView(
                id: try kept.decode(String.self, forKey: .sessionId),
                classId: try kept.decode(String.self, forKey: .classId),
                endsAt: try kept.decode(Date.self, forKey: .endsAt))
            // A state this build does not know is none, never focus.
            let state = try kept.decodeIfPresent(String.self, forKey: .state)
            self = .inSession(session, state.flatMap(ParticipationState.init(rawValue:)))
        case let standing:
            throw DecodingError.dataCorruptedError(
                forKey: .standing, in: kept, debugDescription: "No standing \(standing)")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var kept = encoder.container(keyedBy: Key.self)
        switch self {
        case .out: try kept.encode("out", forKey: .standing)
        case .waiting: try kept.encode("waiting", forKey: .standing)
        case .inSession(let session, let state):
            try kept.encode("in_session", forKey: .standing)
            try kept.encode(session.id, forKey: .sessionId)
            try kept.encode(session.classId, forKey: .classId)
            try kept.encode(session.endsAt, forKey: .endsAt)
            try kept.encodeIfPresent(state?.rawValue, forKey: .state)
        case .unread:
            throw EncodingError.invalidValue(
                self, .init(codingPath: encoder.codingPath, debugDescription: "Never kept"))
        }
    }
}

/// What the engine knows, for the screens (C1–C6) and enforcement (B5): `SyncEngine.updates()`.
public struct SyncState: Sendable, Hashable {
    /// The server's truth as last reconciled, with the phone's own changes over it; `.unread` while
    /// the file has not given back where the phone stood.
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
    /// How long a tap not yet answered is shielded for: decision 7's `tapCap`, or the shorter one a
    /// Debug build sets for B5b's device check (`SyncEngine.setTapCap`).
    public var cap = SyncState.tapCap

    /// A tap the server has not answered yet: shielded for at once, to decision 7's cap (B5).
    public var pendingTap: OutboxRecord? {
        queued.last { if case .tap = $0.change { !$0.stuck } else { false } }
    }

    /// The Emergency Unlock to record now (decision 11): under a tap not yet answered — filed where
    /// that tap lands — else of the session the phone is in; nil: nothing the phone knows shields.
    public func emergencyUnlock(reason: UnlockReason?) -> Change? {
        if let tap = pendingTap { return .unlockUnderTap(tap: tap.eventId, reason: reason) }
        guard case .inSession(let session, _) = standing else { return nil }
        return .unlock(session: session.id, reason: reason)
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

    /// The standing is kept in the outbox file as it changes, so a relaunch starts where the phone
    /// stood — shielded still, offline too — and the extensions can read it (B5); never while it is
    /// `.unread`, which would write over the file's truth from nothing.
    public private(set) var state = SyncState() {
        didSet {
            if state.standing != .unread { armed = false }
            if state.standing != kept, state.standing != .unread { keepStanding() }
            if state != oldValue { publish() }
        }
    }
    /// The standing the file holds; nil when not known, so a write that failed — refused while the
    /// app was suspended, say — is made again at the next change of state.
    private var kept: Standing?
    /// A tap answered armed while where the phone stood was unread, which cannot show it: carried
    /// until the standing is known — onto an out the file gives back, or a read of the truth that
    /// names no session — since no read shows an armed tap.
    private var armed = false
    private var watchers: [UUID: AsyncStream<SyncState>.Continuation] = [:]
    /// Rule 3's check of the shields, run before each check-in: the enforcer's (B5).
    private var check: (@Sendable () async -> Void)?
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
    private var waiters: [Loop: (pause: Int, wake: CheckedContinuation<Void, Never>)] = [:]
    private var rung: Set<Loop> = []
    private var pauses = 0

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
        // Where the phone stood, and what it queued, each read on its own: enforcement follows
        // this state from the start, so it must never begin from nothing.
        do { state.queued = try outbox.records() } catch { state.link = .storageFailed }
        do {
            state.standing = try outbox.standing()
            kept = state.standing
        } catch {
            state.standing = .unread
            state.link = .storageFailed
        }
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
    /// shows it (rule 5). The student acting again ends a refusal's showing. An Emergency Unlock
    /// goes through `emergencyUnlock`, which files it where decision 11 says.
    @discardableResult
    public func record(_ change: Change) throws -> OutboxRecord? {
        // Standing focused there, the phone's row is focused again — a re-tap older than its last
        // report can put it back (A13) — so protection off found now is reported again.
        if case .protectionOff(let session) = change, state.standing.isFocused(in: session) {
            try outbox.protectionRestored()
        }
        // Where it leaves the phone is kept in the change's own write: killed between two, a
        // relaunch would stand where the phone stood before — shielded over an Emergency Unlock.
        let standing = state.standing.acting(change)
        let keeping = standing == .unread ? nil : standing
        guard let record = try outbox.record(change, now: clock.now(), standing: keeping) else {
            return nil
        }
        if let keeping { kept = keeping }
        changes += 1
        let queued = queue()
        update {
            $0.standing = standing
            $0.queued = queued
            $0.refused = nil
        }
        ring(.drain)
        return record
    }

    /// A scan of the block (B6): a Bali block's code becomes the tap, recorded and sent; anything
    /// else — another tag, a scan cancelled, a phone that cannot read NFC — records nothing.
    @discardableResult
    public func tap(_ read: BlockRead) throws -> OutboxRecord? {
        guard case .block(let code) = read else { return nil }
        return try record(.tap(tagId: code))
    }

    /// The student's Emergency Unlock, recorded where `SyncState.emergencyUnlock` files it; nil
    /// when nothing the phone knows holds its shields.
    @discardableResult
    public func emergencyUnlock(reason: UnlockReason? = nil) throws -> OutboxRecord? {
        guard let unlock = state.emergencyUnlock(reason: reason) else { return nil }
        return try record(unlock)
    }

    /// Everything queued goes now, and the truth is read again: the student's "retry" (rule 5), and
    /// B4's once a sign-in gives it a token.
    public func retryNow() {
        refreshed = false
        sendAndReadNow()
    }

    /// Runs `check` before each check-in: rule 3's check of the shields, the enforcer's (B5).
    public func beforeEachCheckIn(_ check: @escaping @Sendable () async -> Void) {
        self.check = check
    }

    /// A shorter cap than decision 7's on a tap not yet answered — nil: decision 7's — for B5b's
    /// device check, which a Debug build runs at the floor, 15 minutes, rather than wait out 50.
    public func setTapCap(_ cap: TimeInterval?) { state.cap = cap ?? SyncState.tapCap }

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
            guard let session = sent.session, var participation = sent.state else {
                reread()
                break
            }
            // An unlock made after this tap, stuck and unrecorded, keeps its session's shields off.
            let after = record.order?.seq ?? 0
            if case .tap = record.change, participation == .focused,
                stored({ try outbox.holdsUnlock(session: session.id, after: after) }) ?? true
            {
                participation = .unlocked
            }
            if applies { next.standing = .inSession(session, participation) }
        case .tap(.waitForStart)?:
            switch next.standing {
            // Arming ends nothing: a session the phone is in stays (decision 4) — and one it may
            // be in, where it stood unread, is asked of the server, the arming carried meanwhile.
            case .inSession: break
            case .unread:
                if applies { armed = true }
                reread()
            case .out, .waiting: if applies { next.standing = .waiting }
            }
        case .tap(.reread)?, .tap(.retryAndSurface)?, .stateChange(.reread)?: reread()
        case .stateChange(.drop)?:
            next.refused = Refusal(
                change: record.change, status: sent.status, reason: sent.error?.error.reason,
                message: sent.error?.error.message)
            reread()
        }
        changes += 1
    }

    /// Reads the truth: where the phone stood, from the file, while that is unread; then a re-read
    /// (`GET /v1/me`) when one was asked for — tried again at the next wake until it is answered —
    /// or, in the foreground, the check-in of the session the phone is in; then waits for the next.
    private func read() async {
        while !Task.isCancelled {
            rung.remove(.read)
            readStanding()
            // Rule 3, at each wake in the foreground: before the check-in, or the read of the truth
            // in its place — offline, one that never completes. A protection off it reports is a
            // change, which the read's stamp then counts.
            if foreground, case .inSession = state.standing { await check?() }
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
            await pause(.read, until: nextRead)
        }
    }

    /// When the read loop wakes on its own: for the check-in, in the foreground — and while where
    /// the phone stood is unread, within a minute, to read the file again.
    private var nextRead: Date? {
        if foreground { return clock.now() + Self.checkInInterval }
        return state.standing == .unread ? clock.now() + Outbox.backoffCap : nil
    }

    /// Where the phone stood, read again while the file would not give it back: followed, and kept
    /// as it changes, from then on. The server's truth settles it too — a read, or a change's
    /// answer naming the session — so a file that never reads never strands the phone.
    private func readStanding() {
        guard state.standing == .unread, let standing = stored(outbox.standing) else { return }
        kept = standing
        state.standing = armed && standing == .out ? .waiting : standing
    }

    /// `GET /v1/me`'s answer, as a standing: its live session, or none — waiting, while armed.
    private func standing(_ me: MeResponse) -> Standing {
        guard let session = me.session else {
            return state.standing == .waiting || armed ? .waiting : .out
        }
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

    /// Writes the standing to the file. `kept` is set first, so the change of state a failure makes
    /// (`failed`) writes nothing again at once; the next change does.
    private func keepStanding() {
        let standing = state.standing
        kept = standing
        if stored({ try outbox.keep(standing) }) == nil { kept = nil }
    }

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
            waiter.wake.resume()
        } else {
            rung.insert(loop)
        }
    }

    /// Waits for `deadline` (nil: none) or a ring, whichever comes first — a ring made while the
    /// loop was busy ends the wait at once. The deadline's alarm rings only this pause: one that
    /// goes off as another ring ends it, its own ring run late, neither wakes the next pause nor
    /// leaves a ring for it — an early check-in.
    private func pause(_ loop: Loop, until deadline: Date?) async {
        guard rung.remove(loop) == nil else { return }
        pauses += 1
        let pause = pauses
        let alarm = deadline.map { deadline in
            Task { [clock] in
                try await clock.sleep(until: deadline)
                if waiters[loop]?.pause == pause { ring(loop) }
            }
        }
        await withTaskCancellationHandler {
            await withCheckedContinuation { waiters[loop] = (pause, $0) }
        } onCancel: {
            Task { await self.ring(loop) }
        }
        alarm?.cancel()
    }
}
