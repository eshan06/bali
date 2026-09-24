import Foundation
import Testing

@testable import BaliCore

/// Each vocabulary against the `@bali/shared` list it mirrors, read from the TypeScript itself: a
/// value added there fails here until BaliCore has it too — even one no fixture carries yet.
@Suite("The vocabularies mirror @bali/shared")
struct VocabularyTests {
    static func source(_ file: String) throws -> String {
        let url = Contract.repoRoot.appending(path: "packages/shared/src/\(file)")
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// The values of `export const <name> = [...] as const`, or the keys of `= {...} as const`,
    /// in `source` — its comments left out.
    static func values(of name: String, in source: String) throws -> [String] {
        let start = try #require(source.range(of: "export const \(name) = "), "no \(name)")
        let object = source[start.upperBound...].hasPrefix("{")
        let end = try #require(
            source[start.upperBound...].range(of: object ? "} as const" : "] as const"),
            "\(name) never ends")
        let list = source[start.upperBound..<end.lowerBound].split(separator: "\n")
            .map { $0.split(separator: "//", maxSplits: 1, omittingEmptySubsequences: false)[0] }
            .joined(separator: "\n")
        return object
            ? list.matches(of: /(\w+):/).map { String($0.1) }
            : list.matches(of: /'([^']*)'/).map { String($0.1) }
    }

    /// A vocabulary's values, in its order.
    static func values<Vocabulary: RawRepresentable & CaseIterable>(_: Vocabulary.Type) -> [String]
    where Vocabulary.RawValue == String {
        Vocabulary.allCases.map(\.rawValue)
    }

    /// Each vocabulary: the file its list is in, the list, and BaliCore's values for it.
    static let vocabularies: [(file: String, list: String, swift: [String])] = [
        ("index.ts", "USER_ROLES", values(UserRole.self)),
        ("index.ts", "PARTICIPATION_STATES", values(ParticipationState.self)),
        ("index.ts", "HISTORY_EVENT_TYPES", values(HistoryEventType.self)),
        ("index.ts", "UNLOCK_RECORDED_AS", values(UnlockRecordedAs.self)),
        ("index.ts", "PROTECTION_OFF_RECORDED_AS", values(ProtectionOffRecordedAs.self)),
        ("index.ts", "UNLOCK_REASONS", values(UnlockReason.self)),
        ("errors.ts", "API_ERROR_STATUS", values(ApiErrorCode.self)),
        ("errors.ts", "API_ERROR_REASONS", values(ApiErrorReason.self)),
        ("outbox-contract.ts", "TAP_OUTCOMES", values(TapOutcome.self)),
        ("outbox-contract.ts", "STATE_CHANGE_OUTCOMES", values(StateChangeOutcome.self)),
        ("unlock-contract.ts", "UNLOCK_RECORDED_OUTCOMES", values(UnlockOutcome.self)),
        // Each response's own: a value one gains fails here even with no fixture carrying it —
        // `removed_from_class` is a teacher's answer, never in a student fixture.
        ("api.ts", "UPDATE_ME_OUTCOMES", values(UpdateMeResponse.Outcome.self)),
        ("api.ts", "CHECK_IN_STATUSES", values(CheckInResponse.Status.self)),
        ("api.ts", "REFOCUS_OUTCOMES", values(RefocusResponse.Outcome.self)),
        ("api.ts", "PROTECTION_OFF_OUTCOMES", values(ProtectionOffResponse.Outcome.self)),
        ("api.ts", "ENROLLMENT_JOIN_OUTCOMES", values(EnrollmentJoinResponse.Outcome.self)),
        ("api.ts", "END_ENROLLMENT_OUTCOMES", values(EndEnrollmentResponse.Outcome.self)),
        ("api.ts", "END_ENROLLMENT_REASONS", values(EndEnrollmentResponse.Reason.self)),
    ]

    @Test("Each vocabulary holds its list's values, in its order", arguments: vocabularies)
    func mirrors(file: String, list: String, swift: [String]) throws {
        #expect(try Self.values(of: list, in: Self.source(file)) == swift)
    }

    @Test("DisplayState is the stored states, then the derived ones")
    func displayState() throws {
        let stored = try Self.values(of: "PARTICIPATION_STATES", in: Self.source("index.ts"))
        let type = try #require(
            try Self.source("state.ts").firstMatch(
                of: /export type DisplayState = ParticipationState(.*);/))
        let derived = type.1.matches(of: /'([^']*)'/).map { String($0.1) }
        #expect(DisplayState.allCases.map(\.rawValue) == stored + derived)
    }
}
