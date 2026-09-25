import BaliCore
import Foundation
import GRDB

/// What the phone did — acted on at once, and queued to send.
public enum Change: Sendable, Hashable {
    /// `POST /v1/taps`: the tag the phone read.
    case tap(tagId: String)
    /// `POST /v1/sessions/{id}/unlock`, with the student's reason, if any.
    case unlock(session: String, reason: UnlockReason?)
    /// `POST /v1/taps/{eventId}/unlock`: an unlock made while the phone's own tap `tap` was
    /// unanswered, filed under it (owner decision 11) — sent there always, even once the tap's
    /// answer names a session, whose shields it then guards (`Outbox.holdsUnlock`).
    case unlockUnderTap(tap: String, reason: UnlockReason?)
    /// `POST /v1/sessions/{id}/refocus`.
    case refocus(session: String)
    /// `POST /v1/sessions/{id}/protection-off`: the Screen Time permission was found revoked.
    case protectionOff(session: String)

    /// Either unlock: a session's, or one filed under a tap.
    var isUnlock: Bool {
        switch self {
        case .unlock, .unlockUnderTap: true
        case .tap, .refocus, .protectionOff: false
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
    /// Where it sits in what the phone did (A12): the file's install and the record's `seq`, sent
    /// with every attempt. Nil only for a file with no install, which no migrated file is — the
    /// record then goes without one, ordered by its time, rather than not at all.
    let order: ActionOrder?

    public enum Request: Sendable, Hashable {
        case tap(TapRequest)
        case unlock(session: String, UnlockRequest)
        case unlockUnderTap(tap: String, UnlockRequest)
        case refocus(session: String, RefocusRequest)
        case protectionOff(session: String, ProtectionOffRequest)
    }

    /// The request to send, built from what was stored: every attempt sends the same.
    public var request: Request {
        let (id, time) = (eventId, recordedAt)
        func unlock(_ reason: UnlockReason?) -> UnlockRequest {
            UnlockRequest(eventId: id, deviceTime: time, reason: reason, order: order)
        }
        return switch change {
        case .tap(let tagId):
            .tap(TapRequest(tagId: tagId, eventId: id, deviceTime: time, order: order))
        case .unlock(let session, let reason): .unlock(session: session, unlock(reason))
        case .unlockUnderTap(let tap, let reason): .unlockUnderTap(tap: tap, unlock(reason))
        case .refocus(let session):
            .refocus(session: session, RefocusRequest(eventId: id, deviceTime: time, order: order))
        case .protectionOff(let session):
            .protectionOff(
                session: session, ProtectionOffRequest(eventId: id, deviceTime: time, order: order))
        }
    }
}

extension OutboxRecord: FetchableRecord {
    public init(row: Row) throws {
        switch try row.decode(String.self, forColumn: "kind") {
        case "tap": change = .tap(tagId: try row.decode(forColumn: "tagId"))
        case "unlock":
            let reason = try row.decode(String?.self, forColumn: "reason")
                .flatMap(UnlockReason.init(rawValue:))
            // Filed under its tap, it stays so once the tap's answer names a session (decision 11).
            change =
                if let tap = try row.decode(String?.self, forColumn: "tapId") {
                    .unlockUnderTap(tap: tap, reason: reason)
                } else {
                    .unlock(session: try row.decode(forColumn: "sessionId"), reason: reason)
                }
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
        let seq = try row.decode(Int.self, forColumn: "seq")
        order = try row.decode(String?.self, forColumn: "install").map {
            ActionOrder(install: $0, seq: seq)
        }
    }

    struct UnknownKind: Error { let kind: String }
}

extension OutboxRecord {
    /// Sends the record's request through `client`, once, and reads the answer as its own
    /// endpoint's type by its own kind's table — the only way to make a `Sent`, so `settle` can
    /// never read an answer by another kind's table.
    public func send(through client: APIClient) async -> Sent {
        switch request {
        case .tap(let request):
            let response = await client.tap(request)
            return Sent(eventId, response, .tap(tapDisposition(response.result, response.answer)))
        case .unlock(let session, let request):
            return unlocked(await client.unlock(session: session, request))
        case .unlockUnderTap(let tap, let request):
            return unlocked(await client.unlock(tap: tap, request))
        case .refocus(let session, let request):
            let response = await client.refocus(session: session, request)
            let disposition = stateChangeDisposition(response.result, response.answer)
            return Sent(eventId, response, .stateChange(disposition))
        case .protectionOff(let session, let request):
            let response = await client.protectionOff(session: session, request)
            let disposition = stateChangeDisposition(response.result, response.answer)
            return Sent(eventId, response, .stateChange(disposition))
        }
    }

    /// Either unlock's answer, by the unlock's table.
    private func unlocked(_ response: APIResponse<UnlockResponse>) -> Sent {
        Sent(eventId, response, .unlock(unlockDisposition(response.result, response.answer)))
    }
}

/// One send of a record, answered, and what its table made of the answer: `settle` takes it.
public struct Sent: Sendable {
    public let eventId: String
    /// The status the server answered with, or `.networkError` and why there was none.
    public let result: SendResult
    public let noAnswer: NoAnswer?
    /// Any status but a 2xx: the error body, whose `reason` a screen keys on.
    public let error: ApiErrorBody?
    public let disposition: Disposition
    /// A 2xx answer's session and state: the truth as of this change, to reconcile to.
    public let session: SessionView?
    public let state: ParticipationState?

    fileprivate init<Answer: ChangeAnswer>(
        _ eventId: String, _ response: APIResponse<Answer>, _ disposition: Disposition
    ) {
        (self.eventId, result, noAnswer, error) =
            (eventId, response.result, response.noAnswer, response.error)
        (self.disposition, session, state) =
            (disposition, response.answer?.session, response.answer?.state?.known)
    }

    var status: Int? { if case .status(let status) = result { status } else { nil } }
}

/// An outbox endpoint's answer: each names the session and the state it left the phone in.
protocol ChangeAnswer: Decodable, Sendable {
    var session: SessionView? { get }
    var state: OrUnknown<ParticipationState>? { get }
}

extension TapResponse: ChangeAnswer {}
extension UnlockResponse: ChangeAnswer {}
extension RefocusResponse: ChangeAnswer {}
extension ProtectionOffResponse: ChangeAnswer {}

/// What one answer means for a record, by its kind's table — BaliCore's, never decided here.
public enum Disposition: Sendable, Hashable {
    case tap(TapDisposition)
    case unlock(UnlockDisposition)
    case stateChange(StateChangeDisposition)

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
public enum EventID {
    public static func mint(at now: Date) -> String {
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
