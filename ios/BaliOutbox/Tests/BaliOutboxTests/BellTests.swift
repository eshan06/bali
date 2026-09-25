import BaliCore
import Foundation
import GRDB
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

    @Test(
        "The bound with the app closed: never early; less than a minute past the bell, woken at the window's end — and less than two, woken before the bell: then kept, and woken again the next whole minute on (#91's review)"
    )
    func bound() throws {
        // The bell a second, twenty seconds and fifty-nine past a whole minute (`t0` is 20 past).
        for bell in [at(1181), at(1200), at(1239)] {
            let state = try kept(
                .inSession(SessionView(id: "s", classId: "c", endsAt: bell), .focused))
            let end = Bell.window(until: bell).end
            #expect(end >= bell && end.timeIntervalSince(bell) < 60, "\(bell)")
            #expect(wake(state, at: end) == .clear, "\(bell)")
            // Woken early by iOS, up to a minute before the window's end, and before the bell.
            for early in stride(from: 0.5, to: 60, by: 3.5) where end - early < bell {
                let next = wake(state, at: end - early)
                #expect(next == .keep(Bell.window(until: end + 60)), "\(bell) \(early)")
                #expect((end + 60).timeIntervalSince(bell) < 120, "\(bell) \(early)")
                #expect(wake(state, at: end + 60) == .clear)
            }
        }
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
        let underTap = try kept(.out, [.tap(tagId: "tag"), .unlockUnderTap(tap: "t", reason: nil)])
        #expect(wake(underTap, at: t0) == .clear)
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

/// The monitor's wake over a file no other process holds, waiting for it as long as the tests wait
/// for anything: a stall of the iOS Simulator's never reads as the file held (`BoundTests` has the
/// bound).
private func wakeFree(_ url: URL, at now: Date, cap: TimeInterval = SyncState.tapCap) -> Bell.Wake
{
    Bell.wake(outboxAt: url, now: now, cap: cap, within: TimeInterval(patience.components.seconds))
}

@Suite("The monitor reads the file the app keeps (B5b)", .timeLimit(.minutes(3)))
struct MonitorFileTests {
    @Test("From the app's own file after a force-quit: kept to the bell, cleared at it")
    func bell() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.tapIn(session(endsAt: 1200))
        await rig.stop()
        #expect(wakeFree(url, at: at(600)) == .keep(Bell.window(until: at(1200))))
        #expect(wakeFree(url, at: at(1200)) == .clear)
    }

    @Test(
        "The bell's backup, after a force-quit: it reads the same file and clears — the shields taken off when the bell's wake was lost, and nothing to clear once it was not — asking iOS nothing (B5b-3)"
    )
    func backup() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.tapIn(session(endsAt: 1200))
        await rig.stop()
        let backup = Bell.backup(of: Bell.window(until: at(1200)))
        let center = RegisterTests.Center()
        var (shielded, refused) = (true, Date?.some(at(1190)))
        func woken() -> String {
            Bell.carryOut(
                wakeFree(url, at: backup.end), woken: .backup, at: backup.end, in: center,
                clearing: {
                    defer { shielded = false }
                    return shielded
                }, refused: &refused)
        }
        #expect(woken() == "cleared" && !shielded && refused == nil)
        #expect(woken() == "nothing to clear" && center.calls.isEmpty)
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
        #expect(wakeFree(url, at: cap - 600) == .keep(Bell.window(until: cap)))
        #expect(wakeFree(url, at: cap) == .clear)
        #expect(wakeFree(url, at: Bell.backup(of: Bell.window(until: cap)).end) == .clear)
        #expect(
            wakeFree(url, at: at(300), cap: Bell.floor)
                == .keep(Bell.window(until: at(Bell.floor))))
        #expect(wakeFree(url, at: at(Bell.floor), cap: Bell.floor) == .clear)
        let checkBackup = Bell.backup(of: Bell.window(until: at(Bell.floor)))
        #expect(wakeFree(url, at: checkBackup.end, cap: Bell.floor) == .clear)
    }

    @Test(
        "A standing the file cannot give back, or a file a newer build migrated, keeps the shields and tries again a minute on"
    )
    func unreadable() throws {
        let (spoiled, spoiledURL) = try makeOutbox()
        try spoiled.keep(.inSession(session(endsAt: 1200), .focused))
        try spoilStanding(spoiled)
        #expect(wakeFree(spoiledURL, at: at(1300)) == .retry(Bell.window(until: at(1360))))
        let (newer, newerURL) = try makeOutbox()
        try newer.pool.write {
            try $0.execute(sql: "INSERT INTO grdb_migrations (identifier) VALUES ('v99')")
        }
        #expect(wakeFree(newerURL, at: at(1300)) == .retry(Bell.window(until: at(1360))))
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
            #expect(wakeFree(url, at: t0) == .keep(Bell.window(until: at(1200))))
            #expect(try descriptors() == 0)
        }

        // Linux only, where no runner stalls for seconds the way the iOS Simulator's does: this
        // races the monitor's bound against another connection's hold.
        @Test(
            "The monitor's whole open and read waits at most its bound — SQLite's waits on another process's lock included, never its 5 s busy timeout on top: a file held past the bound is not read, and the shields are kept (#91's review)"
        )
        func heldPastBound() throws {
            let (outbox, url) = try makeOutbox()
            try outbox.keep(.inSession(session(endsAt: 1200), .focused))
            try outbox.pool.close()
            // Another process holds the file — no read of another's passes — for 4 s, then lets it
            // go: past the bound, and inside the 5 s busy timeout a wait at each lock would have.
            var configuration = Configuration()
            configuration.prepareDatabase { try $0.execute(sql: "PRAGMA locking_mode = EXCLUSIVE") }
            let holder = try DatabaseQueue(
                path: url.path(percentEncoded: false), configuration: configuration)
            try holder.write { try Outbox.setState($0, "held", "x") }
            Thread.detachNewThread {
                Thread.sleep(forTimeInterval: 4)
                try? holder.close()
            }
            #expect(
                Bell.wake(outboxAt: url, now: t0, within: 0.5) == .retry(Bell.window(until: at(60)))
            )
        }
    #endif
}

