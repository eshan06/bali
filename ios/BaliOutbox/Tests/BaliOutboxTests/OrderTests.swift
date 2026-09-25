import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

let recorded = #"{"outcome":"recorded","recordedAs":"no_live_participation"}"#
let refused = #"{"error":{"code":"bad_input","message":"refused"}}"#

@Suite("The order records go in")
struct OrderTests {
    @Test(
        "In the order the phone acted: an unlock goes ahead of a later refocus, and nothing overtakes it while it backs off"
    )
    func unlockBeforeRefocus() async throws {
        let (outbox, _) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        let refocus = try record(outbox, .refocus(session: "s"))
        #expect(try outbox.nextDue(now: t0) == .send(unlock))

        // No answer: the unlock backs off, and the refocus — due since it was made — waits with it.
        try await send(outbox, unlock, nil)
        #expect(try outbox.nextDue(now: t0) == .wait(until: t0.addingTimeInterval(2)))
        // So does a 5xx, short of the bound.
        let retried = try #require(try current(outbox, unlock.eventId))
        #expect(try outbox.nextDue(now: t0.addingTimeInterval(2)) == .send(retried))
        try await send(outbox, retried, 500, at: t0.addingTimeInterval(2))
        #expect(
            try outbox.nextDue(now: t0.addingTimeInterval(3))
                == .wait(until: t0.addingTimeInterval(6)))

