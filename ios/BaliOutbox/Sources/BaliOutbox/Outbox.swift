import BaliCore
import Foundation
import GRDB

/// The phone's outbox (ARCHITECTURE, "How a tap works", steps 2 and 6): every tap, emergency
/// unlock, refocus and protection-off report the phone has acted on, kept in SQLite until an answer
/// lets it go. What an answer means is BaliCore's tables' to say; this applies them, and the rules
/// no status-and-body table can express — supersession, the order records go in, backoff and the
/// retry bound (docs/DECISIONS.md, B3a). Sending is the sync engine's (B3b): it takes `nextDue`,
/// sends its `request` through `APIClient`, and hands the answer to `settle`. The clock is the
/// caller's: every call takes `now`.
public struct Outbox: Sendable {
    /// The app group the app and its extensions share (ARCHITECTURE, iOS decision 3).
    public static let appGroup = "group.com.bali.shared"
    /// How many server answers may leave a record unsettled before it is stuck.
    public static let bound = 8
    /// The longest backoff before its jitter.
    public static let backoffCap: TimeInterval = 60

    let pool: DatabasePool
    let random: @Sendable () -> Double

    /// The outbox at `url`, created and migrated as needed — `appGroupURL` in the apps. `random`
    /// is the jitter's source, uniform in 0..<1.
    public init(at url: URL, random: @escaping @Sendable () -> Double = { .random(in: 0..<1) })
        throws
    {
        pool = try DatabasePool(path: url.path(percentEncoded: false))
        try Self.migrator.migrate(pool)
        self.random = random
    }

