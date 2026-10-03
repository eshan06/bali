import BaliCore
import Foundation
import GRDB
import Testing

@testable import BaliOutbox

let protectionOffRoute = "POST /v1/sessions/s/protection-off"

extension Answer {
    static func protectionOff(_ view: SessionView = session()) -> String {
        #"{"outcome":"applied","recordedAs":null,"state":"protection_off","session":\#(json(view))}"#
    }
}

/// Screen Time as a test holds it: the store's shields, the marker in a store of its own and the
/// flag that it was written (F1b), and the permission, which the test changes behind the enforcer's
/// back, as iOS or the student would.
actor FakeScreenTime: ScreenTime {
    private(set) var shielding = false
    private(set) var granted = Permission.approved
    private(set) var shields = 0
    private(set) var unshields = 0
    /// The marker, and its flag — kept in the app group's defaults, which a revocation leaves. By
    /// default none was ever written: a phone of a build before F1b's.
    private(set) var hasMarker = false
    private(set) var marked = false
    /// When the monitor found the marker gone, the app closed, as the app group keeps it.
    private var lostAt: Date?
    /// Reads of the store to let through before the one held (`hold(after:)`); nil: none held.
    private var through: Int?
    private var parked: CheckedContinuation<Void, Never>?

    /// `marked`: the marker written and there — a phone whose access this build has confirmed.
    init(marked: Bool = false) { (hasMarker, self.marked) = (marked, marked) }

    func isShielding() async -> Bool {
        if let left = through {
            through = left > 0 ? left - 1 : nil
            if left == 0 { await withCheckedContinuation { parked = $0 } }
        }
        return shielding
    }
    func shield() {
        shielding = true
        shields += 1
    }
    func unshield() {
        shielding = false
        unshields += 1
    }
    func permission() -> Permission { granted }

    func marker() -> Marker { marked ? hasMarker ? .present : .missing : .unwritten }
    /// As the phone writes it (`Marker.write()`), by `Marker.written`'s rule: one that never sticks
    /// (`markerSticks(false)`) reads back nothing.
    func writeMarker() {
        let after = Marker.written(readBack: sticks, note: lostAt)
        (hasMarker, marked, lostAt) = (sticks, after.flag, after.note)
    }
    private var sticks = true
    func markerSticks(_ sticks: Bool) { self.sticks = sticks }
    func markerLostAt() -> Date? { lostAt }
    /// The monitor, woken with the app closed, found the marker gone at `date`.
    func noteLoss(at date: Date) { lostAt = date }

    /// Each ask of iOS — the student's, or the enforcer's silent one — counted: given; or, once
    /// `refuseAsk`, the student's Don't Allow, a throw and denied; or, once `failAsk`, a throw and
    /// nothing changed. Held (`holdAsks`), it waits until `answerAsks()`: a prompt up — and an ask
    /// made meanwhile is refused at once, as iOS refuses two at once (`authorizationConflict`).
    private(set) var asks = 0
    struct Conflict: Error {}
    func requestPermission() async throws {
        asks += 1
        if askParked != nil { throw Conflict() }
        if holdingAsks { await withCheckedContinuation { askParked = $0 } }
        if failsAsk { throw Refused() }
        if refusesAsk {
            granted = .denied
            throw Refused()
        }
        granted = .approved
    }
    private var refusesAsk = false
    func refuseAsk() { refusesAsk = true }
    private var failsAsk = false
    func failAsk(_ fails: Bool = true) { failsAsk = fails }
    private var holdingAsks = false
    private var askParked: CheckedContinuation<Void, Never>?
    func holdAsks() { holdingAsks = true }
    var askHeld: Bool { askParked != nil }
    func answerAsks() {
        holdingAsks = false
        askParked?.resume()
        askParked = nil
    }

    /// Each window iOS took, in order — nil for a cancel — and the one it holds now.
    private(set) var windows: [DateInterval?] = []
    var registered: DateInterval? { windows.last ?? nil }
    /// Whether iOS refuses the windows asked for.
    private var refusing = false
    struct Refused: Error {}

    func schedule(_ window: DateInterval?) throws {
        if refusing, window != nil { throw Refused() }
        // Only a window iOS takes anew ends the monitor's refusal: one it holds asks nothing (#103).
        if window != nil, window != registered { refusedMonitor = nil }
        windows.append(window)
    }
    func refuse(_ refusing: Bool = true) { self.refusing = refusing }

    /// #144: the student takes Bali's Screen Time access back in Settings, and a running app never
    /// hears of it: iOS deletes the app's whole ManagedSettings record — the shields and the
    /// marker — while Family Controls' read stays as it was (the device experiment, 2026-10-02).
    func revokeUnseen() { (shielding, hasMarker) = (false, false) }

    /// When iOS refused the monitor its next window, the app closed, as the app group keeps it.
    private var refusedMonitor: Date?
    func monitorUnscheduled() -> Date? { refusedMonitor }
    func refuseMonitor(at date: Date) { refusedMonitor = date }

    /// The student changes the permission in Settings: iOS drops every shield when it goes — the
    /// marker with them.
    func set(_ permission: Permission) {
        granted = permission
        if permission != .approved { (shielding, hasMarker) = (false, false) }
    }
    /// The permission reads so, the shields untouched: Family Controls just after a launch.
    func reads(_ permission: Permission) { granted = permission }
    /// The shields are gone, and nothing told the app.
    func drop() { shielding = false }
    /// The store holds the shields already — a relaunch's.
    func held() { shielding = true }

    /// Lets `reads` reads of the store through, then holds the next until `release()`: a pass of
    /// the enforcer waiting on Screen Time there.
    func hold(after reads: Int) { through = reads }
    var holding: Bool { parked != nil }
    func release() {
        parked?.resume()
        parked = nil
    }
}

/// The outbox refuses to queue a record — a write the file will not take — or takes them again.
func refuseRecords(_ outbox: Outbox, _ refused: Bool = true) throws {
    let sql =
        refused
        ? "CREATE TRIGGER refuse BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'no'); END"
        : "DROP TRIGGER refuse"
    try outbox.pool.write { try $0.execute(sql: sql) }
}

/// The standing the file keeps, made unreadable: this build cannot decode it.
func spoilStanding(_ outbox: Outbox) throws {
    try outbox.pool.write { try Outbox.setState($0, Outbox.standingKey, "spoiled") }
}

/// The standing as the file holds it, unread.
func keptStanding(_ outbox: Outbox) throws -> String? {
    try outbox.pool.read { try Outbox.state($0, Outbox.standingKey) }
}

/// At every commit to the file it observes, the engine the next launch would start, were the app
/// killed right then: each started over a connection of its own, as that launch's, never run.
final class Relaunches: TransactionObserver, @unchecked Sendable {
    private let lock = NSLock()
    private var started: [SyncEngine] = []
    private let file: Outbox
    private let client = APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Tokens(), transport: Server())

    init(_ url: URL) throws { file = try open(url) }

    var engines: [SyncEngine] { lock.withLock { started } }

    func observes(eventsOfKind eventKind: DatabaseEventKind) -> Bool { true }
    func databaseDidChange(with event: DatabaseEvent) {}
    func databaseDidCommit(_ db: Database) {
        let engine = SyncEngine(outbox: file, client: client)
        lock.withLock { started.append(engine) }
    }
    func databaseDidRollback(_ db: Database) {}
}

/// A relaunch over `outbox` — a fresh one by default — whose file holds where the phone stood —
/// focused until `endsAt` — in a form this build cannot read, the store holding the shields
/// (`held`, the last run's) or none: the engine and its enforcer.
func unreadable(
    held: Bool = true, endsAt: TimeInterval = 1200, outbox: Outbox? = nil
) async throws -> (Enforced, Standing) {
    let outbox = try outbox ?? makeOutbox().outbox
    let kept = Standing.inSession(session(endsAt: endsAt), .focused)
    try outbox.keep(kept)
    try spoilStanding(outbox)
    let screenTime = FakeScreenTime()
    if held { await screenTime.held() }
    let phone = Enforced(try Rig(outbox: outbox), screenTime)
    await phone.until { $0.permission == .approved }
    return (phone, kept)
}

/// An enforcer over a rig's engine and clock, with Screen Time as the test holds it.
struct Enforced {
    let rig: Rig
    let screenTime: FakeScreenTime
    let enforcer: Enforcer
    let running: Task<Void, Never>

