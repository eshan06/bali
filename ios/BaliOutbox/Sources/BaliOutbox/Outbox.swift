import BaliCore
import Foundation
import GRDB
import GRDBSQLite

/// The phone's outbox: each tap, emergency unlock, refocus and protection-off report it acted on,
/// kept until an answer lets it go. BaliCore's tables say what an answer means; this applies them,
/// with the rules no table can express (docs/DECISIONS.md, B3a). The sync engine (`SyncEngine`)
/// sends `nextDue`'s record (`send(through:)`) and hands its answer to `settle`, each with its `now`.
public struct Outbox: Sendable {
    /// The app group the app and its extensions share (ARCHITECTURE, iOS decision 3).
    public static let appGroup = "group.com.bali.shared"
    /// How many server answers may leave a record unsettled before it is stuck.
    public static let bound = 8
    /// The longest backoff, before its jitter.
    public static let backoffCap: TimeInterval = 60
    /// How long a write waits on another process's — an extension's — before it fails.
    public static let busyTimeout: TimeInterval = 5

    let pool: DatabasePool
    let random: @Sendable () -> Double

    /// The outbox at `url`, created and migrated as needed; `random`, in 0..<1, is the jitter's.
    public init(at url: URL, random: @escaping @Sendable () -> Double = { .random(in: 0..<1) })
        throws
    {
        try self.init(at: url, random: random, suspends: true)
    }

    /// The file is shared with the extensions (B5), so it is opened as GRDB's "Sharing a Database"
    /// says: a write waits out another process's instead of failing (`busyTimeout`); none takes a
    /// lock while the app is suspended (`suspend()`), or iOS kills it (0xdead10cc); the WAL files
    /// outlive the last connection, so a process that only reads can always open it; and the setup
    /// is coordinated, so two processes never migrate at once. A file a newer build has migrated is
    /// refused, never written through a schema this one does not know. `suspends` is for the tests:
    /// the notifications reach every database in the process. `bound` is the monitor's, for the one
    /// open and read of a wake (`read`): from now on, everything this outbox waits for another
    /// process — the coordinated open (then `Busy`), and each of SQLite's locks, the open's and the
    /// reads' (then SQLite's busy error) — ends within it, never a busy timeout at each (#91's
    /// review). Past it, every lock wait fails at once: an outbox made with it is never kept.
    init(
        at url: URL, random: @escaping @Sendable () -> Double, suspends: Bool,
        within bound: TimeInterval? = nil
    ) throws {
        var configuration = Configuration()
        configuration.busyMode = bound.map(Self.busy(within:)) ?? .timeout(Self.busyTimeout)
        configuration.observesSuspensionNotifications = suspends
        configuration.prepareDatabase { db in
            guard !db.configuration.readonly else { return }
            var persist: CInt = 1
            let code = sqlite3_file_control(
                db.sqliteConnection, nil, SQLITE_FCNTL_PERSIST_WAL, &persist)
            guard code == SQLITE_OK else { throw DatabaseError(resultCode: ResultCode(rawValue: code)) }
        }
        pool = try Self.coordinated(url, within: bound) { [configuration] url in
            let pool = try DatabasePool(
                path: url.path(percentEncoded: false), configuration: configuration)
            if try pool.read(Self.migrator.hasBeenSuperseded) { throw TooNew() }
            try Self.migrator.migrate(pool)
            return pool
        }
        self.random = random
    }

    /// The file was migrated by a newer build than this one.
    public struct TooNew: Error {}

    /// The file was not free within the bound: another process held it.
    public struct Busy: Error {}

    /// SQLite's waits on another process's locks, all ending by one deadline, `bound` from now.
    static func busy(within bound: TimeInterval) -> Database.BusyMode {
        let deadline = ContinuousClock.now + .seconds(bound)
        return .callback { _ in
            guard ContinuousClock.now < deadline else { return false }
            Thread.sleep(forTimeInterval: 0.01)
            return true
        }
    }

