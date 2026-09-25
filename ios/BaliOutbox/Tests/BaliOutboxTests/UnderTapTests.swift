import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// The route of an unlock filed under the tap `tap`.
func underTapRoute(_ tap: OutboxRecord) -> String { "POST /v1/taps/\(tap.eventId)/unlock" }

/// The route of an unlock of session `s`.
let sessionUnlockRoute = "POST /v1/sessions/s/unlock"

extension Answer {
    /// An unlock kept with no session: its tap armed, or unknown to the server (A11).
    static func unlockKept(_ note: String) -> String {
        #"{"outcome":"recorded","recordedAs":"\#(note)","state":null,"session":null,"reason":null}"#
    }
    /// A tap of a tag no teacher registered: refused.
    static let unknownBlock = #"{"error":{"code":"not_found","message":"unknown block"}}"#
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
        "Under a tap not yet answered — the latest — whatever the phone stood in; else of the session it is in, whatever its state; else, where it stood unread, not filed until that is known (B6b); else nowhere: nothing it knows holds shields"
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
        for standing in [Standing.out, .waiting] {
            #expect(try state(standing).emergencyUnlock(reason: nil) == nil, "\(standing)")
        }
        #expect(
            try state(.unread).emergencyUnlock(reason: .other) == .unlockUnfiled(reason: .other))
        // A stuck tap is no tap not yet answered: its refusal ended its shield.
        let stuck = try state(focused, [.tap(tagId: "A")], stuck: [0])
        #expect(stuck.emergencyUnlock(reason: nil) == .unlock(session: "s", reason: nil))
        #expect(try state(.out, [.tap(tagId: "A")], stuck: [0]).emergencyUnlock(reason: nil) == nil)
        #expect(
            try state(.unread, [.tap(tagId: "A")], stuck: [0]).emergencyUnlock(reason: nil)
                == .unlockUnfiled(reason: nil))
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
        guard case .unlockUnderTap(tap.eventId, _)? = filed.request else {
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
            // Made where the phone stood in a session — the standing it leaves names it — that one
            // is guarded still: by the unlock, or, the tap armed, by its follow-up there (B6d).
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
        "Before its tap is answered the unlock's session is not known — it may be any — so, all stuck, it keeps every read from shielding again: a read saying focused leaves the phone unlocked (#94's Claude Review); the tap refused joins no class, so the unlock goes again to the one the phone stood in (B6d)"
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
        try await rig.server.next(sessionUnlockRoute).reply(400, Answer.refused("invalid_request"))
        try await rig.server.next(meRoute).reply(200, Answer.me())
        await rig.until { $0.queued.count == 3 && $0.queued.allSatisfy(\.stuck) }
        #expect(try rig.outbox.awaiting() == 0)
        #expect(try rig.outbox.holdsUnlock(session: "s") && rig.outbox.holdsUnlock(session: "t"))
        try await rig.foreground(Answer.me(session(endsAt: 4000)))
        #expect(await rig.engine.state.standing == .inSession(session(endsAt: 4000), .unlocked))
        await rig.stop()
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

@Suite(
    "A scan that joins no class: its unlock filed again where the student stood (owner's ruling, B6d)",
    .timeLimit(.minutes(3)))
struct RefiledTests {
    @Test(
        "Armed (another teacher's block, before their Start) or refused (a block not registered), a scan joins no class: the Emergency Unlock made before its answer — filed under it as decision 11 has it, kept there or stuck unrecorded — is filed again in the class the student stood in, with its own id and the press's reason, time and order; that class's grid shows it, and the shields are never back on",
        arguments: [(200, Answer.armed), (404, Answer.unknownBlock)], [true, false])
    func refiled(scan answer: (status: Int, body: String), kept: Bool) async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 4000)
        try await rig.tapIn(view)
        await phone.until { $0.shielded }
        let scan = try #require(try await rig.engine.tap(.block("W3RD8K2QAN")))
        let held = try await rig.server.next(tapRoute)
        let press = try #require(try await rig.engine.emergencyUnlock(reason: .nurse))
        await phone.until { !$0.shielded }
        held.reply(answer.status, answer.body)
        try await rig.server.next(underTapRoute(scan)).reply(
            kept ? 200 : 400,
            kept ? Answer.unlockKept("tap_armed") : Answer.refused("invalid_request"))
        let again = try await rig.server.next(sessionUnlockRoute)
        let body = try BaliJSON.makeDecoder().decode(
            UnlockRequest.self, from: try #require(again.request.httpBody))
        #expect(body.eventId != press.eventId && body.reason == .nurse)
        #expect(body.deviceTime == press.recordedAt && body.order == press.order)
        #expect(await rig.engine.state.standing == .inSession(view, .unlocked))
        again.reply(200, Answer.unlocked(view))
        let state = await rig.until { !$0.queued.contains { $0.eventId == body.eventId } }
        #expect(state.standing == .inSession(view, .unlocked))
        let unlocks = state.queued.filter(\.change.isUnlock).map(\.eventId)
        #expect(unlocks == (kept ? [] : [press.eventId]))
        #expect(await phone.screenTime.unshields == 1)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "A scan that lands in a class has its unlock filed there, as decision 11 has it: no second"
    )
    func joined() async throws {
        let rig = try Rig()
        try await rig.tapIn(session(endsAt: 4000))
        let scan = try #require(try await rig.engine.tap(.block("W3RD8K2QAN")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        let other = session("t", endsAt: 4000)
        held.reply(200, Answer.joined(other))
        try await rig.server.next(underTapRoute(scan)).reply(200, Answer.unlocked(other))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(other, .unlocked))
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test(
        "Stuck unrecorded, the follow-up guards the class it names: a read there — the server's truth without it, focused — leaves the phone unlocked"
    )
    func guards() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 4000)
        try await rig.tapIn(view)
        let scan = try #require(try await rig.engine.tap(.block("W3RD8K2QAN")))
        let held = try await rig.server.next(tapRoute)
        try await rig.engine.emergencyUnlock()
        held.reply(200, Answer.armed)
        try await rig.server.next(underTapRoute(scan)).reply(200, Answer.unlockKept("tap_armed"))
        try await rig.server.next(sessionUnlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.count == 1 && $0.queued[0].stuck }
        #expect(try rig.outbox.awaiting() == 0 && rig.outbox.holdsUnlock(session: "s"))
        // The read the press's kept answer asked for, sent while the follow-up awaited: stale.
        try await rig.server.next(meRoute).reply(200, Answer.me(view))
        try await rig.foreground(Answer.me(view))
        rig.clock.advance(by: 30)
        try await rig.server.next(checkInRoute).reply(200, Answer.live(view))
        try await rig.sleeping([at(60)])
        #expect(await rig.engine.state.standing == .inSession(view, .unlocked))
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "A re-tap made after the press is after it by the phone's order, and so after its follow-up: that goes with the press's order and stands before the re-tap in the queue — the re-tap's shields held meanwhile, its focus standing once answered, the follow-up stuck (A12, A13)"
    )
    func afterThePress() async throws {
        let rig = try Rig()
        let phone = Enforced(rig)
        let view = session(endsAt: 4000)
        try await rig.tapIn(view)
        let scan = try #require(try await rig.engine.tap(.block("W3RD8K2QAN")))
        let held = try await rig.server.next(tapRoute)
        let press = try #require(try await rig.engine.emergencyUnlock())
        let retap = try #require(try await rig.engine.tap(.block("T7XK2M9QPF")))
        await phone.until { $0.shielded }
        held.reply(200, Answer.armed)
        try await rig.server.next(underTapRoute(scan)).reply(200, Answer.unlockKept("tap_armed"))
        let again = try await rig.server.next(sessionUnlockRoute)
        let body = try BaliJSON.makeDecoder().decode(
            UnlockRequest.self, from: try #require(again.request.httpBody))
        #expect(body.order == press.order)
        #expect(try #require(press.order).seq < #require(retap.order).seq)
        #expect(await phone.screenTime.shielding)
        again.reply(400, Answer.refused("invalid_request"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined(view))
        await phone.until { $0.shielded && $0.until == view.endsAt }
        #expect(await rig.engine.state.standing == .inSession(view, .focused))
        await phone.stop()
    }

    @Test(
        "Minted once: the scan refused again on its retry, the press's own answer after it, a relaunch — one follow-up, in the press's place, before a refocus made after the press"
    )
    func once() async throws {
        let (outbox, url) = try makeOutbox()
        let scan = try record(outbox, .tap(tagId: "W3RD8K2QAN"))
        let press = try #require(
            try outbox.record(
                .unlockUnderTap(tap: scan.eventId, reason: .nurse), now: t0,
                standing: .inSession(session(), .unlocked)))
        let refocus = try record(outbox, .refocus(session: "s"))
        try await send(outbox, scan, 404, Answer.unknownBlock)
        func followUps(_ outbox: Outbox) throws -> [OutboxRecord] {
            try outbox.records().filter { $0.change == .unlock(session: "s", reason: .nurse) }
        }
        let followUp = try #require(try followUps(outbox).first)
        #expect(followUp.eventId != press.eventId && followUp.recordedAt == press.recordedAt)
        #expect(followUp.order == press.order)
        // A refocus there returns from the follow-up now, the unlock of its session (santa).
        #expect(try current(outbox, refocus.eventId)?.follows == followUp.eventId)
        #expect(
            try outbox.records().map(\.eventId)
                == [scan.eventId, press.eventId, followUp.eventId, refocus.eventId])
        let retried = try #require(try current(outbox, scan.eventId))
        try await send(outbox, retried, 404, Answer.unknownBlock)
        try await send(outbox, press, 200, Answer.unlockKept("unknown_tap"))
        #expect(try followUps(open(url)).map(\.eventId) == [followUp.eventId])
        #expect(try record(outbox, .refocus(session: "s")).follows == followUp.eventId)
    }

    @Test(
        "A refused scan whose retry lands in a class after all has the press filed there by the server too: two records of one press — the follow-up where the phone stood, the press where the scan landed — both kept, nothing discarded (santa's review, disclosed)"
    )
    func refusedThenLanded() async throws {
        let (outbox, _) = try makeOutbox()
        let scan = try record(outbox, .tap(tagId: "W3RD8K2QAN"))
        let press = try #require(
            try outbox.record(
                .unlockUnderTap(tap: scan.eventId, reason: nil), now: t0,
                standing: .inSession(session(), .unlocked)))
        try await send(outbox, scan, 409, Answer.refused("session_not_running"))
        let retried = try #require(try current(outbox, scan.eventId))
        try await send(outbox, retried, 200, Answer.joined(session("t")))
        let both: [Change] = [
            .unlockUnderTap(tap: scan.eventId, reason: nil), .unlock(session: "s", reason: nil),
        ]
        #expect(try outbox.records().map(\.change) == both)
        #expect(try current(outbox, press.eventId) != nil)
        #expect(try outbox.holdsUnlock(session: "s") && outbox.holdsUnlock(session: "t"))
    }

    @Test(
        "A press kept with no class while its scan is stuck unanswered — the scan's fate unknown — is filed again where the phone stood; one whose scan was answered with a class is not"
    )
    func keptBeforeItsScan() async throws {
        let stood = Standing.inSession(session(), .unlocked)
        let (outbox, _) = try makeOutbox()
        let scan = try record(outbox, .tap(tagId: "W3RD8K2QAN"))
        let press = try #require(
            try outbox.record(
                .unlockUnderTap(tap: scan.eventId, reason: nil), now: t0, standing: stood))
        for _ in 0..<Outbox.bound {
            try await send(outbox, try #require(try current(outbox, scan.eventId)), 503)
        }
        try await send(outbox, press, 200, Answer.unlockKept("unknown_tap"))
        #expect(
            try outbox.records().map(\.change)
                == [.tap(tagId: "W3RD8K2QAN"), .unlock(session: "s", reason: nil)])

        let (landed, _) = try makeOutbox()
        let joined = try record(landed, .tap(tagId: "W3RD8K2QAN"))
        let under = try #require(
            try landed.record(
                .unlockUnderTap(tap: joined.eventId, reason: nil), now: t0, standing: stood))
        try await send(landed, joined, 200, Answer.joined(session("t")))
        let filed = try #require(try current(landed, under.eventId))
        try await send(landed, filed, 200, Answer.unlockKept("unknown_tap"))
        #expect(try landed.records().isEmpty)
    }
}