    init(_ rig: Rig, _ screenTime: FakeScreenTime = FakeScreenTime()) {
        let enforcer = Enforcer(engine: rig.engine, screenTime: screenTime, clock: rig.clock)
        (self.rig, self.screenTime, self.enforcer) = (rig, screenTime, enforcer)
        running = Task { await enforcer.run() }
    }

    /// Waits for a claim `condition` holds for, and returns it; none in time fails the test.
    @discardableResult
    func until(_ condition: @escaping @Sendable (Protection) -> Bool) async -> Protection {
        let enforcer = self.enforcer
        let reached = await withTaskGroup(of: Protection?.self) { group in
            group.addTask {
                for await protection in await enforcer.updates() where condition(protection) {
                    return protection
                }
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
        Issue.record("the enforcer never reached the claim waited for")
        return await enforcer.protection
    }

    /// Stops the enforcer, then the engine.
    func stop() async {
        running.cancel()
        await running.value
        await rig.stop()
    }
}

extension Rig {
    /// Waits until the read loop sleeps until `deadline`, so the clock moved there runs that
    /// check-in — never one a check-in later, as a move made before the loop sleeps would.
    func checkInDue(_ deadline: Date) async throws {
        try await eventually { clock.deadlines.contains(deadline) }
    }
}

@Suite("What the shields follow: the engine's truth, by the phone's clock")
struct ShieldedUntilTests {
    @Test("Focused in a session: on until its end, and off from then — off in every other standing")
    func standing() {
        var state = SyncState()
        state.standing = .inSession(session(endsAt: 1200), .focused)
        #expect(state.shieldedUntil(t0) == at(1200))
        #expect(state.shieldedUntil(at(1199)) == at(1200))
        #expect(state.shieldedUntil(at(1200)) == nil)
        let others: [Standing] = [
            .out, .waiting, .inSession(session(), .unlocked), .inSession(session(), .protectionOff),
            .inSession(session(), nil),
        ]
        for standing in others {
            state.standing = standing
            #expect(state.shieldedUntil(t0) == nil, "\(standing)")
        }
    }

    @Test(
        "A tap not yet answered: on at once, for decision 7's 50 minutes — beside a session's end, the later — and off once the student unlocks after it, until another tap"
    )
    func pendingTap() throws {
        let (outbox, _) = try makeOutbox()
        var state = SyncState()
        state.standing = .inSession(session(endsAt: 1200), .focused)
        try record(outbox, .tap(tagId: "tag"), at: at(60))
        state.queued = try outbox.records()
        #expect(SyncState.tapCap == 50 * 60)
        #expect(state.shieldedUntil(at(60)) == at(3060))
        #expect(state.shieldedUntil(at(3059)) == at(3060))
        #expect(state.shieldedUntil(at(3060)) == nil)
        // An unlock after it is acted on at once (decision 11): the session's own end is left.
        try record(outbox, .unlock(session: "s", reason: nil), at: at(90))
        state.queued = try outbox.records()
        #expect(state.shieldedUntil(at(90)) == at(1200))
        state.standing = .inSession(session(endsAt: 1200), .unlocked)
        #expect(state.shieldedUntil(at(90)) == nil)
        // A tap after the unlock shields again.
        try record(outbox, .tap(tagId: "tag"), at: at(120))
        state.queued = try outbox.records()
        #expect(state.shieldedUntil(at(120)) == at(3120))
    }

    @Test("A refused tap is stuck, and its shield does not outlive the refusal")
    func stuckTap() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        var state = SyncState()
        state.queued = try outbox.records()
        #expect(state.shieldedUntil(t0) == at(SyncState.tapCap))
        try await send(outbox, tap, 409, Answer.refused("session_not_running"))
        state.queued = try outbox.records()
        #expect(state.queued.first?.stuck == true)
        #expect(state.shieldedUntil(t0) == nil)
    }
}

@Suite("The shields follow the engine", .timeLimit(.minutes(3)))
struct EnforcerTests {
    @Test(
        "What a screen may claim is checked only once a pass has read the phone (C1a): the enforcer's first value is the defaults, unchecked — no screen is chosen on it — and a check makes it so"
    )
    func checked() async throws {
        let rig = try Rig()
        let enforcer = Enforcer(engine: rig.engine, screenTime: FakeScreenTime(), clock: rig.clock)
        #expect(await !enforcer.protection.checked)
        await enforcer.check()
        let found = await enforcer.protection
        #expect(found.checked && found.permission == .approved)
        await rig.stop()
    }

    @Test(
        "A tap shields at once, before its answer; the answer keeps them on to the bell, when they come off by the phone's own clock"
    )
    func tapToBell() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 1200)
        try await rig.engine.record(.tap(tagId: "tag"))
        var now = await phone.until { $0.shielded }
        #expect(now.until == at(SyncState.tapCap) && now.permission == .approved)
        try await rig.server.next(tapRoute).reply(200, Answer.joined(view))
        now = await phone.until { $0.until == view.endsAt }
        #expect(now.shielded)
        rig.clock.advance(by: 1200)
        now = await phone.until { !$0.shielded }
        #expect(now.until == nil)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test("Emergency Unlock drops them at once, through the engine; a refocus puts them back")
    func unlockDrops() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        try await rig.engine.record(.unlock(session: "s", reason: .nurse))
        await phone.until { !$0.shielded && $0.until == nil }
        #expect(await !phone.screenTime.shielding)
        try await rig.engine.record(.refocus(session: "s"))
        await phone.until { $0.shielded && $0.until == session().endsAt }
        await phone.stop()
    }

    @Test("A tap the server never answers comes off at decision 7's cap, still queued")
    func capped() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.shielded && $0.until == at(SyncState.tapCap) }
        try await rig.server.next(tapRoute).reply(nil)
        rig.clock.advance(by: SyncState.tapCap)
        await phone.until { !$0.shielded }
        #expect(await rig.engine.state.pendingTap != nil)
        await phone.stop()
    }

    @Test("An unlock made while a re-tap waits for its answer drops the shields at once (decision 11)")
    func unlockOverPendingTap() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn(session(endsAt: 1200))
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.until == at(SyncState.tapCap) }
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        await phone.until { !$0.shielded }
        #expect(await rig.engine.state.pendingTap != nil)
        await phone.stop()
    }

    @Test(
        "A tap answered armed, or refused, takes its shield off with the answer",
        arguments: [(200, Answer.armed), (409, Answer.refused("session_not_running"))])
    func tapWithoutSession(status: Int, body: String) async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.shielded }
        try await rig.server.next(tapRoute).reply(status, body)
        await phone.until { !$0.shielded }
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test("Rule 3: shields gone behind the app's back go back on at the check before the next check-in")
    func putBack() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded }
        await phone.screenTime.drop()
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        try await eventually { await phone.screenTime.shielding }
        await phone.stop()
    }

    @Test(
        "What a screen claims is what the check found, never the standing alone: focused with the permission off claims no shield"
    )
    func claimIsChecked() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        await phone.screenTime.set(.denied)
        // A read of the truth, heard a second later, changes the state: the claim is checked again.
        rig.clock.advance(by: 1)
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(200, Answer.me())
        let now = await phone.until { $0.permission == .denied }
        #expect(!now.shielded && now.until == session().endsAt)
        #expect(await rig.engine.state.standing == .inSession(session(), .focused))
        await phone.stop()
    }

    @Test(
        "A relaunch starts where the phone stood — in its session, its tap still waiting — so the shields stay on, offline too"
    )
    func relaunch() async throws {
        let (outbox, url) = try makeOutbox()
        let before = try Rig(outbox: outbox)
        try await before.tapIn(session(endsAt: 1200))
        try await before.engine.record(.tap(tagId: "tag"))
        await before.stop()
        // An engine starts from the file, before it runs: enforcement never begins from nothing.
        let client = APIClient(
            baseURL: URL(string: "https://api.bali.test")!, tokens: Tokens(), transport: Server())
        let state = await SyncEngine(outbox: try open(url), client: client).state
        #expect(state.standing == .inSession(session(endsAt: 1200), .focused))
        #expect(state.pendingTap != nil)
        let rig = try Rig(outbox: try open(url))
        let screenTime = FakeScreenTime()
        await screenTime.held()
        let phone = Enforced(rig, screenTime)
        let now = await phone.until { $0.until != nil }
        #expect(now.shielded && now.until == at(SyncState.tapCap))
        #expect(await screenTime.unshields == 0)
        await phone.stop()
    }

    @Test("Asked for, the permission is granted, and what a screen claims says so")
    func requestPermission() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.notDetermined)
        let phone = Enforced(rig, screenTime)
        await phone.until { $0.permission == .notDetermined }
        try await phone.enforcer.requestPermission()
        await phone.until { $0.permission == .approved }
        await phone.stop()
    }

    @Test(
        "Asked for and not given — Don't Allow — the throw comes after a pass: what a screen claims reads denied as the ask returns, not a check-in later (C1b)"
    )
    func requestPermissionRefused() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.notDetermined)
        let phone = Enforced(rig, screenTime)
        // Its first pass made — the claim before it is the defaults, which read not determined
        // too — so nothing but the ask's own pass is running when it returns.
        await phone.until { $0.checked && $0.permission == .notDetermined }
        await screenTime.refuseAsk()
        await #expect(throws: FakeScreenTime.Refused.self) {
            try await phone.enforcer.requestPermission()
        }
        let claim = await phone.enforcer.protection
        #expect(claim.permission == .denied && claim.permissionOff)
        await phone.stop()
    }
}