    /// Where the phone stood and what it queued, as the monitor reads them (B5b): the file opened
    /// within `bound` — never longer: iOS would kill the monitor mid-wake — read, and closed before
    /// it returns, since iOS gives an extension no notice before it suspends it, and a lock held
    /// then gets it killed (0xdead10cc). A standing it cannot read throws: `.unread` is the app's.
    static func read(_ url: URL, within bound: TimeInterval) throws -> SyncState {
        let outbox = try Outbox(at: url, random: { 0 }, suspends: false, within: bound)
        let read = Result {
            var state = SyncState()
            (state.queued, state.standing) = (try outbox.records(), try outbox.standing())
            return state
        }
        try outbox.pool.close()
        return try read.get()
    }

    /// The app is about to be suspended: from now on no outbox in this process takes a lock — a
    /// write fails instead (`isSuspension`), and is made again once `resume()` is posted. The app
    /// posts it as it enters the background.
    public static func suspend() {
        NotificationCenter.default.post(name: Database.suspendNotification, object: nil)
    }

    /// The app is back: the outboxes take locks again.
    public static func resume() {
        NotificationCenter.default.post(name: Database.resumeNotification, object: nil)
    }

    /// Whether `error` is a write refused while the app is suspended, not a failure.
    public static func isSuspension(_ error: any Error) -> Bool {
        (error as? DatabaseError)?.isInterruptionError == true
    }

    /// `open(url)`, coordinated with every other process opening the file, waiting for them at most
    /// `bound` (nil: as long as it takes). Linux has no NSFileCoordinator, and no other process.
    static func coordinated<T>(
        _ url: URL, within bound: TimeInterval?, _ open: @escaping @Sendable (URL) throws -> T
    ) throws -> T {
        #if canImport(Darwin)
            // NSFileCoordinator's blocking call, the one the app has always made: inline when
            // unbounded, and on a thread of its own when bounded, so the wait can give up on it.
            // Not its asynchronous one: on the iOS Simulator that never ran its accessor behind a
            // thread waiting for it, and every open hung.
            nonisolated(unsafe) let coordinator = NSFileCoordinator(filePresenter: nil)
            return try granted(
                within: bound,
                request: { grant, over in
                    let ask: @Sendable () -> Void = {
                        var failure: NSError?
                        coordinator.coordinate(
                            writingItemAt: url, options: .forMerging, error: &failure,
                            byAccessor: grant)
                        over(failure)
                    }
                    if bound == nil { ask() } else { Thread.detachNewThread(ask) }
                },
                cancel: coordinator.cancel, open: open)
        #else
            return try open(url)
        #endif
    }

    /// Runs `open` once `request` grants the access it asks for — `request` calls `grant` with the
    /// file's URL when it is, and `open` runs inside that call, while the access is held; then
    /// `over` once the asking has ended, with its error, if any — waiting at most `bound` (nil: as
    /// long as it takes). An asking over with no grant is a refusal — its error, or one of its own
    /// when it gave none — never a wait with no end (rule 5: the app shows it, with a retry). Past
    /// the bound, the asking is cancelled and `Busy` thrown, and a grant that comes after opens
    /// nothing. An open already under way at the bound is waited for — the monitor's deadline on
    /// SQLite's locks bounds it — since returning then would leave the file locked behind a process
    /// iOS may suspend. The first of the grant, the refusal and the giving up settles it: nothing
    /// after it opens the file again or answers.
    static func granted<T>(
        within bound: TimeInterval?,
        request: (
            _ grant: @escaping @Sendable (URL) -> Void,
            _ over: @escaping @Sendable ((any Error)?) -> Void
        ) -> Void,
        cancel: () -> Void,
        open: @escaping @Sendable (URL) throws -> T
    ) throws -> T {
        let access = Access<T>()
        request(
            { url in access.settle { Result { try open(url) } } },
            { failure in access.settle { .failure(failure ?? CocoaError(.fileWriteUnknown)) } })
        if let settled = access.wait(bound) { return try settled.get() }
        // Past the bound: given up — unless the open is under way, which is waited for.
        if access.claim() {
            cancel()
            throw Busy()
        }
        return try access.wait(nil)!.get()
    }

