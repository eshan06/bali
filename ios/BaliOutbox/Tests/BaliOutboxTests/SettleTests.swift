import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

@Suite("Settling a send: each disposition's effect")
struct SettleTests {
    /// The dispositions that end a record: every other keeps it.
    static let ending: Set<String> = [
        "apply_session", "wait_for_start", "reread", "recorded", "drop",
    ]

    @Test(
        "On every result and body the TypeScript's tables answer, the record goes exactly when its disposition ends it — an unlock only when recorded — and a refusal is stuck at once",
        arguments: [
            ("tap", Change.tap(tagId: "tag")), ("unlock", .unlock(session: "s", reason: nil)),
            ("state-change", .refocus(session: "s")),
            ("state-change", .protectionOff(session: "s")),
        ])
    func everyGeneratedCase(table: String, change: Change) async throws {
        let (outbox, _) = try makeOutbox()
        var checked = 0
        for testCase in try Contract.table(table).cases {
            for (expected, results) in testCase.dispositions {
                for result in results {
                    let status = try Contract.status(result)
                    // A fresh record per send (protection off: a fresh session, reported once each).
                    let fresh: Change =
                        if case .protectionOff = change {
                            .protectionOff(session: "s\(checked)")
                        } else { change }
                    let queued = try record(outbox, fresh)
                    let disposition = try await send(
                        outbox, queued, status, testCase.body?.data ?? Data(), at: t0)
                    let body = testCase.body.map { String(decoding: $0.data, as: UTF8.self) }
                    let context =
                        "\(fresh) \(status.map(String.init) ?? "no answer") \(body ?? "no body")"
                    #expect(disposition?.rawValue == expected, "\(context)")
                    let kept = try current(outbox, queued.eventId)
                    #expect((kept == nil) == Self.ending.contains(expected), "\(context)")
                    if case .unlock = change {
                        #expect((kept == nil) == (expected == "recorded"), "\(context)")
                    }
                    if let kept {
                        #expect(kept.stuck == (expected == "retry_and_surface"), "\(context)")
                    }
                    checked += 1
                }
            }
        }
        #expect(checked > 900)
    }

    @Test(
        "The API's real answers: each fixture of an outbox endpoint settles as its recorded disposition, a kept one remembering the answer",
        arguments: Contract.endpoints.map(\.folder))
    func fixtures(folder: String) async throws {
        let (outbox, _) = try makeOutbox()
        let change = try #require(Contract.endpoints.first { $0.folder == folder }).change
        let fixtures = try Contract.fixtures(folder)
        #expect(fixtures.count >= 4)
        for (index, (name, fixture)) in fixtures.enumerated() {
            let fresh: Change =
                if case .protectionOff = change { .protectionOff(session: "s\(index)") } else {
                    change
                }
            let queued = try record(outbox, fresh)
            let disposition = try await send(
                outbox, queued, fixture.status, fixture.body.data, at: t0)
            #expect(disposition?.rawValue == fixture.disposition, "\(folder)/\(name)")
            let kept = try current(outbox, queued.eventId)
            #expect((kept == nil) == Self.ending.contains(fixture.disposition), "\(folder)/\(name)")
            if let kept {
                let error = try? BaliJSON.makeDecoder().decode(
                    ApiErrorBody.self, from: fixture.body.data)
                #expect(kept.lastStatus == fixture.status, "\(folder)/\(name)")
                #expect(kept.lastReason == error?.error.reason, "\(folder)/\(name)")
                #expect(kept.lastMessage == error?.error.message, "\(folder)/\(name)")
            }
        }
    }

    @Test("A kept record waits 2 s, 4 s, 8 s… capped at a minute, and counts each send")
    func backoffGrows() async throws {
        let (outbox, _) = try makeOutbox(random: 0)
        let tap = try record(outbox, .tap(tagId: "tag"))
        var now = t0
        for (attempt, wait) in [2, 4, 8, 16, 32, 60, 60, 60, 60, 60].enumerated() {
            #expect(try await send(outbox, tap, nil, at: now) == .tap(.retry))
            let kept = try #require(try current(outbox, tap.eventId))
            #expect(kept.attempts == attempt + 1)
            #expect(kept.nextAttemptAt == now.addingTimeInterval(TimeInterval(wait)))
            now = kept.nextAttemptAt
        }
    }

