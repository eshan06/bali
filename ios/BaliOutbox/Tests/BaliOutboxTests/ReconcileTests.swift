import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

@Suite("Applying answers: the phone's truth", .timeLimit(.minutes(3)))
struct AnswerTests {
    @Test(
        "A tap is shielded for at once while unanswered; then the phone is in the session its answer names, in the state it names"
    )
    func tapAnswered() async throws {
        let rig = try Rig()
        let tap = try #require(try await rig.engine.record(.tap(tagId: "tag")))
        var state = await rig.until { $0.pendingTap != nil }
        #expect(state.pendingTap == tap && state.standing == .out)
        // A replay answers the state now: here, an unlock made since.
        try await rig.server.next(tapRoute).reply(200, Answer.replay(state: "unlocked"))
        state = await rig.until { $0.queued.isEmpty }
        #expect(state.pendingTap == nil)
        #expect(state.standing == .inSession(session(), .unlocked))
        await rig.stop()
    }

    @Test("Armed, the phone waits for the Start — but arming never ends a session it is in")
    func armed() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
        try await rig.tapIn()
        try await rig.engine.record(.tap(tagId: "another teacher's"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(), .focused))
        await rig.stop()
    }

    @Test(
        "A tap recorded but no longer current, or refused, names no window: its shield ends and the truth is read again",
        arguments: [(200, Answer.replayNoSession), (409, Answer.refused("session_not_running"))])
    func tapWithoutWindow(status: Int, body: String) async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(status, body)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        let state = await rig.until { $0.standing == .out }
        #expect(state.pendingTap == nil)
        await rig.stop()
    }

    @Test("The phone's own change stands at once: an unlock, a refocus, protection off")
    func actsAtOnce() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        try await rig.engine.record(.refocus(session: "s"))
        #expect(await rig.engine.state.standing == .inSession(session(), .focused))
        try await rig.engine.record(.protectionOff(session: "s"))
        #expect(await rig.engine.state.standing == .inSession(session(), .protectionOff))
        // A change of another session leaves the phone's be.
        try await rig.engine.record(.unlock(session: "t", reason: nil))
        #expect(await rig.engine.state.standing == .inSession(session(), .protectionOff))
        await rig.stop()
    }

    @Test(
        "A change's answer is the truth as of that change — but a later change of the phone's, still unanswered, stands over it"
    )
    func laterChangeStands() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        let unlock = try await rig.server.next(unlockRoute)
        try await rig.engine.record(.refocus(session: "s"))
        unlock.reply(200, Answer.unlocked(session(endsAt: 4000)))
        // The drain has read the unlock's answer once it sends the refocus.
        let refocus = try await rig.server.next(refocusRoute)
        #expect(await rig.engine.state.standing == .inSession(session(), .focused))
        refocus.reply(200, Answer.refocused(session(endsAt: 5000)))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(endsAt: 5000), .focused))
        await rig.stop()
    }

    @Test(
        "An unlock recorded with a note names no live session — none, or one over — so the truth is read again",
        arguments: [Answer.unlockNoted, Answer.unlockAfterEnd()])
    func unlockNoted(answer: String) async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        try await rig.server.next(unlockRoute).reply(200, answer)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.standing == .out && $0.queued.isEmpty }
        await rig.stop()
    }
}

