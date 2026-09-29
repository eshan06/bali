import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// The Unlocked screen's words for `state`, on a US phone in New York.
private func words(
    _ state: SyncState, given: UnlockReason? = nil, asked: Bool = false
) -> UnlockedWords? {
    UnlockedWords(state, given: given, asked: asked, time: newYork)
}

/// Unlocked in Period 3, whose bell is at 10:42 AM, with `queued`.
private func unlocked(_ queued: [OutboxRecord] = []) throws -> SyncState {
    try synced(.inSession(bell1042, .unlocked), queued: queued)
}

/// An Emergency Unlock pressed at `t0` in session "s" — with `reason`, if any — waiting for one.
private func pressed(reason: UnlockReason? = nil) throws -> (outbox: Outbox, queued: [OutboxRecord]) {
    let (outbox, _) = try makeOutbox()
    try #require(
        try outbox.record(
            .unlock(session: "s", reason: reason), now: t0, holding: SyncEngine.reasonHold))
    return (outbox, try outbox.records())
}

/// The reason an unlock's request carries, if any.
private func reason(_ exchange: Server.Exchange) throws -> String? {
    struct Body: Decodable { let reason: String? }
    return try JSONDecoder().decode(Body.self, from: try #require(exchange.request.httpBody)).reason
}

@Suite("What the Unlocked screen says (C5a)")
struct UnlockedTests {
    @Test(
        "D1's Unlocked: the class and its teacher, everything open until the bell, the teacher seeing it once the unlock has gone, and not before; the three reasons while one can still go with it; Back to focus"
    )
    func unlockedWords() throws {
        let held = try #require(words(try unlocked(try pressed().queued)))
        #expect(held.title == "Period 3 — Algebra II")
        #expect(plain(held.subtitle) == "with Ms. Rivera · ends 10:42 AM")
        #expect(
            plain(held.body)
                == "Everything's open until you go back to focus or the bell at 10:42 AM. Your teacher will see you unlocked."
        )
        #expect(held.picker == .open && held.retap == nil && held.stuck == nil)
        let gone = try #require(words(try unlocked()))
        #expect(
            plain(gone.body)
                == "Everything's open until you go back to focus or the bell at 10:42 AM. Your teacher can see you unlocked."
        )
        #expect(gone.picker == nil)
        let unread = try synced(.inSession(bell1042, .unlocked), me: false)
        #expect(words(unread)?.title == "Your class")
        let others: [Standing] = [
            .inSession(bell1042, .focused), .inSession(bell1042, .protectionOff),
            .inSession(bell1042, nil), .out, .waiting, .unread,
        ]
        for standing in others {
            #expect(words(try synced(standing)) == nil, "\(standing)")
        }
    }

    @Test(
        "The reason card: the one the unlock carries once given; too late once it has been sent without one; once it has gone, what this screen gave or saw — offered and none given, too late; never offered, no card"
    )
    func picker() async throws {
        #expect(words(try unlocked(try pressed(reason: .nurse).queued))?.picker == .given(.nurse))
        let (outbox, queued) = try pressed()
        try await send(outbox, try #require(queued.first), nil)
        #expect(try outbox.records().first?.attempts == 1)
        #expect(words(try unlocked(try outbox.records()))?.picker == .late)
        #expect(words(try unlocked(), given: .bathroom)?.picker == .given(.bathroom))
        #expect(words(try unlocked(), asked: true)?.picker == .late)
        #expect(words(try unlocked())?.picker == nil)
    }

    @Test(
        "Protection off reported in this session since the phone's last tap: the way back is a re-tap — a refocus out of it is refused (A2; #96's review) — never Back to focus; reported in another session, Back to focus"
    )
    func retap() throws {
        var state = try unlocked()
        state.reportedOff = bell1042.id
        #expect(
            words(state)?.retap
                == "Screen Time was off during this class, so tap your teacher's block to go back to focus."
        )
        state.reportedOff = "another"
        #expect(words(state)?.retap == nil)
    }

    @Test(
        "An unlock the server refused, or left unsettled to the bound, is said — still kept and retried (rule 5) — and too late for a reason"
    )
    func stuck() async throws {
        let (outbox, queued) = try pressed()
        try await send(outbox, try #require(queued.first), 400, Answer.refused("invalid_request"))
        let said = try #require(words(try unlocked(try outbox.records())))
        #expect(said.stuck == "Bali couldn't send your unlock to your teacher yet. It keeps trying.")
        #expect(said.picker == .late)
    }
}

