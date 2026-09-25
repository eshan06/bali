import BaliCore
import Foundation
import GRDB
import Testing

@testable import BaliOutbox

#if os(Linux)
    import GRDBSQLite
#endif

/// The extensions' read of the file at `url`, read only — as the shield's is — waiting for it as
/// long as the tests wait for anything: a stall of the iOS Simulator's never reads as the file held
/// (`BoundTests` has the bound).
private func read(_ url: URL) throws -> SyncState {
    try Outbox.read(url, within: TimeInterval(patience.components.seconds), migrating: false)
}

/// The file's bytes, or its WAL's (`suffix` "-wal"); nil when there is no such file.
private func bytes(_ url: URL, _ suffix: String = "") -> Data? {
    FileManager.default.contents(atPath: url.path(percentEncoded: false) + suffix)
}

/// A file of `version`'s schema — a build not yet updated wrote it — standing focused until
/// `class1042`'s bell, with a stuck tap queued.
private func madeBy(_ version: String) throws -> URL {
    let url = temporaryFile()
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let old = try DatabasePool(path: url.path(percentEncoded: false))
    try Outbox.migrator.migrate(old, upTo: version)
    try old.write { db in
        try Outbox.keep(db, .inSession(class1042, .focused))
        try db.execute(
            sql: """
                INSERT INTO outbox (eventId, kind, tagId, recordedAt, nextAttemptAt, stuck)
                VALUES ('e0', 'tap', 'tag', ?, ?, 1)
                """, arguments: [t0, t0])
    }
    try old.close()
    return url
}

/// The migrations the file at `url` has had, as a read-only connection reads them.
private func applied(_ url: URL) throws -> [String] {
    let file = try DatabaseQueue(
        path: url.path(percentEncoded: false),
        configuration: Outbox.configuration(readonly: true, until: nil))
    defer { try? file.close() }
    return try file.read(Outbox.migrator.appliedMigrations)
}

/// A session whose bell is at 10:42 AM in New York, where `t0` is 10:13:20 AM.
private let class1042 = session(endsAt: 1720)

@Suite("The extensions' read: read only, whatever the file (B6c)", .timeLimit(.minutes(3)))
struct ExtensionReadTests {
    @Test(
        "After the app has written and closed: read with a read-only connection — the WAL files the app keeps are there — and nothing written, neither the file nor its WAL (#93's review)"
    )
    func current() throws {
        let (outbox, url) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try outbox.keep(.inSession(class1042, .focused))
        try outbox.pool.close()
        #expect(bytes(url, "-wal") != nil && bytes(url, "-shm") != nil)
        let (file, wal) = (bytes(url), bytes(url, "-wal"))
        let state = try read(url)
        #expect(state.standing == .inSession(class1042, .focused))
        #expect(state.queued.map(\.eventId) == [tap.eventId])
        #expect(bytes(url) == file && bytes(url, "-wal") == wal)
    }

