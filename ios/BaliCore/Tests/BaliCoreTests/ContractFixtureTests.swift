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
    /// `disposition`, what the TS outbox table says of the answer, is for the outbox's port.
    struct Fixture: Decodable {
        struct Request: Decodable { let body: JSONValue? }

        let endpoint: String
        let request: Request
        let type: String
        let body: JSONValue
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
        "POST /v1/sessions/{id}/refocus": RefocusRequest.self,
        "POST /v1/sessions/{id}/protection-off": ProtectionOffRequest.self,
        "POST /v1/enrollments": EnrollmentJoinRequest.self,
    ]

    /// `json` decoded as a `T` — strictly, so a vocabulary value BaliCore lacks fails rather than
    /// reading as `.unknown` — and encoded back: all of it that BaliCore reads, as JSON.
    static func roundTrip<T: Codable>(_: T.Type, _ json: JSONValue) throws -> JSONValue {
        let decoder = BaliJSON.makeDecoder()
        decoder.userInfo[.strictVocabulary] = true
        let value = try decoder.decode(T.self, from: JSONEncoder().encode(json))
        return try JSONDecoder().decode(JSONValue.self, from: BaliJSON.makeEncoder().encode(value))
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

        guard let request = fixture.request.body else { return }
        let requestType = try #require(
            Contract.requestTypes[fixture.endpoint], "BaliCore has no body for \(fixture.endpoint)")
        // What the phone sends: every field, none extra, each time as the API's clock writes it.
        #expect(try Contract.roundTrip(requestType, request) == request)
    }

    @Test("The walk finds a fixture of every type and request BaliCore maps, and none it does not")
    func walkCoversEveryMapping() throws {
        let fixtures = try Contract.fixturePaths().map(Contract.load)
        #expect(Set(fixtures.map(\.type)) == Set(Contract.responseTypes.keys))
        let requests = fixtures.filter { $0.request.body != nil }.map(\.endpoint)
        #expect(Set(requests) == Set(Contract.requestTypes.keys))
    }
}