@Suite("The reason sent with the unlock, and the way back (C5a)", .timeLimit(.minutes(3)))
struct ReasonTests {
    @Test(
        "Pressed in a session, the unlock stands at once — the shields off, the record queued — and its send waits `reasonHold` for the reason; given meanwhile, it goes at once, with it; given once it has gone, too late"
    )
    func given() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        #expect(await rig.engine.pressUnlock() == nil)
        let state = await rig.engine.state
        #expect(state.standing == .inSession(session(), .unlocked) && state.queued.count == 1)
        try await rig.sleeping([at(SyncEngine.reasonHold)])
        #expect(await rig.server.waiting.isEmpty)
        #expect(await rig.engine.explain(.bathroom) == nil)
        #expect(await rig.engine.state.queued.first?.change.reason == .bathroom)
        let sent = try await rig.server.next(unlockRoute)
        #expect(try reason(sent) == "bathroom")
        sent.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        #expect(await rig.engine.explain(.nurse) == UnlockedWords.late)
        await rig.stop()
    }

    @Test(
        "None given, it goes as the hold ends, without one: a reason given while it is on its way, or after, is too late"
    )
    func notGiven() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        #expect(await rig.engine.pressUnlock() == nil)
        try await rig.sleeping([at(SyncEngine.reasonHold)])
        rig.clock.advance(by: SyncEngine.reasonHold)
        let sent = try await rig.server.next(unlockRoute)
        #expect(try reason(sent) == nil)
        #expect(await rig.engine.explain(.nurse) == UnlockedWords.late)
        sent.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "The student moving on sends it at once: the app going behind — where iOS may suspend it before the hold ends — or Back to focus, whose refocus follows it",
        arguments: [false, true])
    func movesOn(back: Bool) async throws {
        let rig = try Rig()
        try await rig.tapIn()
        #expect(await rig.engine.pressUnlock() == nil)
        if back {
            #expect(await rig.engine.backToFocus() == nil)
            #expect(await rig.engine.state.standing == .inSession(session(), .focused))
        } else {
            await rig.engine.setForeground(false)
        }
        let sent = try await rig.server.next(unlockRoute)
        #expect(try reason(sent) == nil)
        sent.reply(200, Answer.unlocked())
        if back {
            try await rig.server.next(refocusRoute).reply(200, Answer.refocused())
            await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .focused) }
        } else {
            await rig.until { $0.queued.isEmpty && $0.standing == .inSession(session(), .unlocked) }
        }
        await rig.stop()
    }

    @Test(
        "A press that finds nothing to unlock by its end — out, its tap answered meanwhile — is said, never silence, and records nothing (#116's review); pressed where no Unlocked screen asks why — under a tap made out of any session — it goes at once"
    )
    func nothing() async throws {
        let rig = try Rig()
        #expect(await rig.engine.pressUnlock() == .nothing)
        #expect(await rig.engine.state.queued.isEmpty)
        #expect(UnlockFailure.nothing.words(paused: true) == "Nothing is paused now, so there was nothing to unlock.")
        let tap = try #require(try await rig.engine.record(.tap(tagId: "tag")))
        #expect(await rig.engine.pressUnlock() == nil)
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        let underTap = try await rig.server.next()
        #expect(underTap.route == "POST /v1/taps/\(tap.eventId)/unlock")
        underTap.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "A reason the file will not keep is said, the way on another try (rule 5); Back to focus the file will not keep is said too; standing unlocked in no session, Back to focus records nothing"
    )
    func notKept() async throws {
        let rig = try Rig()
        #expect(await rig.engine.backToFocus() == nil)
        #expect(await rig.engine.state.queued.isEmpty)
        try await rig.tapIn()
        #expect(await rig.engine.pressUnlock() == nil)
        try await rig.outbox.pool.write {
            try $0.execute(
                sql: "CREATE TRIGGER stay BEFORE UPDATE ON outbox BEGIN SELECT RAISE(ABORT, 'no'); END"
            )
        }
        #expect(await rig.engine.explain(.other) == "Bali couldn't save your reason. Try again.")
        try refuseRecords(rig.outbox)
        #expect(await rig.engine.backToFocus() == "Bali couldn't take you back to focus. Try again.")
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        await rig.stop()
    }

    @Test(
        "Protection off reported in a session is known until the phone's next tap, which a refocus out of it needs (A2) — across a relaunch too"
    )
    func reportedOff() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.protectionOff(session: "s"))
        #expect(await rig.engine.state.reportedOff == "s")
        let relaunched = try Rig(outbox: rig.outbox)
        #expect(await relaunched.engine.state.reportedOff == "s")
        await relaunched.stop()
        try await rig.engine.record(.tap(tagId: "tag"))
        #expect(await rig.engine.state.reportedOff == nil)
        await rig.stop()
    }

    @Test(
        "An unlock answered late (A10, A12) putting the shields back, no return of this phone's since, is said on Focus until the phone's next change — sent with the phone's order, a return the order cannot place; with none, the clock behind and how to set it"
    )
    func superseded() async throws {
        for ordered in [true, false] {
            let rig = try Rig()
            if !ordered {
                try await rig.outbox.pool.write { try Outbox.setState($0, Outbox.installKey, nil) }
            }
            try await rig.tapIn()
            try await rig.engine.record(.unlock(session: "s", reason: nil))
            try await rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
            let state = await rig.until { $0.queued.isEmpty }
            #expect(state.standing == .inSession(session(), .focused))
            #expect(state.superseded == Superseded(session: "s", ordered: ordered))
            let said = FocusWords(state, nil, now: t0).superseded
            #expect(
                said
                    == (ordered
                        ? "Bali recorded your unlock, but Bali on another phone, or from before a reinstall, put you back in focus after it. Hold to unlock again if you need to."
                        : "Bali recorded your unlock, but this phone's clock was behind, so it counted as before you went back to focus. Turn on Set Automatically in Settings → General → Date & Time, then hold to unlock again."
                    ))
            var elsewhere = state
            elsewhere.standing = .inSession(session("t"), .focused)
            #expect(FocusWords(elsewhere, nil, now: t0).superseded == nil)
            try await rig.engine.record(.unlock(session: "s", reason: nil))
            #expect(await rig.engine.state.superseded == nil)
            await rig.stop()
        }
    }

    @Test(
        "…but with a tap of this phone's since — refused, stuck, still its own — nothing is said: the late unlock is no surprise to it"
    )
    func supersededAfterOwnTap() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        try await rig.server.next(unlockRoute).reply(400, Answer.refused("invalid_request"))
        await rig.until { $0.queued.first?.stuck == true }
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(404, Answer.refused("session_not_found"))
        await rig.until { $0.queued.count == 2 && $0.queued.allSatisfy(\.stuck) }
        rig.clock.advance(by: 2 * Outbox.backoffCap)
        try await rig.server.next(unlockRoute).reply(200, Answer.unlockSuperseded())
        let state = await rig.until { $0.queued.count == 1 }
        #expect(state.standing == .inSession(session(), .focused) && state.superseded == nil)
        await rig.stop()
    }
}