@Suite("The monitor's open waits for the file at most its bound (B5b)", .timeLimit(.minutes(3)))
struct BoundTests {
    /// Access another process may hold, as a test plays it: granted at once, or when the test says.
    final class Asking: @unchecked Sendable {
        typealias Grant = @Sendable (URL) -> Void
        typealias Over = @Sendable ((any Error)?) -> Void
        static let file = URL(fileURLWithPath: "/granted/outbox.sqlite")
        private let lock = NSLock()
        private let atOnce: Bool
        private let asked = DispatchSemaphore(value: 0)
        private var waiting: (grant: Grant, over: Over)?
        private var cancels = 0
        private var opens: [URL] = []

        init(atOnce: Bool) { self.atOnce = atOnce }

        var cancelled: Bool { lock.withLock { cancels > 0 } }
        var opened: [URL] { lock.withLock { opens } }

        func request(_ grant: @escaping Grant, _ over: @escaping Over) {
            guard !atOnce else {
                grant(Self.file)
                return over(nil)
            }
            lock.withLock { waiting = (grant, over) }
            asked.signal()
        }
        func cancel() { lock.withLock { cancels += 1 } }
        /// Grants the access asked for — or ends the asking with `failure` — here and now, as
        /// NSFileCoordinator's blocking call does: its accessor, then its return.
        func grant(_ failure: (any Error)? = nil) {
            let asking = lock.withLock {
                defer { waiting = nil }
                return waiting
            }
            if failure == nil { asking?.grant(Self.file) }
            asking?.over(failure)
        }
        /// …or as NSFileCoordinator would: on a thread of its own, once asked, `delay` seconds on.
        func grant(after delay: TimeInterval, _ failure: (any Error)? = nil) {
            Thread.detachNewThread { [self] in
                asked.wait()
                Thread.sleep(forTimeInterval: delay)
                grant(failure)
            }
        }
        func open(_ url: URL) -> Int {
            lock.withLock { opens.append(url) }
            return 7
        }
        func granted(within bound: TimeInterval?) throws -> Int {
            try Outbox.granted(until: bound.map { .now() + $0 }, request: request, cancel: cancel) {
                self.open($0)
            }
        }
    }