@Suite("Rule 3: protection off, found and reported", .timeLimit(.minutes(3)))
struct ProtectionOffTests {
    /// In a session, focused, with the app in front: the student turns the permission off, and the
    /// check before the next check-in reports it, which lands — the report returned.
    @discardableResult
    func reported(_ rig: Rig, _ phone: Enforced) async throws -> Server.Exchange {
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded }
        await phone.screenTime.set(.denied)
        rig.clock.advance(by: 30)
        let report = try await rig.server.next(protectionOffRoute)
        let now = await phone.until { $0.permission == .denied }
        #expect(!now.shielded && now.until == nil)
        #expect(await rig.engine.state.standing == .inSession(session(), .protectionOff))
        report.reply(200, Answer.protectionOff())
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        try await rig.checkInDue(at(60))
        return report
    }

    @Test(
        "The permission found off in a session is reported at the next check, once: the check after finds it on record"
    )
    func once() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await reported(rig, phone)
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        try await rig.sleeping([at(90)])
        #expect(await rig.server.waiting.isEmpty)
        #expect(try rig.outbox.records().isEmpty)
        await phone.stop()
    }

    @Test(
        "A13's rider: reported there, a read that says the phone is focused there again — an older re-tap landed — has it reported again"
    )
    func reportedAgain() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let first = try await reported(rig, phone)
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        await rig.until { $0.standing == .inSession(session(), .focused) }
        try await rig.checkInDue(at(90))
        rig.clock.advance(by: 30)
        let again = try await rig.server.next(protectionOffRoute)
        #expect(again.eventId != first.eventId)
        again.reply(200, Answer.protectionOff())
        await rig.until { $0.standing == .inSession(session(), .protectionOff) }
        await phone.stop()
    }

    @Test("Reported there, only focus reports it again: an unlock made since reports nothing new")
    func onlyFocusAgain() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await reported(rig, phone)
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        rig.clock.advance(by: 30)
        let checkIn = try await rig.server.next(checkInRoute)
        // Queuing nothing, it keeps nothing either: the file stands where the phone does.
        #expect(try rig.outbox.standing() == .inSession(session(), .unlocked))
        checkIn.reply(200, Answer.live(state: "protection_off"))
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])
        await phone.stop()
    }

    @Test(
        "Protection off that could not be queued is shown, and tried again at the next check: queued then, it is no longer shown"
    )
    func unreported() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded }
        await phone.screenTime.set(.denied)
        try refuseRecords(rig.outbox)
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        let shown = await phone.until { $0.unreported }
        #expect(shown.permission == .denied && !shown.shielded)
        #expect(try rig.outbox.records().isEmpty)
        try refuseRecords(rig.outbox, false)
        try await rig.checkInDue(at(60))
        rig.clock.advance(by: 30)
        let report = try await rig.server.next(protectionOffRoute)
        await phone.until { !$0.unreported }
        #expect(await rig.engine.state.standing == .inSession(session(), .protectionOff))
        report.reply(200, Answer.protectionOff())
        await phone.stop()
    }

    @Test(
        "A check made while a pass of the enforcer waits on Screen Time keeps what it found: the pass never writes over a protection off it could not queue"
    )
    func checkDuringPass() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        await phone.screenTime.set(.denied)
        try refuseRecords(rig.outbox)
        // A pass on the next state the engine publishes, held at its second read of the store —
        // after it has read the permission.
        await phone.screenTime.hold(after: 1)
        rig.clock.advance(by: 1)
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(503)
        try await eventually { await phone.screenTime.holding }
        await phone.enforcer.check()
        #expect(await phone.enforcer.protection.unreported)
        await phone.screenTime.release()
        let now = await phone.until { $0.permission == .denied }
        #expect(now.unreported && !now.shielded)
        #expect(await phone.enforcer.protection.unreported)
        await phone.stop()
    }

    @Test(
        "Not determined for a moment — as Family Controls can read it just after a launch — is never reported, however many checks read it in that moment"
    )
    func notDeterminedPassing() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        // No marker ever written — the silent ask fails — so B5a-2's grace judges (F1b).
        await phone.screenTime.failAsk()
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded }
        // The app comes to the foreground, twice in a second: each checks at once.
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        rig.clock.advance(by: 1)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        #expect(await !phone.enforcer.protection.permissionOff)
        // The check before the next check-in reads it approved: nothing reported, nothing owed.
        await phone.screenTime.reads(.approved)
        rig.clock.advance(by: 29)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        await phone.screenTime.reads(.notDetermined)
        try await rig.checkInDue(at(60))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        #expect(try rig.outbox.records().isEmpty)
        #expect(await rig.engine.state.standing == .inSession(session(), .focused))
        await phone.stop()
    }

    @Test(
        "Never granted — not determined from the check as the app comes to the foreground, and at every check after — is reported once that lasts the grace (#145), once: a phone that cannot shield is never shown focused; and the claim says the permission is off from then (C1b), not before"
    )
    func notDeterminedLasting() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.notDetermined)
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        try await rig.foreground()
        #expect(try rig.outbox.records().isEmpty)
        #expect(await !phone.enforcer.protection.permissionOff)
        rig.clock.advance(by: 30)
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        await rig.until {
            $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff)
        }
        await phone.until { $0.permissionOff && $0.permission == .notDetermined }
        try await rig.checkInDue(at(60))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        try await rig.sleeping([at(90)])
        #expect(await rig.server.waiting.isEmpty)
        #expect(try rig.outbox.records().isEmpty)
        await phone.stop()
    }

    @Test(
        "Any other read ends a run of not determined — an enforcement pass's too — so a launch's passing read never joins a later one"
    )
    func notDeterminedRunEnds() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        // Settled: the pass on the next state the engine publishes reads it approved.
        await phone.screenTime.reads(.approved)
        rig.clock.advance(by: 10)
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(503)
        await phone.until { $0.permission == .approved }
        // Not determined again, later: a run of its own, not the launch's.
        await phone.screenTime.reads(.notDetermined)
        rig.clock.advance(by: 30)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        rig.clock.advance(by: 30)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }

    @Test(
        "A clock turned back between the checks neither stalls the run nor starts it again — it is measured by the time the phone has run: never granted is still reported, the grace later"
    )
    func notDeterminedClockBack() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.notDetermined)
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        await phone.enforcer.check()
        // The student turns the phone's clock back ten minutes.
        rig.clock.turn(by: -600)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        rig.clock.advance(by: 30)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }

    @Test(
        "A clock set forward between two reads of not determined collapses no grace window: a launch's passing read is never reported, and one that lasts the grace, by the time the phone has run, is"
    )
    func notDeterminedClockForward() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        // Just after a launch, the phone's clock minutes behind: not determined, for a moment.
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        // The clock corrects itself, ten minutes forward, and a second later the app checks again.
        rig.clock.turn(by: 600)
        rig.clock.advance(by: 1)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        rig.clock.advance(by: 29)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }

    @Test(
        "A session the phone's own clock says is over has no protection off to report, as it has no shields: none is written into its history",
        arguments: [(1199.0, true), (1200.0, false), (1300.0, false)])
    func notAfterTheEnd(seconds: TimeInterval, reported: Bool) async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        // Offline since the tap, say: nothing has told the phone the session is over but its clock.
        try await rig.tapIn(session(endsAt: 1200))
        await phone.until { $0.shielded }
        rig.clock.advance(by: seconds)
        await phone.screenTime.set(.denied)
        await phone.enforcer.check()
        let queued = try rig.outbox.records().map(\.change)
        #expect(queued == (reported ? [.protectionOff(session: "s")] : []))
        await phone.stop()
    }

    @Test(
        "Offline, rule 3's check still runs every 30 seconds in the foreground — before the read of the truth that goes in the check-in's place and never completes: the shields put back, protection off queued"
    )
    func checkOffline() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        // In front, offline: the read of the truth gets no answer, and is tried again at each wake.
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(nil)
        await phone.until { $0.shielded }
        try await rig.checkInDue(at(30))
        await phone.screenTime.drop()
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(nil)
        try await eventually { await phone.screenTime.shielding }
        try await rig.checkInDue(at(60))
        await phone.screenTime.set(.denied)
        rig.clock.advance(by: 30)
        try await rig.server.next(protectionOffRoute).reply(nil)
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }

    @Test(
        "Out of a session, or in one whose row the server already has as protection off, there is nothing to report"
    )
    func nothingToReport() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.denied)
        let phone = Enforced(rig, screenTime)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        // A read says so — say the app was reinstalled since: this file never reported it.
        try await rig.foreground(Answer.me(session(), state: "protection_off"))
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        await phone.stop()
    }

    @Test(
        "Out of a session too, with the app left open, rule 3's check runs at each wake of the read loop (C1c), not only as the app comes to the front: access taken back is found at the next wake — the marker gone (F1b) — and nothing is reported, there being no session; turned on again in Settings, the marker is still gone, so it stays off until Allow, which iOS answers at once with access on; denied, off at once"
    )
    func checkOutOfSession() async throws {
        let rig = try Rig()
        let phone = Enforced(rig, FakeScreenTime(marked: true))
        try await rig.foreground(Answer.me(nil))
        await phone.until { $0.checked && $0.permission == .approved }
        // Taken back in Settings, and nothing else happens: no session, no read, no change.
        await phone.screenTime.revokeUnseen()
        rig.clock.advance(by: 30)
        await phone.until { $0.permission == .notDetermined && $0.permissionOff }
        try await rig.checkInDue(at(60))
        rig.clock.advance(by: 30)
        try await rig.checkInDue(at(90))
        #expect(await phone.enforcer.protection.permissionOff)
        try await phone.enforcer.requestPermission()
        await phone.until { $0.permission == .approved && !$0.permissionOff }
        await phone.screenTime.set(.denied)
        rig.clock.advance(by: 30)
        await phone.until { $0.permission == .denied && $0.permissionOff }
        #expect(try rig.outbox.records().isEmpty)
        #expect(await rig.server.waiting.isEmpty)
        await phone.stop()
    }
}