    @Test(
        "The WAL files gone — a WAL checkpointed away: SQLite's own build has a read-only connection make them where the folder lets it; Apple's does not, and the file reads as unreadable, the fail-safe, until the app's next open makes them again — nothing written to the file either way"
    )
    func companions() throws {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(class1042, .focused))
        try outbox.pool.writeWithoutTransaction { _ = try $0.checkpoint(.truncate) }
        try outbox.pool.close()
        let path = url.path(percentEncoded: false)
        for suffix in ["-wal", "-shm"] { try FileManager.default.removeItem(atPath: path + suffix) }
        let file = bytes(url)
        #if canImport(Darwin)
            // As GRDB's guide has it: a read-only connection opens them only where they are.
            #expect(throws: (any Error).self) { try read(url) }
            #expect(bytes(url) == file)
            try open(url).pool.close()
        #else
            #expect(try read(url).standing == .inSession(class1042, .focused))
            #expect(bytes(url) == file && bytes(url, "-wal") == Data())
        #endif
        #expect(try read(url).standing == .inSession(class1042, .focused))
    }

    @Test(
        "No file: nothing read, and none made — the shield says Bali's name alone, and the monitor keeps the shields and tries again a minute on"
    )
    func missing() throws {
        let url = temporaryFile()
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #expect(throws: (any Error).self) { try read(url) }
        let bound = TimeInterval(patience.components.seconds)
        let words = ShieldWords(outboxAt: url, over: .app, now: t0, within: bound)
        #expect(words.title == "Focused with Bali")
        let wake = Bell.wake(outboxAt: url, now: t0, within: bound)
        #expect(wake == .retry(Bell.window(until: at(60))))
        #expect(bytes(url) == nil && bytes(url, "-wal") == nil)
    }

    @Test(
        "A file this build has yet to migrate — the app not opened since an update, B6a's v3 and B6b's v4 — is migrated where the monitor reads it, once, as the app's open would: the bell clears the shields, and every read after is read only. The shield never migrates it (#97's review): Bali's name alone, the file left as it is, until the monitor or the app has"
    )
    func older() throws {
        let bound = TimeInterval(patience.components.seconds)
        for version in ["v2", "v3"] {
            let url = try madeBy(version)
            let (before, migrations) = (bytes(url), try applied(url))
            let words = ShieldWords(outboxAt: url, over: .app, now: t0, within: bound)
            #expect(words.title == "Focused with Bali", "\(version)")
            #expect(try applied(url) == migrations && bytes(url) == before, "\(version)")
            #expect(Bell.wake(outboxAt: url, now: at(1720), within: bound) == .clear, "\(version)")
            #expect(try applied(url) == ["v1", "v2", "v3", "v4"], "\(version)")
            let (file, wal) = (bytes(url), bytes(url, "-wal"))
            let shield = ShieldWords(outboxAt: url, over: .app, now: t0, within: bound)
            #expect(shield.title.hasPrefix("Focused with Bali until "), "\(version)")
            let state = try read(url)
            #expect(state.standing == .inSession(class1042, .focused), "\(version)")
            #expect(state.queued.map(\.eventId) == ["e0"], "\(version)")
            #expect(bytes(url) == file && bytes(url, "-wal") == wal, "\(version)")
        }
    }

    @Test(
        "A migration the bound cuts off — the app writing the file just then — leaves nothing half done: the shields kept, a wake a minute on registered; that wake migrates the file, clears them, and leaves no wake behind (#97's review)"
    )
    func olderCutOff() throws {
        let url = try madeBy("v3")
        // The app writing: a write transaction held open until the test lets it go — a reader
        // passes it (WAL), a migration waits on it.
        let (holding, release, released) = (
            DispatchSemaphore(value: 0), DispatchSemaphore(value: 0), DispatchSemaphore(value: 0)
        )
        let app = try DatabaseQueue(path: url.path(percentEncoded: false))
        Thread.detachNewThread {
            do {
                try app.inTransaction(.immediate) { _ in
                    holding.signal()
                    release.wait()
                    return .rollback
                }
            } catch {
                holding.signal()
            }
            try? app.close()
            released.signal()
        }
        holding.wait()
        let center = RegisterTests.Center()
        var cleared = 0
        let cut = Bell.carryOut(
            outboxAt: url, at: at(1720), in: center, clearing: { cleared += 1 },
            refused: { _ in }, within: 0.5)
        // Looked at while the app still writes: on the phone, the migration the bound gave up on
        // may run on (the ceiling), but it cannot go through past that write.
        let halfway = Result { try applied(url) }
        release.signal()
        released.wait()
        #expect(cut.hasPrefix("file not read — kept, again ") && cleared == 0)
        // Registered as the monitor registers it, in the phone's calendar.
        let held = RegisterTests.heldEnd(center, in: .current)
        #expect(held == Bell.window(until: at(1780)).end)
        #expect(try halfway.get() == ["v1", "v2", "v3"])
        let bound = TimeInterval(patience.components.seconds)
        let next = Bell.carryOut(
            outboxAt: url, at: at(1780), in: center, clearing: { cleared += 1 },
            refused: { _ in }, within: bound)
        #expect(next == "cleared" && cleared == 1 && center.held == nil)
        #expect(try applied(url) == ["v1", "v2", "v3", "v4"])
    }

    @Test(
        "A file a newer build migrated: not read — no schema this build does not know is read, let alone written — and left as it is"
    )
    func newer() throws {
        let (outbox, url) = try makeOutbox()
        try outbox.keep(.inSession(class1042, .focused))
        try outbox.pool.write {
            try $0.execute(sql: "INSERT INTO grdb_migrations (identifier) VALUES ('v99')")
        }
        try outbox.pool.close()
        let (file, wal) = (bytes(url), bytes(url, "-wal"))
        #expect(throws: Outbox.TooNew.self) { try read(url) }
        #expect(bytes(url) == file && bytes(url, "-wal") == wal)
    }

    #if os(Linux)
        @Test(
            "A close that fails never takes back a read that went through: the shield says the bell it read, and the monitor keeps the shields to it — the queue closes the file as it goes all the same (#97's review)"
        )
        func closeFails() throws {
            let (outbox, url) = try makeOutbox()
            try outbox.keep(.inSession(class1042, .focused))
            try outbox.pool.close()
            try Unclosable.closing(url) {
                // Staged: closing a connection to the file fails.
                let probe = try DatabaseQueue(
                    path: url.path(percentEncoded: false),
                    configuration: Outbox.configuration(readonly: true, until: nil))
                #expect(throws: DatabaseError.self) { try probe.close() }
                #expect(try read(url).standing == .inSession(class1042, .focused))
                let bound = TimeInterval(patience.components.seconds)
                let words = ShieldWords(outboxAt: url, over: .app, now: t0, within: bound)
                #expect(words.title.hasPrefix("Focused with Bali until "))
                #expect(
                    Bell.wake(outboxAt: url, now: t0, within: bound)
                        == .keep(Bell.window(until: at(1720))))
            }
        }
    #endif
}

