import BaliCore
import Foundation
import GRDB

/// What the phone did — acted on at once, and queued to send.
public enum Change: Sendable, Hashable {
    /// `POST /v1/taps`: the tag the phone read.
    case tap(tagId: String)
    /// `POST /v1/sessions/{id}/unlock`, with the student's reason, if any.
    case unlock(session: String, reason: UnlockReason?)
    /// `POST /v1/sessions/{id}/refocus`.
    case refocus(session: String)
    /// `POST /v1/sessions/{id}/protection-off`: the Screen Time permission was found revoked.
    case protectionOff(session: String)

    var kind: String {
        switch self {
        case .tap: "tap"
        case .unlock: "unlock"
        case .refocus: "refocus"
        case .protectionOff: "protection_off"
        }
    }

    var session: String? {
        switch self {
        case .tap: nil
        case .unlock(let session, _), .refocus(let session), .protectionOff(let session): session
        }
    }
}

/// One queued record.
public struct OutboxRecord: Sendable, Hashable {
    /// A UUIDv7 minted when the phone acted, sent with every attempt (rule 4).
    public let eventId: String
    public let change: Change
    /// The phone's clock when it acted: the request's `deviceTime`.
    public let recordedAt: Date
    /// Sends that left it queued; of them, `answers` the server answered — what the bound counts.
    public let attempts: Int
    public let answers: Int
    public let nextAttemptAt: Date
    /// Refused (`retry_and_surface`), or unsettled by `Outbox.bound` answers: still kept, retried
    /// and shown, but no longer holding the records behind it or the phone's reads.
    public let stuck: Bool
    /// The last answer, for a screen: its status (nil for none), an error's reason and message.
    public let lastStatus: Int?
    public let lastReason: ApiErrorReason?
    public let lastMessage: String?
    /// A refocus's: the unlock it returns from, while that is unrecorded.
    let follows: String?

    public enum Request: Sendable, Hashable {
        case tap(TapRequest)
        case unlock(session: String, UnlockRequest)
        case refocus(session: String, RefocusRequest)
        case protectionOff(session: String, ProtectionOffRequest)
    }

    /// The request to send, built from what was stored: every attempt sends the same.
    public var request: Request {
        let (id, time) = (eventId, recordedAt)
        return switch change {
        case .tap(let tagId): .tap(TapRequest(tagId: tagId, eventId: id, deviceTime: time))
        case .unlock(let session, let reason):
            .unlock(session: session, UnlockRequest(eventId: id, deviceTime: time, reason: reason))
        case .refocus(let session):
            .refocus(session: session, RefocusRequest(eventId: id, deviceTime: time))
        case .protectionOff(let session):
            .protectionOff(session: session, ProtectionOffRequest(eventId: id, deviceTime: time))
        }
    }
}

extension OutboxRecord: FetchableRecord {
    public init(row: Row) throws {
        switch try row.decode(String.self, forColumn: "kind") {
        case "tap": change = .tap(tagId: try row.decode(forColumn: "tagId"))
        case "unlock":
            change = .unlock(
                session: try row.decode(forColumn: "sessionId"),
                reason: try row.decode(String?.self, forColumn: "reason")
                    .flatMap(UnlockReason.init(rawValue:)))
        case "refocus": change = .refocus(session: try row.decode(forColumn: "sessionId"))
        case "protection_off":
            change = .protectionOff(session: try row.decode(forColumn: "sessionId"))
        case let kind: throw UnknownKind(kind: kind)
        }
        eventId = try row.decode(forColumn: "eventId")
        recordedAt = try row.decode(forColumn: "recordedAt")
        attempts = try row.decode(forColumn: "attempts")
        answers = try row.decode(forColumn: "answers")
        nextAttemptAt = try row.decode(forColumn: "nextAttemptAt")
        stuck = try row.decode(forColumn: "stuck")
        lastStatus = try row.decode(forColumn: "lastStatus")
        lastReason = try row.decode(String?.self, forColumn: "lastReason")
            .flatMap(ApiErrorReason.init(rawValue:))
        lastMessage = try row.decode(forColumn: "lastMessage")
        follows = try row.decode(forColumn: "follows")
    }

    struct UnknownKind: Error { let kind: String }
}

/// What one answer means for a record, by its kind's table — BaliCore's, never decided here.
public enum Disposition: Sendable, Hashable {
    case tap(TapDisposition)
    case unlock(UnlockDisposition)
    case stateChange(StateChangeDisposition)

    init<Answer>(_ change: Change, _ response: APIResponse<Answer>) {
        let (result, answer) = (response.result, response.answer)
        switch change {
        case .tap: self = .tap(tapDisposition(result, answer as? TapResponse))
        case .unlock: self = .unlock(unlockDisposition(result, answer as? UnlockResponse))
        case .refocus, .protectionOff:
            self = .stateChange(stateChangeDisposition(result, answer as? any StateChangeAnswer))
        }
    }

    /// Whether the record stays queued: each case by name, so one BaliCore adds must be placed.
    var keeps: Bool {
        switch self {
        case .tap(.applySession), .tap(.waitForStart), .tap(.reread), .unlock(.recorded),
            .stateChange(.applySession), .stateChange(.reread), .stateChange(.drop):
            false
        case .tap(.retry), .tap(.reauth), .tap(.retryAndSurface), .unlock(.retry),
            .unlock(.reauth), .unlock(.retryAndSurface), .stateChange(.retry),
            .stateChange(.reauth):
            true
        }
    }

    /// A refusal the record is kept through: stuck at once.
    var refused: Bool { self == .tap(.retryAndSurface) || self == .unlock(.retryAndSurface) }
}

/// Event ids as the API's are written: a lower-case UUIDv7, minted by the phone when it acts,
/// offline too — the Unix time in milliseconds, then random bits (ARCHITECTURE, data model,
/// decision 2). Foundation's `UUID` is a v4.
enum EventID {
    static func mint(at now: Date) -> String {
        var bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max) }
        let milliseconds = UInt64(max(0, now.timeIntervalSince1970 * 1000))
        for index in 0..<6 {
            bytes[index] = UInt8(truncatingIfNeeded: milliseconds >> (40 - 8 * index))
        }
        bytes[6] = 0x70 | (bytes[6] & 0x0F)  // version 7
        bytes[8] = 0x80 | (bytes[8] & 0x3F)  // variant 10
        var text = bytes.map { String(format: "%02x", $0) }.joined()
        for offset in [20, 16, 12, 8] {
            text.insert("-", at: text.index(text.startIndex, offsetBy: offset))
        }
        return text
    }
}
