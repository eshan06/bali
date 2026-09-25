import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// A fixed instant on a whole second: the database keeps times to the millisecond.
let t0 = Date(timeIntervalSince1970: 1_790_000_000)

/// A fresh outbox in a file of its own, its jitter fixed at `random`.
func makeOutbox(random: Double = 0) throws -> (outbox: Outbox, url: URL) {
    let url = temporaryFile()
    return (try open(url, random: random), url)
}

/// A new file's URL, in a folder of its own.
func temporaryFile() -> URL {
    FileManager.default.temporaryDirectory.appending(path: "BaliOutboxTests-\(UUID().uuidString)")
        .appending(path: "outbox.sqlite")
}

/// The outbox at `url`, opened as the app opens it but deaf to the suspension notifications,
/// which reach every database in the process — only `SharingTests` posts them.
func open(_ url: URL, random: Double = 0) throws -> Outbox {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    return try Outbox(at: url, random: { random }, suspends: false)
}

/// Queues `change`, which the test expects to be queued.
@discardableResult
func record(_ outbox: Outbox, _ change: Change, at now: Date = t0) throws -> OutboxRecord {
    try #require(try outbox.record(change, now: now))
}

/// The record `eventId` as the outbox holds it now; nil once it is gone.
func current(_ outbox: Outbox, _ eventId: String) throws -> OutboxRecord? {
    try outbox.pool.read { try Outbox.fetch($0, eventId) }
}

/// The install the outbox's file was given (A12).
func installOf(_ outbox: Outbox) throws -> String? {
    try outbox.pool.read { try Outbox.state($0, Outbox.installKey) }
}

/// Answers every request with `status` and `body`, or with no answer at all when `status` is nil.
struct Canned: HTTPTransport {
    let status: Int?
    let body: Data

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let status, let url = request.url,
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)
        else { throw URLError(.notConnectedToInternet) }
        return (body, response)
    }
}

struct Signed: TokenProvider {
    func accessToken() async -> String? { "token" }
}

/// One send of `record` as the sync engine will make it — its `request` through the real
/// `APIClient`, answered with `status` and `body` (none when `status` is nil) — then settled.
@discardableResult
func send(
    _ outbox: Outbox, _ record: OutboxRecord, _ status: Int?, _ body: String = "", at now: Date = t0
) async throws -> Disposition? {
    try await send(outbox, record, status, Data(body.utf8), at: now)
}

@discardableResult
func send(_ outbox: Outbox, _ record: OutboxRecord, _ status: Int?, _ body: Data, at now: Date)
    async throws -> Disposition?
{
    let client = APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(),
        transport: Canned(status: status, body: body))
    return try outbox.settle(await record.send(through: client), now: now)
}

/// A disposition as the TypeScript writes it.
extension Disposition {
    var rawValue: String {
        switch self {
        case .tap(let disposition): disposition.rawValue
        case .unlock(let disposition): disposition.rawValue
        case .stateChange(let disposition): disposition.rawValue
        }
    }
}

/// Answers the API sends, and the TypeScript tables' own answers — read in place, as BaliCore's
/// tests read them.
enum Contract {
    static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    /// Any JSON, kept as the bytes to answer with.
    struct Body: Decodable {
        let data: Data
        init(from decoder: any Decoder) throws {
            data = try JSONEncoder().encode(try JSONValue(from: decoder))
        }
    }

    /// A fixture of an outbox endpoint: the API's real answer, and the disposition the TypeScript's
    /// table gives it.
    struct Fixture: Decodable {
        let status: Int
        let body: Body
        let disposition: String
    }

    /// Each outbox endpoint's fixture folder, and a change of its kind.
    static let endpoints: [(folder: String, change: Change)] = [
        ("taps", .tap(tagId: "tag")),
        ("unlock", .unlock(session: "session", reason: nil)),
        ("tap-unlock", .unlockUnderTap(tap: "tap", reason: nil)),
        ("refocus", .refocus(session: "session")),
        ("protection-off", .protectionOff(session: "session")),
    ]

    static func fixtures(_ folder: String) throws -> [(name: String, fixture: Fixture)] {
        let directory = repoRoot.appending(path: "contracts/fixtures/\(folder)")
        return try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".json") }.sorted()
            .map {
                (
                    $0,
                    try JSONDecoder().decode(
                        Fixture.self, from: Data(contentsOf: directory.appending(path: $0)))
                )
            }
    }

    /// `contracts/outbox/<name>.json`: for each body, the results each disposition answers.
    struct Table: Decodable {
        struct Case: Decodable {
            /// Null for no body at all.
            let body: Body?
            let dispositions: [String: [JSONValue]]
        }
        let cases: [Case]
    }

    static func table(_ name: String) throws -> Table {
        try JSONDecoder().decode(
            Table.self,
            from: Data(contentsOf: repoRoot.appending(path: "contracts/outbox/\(name).json")))
    }

    /// A result as the TypeScript writes it: a status, or `"network_error"` (nil).
    static func status(_ result: JSONValue) throws -> Int? {
        switch result {
        case .string("network_error"): return nil
        case .number(let number) where Int(exactly: number) != nil: return Int(number)
        default: throw Unreadable(result: result)
        }
    }
    struct Unreadable: Error { let result: JSONValue }
}

/// A seeded generator, so a random walk that fails fails again.
struct SplitMix64: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