@Suite("The check-in and the reads of the truth", .timeLimit(.minutes(3)))
struct ReadTests {
    @Test("The check-in runs every 30 seconds in the foreground — never behind it — and coming back reads the truth")
    func cadence() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        try await rig.sleeping([at(30)])
        rig.clock.advance(by: 30)
        let first = try await rig.server.next()
        #expect(first.route == checkInRoute && first.deviceTime == iso(at(30)))
        first.reply(200, Answer.live())
        try await rig.sleeping([at(60)])
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        try await rig.sleeping([at(90)])
        // Behind the app: its timer lapses, and nothing is sent however long.
        await rig.engine.setForeground(false)
        rig.clock.advance(by: 30)
        try await rig.sleeping([])
        rig.clock.advance(by: 600)
        #expect(await rig.server.waiting.isEmpty)
        // Back in front: the truth, at once, then the check-ins again.
        try await rig.foreground()
        try await rig.sleeping([at(720)])
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test("A read of the truth that gets no answer is tried again at the next wake — not at once")
    func rereadRetried() async throws {
        let rig = try Rig()
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(nil)
        try await rig.sleeping([at(30)])
        #expect(await rig.server.waiting.isEmpty)
        #expect(await rig.engine.state.link == .unreachable)
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, Answer.me())
        await rig.until { $0.standing == .inSession(session(), .focused) }
        await rig.stop()
    }

    @Test("An outbox the check-in cannot stamp from is shown, and no read is made until it can be")
    func unreadableOutbox() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        try await rig.outbox.pool.write { try $0.execute(sql: "ALTER TABLE outbox RENAME TO gone") }
        rig.clock.advance(by: 30)
        await rig.until { $0.link == .storageFailed }
        try await rig.sleeping([at(60)])
        #expect(await rig.server.waiting.isEmpty)
        try await rig.outbox.pool.write { try $0.execute(sql: "ALTER TABLE gone RENAME TO outbox") }
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live())
        await rig.until { $0.link == .reached }
        await rig.stop()
    }

    @Test("Out of a session there is nothing to check in to: the foreground reads the truth, once")
    func noSessionNoCheckIn() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil))
        rig.clock.advance(by: 90)
        try await rig.sleeping([at(120)])
        #expect(await rig.server.waiting.isEmpty)
        #expect(await rig.engine.state.standing == .out)
        await rig.stop()
    }

    @Test("A check-in answers the truth: an extension, an unlock the grid saw first — applied")
    func checkInApplies() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute)
            .reply(200, Answer.live(session(endsAt: 4000), state: "protection_off"))
        let state = await rig.until { $0.standing != .inSession(session(), .focused) }
        #expect(state.standing == .inSession(session(endsAt: 4000), .protectionOff))
        await rig.stop()
    }

    @Test(
        "A check-in finding nothing live there, or no such session, reads the truth again",
        arguments: [(200, Answer.gone), (404, Answer.refused("session_not_found"))])
    func checkInGone(status: Int, body: String) async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(status, body)
        try await rig.server.next(meRoute).reply(200, Answer.me(session("t"), state: "unlocked"))
        await rig.until { $0.standing == .inSession(session("t"), .unlocked) }
        await rig.stop()
    }

    @Test(
        "`GET /v1/me`'s states: silence is still focus, ended is out, and a state this build does not know is never focus",
        arguments: [
            ("silent", Standing.inSession(session(), .focused)),
            ("unlocked", .inSession(session(), .unlocked)),
            ("protection_off", .inSession(session(), .protectionOff)), ("ended", .out),
            ("on_a_break", .inSession(session(), nil)),
        ])
    func meStates(state: String, standing: Standing) async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(session(), state: state))
        #expect(await rig.engine.state.standing == standing)
        await rig.stop()
    }

    @Test("A read naming no session leaves an armed phone waiting: no read shows an armed tap")
    func waitingStays() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting }
        try await rig.foreground(Answer.me(nil))
        #expect(await rig.engine.state.standing == .waiting)
        await rig.stop()
    }
}

@Suite("The reconcile: no read overrides a newer change", .timeLimit(.minutes(3)))
struct StaleReadTests {
    @Test("#56's race: a check-in read before an unlock and answered after it is never applied")
    func readBeforeChange() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        rig.clock.advance(by: 30)
        let checkIn = try await rig.server.next(checkInRoute)
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        let unlock = try await rig.server.next(unlockRoute)
        // It read `focused` before the unlock: stale, and ignored.
        checkIn.reply(200, Answer.live())
        try await rig.sleeping([at(60)])
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        unlock.reply(200, Answer.unlocked())
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(), .unlocked))
        await rig.stop()
    }

    @Test("A read sent while a change awaited its answer is stale, even once that answer has come")
    func readWhileAwaiting() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        let unlock = try await rig.server.next(unlockRoute)
        rig.clock.advance(by: 30)
        let checkIn = try await rig.server.next(checkInRoute)
        unlock.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        checkIn.reply(200, Answer.live(session(endsAt: 4000)))
        try await rig.sleeping([at(60)])
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        // The next check-in, sent with nothing awaiting, reconciles.
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt: 4000)))
        await rig.until { $0.standing == .inSession(session(endsAt: 4000), .focused) }
        await rig.stop()
    }

    @Test(
        "The unlock guard: stuck, an unlock holds no read — but none turns its session's shields back on; the window and the end still apply"
    )
    func unlockGuard() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: .nurse))
        try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        #expect(try rig.outbox.awaiting() == 0)
        // `focused`, and extended: the window applies, the focus does not.
        try await rig.foreground(Answer.me(session(endsAt: 4000)))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .unlocked))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt: 4000)))
        try await rig.sleeping([at(60)])
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .unlocked))
        // The session over: that applies, and the unlock stays queued, never discarded.
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.gone)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.standing == .out }
        #expect(try rig.outbox.holdsUnlock(session: "s"))
        await rig.stop()
    }

    @Test("…but a refocus the student made since the stuck unlock stands: a read agreeing with it applies")
    func refocusAfterStuckUnlock() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        try await rig.engine.record(.refocus(session: "s"))
        #expect(await rig.engine.state.standing == .inSession(session(), .focused))
        try await rig.foreground(Answer.me(session(endsAt: 4000)))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .focused))
        await rig.stop()
    }

    @Test(
        "A late unlock — stuck while a re-tap went ahead of it — lands recorded, not applied: the record gone, the phone in the focus it came back to (A10)"
    )
    func lateUnlockLands() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        // A stuck record holds nothing: the re-tap goes, and the phone is back in focus.
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        await rig.until { $0.standing == .inSession(session(), .focused) && $0.queued.count == 1 }
        // Retried at the cap, it lands once the server takes it.
        rig.clock.advance(by: 2 * Outbox.backoffCap)
        try await rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(), .focused))
        #expect(try !rig.outbox.holdsUnlock(session: "s"))
        await rig.stop()
    }

    @Test(
        "An unlock answered as late with no change of the phone's since — its clock turned back — still applies: the phone shields to the focus the server kept, never unshielded under a green chip"
    )
    func lateAnswerWithNoReturn() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        try await rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(), .focused))
        await rig.stop()
    }
}