@Suite("The marker's bookkeeping in the app group, as the phone and the monitor keep it (F1b; #169's review)")
struct MarkerBookTests {
    @Test(
        "A write sets the flag only once the marker reads back — and forgets the monitor's note only then, so a loss the monitor found with Bali closed outlives a write that did not take"
    )
    func written() {
        let note = at(-900)
        let took = Marker.written(readBack: true, note: note)
        #expect(took.flag && took.note == nil)
        let missed = Marker.written(readBack: false, note: note)
        #expect(!missed.flag && missed.note == note)
        let none = Marker.written(readBack: false, note: nil)
        #expect(!none.flag && none.note == nil)
    }

    @Test(
        "The monitor's wake notes access lost only with the marker gone since it was written and the shields' store empty — a store still holding shields is a misread — the first such wake's time kept"
    )
    func noting() {
        let (first, later) = (at(-900), at(-300))
        let lost = Marker.noting(.missing, shielded: false, note: nil, at: first)
        #expect(lost.lost && lost.note == first)
        let again = Marker.noting(.missing, shielded: false, note: first, at: later)
        #expect(again.lost && again.note == first)
        for (marker, shielded) in [(Marker.missing, true), (.present, false), (.unwritten, false)] {
            let kept = Marker.noting(marker, shielded: shielded, note: first, at: later)
            #expect(!kept.lost && kept.note == first, "\(marker) \(shielded)")
            let none = Marker.noting(marker, shielded: shielded, note: nil, at: later)
            #expect(!none.lost && none.note == nil, "\(marker) \(shielded)")
        }
    }
}

@Suite(
    "#144 (F1b): access taken back while Bali runs is found by the marker, never by Family Controls' read, which a running app keeps approved",
    .timeLimit(.minutes(3)))
