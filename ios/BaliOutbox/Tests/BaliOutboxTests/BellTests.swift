import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// `seconds` since 1970 — `t0` is 20 s past a whole minute.
private func minuteOf(_ date: Date) -> Double {
    date.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
}

@Suite("The window iOS wakes the monitor at (B5b)")
struct WindowTests {
    @Test(
        "It ends at the first whole minute at or after the shields' end — never before it, and less than a minute after — and it is exactly iOS's floor long"
    )
    func ends() {
        #expect(minuteOf(t0) == 20)
        for until in [at(40), at(40.001), at(99), at(100), at(1200.5), at(3000)] {
            let window = Bell.window(until: until)
            #expect(window.end >= until && window.end < until + 60, "\(until)")
            #expect(minuteOf(window.end) == 0, "\(until)")
            #expect(window.duration == Bell.floor && Bell.floor == 15 * 60, "\(until)")
        }
        #expect(Bell.window(until: at(40)).end == at(40))
        #expect(Bell.window(until: at(41)).end == at(100))
    }

    @Test(
        "A window shorter than the floor — a tap in a session's last ten minutes — keeps its end, and starts in the past; a longer one starts the floor before its end"
    )
    func floor() {
        let short = Bell.window(until: at(600))
        #expect(short.end == at(640) && short.start == at(-260) && short.start < t0)
        let long = Bell.window(until: at(3000))
        #expect(long.end == at(3040) && long.start == at(2140) && long.start > t0)
    }
}

@Suite("The monitor's wake: the shields off when nothing keeps them on, by the phone's clock (B5b)")
struct WakeTests {
    /// Where the phone stood, and what it did — at `t0` — as the monitor reads them from the file.
    func kept(_ standing: Standing, _ changes: [Change] = []) throws -> SyncState {
        let (outbox, _) = try makeOutbox()
        for change in changes { try record(outbox, change) }
        var state = SyncState()
        (state.standing, state.queued) = (standing, try outbox.records())
        return state
    }

    func wake(_ state: SyncState, at now: Date) -> Bell.Wake { Bell.wake(now: now) { state } }

    @Test(
        "Focused in a session: kept to its bell, and cleared from the bell on — a wake early by less than a minute asks for a window a minute on, never the one that woke it, which iOS may hold still"
    )
    func bell() throws {
        let state = try kept(.inSession(session(endsAt: 1200), .focused))
        #expect(wake(state, at: t0) == .keep(Bell.window(until: at(1200))))
        #expect(wake(state, at: at(1100)) == .keep(Bell.window(until: at(1200))))
        let early = wake(state, at: at(1199.9))
        #expect(early == .keep(Bell.window(until: at(1259.9))))
        #expect(early != .keep(Bell.window(until: at(1200))))
        #expect(wake(state, at: at(1200)) == .clear)
        #expect(wake(state, at: at(1300)) == .clear)
    }

    @Test("Unlocked, protection off, a state this build does not know, waiting or out: cleared")
    func nothingKeeps() throws {
        let standings: [Standing] = [
            .inSession(session(endsAt: 1200), .unlocked),
            .inSession(session(endsAt: 1200), .protectionOff), .inSession(session(endsAt: 1200), nil),
            .waiting, .out,
        ]
        for standing in standings { #expect(wake(try kept(standing), at: t0) == .clear, "\(standing)") }
    }

    @Test(
        "A tap not yet answered — force-quit offline — is kept to decision 7's cap, then cleared; beside a bell, to the later of the two"
    )
    func cap() throws {
        let tapped = try kept(.out, [.tap(tagId: "tag")])
        #expect(wake(tapped, at: at(1200)) == .keep(Bell.window(until: at(SyncState.tapCap))))
        #expect(wake(tapped, at: at(SyncState.tapCap)) == .clear)
        let both = try kept(.inSession(session(endsAt: 1200), .focused), [.tap(tagId: "tag")])
        #expect(wake(both, at: at(1200)) == .keep(Bell.window(until: at(SyncState.tapCap))))
        #expect(wake(both, at: at(SyncState.tapCap)) == .clear)
    }

    @Test(
        "An unlock after the tap (decision 11) or a refused tap keeps nothing on; a device check's shorter cap is the one kept to"
    )
    func capEnds() throws {
        let unlocked = try kept(.out, [.tap(tagId: "tag"), .unlock(session: "s", reason: nil)])
        #expect(wake(unlocked, at: t0) == .clear)
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try outbox.pool.write {
            try $0.execute(sql: "UPDATE outbox SET stuck = 1 WHERE eventId = ?", arguments: [tap.eventId])
        }
        var stuck = SyncState()
        stuck.queued = try outbox.records()
        #expect(wake(stuck, at: t0) == .clear)
        var check = try kept(.out, [.tap(tagId: "tag")])
        check.cap = Bell.floor
        #expect(wake(check, at: t0) == .keep(Bell.window(until: at(Bell.floor))))
        #expect(wake(check, at: at(Bell.floor)) == .clear)
    }

    @Test(
        "The file not read in time — busy, or unreadable — keeps the shields: nothing is cleared over what cannot be read, and the monitor is woken a minute on to try again"
    )
    func unread() {
        struct Unreadable: Error {}
        #expect(Bell.wake(now: t0) { throw Unreadable() } == .retry(Bell.window(until: at(60))))
        #expect(Bell.wake(now: t0) { throw Outbox.Busy() } == .retry(Bell.window(until: at(60))))
        #expect(Bell.retry == 60)
    }
}

@Suite("The monitor reads the file the app keeps (B5b)", .timeLimit(.minutes(3)))
struct MonitorFileTests {
    @Test("From the app's own file after a force-quit: kept to the bell, cleared at it")
    func bell() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.tapIn(session(endsAt: 1200))
        await rig.stop()
        #expect(Bell.wake(outboxAt: url, now: at(600)) == .keep(Bell.window(until: at(1200))))
        #expect(Bell.wake(outboxAt: url, now: at(1200)) == .clear)
    }

