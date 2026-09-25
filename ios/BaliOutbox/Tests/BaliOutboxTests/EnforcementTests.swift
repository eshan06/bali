import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

let protectionOffRoute = "POST /v1/sessions/s/protection-off"

extension Answer {
    static func protectionOff(_ view: SessionView = session()) -> String {
        #"{"outcome":"applied","recordedAs":null,"state":"protection_off","session":\#(json(view))}"#
    }
}

/// Screen Time as a test holds it: the store's shields and the permission, which the test changes
/// behind the enforcer's back, as iOS or the student would.
actor FakeScreenTime: ScreenTime {
    private(set) var shielding = false
    private(set) var granted = Permission.approved
    private(set) var unshields = 0
    /// Reads of the store to let through before the one held (`hold(after:)`); nil: none held.
    private var through: Int?
    private var parked: CheckedContinuation<Void, Never>?

    func isShielding() async -> Bool {
        if let left = through {
            through = left > 0 ? left - 1 : nil
            if left == 0 { await withCheckedContinuation { parked = $0 } }
        }
        return shielding
    }
    func shield() { shielding = true }
    func unshield() {
        shielding = false
        unshields += 1
    }
    func permission() -> Permission { granted }
    func requestPermission() { granted = .approved }

    /// The student changes the permission in Settings: iOS drops every shield when it goes.
    func set(_ permission: Permission) {
        granted = permission
        if permission != .approved { shielding = false }
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
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
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
        try await rig.tapIn()
        try await rig.foreground()
        await phone.until { $0.shielded }
        // The app comes to the foreground, twice in a second: each checks at once.
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        rig.clock.advance(by: 1)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
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
        "Never granted — not determined at two checks a check-in apart — is reported, once: a phone that cannot shield is never shown focused"
    )
    func notDeterminedLasting() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.notDetermined)
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        try await rig.foreground()
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        #expect(try rig.outbox.records().isEmpty)
        try await rig.checkInDue(at(60))
        rig.clock.advance(by: 30)
        try await rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        await rig.until {
            $0.queued.isEmpty && $0.standing == .inSession(session(), .protectionOff)
        }
        try await rig.checkInDue(at(90))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(state: "protection_off"))
        try await rig.sleeping([at(120)])
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
        "A clock turned back between the checks starts the run again rather than stalling it: never granted is still reported, a check-in later"
    )
    func notDeterminedClockBack() async throws {
        let rig = try Rig()
        let screenTime = FakeScreenTime()
        await screenTime.set(.notDetermined)
        let phone = Enforced(rig, screenTime)
        try await rig.tapIn()
        await phone.enforcer.check()
        // The student turns the phone's clock back ten minutes.
        rig.clock.advance(by: -600)
        await phone.enforcer.check()
        #expect(try rig.outbox.records().isEmpty)
        rig.clock.advance(by: 30)
        await phone.enforcer.check()
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

    /// A relaunch over a file that holds where the phone stood — focused until 1200 — in a form
    /// this build cannot read, the shields still on in the store: the engine and its enforcer.
    func unreadable() async throws -> (Enforced, Standing) {
        let (outbox, _) = try makeOutbox()
        let kept = Standing.inSession(session(endsAt: 1200), .focused)
        try outbox.keep(kept)
        try spoilStanding(outbox)
        let screenTime = FakeScreenTime()
        await screenTime.held()
        let phone = Enforced(try Rig(outbox: outbox), screenTime)
        await phone.until { $0.permission == .approved }
        return (phone, kept)
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
        await phone.stop()
    }

    @Test("Rule 3's check runs before each check-in — not for the foreground's read, nor behind the app")
    func checkBeforeCheckIn() async throws {
        final class Count: @unchecked Sendable {
            private let lock = NSLock()
            private var count = 0
            func add() { lock.withLock { count += 1 } }
            var value: Int { lock.withLock { count } }
        }
        let checks = Count()
        let rig = try Rig()
        await rig.engine.beforeEachCheckIn { checks.add() }
        try await rig.tapIn()
        try await rig.foreground()
        #expect(checks.value == 0)
        rig.clock.advance(by: 30)
        let checkIn = try await rig.server.next(checkInRoute)
        #expect(checks.value == 1)
        checkIn.reply(200, Answer.live())
        try await rig.sleeping([at(60)])
        await rig.engine.setForeground(false)
        rig.clock.advance(by: 60)
        try await rig.sleeping([])
        #expect(checks.value == 1)
        await rig.stop()
    }
}
