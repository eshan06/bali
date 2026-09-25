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
        #expect(
            wakeFree(url, at: at(300), cap: Bell.floor)
                == .keep(Bell.window(until: at(Bell.floor))))
        #expect(wakeFree(url, at: at(Bell.floor), cap: Bell.floor) == .clear)
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
    #endif
}

@Suite("The window asked of iOS's DeviceActivity center (B5b)")
struct RegisterTests {
    /// The center as a test holds it: the window iOS holds, and each time it was asked.
    final class Center: BellCenter {
        struct Refused: Error {}
        var held: (start: DateComponents, end: DateComponents)?
        var starts = 0
        var stops = 0
        var refusing = false

        func heldEnd() -> DateComponents? { held?.end }
        func start(_ start: DateComponents, _ end: DateComponents) throws {
            if refusing { throw Refused() }
            starts += 1
            held = (start, end)
        }
        func stop() {
            stops += 1
            held = nil
        }
    }

    /// A phone's calendar, away from UTC.
    static let calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    @Test(
        "A window is asked for to the second, in the phone's calendar; asked again while iOS holds it, it is not — a replacement may itself wake the monitor, and the two would never end; another end replaces it; none stops it (#91's review)"
    )
    func once() throws {
        let (center, calendar) = (Center(), Self.calendar)
        let bell = Bell.window(until: at(1200))
        try Bell.register(bell, in: center, calendar: calendar)
        let held = try #require(center.held)
        #expect(calendar.date(from: held.start) == bell.start)
        #expect(calendar.date(from: held.end) == bell.end)
        #expect(center.starts == 1)
        try Bell.register(bell, in: center, calendar: calendar)
        #expect(center.starts == 1)
        let later = Bell.window(until: at(1800))
        try Bell.register(later, in: center, calendar: calendar)
        #expect(center.starts == 2)
        #expect(center.held.flatMap { calendar.date(from: $0.end) } == later.end)
        try Bell.register(nil, in: center, calendar: calendar)
        #expect(center.stops == 1 && center.held == nil)
    }

    @Test("A window iOS refuses throws, and the one iOS held stays")
    func refused() throws {
        let (center, calendar) = (Center(), Self.calendar)
        let bell = Bell.window(until: at(1200))
        try Bell.register(bell, in: center, calendar: calendar)
        center.refusing = true
        #expect(throws: Center.Refused.self) {
            try Bell.register(Bell.window(until: at(1800)), in: center, calendar: calendar)
        }
        #expect(center.held.flatMap { calendar.date(from: $0.end) } == bell.end)
    }

    /// The end of the window `center` holds, registered in `calendar`; nil: none.
    static func heldEnd(_ center: Center, in calendar: Calendar = RegisterTests.calendar) -> Date? {
        center.held.flatMap { calendar.date(from: $0.end) }
    }

    /// The phone stood focused in a session until `bell`.
    static func focused(until bell: TimeInterval) -> SyncState {
        var state = SyncState()
        state.standing = .inSession(session(endsAt: bell), .focused)
        return state
    }

    @Test(
        "The monitor's wake carried out: cleared, or its next wake taken — a refusal kept before is gone; its next wake refused, the time is kept for the app to show, and nothing is cleared (#92's review)"
    )
    func carriedOut() {
        let center = Center()
        var (cleared, refusals) = (0, [Date?]())
        func carryOut(_ state: SyncState?) -> String {
            Bell.carryOut(
                at: t0, in: center, calendar: Self.calendar, clearing: { cleared += 1 },
                refused: { refusals.append($0) }
            ) {
                guard let state else { throw Outbox.Busy() }
                return state
            }
        }
        #expect(carryOut(SyncState()) == "cleared")
        #expect(cleared == 1 && refusals.last == .some(nil) && center.held == nil)

        refusals = []
        let kept = carryOut(Self.focused(until: 1200))
        #expect(kept.hasPrefix("kept until ") && !kept.contains("NOT registered"))
        #expect(Self.heldEnd(center) == Bell.window(until: at(1200)).end)
        #expect(refusals.last == .some(nil) && cleared == 1)

        center.refusing = true
        for state in [nil, Self.focused(until: 1800)] {
            refusals = []
            let said = carryOut(state)
            #expect(said.contains("NOT registered") && refusals.last == t0, "\(said)")
            #expect(cleared == 1 && Self.heldEnd(center) == Bell.window(until: at(1200)).end)
        }
    }

    @Test(
        "The monitor's next wake is asked for before the file is read: a read that fails, one given up at the ceiling, or a wake iOS kills while it reads — a migration left holding the file's write lock (0xdead10cc) — leaves a wake a minute on registered, or iOS's refusal kept for the app to show (#97's review)"
    )
    func retryFirst() {
        let retry = Bell.window(until: at(60))
        // Taken: as the read begins — where a kill would leave it — iOS holds the retry.
        let center = Center()
        var heldAtRead: Date?
        let said = Bell.carryOut(
            at: t0, in: center, calendar: Self.calendar, clearing: { Issue.record("cleared") },
            refused: { _ in }
        ) {
            heldAtRead = Self.heldEnd(center)
            throw Outbox.Busy()
        }
        #expect(heldAtRead == retry.end)
        #expect(said.hasPrefix("file not read — kept, again ") && !said.contains("NOT registered"))
        #expect(Self.heldEnd(center) == retry.end && center.starts == 1)

        // Refused: as the read begins, the refusal is kept already.
        let refusing = Center()
        refusing.refusing = true
        var (refusals, keptAtRead) = ([Date?](), [Date?]())
        let refused = Bell.carryOut(
            at: t0, in: refusing, calendar: Self.calendar, clearing: { Issue.record("cleared") },
            refused: { refusals.append($0) }
        ) {
            keptAtRead = refusals
            throw Outbox.Busy()
        }
        #expect(keptAtRead == [t0])
        #expect(refused.contains("NOT registered") && refusals.last == t0 && refusing.held == nil)
    }

    @Test(
        "A wake that clears withdraws the retry it asked for — no stray wake is left to wake the monitor for nothing — but never a window iOS holds by then that is not its own: the app's, asked for since (#97's review)"
    )
    func clearWithdraws() {
        let center = Center()
        let said = Bell.carryOut(
            at: t0, in: center, calendar: Self.calendar, clearing: {}, refused: { _ in }
        ) { SyncState() }
        #expect(said == "cleared")
        #expect(center.starts == 1 && center.stops == 1 && center.held == nil)

        // The app, a tap just made, asks for its window while the monitor reads the file as it
        // stood before: that window stays.
        let app = Center()
        let tapped = Bell.window(until: at(SyncState.tapCap))
        let cleared = Bell.carryOut(
            at: t0, in: app, calendar: Self.calendar, clearing: {}, refused: { _ in }
        ) {
            try Bell.register(tapped, in: app, calendar: Self.calendar)
            return SyncState()
        }
        #expect(cleared == "cleared")
        #expect(app.stops == 0 && Self.heldEnd(app) == tapped.end)
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
