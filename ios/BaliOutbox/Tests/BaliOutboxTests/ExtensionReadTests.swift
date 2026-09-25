import BaliCore
import Foundation
import GRDB
import Testing

@testable import BaliOutbox

/// The extensions' read of the file at `url`, waiting for it as long as the tests wait for
/// anything: a stall of the iOS Simulator's never reads as the file held (`BoundTests` has the
/// bound).
private func read(_ url: URL) throws -> SyncState {
    try Outbox.read(url, within: TimeInterval(patience.components.seconds))
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
        "A file this build has yet to migrate — the app not opened since an update, B6a's v3 and B6b's v4 — is migrated where it is read, once, as the app's open would: the shield says the bell, the bell clears the shields, and the read after is read only"
    )
    func older() throws {
        let bound = TimeInterval(patience.components.seconds)
        for version in ["v2", "v3"] {
            let shielded = try madeBy(version)
            let words = ShieldWords(outboxAt: shielded, over: .app, now: t0, within: bound)
            #expect(words.title.hasPrefix("Focused with Bali until "), "\(version)")
            let belled = try madeBy(version)
            #expect(
                Bell.wake(outboxAt: belled, now: at(1720), within: bound) == .clear, "\(version)")
            for url in [shielded, belled] {
                #expect(try applied(url) == ["v1", "v2", "v3", "v4"], "\(version)")
                let (file, wal) = (bytes(url), bytes(url, "-wal"))
                let state = try read(url)
                #expect(state.standing == .inSession(class1042, .focused), "\(version)")
                #expect(state.queued.map(\.eventId) == ["e0"], "\(version)")
                #expect(bytes(url) == file && bytes(url, "-wal") == wal, "\(version)")
            }
        }
    }

    @Test(
        "A migration the bound cuts off — the app writing the file just then — leaves nothing half done: the shields kept, and the next wake migrates the file and clears them"
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
        let cut = Bell.wake(outboxAt: url, now: at(1720), within: 0.5)
        // Looked at while the app still writes: on the phone, the migration the bound gave up on
        // may run on (the ceiling), but it cannot go through past that write.
        let halfway = Result { try applied(url) }
        release.signal()
        released.wait()
        #expect(cut == .retry(Bell.window(until: at(1780))))
        #expect(try halfway.get() == ["v1", "v2", "v3"])
        let bound = TimeInterval(patience.components.seconds)
        #expect(Bell.wake(outboxAt: url, now: at(1720), within: bound) == .clear)
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
}
