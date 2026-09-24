import Foundation
import Testing

@testable import BaliCore

/// The phone's contract (ARCHITECTURE, "The fixtures are the phone's contract"): the API's real
/// answer to every student request, as `contracts/fixtures/` holds it — read in place from the
/// repo, never copied into this package.
enum Contract {
    /// The repo's root, from where this file sits in it: ios/BaliCore/Tests/BaliCoreTests/.
    static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    static let fixtures = repoRoot.appending(path: "contracts/fixtures")

    /// Every fixture, by its path under `contracts/fixtures/` — found by walking the directory,
    /// never listed by hand, so a fixture the API gains is checked here the day it lands. A
    /// missing directory throws: the contract is never passed by checking nothing.
    static func fixturePaths() throws -> [String] {
        try FileManager.default.subpathsOfDirectory(atPath: fixtures.path)
            .filter { $0.hasSuffix(".json") }.sorted()
    }

    /// One fixture file, as `Fixture` in apps/api/test/helpers/contract.ts writes it. Its
    /// `disposition` is what the TypeScript outbox table says of the answer: the port must agree.
    struct Fixture: Decodable {
        struct Request: Decodable {
            let path: String
            let body: JSONValue?
        }

        let endpoint: String
        let request: Request
        let status: Int
        let type: String
        let body: JSONValue
        let disposition: String?
    }

    static func load(_ path: String) throws -> Fixture {
        let data = try Data(contentsOf: fixtures.appending(path: path))
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    /// Each `@bali/shared` type a fixture's body can be, as the BaliCore type that decodes it.
    static let responseTypes: [String: any (Codable & Sendable).Type] = [
        "MeResponse": MeResponse.self,
        "UpdateMeResponse": UpdateMeResponse.self,
        "TapResponse": TapResponse.self,
        "CheckInResponse": CheckInResponse.self,
        "UnlockResponse": UnlockResponse.self,
        "RefocusResponse": RefocusResponse.self,
        "ProtectionOffResponse": ProtectionOffResponse.self,
        "EnrollmentJoinResponse": EnrollmentJoinResponse.self,
        "EndEnrollmentResponse": EndEnrollmentResponse.self,
        "JoinCodePreviewResponse": JoinCodePreviewResponse.self,
        "HistoryPage": HistoryPage.self,
        "ApiErrorBody": ApiErrorBody.self,
    ]

    /// Each endpoint a fixture's request sends a body to, as the BaliCore type the phone sends.
    static let requestTypes: [String: any (Codable & Sendable).Type] = [
        "PATCH /v1/me": UpdateMeRequest.self,
        "POST /v1/taps": TapRequest.self,
        "POST /v1/sessions/{id}/checkin": CheckInRequest.self,
        "POST /v1/sessions/{id}/unlock": UnlockRequest.self,
        "POST /v1/taps/{eventId}/unlock": UnlockRequest.self,
        "POST /v1/sessions/{id}/refocus": RefocusRequest.self,
        "POST /v1/sessions/{id}/protection-off": ProtectionOffRequest.self,
        "POST /v1/enrollments": EnrollmentJoinRequest.self,
    ]

    /// Each endpoint whose answers go through an outbox table, as the port's disposition of an
    /// answer: its status, and on a 2xx its body, decoded as the app decodes it (any other status
    /// carries the error shape, which no table reads). Each fixture of one carries the TypeScript
    /// table's disposition, to agree with.
    static let outboxes: [String: @Sendable (Int, JSONValue) throws -> String] = [
        "POST /v1/taps": { status, body in
            tapDisposition(.status(status), try answer(TapResponse.self, status, body)).rawValue
        },
        "POST /v1/sessions/{id}/unlock": { status, body in
            unlockDisposition(.status(status), try answer(UnlockResponse.self, status, body))
                .rawValue
        },
        "POST /v1/taps/{eventId}/unlock": { status, body in
            unlockDisposition(.status(status), try answer(UnlockResponse.self, status, body))
                .rawValue
        },
        "POST /v1/sessions/{id}/refocus": { status, body in
            stateChangeDisposition(.status(status), try answer(RefocusResponse.self, status, body))
                .rawValue
        },
        "POST /v1/sessions/{id}/protection-off": { status, body in
            stateChangeDisposition(
                .status(status), try answer(ProtectionOffResponse.self, status, body)
            ).rawValue
        },
    ]

    /// A fixture's body as the app hands it to an outbox table: decoded on a 2xx, else none.
    static func answer<T: Decodable>(_: T.Type, _ status: Int, _ body: JSONValue) throws -> T? {
        (200..<300).contains(status) ? try appDecode(T.self, body) : nil
    }

    /// `json` decoded as the app decodes an answer: a vocabulary value it does not know is
    /// `.unknown`, never a failed decode.
    static func appDecode<T: Decodable>(_: T.Type, _ json: JSONValue) throws -> T {
        try BaliJSON.makeDecoder().decode(T.self, from: JSONEncoder().encode(json))
    }

    /// `json` decoded as a `T` — strictly, so a vocabulary value BaliCore lacks fails rather than
    /// reading as `.unknown` — and encoded back: all of it that BaliCore reads, as JSON.
    static func roundTrip<T: Codable>(_: T.Type, _ json: JSONValue) throws -> JSONValue {
        let decoder = BaliJSON.makeDecoder()
        decoder.userInfo[.strictVocabulary] = true
        let value = try decoder.decode(T.self, from: JSONEncoder().encode(json))
        return try JSONDecoder().decode(JSONValue.self, from: BaliJSON.makeEncoder().encode(value))
    }

    /// What a null field is swapped for, to learn whether BaliCore reads it. A field it reads
    /// either refuses this — every type it decodes one as does, but a list of strings or any
    /// JSON — or, being one of those, brings it back.
    static let probe = JSONValue.array([.string("probe")])
}

/// One step into a JSON value: an object's field, or an array's element.
enum JSONStep: Hashable, CustomStringConvertible {
    case key(String)
    case index(Int)