struct RevokedWhileRunningTests {
    /// Focused in a class, the app in front, the read loop asleep until the check-in at 30 s, on a
    /// phone whose access this build has confirmed: the marker written, and there.
    func focused() async throws -> (Rig, Enforced) {
        let rig = try Rig()
        let phone = Enforced(rig, FakeScreenTime(marked: true))
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded && $0.until == session().endsAt }
        return (rig, phone)
    }

    @Test(
        "Taken back in Settings with Bali in front — iOS deletes Bali's ManagedSettings record, the shields and the marker, while Family Controls' read stays approved: the next check finds the marker gone and reports protection off, never puts the shields back over it — iOS would keep them and enforce none — and the screen's way on is iOS's prompt"
    )
    func revoked() async throws {
        let (rig, phone) = try await focused()
        let shields = await phone.screenTime.shields
        await phone.screenTime.revokeUnseen()
        rig.clock.advance(by: 30)
        let report = try await rig.server.next(protectionOffRoute)
        let now = await phone.until { $0.permissionOff }
        #expect(now.permission == .notDetermined && !now.shielded)
        #expect(await phone.screenTime.granted == .approved)
        report.reply(200, Answer.protectionOff())
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        let state = await rig.until {
            $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff)
        }
        #expect(ProtectionOffWords(state, await phone.enforcer.protection)?.way == .ask)
        #expect(await phone.screenTime.shields == shields)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "Taken back while Bali was behind: the check as it comes back to the front finds the marker gone and reports it then, with no relaunch — and a pass before it, the shields owed, puts none on"
    )
    func behind() async throws {
        let rig = try Rig()
        let phone = Enforced(rig, FakeScreenTime(marked: true))
        try await rig.tapIn()
        await phone.until { $0.shielded }
        await phone.screenTime.revokeUnseen()
        rig.clock.advance(by: 600)
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(200, Answer.me())
        let found = await phone.until { $0.permissionOff }
        #expect(found.until == session().endsAt && !found.shielded)
        #expect(await !phone.screenTime.shielding)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }

    @Test(
        "The marker there: never off, check after check — and a read of not determined, as a launch's moment, is approved at once: no grace, no 'Checking Screen Time…', nothing asked of iOS (#145)"
    )
    func markerThere() async throws {
        let (rig, phone) = try await focused()
        for check in 1...3 {
            rig.clock.advance(by: 30)
            try await rig.server.next(checkInRoute).reply(200, Answer.live())
            try await rig.checkInDue(at(30 * Double(check + 1)))
        }
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        let now = await phone.until { $0.permission == .approved && $0.shielded }
        #expect(!now.permissionOff)
        #expect(!rig.clock.deadlines.contains(at(90 + Enforcer.recheckAfter)))
        #expect(try rig.outbox.records().isEmpty)
        #expect(await phone.screenTime.asks == 0)
        await phone.stop()
    }

    @Test(
        "The monitor's clear — the shields' store alone, never the marker's — is no revocation: the marker there, the check puts the shields back where the class still runs by the phone's clock, and reports nothing"
    )
    func monitorsClear() async throws {
        let (rig, phone) = try await focused()
        let shields = await phone.screenTime.shields
        await phone.screenTime.drop()
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        try await eventually { await phone.screenTime.shields == shields + 1 }
        try await rig.checkInDue(at(60))
        #expect(try rig.outbox.records().isEmpty)
        let now = await phone.enforcer.protection
        #expect(now.permission == .approved && now.shielded && !now.permissionOff)
        await phone.stop()
    }

    @Test(
        "Turned back on — Allow at iOS's prompt — the marker is written again, and what the standing calls for comes back with it: a re-tap made while access was off, never shielded over the marker gone, is shielded at once and its window asked for anew"
    )
    func turnedBackOn() async throws {
        let rig = try Rig()
        let phone = Enforced(rig, FakeScreenTime(marked: true))
        try await rig.tapIn()
        await phone.until { $0.shielded }
        await phone.screenTime.revokeUnseen()
        await phone.enforcer.check()
        try #require(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        // The block tapped again before Screen Time is on, its answer not come: owed, never put on.
        try await rig.engine.record(.tap(tagId: "tag"))
        _ = try await rig.server.next(tapRoute)
        await phone.until { $0.until == at(SyncState.tapCap) }
        #expect(await !phone.screenTime.shielding)
        #expect(await phone.screenTime.registered == nil)
        try await phone.enforcer.requestPermission()
        let now = await phone.until { $0.shielded }
        #expect(now.permission == .approved && !now.permissionOff)
        #expect(await phone.screenTime.hasMarker)
        #expect(await phone.screenTime.asks == 1)
        #expect(await phone.screenTime.registered == Bell.window(until: at(SyncState.tapCap)))
        await phone.stop()
    }

    @Test(
        "…and over a standing not read, where no pass cancels a window (B5a-2's rule), Allow still asks for the bell's window anew: iOS deleted it with the access, so a tap not yet answered keeps a wake at its cap"
    )
    func turnedBackOnUnread() async throws {
        let (outbox, _) = try makeOutbox()
        try outbox.keep(.inSession(session(endsAt: 1200), .focused))
        try spoilStanding(outbox)
        let screenTime = FakeScreenTime(marked: true)
        let phone = Enforced(try Rig(outbox: outbox), screenTime)
        let rig = phone.rig
        await phone.until { $0.checked }
        // Offline: a tap the server never answers, shielded to its cap, its window asked for.
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.shielded && $0.until == at(SyncState.tapCap) }
        try await rig.server.next(tapRoute).reply(nil)
        let cap = Bell.window(until: at(SyncState.tapCap))
        #expect(await screenTime.registered == cap)
        await screenTime.revokeUnseen()
        await phone.enforcer.check()
        await phone.until { $0.permissionOff }
        let asked = await screenTime.windows.count
        try await phone.enforcer.requestPermission()
        await phone.until { $0.shielded }
        #expect(await screenTime.windows.count == asked + 1)
        #expect(await screenTime.registered == cap)
        await phone.stop()
    }

    @Test(
        "No marker written yet — a phone of a build before F1b's, approved: a check asks iOS for the access silently, which iOS answers at once with no prompt where access is on, and writes the marker — nothing reported, never judged off; an ask that fails reports nothing either, and is not made again until the next launch (#169's review)"
    )
    func silentCheck() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        let screenTime = FakeScreenTime()
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        await screenTime.failAsk()
        await phone.enforcer.check()
        try await eventually { await screenTime.asks == 1 }
        try await eventually { await phone.enforcer.asking == nil }
        #expect(await !screenTime.marked)
        await screenTime.failAsk(false)
        for _ in 1...3 { await phone.enforcer.check() }
        #expect(await screenTime.asks == 1)
        #expect(await !screenTime.marked)
        #expect(try rig.outbox.records().isEmpty)
        let now = await phone.enforcer.protection
        #expect(now.permission == .approved && now.shielded && !now.permissionOff)
        await phone.stop()
        // The next launch asks once more, and writes the marker; written, it is never asked again.
        let relaunched = Enforced(try Rig(outbox: try open(url)), screenTime)
        await relaunched.until { $0.checked }
        await relaunched.enforcer.check()
        try await eventually { await screenTime.marked }
        await relaunched.enforcer.check()
        #expect(await screenTime.asks == 2)
        await relaunched.stop()
    }

    @Test(
        "A marker that never reads back — and access taken back, the read still approved in the running app — is asked for silently once a launch, never at every check, where iOS would prompt each time (#169's review)"
    )
    func silentCheckBounded() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.markerSticks(false)
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded }
        try await eventually { await screenTime.asks == 1 }
        try await eventually { await phone.enforcer.asking == nil }
        #expect(await !screenTime.marked)
        for check in 1...3 {
            rig.clock.advance(by: 30)
            try await rig.server.next(checkInRoute).reply(200, Answer.live())
            try await rig.checkInDue(at(30 * Double(check + 1)))
        }
        await phone.enforcer.check()
        #expect(await screenTime.asks == 1)
        await phone.stop()
    }

    @Test(
        "Turn on Screen Time pressed again — or while the silent check asks — makes no second ask of iOS while one is under way, which iOS would refuse (authorizationConflict): each press waits for that ask and has its answer"
    )
    func oneAskAtATime() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        let phone = Enforced(rig, screenTime)
        await screenTime.holdAsks()
        // The silent check's ask under way, iOS answering none yet.
        await phone.enforcer.check()
        try await eventually { await screenTime.askHeld }
        let presses = (0..<2).map { _ in Task { try await phone.enforcer.requestPermission() } }
        try await eventually { await phone.enforcer.asking?.count == 2 }
        #expect(await screenTime.asks == 1)
        await screenTime.answerAsks()
        for press in presses { try await press.value }
        #expect(await screenTime.asks == 1)
        #expect(await screenTime.marked)
        // Under way no more, a press asks again.
        try await phone.enforcer.requestPermission()
        #expect(await screenTime.asks == 2)
        await phone.stop()
    }

    @Test(
        "The monitor's note — the marker found gone with Bali closed, while the class ran — is reported at the next run's check, the bell rung since: the server records a report after the end; a note from after the bell reports nothing",
        arguments: [(-900.0, true), (-300.0, false)])
    func monitorsNote(lostAt: TimeInterval, reported: Bool) async throws {
        // Where the phone stood when Bali last ran: focused in a class whose bell rang 10 min ago.
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(session(endsAt: -600), .focused))
        let screenTime = FakeScreenTime(marked: true)
        await screenTime.revokeUnseen()
        await screenTime.noteLoss(at: at(lostAt))
        let phone = Enforced(try Rig(outbox: try open(url)), screenTime)
        await phone.until { $0.checked }
        await phone.enforcer.check()
        let queued = try phone.rig.outbox.records().map(\.change)
        #expect(queued == (reported ? [.protectionOff(session: "s")] : []))
        await phone.stop()
    }

    @Test(
        "B5a-2's order kept: a pass ends a run of not determined at its own read, so a check's newer read made while the pass is under way is never lost to it — reported a check-in later, not two"
    )
    func runKeptOverPass() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn()
        await phone.until { $0.shielded && $0.until == session().endsAt }
        // A pass that has read the permission approved, held at its second read of the store.
        await phone.screenTime.hold(after: 1)
        rig.clock.advance(by: 1)
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(503)
        try await eventually { await phone.screenTime.holding }
        // Family Controls reads not determined now, and a check begins its run.
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        await phone.screenTime.release()
        await phone.until { $0.permission == .notDetermined }
        rig.clock.advance(by: 30)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }
}

let protectionOnRoute = "POST /v1/sessions/s/protection-on"

extension Answer {
    /// Screen Time back on, applied: the state it returned the student to (#167).
    static func protectionOn(_ view: SessionView = session(), state: String = "focused") -> String {
        #"{"outcome":"applied","state":"\#(state)","session":\#(json(view))}"#
    }
    /// An Emergency Unlock under protection off: recorded, never softened (A2).
    static func unlockUnderOff(_ view: SessionView = session()) -> String {
        #"{"outcome":"recorded","recordedAs":"protection_off","state":"protection_off","session":\#(json(view)),"reason":null}"#
    }
}

@Suite(
    "#167: Screen Time back on in the class the phone was protection off in puts it back where it stood — focused, or still unlocked — with no re-tap",
    .timeLimit(.minutes(3)))