    @Test(
        "A tap offline, force-quit before its answer: kept to the cap — the device check's, when the monitor is given it — and cleared at it"
    )
    func cap() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(nil)
        await rig.stop()
        let cap = at(SyncState.tapCap)
        #expect(Bell.wake(outboxAt: url, now: cap - 600) == .keep(Bell.window(until: cap)))
        #expect(Bell.wake(outboxAt: url, now: cap) == .clear)
        #expect(
            Bell.wake(outboxAt: url, now: at(300), cap: Bell.floor)
                == .keep(Bell.window(until: at(Bell.floor))))
        #expect(Bell.wake(outboxAt: url, now: at(Bell.floor), cap: Bell.floor) == .clear)
    }

    @Test(
        "A standing the file cannot give back, or a file a newer build migrated, keeps the shields and tries again a minute on"
    )
    func unreadable() throws {
        let (spoiled, spoiledURL) = try makeOutbox()
        try spoiled.keep(.inSession(session(endsAt: 1200), .focused))
        try spoilStanding(spoiled)
        #expect(Bell.wake(outboxAt: spoiledURL, now: at(1300)) == .retry(Bell.window(until: at(1360))))
        let (newer, newerURL) = try makeOutbox()
        try newer.pool.write {
            try $0.execute(sql: "INSERT INTO grdb_migrations (identifier) VALUES ('v99')")
        }
        #expect(Bell.wake(outboxAt: newerURL, now: at(1300)) == .retry(Bell.window(until: at(1360))))
    }

    #if os(Linux)
        @Test(
            "The monitor closes the file before its wake returns — iOS may suspend it at once, and a lock held then kills it"
        )
        func closed() throws {
            let (outbox, url) = try makeOutbox()
            try outbox.keep(.inSession(session(endsAt: 1200), .focused))
            try outbox.pool.close()
            let path = url.path(percentEncoded: false)
            func descriptors() throws -> Int {
                try FileManager.default.contentsOfDirectory(atPath: "/proc/self/fd").count {
                    let link = try? FileManager.default.destinationOfSymbolicLink(
                        atPath: "/proc/self/fd/\($0)")
                    return link?.hasPrefix(path) == true
                }
            }
            #expect(try descriptors() == 0)
            #expect(Bell.wake(outboxAt: url, now: t0) == .keep(Bell.window(until: at(1200))))
            #expect(try descriptors() == 0)
        }
    #endif
}

@Suite("The monitor's open waits for the file at most its bound (B5b)", .timeLimit(.minutes(3)))
struct BoundTests {
    /// Access another process may hold, as a test plays it: granted at once, or when the test says.
    final class Asking: @unchecked Sendable {
        private let lock = NSLock()
        private let atOnce: Bool
        private let asked = DispatchSemaphore(value: 0)
        private var waiting: (@Sendable ((any Error)?) -> Void)?
        private var cancels = 0
        private var opens = 0

        init(atOnce: Bool) { self.atOnce = atOnce }

        var cancelled: Bool { lock.withLock { cancels > 0 } }
        var opened: Int { lock.withLock { opens } }

