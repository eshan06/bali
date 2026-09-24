import BaliCore
import Foundation
import GRDB

/// The phone's outbox: each tap, emergency unlock, refocus and protection-off report it acted on,
/// kept until an answer lets it go. BaliCore's tables say what an answer means; this applies them,
/// with the rules no table can express (docs/DECISIONS.md, B3a). The sync engine (B3b) sends
/// `nextDue`'s `request` through `APIClient` and hands the answer to `settle`, each with its `now`.
public struct Outbox: Sendable {
    /// The app group the app and its extensions share (ARCHITECTURE, iOS decision 3).
    public static let appGroup = "group.com.bali.shared"
    /// How many server answers may leave a record unsettled before it is stuck.
    public static let bound = 8
    /// The longest backoff, before its jitter.
    public static let backoffCap: TimeInterval = 60

    let pool: DatabasePool
    let random: @Sendable () -> Double

    /// The outbox at `url`, created and migrated as needed; `random`, in 0..<1, is the jitter's.
    public init(at url: URL, random: @escaping @Sendable () -> Double = { .random(in: 0..<1) })
        throws
    {
        pool = try DatabasePool(path: url.path(percentEncoded: false))
        try Self.migrator.migrate(pool)
        self.random = random
    }

    #if canImport(Darwin)
        /// Where the apps keep it: the app group's container, which the extensions can open too.
        public static var appGroupURL: URL? {
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
                .appending(path: "outbox.sqlite")
        }
    #endif

    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        // Records go in `seq` order; `outboxState` holds the rules' own state.
        migrator.registerMigration("v1") { db in
            try db.execute(
                sql: """
                    CREATE TABLE outbox (
                      seq INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT NOT NULL UNIQUE,
                      kind TEXT NOT NULL
                        CHECK (kind IN ('tap', 'unlock', 'refocus', 'protection_off')),
                      tagId TEXT CHECK ((kind = 'tap') = (tagId IS NOT NULL)),
                      sessionId TEXT CHECK ((kind = 'tap') = (sessionId IS NULL)),
                      reason TEXT, follows TEXT, recordedAt TEXT NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0,
                      nextAttemptAt TEXT NOT NULL, stuck INTEGER NOT NULL DEFAULT 0,
                      lastStatus INTEGER, lastReason TEXT, lastMessage TEXT);
                    CREATE TABLE outboxState (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    """)
        }
        return migrator
    }

    /// The session protection off was last reported for, and the latest unlock's id.
    static let reportedKey = "protectionOffReported"
    static let lastUnlockKey = "lastUnlock"

    /// Queues what the phone just did under a fresh event id, due at once. A tap or an unlock
    /// supersedes every queued refocus (deleted, never sent: it could only make the truth older).
    /// Protection off is reported once per revocation — nil when already reported in this session —
    /// and again after a tap, which returns the row to focused, or `protectionRestored`.
    @discardableResult
    public func record(_ change: Change, now: Date) throws -> OutboxRecord? {
        try pool.write { db in
            let eventId = EventID.mint(at: now)
            var follows: String?
            let row: (kind: String, tagId: String?, session: String?, reason: UnlockReason?)
            switch change {
            case .tap(let tagId):
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.reportedKey, nil)
                row = ("tap", tagId, nil, nil)
            case .unlock(let session, let reason):
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.lastUnlockKey, eventId)
                row = ("unlock", nil, session, reason)
            case .refocus(let session):
                // The unlock it returns from — the latest — while it is queued, in this session.
                follows = try String.fetchOne(
                    db, sql: "SELECT eventId FROM outbox WHERE sessionId = ? AND eventId = ?",
                    arguments: [session, Self.state(db, Self.lastUnlockKey)])
                row = ("refocus", nil, session, nil)
            case .protectionOff(let session):
                if try Self.state(db, Self.reportedKey) == session { return nil }
                try Self.setState(db, Self.reportedKey, session)
                row = ("protection_off", nil, session, nil)
            }
            try db.execute(
                sql: """
                    INSERT INTO outbox (eventId, kind, tagId, sessionId, reason, follows,
                      recordedAt, nextAttemptAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    eventId, row.kind, row.tagId, row.session, row.reason?.rawValue, follows, now,
                    now,
                ])
            return try Self.fetch(db, eventId)
        }
    }

    /// The Screen Time permission is back: a later revocation is a new one, reported again.
    public func protectionRestored() throws {
        try pool.write { try Self.setState($0, Self.reportedKey, nil) }
    }

    public enum Due: Sendable, Hashable {
        case send(OutboxRecord)
        /// Nothing is due before then.
        case wait(until: Date)
        /// Nothing is queued.
        case idle
    }

    /// The next record to send, in the order the phone acted. A pending (not stuck) record holds
    /// every record behind it, backoff included; a stuck one holds nothing, retried on its own
    /// backoff among them. A refocus waits for the unlock it returns from to be recorded, stuck or
    /// not: landing after it, that unlock would leave the server's truth `unlocked`.
    public func nextDue(now: Date) throws -> Due {
        let records = try records()
        let queued = Set(records.map(\.eventId))
        var wake: Date?
        for record in records {
            if let unlock = record.follows, queued.contains(unlock) { continue }
            if record.nextAttemptAt <= now { return .send(record) }
            wake = min(wake ?? record.nextAttemptAt, record.nextAttemptAt)
            if !record.stuck { break }
        }
        return wake.map { .wait(until: $0) } ?? .idle
    }

    /// Applies one send's answer (`APIClient`'s, to the record's `request`) by the record's table,
    /// and returns the disposition for the sync engine; nil once the record is gone — superseded in
    /// flight, so its answer is older than the phone's truth. An ending disposition deletes it; any
    /// other keeps it, due after `backoff`, with its answer for a screen: stuck at a refusal, or at
    /// `bound` answers that left it unsettled (any status but 401, 408 and 429, none of them this
    /// record's). Stuck stays stuck, and never deletes: an unlock leaves only once recorded.
    @discardableResult
    public func settle<Answer>(eventId: String, with response: APIResponse<Answer>, now: Date)
        throws -> Disposition?
    {
        try pool.write { db in
            guard let record = try Self.fetch(db, eventId) else { return nil }
            let disposition = Disposition(record.change, response)
            guard disposition.keeps else {
                try db.execute(sql: "DELETE FROM outbox WHERE eventId = ?", arguments: [eventId])
                return disposition
            }
            var status: Int?
            if case .status(let code) = response.result { status = code }
            let answered = status.map { ![401, 408, 429].contains($0) } ?? false
            let (attempts, answers) = (record.attempts + 1, record.answers + (answered ? 1 : 0))
            try db.execute(
                sql: """
                    UPDATE outbox SET attempts = ?, answers = ?, stuck = ?, nextAttemptAt = ?,
                      lastStatus = ?, lastReason = ?, lastMessage = ? WHERE eventId = ?
                    """,
                arguments: [
                    attempts, answers, record.stuck || disposition.refused || answers >= Self.bound,
                    now + backoff(attempts), status, response.error?.error.reason?.rawValue,
                    response.error?.error.message, eventId,
                ])
            return disposition
        }
    }

    /// The wait after a record's `attempt`-th unsettled send: 2 s, 4 s, 8 s… up to `backoffCap`,
    /// plus up to as much again at random, so a school's phones never retry in unison.
    func backoff(_ attempt: Int) -> TimeInterval {
        let wait = min(TimeInterval(1 << min(max(attempt, 1), 6)), Self.backoffCap)
        let jitter = random()
        return wait * (1 + ((0...1).contains(jitter) ? jitter : jitter > 1 ? 1 : 0))
    }

    /// How many changes await their answer, for `ReconcileStamp.awaiting`: every record not stuck,
    /// but a refocus waiting on a stuck unlock (the server has seen neither). A stuck record stops
    /// holding reads; an unrecorded unlock still guards its session (`holdsUnlock`).
    public func awaiting() throws -> Int {
        let records = try records()
        let stuck = Set(records.filter(\.stuck).map(\.eventId))
        return records.filter { !$0.stuck && !($0.follows.map(stuck.contains) ?? false) }.count
    }

    /// Whether an unrecorded unlock of `session` is queued. While one is, no read may put that
    /// session's shields back on: the emergency unlock stands until the server has it.
    public func holdsUnlock(session: String) throws -> Bool {
        try pool.read {
            try Bool.fetchOne(
                $0,
                sql: "SELECT EXISTS (SELECT 1 FROM outbox WHERE kind = 'unlock' AND sessionId = ?)",
                arguments: [session]) ?? false
        }
    }

    /// Everything queued, in the order the phone acted — for a screen to show what is stuck.
    public func records() throws -> [OutboxRecord] {
        try pool.read { try OutboxRecord.fetchAll($0, sql: "SELECT * FROM outbox ORDER BY seq") }
    }

    static func fetch(_ db: Database, _ eventId: String) throws -> OutboxRecord? {
        try OutboxRecord.fetchOne(
            db, sql: "SELECT * FROM outbox WHERE eventId = ?", arguments: [eventId])
    }

    static func state(_ db: Database, _ key: String) throws -> String? {
        try String.fetchOne(
            db, sql: "SELECT value FROM outboxState WHERE key = ?", arguments: [key])
    }

    static func setState(_ db: Database, _ key: String, _ value: String?) throws {
        guard let value else {
            return try db.execute(sql: "DELETE FROM outboxState WHERE key = ?", arguments: [key])
        }
        try db.execute(
            sql: "INSERT OR REPLACE INTO outboxState (key, value) VALUES (?, ?)",
            arguments: [key, value])
    }
}