    @Test("Free, the file opens at once, at the URL the grant gives")
    func free() throws {
        let asking = Asking(atOnce: true)
        #expect(try asking.granted(within: 1) == 7)
        #expect(asking.opened == [Asking.file] && !asking.cancelled)
    }

    @Test(
        "Held past the bound: `Busy` — the asking cancelled, nothing opened — and a grant that comes after opens nothing"
    )
    func held() throws {
        let asking = Asking(atOnce: false)
        let start = ContinuousClock.now
        #expect(throws: Outbox.Busy.self) { try asking.granted(within: 0.2) }
        #expect(ContinuousClock.now - start >= .milliseconds(200))
        #expect(asking.cancelled && asking.opened.isEmpty)
        asking.grant()
        #expect(asking.opened.isEmpty)
    }

    @Test(
        "The bound is a ceiling: an open already under way at it is waited for no longer — `Busy`, and the shields kept — while it runs on, on its own thread, and its outcome is dropped; iOS waits on the shield, and would kill the monitor mid-wake (#93's review)"
    )
    func underWay() throws {
        let (began, release, ended) = (
            DispatchSemaphore(value: 0), DispatchSemaphore(value: 0), DispatchSemaphore(value: 0)
        )
        let returned = Returned<Int>()
        // On a thread of its own, so that a wait with no end fails the test rather than hang it.
        Thread.detachNewThread {
            returned.result = Result {
                try Outbox.granted(
                    until: .now() + 0.2,
                    request: { grant, over in
                        Thread.detachNewThread {
                            grant(Asking.file)
                            over(nil)
                        }
                        // The open has begun before the wait for it does: no stall can put them
                        // the other way.
                        began.wait()
                    },
                    cancel: { Issue.record("an open under way was cancelled") }
                ) { _ in
                    began.signal()
                    // Held past the bound — until the test lets it go, not for a time.
                    release.wait()
                    ended.signal()
                    return 7
                }
            }
        }
        let result = returned.wait()
        release.signal()
        #expect(throws: Outbox.Busy.self) { try #require(result, "waited with no end").get() }
        // The open, let go, ends on its own thread: nothing waits for it, nothing takes its value.
        let seconds = Int(patience.components.seconds)
        #expect(ended.wait(timeout: .now() + .seconds(seconds)) == .success)
    }

    @Test(
        "Past the bound, the one open that takes the write lock — the monitor's migration, granted and under way — is waited out, not given up on: left running, it would hold the file's write lock once the read had answered, and iOS kills an extension suspended holding one (0xdead10cc) before the monitor asks for its next wake (#97's review)"
    )
    func waitedOut() throws {
        let began = DispatchSemaphore(value: 0)
        let deadline = DispatchTime.now() + 0.2
        let returned = Returned<Int>()
        // On a thread of its own, so that a wait with no end fails the test rather than hang it.
        Thread.detachNewThread {
            returned.result = Result {
                try Outbox.granted(
                    until: deadline, waitsOut: true,
                    request: { grant, over in
                        Thread.detachNewThread {
                            grant(Asking.file)
                            over(nil)
                        }
                        // The open has begun before the wait for it does.
                        began.wait()
                    },
                    cancel: { Issue.record("an open under way was cancelled") }
                ) { _ in
                    began.signal()
                    // Its work outlasts the bound, whatever the wait for it does: a migration
                    // running on after the deadline.
                    let done = deadline + 0.5
                    while DispatchTime.now() < done { Thread.sleep(forTimeInterval: 0.01) }
                    return 7
                }
            }
        }
        #expect(try #require(returned.wait(), "waited with no end").get() == 7)
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
        #expect(asking.opened.isEmpty)
    }

