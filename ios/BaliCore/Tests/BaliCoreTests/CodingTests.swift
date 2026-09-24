import Foundation
import Testing

@testable import BaliCore

private func decode<T: Decodable>(_: T.Type, _ json: String, strict: Bool = false) throws -> T {
    let decoder = BaliJSON.makeDecoder()
    if strict { decoder.userInfo[.strictVocabulary] = true }
    return try decoder.decode(T.self, from: Data(json.utf8))
}

private func encoded(_ value: some Encodable) throws -> String {
    String(decoding: try BaliJSON.makeEncoder().encode(value), as: UTF8.self)
}

@Suite("Times on the wire")
struct TimeTests {
    struct Stamp: Codable { let at: Date }

    @Test(
        "A time decodes with milliseconds, as JS toISOString writes it, and without",
        arguments: [
            ("2000-01-01T00:01:00.000Z", 946_684_860.0),
            ("2000-01-01T00:01:00Z", 946_684_860.0),
            ("2026-09-24T10:53:12.345Z", 1_790_247_192.345),
            ("2026-09-24T10:53:12Z", 1_790_247_192.0),
        ])
    func decodes(text: String, secondsSince1970: Double) throws {
        let stamp = try decode(Stamp.self, #"{"at":"\#(text)"}"#)
        #expect(abs(stamp.at.timeIntervalSince1970 - secondsSince1970) < 0.000_5)
    }

    @Test("A time encodes as JS toISOString writes it, milliseconds and all")
    func encodes() throws {
        // Half a second is exact in binary, so this holds whether a platform rounds or truncates.
        let precise = Stamp(at: Date(timeIntervalSince1970: 1_790_247_192.5))
        #expect(try encoded(precise) == #"{"at":"2026-09-24T10:53:12.500Z"}"#)
        let whole = Stamp(at: Date(timeIntervalSince1970: 946_684_860))
        #expect(try encoded(whole) == #"{"at":"2000-01-01T00:01:00.000Z"}"#)
    }

    @Test(
        "Anything but an ISO 8601 time is a decoding error, never a guess",
        arguments: ["yesterday", "2000-01-01", ""])
    func refuses(text: String) {
        #expect(throws: DecodingError.self) { try decode(Stamp.self, #"{"at":"\#(text)"}"#) }
    }
}

@Suite("Forward compatibility: /v1 is additive-only and old apps call forever")
struct ForwardCompatibilityTests {
    @Test("A vocabulary value this build does not know decodes as unknown, and encodes as sent")
    func unknownValue() throws {
        let tap = try decode(
            TapResponse.self, #"{"outcome":"queued","session":null,"state":"dozing"}"#)
        #expect(tap.outcome == .unknown("queued"))
        #expect(tap.state == .unknown("dozing"))
        #expect(try encoded(tap.outcome) == #""queued""#)
    }

    @Test("A known value decodes as itself")
    func knownValue() throws {
        let tap = try decode(
            TapResponse.self, #"{"outcome":"already_armed","session":null,"state":null}"#)
        #expect(tap.outcome == .known(.alreadyArmed))
        #expect(tap.outcome.known == .alreadyArmed)
        #expect(tap.state == nil)
    }

    @Test("A history moment of a kind this build does not know still decodes, for the app to skip")
    func unknownHistoryMoment() throws {
        let page = try decode(
            HistoryPage.self,
            #"""
            {"events":[{"eventId":"e1","type":"hall_pass","occurredAt":"2000-01-01T00:01:00.000Z",
              "class":{"id":"c1","name":"Period 3"},"teacher":{"displayName":null},"session":null,
              "reason":"stretch","recordedAs":"late_again","countedIn":null}],"nextBefore":null}
            """#)
        let moment = try #require(page.events.first)
        #expect(moment.type == .unknown("hall_pass"))
        #expect(moment.reason == .unknown("stretch"))
        #expect(moment.recordedAs == .unknown("late_again"))
    }

    @Test("A field this build does not know is ignored")
    func unknownField() throws {
        let checkIn = try decode(
            CheckInResponse.self,
            #"{"status":"gone","state":null,"session":null,"nextCheckInSeconds":30}"#)
        #expect(checkIn.status == .known(.gone))
    }

    @Test("An error's reason this build does not know reads as none; a known one as itself")
    func errorReason() throws {
        let unknown = try decode(
            ApiErrorBody.self,
            #"{"error":{"code":"conflict","reason":"moon_phase","message":"No."}}"#)
        #expect(unknown.error.reason == nil)
        #expect(unknown.error.code == .known(.conflict))

        let known = try decode(
            ApiErrorBody.self,
            #"{"error":{"code":"conflict","reason":"protection_off","message":"No."}}"#)
        #expect(known.error.reason == .protectionOff)

        let none = try decode(
            ApiErrorBody.self,
            #"{"error":{"code":"teapot","message":"No.","details":[{"path":"x"}]}}"#)
        #expect(none.error.reason == nil)
        #expect(none.error.code == .unknown("teapot"))
        #expect(none.error.details == .array([.object(["path": .string("x")])]))
    }

    @Test("The contract tests' strict mode refuses what the app reads as unknown")
    func strictMode() throws {
        #expect(throws: DecodingError.self) {
            try decode(
                TapResponse.self, #"{"outcome":"queued","session":null,"state":null}"#,
                strict: true)
        }
        #expect(throws: DecodingError.self) {
            try decode(
                ApiErrorBody.self,
                #"{"error":{"code":"conflict","reason":"moon_phase","message":"No."}}"#,
                strict: true)
        }
        let known = try decode(
            TapResponse.self, #"{"outcome":"joined","session":null,"state":null}"#, strict: true)
        #expect(known.outcome == .known(.joined))
    }

    @Test("An unlock sent with no reason leaves the field out, as the API expects")
    func unlockWithoutReason() throws {
        let at = Date(timeIntervalSince1970: 946_684_860)
        let skipped = UnlockRequest(eventId: "e1", deviceTime: at)
        #expect(try encoded(skipped).contains("reason") == false)
        let nurse = UnlockRequest(eventId: "e1", deviceTime: at, reason: .nurse)
        #expect(try encoded(nurse).contains(#""reason":"nurse""#))
    }
}
