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
        "An unlock recorded with a note names no live session — none, one over, or none left late once the student has left it (A11) — so the truth is read again",
        arguments: [Answer.unlockNoted, Answer.unlockAfterEnd(), Answer.supersededGone])
    func unlockNoted(answer: String) async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        try await rig.server.next(unlockRoute).reply(200, answer)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.standing == .out && $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "The late unlock's answer these tests hand-write is the API's own, as its fixture records it (#119's review): recorded, superseded, no state, its session named"
    )
    func supersededGoneIsTheAPIs() throws {
        let fixtures = try Contract.fixtures("unlock")
        let fixture = try #require(fixtures.first { $0.name == "recorded-superseded-gone.json" })
        let decoder = JSONDecoder()
        let real = try decoder.decode([String: JSONValue].self, from: fixture.fixture.body.data)
        let written = try decoder.decode(
            [String: JSONValue].self, from: Data(Answer.supersededGone.utf8))
        #expect(Set(real.keys) == Set(written.keys))
        for key in ["outcome", "recordedAs", "state", "reason"] {
            #expect(real[key] == written[key], "\(key)")
        }
        #expect(real["session"] != .null && written["session"] != .null)
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

    @Test(
        "An alarm whose ring comes late — after another ring has woken the read loop — rings nothing: no read goes early, and the check-ins keep their cadence"
    )
    func lateAlarm() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        try await rig.sleeping([at(30)])
        // The check-in's alarm goes off as the app comes back to the foreground, and its ring runs
        // late: after the foreground's read of the truth has gone.
        rig.clock.advance(by: 30, holdingWakes: true)
        await rig.engine.setForeground(true)
        let read = try await rig.server.next(meRoute)
        rig.clock.releaseWakes()
        read.reply(200, Answer.me())
        try await rig.sleeping([at(60)])
        rig.clock.advance(by: 30)
        let next = try await rig.server.next()
        #expect(next.route == checkInRoute && next.deviceTime == iso(at(60)))
        next.reply(200, Answer.live())
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

    @Test(
        "A read naming no session leaves an armed phone waiting while it says a tap of theirs waits — or, an older API's, says nothing of one (#166)"
    )
    func waitingStays() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting }
        try await rig.foreground(Answer.me(nil))
        #expect(await rig.engine.state.standing == .waiting)
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil, armed: true))
        try await rig.sleeping([at(60)])
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
        #expect(state.standing == .inSession(session(), .focused) && state.superseded == nil)
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
        #expect(state.superseded == Superseded(session: "s", ordered: true))
        await rig.stop()
    }

    @Test(
        "The unlock guard holds for every answer, not only a tap's: an unlock answered late — recorded, a return went ahead of it, focused named — shields nothing over another unlock still stuck, made before it or after it (#95's Claude Review: on main, two stuck unlocks)",
        arguments: [false, true])
    func lateUnlockOverStuckUnlock(newerLands: Bool) async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.emergencyUnlock()
        try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        try await rig.engine.emergencyUnlock()
        let newer = try await rig.server.next(unlockRoute)
        if newerLands {
            newer.reply(200, Answer.unlockSuperseded())
        } else {
            newer.reply(400, Answer.refused("invalid_request"))
            await rig.until { $0.queued.count == 2 && $0.queued.allSatisfy(\.stuck) }
            rig.clock.advance(by: 2)
            try await rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
        }
        let state = await rig.until { $0.queued.count == 1 }
        #expect(state.standing == .inSession(session(), .unlocked))
        #expect(state.shieldedUntil(rig.clock.now()) == nil)
        await rig.stop()
    }

    @Test(
        "…but a re-tap made after both unlocks is the student's return: the late answer leaves the phone in the focus it came back to, the other unlock stuck still"
    )
    func lateUnlockAfterReturn() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        for count in 1...2 {
            try await rig.engine.emergencyUnlock()
            try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
            await rig.until { $0.queued.count == count && $0.queued.allSatisfy(\.stuck) }
        }
        try await rig.engine.tap(.block("T7XK2M9QPF"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        await rig.until { $0.standing == .inSession(session(), .focused) && $0.queued.count == 2 }
        rig.clock.advance(by: 2)
        try await rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
        let state = await rig.until { $0.queued.count == 1 }
        #expect(state.standing == .inSession(session(), .focused))
        await rig.stop()
    }

    @Test(
        "Protection off is no return: its answer naming focus shields nothing over an unlock still stuck"
    )
    func protectionOffOverStuckUnlock() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.emergencyUnlock()
        try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        try await rig.engine.record(.protectionOff(session: "s"))
        try await rig.server.next(protectionOffRoute).reply(200, Answer.replay(state: "focused"))
        let state = await rig.until { $0.queued.count == 1 }
        #expect(state.standing == .inSession(session(), .unlocked))
        await rig.stop()
    }
}

@Suite("The classes, and the wait for the Start (C3)", .timeLimit(.minutes(3)))
struct ClassesTests {
    /// A tap answered armed: the phone waits for the Start.
    private func armed(_ rig: Rig) async throws {
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
    }