    @Test(
        "The asking over with no grant and no error — as NSFileCoordinator's call could return — is refused all the same: the app's open throws, and says so with a retry, never waiting with no end (#91's review)"
    )
    func overUngranted() throws {
        let opened = Returned<Int>()
        // On a thread of its own, so that a wait with no end fails the test rather than hang it.
        Thread.detachNewThread {
            opened.result = Result {
                try Outbox.granted(
                    until: nil, request: { _, over in over(nil) }, cancel: {}, open: { _ in 7 })
            }
        }
        let result = try #require(opened.wait(), "the open never returned")
        #expect(throws: CocoaError.self) { try result.get() }
    }

    @Test(
        "Only the first claim has the file: an asking that grants twice, and ends with an error besides, opens it once, and that open's outcome stands (#91's review)"
    )
    func grantedTwice() throws {
        let asking = Asking(atOnce: false)
        let value = try Outbox.granted(
            until: nil,
            request: { grant, over in
                grant(Asking.file)
                grant(Asking.file)
                over(CocoaError(.fileLocking))
            }, cancel: {}
        ) { asking.open($0) }
        #expect(value == 7)
        #expect(asking.opened == [Asking.file])
    }

    /// What a call made on another thread returned, once it has — waited for with the tests' patience.
    final class Returned<T>: @unchecked Sendable {
        private let lock = NSLock()
        private let done = DispatchSemaphore(value: 0)
        private var outcome: Result<T, any Error>?

        var result: Result<T, any Error>? {
            get { lock.withLock { outcome } }
            set {
                lock.withLock { outcome = newValue }
                done.signal()
            }
        }

        func wait() -> Result<T, any Error>? {
            let seconds = Int(patience.components.seconds)
            return done.wait(timeout: .now() + .seconds(seconds)) == .success ? result : nil
        }
    }

    #if canImport(Darwin)
        @Test(
            "On the phone, a file another process holds through NSFileCoordinator is waited on at most the bound: `Busy`, and the monitor keeps the shields"
        )
        func coordinator() throws {
            let (_, url) = try makeOutbox()
            let (holding, release) = (DispatchSemaphore(value: 0), DispatchSemaphore(value: 0))
            Thread.detachNewThread {
                NSFileCoordinator(filePresenter: nil).coordinate(
                    writingItemAt: url, options: .forMerging, error: nil
                ) { _ in
                    holding.signal()
                    release.wait()
                }
            }
            // Failing rather than hanging, should the holder never get the file.
            guard holding.wait(timeout: .now() + .seconds(150)) == .success else {
                Issue.record("the holding coordinator was never granted the file")
                return
            }
            defer { release.signal() }
            #expect(throws: Outbox.Busy.self) { try Outbox.read(url, within: 1, migrating: true) }
            #expect(Bell.wake(outboxAt: url, now: t0) == .retry(Bell.window(until: at(60))))
        }

        @Test(
            "On the phone, the extensions' read coordinates as a reader: another process reading the file holds it up not at all (#93's review)"
        )
        func reader() throws {
            let (outbox, url) = try makeOutbox()
            try outbox.keep(.inSession(session(endsAt: 1200), .focused))
            try outbox.pool.close()
            let (holding, release) = (DispatchSemaphore(value: 0), DispatchSemaphore(value: 0))
            Thread.detachNewThread {
                NSFileCoordinator(filePresenter: nil).coordinate(
                    readingItemAt: url, options: .withoutChanges, error: nil
                ) { _ in
                    holding.signal()
                    release.wait()
                }
            }
            guard holding.wait(timeout: .now() + .seconds(150)) == .success else {
                Issue.record("the reading coordinator was never granted the file")
                return
            }
            defer { release.signal() }
            // A writer's claim would wait out the reader's, to the bound: the tests' own, so that
            // a stall of the simulator's never reads as the file held.
            let bound = TimeInterval(patience.components.seconds)
            #expect(
                try Outbox.read(url, within: bound, migrating: false).standing
                    == .inSession(session(endsAt: 1200), .focused))
        }

        @Test(
            "On the phone, an open that writes — the monitor's migration — granted through NSFileCoordinator and still under way at the bound, is waited out (#97's review)"
        )
        func writerWaitedOut() throws {
            let (_, url) = try makeOutbox()
            // Far enough off for the coordinator to grant the open first; the open outlasts it.
            // Granted only past the bound — a stall of the simulator's — the open never runs, and
            // there is nothing to tell: then again, further off, and never passed untold (#98's
            // review), so no stall hides a writer given up on.
            for bound in [1.0, 10, 60] {
                let began = Returned<Bool>()
                let deadline = DispatchTime.now() + bound
                let result = Result {
                    try Outbox.coordinated(url, reading: false, until: deadline) { _ in
                        began.result = .success(true)
                        let done = deadline + 0.5
                        while DispatchTime.now() < done { Thread.sleep(forTimeInterval: 0.01) }
                        return 7
                    }
                }
                guard began.result != nil else { continue }
                #expect(try result.get() == 7)
                return
            }
            Issue.record("granted only past every bound: the writer's wait-out never ran")
        }
    #endif
}