struct BackOnTests {
    /// Tapped into session "s" — and, `unlocked`, out of focus by an Emergency Unlock the server
    /// recorded — then access taken back and the report answered: the phone protection off there.
    func off(unlocked: Bool = false, screenTime: FakeScreenTime = FakeScreenTime(marked: true))
        async throws -> (Rig, Enforced)
    {
        let rig = try Rig()
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        await phone.until { $0.shielded }
        if unlocked {
            try await rig.engine.emergencyUnlock()
            try await rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .unlocked) }
        }
        await screenTime.revokeUnseen()
        await phone.enforcer.check()
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        return (rig, phone)
    }

    @Test(
        "Turned back on at iOS's prompt, in the class: focused again at once — the shields back on, the Screen Time off screen left — and the server told under the phone's order, its answer applied; no tap made, and a later revocation reported again"
    )
    func focusedAgain() async throws {
        let (rig, phone) = try await off()
        try await phone.enforcer.requestPermission()
        let now = await phone.until { $0.shielded }
        #expect(!now.permissionOff && now.until == session().endsAt)
        let state = await rig.engine.state
        #expect(state.standing == .inSession(session(), .focused) && state.reportedOff == nil)
        #expect(state.queued.map(\.change) == [.protectionOn(session: "s")])
        #expect(state.queued.first?.order != nil)
        try await rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .focused) }
        #expect(await rig.server.waiting.isEmpty)
        // Taken back again, it is a new revocation: reported again.
        await phone.screenTime.revokeUnseen()
        await phone.enforcer.check()
        #expect(try rig.outbox.records().map(\.change) == [.protectionOff(session: "s")])
        await phone.stop()
    }

    @Test(
        "Unlocked before Screen Time went off: still unlocked once it is back on — never relocked over the Emergency Unlock — at once and by the server's answer, its reason still changeable as before (A20; santa's round 1)"
    )
    func stillUnlocked() async throws {
        let (rig, phone) = try await off(unlocked: true)
        let shields = await phone.screenTime.shields
        try await phone.enforcer.requestPermission()
        await rig.until { $0.standing == .inSession(session(), .unlocked) }
        try await rig.server.next(protectionOnRoute).reply(
            200, Answer.protectionOn(state: "unlocked"))
        let state = await rig.until {
            $0.queued.isEmpty && $0.standing == .inSession(session(), .unlocked)
        }
        #expect(UnlockedWords(state)?.picker == .open(nil))
        let now = await phone.until { !$0.permissionOff }
        #expect(!now.shielded && now.until == nil)
        #expect(await phone.screenTime.shields == shields)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "Made once: a second Screen Time back on — a check that overlapped the first, both reading protection off before either recorded — finds the phone back where it stood and records nothing, never focus over the Emergency Unlock the first returned to (santa's round 1)"
    )
    func once() async throws {
        let (rig, phone) = try await off(unlocked: true)
        #expect(try await rig.engine.record(.protectionOn(session: "s")) != nil)
        #expect(try await rig.engine.record(.protectionOn(session: "s")) == nil)
        let state = await rig.engine.state
        #expect(state.standing == .inSession(session(), .unlocked))
        #expect(state.queued.map(\.change) == [.protectionOn(session: "s")])
        #expect(try rig.outbox.standing() == .inSession(session(), .unlocked))
        await phone.stop()
    }

    @Test(
        "Unlocked, and back on's answer late — protection off again by the server's truth: the next check's back on still returns to unlocked, where the phone stood before protection off, never focus over the Emergency Unlock (santa's round 1)"
    )
    func lateUnlocked() async throws {
        let (rig, phone) = try await off(unlocked: true)
        try await phone.enforcer.requestPermission()
        try await rig.server.next(protectionOnRoute).reply(
            200, Answer.replay(state: "protection_off"))
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        await phone.enforcer.check()
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        try await rig.server.next(protectionOnRoute).reply(
            200, Answer.protectionOn(state: "unlocked"))
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .unlocked) }
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "An Emergency Unlock made after a back on the server has yet to take — the truth then protection off again: the next back on returns to unlocked, that unlock the latest turn the server recorded, never focus over it (santa's round 2)"
    )
    func unlockedSince() async throws {
        let (rig, phone) = try await off()
        try await phone.enforcer.requestPermission()
        await rig.until { $0.standing == .inSession(session(), .focused) }
        let first = try await rig.server.next(protectionOnRoute)
        try await rig.engine.emergencyUnlock()
        first.reply(200, Answer.replay(state: "protection_off"))
        try await rig.server.next(unlockRoute).reply(200, Answer.unlockUnderOff())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        await phone.enforcer.check()
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        try await rig.server.next(protectionOnRoute).reply(
            200, Answer.protectionOn(state: "unlocked"))
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .unlocked) }
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "Where the phone stood before protection off not known — reported by the build before this one — back on passes the unlock guard: an Emergency Unlock still queued there keeps it unlocked (santa's round 1)"
    )
    func notKnown() async throws {
        let (outbox, url) = try makeOutbox()
        try record(outbox, .unlock(session: "s", reason: nil))
        try record(outbox, .protectionOff(session: "s"))
        try outbox.keep(.inSession(session(), .protectionOff))
        let rig = try Rig(outbox: try open(url))
        await rig.until { $0.standing == .inSession(session(), .protectionOff) }
        try await rig.engine.record(.protectionOn(session: "s"))
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        await rig.stop()
    }

    @Test(
        "Past the class's bell by the phone's clock, or out of a class, Screen Time back on changes nothing and sends nothing",
        arguments: [true, false])
    func overOrOut(over: Bool) async throws {
        let (rig, phone) = try await off()
        if over {
            rig.clock.advance(by: 3000)
        } else {
            // The server has the phone in no class.
            try await rig.foreground(Answer.me(nil))
            await rig.until { $0.standing == .out }
        }
        try await phone.enforcer.requestPermission()
        #expect(try rig.outbox.records().isEmpty)
        let standing: Standing = over ? .inSession(session(), .protectionOff) : .out
        #expect(await rig.engine.state.standing == standing)
        await phone.stop()
    }

    @Test(
        "A marker that does not read back proves nothing: no Screen Time back on over Family Controls' read alone — the Screen Time off screen keeps the re-tap as the way on"
    )
    func markerNotBack() async throws {
        let screenTime = FakeScreenTime(marked: true)
        let (rig, phone) = try await off(screenTime: screenTime)
        await screenTime.markerSticks(false)
        try await phone.enforcer.requestPermission()
        let now = await phone.until { $0.permission == .approved }
        #expect(try rig.outbox.records().isEmpty)
        let state = await rig.engine.state
        #expect(ProtectionOffWords(state, now)?.way == .retap)
        await phone.stop()
    }

    @Test(
        "Relaunched in protection off, access turned back on at iOS's prompt before Bali closed: its first check puts it back where it stood — unlocked, as the file kept it — after the report still queued"
    )
    func relaunched() async throws {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(session(), .unlocked))
        try record(outbox, .protectionOff(session: "s"))
        try outbox.keep(.inSession(session(), .protectionOff))
        let phone = Enforced(try Rig(outbox: try open(url)), FakeScreenTime(marked: true))
        let rig = phone.rig
        await phone.until { $0.checked }
        await phone.enforcer.check()
        await rig.until { $0.standing == .inSession(session(), .unlocked) }
        #expect(
            try rig.outbox.records().map(\.change) == [
                .protectionOff(session: "s"), .protectionOn(session: "s"),
            ])
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        // The report's answer is older than the phone's truth: it holds until back on's comes.
        try await rig.server.next(protectionOnRoute).reply(
            200, Answer.protectionOn(state: "unlocked"))
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .unlocked) }
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "Refused — protection no longer off on the server, a re-tap having left it — it is dropped and the truth read again, never sent again; and a late answer, a later protection off on record, is applied and made good at the next check"
    )
    func refusedOrLate() async throws {
        let (rig, phone) = try await off()
        try await phone.enforcer.requestPermission()
        try await rig.server.next(protectionOnRoute).reply(409, Answer.refused("protection_not_off"))
        try await rig.server.next(meRoute).reply(200, Answer.me())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .focused) }
        #expect(await rig.engine.state.refused?.change == .protectionOn(session: "s"))
        // Off again, and back on — the server holding a protection off of the phone's made after
        // it: answered as its retry is, the truth now, which the next check makes good.
        await phone.screenTime.revokeUnseen()
        await phone.enforcer.check()
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        try await phone.enforcer.requestPermission()
        try await rig.server.next(protectionOnRoute).reply(
            200, Answer.replay(state: "protection_off"))
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff) }
        await phone.enforcer.check()
        try await rig.server.next(protectionOnRoute).reply(200, Answer.protectionOn())
        await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .focused) }
        await phone.stop()
    }
}