    @Test(
        "The classes come with the read of the truth: not known (nil) until one answers; none is no classes — the Join screen's — and some, their teachers named, is in class"
    )
    func classes() async throws {
        let rig = try Rig()
        #expect(await rig.engine.state.hasClasses == nil)
        try await rig.foreground(Answer.me(nil))
        #expect(await rig.engine.state.hasClasses == false)
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute)
            .reply(200, Answer.me(nil, classes: [Answer.inClass("c")]))
        let state = await rig.until { $0.hasClasses == true }
        #expect(state.me?.classes.first?.teacher?.displayName == "Ms. Rivera")
        await rig.stop()
    }

    @Test(
        "A read of the truth that gives no answer — none, a status, a body this build cannot read — leaves the classes as they were, unknown too, never none, and says why until one answers (rule 5)"
    )
    func failed() async throws {
        let rig = try Rig()
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(nil)
        var state = await rig.until { $0.meFailed != nil }
        #expect(state.meFailed == .networkError && state.hasClasses == nil)
        // Each wait for the loop's sleep first: the time moved before it, the wake would slip.
        try await rig.sleeping([at(30)])
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(503)
        state = await rig.until { $0.meFailed == .status(503) }
        #expect(state.hasClasses == nil)
        try await rig.sleeping([at(60)])
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, "{}")
        await rig.until { $0.meFailed == .status(200) }
        try await rig.sleeping([at(90)])
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        state = await rig.until { $0.meFailed == nil }
        #expect(state.hasClasses == false)
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(nil)
        state = await rig.until { $0.meFailed != nil }
        #expect(state.hasClasses == false)
        await rig.stop()
    }

    @Test(
        "Waiting for the Start (decision 6, the owner's ruling): in the foreground the phone reads the truth at each wake, every 30 s, and the Start found puts it in the session, shielded; behind the app it reads nothing"
    )
    func waitingReads() async throws {
        let rig = try Rig()
        try await armed(rig)
        try await rig.foreground(Answer.me(nil))
        #expect(await rig.engine.state.standing == .waiting)
        rig.clock.advance(by: 30)
        let first = try await rig.server.next()
        #expect(first.route == meRoute)
        first.reply(200, Answer.me(nil))
        try await rig.sleeping([at(60)])
        #expect(await rig.engine.state.standing == .waiting)
        await rig.engine.setForeground(false)
        rig.clock.advance(by: 30)
        try await rig.sleeping([])
        rig.clock.advance(by: 600)
        #expect(await rig.server.waiting.isEmpty)
        try await rig.foreground(Answer.me(nil))
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, Answer.me(session(endsAt: 4000)))
        let state = await rig.until { $0.standing != .waiting }
        #expect(state.standing == .inSession(session(endsAt: 4000), .focused))
        #expect(state.shieldedUntil(rig.clock.now()) == at(4000))
        await rig.stop()
    }

    @Test(
        "Out of a session, in a class (C3c; the conductor's decision under the owner's delegation, 2026-09-30): in the foreground the phone reads the truth at each wake, every 30 s, as when waiting, so Home says a class of theirs in session; behind the app, or in no class, it reads nothing"
    )
    func outReads() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil, classes: [Answer.inClass("c")]))
        #expect(await rig.engine.state.standing == .out)
        rig.clock.advance(by: 30)
        let live = #"{"id":"c","name":"Class c","teacher":{"displayName":null},"liveSession":{"id":"s","endsAt":"\#(iso(at(4000)))"}}"#
        try await rig.server.next(meRoute).reply(200, Answer.me(nil, classes: [live]))
        let state = await rig.until { $0.me?.classes.first?.liveSession != nil }
        #expect(state.inSessionCard(at: rig.clock.now())?.unlocked == false)
        await rig.engine.setForeground(false)
        rig.clock.advance(by: 30)
        try await rig.sleeping([])
        rig.clock.advance(by: 600)
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
        let none = try Rig()
        try await none.foreground(Answer.me(nil))
        none.clock.advance(by: 30)
        try await none.sleeping([at(60)])
        #expect(await none.server.waiting.isEmpty)
        await none.stop()
    }

    @Test(
        "An arm answered while the phone stands in a session its own clock says is over — the sweep running late, so the server armed the tap — is the wait for the Start, read for as any (santa's round 1): arming ends no session still running (decision 4), and past its bell the phone is in none"
    )
    func armedPastTheBell() async throws {
        let rig = try Rig()
        try await rig.tapIn(session(endsAt: 60))
        rig.clock.advance(by: 90)
        try await rig.engine.record(.tap(tagId: "the next class's"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
        try await rig.foreground(Answer.me(nil))
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, Answer.me(session("t", endsAt: 4000)))
        await rig.until { $0.standing == .inSession(session("t", endsAt: 4000), .focused) }
        await rig.stop()
    }

    @Test(
        "A read's classes apply though its standing may not — a change of the phone's awaits its answer, so the read may be older than it — for no change of the phone's moves the classes; only a join does"
    )
    func classesOverStaleStanding() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        let unlock = try await rig.server.next(unlockRoute)
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute)
            .reply(200, Answer.me(session(endsAt: 4000), classes: [Answer.inClass("c")]))
        let state = await rig.until { $0.me != nil }
        #expect(state.hasClasses == true)
        #expect(state.standing == .inSession(session(), .unlocked))
        unlock.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "Out, not waiting, a read naming a session its clock says is over still takes it — the router's bell rule shows home, and the check-in finds it gone; only a waiting phone's wait is kept from it"
    )
    func outTakesPastSession() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(session(endsAt: -60)))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: -60), .focused))
        await rig.stop()
    }

    @Test(
        "Waiting, a session the phone's own clock says is over — the server's sweep running late — is not the Start: the wait goes on, and a live session then ends it (data model, decision 6)"
    )
    func overIsNoStart() async throws {
        let rig = try Rig()
        try await armed(rig)
        try await rig.foreground(Answer.me(session(endsAt: -60)))
        #expect(await rig.engine.state.standing == .waiting)
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, Answer.me(session("t")))
        await rig.until { $0.standing == .inSession(session("t"), .focused) }
        await rig.stop()
    }
}