        func request(_ granted: @escaping @Sendable ((any Error)?) -> Void) {
            guard !atOnce else { return granted(nil) }
            lock.withLock { waiting = granted }
            asked.signal()
        }
        func cancel() { lock.withLock { cancels += 1 } }
        /// Grants the access asked for — or ends the asking with `failure` — here and now.
        func grant(_ failure: (any Error)? = nil) {
            let granted = lock.withLock {
                defer { waiting = nil }
                return waiting
            }
            granted?(failure)
        }
        /// …or as NSFileCoordinator would: on a thread of its own, once asked, `delay` seconds on.
        func grant(after delay: TimeInterval, _ failure: (any Error)? = nil) {
            Thread.detachNewThread { [self] in
                asked.wait()
                Thread.sleep(forTimeInterval: delay)
                grant(failure)
            }
        }
        func open() -> Int {
            lock.withLock { opens += 1 }
            return 7
        }
        func granted(within bound: TimeInterval?) throws -> Int {
            try Outbox.granted(within: bound, request: request, cancel: cancel) { self.open() }
        }
    }

    @Test("Free, the file opens at once")
    func free() throws {
        let asking = Asking(atOnce: true)
        #expect(try asking.granted(within: 1) == 7)
        #expect(asking.opened == 1 && !asking.cancelled)
    }

    @Test(
        "Held past the bound: `Busy` — the asking cancelled, nothing opened — and a grant that comes after opens nothing"
    )
    func held() throws {
        let asking = Asking(atOnce: false)
        let start = ContinuousClock.now
        #expect(throws: Outbox.Busy.self) { try asking.granted(within: 0.2) }
        #expect(ContinuousClock.now - start >= .milliseconds(200))
        #expect(asking.cancelled && asking.opened == 0)
        asking.grant()
        #expect(asking.opened == 0)
    }

    @Test(
        "An open already under way at the bound is waited for, never left running: returning then would leave the file locked behind a monitor iOS may suspend"
    )
    func underWay() throws {
        let (began, finish) = (DispatchSemaphore(value: 0), DispatchSemaphore(value: 0))
        // Long enough that the grant, on a thread of its own, comes well inside it, even loaded.
        let bound: TimeInterval = 2
        Thread.detachNewThread {
            began.wait()
            Thread.sleep(forTimeInterval: bound + 0.5)
            finish.signal()
        }
        let value = try Outbox.granted(
            within: bound, request: { granted in Thread.detachNewThread { granted(nil) } },
            cancel: { Issue.record("an open under way was cancelled") }
        ) {
            began.signal()
            finish.wait()
            return 7
        }
        #expect(value == 7)
    }

    @Test("Unbounded — the app's own open — it waits as long as the file takes")
    func unbounded() throws {
        let asking = Asking(atOnce: false)
        asking.grant(after: 0.3)
        #expect(try asking.granted(within: nil) == 7)
        #expect(!asking.cancelled)
    }

    @Test("The asking ended with an error: that error, and nothing opened")
    func failed() throws {
        struct Refused: Error {}
        let asking = Asking(atOnce: false)
        asking.grant(after: 0, Refused())
        #expect(throws: Refused.self) { try asking.granted(within: nil) }
        #expect(asking.opened == 0)
    }

    #if canImport(Darwin)
        @Test(
            "On the phone, a file another process holds through NSFileCoordinator is waited on at most the bound: `Busy`, and the monitor keeps the shields"
        )
        func coordinator() throws {
            let (_, url) = try makeOutbox()
            let (holding, release) = (DispatchSemaphore(value: 0), DispatchSemaphore(value: 0))
            DispatchQueue.global().async {
                var failure: NSError?
                NSFileCoordinator(filePresenter: nil).coordinate(
                    writingItemAt: url, options: .forMerging, error: &failure
                ) { _ in
                    holding.signal()
                    release.wait()
                }
            }
            holding.wait()
            defer { release.signal() }
            #expect(throws: Outbox.Busy.self) {
                try Outbox(at: url, random: { 0 }, suspends: false, within: 1)
            }
            #expect(Bell.wake(outboxAt: url, now: t0) == .retry(Bell.window(until: at(60))))
        }
    #endif
}

