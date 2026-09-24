import Foundation
import Testing

@testable import BaliCore

/// The outbox contract's cases, as `contracts/outbox/` holds them: the TypeScript's own answer on
/// every input its golden test sends (packages/shared/src/outbox-cases.test.ts) — every status
/// class, 408 and 429, outcomes no build knows, no body — read in place, like the fixtures. A
/// change to a table there goes red here until the port follows.
enum OutboxCases {
    static let directory = Contract.repoRoot.appending(path: "contracts/outbox")

    /// Every case file — found by walking the directory, never listed by hand. A missing
    /// directory throws: the port is never passed by checking nothing.
    static func files() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".json") }.sorted()
    }

    static func load<T: Decodable>(_: T.Type, _ file: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(contentsOf: directory.appending(path: file)))
    }

    /// What every file names: the TypeScript function whose answers it holds.
    struct Header: Decodable { let function: String }

    /// A table's file: for each body, the results each disposition answers.
    struct Table: Decodable {
        struct Case: Decodable {
            /// Null for no body at all.
            let body: JSONValue?
            let dispositions: [String: [JSONValue]]
        }
        let function: String
        /// Every result each case is answered under.
        let results: [JSONValue]
        let cases: [Case]
    }

    /// The reconcile rule's file.
    struct Reconcile: Decodable {
        struct Stamp: Decodable, CustomStringConvertible {
            let changes: Int
            let awaiting: Int
            var stamp: ReconcileStamp { ReconcileStamp(changes: changes, awaiting: awaiting) }
            var description: String { "{changes: \(changes), awaiting: \(awaiting)}" }
        }
        struct Case: Decodable {
            let sent: Stamp
            let now: Stamp
            let mayReconcile: Bool
        }
        let cases: [Case]
    }

    /// A result as the TypeScript writes it: a status, or `"network_error"`.
    static func result(_ json: JSONValue) throws -> SendResult {
        switch json {
        case .string("network_error"): return .networkError
        case .number(let number):
            return .status(try #require(Int(exactly: number), "not a status: \(number)"))
        default: throw ParseError(json: json)
        }
    }
    struct ParseError: Error { let json: JSONValue }

    /// `json` as text, for a failure's message.
    static func text(_ json: JSONValue?) -> String {
        guard let json, let data = try? JSONEncoder().encode(json) else { return "no body" }
        return String(decoding: data, as: UTF8.self)
    }
}

@Suite("The outbox tables agree with the TypeScript on every case it generates")
struct OutboxContractTests {
    @Test("Every function BaliCore ports has its cases, and every file is one it ports")
    func everyFunction() throws {
        let functions = try OutboxCases.files().map { try OutboxCases.load(OutboxCases.Header.self, $0) }
        #expect(
            functions.map(\.function).sorted() == [
                "readMayReconcile", "stateChangeDisposition", "tapDisposition",
                "unlockDisposition",
            ])
    }

    @Test("Each file's cases, answered by the port", arguments: try OutboxCases.files())
    func cases(_ file: String) throws {
        let function = try OutboxCases.load(OutboxCases.Header.self, file).function
        switch function {
        case "unlockDisposition":
            try check(file) { unlockDisposition($0, try decode(UnlockResponse.self, $1)) }
        case "tapDisposition":
            try check(file) { tapDisposition($0, try decode(TapResponse.self, $1)) }
        case "stateChangeDisposition":
            // One table for both endpoints: every case holds for a refocus's answer and a report's.
            try check(file) { stateChangeDisposition($0, try decode(RefocusResponse.self, $1)) }
            try check(file) {
                stateChangeDisposition($0, try decode(ProtectionOffResponse.self, $1))
            }
        case "readMayReconcile":
            for c in try OutboxCases.load(OutboxCases.Reconcile.self, file).cases {
                #expect(
                    readMayReconcile(sent: c.sent.stamp, now: c.now.stamp) == c.mayReconcile,
                    "readMayReconcile(sent: \(c.sent), now: \(c.now))")
            }
        default:
            Issue.record("BaliCore has no port of \(function)")
        }
    }

    @Test("stateChangeDisposition takes a literal nil: one entry point for both answers, never ambiguous")
    func stateChangeTakesNil() {
        // With an overload per answer type, none of these compiled (#70's review).
        #expect(stateChangeDisposition(.networkError, nil) == .retry)
        #expect(stateChangeDisposition(.status(200), nil) == .retry)
        #expect(stateChangeDisposition(.status(401), nil) == .reauth)
        #expect(stateChangeDisposition(.status(409), nil) == .drop)
    }

    /// A case's body as the app decodes an answer: an outcome it does not know is `.unknown`.
    /// Every body is one the answer's type decodes — no case goes unanswered on a decode error.
    func decode<T: Decodable>(_: T.Type, _ body: JSONValue?) throws -> T? {
        try body.map { try Contract.appDecode(T.self, $0) }
    }

    /// Every case of a table's file against `port`: each body under each result, every result
    /// once; and the dispositions the cases reach are exactly the port's — none it lacks, and no
    /// case of its own (a discard, say) that the TypeScript never gives.
    func check<Disposition: RawRepresentable & CaseIterable>(
        _ file: String, _ port: (SendResult, JSONValue?) throws -> Disposition
    ) throws where Disposition.RawValue == String {
        let table = try OutboxCases.load(OutboxCases.Table.self, file)
        var reached: Set<String> = []
        for c in table.cases {
            var answered: [JSONValue] = []
            for (disposition, results) in c.dispositions {
                reached.insert(disposition)
                for result in results {
                    let got = try port(try OutboxCases.result(result), c.body)
                    #expect(
                        got.rawValue == disposition,
                        "\(table.function)(\(OutboxCases.text(result)), \(OutboxCases.text(c.body)))")
                    answered.append(result)
                }
            }
            #expect(answered.count == table.results.count, "\(OutboxCases.text(c.body))")
            #expect(Set(answered) == Set(table.results), "\(OutboxCases.text(c.body))")
        }
        #expect(reached == Set(Disposition.allCases.map(\.rawValue)))
    }
}

