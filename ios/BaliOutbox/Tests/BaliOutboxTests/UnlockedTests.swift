import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// The Unlocked screen's words for `state`, on a US phone in New York.
private func words(_ state: SyncState) -> UnlockedWords? { UnlockedWords(state, time: newYork) }

/// `state` with an unlock the server recorded in session `session`, at `reason`.
private func recorded(_ state: SyncState, _ reason: UnlockReason?, session: String = "s")
    -> SyncState
{
    var state = state
    state.recordedUnlock = RecordedUnlock(session: session, unlock: "u", reason: reason)
    return state
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

/// The event id a request carries.
private func eventId(_ exchange: Server.Exchange) throws -> String {
    struct Body: Decodable { let eventId: String }
    return try JSONDecoder().decode(Body.self, from: try #require(exchange.request.httpBody)).eventId
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
                == "Everything's open until you lock your apps again or the bell at 10:42 AM. Your teacher will see you unlocked."
        )
        #expect(held.picker == .open(nil) && held.retap == nil && held.stuck == nil)
        let gone = try #require(words(try unlocked()))
        #expect(
            plain(gone.body)
                == "Everything's open until you lock your apps again or the bell at 10:42 AM. Your teacher can see you unlocked."
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
        "The reason card (C5c): the check on the reason the unlock carries while it is on the phone, a pick open while it has never been sent — waiting, its buttons off, once it is on its way, sent with no answer, or stuck; once the server has it, open at the reason on record (A20); an unlock this run did not make, no card"
    )
    func picker() async throws {
        let (held, queued) = try pressed(reason: .nurse)
        #expect(words(try unlocked(queued))?.picker == .open(.nurse))
        var onItsWay = try unlocked(queued)
        onItsWay.sending = [try #require(queued.first).eventId]
        #expect(words(onItsWay)?.picker == .waiting(.nurse))
        try await send(held, try #require(queued.first), nil)
        #expect(try held.records().first?.attempts == 1)
        #expect(words(try unlocked(try held.records()))?.picker == .waiting(.nurse))
        #expect(words(recorded(try unlocked(), .bathroom))?.picker == .open(.bathroom))
        #expect(words(recorded(try unlocked(), nil))?.picker == .open(nil))
        // A newer unlock of the class on the phone is the card's; another class's recorded is not.
        #expect(words(recorded(try unlocked(queued), .bathroom))?.picker == .open(.nurse))
        #expect(words(recorded(try unlocked(), .bathroom, session: "a"))?.picker == nil)
        #expect(words(try unlocked())?.picker == nil)
        // The unlock the card is about, which a pick is for alone (#140): the same one, by its id.
        let onThePhone = try #require(queued.first).eventId
        #expect(words(try unlocked(queued))?.unlock == onThePhone)
        #expect(words(recorded(try unlocked(queued), .bathroom))?.unlock == onThePhone)
        #expect(words(recorded(try unlocked(), .bathroom))?.unlock == "u")
        #expect(words(recorded(try unlocked(), .bathroom, session: "a"))?.unlock == nil)
        #expect(words(try unlocked())?.unlock == nil)
        #expect(UnlockedWords.Picker.open(nil).caption == "Your teacher sees the reason you pick.")
        #expect(UnlockedWords.Picker.waiting(nil).caption == UnlockedWords.onItsWay)
        #expect(
            UnlockedWords.Picker.waiting(.nurse).caption
                == "Your reason goes with your unlock. You can change it once it arrives.")
    }

    @Test(
        "Protection off reported in this session since the phone's last tap: the way back is a re-tap — a refocus out of it is refused (A2; #96's review) — never Back to focus; reported in another session, Back to focus"
    )
    func retap() throws {
        var state = try unlocked()
        state.reportedOff = bell1042.id
        #expect(
            words(state)?.retap
                == "Screen Time was off during this class, so tap your teacher's block to lock your apps again."
        )
        state.reportedOff = "another"
        #expect(words(state)?.retap == nil)
    }

    @Test(
        "The unlock the screen reads is this class's (#119's review): another class's, stuck on the phone, is not said here, nor is its reason — the teacher can see this one — while one under a tap, or not filed yet, may be any class's"
    )
    func thisClass() async throws {
        let (outbox, _) = try makeOutbox()
        let other = try record(outbox, .unlock(session: "a", reason: .nurse))
        try await send(outbox, other, 400, Answer.refused("invalid_request"))
        let said = try #require(words(try unlocked(try outbox.records())))
        #expect(said.stuck == nil && said.picker == nil)
        #expect(plain(said.body)?.hasSuffix("Your teacher can see you unlocked.") == true)
        let (tapped, _) = try makeOutbox()
        try record(tapped, .unlockUnderTap(tap: "t", reason: .other))
        #expect(words(try unlocked(try tapped.records()))?.picker == .open(.other))
    }

    @Test(
        "An unlock the server refused, or left unsettled to the bound, is said — still kept and retried (rule 5) — and no pick can reach it until it lands"
    )
    func stuck() async throws {
        let (outbox, queued) = try pressed()
        try await send(outbox, try #require(queued.first), 400, Answer.refused("invalid_request"))
        let said = try #require(words(try unlocked(try outbox.records())))
        #expect(said.stuck == "Bali couldn't send your unlock to your teacher yet. It keeps trying.")
        #expect(said.picker == .waiting(nil))
    }

    @Test(
        "A change the server did not take is said by its refusal (rule 5): the unlock over, the class over, not found — else the Join screen's words"
    )
    func notChanged() async {
        func said(_ status: Int?, _ reason: String? = nil) async -> String {
            let client = APIClient(
                baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(),
                transport: Canned(status: status, body: Data((reason.map(Answer.refused) ?? "").utf8)))
            let request = UnlockReasonRequest(reason: .nurse, eventId: "e")
            return UnlockedWords.notChanged(await client.changeReason(unlock: "u", request))
        }
        #expect(
            await said(409, "unlock_superseded") == "This unlock is over, so its reason can't change.")
        #expect(
            await said(409, "session_not_running") == "Class is over, so the reason can't change.")
        #expect(
            await said(404, "unlock_not_found")
                == "Bali couldn't find this unlock, so its reason can't change.")
        #expect(await said(nil) == UnlockedWords.offline)
        #expect(
            await said(500) == "Bali couldn't change your reason. Try again in a moment.")
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
        sent.reply(200, Answer.unlocked(reason: "bathroom"))
        let recorded = await rig.until { $0.queued.isEmpty }
        #expect(recorded.recordedUnlock?.reason == .bathroom)
        let unlock = try #require(recorded.recordedUnlock?.unlock)
        // Once the server has it, a pick is a change of it (A20).
        async let picked = rig.engine.explain(.nurse)
        let change = try await rig.server.next("PATCH /v1/unlocks/\(unlock)")
        #expect(try reason(change) == "nurse")
        change.reply(200, #"{"outcome":"applied","reason":"nurse"}"#)
        #expect(await picked == nil)
        #expect(await rig.engine.state.recordedUnlock?.reason == .nurse)
        await rig.stop()
    }

    @Test(
        "The server keeps the reason it recorded first (A1): an unlock's answer keeping none, or another, than the one the phone sent — its first send left unsettled, a reason given after a relaunch — is said in the reason's place, never the phone's claim (#119's review), until the phone's next change; one keeping the phone's own says nothing"
    )
    func reasonKept() async throws {
        /// The unlock's retry answered: recorded before, with `reason` on record.
        func replay(_ reason: String) -> String {
            #"{"outcome":"replay","recordedAs":null,"state":"unlocked","session":\#(json(session())),"reason":\#(reason)}"#
        }
        let cases: [(String, UnlockReason?)] = [
            ("null", nil), (#""bathroom""#, .bathroom), (#""nurse""#, .nurse),
        ]
        for (answer, kept) in cases {
            let rig = try Rig()
            try await rig.tapIn()
            let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: .nurse)))
            try await rig.server.next(unlockRoute).reply(200, replay(answer))
            let state = await rig.until { $0.queued.isEmpty }
            #expect(
                state.recordedUnlock
                    == RecordedUnlock(session: "s", unlock: unlock.eventId, reason: kept),
                "\(answer)")
            #expect(UnlockedWords(state)?.picker == .open(kept), "\(answer)")
            try await rig.engine.record(.refocus(session: "s"))
            #expect(await rig.engine.state.recordedUnlock == nil, "\(answer)")
            await rig.stop()
        }
        // An older unlock's answer landing after a newer unlock was pressed, still queued: the
        // card is about the newer one, whose reason can still go — nothing said (santa's round 1).
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: .nurse))
        let older = try await rig.server.next(unlockRoute)
        #expect(await rig.engine.pressUnlock() == nil)
        older.reply(200, replay("null"))
        let newer = await rig.until { $0.queued.count == 1 }
        #expect(UnlockedWords(newer)?.picker == .open(nil) && newer.recordedUnlock != nil)
        await rig.stop()
        // Another class's unlock stuck in the queue is no matter: this class's card still says
        // what the server kept (santa's round 2).
        let (outbox, _) = try makeOutbox()
        let stuck = try record(outbox, .unlock(session: "a", reason: nil))
        try await send(outbox, stuck, 400, Answer.refused("invalid_request"))
        let other = try Rig(outbox: outbox)
        try await other.engine.record(.tap(tagId: "tag"))
        try await other.server.next(tapRoute).reply(200, Answer.joined())
        await other.until { $0.standing == .inSession(session(), .focused) }
        try await other.engine.record(.unlock(session: "s", reason: .nurse))
        try await other.server.next(unlockRoute).reply(200, replay("null"))
        let state = await other.until { $0.queued.count == 1 }
        #expect(state.recordedUnlock?.reason == nil && UnlockedWords(state)?.picker == .open(nil))
        await other.stop()
    }

    @Test(
        "Once the server has the unlock, a pick is a change of it (A20): a refusal said, the check left on the reason on record; no answer said, the same pick going again under its event id (rule 4); the phone moving on meanwhile, the answer moves no check"
    )
    func changed() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        try await rig.server.next(unlockRoute).reply(200, Answer.unlocked())
        let unlock = try #require(await rig.until { $0.queued.isEmpty }.recordedUnlock?.unlock)
        let route = "PATCH /v1/unlocks/\(unlock)"
        async let refused = rig.engine.explain(.nurse)
        try await rig.server.next(route).reply(409, Answer.refused("unlock_superseded"))
        #expect(await refused == "This unlock is over, so its reason can't change.")
        #expect(await rig.engine.state.recordedUnlock?.reason == nil)
        async let lost = rig.engine.explain(.other)
        let first = try await rig.server.next(route)
        first.reply(nil)
        #expect(await lost == UnlockedWords.offline)
        async let again = rig.engine.explain(.other)
        let second = try await rig.server.next(route)
        #expect(try eventId(second) == eventId(first))
        second.reply(200, #"{"outcome":"replay","reason":"other"}"#)
        #expect(await again == nil)
        #expect(await rig.engine.state.recordedUnlock?.reason == .other)
        async let late = rig.engine.explain(.bathroom)
        let third = try await rig.server.next(route)
        #expect(try eventId(third) != eventId(first))
        #expect(await rig.engine.backToFocus() == nil)
        third.reply(200, #"{"outcome":"applied","reason":"bathroom"}"#)
        #expect(await late == nil)
        #expect(await rig.engine.state.recordedUnlock == nil)
        await rig.stop()
    }

    @Test(
        "Answered, the unlock leaves `sending` in the write that reads the queue again: no state published between shows it neither on its way nor answered, so the card never opens over an unlock already sent (santa's round 2)"
    )
    func settledInOneWrite() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        let sent = try await rig.server.next(unlockRoute)
        let states = await rig.engine.updates()
        let (ready, isReady) = AsyncStream.makeStream(of: Void.self)
        let opened = Task {
            var (open, first) = (false, true)
            for await state in states {
                if first { (first, _) = (false, isReady.yield()) }
                let queued = state.queued.contains { $0.eventId == unlock.eventId }
                if queued, case .open? = UnlockedWords(state)?.picker { open = true }
                if !queued { break }
            }
            return open
        }
        for await _ in ready { break }
        // The watcher waiting for the next state, so the answer's first publish goes straight to
        // it — the one a split write would show open.
        try await Task.sleep(for: .milliseconds(100))
        sent.reply(200, Answer.unlocked())
        #expect(await opened.value == false)
        await rig.stop()
    }

    @Test(
        "None given, it goes as the hold ends, without one: a reason given after a send with no answer — the server may have it — or while it is on its way, waits for it to land"
    )
    func notGiven() async throws {
        let rig = try Rig()
        try await rig.tapIn()
        #expect(await rig.engine.pressUnlock() == nil)
        try await rig.sleeping([at(SyncEngine.reasonHold)])
        rig.clock.advance(by: SyncEngine.reasonHold)
        let first = try await rig.server.next(unlockRoute)
        #expect(try reason(first) == nil)
        // On its way, never sent by the file's count: the send would not carry it.
        #expect(await rig.engine.explain(.nurse) == UnlockedWords.onItsWay)
        // No answer: the server may have it all the same, and would keep it without one.
        first.reply(nil)
        await rig.until { $0.queued.first?.attempts == 1 }
        #expect(await rig.engine.explain(.nurse) == UnlockedWords.onItsWay)
        rig.clock.advance(by: 2)
        let again = try await rig.server.next(unlockRoute)
        #expect(try reason(again) == nil)
        again.reply(200, Answer.unlocked())
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "Pressed in a session's last seconds, it waits for the reason only until the bell, so the class's grid shows it before the session is swept (santa's review)"
    )
    func beforeTheBell() async throws {
        let rig = try Rig()
        try await rig.tapIn(session(endsAt: 5))
        #expect(await rig.engine.pressUnlock() == nil)
        try await rig.sleeping([at(5)])
        rig.clock.advance(by: 5)
        try await rig.server.next(unlockRoute).reply(200, Answer.unlocked(session(endsAt: 5)))
        await rig.until { $0.queued.isEmpty }
        await rig.stop()
    }

    @Test(
        "A reason given for a press under a scan that joined no class (B6d) goes with its follow-up, the class's own record, at once — the press's hold ended with it (santa's review)"
    )
    func refiledReason() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try #require(
            try outbox.record(
                .unlockUnderTap(tap: tap.eventId, reason: nil), now: t0,
                standing: .inSession(session(), .unlocked), holding: SyncEngine.reasonHold))
        try await send(outbox, tap, 200, Answer.armed)
        let followUp = try #require(
            try outbox.records().first { if case .unlock = $0.change { true } else { false } })
        #expect(try outbox.explain(.nurse, now: t0, sent: []))
        #expect(try current(outbox, followUp.eventId)?.change.reason == .nurse)
        guard case .send(let due) = try outbox.nextDue(now: t0) else {
            Issue.record("the press's hold still holds the follow-up back")
            return
        }
        #expect(due.change == .unlockUnderTap(tap: tap.eventId, reason: nil))
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
        "Back to focus refused by the server (C5b; rule 5): protection off there, dropped and the truth read again, lands on Protection off, saying why and the re-tap; another refusal, the unlock still standing, lands on Unlocked with the re-tap in its place — and the phone's next change ends the words"
    )
    func refusedBack() async throws {
        for (reason, read, landed, said) in [
            ("protection_off", "protection_off", ParticipationState.protectionOff, offWords),
            ("event_id_conflict", "unlocked", .unlocked, refusedWords),
        ] {
            let rig = try Rig()
            try await rig.tapIn()
            #expect(await rig.engine.pressUnlock() == nil)
            #expect(await rig.engine.backToFocus() == nil)
            try await rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            try await rig.server.next(refocusRoute).reply(409, Answer.refused(reason))
            try await rig.server.next(meRoute).reply(200, Answer.me(state: read))
            let state = await rig.until {
                $0.standing == .inSession(session(), landed) && $0.refused != nil
            }
            #expect(state.refusedRefocusWords(at: t0) == said, "\(reason)")
            let where_ =
                landed == .protectionOff
                ? ProtectionOffWords(state, nil)?.refused : UnlockedWords(state)?.retap
            #expect(where_ == said, "\(reason)")
            try await rig.engine.record(.tap(tagId: "tag"))
            #expect(await rig.engine.state.refusedRefocusWords(at: t0) == nil, "\(reason)")
            await rig.stop()
        }
    }

    @Test(
        "A press that finds nothing to unlock by its end — out, its tap answered meanwhile — is said, never silence, and records nothing (#116's review); pressed where no Unlocked screen asks why — under a tap made out of any session — it goes at once"
    )
    func nothing() async throws {
        let rig = try Rig()
        #expect(await rig.engine.pressUnlock() == .nothing)
        #expect(await rig.engine.state.queued.isEmpty)
        #expect(
            UnlockFailure.nothing.words(paused: true)
                == "There was nothing to unlock, so nothing was recorded.")
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
        #expect(await rig.engine.backToFocus() == "Bali couldn't lock your apps. Try again.")
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
            // Late, it is on no chip, and its reason never changes (A20): nothing to pick for.
            #expect(state.recordedUnlock == nil)
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