@Suite(
    "#145: a launch's not determined, no marker written yet — off once it lasts the grace, read again every second meanwhile; never over an approved phone settling within it — and the marker deciding at once",
    .timeLimit(.minutes(3)))
struct LaunchGraceTests {
    /// A relaunch standing as `standing` — the store holding the last run's shields in a session —
    /// on a phone with no marker written yet (F1b), Family Controls reading not determined, access
    /// taken back (`off`) or approved all along, and the check made as Bali comes to the front: the
    /// grace begun, the engine behind, so no wake of its checks.
    func launched(_ standing: Standing, off: Bool) async throws -> Enforced {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(standing)
        let screenTime = FakeScreenTime()
        if case .inSession = standing { await screenTime.held() }
        await screenTime.reads(.notDetermined)
        if off { await screenTime.revokeUnseen() }
        let phone = Enforced(try Rig(outbox: try open(url)), screenTime)
        await phone.until { $0.checked }
        await phone.enforcer.check()
        return phone
    }

    /// The clock moved on a second at a time, `count` times, each the grace's next check due there
    /// first — made again a second after the last.
    func seconds(_ count: Int, _ rig: Rig) async throws {
        for _ in 0..<count {
            let due = rig.clock.now().addingTimeInterval(Enforcer.recheckAfter)
            try await eventually { rig.clock.deadlines.contains(due) }
            rig.clock.advance(by: Enforcer.recheckAfter)
        }
    }

    @Test(
        "F1b: the marker decides a launch at once, whatever Family Controls reads — gone, its flag set: off at the first pass and reported at the first check, no grace waited out; there: approved at the first pass, never 'Checking Screen Time…' — and nothing read again every second (#145)",
        arguments: [true, false])
    func markerAtLaunch(gone: Bool) async throws {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(session(), .focused))
        let screenTime = FakeScreenTime(marked: true)
        await screenTime.held()
        await screenTime.reads(.notDetermined)
        if gone { await screenTime.revokeUnseen() }
        let phone = Enforced(try Rig(outbox: try open(url)), screenTime)
        let first = await phone.until { $0.checked }
        #expect(first.permissionOff == gone && first.shielded == !gone)
        #expect(first.permission == (gone ? .notDetermined : .approved))
        await phone.enforcer.check()
        let queued = try phone.rig.outbox.records().map(\.change)
        #expect(queued == (gone ? [.protectionOff(session: "s")] : []))
        try await phone.rig.sleeping(gone ? [] : [session().endsAt])
        #expect(await screenTime.asks == 0)
        await phone.stop()
    }

    @Test(
        "Access off at a launch: Family Controls reads not determined, read again every second by the enforcer alone — no wake of the engine's — and judged off once that lasts the grace: protection off reported then, the screen saying Screen Time is off; a second sooner, nothing"
    )
    func offWithinGrace() async throws {
        let phone = try await launched(.inSession(session(), .focused), off: true)
        let rig = phone.rig
        try await seconds(Int(Enforcer.grace) - 1, rig)
        // The check a second before the grace's end made — its next due at the end: nothing yet.
        try await eventually { rig.clock.deadlines.contains(at(Enforcer.grace)) }
        #expect(try rig.outbox.records().isEmpty)
        #expect(await !phone.enforcer.protection.permissionOff)
        // Never asked silently over a read of not determined: iOS would prompt.
        #expect(await phone.screenTime.asks == 0)
        rig.clock.advance(by: Enforcer.recheckAfter)
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        let claim = await phone.until { $0.permissionOff }
        #expect(claim.permission == .notDetermined && !claim.shielded)
        let state = await rig.until {
            $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff)
        }
        #expect(ProtectionOffWords(state, claim)?.way == .ask)
        // Judged off, nothing is read every second: the engine's wakes check from here.
        try await rig.sleeping([])
        await phone.stop()
    }

    @Test(
        "A check judged a moment before the grace's end, its pass ending past it, is still made again a second on: the report follows the claim of Screen Time off, never left to the engine's next wake (santa's round 1)"
    )
    func passCrossesGrace() async throws {
        let phone = try await launched(.inSession(session(), .focused), off: true)
        let rig = phone.rig
        try await seconds(Int(Enforcer.grace) - 2, rig)
        // The check a second before the grace's end, held in its pass at its second read of the
        // store while the grace runs out.
        try await eventually { rig.clock.deadlines.contains(at(Enforcer.grace - 1)) }
        await phone.screenTime.hold(after: 1)
        rig.clock.advance(by: Enforcer.recheckAfter)
        try await eventually { await phone.screenTime.holding }
        rig.clock.advance(by: Enforcer.recheckAfter)
        await phone.screenTime.release()
        await phone.until { $0.permissionOff }
        try await eventually { rig.clock.deadlines.contains(at(Enforcer.grace + 1)) }
        rig.clock.advance(by: Enforcer.recheckAfter)
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        await rig.until {
            $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff)
        }
        await phone.stop()
    }

    @Test(
        "An approved phone whose read is not determined for a moment after a launch reads approved the second iOS settles — read again every second, not at the next wake — and no claim ever judges it off: nothing reported in a session, and out of one the phone's flag stays, so not determined routes as approved, never to the Screen Time screen (C1b)",
        arguments: [Standing.inSession(session(), .focused), .out])
    func settles(standing: Standing) async throws {
        let phone = try await launched(standing, off: false)
        let rig = phone.rig
        let claims = Task {
            var seen: [Protection] = []
            for await claim in await phone.enforcer.updates() { seen.append(claim) }
            return seen
        }
        try await seconds(2, rig)
        // iOS settles between 2 and 3 s: the check made at 3 s reads it.
        try await eventually { rig.clock.deadlines.contains(at(3)) }
        await phone.screenTime.reads(.approved)
        rig.clock.advance(by: Enforcer.recheckAfter)
        let now = await phone.until { $0.permission == .approved }
        #expect(now.shielded == (standing != .out) && !now.permissionOff)
        // Settled, nothing is read every second — and long past the grace, nothing reported.
        try await rig.sleeping(standing == .out ? [] : [session().endsAt])
        rig.clock.advance(by: 60)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        claims.cancel()
        let sync = await rig.engine.state
        for claim in await claims.value where claim.checked {
            #expect(!claim.permissionOff)
            let shown = Screen.choose(
                problem: nil, introSeen: true, signedIn: true, protection: claim,
                everApproved: true, everInClass: true, sync: sync, hasClasses: true,
                sessionOverClosed: nil, opened: [], tab: .home, now: rig.clock.now())
            #expect(shown.screen == (standing == .out ? .home : .focus))
        }
        await phone.stop()
    }
}