        try await send(outbox, retried, 200, recorded, at: t0.addingTimeInterval(6))
        #expect(try outbox.nextDue(now: t0.addingTimeInterval(6)) == .send(refocus))
    }

    @Test(
        "A pending record holds every record behind it, whatever their kinds, until it is answered")
    func pendingHoldsTheQueue() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        try record(outbox, .protectionOff(session: "s"))
        try await send(outbox, tap, nil)
        #expect(
            try outbox.nextDue(now: t0.addingTimeInterval(1))
                == .wait(until: t0.addingTimeInterval(2)))
        try await send(outbox, tap, 502, at: t0.addingTimeInterval(2))
        #expect(
            try outbox.nextDue(now: t0.addingTimeInterval(5))
                == .wait(until: t0.addingTimeInterval(6)))
        let joined =
            #"{"outcome":"joined","session":{"id":"s","classId":"c","endsAt":"2026-09-24T09:50:00.000Z"},"state":"focused"}"#
        try await send(outbox, tap, 200, joined, at: t0.addingTimeInterval(6))
        #expect(try outbox.nextDue(now: t0.addingTimeInterval(6)) == .send(unlock))
    }

    @Test(
        "A kept record never blocks the ones behind it: refused, or stuck at the bound, it steps aside and is retried among them",
        arguments: [(409, refused), (500, "")])
    func keptStepsAside(status: Int, body: String) async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        let report = try record(outbox, .protectionOff(session: "s"))
        var now = t0
        while try current(outbox, tap.eventId)?.stuck == false {
            #expect(
                try outbox.nextDue(now: now)
                    == .send(try #require(try current(outbox, tap.eventId))))
            try await send(outbox, tap, status, body, at: now)
            now = try #require(try current(outbox, tap.eventId)).nextAttemptAt
        }
        let stuck = try #require(try current(outbox, tap.eventId))
        // Stuck and backing off, the tap no longer holds the unlock or the report behind it.
        let before = stuck.nextAttemptAt.addingTimeInterval(-0.5)
        #expect(try outbox.nextDue(now: before) == .send(unlock))
        try await send(outbox, unlock, 200, recorded, at: before)
        #expect(try outbox.nextDue(now: before) == .send(report))
        // Due again, it goes first: it is still ahead of them.
        #expect(try outbox.nextDue(now: stuck.nextAttemptAt) == .send(stuck))
        // With only it left, the outbox waits for it.
        try await send(outbox, report, 200, #"{"outcome":"applied"}"#, at: before)
        #expect(try outbox.nextDue(now: before) == .wait(until: stuck.nextAttemptAt))
    }

    @Test(
        "A refocus is never sent before the unlock it returns from is recorded — even with that unlock stuck — while the rest go on"
    )
    func refocusWaitsForItsUnlock() async throws {
        let (outbox, _) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, unlock, 400, refused)
        let refocus = try record(outbox, .refocus(session: "s"))
        let report = try record(outbox, .protectionOff(session: "s"))
        // The unlock is stuck, so it holds nothing — but its refocus.
        #expect(try outbox.nextDue(now: t0) == .send(report))
        try await send(outbox, report, 200, #"{"outcome":"applied"}"#)
        #expect(try outbox.nextDue(now: t0) == .wait(until: t0.addingTimeInterval(2)))
        #expect(
            try outbox.nextDue(now: t0.addingTimeInterval(9))
                == .send(try #require(try current(outbox, unlock.eventId))))

        // Recorded at last: its refocus follows.
        try await send(outbox, unlock, 200, recorded, at: t0.addingTimeInterval(9))
        #expect(try outbox.nextDue(now: t0.addingTimeInterval(9)) == .send(refocus))
    }

    @Test(
        "A refocus waits only on its own unlock: not on an older one still stuck, nor on another session's"
    )
    func refocusWaitsOnlyOnItsOwn() async throws {
        let (outbox, _) = try makeOutbox()
        let older = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, older, 400, refused)
        let own = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, own, 200, recorded)
        let refocus = try record(outbox, .refocus(session: "s"))
        #expect(try outbox.nextDue(now: t0) == .send(refocus))

        let (other, _) = try makeOutbox()
        let unlock = try record(other, .unlock(session: "s", reason: nil))
        try await send(other, unlock, 400, refused)
        let elsewhere = try record(other, .refocus(session: "t"))
        #expect(try other.nextDue(now: t0) == .send(elsewhere))
    }

    @Test("Idle only when nothing is queued: a refocus waiting on its stuck unlock waits with it")
    func idle() async throws {
        let (outbox, _) = try makeOutbox()
        #expect(try outbox.nextDue(now: t0) == .idle)
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, unlock, 400, refused)
        let refocus = try record(outbox, .refocus(session: "s"))
        #expect(try outbox.nextDue(now: t0) == .wait(until: t0.addingTimeInterval(2)))
        try await send(outbox, unlock, 200, recorded, at: t0.addingTimeInterval(2))
        try await send(
            outbox, refocus, 200, #"{"outcome":"applied"}"#, at: t0.addingTimeInterval(2))
        #expect(try outbox.nextDue(now: t0.addingTimeInterval(2)) == .idle)
    }
}

@Suite("What holds the phone's reads")
struct AwaitingTests {
    @Test(
        "Every record still pending awaits its answer; a refused tap no longer does, as its first answer came"
    )
    func pending() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try record(outbox, .unlock(session: "s", reason: nil))
        #expect(try outbox.awaiting() == 2)
        try await send(outbox, tap, nil)
        try await send(outbox, tap, 503)
        #expect(try outbox.awaiting() == 2)
        try await send(outbox, tap, 409, refused)
        #expect(try outbox.awaiting() == 1)
    }

    @Test(
        "An unlock the server refuses, or leaves unsettled to the bound, stops holding reads — but still guards its session",
        arguments: [(400, refused, 1), (500, "", Outbox.bound)])
    func stuckUnlock(status: Int, body: String, sends: Int) async throws {
        let (outbox, _) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: .nurse))
        for sent in 1...sends {
            #expect(try outbox.awaiting() == 1)
            try await send(outbox, unlock, status, body, at: t0.addingTimeInterval(Double(sent)))
        }
        #expect(try outbox.awaiting() == 0)
        #expect(try outbox.holdsUnlock(session: "s"))
        #expect(try !outbox.holdsUnlock(session: "t"))
        // Its refocus waits on it unsent, and so awaits nothing either: the server has seen neither.
        try record(outbox, .refocus(session: "s"))
        #expect(try outbox.awaiting() == 0)
        // Recorded at last: the unlock is gone, and its refocus is on its way.
        try await send(outbox, unlock, 200, recorded, at: t0.addingTimeInterval(100))
        #expect(try !outbox.holdsUnlock(session: "s"))
        #expect(try outbox.awaiting() == 1)
    }

    @Test("A refocus behind a pending unlock awaits with it")
    func refocusBehindPendingUnlock() async throws {
        let (outbox, _) = try makeOutbox()
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, unlock, nil)
        try record(outbox, .refocus(session: "s"))
        #expect(try outbox.awaiting() == 2)
    }
}