    /// One wait for access to the file, between the thread that asks and the one it is granted
    /// on: the grant, a refusal and the giving up race for it, and only the first to claim it has it.
    final class Access<T>: @unchecked Sendable {
        private let done = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var claimed = false
        private var result: Result<T, any Error>?

        /// Whether this is the first claim: every later one has nothing.
        func claim() -> Bool {
            lock.withLock {
                defer { claimed = true }
                return !claimed
            }
        }

        /// Settles it with `outcome`, made while the claim is held — unless another claimed it first.
        func settle(_ outcome: () -> Result<T, any Error>) {
            guard claim() else { return }
            let settled = outcome()
            lock.withLock { result = settled }
            done.signal()
        }

        /// What settled it, once it is — waiting at most `bound` (nil: as long as it takes); nil
        /// past the bound.
        func wait(_ bound: TimeInterval?) -> Result<T, any Error>? {
            if let bound {
                guard done.wait(timeout: .now() + bound) == .success else { return nil }
            } else {
                done.wait()
            }
            return lock.withLock { result }
        }
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
        // The phone's own order (A12), sent with every record: its `seq` is its place in what the
        // phone did — SQLite never reuses or lowers one while the file lives — and the install,
        // minted once here, names this file's counter. A reinstall's file starts again at 1 under
        // an install of its own, so the server never compares the two.
        migrator.registerMigration("v2") { db in
            try Self.setState(db, Self.installKey, UUID().uuidString.lowercased())
        }
        // Decision 11 (B6): an unlock filed under the phone's own unanswered tap, `tapId`, names no
        // session until the tap's answer does. SQLite cannot relax v1's CHECK in place, so the
        // table is made again — and its AUTOINCREMENT counter, A12's order, carried over: going
        // back, it would have the server place what the phone does next before what it did.
        migrator.registerMigration("v3") { db in
            let columns = """
                seq, eventId, kind, tagId, sessionId, reason, follows, recordedAt, attempts,
                  answers, nextAttemptAt, stuck, lastStatus, lastReason, lastMessage
                """
            try db.execute(
                sql: """
                    ALTER TABLE outbox RENAME TO outboxV2;
                    CREATE TABLE outbox (
                      seq INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT NOT NULL UNIQUE,
                      kind TEXT NOT NULL
                        CHECK (kind IN ('tap', 'unlock', 'refocus', 'protection_off')),
                      tagId TEXT CHECK ((kind = 'tap') = (tagId IS NOT NULL)),
                      sessionId TEXT
                        CHECK (kind = 'unlock' OR (kind = 'tap') = (sessionId IS NULL)),
                      tapId TEXT CHECK (tapId IS NULL OR kind = 'unlock'),
                      reason TEXT, follows TEXT, recordedAt TEXT NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0,
                      nextAttemptAt TEXT NOT NULL, stuck INTEGER NOT NULL DEFAULT 0,
                      lastStatus INTEGER, lastReason TEXT, lastMessage TEXT,
                      CHECK (kind != 'unlock' OR sessionId IS NOT NULL OR tapId IS NOT NULL));
                    INSERT INTO outbox (\(columns)) SELECT \(columns) FROM outboxV2;
                    DELETE FROM sqlite_sequence WHERE name = 'outbox';
                    INSERT INTO sqlite_sequence (name, seq)
                      SELECT 'outbox', seq FROM sqlite_sequence WHERE name = 'outboxV2';
                    DROP TABLE outboxV2;
                    """)
        }
        // B6b: an unlock made where the phone stood unread names no session, nor a tap, until the
        // phone knows where it stands, which v3's CHECK forbade — so the table is made again as v3
        // made it, its counter carried over. And B6d's follow-up is the press's second record, so
        // it carries the press's place in the order, `orderSeq`, not its own.
        migrator.registerMigration("v4") { db in
            let columns = """
                seq, eventId, kind, tagId, sessionId, tapId, reason, follows, recordedAt, attempts,
                  answers, nextAttemptAt, stuck, lastStatus, lastReason, lastMessage
                """
            try db.execute(
                sql: """
                    ALTER TABLE outbox RENAME TO outboxV3;
                    CREATE TABLE outbox (
                      seq INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT NOT NULL UNIQUE,
                      kind TEXT NOT NULL
                        CHECK (kind IN ('tap', 'unlock', 'refocus', 'protection_off')),
                      tagId TEXT CHECK ((kind = 'tap') = (tagId IS NOT NULL)),
                      sessionId TEXT
                        CHECK (kind = 'unlock' OR (kind = 'tap') = (sessionId IS NULL)),
                      tapId TEXT CHECK (tapId IS NULL OR kind = 'unlock'),
                      reason TEXT, follows TEXT, recordedAt TEXT NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0,
                      nextAttemptAt TEXT NOT NULL, stuck INTEGER NOT NULL DEFAULT 0,
                      lastStatus INTEGER, lastReason TEXT, lastMessage TEXT,
                      orderSeq INTEGER CHECK (orderSeq IS NULL OR kind = 'unlock'));
                    INSERT INTO outbox (\(columns)) SELECT \(columns) FROM outboxV3;
                    DELETE FROM sqlite_sequence WHERE name = 'outbox';
                    INSERT INTO sqlite_sequence (name, seq)
                      SELECT 'outbox', seq FROM sqlite_sequence WHERE name = 'outboxV3';
                    DROP TABLE outboxV3;
                    """)
        }
        return migrator
    }