@Suite("The windows asked of iOS's DeviceActivity center, and under which names (B5b, B5b-3)")
struct RegisterTests {
    /// The center as a test holds it: the window iOS holds under each name, and every call made of
    /// it, in order.
    final class Center: BellCenter {
        struct Refused: Error {}
        enum Call: Hashable {
            case held(Bell.Name)
            case start(Bell.Name)
            case stop([Bell.Name])

            var names: [Bell.Name] {
                switch self {
                case .held(let name), .start(let name): [name]
                case .stop(let names): names
                }
            }
        }
        var held: [Bell.Name: (start: DateComponents, end: DateComponents)] = [:]
        var calls: [Call] = []
        /// The names iOS refuses a window under.
        var refusing: Set<Bell.Name> = []

        func heldEnd(_ name: Bell.Name) -> DateComponents? {
            calls.append(.held(name))
            return held[name]?.end
        }
        func start(_ name: Bell.Name, _ start: DateComponents, _ end: DateComponents) throws {
            calls.append(.start(name))
            if refusing.contains(name) { throw Refused() }
            held[name] = (start, end)
        }
        func stop(_ names: [Bell.Name]) {
            calls.append(.stop(names))
            for name in names { held[name] = nil }
        }

        var starts: Int { calls.count { if case .start = $0 { true } else { false } } }
        /// The window iOS holds under `name`, read back in `calendar`.
        func window(_ name: Bell.Name, in calendar: Calendar = .current) -> DateInterval? {
            guard let held = held[name], let start = calendar.date(from: held.start),
                let end = calendar.date(from: held.end)
            else { return nil }
            return DateInterval(start: start, end: end)
        }
    }

    /// A phone's calendar, away from UTC.
    static let calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    @Test(
        "Four windows, each an activity of its own with iOS: the bell's under B5b's name, its backup, and the monitor's own two — whose next wake is never under the name that woke it, nor the app's (B5b-3)"
    )
    func names() {
        // A window the build before registered is the bell's.
        #expect(Bell.Name.bell.rawValue == "bali")
        #expect(Set(Bell.Name.allCases.map(\.rawValue)).count == 4)
        for woken in Bell.Name.allCases.map(Optional.some) + [nil] {
            let next = Bell.next(after: woken)
            #expect(next != woken && [.tick, .tock].contains(next), "\(String(describing: woken))")
        }
    }

    @Test(
        "The backup's window ends two minutes after the bell's — past the monitor's own next wake, a minute on at most — on a whole minute, and is the floor long: under the floor, it starts in the past as the bell's does (B5b-3)"
    )
    func backup() {
        #expect(Bell.backupAfter == 2 * 60)
        for until in [at(40), at(41), at(600), at(3000)] {
            let bell = Bell.window(until: until)
            let backup = Bell.backup(of: bell)
            #expect(backup.end == bell.end + Bell.backupAfter, "\(until)")
            #expect(backup.duration == Bell.floor && minuteOf(backup.end) == 0, "\(until)")
            // The monitor's own next wake, asked for at the bell's window: before the backup's.
            let early = Bell.wake(now: bell.end - 0.5) { throw Outbox.Busy() }
            #expect(early == .retry(Bell.window(until: bell.end + Bell.retry)), "\(until)")
            #expect(bell.end + Bell.retry < backup.end, "\(until)")
        }
        #expect(Bell.backup(of: Bell.window(until: at(600))).start < t0)
    }