@Suite("An unlock is never discarded")
struct UnlockSafetyTests {
    /// Answers of every shape: none; each outcome of each table, with a session and without; one
    /// no build knows; bodies that do not decode; refusals; the transport's statuses.
    static let answers: [(Int?, String)] = [
        (nil, ""), (200, #"{"outcome":"applied"}"#), (200, recorded),
        (200, #"{"outcome":"replay"}"#),
        (
            200,
            #"{"outcome":"joined","session":{"id":"s","classId":"c","endsAt":"2026-09-24T09:50:00.000Z"},"state":"focused"}"#
        ),
        (200, #"{"outcome":"armed","session":null,"state":null}"#),
        (200, #"{"outcome":"replay","session":null}"#),
        (200, #"{"outcome":"what"}"#), (200, "{"), (204, ""), (302, ""), (400, refused), (401, ""),
        (404, refused), (408, ""), (409, refused), (429, ""), (500, ""), (503, "<html>"),
    ]

    @Test(
        "A random walk of records and sends, due or not, deletes an unlock only when a send says recorded"
    )
    func randomWalk() async throws {
        for seed in 1...12 as ClosedRange<UInt64> {
            var random = SplitMix64(state: seed)
            let (outbox, _) = try makeOutbox(random: 0.5)
            var unrecorded = Set<String>()
            var now = t0
            for step in 0..<120 {
                now = now.addingTimeInterval(Double(Int.random(in: 0..<90, using: &random)))
                let session = ["s", "t"].randomElement(using: &random)!
                switch Int.random(in: 0..<10, using: &random) {
                case 0: try outbox.record(.tap(tagId: "tag"), now: now)
                case 1: try outbox.record(.refocus(session: session), now: now)
                case 2: try outbox.record(.protectionOff(session: session), now: now)
                case 3: try outbox.protectionRestored()
                case 4:
                    // Of the session, or filed under the latest tap queued (decision 11).
                    let tap = try outbox.records().last { if case .tap = $0.change { true } else { false } }
                    let change: Change =
                        if let tap, Bool.random(using: &random) {
                            .unlockUnderTap(tap: tap.eventId, reason: nil)
                        } else { .unlock(session: session, reason: nil) }
                    let unlock = try #require(try outbox.record(change, now: now))
                    unrecorded.insert(unlock.eventId)
                case 5...7:
                    guard case .send(let due) = try outbox.nextDue(now: now) else { break }
                    let (status, body) = Self.answers.randomElement(using: &random)!
                    if try await send(outbox, due, status, body, at: now) == .unlock(.recorded) {
                        unrecorded.remove(due.eventId)
                    }
                default:
                    guard let any = try outbox.records().randomElement(using: &random) else {
                        break
                    }
                    let (status, body) = Self.answers.randomElement(using: &random)!
                    if try await send(outbox, any, status, body, at: now) == .unlock(.recorded) {
                        unrecorded.remove(any.eventId)
                    }
                }
                let queued = try outbox.records().filter(\.change.isUnlock).map(\.eventId)
                #expect(Set(queued) == unrecorded, "seed \(seed), step \(step)")
            }
        }
    }
}
