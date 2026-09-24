import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

let tapRoute = "POST /v1/taps"
let unlockRoute = "POST /v1/sessions/s/unlock"
let refocusRoute = "POST /v1/sessions/s/refocus"

@Suite("The drain: the outbox, sent through the one client", .timeLimit(.minutes(1)))
struct DrainTests {
    @Test("What the phone did goes at once, carrying its event id, and leaves once the server has it")
    func sendsAtOnce() async throws {
        let rig = try Rig()
        #expect(rig.engine.client.baseURL == URL(string: "https://api.bali.test"))
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: .nurse)))
        let sent = try await rig.server.next()
        #expect(sent.route == unlockRoute)
        #expect(sent.eventId == unlock.eventId && sent.deviceTime == iso(t0))
        #expect(sent.token == "Bearer token-1")
        sent.reply(200, Answer.unlocked())
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.link == .reached && state.heardAt == t0 && state.retryAt == nil)
        #expect(try rig.outbox.records().isEmpty)
        await rig.stop()
    }

    @Test("No answer: the record backs off 2 s, then 4 s — nothing goes before it is due")
    func backsOff() async throws {
        let rig = try Rig()
        let tap = try #require(try await rig.engine.record(.tap(tagId: "tag")))
        try await rig.server.next().reply(nil)
        var state = await rig.until { $0.retryAt == at(2) }
        #expect(state.link == .unreachable && state.heardAt == nil)
        #expect(state.queued.map(\.attempts) == [1])
        try await rig.sleeping([at(2)])
        rig.clock.advance(by: 1.5)
        try await rig.sleeping([at(2)])
        #expect(await rig.server.waiting.isEmpty)
        rig.clock.advance(by: 0.5)
        let again = try await rig.server.next()
        #expect(again.eventId == tap.eventId && again.deviceTime == iso(t0))
        again.reply(503)
        state = await rig.until { $0.retryAt == at(6) }
        #expect(state.link == .reached && state.heardAt == at(2))
        try await rig.sleeping([at(6)])
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test("In the order the phone acted: an unlock goes before the refocus made after it")
    func inOrder() async throws {
        let rig = try Rig()
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        let refocus = try #require(try await rig.engine.record(.refocus(session: "s")))
        let first = try await rig.server.next()
        #expect(first.eventId == unlock.eventId)
        first.reply(200, Answer.unlocked())
        let second = try await rig.server.next()
        #expect(second.route == refocusRoute && second.eventId == refocus.eventId)
        second.reply(200, Answer.refocused())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test("A change made while another is in flight goes next: its ring is not lost")
    func ringWhileBusy() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "tag"))
        let tap = try await rig.server.next()
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        tap.reply(200, Answer.joined())
        let next = try await rig.server.next(unlockRoute)
        #expect(next.eventId == unlock.eventId)
        await rig.stop()
    }

    @Test(
        "No token: nothing is sent or settled, and the record waits on sign-in — never dropped, never a sign-out; signed in, it goes at once"
    )
    func noToken() async throws {
        let rig = try Rig()
        await rig.tokens.set(nil)
        let tap = try #require(try await rig.engine.record(.tap(tagId: "tag")))
        await rig.until { $0.link == .signIn && $0.retryAt == at(60) }
        #expect(await rig.server.waiting.isEmpty)
        let kept = try #require(try current(rig.outbox, tap.eventId))
        #expect(kept.attempts == 0 && kept.nextAttemptAt == t0 && !kept.stuck)
        // Unrung, it asks again a minute on: still no token, still nothing sent or counted.
        try await rig.sleeping([at(60)])
        rig.clock.advance(by: 60)
        await rig.until { $0.retryAt == at(120) }
        #expect(await rig.server.waiting.isEmpty)
        #expect(try current(rig.outbox, tap.eventId)?.attempts == 0)
        // A sign-in gives it one, and B4 rings.
        await rig.tokens.set("token-9")
        await rig.engine.retryNow()
        let sent = try await rig.server.next(tapRoute)
        #expect(sent.eventId == tap.eventId && sent.token == "Bearer token-9")
        await rig.stop()
    }

    @Test(
        "A 401: B4 refreshes the token and everything goes again at once — once per rejection; a fresh token rejected too waits out the backoff"
    )
    func reauth() async throws {
        let rig = try Rig()
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.server.next().reply(401)
        let again = try await rig.server.next(unlockRoute)
        #expect(again.eventId == unlock.eventId && again.token == "Bearer token-2")
        #expect(await rig.tokens.refreshes == 1)
        #expect(await rig.engine.state.link == .signIn)
        again.reply(401)
        var state = await rig.until { $0.retryAt == at(4) }
        #expect(state.link == .signIn)
        #expect(await rig.tokens.refreshes == 1)
        // Nothing but a 401 since: a later rejection waits too, with no new refresh.
        rig.clock.advance(by: 4)
        try await rig.server.next(unlockRoute).reply(401)
        state = await rig.until { $0.retryAt == at(12) }
        #expect(await rig.tokens.refreshes == 1)
        // Any other answer ends the rejection: the next 401 refreshes again.
        rig.clock.advance(by: 8)
        try await rig.server.next(unlockRoute).reply(200, Answer.unlocked())
        state = await rig.until { $0.queued.isEmpty }
        #expect(state.link == .reached)
        try await rig.engine.record(.protectionOff(session: "s"))
        try await rig.server.next("POST /v1/sessions/s/protection-off").reply(401)
        let fresh = try await rig.server.next("POST /v1/sessions/s/protection-off")
        #expect(fresh.token == "Bearer token-3")
        #expect(await rig.tokens.refreshes == 2)
        await rig.stop()
    }

    @Test("A 401 with no fresh token to be had waits out the backoff: nothing spins")
    func reauthFails() async throws {
        let rig = try Rig(refreshWorks: false)
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next().reply(401)
        let state = await rig.until { $0.retryAt == at(2) }
        #expect(state.link == .signIn)
        #expect(await rig.tokens.refreshes == 1)
        try await rig.sleeping([at(2)])
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test("The student's retry sends everything at once — a stuck record too, which stays stuck")
    func retryNow() async throws {
        let rig = try Rig()
        let tap = try #require(try await rig.engine.record(.tap(tagId: "tag")))
        try await rig.server.next(tapRoute).reply(409, Answer.refused("event_id_conflict"))
        var state = await rig.until { $0.retryAt == at(2) }
        #expect(state.queued.map(\.stuck) == [true])
        #expect(state.queued.first?.lastReason == .eventIdConflict)
        await rig.engine.retryNow()
        let again = try await rig.server.next(tapRoute)
        #expect(again.eventId == tap.eventId)
        again.reply(503)
        state = await rig.until { $0.queued.first?.attempts == 2 }
        #expect(state.queued.map(\.stuck) == [true])
        await rig.stop()
    }

    @Test("A state change the server refuses is dropped, never sent again — and shown")
    func dropShown() async throws {
        let rig = try Rig()
        try await rig.engine.record(.protectionOff(session: "s"))
        try await rig.server.next("POST /v1/sessions/s/protection-off")
            .reply(409, Answer.refused("not_participating"))
        let state = await rig.until { $0.refused != nil }
        #expect(
            state.refused
                == Refusal(
                    change: .protectionOff(session: "s"), status: 409,
                    reason: .notParticipating, message: "not_participating"))
        #expect(state.queued.isEmpty)
        await rig.stop()
    }
}