    @Test(
        "The app's windows: the bell's, asked for to the second in the phone's calendar, and its backup — each not asked for again while iOS holds it, since a replacement may itself wake the monitor and the two would never end; another end replaces both; none stops every name (#91's review, B5b-3)"
    )
    func once() throws {
        let (center, calendar) = (Center(), Self.calendar)
        let bell = Bell.window(until: at(1200))
        try Bell.register(bell, in: center, calendar: calendar)
        #expect(center.window(.bell, in: calendar) == bell)
        #expect(center.window(.backup, in: calendar) == Bell.backup(of: bell))
        #expect(center.starts == 2)
        try Bell.register(bell, in: center, calendar: calendar)
        #expect(center.starts == 2)
        let later = Bell.window(until: at(1800))
        try Bell.register(later, in: center, calendar: calendar)
        #expect(center.starts == 4)
        #expect(center.window(.bell, in: calendar) == later)
        #expect(center.window(.backup, in: calendar) == Bell.backup(of: later))
        try Bell.register(nil, in: center, calendar: calendar)
        #expect(center.held.isEmpty && center.calls.last == .stop(Bell.Name.allCases))
    }

    @Test(
        "The app's truth leaves no stale wake: a new window or an extension replaces the bell's and its backup and stops the next wake the monitor asked for itself, the app closed; the end stops every one (B5b-3)"
    )
    func cleanup() throws {
        let (center, calendar) = (Center(), Self.calendar)
        try Bell.register(Bell.window(until: at(1200)), in: center, calendar: calendar)
        // The app closed, the monitor woken early: the shields kept, its next wake its own.
        var (state, refused) = (SyncState(), Date?.none)
        state.standing = .inSession(session(endsAt: 1200), .focused)
        _ = Bell.carryOut(
            Bell.wake(now: at(1199)) { state }, woken: .bell, at: at(1199), in: center,
            clearing: { true }, refused: &refused)
        #expect(center.window(.tick) == Bell.window(until: at(1259)))
        // Opened: an extension, then a new session's tap — the monitor's own stopped, each time.
        for until in [at(1800), at(2400)] {
            let window = Bell.window(until: until)
            try Bell.register(window, in: center, calendar: calendar)
            #expect(Set(center.held.keys) == [.bell, .backup], "\(until)")
            #expect(center.window(.bell, in: calendar) == window, "\(until)")
            #expect(center.window(.backup, in: calendar) == Bell.backup(of: window), "\(until)")
            _ = Bell.carryOut(
                .retry(Bell.window(until: at(60))), woken: .tick, at: t0, in: center,
                clearing: { true }, refused: &refused)
            #expect(center.held[.tock] != nil, "\(until)")
        }
        // The end — the bell with the app open, an unlock, protection off: nothing left to wake it.
        try Bell.register(nil, in: center, calendar: calendar)
        #expect(center.held.isEmpty)
    }

