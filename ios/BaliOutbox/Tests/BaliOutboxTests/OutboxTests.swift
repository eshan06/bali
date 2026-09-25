import BaliCore
import Foundation
import GRDB
import Testing

@testable import BaliOutbox

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

@Suite("The outbox's database")
struct SchemaTests {
    @Test("An empty file is migrated to the schema, and holds nothing")
    func migratesEmpty() throws {
        let (outbox, _) = try makeOutbox()
        let (applied, columns, state) = try outbox.pool.read { db in
            (
                try Outbox.migrator.appliedMigrations(db),
                try db.columns(in: "outbox").map(\.name),
                try db.columns(in: "outboxState").map(\.name)
            )
        }
        #expect(applied == ["v1", "v2", "v3"])
        #expect(
            columns == [
                "seq", "eventId", "kind", "tagId", "sessionId", "tapId", "reason", "follows",
                "recordedAt", "attempts", "answers", "nextAttemptAt", "stuck", "lastStatus",
                "lastReason", "lastMessage",
            ])
        #expect(state == ["key", "value"])
        #expect(try outbox.records().isEmpty)
        #expect(try outbox.nextDue(now: t0) == .idle)
        #expect(try outbox.awaiting() == 0)
    }

    @Test(
        "What is queued outlives the process: reopened, the file holds it all, and the rules' state"
    )
    func reopens() async throws {
        let (outbox, url) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: .nurse))
        try await send(outbox, unlock, 409, #"{"error":{"code":"conflict","message":"no"}}"#)
        try record(outbox, .refocus(session: "s"))
        try record(outbox, .protectionOff(session: "s"))

        let reopened = try open(url)
        #expect(try reopened.records() == outbox.records())
        #expect(try reopened.records().count == 3)
        // Protection off was reported for this session: reopening does not report it again.
        #expect(try reopened.record(.protectionOff(session: "s"), now: t0) == nil)
        let applied = try await reopened.pool.read { try Outbox.migrator.appliedMigrations($0) }
        #expect(applied == ["v1", "v2", "v3"])
    }

    @Test("The schema refuses a row its kind could not send")
    func refusesMalformedRows() throws {
        let (outbox, _) = try makeOutbox()
        let insert =
            "INSERT INTO outbox (eventId, kind, tagId, sessionId, tapId, recordedAt, nextAttemptAt)"
        for values in [
            "('a', 'tap', NULL, NULL, NULL, 0, 0)",  // a tap with no tag
            "('b', 'tap', 'tag', 's', NULL, 0, 0)",  // a tap with a session
            "('c', 'unlock', NULL, NULL, NULL, 0, 0)",  // an unlock with no session, nor tap
            "('d', 'refocus', 'tag', 's', NULL, 0, 0)",  // a refocus with a tag
            "('e', 'checkin', NULL, 's', NULL, 0, 0)",  // not an outbox kind
            "('f', 'tap', 'tag', NULL, 't', 0, 0)",  // a tap filed under a tap
            "('g', 'refocus', NULL, 's', 't', 0, 0)",  // a refocus filed under a tap
            "('h', 'protection_off', NULL, NULL, 't', 0, 0)",  // protection off with no session
        ] {
            #expect(throws: DatabaseError.self, "\(values)") {
                try outbox.pool.write { try $0.execute(sql: "\(insert) VALUES \(values)") }
            }
        }
        // An unlock filed under its tap (decision 11): no session until the tap's answer names one.
        try outbox.pool.write {
            try $0.execute(sql: "\(insert) VALUES ('i', 'unlock', NULL, NULL, 't', 0, 0)")
            try $0.execute(sql: "\(insert) VALUES ('j', 'unlock', NULL, 's', 't', 0, 0)")
        }
    }

    @Test(
        "A file the last build made keeps what it queued, and its counter: what the phone does next still comes after everything it did, the queue drained or not (A12)"
    )
    func fromV2() throws {
        for drained in [true, false] {
            let url = temporaryFile()
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let old = try DatabasePool(path: url.path(percentEncoded: false))
            try Outbox.migrator.migrate(old, upTo: "v2")
            try old.write { db in
                for (index, kind) in ["tap", "unlock", "refocus"].enumerated() {
                    try db.execute(
                        sql: """
                            INSERT INTO outbox (eventId, kind, tagId, sessionId, reason, recordedAt,
                              nextAttemptAt, attempts, stuck, lastStatus)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 3, 1, 409)
                            """,
                        arguments: [
                            "e\(index)", kind, kind == "tap" ? "tag" : nil,
                            kind == "tap" ? nil : "s", kind == "unlock" ? "nurse" : nil, t0, t0,
                        ])
                }
                // The first and the last answered and gone — or all three: the counter stays at
                // three, above every seq the table still holds.
                try db.execute(
                    sql: "DELETE FROM outbox WHERE eventId != 'e1' OR ?", arguments: [drained])
            }
            try old.close()

            let outbox = try open(url)
            let applied = try outbox.pool.read { try Outbox.migrator.appliedMigrations($0) }
            #expect(applied == ["v1", "v2", "v3"])
            let kept = try outbox.records()
            let install = try #require(try installOf(outbox))
            let queued: [Change] = [.unlock(session: "s", reason: .nurse)]
            #expect(kept.map(\.change) == (drained ? [] : queued))
            #expect(
                kept.map(\.order)
                    == (drained ? [] : [2]).map { ActionOrder(install: install, seq: $0) })
            #expect(kept.allSatisfy { $0.attempts == 3 && $0.stuck && $0.lastStatus == 409 })
            #expect(try record(outbox, .tap(tagId: "tag")).order?.seq == 4)
            #expect(try record(outbox, .unlockUnderTap(tap: "e9", reason: nil)).order?.seq == 5)
        }
    }
}

