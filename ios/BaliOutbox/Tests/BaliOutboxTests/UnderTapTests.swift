import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// The route of an unlock filed under the tap `tap`.
func underTapRoute(_ tap: OutboxRecord) -> String { "POST /v1/taps/\(tap.eventId)/unlock" }

extension Answer {
    /// An unlock kept with no session: its tap armed, or unknown to the server (A11).
    static func unlockKept(_ note: String) -> String {
        #"{"outcome":"recorded","recordedAs":"\#(note)","state":null,"session":null,"reason":null}"#
    }
}

@Suite("Where an Emergency Unlock is filed (decision 11)")
struct UnlockRouteTests {
    /// The engine's truth: `standing`, and `changes` queued, the ones at `stuck` stuck.
    func state(_ standing: Standing, _ changes: [Change] = [], stuck: Set<Int> = []) throws
        -> SyncState
    {
        let (outbox, _) = try makeOutbox()
        for (index, change) in changes.enumerated() {
            let queued = try record(outbox, change)
            if stuck.contains(index) {
                try outbox.pool.write {
                    try $0.execute(
                        sql: "UPDATE outbox SET stuck = 1 WHERE eventId = ?",
                        arguments: [queued.eventId])
                }
            }
        }
        var state = SyncState()
        (state.standing, state.queued) = (standing, try outbox.records())
        return state
    }

    @Test(
        "Under a tap not yet answered — the latest — whatever the phone stood in; else of the session it is in, whatever its state; else nowhere: nothing it knows holds shields"
    )
    func route() throws {
        let focused = Standing.inSession(session(), .focused)
        for standing in [Standing.out, .waiting, .unread, focused] {
            let tapped = try state(standing, [.tap(tagId: "A"), .tap(tagId: "B")])
            let latest = tapped.queued[1].eventId
            #expect(
                tapped.emergencyUnlock(reason: .nurse)
                    == .unlockUnderTap(tap: latest, reason: .nurse), "\(standing)")
        }
        for state in [ParticipationState.focused, .unlocked, .protectionOff, nil] {
            #expect(
                try self.state(.inSession(session(), state)).emergencyUnlock(reason: nil)
                    == .unlock(session: "s", reason: nil), "\(String(describing: state))")
        }
        for standing in [Standing.out, .waiting, .unread] {
            #expect(try state(standing).emergencyUnlock(reason: nil) == nil, "\(standing)")
        }
        // A stuck tap is no tap not yet answered: its refusal ended its shield.
        let stuck = try state(focused, [.tap(tagId: "A")], stuck: [0])
        #expect(stuck.emergencyUnlock(reason: nil) == .unlock(session: "s", reason: nil))
        #expect(try state(.out, [.tap(tagId: "A")], stuck: [0]).emergencyUnlock(reason: nil) == nil)
        // A tap stuck behind one still pending: the pending one's.
        let behind = try state(.out, [.tap(tagId: "A"), .tap(tagId: "B")], stuck: [1])
        #expect(
            behind.emergencyUnlock(reason: nil)
                == .unlockUnderTap(tap: behind.queued[0].eventId, reason: nil))
    }

    @Test(
        "A refocus returns from the latest unlock while it is queued — one under a tap not yet answered, its session still unnamed, included — and waits for it, stuck or not (santa's review)"
    )
    func refocusFollows() throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "A"))
        let unlock = try record(outbox, .unlockUnderTap(tap: tap.eventId, reason: nil))
        #expect(try record(outbox, .refocus(session: "s")).follows == unlock.eventId)
    }

    @Test(
        "A tap not yet answered keeps its shield only until an unlock after it, of either kind (decision 11)"
    )
    func endsTheTapsShield() throws {
        let tapped = try state(.out, [.tap(tagId: "A")])
        #expect(tapped.tapHeldUntil == at(SyncState.tapCap))
        let unlocked = try state(.out, [.tap(tagId: "A"), .unlockUnderTap(tap: "t", reason: nil)])
        #expect(unlocked.tapHeldUntil == nil && unlocked.shieldedUntil(t0) == nil)
    }

    @Test(
        "Until its tap is answered an unlock under it guards every session — it may be any; the tap's answer naming one hands it that one, and it still goes under the tap; an answer naming none leaves it the session the phone stood in when it was made — none, where it stood in none (#94's review)"
    )
    func settleNamesTheSession() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "A"))
        let other = try record(outbox, .tap(tagId: "B"))
        let unlock = try record(outbox, .unlockUnderTap(tap: tap.eventId, reason: .nurse))
        #expect(try outbox.holdsUnlock(session: "s") && outbox.holdsUnlock(session: "t"))
        // Another tap's answer, or a send that brings none, narrows nothing.
        try await send(outbox, other, 200, Answer.joined(session("t")))
        try await send(outbox, tap, 503)
        #expect(try outbox.holdsUnlock(session: "s") && outbox.holdsUnlock(session: "t"))
        // Over a record made after it (A12's order), it guards nothing.
        #expect(try !outbox.holdsUnlock(session: "s", after: try #require(unlock.order).seq))
        try await send(outbox, tap, 200, Answer.joined(session("s")))
        #expect(try outbox.holdsUnlock(session: "s") && !outbox.holdsUnlock(session: "t"))
        let filed = try #require(try current(outbox, unlock.eventId))
        #expect(filed.change == .unlockUnderTap(tap: tap.eventId, reason: .nurse))
        guard case .unlockUnderTap(tap.eventId, _) = filed.request else {
            Issue.record("sent under its tap no more: \(filed.request)")
            return
        }
        // A refocus there returns from it: it waits for it, as for any unlock of its session.
        #expect(try record(outbox, .refocus(session: "s")).follows == unlock.eventId)
        // Recorded, it guards nothing.
        try await send(outbox, filed, 200, Answer.unlocked())
        #expect(try !outbox.holdsUnlock(session: "s"))

        for answer in [Answer.armed, Answer.replayNoSession] {
            let (outbox, _) = try makeOutbox()
            let tap = try record(outbox, .tap(tagId: "A"))
            try record(outbox, .unlockUnderTap(tap: tap.eventId, reason: nil))
            try await send(outbox, tap, 200, answer)
            #expect(try !outbox.holdsUnlock(session: "s"), "\(answer)")
            // Made where the phone stood in a session — the standing it leaves names it.
            let retap = try record(outbox, .tap(tagId: "B"))
            let unlocked = Standing.inSession(session(), .unlocked)
            _ = try outbox.record(
                .unlockUnderTap(tap: retap.eventId, reason: nil), now: t0, standing: unlocked)
            try await send(outbox, retap, 200, answer)
            #expect(try outbox.holdsUnlock(session: "s"), "\(answer)")
            #expect(try !outbox.holdsUnlock(session: "t"), "\(answer)")
        }
    }
}