    @Test(
        "A window iOS refuses throws, and iOS keeps what it held — the next wake the monitor asked for itself too, stopped only once the app's windows are taken"
    )
    func refused() throws {
        let (center, calendar) = (Center(), Self.calendar)
        let bell = Bell.window(until: at(1200))
        try Bell.register(bell, in: center, calendar: calendar)
        var noted: Date?
        _ = Bell.carryOut(
            .retry(Bell.window(until: at(60))), woken: .bell, at: t0, in: center,
            clearing: { true }, refused: &noted)
        let later = Bell.window(until: at(1800))
        for refusing in [Bell.Name.bell, .backup] {
            center.refusing = [refusing]
            #expect(throws: Center.Refused.self, "\(refusing)") {
                try Bell.register(later, in: center, calendar: calendar)
            }
            #expect(center.window(.backup, in: calendar) == Bell.backup(of: bell), "\(refusing)")
            #expect(center.held[.tick] != nil, "\(refusing)")
        }
        #expect(center.window(.bell, in: calendar) == later)
        center.refusing = []
        try Bell.register(later, in: center, calendar: calendar)
        #expect(Set(center.held.keys) == [.bell, .backup])
    }

    @Test(
        "No wake of the monitor's asks iOS anything of the window that woke it — on iOS 18, `startMonitoring` for it inside its own `intervalDidEnd` deadlocks (FB14664238) — nor of the app's, nor stops any: its next wake asked for under one of its own, in turn; a clear asks nothing at all (B5b-3)"
    )
    func ownCallback() throws {
        let wakes: [Bell.Wake] = [
            .clear, .keep(Bell.window(until: at(1200))), .retry(Bell.window(until: at(60))),
        ]
        for woken in Bell.Name.allCases.map(Optional.some) + [nil] {
            for wake in wakes {
                let center = Center()
                // What iOS holds as it wakes the monitor: the app's windows, the monitor's own.
                try Bell.register(Bell.window(until: at(600)), in: center)
                center.held[.tick] = center.held[.bell]
                center.held[.tock] = center.held[.bell]
                center.calls = []
                var refused: Date?
                _ = Bell.carryOut(
                    wake, woken: woken, at: t0, in: center, clearing: { true }, refused: &refused)
                let asked = center.calls.flatMap(\.names)
                let said = "\(String(describing: woken)) \(wake)"
                #expect(
                    !asked.contains { $0 == woken }
                        && asked.allSatisfy { $0 == .tick || $0 == .tock }, "\(said)")
                #expect(
                    !center.calls.contains { if case .stop = $0 { true } else { false } }, "\(said)"
                )
                #expect(
                    wake == .clear
                        ? center.calls.isEmpty
                        : center.calls.last == .start(Bell.next(after: woken)),
                    "\(said)")
            }
        }
    }

    @Test(
        "The monitor's wake carried out: cleared — or nothing to clear, the shields off already, as the bell's backup finds them after the bell's own wake — or its next wake taken: a refusal kept before is gone; its next wake refused, the time is kept for the app to show, and nothing is cleared (#92's review, B5b-3)"
    )
    func carriedOut() {
        let center = Center()
        var (cleared, refused) = (0, Date?.some(at(-600)))
        #expect(
            Bell.carryOut(
                .clear, woken: .bell, at: t0, in: center,
                clearing: {
                    cleared += 1
                    return true
                }, refused: &refused) == "cleared")
        #expect(cleared == 1 && refused == nil && center.calls.isEmpty)

        // The bell's own next wake refused, then its backup woken: the shields off — the note ends.
        refused = at(-600)
        #expect(
            Bell.carryOut(
                .clear, woken: .backup, at: t0, in: center,
                clearing: {
                    cleared += 1
                    return false
                }, refused: &refused) == "nothing to clear")
        #expect(cleared == 2 && refused == nil && center.calls.isEmpty)

        refused = at(-600)
        let bell = Bell.window(until: at(1200))
        let kept = Bell.carryOut(
            .keep(bell), woken: .bell, at: t0, in: center, clearing: { true }, refused: &refused)
        #expect(kept.hasPrefix("kept until ") && !kept.contains("NOT registered"))
        #expect(center.held[.tick] != nil && center.starts == 1 && refused == nil)

        center.refusing = Set(Bell.Name.allCases)
        let refusedWakes = [
            Bell.Wake.retry(Bell.window(until: at(60))), .keep(Bell.window(until: at(1800))),
        ]
        for wake in refusedWakes {
            for woken in [Bell.Name.bell, .backup, .tick] {
                refused = nil
                let said = Bell.carryOut(
                    wake, woken: woken, at: t0, in: center,
                    clearing: {
                        cleared += 1
                        return true
                    }, refused: &refused)
                #expect(
                    said.contains("NOT registered") && refused == t0 && cleared == 2,
                    "\(wake) \(woken)")
            }
        }
    }

    @Test(
        "The monitor's log keeps its last three wakes, newest first, each outcome in place of the note it began with — so a wake iOS ended before it finished still shows"
    )
    func logged() {
        var log = Bell.logged("1 bell · not finished", in: [])
        log = Bell.logged("1 bell · cleared", replacing: "1 bell · not finished", in: log)
        log = Bell.logged("2 backup · not finished", in: log)
        log = Bell.logged("3 tick · not finished", in: log)
        log = Bell.logged("3 tick · kept", replacing: "3 tick · not finished", in: log)
        #expect(log == ["3 tick · kept", "2 backup · not finished", "1 bell · cleared"])
        log = Bell.logged("4 tock · not finished", in: log)
        #expect(log == ["4 tock · not finished", "3 tick · kept", "2 backup · not finished"])
        #expect(Bell.logged("5", replacing: "gone", in: log).first == "5")
    }

    @Test(
        "The monitor extension asks DeviceActivity nothing but through `Bell.carryOut`, whose rules hold above — never the app's registration — and no code of the app's or the extensions' asks for `activities`, on which the monitor deadlocked on iOS 18 (B5b-3)"
    )
    func monitorsCalls() throws {
        let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        /// A source file with its comments left out.
        func code(_ path: String) throws -> String {
            try String(contentsOf: ios.appending(path: path), encoding: .utf8)
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map {
                    $0.split(separator: "//", maxSplits: 1, omittingEmptySubsequences: false)[0]
                }
                .joined(separator: "\n")
        }
        let monitor = try code("BaliMonitor/SessionMonitor.swift")
        #expect(monitor.contains("Bell.carryOut("))
        for call in [
            "startMonitoring", "stopMonitoring", "schedule(for", "Bell.register", ".activities",
        ] {
            #expect(!monitor.contains(call), "the monitor calls \(call)")
        }
        for path in [
            "BaliOutbox/Sources/BaliOutbox/PhoneBell.swift", "Bali/PhoneScreenTime.swift",
            "Bali/BaliApp.swift", "BaliShield/ShieldConfigurationExtension.swift",
        ] {
            #expect(try !code(path).contains(".activities"), "\(path)")
        }
    }
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
        "A sign-out keeps the standing — a sign-out is not an unlock — so it leaves the windows as they were, and the bell still takes the shields off and cancels them (B5b-3)"
    )
    func signOut() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn(session(endsAt: 1200))
        await phone.until { $0.until == at(1200) }
        let registered = await phone.screenTime.windows
        // Signed out: no token to send, and the engine waits on sign-in (B4).
        await rig.tokens.set(nil)
        await rig.engine.setForeground(true)
        await rig.until { $0.link == .signIn }
        await phone.enforcer.check()
        await phone.until { $0.shielded && $0.until == at(1200) }
        #expect(await phone.screenTime.windows == registered)
        rig.clock.advance(by: 1200)
        await phone.until { !$0.shielded }
        #expect(await phone.screenTime.windows == registered + [nil])
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
        "A window iOS refused the monitor, the app closed, is shown at the app's next open — the shields it kept then come off, the bell long past — until a window is registered again (#91's review)"
    )
    func monitorRefused() async throws {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(session(endsAt: -600), .focused))
        let screenTime = FakeScreenTime()
        await screenTime.held()
        await screenTime.refuseMonitor(at: at(-660))
        let phone = Enforced(try Rig(outbox: try open(url)), screenTime)
        let opened = await phone.until { !$0.shielded && $0.permission == .approved }
        #expect(opened.monitorUnscheduled == at(-660))
        #expect(await screenTime.windows.isEmpty)
        try await phone.rig.engine.record(.tap(tagId: "tag"))
        await phone.until { $0.shielded && $0.monitorUnscheduled == nil }
        #expect(await screenTime.registered == Bell.window(until: at(SyncState.tapCap)))
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