    @Test(
        "The jitter adds up to as much again, never less and never more — whatever the random source says",
        arguments: [0, 0.25, 0.5, 0.999_999, 1, -3, 7, .nan])
    func jitter(random: Double) throws {
        let (outbox, _) = try makeOutbox(random: random)
        for attempt in 1...12 {
            let base = min(TimeInterval(1 << min(attempt, 6)), Outbox.backoffCap)
            let wait = outbox.backoff(attempt)
            #expect(wait >= base && wait <= 2 * base, "attempt \(attempt): \(wait)")
            if (0...1).contains(random) { #expect(wait == base * (1 + random)) }
        }
    }

    @Test(
        "A 401 and no answer are not the record's fault: they back off but never count toward the bound, nor do 408 and 429"
    )
    func notAnswers() async throws {
        let (outbox, _) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        for status in [nil, 401, 408, 429, nil, 401, 408, 429, nil, 401] as [Int?] {
            try await send(outbox, unlock, status)
        }
        let kept = try #require(try current(outbox, unlock.eventId))
        #expect(kept.attempts == 10 && kept.answers == 0 && !kept.stuck)
        #expect(kept.lastStatus == 401)
    }

    @Test(
        "The bound: the server's answers that leave a record unsettled — a 5xx, a 3xx, a 2xx this build cannot read — make it stuck at the eighth, and stuck stays stuck",
        arguments: [
            (Change.tap(tagId: "tag"), 500, ""),
            (.tap(tagId: "tag"), 200, #"{"outcome":"queued"}"#),
            (.unlock(session: "s", reason: nil), 503, "<html>"),
            (.unlock(session: "s", reason: nil), 200, #"{"outcome":"recorded_elsewhere"}"#),
            (.refocus(session: "s"), 302, ""), (.protectionOff(session: "s"), 200, "not json"),
        ])
    func bound(change: Change, status: Int, body: String) async throws {
        let (outbox, _) = try makeOutbox()
        let queued = try record(outbox, change)
        for answer in 1...Outbox.bound {
            try await send(outbox, queued, status, body)
            let kept = try #require(try current(outbox, queued.eventId))
            #expect(kept.answers == answer)
            #expect(kept.stuck == (answer == Outbox.bound), "answer \(answer)")
            #expect(kept.lastStatus == status)
        }
        // Kept, never discarded — and once stuck, a later answer of any kind leaves it stuck.
        try await send(outbox, queued, nil)
        try await send(outbox, queued, 401)
        let kept = try #require(try current(outbox, queued.eventId))
        #expect(kept.stuck && kept.attempts == Outbox.bound + 2)
    }

    @Test(
        "A refusal the tables keep — a tap's or an unlock's 4xx — is stuck at once, and shown",
        arguments: [Change.tap(tagId: "tag"), .unlock(session: "s", reason: nil)])
    func refusalIsStuck(change: Change) async throws {
        let (outbox, _) = try makeOutbox()
        let queued = try record(outbox, change)
        let disposition = try await send(
            outbox, queued, 409,
            #"{"error":{"code":"conflict","reason":"event_id_conflict","message":"event_id already used by another event"}}"#
        )
        #expect(disposition == .tap(.retryAndSurface) || disposition == .unlock(.retryAndSurface))
        let kept = try #require(try current(outbox, queued.eventId))
        #expect(kept.stuck && kept.answers == 1)
        #expect(kept.lastStatus == 409 && kept.lastReason == .eventIdConflict)
        #expect(kept.lastMessage == "event_id already used by another event")
        // Stuck stays stuck, whatever answers next short of one that ends it.
        try await send(outbox, queued, nil)
        try await send(outbox, queued, 503)
        let later = try #require(try current(outbox, queued.eventId))
        #expect(later.stuck && later.answers == 2 && later.attempts == 3)
        #expect(later.lastStatus == 503 && later.lastReason == nil && later.lastMessage == nil)
    }

    @Test("Retry now makes every record due, stuck ones included, and leaves them stuck")
    func retryNow() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try await send(outbox, tap, 404, #"{"error":{"code":"not_found","message":"no block"}}"#)
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, unlock, nil)
        #expect(try outbox.nextDue(now: t0) == .wait(until: t0.addingTimeInterval(2)))

        let later = t0.addingTimeInterval(1)
        try outbox.retryNow(later)
        #expect(try outbox.records().allSatisfy { $0.nextAttemptAt == later })
        #expect(
            try outbox.nextDue(now: later) == .send(try #require(try current(outbox, tap.eventId))))
        #expect(try current(outbox, tap.eventId)?.stuck == true)
    }
}
