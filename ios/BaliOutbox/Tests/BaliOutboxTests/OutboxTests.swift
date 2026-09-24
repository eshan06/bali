import BaliCore
import Foundation
import GRDB
import Testing

@testable import BaliOutbox

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
        #expect(applied == ["v1"])
        #expect(
            columns == [
                "seq", "eventId", "kind", "tagId", "sessionId", "reason", "follows", "recordedAt",
                "attempts", "answers", "nextAttemptAt", "stuck", "lastStatus", "lastReason",
                "lastMessage",
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
        #expect(applied == ["v1"])
    }

    @Test("The schema refuses a row its kind could not send")
    func refusesMalformedRows() throws {
        let (outbox, _) = try makeOutbox()
        let insert =
            "INSERT INTO outbox (eventId, kind, tagId, sessionId, recordedAt, nextAttemptAt)"
        for values in [
            "('a', 'tap', NULL, NULL, 0, 0)",  // a tap with no tag
            "('b', 'tap', 'tag', 's', 0, 0)",  // a tap with a session
            "('c', 'unlock', NULL, NULL, 0, 0)",  // an unlock with no session
            "('d', 'refocus', 'tag', 's', 0, 0)",  // a refocus with a tag
            "('e', 'checkin', NULL, 's', 0, 0)",  // not an outbox kind
        ] {
            #expect(throws: DatabaseError.self, "\(values)") {
                try outbox.pool.write { try $0.execute(sql: "\(insert) VALUES \(values)") }
            }
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
            .tap(tagId: "04:A2:1B"), .unlock(session: "s", reason: .bathroom),
            .unlock(session: "s", reason: nil), .refocus(session: "s"),
            .protectionOff(session: "s"),
        ]
        var records: [OutboxRecord] = []
        for change in changes { records.append(try record(outbox, change, at: at)) }
        // The unlock after the first superseded nothing; the refocus follows the second.
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
        #expect(
            records.map(\.request) == [
                .tap(TapRequest(tagId: "04:A2:1B", eventId: id[0], deviceTime: at)),
                .unlock(
                    session: "s", UnlockRequest(eventId: id[1], deviceTime: at, reason: .bathroom)),
                .unlock(session: "s", UnlockRequest(eventId: id[2], deviceTime: at)),
                .refocus(session: "s", RefocusRequest(eventId: id[3], deviceTime: at)),
                .protectionOff(session: "s", ProtectionOffRequest(eventId: id[4], deviceTime: at)),
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
        "A later tap or unlock supersedes every queued refocus: deleted, never sent",
        arguments: [Change.tap(tagId: "tag"), .unlock(session: "s", reason: nil)])
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
