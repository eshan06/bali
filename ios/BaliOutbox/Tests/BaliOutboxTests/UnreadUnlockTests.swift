import BaliCore
import Foundation
import GRDB
import Testing

@testable import BaliOutbox

@Suite("Emergency Unlock over a standing the file will not give back (B6b)", .timeLimit(.minutes(3)))
struct UnreadUnlockTests {
    @Test(
        "No tap pending, it takes the last run's shields off at once and is kept — sent nowhere, holding back nothing behind it, guarding every session, nothing written over the file's standing — until the phone knows where it stands"
    )
    func kept() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        #expect(await phone.screenTime.shielding)
        let unlock = try #require(try await rig.engine.emergencyUnlock(reason: .nurse))
        #expect(unlock.change == .unlockUnfiled(reason: .nurse) && unlock.request == nil)
        await phone.until { !$0.shielded }
        #expect(await !phone.screenTime.shielding)
        let state = await rig.engine.state
        #expect(state.standing == .unread && state.queued.map(\.eventId) == [unlock.eventId])
        #expect(try rig.outbox.nextDue(now: rig.clock.now()) == .idle)
        #expect(try rig.outbox.awaiting() == 0)
        #expect(try rig.outbox.holdsUnlock(session: "s") && rig.outbox.holdsUnlock(session: "t"))
        #expect(try keptStanding(rig.outbox) == "spoiled")
        #expect(await rig.server.waiting.isEmpty)
        // A tap made after it goes at once.
        try await rig.engine.tap(.block("T7XK2M9QPF"))
        try await rig.server.next(tapRoute).reply(nil)
        await phone.stop()
    }

    @Test(
        "Under the tap not yet answered, as decision 11 files it, it takes the last run's shields off too"
    )
    func underPendingTap() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        let tap = try #require(try await rig.engine.tap(.block("T7XK2M9QPF")))
        let held = try await rig.server.next(tapRoute)
        #expect(await phone.screenTime.shielding)
        let unlock = try #require(try await rig.engine.emergencyUnlock())
        #expect(unlock.change == .unlockUnderTap(tap: tap.eventId, reason: nil))
        await phone.until { !$0.shielded }
        #expect(await !phone.screenTime.shielding)
        held.reply(nil)
        await phone.stop()
    }

    @Test(
        "An unlock the last run left queued ends nothing: a tap since may have put the shields back on, so the last run's stay"
    )
    func leftByTheLastRun() async throws {
        let (outbox, _) = try makeOutbox()
        let stale = try record(outbox, .unlock(session: "s", reason: nil))
        try await send(outbox, stale, 400, Answer.refused("invalid_request"))
        let (phone, _) = try await unreadable(outbox: outbox)
        #expect(await phone.screenTime.shielding)
        #expect(await phone.screenTime.unshields == 0)
        await phone.stop()
    }

    @Test(
        "Once the file gives back where the phone stood, the unlock is filed there, in the write that keeps it, and sent: the phone stands unlocked there, never shielded"
    )
    func filedWhenTheFileReads() async throws {
        let (outbox, url) = try makeOutbox()
        let (phone, kept) = try await unreadable(outbox: outbox)
        let rig = phone.rig
        let unlock = try #require(try await rig.engine.emergencyUnlock(reason: .bathroom))
        await phone.until { !$0.shielded }
        try outbox.keep(kept)
        // A relaunch at every commit from here never stands focused beside the unlock.
        let relaunches = try Relaunches(url)
        outbox.pool.add(transactionObserver: relaunches, extent: .observerLifetime)
        try await rig.sleeping([at(60)])
        rig.clock.advance(by: 60)
        let sent = try await rig.server.next(sessionUnlockRoute)
        outbox.pool.remove(transactionObserver: relaunches)
        #expect(sent.eventId == unlock.eventId)
        let unlocked = Standing.inSession(session(endsAt: 1200), .unlocked)
        #expect(await rig.engine.state.standing == unlocked)
        #expect(try rig.outbox.standing() == unlocked)
        #expect(!relaunches.engines.isEmpty)
        for engine in relaunches.engines {
            #expect(await engine.state.shieldedUntil(at(60)) == nil)
        }
        sent.reply(200, Answer.unlocked(session(endsAt: 1200)))
        await rig.until { $0.queued.isEmpty }
        #expect(await phone.screenTime.unshields == 1)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "Once the server names the session, a read saying focused there leaves the phone unlocked — not filed, the unlock may be of any session — and the unlock is filed there and sent"
    )
    func filedWhereTheServerSays() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        let unlock = try #require(try await rig.engine.emergencyUnlock())
        await phone.until { !$0.shielded }
        let view = session(endsAt: 4000)
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(200, Answer.me(view))
        let sent = try await rig.server.next(sessionUnlockRoute)
        #expect(sent.eventId == unlock.eventId)
        #expect(await rig.engine.state.standing == .inSession(view, .unlocked))
        #expect(await !phone.screenTime.shielding)
        sent.reply(200, Answer.unlocked(view))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(view, .unlocked))
        #expect(await phone.screenTime.unshields == 1)
        await phone.stop()
    }

    @Test(
        "When the truth names no session, it goes under the phone's last tap: the server files it where that tap landed, or keeps it with no class — never discarded"
    )
    func noSession() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "T7XK2M9QPF"))
        try await send(outbox, tap, 200, Answer.joined(session(endsAt: 1200)))
        let (phone, _) = try await unreadable(outbox: outbox)
        let rig = phone.rig
        let unlock = try #require(try await rig.engine.emergencyUnlock())
        await phone.until { !$0.shielded }
        // The class ended while the file could not say so: the student is in none.
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        let sent = try await rig.server.next(underTapRoute(tap))
        #expect(sent.eventId == unlock.eventId)
        sent.reply(200, Answer.unlockAfterEnd(session(endsAt: 1200)))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .out)
        #expect(await !phone.screenTime.shielding)
        await phone.stop()
    }

    @Test(
        "With no tap known and no session named, it waits, kept — never sent — and a later truth naming one files it there: a tap the student makes after it, which the server orders after it"
    )
    func noTapKnown() async throws {
        let (phone, _) = try await unreadable()
        let rig = phone.rig
        let unlock = try #require(try await rig.engine.emergencyUnlock())
        await phone.until { !$0.shielded }
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        let out = await rig.until { $0.standing == .out }
        #expect(out.queued.map(\.change) == [.unlockUnfiled(reason: nil)])
        #expect(try rig.outbox.nextDue(now: rig.clock.now()) == .idle)
        let view = session("t", endsAt: 4000)
        try await rig.engine.tap(.block("T7XK2M9QPF"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined(view))
        let sent = try await rig.server.next("POST /v1/sessions/t/unlock")
        #expect(sent.eventId == unlock.eventId)
        sent.reply(200, Answer.unlockSuperseded(view))
        let state = await rig.until { $0.queued.isEmpty }
        #expect(state.standing == .inSession(view, .focused))
        await phone.stop()
    }

    @Test(
        "Kept across a relaunch: the file still unread, the shields stay off and it stays; the file read again, the monitor clears, and the next launch stands unlocked where the phone stood — never shielded — and files and sends it"
    )
    func relaunched() async throws {
        let (outbox, url) = try makeOutbox()
        let (first, kept) = try await unreadable(outbox: outbox)
        let unlock = try #require(try await first.rig.engine.emergencyUnlock())
        await first.until { !$0.shielded }
        await first.stop()
        let screenTime = first.screenTime
        let second = Enforced(try Rig(outbox: try open(url)), screenTime)
        await second.until { $0.permission == .approved }
        let unread = await second.rig.engine.state
        #expect(unread.standing == .unread && unread.queued.map(\.eventId) == [unlock.eventId])
        #expect(await !screenTime.shielding)
        await second.stop()
        try outbox.keep(kept)
        #expect(Bell.wake(outboxAt: url, now: t0) == .clear)
        let third = Enforced(try Rig(outbox: try open(url)), screenTime)
        let sent = try await third.rig.server.next(sessionUnlockRoute)
        #expect(sent.eventId == unlock.eventId)
        let standing = await third.rig.engine.state.standing
        #expect(standing == .inSession(session(endsAt: 1200), .unlocked))
        #expect(await !screenTime.shielding)
        await third.stop()
    }

    @Test(
        "Filing, in the outbox: in the session a standing names; naming none, under the last tap; with no tap known, not at all — and until filed, where the phone stood acts as unlocked"
    )
    func filing() throws {
        let (outbox, _) = try makeOutbox()
        try outbox.keep(.inSession(session(), .focused))
        let first = try record(outbox, .unlockUnfiled(reason: .other))
        #expect(try outbox.standing() == .inSession(session(), .unlocked))
        try outbox.file(.out)
        #expect(try current(outbox, first.eventId)?.change == .unlockUnfiled(reason: .other))
        let tap = try record(outbox, .tap(tagId: "tag"))
        try outbox.file(.waiting)
        #expect(
            try current(outbox, first.eventId)?.change
                == .unlockUnderTap(tap: tap.eventId, reason: .other))
        #expect(try outbox.standing() == .waiting)
        let second = try record(outbox, .unlockUnfiled(reason: nil))
        try outbox.file(.inSession(session(), .unlocked))
        #expect(try current(outbox, second.eventId)?.change == .unlock(session: "s", reason: nil))
        #expect(try outbox.standing() == .inSession(session(), .unlocked))
    }
}