@Suite("Queuing what the phone did")
struct RecordTests {
    @Test(
        "Each change is queued under a new UUIDv7 minted at that moment, due at once, sent as its request"
    )
    func queues() throws {
        let (outbox, _) = try makeOutbox()
        let at = t0.addingTimeInterval(7)
        let changes: [Change] = [
            .tap(tagId: "04:A2:1B"), .unlockUnderTap(tap: "t", reason: .nurse),
            .unlock(session: "s", reason: .bathroom), .unlock(session: "s", reason: nil),
            .refocus(session: "s"), .protectionOff(session: "s"),
        ]
        var records: [OutboxRecord] = []
        for change in changes { records.append(try record(outbox, change, at: at)) }
        // The unlocks superseded nothing; the refocus follows the last.
        #expect(try outbox.records() == records)
        for record in records {
            #expect(record.eventId.wholeMatch(of: Self.uuidV7) != nil, "\(record.eventId)")
            // Its first 48 bits are the time it was recorded, in milliseconds.
            #expect(
                UInt64(record.eventId.replacing("-", with: "").prefix(12), radix: 16)
                    == 1_790_000_007_000)
            #expect(record.recordedAt == at && record.nextAttemptAt == at)
            #expect(record.attempts == 0 && record.answers == 0 && !record.stuck)
            #expect(
                record.lastStatus == nil && record.lastReason == nil && record.lastMessage == nil)
        }
        #expect(Set(records.map(\.eventId)).count == records.count)
        let id = records.map(\.eventId)
        // Each with its place in what the phone did (A12): the file's install, its own seq.
        let install = try #require(try installOf(outbox))
        let nth = { ActionOrder(install: install, seq: $0) }
        #expect(
            records.map(\.request) == [
                .tap(TapRequest(tagId: "04:A2:1B", eventId: id[0], deviceTime: at, order: nth(1))),
                // Filed under its tap (decision 11), with its own order like every record.
                .unlockUnderTap(
                    tap: "t",
                    UnlockRequest(eventId: id[1], deviceTime: at, reason: .nurse, order: nth(2))),
                .unlock(
                    session: "s",
                    UnlockRequest(
                        eventId: id[2], deviceTime: at, reason: .bathroom, order: nth(3))),
                .unlock(session: "s", UnlockRequest(eventId: id[3], deviceTime: at, order: nth(4))),
                .refocus(
                    session: "s", RefocusRequest(eventId: id[4], deviceTime: at, order: nth(5))),
                .protectionOff(
                    session: "s",
                    ProtectionOffRequest(eventId: id[5], deviceTime: at, order: nth(6))),
            ])
        #expect(records.map(\.change) == changes)
    }

    static var uuidV7: Regex<Substring> {
        /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/
    }

    @Test("Event ids never repeat, and carry the clock to the millisecond")
    func eventIds() {
        let ids = (0..<2000).map { EventID.mint(at: t0.addingTimeInterval(Double($0) / 1000)) }
        #expect(Set(ids).count == ids.count)
        #expect(ids.allSatisfy { $0.wholeMatch(of: Self.uuidV7) != nil })
        #expect(ids.map { $0.prefix(13) } == ids.map { $0.prefix(13) }.sorted())
        let id = EventID.mint(at: Date(timeIntervalSince1970: 1_790_000_000.25))
        #expect(UInt64(id.replacing("-", with: "").prefix(12), radix: 16) == 1_790_000_000_250)
    }

    @Test(
        "A later tap or unlock — one filed under a tap too — supersedes every queued refocus: deleted, never sent",
        arguments: [
            Change.tap(tagId: "tag"), .unlock(session: "s", reason: nil),
            .unlockUnderTap(tap: "t", reason: nil),
        ])
    func supersedes(later: Change) async throws {
        let (outbox, _) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        let report = try record(outbox, .protectionOff(session: "s"))
        try record(outbox, .refocus(session: "s"))
        try record(outbox, .refocus(session: "t"))
        let tap = try record(outbox, .tap(tagId: "tag"))
        // A refocus queued after the tap is superseded in its turn.
        let inFlight = try record(outbox, .refocus(session: "s"))
        let latest = try record(outbox, later)

        #expect(
            try outbox.records().map(\.eventId) == [unlock, report, tap, latest].map(\.eventId))
        // One that was in flight comes back to nothing: its answer is older than the phone's truth.
        #expect(try await send(outbox, inFlight, 200, #"{"outcome":"applied"}"#) == nil)
        // Nothing supersedes an unlock, a tap or a protection-off report.
        try record(outbox, .tap(tagId: "tag"))
        try record(outbox, .unlock(session: "s", reason: nil))
        #expect(try outbox.records().count == 6)
    }

    @Test(
        "Protection off is reported once per revocation, and again after a tap, in another session, or once restored"
    )
    func protectionOffOnce() throws {
        let (outbox, _) = try makeOutbox()
        let first = try record(outbox, .protectionOff(session: "s"))
        // Every later check-in that finds the permission still revoked: nothing new.
        #expect(try outbox.record(.protectionOff(session: "s"), now: t0) == nil)
        #expect(try outbox.record(.protectionOff(session: "s"), now: t0) == nil)
        // An unlock or a refocus does not return the row to focused.
        try record(outbox, .unlock(session: "s", reason: nil))
        try record(outbox, .refocus(session: "s"))
        #expect(try outbox.record(.protectionOff(session: "s"), now: t0) == nil)

        // A tap does — reported again, under a new id.
        try record(outbox, .tap(tagId: "tag"))
        let afterTap = try record(outbox, .protectionOff(session: "s"))
        #expect(afterTap.eventId != first.eventId)
        #expect(try outbox.record(.protectionOff(session: "s"), now: t0) == nil)

        // A join the phone did not tap for — an armed tap converted at Start — is another session.
        try record(outbox, .protectionOff(session: "t"))
        #expect(try outbox.record(.protectionOff(session: "t"), now: t0) == nil)

        // Restored, then revoked again: a new revocation.
        try outbox.protectionRestored()
        try record(outbox, .protectionOff(session: "t"))

        let reports = try outbox.records().filter {
            if case .protectionOff = $0.change { true } else { false }
        }
        #expect(reports.count == 4)
    }
}