@Suite("The window registered, as the shields' end moves (B5b)", .timeLimit(.minutes(3)))
struct ScheduleTests {
    @Test("A tap registers its cap's window at once; its answer moves it to the bell; the bell cancels it")
    func tapToBell() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 1200)
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.shielded }
        #expect(await phone.screenTime.registered == Bell.window(until: at(SyncState.tapCap)))
        try await rig.server.next(tapRoute).reply(200, Answer.joined(view))
        await phone.until { $0.until == view.endsAt }
        #expect(await phone.screenTime.registered == Bell.window(until: view.endsAt))
        rig.clock.advance(by: 1200)
        await phone.until { !$0.shielded }
        #expect(
            await phone.screenTime.windows == [
                Bell.window(until: at(SyncState.tapCap)), Bell.window(until: view.endsAt), nil,
            ])
        await phone.stop()
    }

    @Test("Emergency Unlock cancels the window; a refocus registers it again")
    func unlock() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn(session(endsAt: 1200))
        await phone.until { $0.until == at(1200) }
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        await phone.until { !$0.shielded }
        #expect(await phone.screenTime.windows.last == .some(nil))
        try await rig.engine.record(.refocus(session: "s"))
        await phone.until { $0.shielded }
        #expect(await phone.screenTime.registered == Bell.window(until: at(1200)))
        await phone.stop()
    }

    @Test(
        "An extension the check-in brings, or a re-tap, moves the window: to the new bell, or to the later of the bell and the tap's cap"
    )
    func moves() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn(session(endsAt: 1200))
        try await rig.foreground(Answer.me(session(endsAt: 1200)))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt: 1800)))
        await phone.until { $0.until == at(1800) }
        #expect(await phone.screenTime.registered == Bell.window(until: at(1800)))
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.until == at(30 + SyncState.tapCap) }
        #expect(await phone.screenTime.registered == Bell.window(until: at(30 + SyncState.tapCap)))
        await phone.stop()
    }

    @Test(
        "A relaunch registers the window again from the standing kept; a device check's cap is the one registered for a tap"
    )
    func relaunchAndCap() async throws {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(session(endsAt: 1200), .focused))
        let screenTime = FakeScreenTime()
        await screenTime.held()
        let relaunched = Enforced(try Rig(outbox: try open(url)), screenTime)
        await relaunched.until { $0.until == at(1200) }
        #expect(await screenTime.registered == Bell.window(until: at(1200)))
        await relaunched.stop()
        let rig = try Rig()
        let phone = Enforced(rig)
        await rig.engine.setTapCap(Bell.floor)
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.until == at(Bell.floor) }
        #expect(await phone.screenTime.registered == Bell.window(until: at(Bell.floor)))
        await rig.engine.setTapCap(nil)
        await phone.until { $0.until == at(SyncState.tapCap) }
        await phone.stop()
    }

    @Test(
        "A window iOS refuses is shown, and asked for again at the next pass until it takes — the one iOS still holds too, so the claim is never left saying otherwise"
    )
    func refused() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let bell = Bell.window(until: at(1200))
        try await rig.tapIn(session(endsAt: 1200))
        await phone.until { $0.until == at(1200) }
        #expect(await phone.screenTime.registered == bell)
        // A re-tap's window, refused: iOS still holds the bell's.
        await phone.screenTime.refuse()
        try await rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.until == at(SyncState.tapCap) && $0.unscheduled }
        #expect(await phone.screenTime.registered == bell)
        // Its answer brings the bell's window back: asked for again, it takes.
        await phone.screenTime.refuse(false)
        try await rig.server.next(tapRoute).reply(200, Answer.joined(session(endsAt: 1200)))
        await phone.until { $0.until == at(1200) && !$0.unscheduled }
        #expect(await phone.screenTime.windows.suffix(2) == [bell, bell])
        await phone.stop()
    }

    @Test(
        "A permission read not determined — as Family Controls can for a moment — never cancels the window the store's shields may still need; denied, iOS has dropped them, and it is cancelled; approved again, registered again"
    )
    func noShields() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let bell = Bell.window(until: at(1200))
        try await rig.tapIn(session(endsAt: 1200))
        await phone.until { $0.until == at(1200) && $0.shielded }
        #expect(await phone.screenTime.registered == bell)
        await phone.screenTime.reads(.notDetermined)
        await phone.enforcer.check()
        await phone.until { $0.permission == .notDetermined }
        #expect(await phone.screenTime.windows.last == .some(bell))
        // Denied, and its report not queued, so the phone still stands focused: no shields to end.
        try refuseRecords(rig.outbox)
        await phone.screenTime.set(.denied)
        await phone.enforcer.check()
        await phone.until { $0.permission == .denied }
        #expect(await phone.screenTime.windows.last == .some(nil))
        try refuseRecords(rig.outbox, false)
        await phone.screenTime.set(.approved)
        await phone.enforcer.check()
        await phone.until { $0.shielded }
        #expect(await phone.screenTime.registered == bell)
        await phone.stop()
    }

    @Test(
        "Over a standing not read, the last run's window is never cancelled: only a pending tap's cap is registered, and its answer cancels nothing"
    )
    func unread() async throws {
        let (outbox, _) = try makeOutbox()
        try outbox.keep(.inSession(session(endsAt: 1200), .focused))
        try spoilStanding(outbox)
        let screenTime = FakeScreenTime()
        await screenTime.held()
        let phone = Enforced(try Rig(outbox: outbox), screenTime)
        let rig = phone.rig
        await phone.until { $0.permission == .approved }
        #expect(await screenTime.windows.isEmpty)
        try await rig.engine.record(.tap(tagId: "another teacher's"))
        await phone.until { $0.until == at(SyncState.tapCap) }
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await phone.until { $0.until == nil }
        #expect(await screenTime.windows == [Bell.window(until: at(SyncState.tapCap))])
        #expect(await !phone.enforcer.protection.unscheduled)
        await phone.stop()
    }
}
