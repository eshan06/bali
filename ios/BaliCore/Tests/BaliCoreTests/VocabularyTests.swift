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

    @Test(
        "Each vocabulary holds its list's values, in its order",
        arguments: [
            ("index.ts", "USER_ROLES", UserRole.allCases.map(\.rawValue)),
            ("index.ts", "PARTICIPATION_STATES", ParticipationState.allCases.map(\.rawValue)),
            ("index.ts", "HISTORY_EVENT_TYPES", HistoryEventType.allCases.map(\.rawValue)),
            ("index.ts", "UNLOCK_RECORDED_AS", UnlockRecordedAs.allCases.map(\.rawValue)),
            (
                "index.ts", "PROTECTION_OFF_RECORDED_AS",
                ProtectionOffRecordedAs.allCases.map(\.rawValue)
            ),
            ("index.ts", "UNLOCK_REASONS", UnlockReason.allCases.map(\.rawValue)),
            ("errors.ts", "API_ERROR_STATUS", ApiErrorCode.allCases.map(\.rawValue)),
            ("errors.ts", "API_ERROR_REASONS", ApiErrorReason.allCases.map(\.rawValue)),
            ("outbox-contract.ts", "TAP_OUTCOMES", TapOutcome.allCases.map(\.rawValue)),
            (
                "outbox-contract.ts", "STATE_CHANGE_OUTCOMES",
                ProtectionOffResponse.Outcome.allCases.map(\.rawValue)
            ),
            (
                "unlock-contract.ts", "UNLOCK_RECORDED_OUTCOMES",
                UnlockOutcome.allCases.map(\.rawValue)
            ),
        ])
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