@Suite("The engine keeps its standing, and runs rule 3's check", .timeLimit(.minutes(3)))
struct StandingKeptTests {
    @Test("The standing is kept in the outbox file as it changes — a state this build does not know kept as none")
    func kept() async throws {
        let rig = try Rig()
        #expect(try rig.outbox.standing() == .out)
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting }
        #expect(try rig.outbox.standing() == .waiting)
        try await rig.tapIn()
        #expect(try rig.outbox.standing() == .inSession(session(), .focused))
        try await rig.foreground(Answer.me(session(endsAt: 4000), state: "on_a_break"))
        #expect(try rig.outbox.standing() == .inSession(session(endsAt: 4000), nil))
        await rig.stop()
    }

    @Test(
        "The standing is kept in a form of its own, pinned: each standing as this build writes it, and as every later build must read it — never the enum's own coding"
    )
    func keptForm() throws {
        let view = session(endsAt: 1200)
        let (ends, id) = (iso(view.endsAt), #""sessionId":"s","classId":"c""#)
        let inSession = #""standing":"in_session",\#(id),"endsAt":"\#(ends)""#
        let forms: [(Standing, String)] = [
            (.out, #"{"standing":"out"}"#), (.waiting, #"{"standing":"waiting"}"#),
            (.inSession(view, .focused), #"{\#(inSession),"state":"focused"}"#),
            (.inSession(view, .unlocked), #"{\#(inSession),"state":"unlocked"}"#),
            (.inSession(view, .protectionOff), #"{\#(inSession),"state":"protection_off"}"#),
            (.inSession(view, nil), "{\(inSession)}"),
        ]
        func json(_ text: String) throws -> JSONValue {
            try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        }
        func read(_ text: String) throws -> Standing {
            try BaliJSON.makeDecoder().decode(Standing.self, from: Data(text.utf8))
        }
        for (standing, form) in forms {
            let written = try BaliJSON.makeEncoder().encode(standing)
            #expect(try json(String(decoding: written, as: UTF8.self)) == json(form), "\(form)")
            #expect(try read(form) == standing)
        }
        // A key a later build adds is passed over, and a state it adds is none, never focus.
        let later = #"{\#(inSession),"state":"on_a_break","startsAt":"x"}"#
        #expect(try read(later) == .inSession(view, nil))
        // Where the phone stands unread is never written over the file's truth.
        #expect(throws: EncodingError.self) { try BaliJSON.makeEncoder().encode(Standing.unread) }
    }

    @Test(
        "The phone's own change and the standing it leaves are kept in one write: killed at any moment after an Emergency Unlock, a relaunch never shields over it",
        arguments: [
            (Change.unlock(session: "s", reason: nil), ParticipationState.unlocked),
            (.protectionOff(session: "s"), .protectionOff),
        ])
    func keptWithItsStanding(change: Change, state: ParticipationState) async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.tapIn()
        let relaunches = try Relaunches(url)
        outbox.pool.add(transactionObserver: relaunches, extent: .observerLifetime)
        let record = try #require(try await rig.engine.record(change))
        outbox.pool.remove(transactionObserver: relaunches)
        var holding: [SyncState] = []
        for engine in relaunches.engines {
            let relaunched = await engine.state
            if relaunched.queued.contains(where: { $0.eventId == record.eventId }) {
                holding.append(relaunched)
            }
        }
        #expect(!holding.isEmpty)
        for relaunched in holding {
            #expect(relaunched.standing == .inSession(session(), state))
            #expect(relaunched.shieldedUntil(t0) == nil)
        }
        await rig.stop()
    }

    @Test(
        "A standing the file would not give back at launch is never taken off from nothing: the shields stay, nothing is written over it, and it is read again within a minute"
    )
    func unread() async throws {
        let (phone, kept) = try await unreadable()
        let rig = phone.rig
        var now = await phone.enforcer.protection
        #expect(now.shielded && now.until == nil)
        #expect(await phone.screenTime.unshields == 0)
        let state = await rig.engine.state
        #expect(state.standing == .unread && state.link == .storageFailed)
        // The next change of state writes nothing over it: a read of the truth, unanswered.
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(nil)
        await rig.until { $0.link == .unreachable }
        #expect(try keptStanding(rig.outbox) == "spoiled")
        // Readable again: read within a minute, and followed — the shields kept to its end.
        try rig.outbox.keep(kept)
        try await rig.sleeping([at(60)])
        rig.clock.advance(by: 60)
        now = await phone.until { $0.until == at(1200) }
        #expect(now.shielded)
        #expect(await phone.screenTime.unshields == 0)
        // …and kept again as it changes.
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        #expect(try rig.outbox.standing() == .inSession(session(endsAt: 1200), .unlocked))
        await phone.stop()
    }

    @Test(
        "A standing the file cannot give back is settled by the server's truth too: the phone is never stranded behind it"
    )
    func unreadSettled() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        // The class ended while the app was closed: the server has the phone in no session.
        try await rig.foreground(Answer.me(nil))
        await phone.until { !$0.shielded }
        #expect(await rig.engine.state.standing == .out)
        #expect(try rig.outbox.standing() == .out)
        await phone.stop()
    }

    @Test(
        "Over a standing not read, a tap answered armed asks the server where the phone stands — arming ends nothing — and never takes the shields off"
    )
    func unreadArmed() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        try await rig.engine.record(.tap(tagId: "another teacher's"))
        await phone.until { $0.until == at(SyncState.tapCap) }
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await phone.until { $0.until == nil }
        try #require(await phone.screenTime.unshields == 0)
        #expect(await rig.engine.state.standing == .unread)
        try await rig.server.next(meRoute).reply(200, Answer.me(session(endsAt: 1200)))
        await phone.until { $0.until == at(1200) }
        #expect(await phone.screenTime.shielding)
        #expect(await phone.screenTime.unshields == 0)
        // Known now, the standing carries the truth itself, as it would have without the gap: a
        // read naming no session later leaves the phone out.
        rig.clock.advance(by: 1)
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.standing == .out }
        await phone.stop()
    }

    @Test(
        "Over a standing not read, a tap answered armed leaves the phone waiting when the read of the truth it asks for names no session"
    )
    func unreadArmedOut() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        let state = await rig.until { $0.standing != .unread }
        #expect(state.standing == .waiting)
        #expect(try rig.outbox.standing() == .waiting)
        await phone.stop()
    }

    @Test(
        "…and when the file gives back where the phone stood before that read comes, the arming is carried onto it: out becomes waiting"
    )
    func unreadArmedFileBack() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        try await rig.engine.record(.tap(tagId: "tag"))
        let tap = try await rig.server.next(tapRoute)
        // Readable again: the phone was in no session.
        try rig.outbox.keep(.out)
        tap.reply(200, Answer.armed)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.standing == .waiting }
        #expect(try rig.outbox.standing() == .waiting)
        await phone.stop()
    }

    @Test(
        "Over a standing not read, the shields a tap not yet answered put on come off at decision 7's cap — the enforcer's own, not enforcement from nothing"
    )
    func unreadCapped() async throws {
        let (phone, _) = try await unreadable(held: false)
        let rig = phone.rig
        // Offline: the tap is never answered.
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.shielded && $0.until == at(SyncState.tapCap) }
        try await rig.server.next(tapRoute).reply(nil)
        rig.clock.advance(by: SyncState.tapCap)
        await phone.until { !$0.shielded }
        #expect(await !phone.screenTime.shielding)
        #expect(await rig.engine.state.standing == .unread)
        await phone.stop()
    }

    @Test(
        "Over a standing not read, the last run's shields — a session's, perhaps still running — are never taken off at the cap of a tap not yet answered: only where the phone stood, once known, takes them off (#91's review)"
    )
    func unreadCappedOverHeld() async throws {
        // Where the phone stood, unread: focused in a session ending ten minutes after the cap.
        let (phone, kept) = try await unreadable(endsAt: SyncState.tapCap + 600)
        let rig = phone.rig
        // Offline: the tap is never answered.
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.until == at(SyncState.tapCap) }
        try await rig.server.next(tapRoute).reply(nil)
        await rig.until { $0.retryAt == at(2) }
        rig.clock.advance(by: SyncState.tapCap)
        await phone.until { $0.until == nil }
        #expect(await phone.screenTime.shielding)
        #expect(await phone.screenTime.unshields == 0)
        // Read again, the file says the session still runs: its shields stay to its bell.
        try rig.outbox.keep(kept)
        try await eventually { rig.clock.deadlines.contains(at(SyncState.tapCap + 60)) }
        rig.clock.advance(by: 60)
        await phone.until { $0.until == at(SyncState.tapCap + 600) && $0.shielded }
        #expect(await phone.screenTime.unshields == 0)
        rig.clock.advance(by: 540)
        await phone.until { !$0.shielded }
        await phone.stop()
    }

    @Test(
        "Rule 3's check runs at each wake of the read loop in the foreground, in a session — the read of the truth coming back makes, and each check-in — never behind the app"
    )
    func checkAtEachWake() async throws {
        final class Count: @unchecked Sendable {
            private let lock = NSLock()
            private var count = 0
            func add() { lock.withLock { count += 1 } }
            var value: Int { lock.withLock { count } }
        }
        let checks = Count()
        let rig = try Rig()
        await rig.engine.atEachWake { checks.add() }
        try await rig.tapIn()
        #expect(checks.value == 0)
        try await rig.foreground()
        #expect(checks.value == 1)
        rig.clock.advance(by: 30)
        let checkIn = try await rig.server.next(checkInRoute)
        #expect(checks.value == 2)
        checkIn.reply(200, Answer.live())
        try await rig.sleeping([at(60)])
        await rig.engine.setForeground(false)
        rig.clock.advance(by: 60)
        try await rig.sleeping([])
        #expect(checks.value == 2)
        await rig.stop()
    }
}