@Suite("An unlock filed under its tap, through the engine (decision 11)", .timeLimit(.minutes(3)))
struct UnderTapEngineTests {
    @Test(
        "Tapped with no signal, then Emergency Unlock before the answer: the shields off at once; online, the tap joins, and the unlock goes under it, after it by the phone's order — and the phone stands unlocked, never shielded between the two answers"
    )
    func offlineTapThenUnlock() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 1200)
        let tap = try #require(try await rig.engine.tap(.block("T7XK2M9QPF")))
        #expect(tap.change == .tap(tagId: "T7XK2M9QPF"))
        await phone.until { $0.shielded && $0.until == at(SyncState.tapCap) }
        let offline = try await rig.server.next(tapRoute)
        let unlock = try #require(try await rig.engine.emergencyUnlock(reason: .bathroom))
        #expect(unlock.change == .unlockUnderTap(tap: tap.eventId, reason: .bathroom))
        await phone.until { !$0.shielded && $0.until == nil }
        offline.reply(nil)
        try await rig.sleeping([at(2)])
        rig.clock.advance(by: 2)
        try await rig.server.next(tapRoute).reply(200, Answer.joined(view))
        // The tap's answer stands under the unlock after it: nothing shields meanwhile.
        let sent = try await rig.server.next(underTapRoute(tap))
        #expect(sent.eventId == unlock.eventId)
        #expect(await rig.engine.state.standing == .out)
        #expect(await !phone.screenTime.shielding)
        let body = try BaliJSON.makeDecoder().decode(
            UnlockRequest.self, from: try #require(sent.request.httpBody))
        let order = try #require(tap.order)
        #expect(body.reason == .bathroom)
        #expect(body.order == ActionOrder(install: order.install, seq: order.seq + 1))
        sent.reply(200, Answer.unlocked(view))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(view, .unlocked))
        #expect(await !phone.enforcer.protection.shielded)
        await phone.stop()
    }

    @Test(
        "Focused, a re-tap unanswered: Emergency Unlock is filed under the re-tap, the phone unlocked where it stood at once — and sent there always, its retry too, though the tap's answer named the session"
    )
    func underReTap() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        try await rig.tapIn(session(endsAt: 1200))
        await phone.until { $0.shielded }
        let retap = try #require(try await rig.engine.tap(.block("W3RD8K2QAN")))
        let held = try await rig.server.next(tapRoute)
        let unlock = try #require(try await rig.engine.emergencyUnlock())
        #expect(unlock.change == .unlockUnderTap(tap: retap.eventId, reason: nil))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 1200), .unlocked))
        await phone.until { !$0.shielded }
        held.reply(200, Answer.joined(session(endsAt: 1200)))
        try await rig.server.next(underTapRoute(retap)).reply(nil)
        try await rig.sleeping([at(2)])
        rig.clock.advance(by: 2)
        let again = try await rig.server.next()
        #expect(again.route == underTapRoute(retap) && again.eventId == unlock.eventId)
        again.reply(200, Answer.unlocked(session(endsAt: 1200)))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(endsAt: 1200), .unlocked))
        await phone.stop()
    }

    @Test(
        "Stuck, the unlock holds no read — but it guards the session its tap's answer named: no read shields it again (the unlock guard, B3b-2)"
    )
    func guardsItsTapsSession() async throws {
        let rig = try Rig()
        let tap = try #require(try await rig.engine.record(.tap(tagId: "T7XK2M9QPF")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        held.reply(200, Answer.joined())
        try await rig.server.next(underTapRoute(tap)).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        #expect(try rig.outbox.awaiting() == 0 && rig.outbox.holdsUnlock(session: "s"))
        try await rig.foreground(Answer.me(session(endsAt: 4000)))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .unlocked))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(session(endsAt: 4000)))
        try await rig.sleeping([at(60)])
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .unlocked))
        await rig.stop()
    }

    @Test(
        "Before its tap is answered the unlock's session is not known — it may be any — so, both stuck, it keeps every read from shielding again: a read saying focused leaves the phone unlocked (#94's Claude Review)"
    )
    func guardsBeforeItsTapIsAnswered() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        let retap = try #require(try await rig.engine.tap(.block("T7XK2M9QPF")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        held.reply(409, Answer.refused("session_not_running"))
        try await rig.server.next(underTapRoute(retap)).reply(
            400, Answer.refused("invalid_request"))
        try await rig.server.next(meRoute).reply(200, Answer.me())
        await rig.until { $0.queued.count == 2 && $0.queued.allSatisfy(\.stuck) }
        #expect(try rig.outbox.awaiting() == 0)
        #expect(try rig.outbox.holdsUnlock(session: "s") && rig.outbox.holdsUnlock(session: "t"))
        try await rig.foreground(Answer.me(session(endsAt: 4000)))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .unlocked))
        await rig.stop()
    }

    @Test(
        "Focused, a scan of another teacher's block — answered armed, so it names no session — and Emergency Unlock before that answer, stuck unrecorded: no read shields the session the student stood in, until they re-tap there after it (#94's review)"
    )
    func armedTapsUnlockGuardsWhereItStood() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 4000)
        try await rig.tapIn(view)
        await phone.until { $0.shielded }
        let retap = try #require(try await rig.engine.tap(.block("W3RD8K2QAN")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        await phone.until { !$0.shielded }
        held.reply(200, Answer.armed)
        try await rig.server.next(underTapRoute(retap)).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.count == 1 && $0.queued.first?.stuck == true }
        #expect(try rig.outbox.awaiting() == 0)
        // The server never recorded the unlock: every read has the student focused there.
        try await rig.foreground(Answer.me(view))
        #expect(await rig.engine.state.standing == .inSession(view, .unlocked))
        rig.clock.advance(by: 30)
        // The unlock, due again, is refused again; the check-in answers focused there too.
        try await rig.server.next(underTapRoute(retap)).reply(
            400, Answer.refused("invalid_request"))
        try await rig.server.next(checkInRoute).reply(200, Answer.live(view))
        try await rig.sleeping([at(34), at(60)])
        #expect(await rig.engine.state.standing == .inSession(view, .unlocked))
        #expect(await !phone.screenTime.shielding)
        // A re-tap there, after the unlock by the phone's order, is a return: back to focus.
        try await rig.engine.tap(.block("T7XK2M9QPF"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined(view))
        await phone.until { $0.shielded && $0.until == view.endsAt }
        await phone.stop()
    }

    @Test(
        "A tap's answer is older than an unlock made after it: both stuck, the tap's retry answered focused shields nothing — the unlock, still unrecorded, keeps its session's shields off (the unlock guard); a re-tap made after the unlock is a return, and does (santa's review)"
    )
    func tapAnswerUnderStuckUnlock() async throws {
        let rig = try Rig()
        let tap = try #require(try await rig.engine.tap(.block("T7XK2M9QPF")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        held.reply(409, Answer.refused("session_not_running"))
        try await rig.server.next(underTapRoute(tap)).reply(400, Answer.refused("invalid_request"))
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.queued.count == 2 && $0.queued.allSatisfy(\.stuck) }
        try await rig.sleeping([at(2)])
        rig.clock.advance(by: 2)
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        let state = await rig.until { $0.queued.count == 1 }
        #expect(state.standing == .inSession(session(), .unlocked))
        #expect(state.shieldedUntil(rig.clock.now()) == nil)
        // The unlock, due again, is refused again; the student taps again, after it: back to focus.
        try await rig.server.next(underTapRoute(tap)).reply(400, Answer.refused("invalid_request"))
        try await rig.engine.tap(.block("T7XK2M9QPF"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        await rig.until { $0.standing == .inSession(session(), .focused) }
        await rig.stop()
    }

    @Test(
        "A tap that lands after its unlock — refused at first, the unlock kept with no session — files it then: answered joined and unlocked, and nothing shields (A11)"
    )
    func tapAfterItsUnlock() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let tap = try #require(try await rig.engine.tap(.block("T7XK2M9QPF")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        await phone.until { !$0.shielded }
        held.reply(409, Answer.refused("session_not_running"))
        try await rig.server.next(underTapRoute(tap)).reply(200, Answer.unlockKept("unknown_tap"))
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.queued.count == 1 && $0.queued.first?.stuck == true }
        try await rig.sleeping([at(2)])
        rig.clock.advance(by: 2)
        try await rig.server.next(tapRoute).reply(200, Answer.joined(state: "unlocked"))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(session(), .unlocked))
        #expect(await !phone.enforcer.protection.shielded)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "A scan records a tap only for a Bali block: another tag, a scan cancelled, a phone with no NFC, a reader's error — nothing recorded, nothing sent, nothing shielded; nor is an unlock, with nothing to unlock",
        arguments: [BlockRead.notBali, .cancelled, .unsupported, .failed("Session timeout")])
    func scanRecordsOnlyABlock(read: BlockRead) async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        await phone.until { $0.permission == .approved }
        #expect(try await rig.engine.tap(read) == nil)
        #expect(try await rig.engine.emergencyUnlock() == nil)
        let state = await rig.engine.state
        #expect(state.queued.isEmpty && state.standing == .out)
        #expect(try rig.outbox.records().isEmpty)
        #expect(await rig.server.waiting.isEmpty)
        #expect(await !phone.screenTime.shielding)
        // A block's code is the tap's tag.
        try await rig.engine.tap(.block("T7XK2M9QPF"))
        let sent = try await rig.server.next(tapRoute)
        let body = try BaliJSON.makeDecoder().decode(
            TapRequest.self, from: try #require(sent.request.httpBody))
        #expect(body.tagId == "T7XK2M9QPF")
        await phone.stop()
    }
}