@Suite("The phone's own order (A12)")
struct ActionOrderTests {
    @Test(
        "Each file is given its install once: a lower-case UUID, the same every time it opens, another file's its own"
    )
    func install() throws {
        let (outbox, url) = try makeOutbox()
        let install = try #require(try installOf(outbox))
        #expect(install.wholeMatch(of: Self.uuid) != nil, "\(install)")
        #expect(try installOf(open(url)) == install)
        #expect(try installOf(makeOutbox().outbox) != install)
    }

    @Test(
        "Each record goes with its own seq — never reused once a record is gone — and the same one on every retry"
    )
    func seqs() async throws {
        let (outbox, _) = try makeOutbox()
        let nth = { ActionOrder(install: try #require(try installOf(outbox)), seq: $0) }
        let tap = try record(outbox, .tap(tagId: "tag"))
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        #expect(try tap.order == nth(1) && unlock.order == nth(2))
        // The tap answered and gone, the next record still comes after it.
        try await send(outbox, tap, 200, #"{"outcome":"armed","session":null,"state":null}"#)
        #expect(try current(outbox, tap.eventId) == nil)
        #expect(try record(outbox, .refocus(session: "s")).order == nth(3))

        // Unanswered and sent again: the same order on the wire each time.
        let wire = Wire()
        let client = APIClient(
            baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(), transport: wire)
        for _ in 0..<2 {
            let queued = try #require(try current(outbox, unlock.eventId))
            try outbox.settle(await queued.send(through: client), now: t0)
        }
        #expect(try await wire.orders == [nth(2), nth(2)])
    }

    @Test("A file the last build made is given its install, and what it queued goes with its seq")
    func fromV1() throws {
        let url = temporaryFile()
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let old = try DatabasePool(path: url.path(percentEncoded: false))
        try Outbox.migrator.migrate(old, upTo: "v1")
        try old.write {
            try $0.execute(
                sql: """
                    INSERT INTO outbox (eventId, kind, sessionId, recordedAt, nextAttemptAt)
                    VALUES ('e1', 'unlock', 's', ?, ?)
                    """, arguments: [t0, t0])
        }
        try old.close()

        let outbox = try open(url)
        let install = try #require(try installOf(outbox))
        #expect(try outbox.records().map(\.order) == [ActionOrder(install: install, seq: 1)])
        let applied = try outbox.pool.read { try Outbox.migrator.appliedMigrations($0) }
        #expect(applied == ["v1", "v2", "v3"])
    }

    static var uuid: Regex<Substring> {
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    }
}

/// Answers every request 503, keeping the order each body carried.
actor Wire: HTTPTransport {
    private(set) var orders: [ActionOrder?] = []

    struct Body: Decodable { let order: ActionOrder? }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        orders.append(try JSONDecoder().decode(Body.self, from: request.httpBody ?? Data()).order)
        guard let url = request.url,
            let response = HTTPURLResponse(
                url: url, statusCode: 503, httpVersion: "HTTP/1.1", headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(), response)
    }
}
