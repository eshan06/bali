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
    /// Armed, waiting for the teacher's Start (decision 5): nothing to shield yet. In the foreground
    /// it reads the truth every 30 s for the Start (decision 6, the owner's ruling, 2026-09-29;
    /// C3a); a read naming no session leaves it waiting while it says a tap of the student's waits
    /// (`MeResponse.armed`), and ends the wait once none does — its school day over, or taken by a
    /// Start whose class is over too — as the end of that day by the phone's own clock does,
    /// offline (`SyncState.waitEnds`): never Waiting where no Start would lock the phone (#166).
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
    /// nothing here — it is `SyncState.pendingTap` until answered; an unlock under it, or one not
    /// filed yet, any session. Screen Time back on returns to `offFrom`, where the phone stood
    /// before protection off (#167) — which `SyncEngine.record` always names.
    func acting(_ change: Change, offFrom: ParticipationState? = nil) -> Standing {
        guard case .inSession(let session, _) = self else { return self }
        switch change {
        case .unlock(session.id, _), .unlockUnderTap, .unlockUnfiled:
            return .inSession(session, .unlocked)
        case .refocus(session.id): return .inSession(session, .focused)
        case .protectionOff(session.id): return .inSession(session, .protectionOff)
        case .protectionOn(session.id): return .inSession(session, offFrom ?? .focused)
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
    public init() {}

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
    /// The student's unlock the server recorded late — a return to focus went ahead of it (A10,
    /// A12) — which put the shields back with no return of this phone's since: said on Focus
    /// (C5a) until the phone's next change.
    public var superseded: Superseded?
    /// The session protection off was last reported in, since the phone's last tap or Screen Time
    /// back on (`Outbox.reportedOff`): only those leave it there (A2; #167).
    public var reportedOff: String?
    /// The phone's newest tap, as the outbox file keeps it (`Outbox.lastTap`): a refused tap is
    /// said only while it is this one (#146). Nil: the file names none.
    public var lastTap: String?
    /// This phone's latest Emergency Unlock the server has recorded in a session, and its reason
    /// on record — the answer's, then each change's (A20): the Unlocked card's check, and what a
    /// pick changes once the record has left the phone (C5c), until the student's next turn:
    /// Screen Time going off or coming back is none (#167).
    public var recordedUnlock: RecordedUnlock?
    /// The records on their way — sent and not settled, or answered in a write the file refused
    /// (the app suspended, say) — which the file still counts as never sent: a reason given now
    /// would not go with them (santa's review), so the card offers none (C5c).
    public var sending: Set<String> = []
    /// How long a tap not yet answered is shielded for: decision 7's `tapCap`, or the shorter one a
    /// Debug build sets for B5b's device check (`SyncEngine.setTapCap`).
    public var cap = SyncState.tapCap
    /// Who the student is and their classes, as `GET /v1/me` last answered — with a class the
    /// phone joined since, at once (`SyncEngine.join`) — for Home and the router (C3); nil until a
    /// read answers.
    public var me: MeResponse?
    /// Why the last read of `GET /v1/me` gave no answer — none came, or a status with no body this
    /// build reads — until one does: said where its classes would be (rule 5), never read as none.
    public var meFailed: SendResult?
    /// How many times `me` has been forgotten for another student's sign-in
    /// (`SyncEngine.forgetMe`): a state counting fewer forgets than the app asked for was sent
    /// before the last one, so its `me` is the last student's (#160's review).
    public var forgets = 0
    /// When the wait for the teacher's Start ends by the phone's own clock, offline too (#166): the
    /// end of the day its tap was last answered armed (`waitEnds(armedAt:)`), kept in the outbox
    /// file for a relaunch; nil when not known — a wait an earlier build kept, which only a read
    /// ends.
    public var waitEnds: Date?

    /// Where a wait armed at `now` ends: the midnight after it in `calendar`'s zone — the phone's,
    /// the school's in class — as the server drops an armed tap at the end of its school day, in
    /// the school's zone (decision 5; Hosting, decision 5).
    public static func waitEnds(armedAt now: Date, calendar: Calendar = .current) -> Date {
        calendar.dateInterval(of: .day, for: now)?.end ?? now.addingTimeInterval(86_400)
    }

    /// Whether the student is in any class, as `me` says: nil until a read answers (C3).
    public var hasClasses: Bool? { me.map { !$0.classes.isEmpty } }

    /// A tap the server has not answered yet: shielded for at once, to decision 7's cap (B5).
    public var pendingTap: OutboxRecord? {
        queued.last { if case .tap = $0.change { !$0.stuck } else { false } }
    }

    /// The Emergency Unlock to record now (decision 11): under a tap not yet answered — filed where
    /// that tap lands — else of the session the phone is in; where it stood unread, not filed until
    /// the phone knows where it stands (B6b); nil: out or waiting, nothing the phone knows shields.
    public func emergencyUnlock(reason: UnlockReason?) -> Change? {
        if let tap = pendingTap { return .unlockUnderTap(tap: tap.eventId, reason: reason) }
        switch standing {
        case .inSession(let session, _): return .unlock(session: session.id, reason: reason)
        case .unread: return .unlockUnfiled(reason: reason)
        case .out, .waiting: return nil
        }
    }

    /// Whether an unlock made where the phone stood unread waits to be filed (B6b).
    var holdsUnfiled: Bool { queued.contains { $0.change.isUnfiled } }
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

    public init(change: Change, status: Int?, reason: ApiErrorReason?, message: String?) {
        (self.change, self.status, self.reason, self.message) = (change, status, reason, message)
    }
}

/// An unlock the server recorded in `session`: its event id, and its reason on record.
public struct RecordedUnlock: Sendable, Hashable {
    public let session: String, unlock: String
    public var reason: UnlockReason?
    public init(session: String, unlock: String, reason: UnlockReason?) {
        (self.session, self.unlock, self.reason) = (session, unlock, reason)
    }
}

/// A late unlock's session, and whether it went with the phone's order (A12): with one, the return
/// that went ahead is one the order cannot place — another install's, or one sent with none;
/// without, the phone's clock was behind (A10).
public struct Superseded: Sendable, Hashable {
    public let session: String
    public let ordered: Bool
    public init(session: String, ordered: Bool) { (self.session, self.ordered) = (session, ordered) }
}

/// The sync engine (ARCHITECTURE, "iOS app structure", decision 4): the one owner of the phone's
/// server communication. It drains the outbox through the app's one `APIClient`, checks in every
/// 30 seconds while the app is in the foreground, and applies the server's answers — the
/// reconcile — to `state`. The app records what the phone did through `record`, never the outbox
/// itself: the reconcile counts every change.
public actor SyncEngine {
    /// The every-30-seconds "still here" (data model, decision 7).
    public static let checkInInterval: TimeInterval = 30
    /// How long an Emergency Unlock's send waits for the reason the Unlocked screen asks (C5a; A1:
    /// a reason is kept once recorded): the unlock itself never waits — the shields are off and
    /// the record queued at once — and any change of the phone's, or the app going behind, sends it
    /// sooner. The teacher sees it at most this late, online.
    public static let reasonHold: TimeInterval = 15

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
    /// names no session — unless that read says no tap of the student's waits (#166).
    private var armed = false
    private var watchers: [UUID: AsyncStream<SyncState>.Continuation] = [:]
    /// Rule 3's check of the shields, run at each wake in the foreground — before each check-in,
    /// and out of a session too (C1c): the enforcer's (B5).
    private var check: (@Sendable () async -> Void)?
    /// `ReconcileStamp.changes`: each change the phone makes, and each answer to one.
    private var changes = 0
    private var foreground = false
    private var rereading = false
    /// The changes the phone has made to `me` — a join, a rename, a sign-in forgetting the last
    /// student's: a read of `GET /v1/me` sent before one never applies its `me`, older than it.
    private var meChanges = 0
    /// Whether a fresh token was already tried since the last answer that was not a 401.
    private var refreshed = false
    /// The refresh under way, which every 401 heard while it runs shares: the drain's, a read's.
    private var reauth: Task<Bool, Never>?
    private var running = false
    /// The last change of an unlock's reason no answer came to: tried again for the same unlock and
    /// reason, it goes under the same event id (rule 4).
    private var unanswered: (unlock: String, reason: UnlockReason, eventId: String)?
    private enum Loop { case drain, read }
    private var waiters: [Loop: (pause: Int, wake: CheckedContinuation<Void, Never>)] = [:]
    private var rung: Set<Loop> = []
    private var pauses = 0
    /// An account deletion under way (C4): the loops send nothing meanwhile — a record or a read
    /// landing after the deletion would make a fresh account — and it waits out what they have on
    /// its way: `underway`, until the last lands.
    private var deleting = false
    private var underway = 0
    private var landed: [CheckedContinuation<Void, Never>] = []
    /// The last deletion sent that no answer settled: tried again under the same event id (rule 4).
    private var deletionId: String?
    /// The account deletion under way, whose answer a second press shares: never two at once, one
    /// of which would let the loops go while the other's `DELETE /v1/me` is on its way.
    private var deletion: Task<AccountDeletion, Never>?

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
        let queued = try? outbox.records()
        state.queued = queued ?? []
        if queued == nil { state.link = .storageFailed }
        state.reportedOff = try? outbox.reportedOff()
        state.lastTap = try? outbox.lastTap()
        state.waitEnds = try? outbox.waitEnds()
        do {
            state.standing = try outbox.standing()
            // An unlock not filed yet acts on it, and the first change files it (`keepStanding`) —
            // as it files whatever the file holds when its queue could not be read.
            if queued != nil, !state.holdsUnfiled { kept = state.standing }
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
    /// to send (protection off already reported, or Screen Time back on where the phone is not
    /// protection off). Throws when it could not be written: the caller
    /// shows it (rule 5). The student acting again ends a refusal's showing. An Emergency Unlock
    /// goes through `emergencyUnlock`, which files it where decision 11 says; `hold` delays the send
    /// of one waiting for its reason (C5a). Acting again ends a late unlock's showing too.
    @discardableResult
    public func record(_ change: Change, holding hold: TimeInterval = 0) throws -> OutboxRecord? {
        // Standing focused there, the phone's row is focused again — a re-tap older than its last
        // report can put it back (A13) — so protection off found now is reported again.
        if case .protectionOff(let session) = change, state.standing.isFocused(in: session) {
            try outbox.protectionRestored()
        }
        // Screen Time back on (#167) only out of protection off there: a second, from a check that
        // overlapped the first, finds the phone back where it stood and records nothing (santa's
        // round 1). It returns where the phone stood before protection off; not known, past the
        // unlock guard: an Emergency Unlock still queued there keeps it unlocked.
        var offFrom: ParticipationState?
        if case .protectionOn(let session) = change {
            guard case .inSession(let view, .protectionOff?) = state.standing, view.id == session
            else { return nil }
            offFrom =
                (stored(outbox.offFrom) ?? nil) ?? (keepsUnlocked(session) ? .unlocked : .focused)
        }
        // Where it leaves the phone is kept in the change's own write: killed between two, a
        // relaunch would stand where the phone stood before — shielded over an Emergency Unlock.
        let standing = state.standing.acting(change, offFrom: offFrom)
        let keeping = standing == .unread ? nil : standing
        guard
            let record = try outbox.record(
                change, now: clock.now(), standing: keeping, holding: hold)
        else { return nil }
        if let keeping { kept = keeping }
        changes += 1
        // A read that fails keeps the last list — with this record, which the file holds now: the
        // phone acts on what it just did (an unlock's shields off, a tap's on) whatever the read.
        let queued = stored(outbox.records) ?? state.queued + [record]
        let reportedOff = stored(outbox.reportedOff) ?? state.reportedOff
        update {
            $0.standing = standing
            ($0.queued, $0.reportedOff) = (queued, reportedOff)
            ($0.refused, $0.superseded) = (nil, nil)
            // Screen Time going off or coming back is no turn of the student's (A9): the unlock
            // recorded still stands, its reason changeable once back on (A20; santa's round 1).
            if change.isUnlock || change.isReturn { $0.recordedUnlock = nil }
            // The file's newest tap now, written with it.
            if case .tap = change { $0.lastTap = record.eventId }
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

    /// Home's Tap in (C3b): the scan `read`, as `tap` records it, and what Home says when it
    /// recorded no tap (rule 5) — the scan's words, or that it could not be saved; nil once it did.
    public func tapIn(_ read: BlockRead) -> String? {
        do {
            try tap(read)
            return read.words
        } catch {
            return BlockRead.notKept
        }
    }

    /// The student's Emergency Unlock, recorded where `SyncState.emergencyUnlock` files it; nil
    /// when nothing the phone knows holds its shields.
    @discardableResult
    public func emergencyUnlock(reason: UnlockReason? = nil) throws -> OutboxRecord? {
        guard let unlock = state.emergencyUnlock(reason: reason) else { return nil }
        return try record(unlock)
    }

    /// Emergency Unlock as the screens press it (C4): its send held `reasonHold` where the Unlocked
    /// screen then asks why — in a session (C5a), and never past its bell, so the class's grid
    /// shows it live — or why it did not go through (rule 5): nothing the phone knows holds the
    /// shields any more (#116's review), or the outbox refused it.
    public func pressUnlock() -> UnlockFailure? {
        guard let unlock = state.emergencyUnlock(reason: nil) else { return .nothing }
        var hold: TimeInterval = 0
        if case .inSession(let session, _) = state.standing {
            hold = min(Self.reasonHold, max(0, session.endsAt.timeIntervalSince(clock.now())))
        }
        do { try record(unlock, holding: hold) } catch { return .notSaved }
        return nil
    }

    /// The student's reason for their latest Emergency Unlock (C5a): sent with it, at once, while it
    /// has never been sent; once the server has recorded it, a change of it (A20, `PATCH
    /// /v1/unlocks/{eventId}`, its token renewed once on a 401) — or what the Unlocked screen says
    /// (rule 5): not saved, on its way, or why the change did not go.
    public func explain(_ reason: UnlockReason) async -> String? {
        do {
            if try outbox.explain(reason, now: clock.now(), sent: state.sending) {
                refreshQueue()
                ring(.drain)
                return nil
            }
        } catch {
            return "Bali couldn't save your reason. Try again."
        }
        guard case .inSession(let session, _) = state.standing, state.unlock(in: session.id) == nil,
            let recorded = state.recordedUnlock, recorded.session == session.id
        else { return UnlockedWords.onItsWay }
        let again = unanswered.flatMap { $0.unlock == recorded.unlock && $0.reason == reason ? $0 : nil }
        let request = UnlockReasonRequest(
            reason: reason, eventId: again?.eventId ?? EventID.mint(at: clock.now()))
        let answer = await Joining.send(renewing: refresh) {
            await client.changeReason(unlock: recorded.unlock, request)
        }
        // Unless the phone has moved on meanwhile: a change of its own clears it — and then this
        // answer leaves the next unlock's last change alone (#140, santa's round 2).
        let current = state.recordedUnlock?.unlock == recorded.unlock
        if current {
            unanswered =
                answer.result == .networkError ? (recorded.unlock, reason, request.eventId) : nil
        }
        guard let kept = answer.answer?.reason.known else { return UnlockedWords.notChanged(answer) }
        if current { state.recordedUnlock?.reason = kept }
        return nil
    }

    /// Back to focus (C5a): the refocus of the session the phone stands unlocked in — none where it
    /// stands in none, and another screen shows — or what the Unlocked screen says (rule 5).
    public func backToFocus() -> String? {
        guard case .inSession(let session, .unlocked?) = state.standing else { return nil }
        do { try record(.refocus(session: session.id)) } catch {
            return "Bali couldn't lock your apps. Try again."
        }
        return nil
    }

    /// What a join code opens (`GET /v1/join-codes/{code}`): the Join screen's own call (C2b), its
    /// token renewed once on a 401 (`Joining.send`).
    public func lookUp(_ code: String) async -> APIResponse<JoinCodePreviewResponse> {
        await Joining.send(renewing: refresh) { await client.previewJoinCode(code) }
    }

    /// A page of the student's own history (`GET /v1/me/history`), older than `before` — nil, the
    /// newest: the History screen's own call (C6a), its token renewed once on a 401.
    public func history(before: String?) async -> APIResponse<HistoryPage> {
        await Joining.send(renewing: refresh) { await client.history(before: before) }
    }

    /// Joins the class a code opens (`POST /v1/enrollments`): the Join screen's own call (C2b), its
    /// token renewed once on a 401. Once in, the class is in `me` at once where a read has answered
    /// — so the router moves on — else the read it asks for brings it, as it brings its teacher's
    /// name; a read sent before the join never takes the class away (C3; #110's review). Never
    /// into the `me` of a student who signed in since: `me` forgotten meanwhile, the class is the
    /// last student's (F11a-1).
    public func join(_ request: EnrollmentJoinRequest) async
        -> APIResponse<EnrollmentJoinResponse>
    {
        let forgets = state.forgets
        let answer = await Joining.send(renewing: refresh) { await client.join(request) }
        guard let joined = answer.answer?.class else { return answer }
        meChanges += 1
        if state.forgets == forgets, let me = state.me,
            !me.classes.contains(where: { $0.id == joined.id })
        {
            state.me = MeResponse(
                user: me.user, classes: me.classes + [joined], session: me.session)
        }
        reread()
        return answer
    }

    /// Sets the student's own name (`PATCH /v1/me`, A8): the Me screen's own call (C6b), its token
    /// renewed once on a 401. Once set — applied, or a replay's name now — it is `me`'s at once, for
    /// Home's greeting and Me's card, unless `me` changed meanwhile (another join, a sign-in
    /// forgetting it); and, as after a join, the truth is read again: a read sent before it, which
    /// never applies its `me`, would otherwise leave the classes as old as the last one (santa's
    /// round 1).
    public func rename(_ request: UpdateMeRequest) async -> APIResponse<UpdateMeResponse> {
        let changesThen = meChanges
        let answer = await Joining.send(renewing: refresh) { await client.updateMe(request) }
        guard let user = answer.answer?.user else { return answer }
        if meChanges == changesThen, let me = state.me {
            state.me = MeResponse(user: user, classes: me.classes, session: me.session)
        }
        meChanges += 1
        reread()
        return answer
    }

    /// Leaves a class (`DELETE /v1/enrollments/{id}`, A19): the Me screen's own call (C6c), its
    /// token renewed once on a 401. Out — it ended, or they were out already — the class leaves
    /// `me` at once; and with any answer the truth is read again, which a read sent before it
    /// never overrides — a refusal says why, and a class the server does not know is read away.
    /// Never from the `me` of a student who signed in since, as a join never adds to it (#164's
    /// review): `me` forgotten meanwhile, the enrollment was the last student's.
    public func leave(enrollment id: String, _ request: EndEnrollmentRequest) async
        -> APIResponse<EndEnrollmentResponse>
    {
        let forgets = state.forgets
        let answer = await Joining.send(renewing: refresh) {
            await client.leave(enrollment: id, request)
        }
        guard case .status = answer.result else { return answer }
        if answer.answer != nil, state.forgets == forgets, let me = state.me {
            state.me = MeResponse(
                user: me.user, classes: me.classes.filter { $0.enrollmentId != id },
                session: me.session)
        }
        meChanges += 1
        reread()
        return answer
    }

    /// Whether an Emergency Unlock waits unsent in the outbox file — Sign out's rule (C6b) — read
    /// from the file itself, so one a failed read left out of `state.queued` counts too (santa's
    /// round 1); nil when the file cannot be read now.
    public func unlockUnsent() -> Bool? {
        (try? outbox.records()).map { $0.contains { $0.change.isUnlock } }
    }

    /// Someone signs in where someone signed out (C6b): the last student's `me` — their name and
    /// classes, another student's on a shared phone — is forgotten, a read on its way with it, and
    /// read again; counted in `forgets`, so the app knows a state sent before it. Nothing else:
    /// where the phone stands and its queue are the phone's (B4).
    public func forgetMe() {
        meChanges += 1
        update { ($0.me, $0.meFailed, $0.forgets) = (nil, nil, $0.forgets + 1) }
        reread()
    }

    /// Me's Delete account (C4): the one call the screen makes, answered with where the deletion
    /// stands — a press while one is under way shares its answer. Each step only once the last is
    /// done:
    /// - `signIn` can delete itself — its token carries the scope Cognito's DeleteUser needs — or a
    ///   fresh sign-in comes first, before anything is sent: no one is deleted here but left in Cognito;
    /// - the loops hold, what they have on its way lands, and the outbox goes (`sendAll`), every
    ///   Emergency Unlock first: one the server has not recorded holds the deletion back;
    /// - `DELETE /v1/me` (`sendDeletion`);
    /// - deleted, the sign-in gives the API no token any more (`SignIn.accountDeleted`), what the
    ///   account still had queued is let go — never an unlock, and none is left — and the phone
    ///   stands in no session, its shields off, with no Emergency Unlock recorded (the owner's ruling):
    ///   one sent now would land under a fresh account;
    /// - Cognito's DeleteUser, which the next call tries again, alone, until it is done; done, the
    ///   sign-in is forgotten, as Sign out forgets it.
    ///
    /// What the student does while it runs, or while DeleteUser waits — a tap, Back to focus, a
    /// join, a rename — is C4b's to keep from happening: none reaches an account the server keeps,
    /// and an Emergency Unlock made under such a tap would wait for the next sign-in.
    public func deleteAccount(_ signIn: SignIn) async -> AccountDeletion {
        if let deletion { return await deletion.value }
        let task = Task { await self.delete(signIn) }
        deletion = task
        defer { deletion = nil }
        return await task.value
    }

    private func delete(_ signIn: SignIn) async -> AccountDeletion {
        if await !signIn.deletionPending() {
            guard await signIn.mayDelete() else { return .signInFirst }
            deleting = true
            defer {
                deleting = false
                ring(.drain)
                ring(.read)
            }
            while underway > 0 { await withCheckedContinuation { landed.append($0) } }
            if let held = await sendAll() { return held }
            let answer = await sendDeletion()
            switch answer.answer?.outcome.known {
            case .deleted?, .alreadyDeleted?: deletionId = nil
            case nil:
                return answer.error?.error.reason == .teacherHasClasses
                    ? .teacherHasClasses : .notDeleted(answer.result)
            }
            await signIn.accountDeleted()
        }
        // Again on a later call: the file may not have taken it, nor let go of a record since.
        _ = stored { try outbox.accountDeleted() }
        refreshQueue()
        state.standing = .out
        let failed = await signIn.deleteUser()
        // And once more as DeleteUser answers: what came meanwhile, or a write the file refused,
        // never waits for the next sign-in.
        _ = stored { try outbox.accountDeleted() }
        refreshQueue()
        return failed.map(AccountDeletion.signInNotDeleted) ?? .deleted
    }

    /// Everything queued goes now, and the truth is read again: the student's "retry" (rule 5), and
    /// B4's once a sign-in gives it a token.
    public func retryNow() {
        refreshed = false
        sendAndReadNow()
    }

    /// Runs `check` at each wake of the read loop in the foreground — before each check-in, and out
    /// of a session too (C1c; B5a's `beforeEachCheckIn`): rule 3's check of the shields, the
    /// enforcer's (B5).
    public func atEachWake(_ check: @escaping @Sendable () async -> Void) {
        self.check = check
    }

    /// A shorter cap than decision 7's on a tap not yet answered — nil: decision 7's — for B5b's
    /// device check, which a Debug build runs at the floor, 15 minutes, rather than wait out 50.
    public func setTapCap(_ cap: TimeInterval?) { state.cap = cap ?? SyncState.tapCap }

    /// The app entered the foreground, or left it. The check-in runs only in the foreground — iOS
    /// won't run a timer forever behind it — and coming back reads the truth at once. Going behind,
    /// no reason is coming: an unlock held for one goes now, before iOS suspends the app (C5a).
    public func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        if foreground {
            reread()
        } else {
            _ = stored { try outbox.release(now: clock.now()) }
        }
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
            // An account deletion sends the outbox itself (C4): nothing goes from here till it rings.
            guard !deleting else {
                await pause(.drain, until: nil)
                continue
            }
            var wake: Date?
            do {
                switch try outbox.nextDue(now: clock.now()) {
                case .send(let record):
                    // Never an unlock not filed yet (`nextDue`): it has nowhere to go.
                    state.sending.insert(record.eventId)
                    guard let sent = await counted({ await record.send(through: client) }) else {
                        state.sending.remove(record.eventId)
                        break
                    }
                    // No token: nothing went, so nothing is settled — the record waits on sign-in
                    // (a ring), or a minute. Never a sign-out, never a dropped record.
                    guard sent.noAnswer != .noToken else {
                        state.sending.remove(record.eventId)
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

    /// The outbox sent before an account deletion (C4), each record once, in the order
    /// `nextBeforeDeletion` gives — every Emergency Unlock first — each answer settled and applied as
    /// the drain's is; then what holds the deletion back, if anything: an unlock the server has not
    /// recorded, never let go; else a record no answer settled, with the last answer. A tap the
    /// server refused holds nothing back.
    private func sendAll() async -> AccountDeletion? {
        var (tried, last) = (Set<String>(), SendResult.networkError)
        do {
            while let record = try outbox.nextBeforeDeletion(tried: tried) {
                tried.insert(record.eventId)
                state.sending.insert(record.eventId)
                // No token, nothing went (the drain's rule): said as no answer, nothing settled.
                guard let sent = await record.send(through: client), sent.noAnswer != .noToken else {
                    state.sending.remove(record.eventId)
                    break
                }
                let disposition = try outbox.settle(sent, now: clock.now())
                await answered(record, sent, disposition)
                if disposition?.keeps == true { last = sent.result }
            }
            let left = try outbox.records()
            if left.contains(where: \.change.isUnlock) { return .unlockUnsent }
            return left.allSatisfy(\.refusedForGood) ? nil : .notDeleted(last)
        } catch {
            _ = failed(error)
            return .unread
        }
    }

    /// `DELETE /v1/me` (C3), its token renewed once on a 401 — and once more under a fresh event id
    /// when the server says another event holds it: a boot call racing a deletion can make the
    /// account it makes look older than the deletion, whose retry then reads as another's.
    private func sendDeletion() async -> APIResponse<DeleteMeResponse> {
        let answer = await deleteMe()
        guard answer.error?.error.reason == .eventIdConflict else { return answer }
        deletionId = nil
        return await deleteMe()
    }

    /// One `DELETE /v1/me`, under the last one's event id while no answer settled it (rule 4).
    private func deleteMe() async -> APIResponse<DeleteMeResponse> {
        let eventId = deletionId ?? EventID.mint(at: clock.now())
        deletionId = eventId
        return await Joining.send(renewing: refresh) {
            await client.deleteMe(DeleteMeRequest(eventId: eventId))
        }
    }

    /// A request of the loops', counted while it is on its way: an account deletion waits it out (C4).
    private func counted<Answer>(_ send: () async -> Answer) async -> Answer {
        underway += 1
        let answer = await send()
        underway -= 1
        if underway == 0 {
            for waiting in landed { waiting.resume() }
            landed = []
        }
        return answer
    }

    /// A change's answer, settled. A change's own answer is the truth as of that change — but a
    /// later change of the phone's, still waiting for its own answer, stands over it until then.
    /// Every case by name: one BaliCore adds must be placed here.
    private func answered(_ record: OutboxRecord, _ sent: Sent, _ disposition: Disposition?) async
    {
        await heard(sent.result, sent.noAnswer)
        knowLastTap()
        let queued = queue()
        let applies = stored(outbox.awaiting) == 0
        // An arming's wait ends where the server drops the tap, the end of its school day
        // (decision 5) — by the phone's clock too, read or not (#166) — kept for a relaunch before
        // the state is copied, so a write the file refuses stays shown (rule 5).
        var waitEnds: Date?
        if disposition == .tap(.waitForStart), applies {
            let ends = SyncState.waitEnds(armedAt: clock.now())
            waitEnds = ends
            _ = stored { try outbox.keepWaitEnds(ends) }
        }
        var next = state
        // Settled, and the queue read again, in one write: no screen sees the record neither on
        // its way nor answered (santa's round 1).
        (next.queued, next.sending) = (queued, next.sending.subtracting([record.eventId]))
        defer { state = next }
        switch disposition {
        case .tap(.retry)?, .unlock(.retry)?, .stateChange(.retry)?, .tap(.reauth)?,
            .unlock(.reauth)?, .stateChange(.reauth)?:
            return
        // nil: superseded in flight, its answer older than the phone's truth. A refused unlock is
        // kept and shown, and still stands on the phone (`holdsUnlock`).
        case nil, .unlock(.retryAndSurface)?: break
        case .tap(.applySession)?, .unlock(.recorded)?, .stateChange(.applySession)?:
            // An unlock recorded in a session, not late: its reason on record, the card's check —
            // its own, or the one the server kept, its first standing (A1) — and what a pick
            // changes from now (A20). A newer unlock of the class still queued is the card's.
            if disposition == .unlock(.recorded), record.change.isUnlock, !sent.superseded,
                let session = sent.session
            {
                next.recordedUnlock = RecordedUnlock(
                    session: session.id, unlock: record.eventId, reason: sent.reason)
            }
            // A live participation names its session and its state; a note (an unlock after the
            // end names the session it ended) names no window to be in.
            guard let session = sent.session, var participation = sent.state else {
                reread()
                break
            }
            // The unlock guard, on every answer, not a tap's alone (#95's review). A tap's or a
            // refocus's is the student's own return: an unlock made before it holds nothing back.
            let after = record.change.isReturn ? (record.order?.seq ?? 0) : 0
            if participation == .focused, keepsUnlocked(session.id, after: after) {
                participation = .unlocked
            }
            // A late unlock putting the shields back with no return of the phone's own since —
            // focused there already, or a tap or refocus made after it — is said why (C5a).
            let seq = record.order?.seq ?? 0
            if sent.superseded, participation == .focused, applies,
                !next.standing.isFocused(in: session.id),
                !queued.contains(where: { $0.change.isReturn && ($0.order?.seq ?? 0) > seq })
            {
                next.superseded = Superseded(session: session.id, ordered: record.order != nil)
            }
            if applies { next.standing = .inSession(session, participation) }
        case .tap(.waitForStart)?:
            if let waitEnds { next.waitEnds = waitEnds }
            switch next.standing {
            // Arming ends nothing: a session the phone is in stays (decision 4) while it runs by
            // the phone's own clock (data model, decision 6) — past its bell the phone is in none,
            // and waits as from out: the sweep that ends it on the server may run late (C3a). One
            // it may be in, where it stood unread, is asked of the server, the arming carried.
            case .inSession(let session, _) where session.endsAt > clock.now(): break
            case .unread:
                if applies { armed = true }
                reread()
            case .inSession, .out, .waiting: if applies { next.standing = .waiting }
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
    /// (`GET /v1/me`) when one was asked for — tried again at the next wake until it is answered,
    /// and at each wake in the foreground while waiting for the Start — or, in the foreground, the
    /// check-in of the session the phone is in; then waits for the next.
    private func read() async {
        while !Task.isCancelled {
            rung.remove(.read)
            readStanding()
            // Past the end of the day its tap was armed, the server has dropped it (decision 5),
            // which a read says (`armed`); with none answered — offline — the wait ends there too,
            // at a wake: never Waiting where no Start would lock the phone (#166).
            if state.standing == .waiting, let ends = state.waitEnds, ends <= clock.now() {
                state.standing = .out
            }
            // Rule 3, at each wake in the foreground: before the check-in, or the read of the truth
            // in its place — offline, one that never completes. A protection off it reports is a
            // change, which the read's stamp then counts. Out of a session too (C1c): with the app
            // left open there, a grant taken back is found at a wake, not at the app's next return
            // to the front — and reported nowhere, which the check's own rules see to.
            if foreground { await check?() }
            // Decision 6, the owner's ruling (2026-09-29; C3a): waiting for the teacher's Start,
            // the phone reads the truth at each wake in the foreground — the check-in's cadence —
            // since no answer of its own brings the Start, and no feed does. And out of a session,
            // in a class, by the same rule: Home says when one of theirs is in session (C3c; the
            // conductor's decision under the owner's delegation, 2026-09-30).
            let outInClass = state.standing == .out && state.hasClasses == true
            if foreground, state.standing == .waiting || outInClass { rereading = true }
            // Never during an account deletion (C4): `GET /v1/me` would make a fresh account.
            if !deleting, let sent = stored(stamp) {
                if rereading {
                    rereading = false
                    let changesThen = meChanges
                    let response = await counted { await client.me() }
                    await heard(response.result, response.noAnswer)
                    if let me = response.answer {
                        // Its `me`, unless the phone changed that since it was sent.
                        let current = meChanges == changesThen
                        reconcile(sent, standing(me)) {
                            if current { $0.me = me }
                            $0.meFailed = nil
                        }
                    } else {
                        rereading = true
                        state.meFailed = response.result
                    }
                } else if foreground, case .inSession(let session, _) = state.standing {
                    let request = CheckInRequest(deviceTime: clock.now())
                    let response = await counted {
                        await client.checkIn(session: session.id, request)
                    }
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
        // Written back at once, filing whatever the file holds waiting to be (`keepStanding`).
        kept = nil
        state.standing = armed && standing == .out ? .waiting : standing
    }

    /// `GET /v1/me`'s answer, as a standing: its live session, or none — waiting, while armed and
    /// the read does not say no tap of the student's waits (#166). A session over by the phone's
    /// own clock (data model, decision 6) is not the Start a waiting phone waits for: the sweep
    /// that ends it on the server may run late, and it would end the wait with no class to be in
    /// (C3).
    private func standing(_ me: MeResponse) -> Standing {
        let waiting = (state.standing == .waiting || armed) && me.armed != false
        guard let session = me.session, !waiting || session.endsAt > clock.now() else {
            return waiting ? .waiting : .out
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
    /// over an unrecorded emergency unlock (`keepsUnlocked`): its window applies, not its focus.
    /// What else it answers (`also`: `GET /v1/me`'s classes) goes in the same step.
    private func reconcile(
        _ sent: ReconcileStamp, _ read: Standing, also: (inout SyncState) -> Void = { _ in }
    ) {
        var standing: Standing?
        if let now = stored(stamp), readMayReconcile(sent: sent, now: now) {
            standing = read
            if case .inSession(let session, .focused?) = read, keepsUnlocked(session.id) {
                standing = .inSession(session, .unlocked)
            }
        }
        update {
            if let standing { $0.standing = standing }
            also(&$0)
        }
    }

    /// The unlock guard (B3b-2), for every read and every answer: a focus the server names in
    /// `session` applies as unlocked while an emergency unlock the server has yet to record is
    /// queued there (`holdsUnlock`) — unless the student has returned there since: the phone stands
    /// focused there already, or the answer is to their own return made after it, by the phone's
    /// order (`after`, that return's place in it). Focused already means returned since only while
    /// every unlock takes the phone out of focus at once (`Standing.acting`) and nothing brings it
    /// back but a refocus or an answer or a read past this guard, or Screen Time back on to where
    /// the phone stood before protection off or, not known, past this guard (#167): keep both so.
    private func keepsUnlocked(_ session: String, after: Int = 0) -> Bool {
        !state.standing.isFocused(in: session)
            && stored({ try outbox.holdsUnlock(session: session, after: after) }) ?? true
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

    /// The queue read again for the screens, the phone's newest tap with it while not known — each
    /// written to the state in a step of its own, after its read, whatever order Swift evaluates
    /// an assignment in (#155's review).
    private func refreshQueue() {
        knowLastTap()
        let queued = queue()
        state.queued = queued
    }

    /// The phone's newest tap, read from the file while not known — a read at launch that failed,
    /// say (santa's round 1) — or a refused tap a later one went ahead of would be said again
    /// (#146). Its own step, before the queue is read: never a read's hidden effect.
    private func knowLastTap() {
        if state.lastTap == nil, let lastTap = try? outbox.lastTap() { state.lastTap = lastTap }
    }

    /// Everything queued, for the screens; a read that fails is shown (rule 5), the last one kept.
    private func queue() -> [OutboxRecord] { stored(outbox.records) ?? state.queued }

    /// Writes the standing to the file — filing into it, in the same write, every unlock made where
    /// the phone stood unread, which then goes (B6b): whatever the file holds, never what a read of
    /// the queue last found, which one that fails leaves behind (#95's review). `kept` is set
    /// first, so the change of state a failure makes (`failed`) writes nothing again at once; the
    /// next change does.
    private func keepStanding() {
        let standing = state.standing
        kept = standing
        let filed = stored({ try outbox.file(standing) })
        if filed == nil {
            kept = nil
        } else if filed == true {
            refreshQueue()
            ring(.drain)
        }
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
