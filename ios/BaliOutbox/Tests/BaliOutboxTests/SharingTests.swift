import BaliCore
import Foundation
import GRDB
import GRDBSQLite
import Testing

@testable import BaliOutbox

/// The app and an extension open one file (B5): two connections, as two processes would. Serialized,
/// and the only suite whose outboxes hear GRDB's suspension notifications, which reach every
/// database in the process.
@Suite("One file, two processes", .serialized, .timeLimit(.minutes(1)))
struct SharingTests {
    @Test("Each sees what the other queued, and a write waits out the other's instead of failing")
    func twoProcesses() throws {
        let url = temporaryFile()
        let (app, monitor) = (try open(url), try open(url))
        let tap = try #require(try app.record(.tap(tagId: "tag"), now: t0))
        #expect(try monitor.records() == [tap])

        // The monitor holds the write lock half a second; the app's write waits, then goes.
        let (holding, done) = (DispatchSemaphore(value: 0), DispatchSemaphore(value: 0))
        DispatchQueue.global().async {
            try? monitor.pool.write { db in
                try db.execute(sql: "INSERT INTO outboxState (key, value) VALUES ('probe', 'x')")
                holding.signal()
                Thread.sleep(forTimeInterval: 0.5)
            }
            done.signal()
        }
        holding.wait()
        let started = Date()
        let unlock = try #require(try app.record(.unlock(session: "s", reason: nil), now: t0))
        let waited = Date().timeIntervalSince(started)
        done.wait()
        #expect(waited >= 0.3, "\(waited)")
        #expect(try monitor.records() == [tap, unlock])
    }

    @Test(
        "Persistent WAL: the WAL files outlive the last writer, so a process that only reads can open the file"
    )
    func persistentWAL() throws {
        let url = temporaryFile()
        let app = try open(url)
        let tap = try #require(try app.record(.tap(tagId: "tag"), now: t0))
        // Asked, not set: -1 reads the connection's flag. (GRDB closes its readers last, so the
        // files would outlive this pool anyway — the flag is what keeps them for any writer.)
        let persists = try app.pool.write { db in
            var flag: CInt = -1
            _ = sqlite3_file_control(db.sqliteConnection, nil, SQLITE_FCNTL_PERSIST_WAL, &flag)
            return flag
        }
        #expect(persists == 1)
        try app.pool.close()
        let path = url.path(percentEncoded: false)
        #expect(FileManager.default.fileExists(atPath: path + "-wal"))
        #expect(FileManager.default.fileExists(atPath: path + "-shm"))
        var configuration = Configuration()
        configuration.readonly = true
        let reader = try DatabasePool(path: path, configuration: configuration)
        #expect(
            try reader.read { try String.fetchAll($0, sql: "SELECT eventId FROM outbox") }
                == [tap.eventId])
    }

    @Test("A file a newer build has migrated is refused, never written through a schema this one does not know")
    func tooNew() throws {
        let url = temporaryFile()
        let app = try open(url)
        try app.pool.write {
            try $0.execute(sql: "INSERT INTO grdb_migrations (identifier) VALUES ('v2')")
        }
        try app.pool.close()
        #expect(throws: Outbox.TooNew.self) { try open(url) }
    }

    @Test(
        "Suspended, the outbox takes no lock — a write fails as suspension, a read still goes — and resumed, the write goes"
    )
    func suspension() throws {
        let outbox = try suspending(temporaryFile())
        let tap = try #require(try outbox.record(.tap(tagId: "tag"), now: t0))
        Outbox.suspend()
        defer { Outbox.resume() }
        let error = #expect(throws: (any Error).self) {
            try outbox.record(.unlock(session: "s", reason: nil), now: t0)
        }
        #expect(error.map(Outbox.isSuspension) == true)
        #expect(!Outbox.isSuspension(DatabaseError(resultCode: .SQLITE_FULL)))
        #expect(try outbox.records() == [tap])
        Outbox.resume()
        #expect(try outbox.record(.unlock(session: "s", reason: nil), now: t0) != nil)
        #expect(try outbox.records().count == 2)
    }

    @Test(
        "An answer that comes back while the app is suspended is not lost: the unlock stays queued, and goes again once the app is back"
    )
    func engineSuspended() async throws {
        let rig = try Rig(outbox: try suspending(temporaryFile()))
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        let sent = try await rig.server.next(unlockRoute)
        Outbox.suspend()
        defer { Outbox.resume() }
        sent.reply(200, Answer.unlocked())
        try await Task.sleep(for: .milliseconds(100))
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])
        // Suspension is not a failure to show: the engine waits for the app to come back.
        #expect(await rig.engine.state.link != .storageFailed)
        #expect(rig.clock.deadlines.isEmpty)
        Outbox.resume()
        await rig.engine.setForeground(true)
        let again = try await rig.server.next(unlockRoute)
        #expect(again.eventId == unlock.eventId)
        again.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    /// An outbox that hears the suspension notifications, as the app's does.
    func suspending(_ url: URL) throws -> Outbox {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        return try Outbox(at: url, random: { 0 }, suspends: true)
    }
}