#if os(Linux)
    /// Closing a connection to one file fails, while `closing` runs: each connection SQLite opens to
    /// it keeps a statement never finalized, so `sqlite3_close` answers SQLITE_BUSY, which GRDB
    /// throws. Linux only: Apple's SQLite takes no process-wide extension.
    private enum Unclosable {
        static let lock = NSLock()
        nonisolated(unsafe) static var path: String?
        nonisolated(unsafe) static var statements: [OpaquePointer] = []

        /// What SQLite runs as it opens each connection, once registered.
        static let open: @convention(c) (OpaquePointer?, OpaquePointer?, OpaquePointer?) -> Int32 = {
            db, _, _ in
            let name = sqlite3_db_filename(db, "main").map { String(cString: $0) }
            guard let name, name == Unclosable.lock.withLock({ Unclosable.path }) else {
                return SQLITE_OK
            }
            var statement: OpaquePointer?
            if sqlite3_prepare_v2(db, "SELECT 1", -1, &statement, nil) == SQLITE_OK, let statement {
                Unclosable.lock.withLock { Unclosable.statements.append(statement) }
            }
            return SQLITE_OK
        }

        /// `body`, run while closing a connection to the file at `url` fails; after it, the
        /// statements are finalized, and the connections left open close.
        static func closing(_ url: URL, _ body: () throws -> Void) rethrows {
            let entry = unsafeBitCast(open, to: (@convention(c) () -> Void).self)
            lock.withLock { path = url.path(percentEncoded: false) }
            sqlite3_auto_extension(entry)
            defer {
                sqlite3_cancel_auto_extension(entry)
                lock.withLock {
                    for statement in statements { sqlite3_finalize(statement) }
                    (path, statements) = (nil, [])
                }
            }
            try body()
        }
    }
#endif