    /// The session protection off was last reported for, the latest unlock's id, the file's
    /// install, the phone's standing, and the latest tap's id.
    static let reportedKey = "protectionOffReported"
    static let lastUnlockKey = "lastUnlock"
    static let installKey = "install"
    static let standingKey = "standing"
    static let lastTapKey = "lastTap"

    /// An unlock not filed yet (B6b): made where the phone stood unread, under no session or tap.
    static let unfiled = "kind = 'unlock' AND sessionId IS NULL AND tapId IS NULL"

    /// Every record's row, with its file's install: what each request's order is made of.
    static let selection = """
        SELECT outbox.*, (SELECT value FROM outboxState WHERE key = '\(installKey)') AS install
        FROM outbox
        """

    /// Queues what the phone just did under a fresh event id, due at once — and keeps `standing`,
    /// where it leaves the phone, in the same write: a relaunch never finds the one without the
    /// other. A tap or an unlock supersedes every queued refocus (deleted, never sent: it could
    /// only make the truth older). Protection off is reported once per revocation — nil when
    /// already reported in this session — and again after a tap, which returns the row to
    /// focused, or `protectionRestored`.
    @discardableResult
    public func record(_ change: Change, now: Date, standing: Standing? = nil) throws
        -> OutboxRecord?
    {
        try pool.write { db in
            if case .protectionOff(let session) = change,
                try Self.state(db, Self.reportedKey) == session
            {
                return nil
            }
            // Kept as `file` keeps it, before what this does: an unlock not filed yet — a filing
            // that failed, say — goes where the phone stood, or under the last tap before this.
            if let standing { try Self.file(db, standing) }
            let eventId = EventID.mint(at: now)
            var follows: String?
            var tap: String?
            let row: (kind: String, tagId: String?, session: String?, reason: UnlockReason?)
            switch change {
            case .tap(let tagId):
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.reportedKey, nil)
                try Self.setState(db, Self.lastTapKey, eventId)
                row = ("tap", tagId, nil, nil)
            case .unlock(let session, let reason):
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.lastUnlockKey, eventId)
                row = ("unlock", nil, session, reason)
            case .unlockUnderTap(let tapId, let reason):
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.lastUnlockKey, eventId)
                // It guards the session the phone stood in, which the standing it leaves names,
                // until its tap's answer names another: one naming none leaves it that one.
                row = ("unlock", nil, standing?.sessionId, reason)
                tap = tapId
            case .unlockUnfiled(let reason):
                try db.execute(sql: "DELETE FROM outbox WHERE kind = 'refocus'")
                try Self.setState(db, Self.lastUnlockKey, eventId)
                row = ("unlock", nil, nil, reason)
            case .refocus(let session):
                // The unlock it returns from — the latest — while it is queued, in this session or
                // under a tap whose answer names none yet.
                follows = try String.fetchOne(
                    db,
                    sql: """
                        SELECT eventId FROM outbox WHERE eventId = ?
                          AND (sessionId = ? OR (tapId IS NOT NULL AND sessionId IS NULL))
                        """, arguments: [Self.state(db, Self.lastUnlockKey), session])
                row = ("refocus", nil, session, nil)
            case .protectionOff(let session):
                try Self.setState(db, Self.reportedKey, session)
                row = ("protection_off", nil, session, nil)
            }
            try db.execute(
                sql: """
                    INSERT INTO outbox (eventId, kind, tagId, sessionId, tapId, reason, follows,
                      recordedAt, nextAttemptAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    eventId, row.kind, row.tagId, row.session, tap, row.reason?.rawValue, follows,
                    now, now,
                ])
            return try Self.fetch(db, eventId)
        }
    }

    /// A later revocation is a new one, reported again: the Screen Time permission is back, or the
    /// phone's row is focused again (`SyncEngine.record`, A13).
    public func protectionRestored() throws {
        try pool.write { try Self.setState($0, Self.reportedKey, nil) }
    }

    /// Where the phone stood when the sync engine last said, for the app's next launch and the
    /// extensions (B5); `.out` when it never said. An unlock made since, where it stood unread and
    /// not filed yet, acts on it as it did on the shields (B6b): nothing was kept over it.
    public func standing() throws -> Standing {
        try pool.read { db in
            guard let kept = try Self.state(db, Self.standingKey) else { return .out }
            let standing = try BaliJSON.makeDecoder().decode(Standing.self, from: Data(kept.utf8))
            let unfiled = try Bool.fetchOne(
                db, sql: "SELECT EXISTS (SELECT 1 FROM outbox WHERE \(Self.unfiled))")
            return unfiled == true ? standing.acting(.unlockUnfiled(reason: nil)) : standing
        }
    }

    func keep(_ standing: Standing) throws { try pool.write { try Self.keep($0, standing) } }

    /// Keeps `standing` and files every unlock not filed yet (B6b) where it says, in one write — a
    /// relaunch never finds the one without the other: in the session it names, or naming none,
    /// under the phone's last tap, which the server files where that tap landed, or keeps with no
    /// session (A11) — never discarded. With no tap known either, it waits for a standing that
    /// names one. What waits is the file's to say, never a queue read before (#95's review): true
    /// when it filed one.
    @discardableResult
    func file(_ standing: Standing) throws -> Bool {
        try pool.write { try Self.file($0, standing) }
    }

    @discardableResult
    static func file(_ db: Database, _ standing: Standing) throws -> Bool {
        let tap = standing.sessionId == nil ? try state(db, lastTapKey) : nil
        // Nowhere to file it — no session named, no tap known — it matches nothing, and waits.
        try db.execute(
            sql: "UPDATE outbox SET sessionId = ?, tapId = ? WHERE \(unfiled) AND ? IS NOT NULL",
            arguments: [standing.sessionId, tap, standing.sessionId ?? tap])
        let filed = db.changesCount > 0
        try keep(db, standing)
        return filed
    }

    static func keep(_ db: Database, _ standing: Standing) throws {
        let kept = String(decoding: try BaliJSON.makeEncoder().encode(standing), as: UTF8.self)
        try setState(db, standingKey, kept)
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
    /// not: landing after it, that unlock would leave the server's truth `unlocked`. An unlock not
    /// filed yet goes nowhere, and holds nothing (B6b).
    public func nextDue(now: Date) throws -> Due {
        let records = try records()
        let queued = Set(records.map(\.eventId))
        var wake: Date?
        for record in records {
            if let unlock = record.follows, queued.contains(unlock) { continue }
            if record.change.isUnfiled { continue }
            if record.nextAttemptAt <= now { return .send(record) }
            wake = min(wake ?? record.nextAttemptAt, record.nextAttemptAt)
            if !record.stuck { break }
        }
        return wake.map { .wait(until: $0) } ?? .idle
    }

    /// Applies one send's answer — `Sent`, which only the record's own send makes, so its own
    /// kind's table has decided it — and returns the disposition; nil once the record is gone,
    /// superseded in flight, so its answer is older than the phone's truth. An ending disposition
    /// deletes it; any other keeps it, due after `backoff`, with its answer for a screen: stuck at a
    /// refusal, or at `bound` answers that left it unsettled (any status but 401, 408 and 429, none
    /// of them this record's). Stuck stays stuck, and never deletes: an unlock leaves only once
    /// recorded. A tap's session is handed to the unlocks filed under it, to guard (decision 11) —
    /// and a tap that joins no class, armed or refused, has them filed again where the phone stood,
    /// as has an unlock under a tap kept with no session (`refile`, B6d).
    @discardableResult
    public func settle(_ sent: Sent, now: Date) throws -> Disposition? {
        try pool.write { db in
            guard let record = try Self.fetch(db, sent.eventId) else { return nil }
            let disposition = sent.disposition
            if disposition == .tap(.waitForStart) || disposition == .tap(.retryAndSurface) {
                try Self.refile(db, "tapId = ?", sent.eventId, now: now)
            } else if disposition == .unlock(.recorded), sent.session == nil {
                // Kept with no session, its tap not answered: stuck at the bound, not arrived.
                let queued = "tapId IN (SELECT eventId FROM outbox WHERE kind = 'tap')"
                try Self.refile(db, "eventId = ? AND \(queued)", sent.eventId, now: now)
            }
            guard disposition.keeps else {
                if disposition == .tap(.applySession), let session = sent.session {
                    try db.execute(
                        sql: "UPDATE outbox SET sessionId = ? WHERE tapId = ?",
                        arguments: [session.id, sent.eventId])
                }
                try db.execute(
                    sql: "DELETE FROM outbox WHERE eventId = ?", arguments: [sent.eventId])
                return disposition
            }
            let answered = sent.status.map { ![401, 408, 429].contains($0) } ?? false
            let (attempts, answers) = (record.attempts + 1, record.answers + (answered ? 1 : 0))
            try db.execute(
                sql: """
                    UPDATE outbox SET attempts = ?, answers = ?, stuck = ?, nextAttemptAt = ?,
                      lastStatus = ?, lastReason = ?, lastMessage = ? WHERE eventId = ?
                    """,
                arguments: [
                    attempts, answers, record.stuck || disposition.refused || answers >= Self.bound,
                    now + backoff(attempts), sent.status, sent.error?.error.reason?.rawValue,
                    sent.error?.error.message, sent.eventId,
                ])
            return disposition
        }
    }

    /// The owner's ruling (2026-09-25, B6d): an Emergency Unlock filed under a tap that joins no
    /// class — each unlock under `condition` still holding the session the phone stood in when it
    /// was made — is filed again in that session: a session unlock of its own, with the press's
    /// reason, time and order, so the server places it against whatever the phone did since (A12,
    /// A13). Once: the press gives its session up to it, in the same write — and a refocus there
    /// returns from it, the unlock of its session, now.
    static func refile(_ db: Database, _ condition: String, _ id: String, now: Date) throws {
        let presses = try Row.fetchAll(
            db,
            sql: """
                SELECT eventId, sessionId, reason, recordedAt, seq FROM outbox
                WHERE kind = 'unlock' AND tapId IS NOT NULL AND sessionId IS NOT NULL
                  AND \(condition)
                """, arguments: [id])
        for press in presses {
            let (followUp, pressId) = (EventID.mint(at: now), press["eventId"] as String)
            try db.execute(
                sql: """
                    INSERT INTO outbox (eventId, kind, sessionId, reason, recordedAt,
                      nextAttemptAt, orderSeq) VALUES (?, 'unlock', ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    followUp, press["sessionId"], press["reason"], press["recordedAt"], now,
                    press["seq"],
                ])
            try db.execute(
                sql: "UPDATE outbox SET sessionId = NULL WHERE eventId = ?", arguments: [pressId])
            try db.execute(
                sql: "UPDATE outbox SET follows = ? WHERE follows = ?",
                arguments: [followUp, pressId])
            if try state(db, lastUnlockKey) == pressId {
                try setState(db, lastUnlockKey, followUp)
            }
        }
    }

    /// Every queued record due now, its backoff cut short: the student's retry (rule 5), or a fresh
    /// token after a reauth. It changes nothing else — stuck stays stuck, and the order holds.
    public func retryNow(now: Date) throws {
        try pool.write {
            try $0.execute(
                sql: "UPDATE outbox SET nextAttemptAt = ? WHERE nextAttemptAt > ?",
                arguments: [now, now])
        }
    }

    /// The wait after a record's `attempt`-th unsettled send: 2 s, 4 s, 8 s… up to `backoffCap`,
    /// plus up to as much again at random, so a school's phones never retry in unison.
    func backoff(_ attempt: Int) -> TimeInterval {
        let wait = min(TimeInterval(1 << min(max(attempt, 1), 6)), Self.backoffCap)
        let jitter = random()
        return wait * (1 + ((0...1).contains(jitter) ? jitter : jitter > 1 ? 1 : 0))
    }

    /// How many changes await their answer — as `ReconcileStamp` counts one, any disposition but
    /// retry or reauth — for its `awaiting`: every record not stuck, but a refocus waiting on a
    /// stuck unlock (the server has seen neither), and an unlock not filed yet, which no answer
    /// reaches before a read says where it goes (B6b). A stuck record stops holding reads; an
    /// unrecorded unlock still guards its session (`holdsUnlock`).
    public func awaiting() throws -> Int {
        let records = try records()
        let stuck = Set(records.filter(\.stuck).map(\.eventId))
        return records.filter {
            !$0.stuck && !$0.change.isUnfiled && !($0.follows.map(stuck.contains) ?? false)
        }.count
    }

    /// Whether an unrecorded unlock of `session`, made after the record at `seq`, is queued — or
    /// one under a tap still queued, or one not filed yet (B6b), its session unnamed: it may be
    /// any. While one is, neither a read nor an older tap's answer puts that session's shields back
    /// on. An unlock under a tap is of the session its tap's answer names, else of the one the
    /// phone stood in (#94's review).
    public func holdsUnlock(session: String, after seq: Int = 0) throws -> Bool {
        try pool.read {
            try Bool.fetchOne(
                $0,
                sql: """
                    SELECT EXISTS (SELECT 1 FROM outbox WHERE kind = 'unlock'
                      AND COALESCE(orderSeq, seq) > ?
                      AND (sessionId = ? OR tapId IN (SELECT eventId FROM outbox WHERE kind = 'tap')
                        OR sessionId IS NULL AND tapId IS NULL))
                    """, arguments: [seq, session]) ?? false
        }
    }

    /// Everything queued, in the order the phone acted — for a screen to show what is stuck. A
    /// follow-up stands where its press does (B6d).
    public func records() throws -> [OutboxRecord] {
        try pool.read {
            try OutboxRecord.fetchAll(
                $0, sql: "\(Self.selection) ORDER BY COALESCE(orderSeq, seq), seq")
        }
    }

    static func fetch(_ db: Database, _ eventId: String) throws -> OutboxRecord? {
        try OutboxRecord.fetchOne(
            db, sql: "\(selection) WHERE eventId = ?", arguments: [eventId])
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