    #if canImport(Darwin)
        /// Where the apps keep it: the app group's container, which the extensions can open too.
        /// Nil for a build without the app group (a test bundle).
        public static var appGroupURL: URL? {
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
                .appending(path: "outbox.sqlite")
        }
    #endif

    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            // One row per record, sent in `seq` order. `outboxState` holds the rules' own state:
            // the session protection off was last reported for, and the latest unlock's id.
            try db.execute(
                sql: """
                    CREATE TABLE outbox (
                      seq INTEGER PRIMARY KEY AUTOINCREMENT,
                      eventId TEXT NOT NULL UNIQUE,
                      kind TEXT NOT NULL CHECK (kind IN ('tap', 'unlock', 'refocus', 'protection_off')),
                      tagId TEXT CHECK ((kind = 'tap') = (tagId IS NOT NULL)),
                      sessionId TEXT CHECK ((kind = 'tap') = (sessionId IS NULL)),
                      reason TEXT,
                      follows TEXT,
                      recordedAt TEXT NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0,
                      answers INTEGER NOT NULL DEFAULT 0,
                      nextAttemptAt TEXT NOT NULL,
                      stuck INTEGER NOT NULL DEFAULT 0,
                      lastStatus INTEGER,
                      lastReason TEXT,
                      lastMessage TEXT
                    );
                    CREATE TABLE outboxState (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    """)
        }
        return migrator
    }

    static let reportedKey = "protectionOffReported"
    static let lastUnlockKey = "lastUnlock"

    /// Queues what the phone just did under a fresh event id, due at once, with the rules that go
    /// with it. A tap or an unlock supersedes every queued refocus — deleted, never sent: it could
    /// only make the phone's truth older. Protection off is reported once per revocation: nil when
    /// this session's was reported already, and again after a tap (which returns the row to
    /// focused) or `protectionRestored`. An unlock is always queued.
    @discardableResult
    public func record(_ change: Change, now: Date) throws -> OutboxRecord? {
        try pool.write { db in
            let eventId = EventID.mint(at: now)
            var follows: String?
            switch change {
            case .tap:
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.reportedKey, nil)
            case .unlock:
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.lastUnlockKey, eventId)
            case .refocus(let session):
                // The unlock this returns from, if still unrecorded: the latest one, in this session.
                follows = try String.fetchOne(
                    db,
                    sql: """
                        SELECT eventId FROM outbox WHERE sessionId = ? AND eventId =
                          (SELECT value FROM outboxState WHERE key = ?)
                        """, arguments: [session, Self.lastUnlockKey])
            case .protectionOff(let session):
                if try Self.state(db, Self.reportedKey) == session { return nil }
                try Self.setState(db, Self.reportedKey, session)
            }
            var tagId: String?
            var reason: UnlockReason?
            if case .tap(let tag) = change { tagId = tag }
            if case .unlock(_, let given) = change { reason = given }
            try db.execute(
                sql: """
                    INSERT INTO outbox
                      (eventId, kind, tagId, sessionId, reason, follows, recordedAt, nextAttemptAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    eventId, change.kind, tagId, change.session, reason?.rawValue, follows, now, now,
                ])
            return try Self.fetch(db, eventId)
        }
    }

    /// The Screen Time permission is back: a later revocation is a new one, reported again.
    public func protectionRestored() throws {
        try pool.write { try Self.setState($0, Self.reportedKey, nil) }
    }

    /// What to send next.
    public enum Due: Sendable, Hashable {
        case send(OutboxRecord)
        /// Nothing is due before then.
        case wait(until: Date)
        /// Nothing to send until something changes: the outbox is empty, or what it holds waits on
        /// an unlock to be recorded.
        case idle
    }

    /// The next record to send, in the order the phone acted. A pending record — not yet stuck —
    /// holds every record behind it, backoff included, so nothing overtakes it: an unlock always
    /// goes ahead of a later refocus. A stuck record holds nothing (a kept record never blocks the
    /// ones behind it): it is retried on its own backoff among them. And a refocus waits for the
    /// unlock it returns from to be recorded, stuck or not — sent ahead of it, the refocus would
    /// leave the server's truth at `unlocked` when that unlock landed.
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

    /// Applies one send's answer — what `APIClient` returned for the record's `request` — by the
    /// record's table, and returns the disposition for the sync engine to act on. Nil when the
    /// record is gone — superseded while in flight — so its answer is older than the phone's truth
    /// and must not be applied.
    ///
    /// A disposition that ends the record deletes it; any other keeps it, due again after
    /// `backoff`, its answer kept for a screen. A refusal (`retry_and_surface`) makes it stuck at
    /// once, and so do `bound` answers from the server that left it unsettled — each status but
    /// 401 (sign-in's), 408 and 429 (the network's and load's), none of which is this record's.
    /// Stuck stays stuck, and is never a deletion: an unlock leaves only once recorded, a tap only
    /// on a 2xx, and a state change the server never decided on is never dropped.
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
            let answers = record.answers + (status.map { ![401, 408, 429].contains($0) } == true ? 1 : 0)
            let attempts = record.attempts + 1
            try db.execute(
                sql: """
                    UPDATE outbox SET attempts = ?, answers = ?, stuck = ?, nextAttemptAt = ?,
                      lastStatus = ?, lastReason = ?, lastMessage = ?
                    WHERE eventId = ?
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
    /// plus up to as much again at random, so a school's phones never retry in unison
    /// (ARCHITECTURE, tap step 6).
    func backoff(_ attempt: Int) -> TimeInterval {
        let wait = min(TimeInterval(1 << min(max(attempt, 1), 6)), Self.backoffCap)
        return wait * (1 + min(max(random(), 0), 1))
    }

    /// Makes every record due at `now` — the student's retry (rule 5), a fresh token after
    /// `reauth`, the network back. A stuck record stays stuck.
    public func retryNow(_ now: Date) throws {
        try pool.write {
            try $0.execute(sql: "UPDATE outbox SET nextAttemptAt = ?", arguments: [now])
        }
    }

    /// How many of the phone's changes still await their answer, for `ReconcileStamp.awaiting`:
    /// every record not stuck — but a refocus waiting on a stuck unlock, since the server has seen
    /// neither, so no read can be newer than the phone about them. A stuck record stops counting
    /// (the bound): a read reconciles past it, and an unrecorded unlock still guards its session
    /// (`holdsUnlock`).
    public func awaiting() throws -> Int {
        let records = try records()
        let stuck = Set(records.filter(\.stuck).map(\.eventId))
        return records.filter { !$0.stuck && !($0.follows.map(stuck.contains) ?? false) }.count
    }

    /// Whether an unlock of `session` is queued, unrecorded. While one is, no read of the truth may
    /// put that session's shields back on: the emergency unlock stands on the phone until the
    /// server has it, stuck or not.
    public func holdsUnlock(session: String) throws -> Bool {
        try pool.read {
            try Bool.fetchOne(
                $0, sql: "SELECT EXISTS (SELECT 1 FROM outbox WHERE kind = 'unlock' AND sessionId = ?)",
                arguments: [session]) ?? false
        }
    }

    /// Everything queued, in the order the phone acted — for a screen to show what is stuck.
    public func records() throws -> [OutboxRecord] {
        try pool.read { try OutboxRecord.fetchAll($0, sql: "SELECT * FROM outbox ORDER BY seq") }
    }

    static func fetch(_ db: Database, _ eventId: String) throws -> OutboxRecord? {
        try OutboxRecord.fetchOne(db, sql: "SELECT * FROM outbox WHERE eventId = ?", arguments: [eventId])
    }

    static func state(_ db: Database, _ key: String) throws -> String? {
        try String.fetchOne(db, sql: "SELECT value FROM outboxState WHERE key = ?", arguments: [key])
    }

    static func setState(_ db: Database, _ key: String, _ value: String?) throws {
        guard let value else {
            return try db.execute(sql: "DELETE FROM outboxState WHERE key = ?", arguments: [key])
        }
        try db.execute(
            sql: "INSERT OR REPLACE INTO outboxState (key, value) VALUES (?, ?)", arguments: [key, value])
    }
}