/// `packages/shared/src/outbox-contract.test.ts`'s scenarios for the reconcile rule, ported.
@Suite("readMayReconcile: a read never overrides a newer state change")
struct ReconcileTests {
    /// The phone's two counters, kept the way `ReconcileStamp` describes.
    struct Phone {
        var stamp = ReconcileStamp(changes: 0, awaiting: 0)
        /// A tap, unlock, refocus or protection-off report, acted on at once and queued.
        mutating func make() {
            stamp.changes += 1
            stamp.awaiting += 1
        }
        /// A change's first answer (a disposition other than retry or reauth).
        mutating func answer() {
            stamp.changes += 1
            stamp.awaiting -= 1
        }
        /// A later answer to a record the outbox kept and resent (retry_and_surface).
        mutating func answerAgain() { stamp.changes += 1 }
    }

    @Test("A read sent and answered with nothing in between reconciles")
    func nothingBetween() {
        var phone = Phone()
        phone.make()
        phone.answer()
        let sent = phone.stamp
        #expect(readMayReconcile(sent: sent, now: phone.stamp))
    }

    @Test("#56's race: a refocus answered while a check-in is in flight wins")
    func refocusRace() {
        // The check-in reads `unlocked` before the refocus commits and answers after it, so its
        // answer reaches the phone second and is the older one.
        var phone = Phone()
        let checkIn = phone.stamp
        phone.make()  // the student refocuses
        phone.answer()  // 200 applied, focused
        #expect(!readMayReconcile(sent: checkIn, now: phone.stamp))
    }

    @Test("A change made while the read is in flight wins, answered or not")
    func changeInFlight() {
        var phone = Phone()
        let checkIn = phone.stamp
        phone.make()  // an unlock, not answered yet
        #expect(!readMayReconcile(sent: checkIn, now: phone.stamp))
    }

    @Test("A change still waiting when the read was sent wins, even if nothing moved since")
    func waitingWhenSent() {
        // An unlock queued offline, or in backoff: the server has not seen it, so anything a read
        // says is older than the phone's own truth.
        var phone = Phone()
        phone.make()
        let checkIn = phone.stamp
        #expect(!readMayReconcile(sent: checkIn, now: phone.stamp))
    }

    @Test(
        "A kept record waits only for its first answer; each later one still outdates a read in flight"
    )
    func keptRecord() {
        // A refused tap is kept and resent (retry_and_surface). Its first answer ends its wait, so
        // reads reconcile between resends — the phone must re-read the truth after it — and
        // awaiting never goes below zero.
        var phone = Phone()
        phone.make()
        phone.answer()  // 409: kept, surfaced
        let between = phone.stamp
        #expect(between.awaiting == 0)
        #expect(readMayReconcile(sent: between, now: phone.stamp))

        // A resend lands (the block got registered, say: 200 joined) while a check-in is in
        // flight: that answer is newer than the check-in's read.
        let checkIn = phone.stamp
        phone.answerAgain()
        #expect(phone.stamp.awaiting == 0)
        #expect(!readMayReconcile(sent: checkIn, now: phone.stamp))
        let next = phone.stamp
        #expect(readMayReconcile(sent: next, now: phone.stamp))
    }

    @Test("An unlock waits until recorded: a refused one keeps every read from putting shields back")
    func unlockWaits() {
        var phone = Phone()
        phone.make()  // the student unlocks
        phone.answerAgain()  // 409 retry_and_surface: kept, and still waiting
        let checkIn = phone.stamp
        #expect(checkIn.awaiting == 1)
        #expect(!readMayReconcile(sent: checkIn, now: phone.stamp))
        phone.answer()  // at last, recorded
        let next = phone.stamp
        #expect(readMayReconcile(sent: next, now: phone.stamp))
    }

    @Test("Once the change is answered, the next read reconciles")
    func nextRead() {
        var phone = Phone()
        phone.make()
        let stale = phone.stamp
        phone.answer()
        #expect(!readMayReconcile(sent: stale, now: phone.stamp))
        let next = phone.stamp
        #expect(readMayReconcile(sent: next, now: phone.stamp))
    }
}