    var description: String {
        switch self {
        case .key(let key): key
        case .index(let index): "[\(index)]"
        }
    }
}

extension JSONValue {
    /// This value without its null fields: an optional BaliCore holds as nil is encoded absent.
    var droppingNullFields: JSONValue {
        switch self {
        case .object(let fields):
            .object(fields.filter { $0.value != .null }.mapValues(\.droppingNullFields))
        case .array(let values): .array(values.map(\.droppingNullFields))
        default: self
        }
    }

    /// The path to each of this value's null fields, through its objects and arrays.
    var nullFields: [[JSONStep]] {
        switch self {
        case .object(let fields):
            fields.sorted { $0.key < $1.key }.flatMap { key, value in
                value == .null ? [[.key(key)]] : value.nullFields.map { [.key(key)] + $0 }
            }
        case .array(let values):
            values.enumerated().flatMap { index, value in
                value.nullFields.map { [.index(index)] + $0 }
            }
        default: []
        }
    }

    /// The value at `path`, if there is one.
    subscript(path: [JSONStep]) -> JSONValue? {
        guard let step = path.first else { return self }
        let rest = Array(path.dropFirst())
        switch (self, step) {
        case (.object(let fields), .key(let key)): return fields[key]?[rest]
        case (.array(let values), .index(let index)) where values.indices.contains(index):
            return values[index][rest]
        default: return nil
        }
    }

    /// This value with `replacement` at `path`, a path it holds.
    func replacing(_ path: [JSONStep], with replacement: JSONValue) -> JSONValue {
        guard let step = path.first else { return replacement }
        let rest = Array(path.dropFirst())
        switch (self, step) {
        case (.object(var fields), .key(let key)):
            fields[key] = fields[key]?.replacing(rest, with: replacement)
            return .object(fields)
        case (.array(var values), .index(let index)) where values.indices.contains(index):
            values[index] = values[index].replacing(rest, with: replacement)
            return .array(values)
        default: return self
        }
    }
}

extension DecodingError {
    /// Where in the JSON the decode failed.
    var path: [JSONStep] {
        let context: Context? =
            switch self {
            case .typeMismatch(_, let context), .valueNotFound(_, let context),
                .keyNotFound(_, let context), .dataCorrupted(let context):
                context
            @unknown default: nil
            }
        return (context?.codingPath ?? []).map { key in
            key.intValue.map(JSONStep.index) ?? .key(key.stringValue)
        }
    }
}

@Suite("The contract fixtures")
struct ContractFixtureTests {
    @Test(
        "Each fixture's answer decodes as its type and reads back whole; its request, as sent",
        arguments: try Contract.fixturePaths())
    func fixture(_ path: String) throws {
        let fixture = try Contract.load(path)
        let type = try #require(
            Contract.responseTypes[fixture.type], "BaliCore has no type for \(fixture.type)")
        // Read back whole: a field BaliCore misses or misnames fails here, not only a bad value.
        let answer = try Contract.roundTrip(type, fixture.body)
        #expect(answer.droppingNullFields == fixture.body.droppingNullFields)
        // Its null fields too, which that compares on neither side: one null in every fixture that
        // BaliCore lacked or misnamed would decode as nil forever. Each is sent the probe instead,
        // and BaliCore reads it only if the decode then fails at that field, or the probe comes
        // back.
        for field in fixture.body.nullFields {
            let name = field.map(\.description).joined(separator: ".")
            do {
                let read = try Contract.roundTrip(type, fixture.body.replacing(field, with: Contract.probe))
                #expect(read[field] == Contract.probe, "\(fixture.type) never reads \(name)")
            } catch let error as DecodingError {
                #expect(error.path.starts(with: field), "\(fixture.type) failed elsewhere: \(error)")
            }
        }

        guard let request = fixture.request.body else { return }
        let requestType = try #require(
            Contract.requestTypes[fixture.endpoint], "BaliCore has no body for \(fixture.endpoint)")
        // What the phone sends: every field, none extra, each time as the API's clock writes it.
        #expect(try Contract.roundTrip(requestType, request) == request)
    }

    @Test(
        "Each fixture's disposition, the TypeScript outbox table's, is the port's",
        arguments: try Contract.fixturePaths())
    func disposition(_ path: String) throws {
        let fixture = try Contract.load(path)
        guard let port = Contract.outboxes[fixture.endpoint] else {
            // A disposition no port here reads would be one nothing checks.
            #expect(fixture.disposition == nil, "BaliCore has no outbox for \(fixture.endpoint)")
            return
        }
        let expected = try #require(fixture.disposition, "an outbox answer with no disposition")
        #expect(try port(fixture.status, fixture.body) == expected)
    }

    @Test("The walk finds a fixture of every type and request BaliCore maps, and none it does not")
    func walkCoversEveryMapping() throws {
        let fixtures = try Contract.fixturePaths().map(Contract.load)
        #expect(Set(fixtures.map(\.type)) == Set(Contract.responseTypes.keys))
        let requests = fixtures.filter { $0.request.body != nil }.map(\.endpoint)
        #expect(Set(requests) == Set(Contract.requestTypes.keys))
        // Every outbox port meets the API's real answers, and only a port's answers carry one.
        let dispositions = fixtures.filter { $0.disposition != nil }.map(\.endpoint)
        #expect(Set(dispositions) == Set(Contract.outboxes.keys))
    }
}
