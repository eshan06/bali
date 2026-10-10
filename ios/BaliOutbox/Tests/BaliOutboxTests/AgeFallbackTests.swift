import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

// The 13+ check after a sign-in (C7's fallback, the owner's decision 2026-10-06; its yes on Bali's
// server, C7-server, 2026-10-08): a sign-in not yet through the check, over the engine as the app
// makes it, its sign-in gated as the app's is, and the API and Cognito answered by hand.

let ageCheckRoute = "GET /v1/me/age-check"
let recordAgeCheckRoute = "PUT /v1/me/age-check"
let ageCheckPassed = #"{"passed":true}"#

@Suite("The 13+ check after a sign-in, and its yes on Bali's server (C7)", .timeLimit(.minutes(3)))
struct AgeFallbackTests {
    @Test(
        "Until the sign-in is through the 13+ check, it reaches Bali's API with nothing but the check's own read (C7-server): no read of the truth, no record sent, each kept and waiting on the sign-in; the read goes under the sign-in's token; once through, everything goes at once under it"
    )
    func nothingBeforeTheAnswer() async throws {
        let rig = try await SignedRig(gated: true)
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.signStudentIn(accessToken("a1"))
        // The sign-in sends everything and reads the truth at once: each finds no token to send.
        await rig.until { $0.link == .signIn && $0.meFailed == .networkError }
        #expect(await rig.server.waiting.isEmpty)
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])

        let engine = rig.engine
        let asking = Task { await engine.ageCheck() }
        let read = try await rig.server.next(ageCheckRoute)
        #expect(read.token == "Bearer \(accessToken("a1"))")
        read.reply(200, #"{"passed":false}"#)
        #expect(await asking.value.answer?.passed == false)
        await rig.engine.retryNow()
        try await Task.sleep(for: .milliseconds(200))
        #expect(await rig.server.waiting.isEmpty)

        await rig.signIn.passed("a1")
        await rig.engine.retryNow()
        let sent = try await rig.server.next(unlockRoute)
        #expect(sent.eventId == unlock.eventId && sent.token == "Bearer \(accessToken("a1"))")
        let truth = try await rig.server.next(meRoute)
        #expect(truth.token == "Bearer \(accessToken("a1"))")
        await rig.stop()
    }

    @Test(
        "Answered under 13, the account goes as Delete account deletes one (C4), the check not passed: what the phone queued goes first under the deletion's own token, every Emergency Unlock first — one the server has not recorded holds the deletion back, never let go — then DELETE /v1/me, then Cognito's DeleteUser; no yes is ever sent; nothing is left in the outbox, so the next sign-in on this phone files nothing under its own account (Claude Review's blocker)"
    )
    func deletedUnderThirteen() async throws {
        let rig = try await SignedRig(gated: true)
        let tap = try #require(try await rig.engine.record(.tap(tagId: "tag")))
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.signStudentIn(scoped("a1"))
        await rig.until { $0.link == .signIn && $0.meFailed == .networkError }
        #expect(await rig.server.waiting.isEmpty)

        // The unlock first, ahead of the tap queued before it; no answer to it holds the deletion.
        let held = rig.deleting()
        let unsent = try await rig.server.next()
        #expect(unsent.route == unlockRoute && unsent.eventId == unlock.eventId)
        #expect(unsent.token == "Bearer \(scoped("a1"))")
        unsent.reply(nil)
        let tapped = try await rig.server.next()
        #expect(tapped.route == tapRoute && tapped.eventId == tap.eventId)
        tapped.reply(200, Answer.armed)
        #expect(await held.value == .unlockUnsent)
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])
        #expect(await rig.server.waiting.isEmpty)

        // Try again: the unlock lands, then the deletion, then the sign-in's.
        let deletion = rig.deleting()
        try await rig.server.next(unlockRoute).reply(200, Answer.unlockNoted)
        let delete = try await rig.server.next()
        #expect(delete.route == deleteMeRoute && delete.token == "Bearer \(scoped("a1"))")
        delete.reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        #expect(rig.keychain.isEmpty)
        #expect(try rig.outbox.records().isEmpty)

        // Another student signs in on this phone, through the check: nothing of the last one's goes,
        // only reads of the truth — a second one when the read their sign-in's own wake sends asks
        // for its token only once the check has passed, as on a busy machine it can.
        try await rig.signStudentIn(accessToken("b1"))
        await rig.signIn.passed("b1")
        await rig.engine.retryNow()
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.me != nil }
        #expect(await rig.server.waiting.allSatisfy { $0 == meRoute })
        await rig.stop()
    }

    @Test(
        "A Sign up's yes goes to Bali's server at the engine's wakes (C7-server): `PUT /v1/me/age-check` under the yes's own event id and the sign-in's token, each time; no answer, or a server error, keeps it for the next wake, under the same id; recorded, it is let go and never sent again, the sign-in still through the check"
    )
    func yesRecorded() async throws {
        let rig = try await SignedRig(gated: true)
        try await rig.signStudentIn(accessToken("a1"), yes: "y1")
        let yes = try await yesSent(rig, answered: [(nil, ""), (500, ""), (200, ageCheckPassed)])
        #expect(yes.map(\.eventId) == ["y1", "y1", "y1"])
        #expect(yes.allSatisfy { $0.token == "Bearer \(accessToken("a1"))" })
        try await eventually { await rig.signIn.yes() == nil }
        #expect(await rig.signIn.checked())
        await rig.engine.retryNow()
        try await Task.sleep(for: .milliseconds(200))
        #expect(await !rig.server.waiting.contains(recordAgeCheckRoute))
        await rig.stop()
    }

    @Test(
        "A yes Bali's server refuses for good — the account deleted on its way, `409 account_deleted` — is let go, never sent again: the account is asked once more only at a sign-in where Bali's server has no yes for it (C7-server)"
    )
    func yesRefused() async throws {
        let rig = try await SignedRig(gated: true)
        try await rig.signStudentIn(accessToken("a1"), yes: "y1")
        let deleted = #"{"error":{"code":"conflict","reason":"account_deleted","message":"gone"}}"#
        _ = try await yesSent(rig, answered: [(409, deleted)])
        try await eventually { await rig.signIn.yes() == nil }
        await rig.engine.retryNow()
        try await Task.sleep(for: .milliseconds(200))
        #expect(await !rig.server.waiting.contains(recordAgeCheckRoute))
        await rig.stop()
    }

    @Test(
        "A yes on its way when Delete account is pressed lands before anything of the deletion goes (C7-server): the deletion waits it out, so no yes ever reaches Bali after its DELETE /v1/me, which would make a fresh account"
    )
    func yesBeforeDeletion() async throws {
        let rig = try await SignedRig(gated: true)
        try await rig.signStudentIn(scoped("a1"), yes: "y1")
        var onItsWay: Server.Exchange?
        while onItsWay == nil {
            let next = try await rig.server.next()
            guard next.route == recordAgeCheckRoute else {
                next.reply(200, Answer.me(nil))
                continue
            }
            onItsWay = next
        }
        let deletion = rig.deleting()
        try await Task.sleep(for: .milliseconds(200))
        try #require(await rig.server.waiting.isEmpty)  // the deletion waits for the yes
        onItsWay?.reply(200, ageCheckPassed)
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        #expect(await rig.server.waiting.isEmpty && rig.keychain.isEmpty)
        await rig.stop()
    }

    @Test(
        "The app's own ask of the 13+ check, again (#300's review; the owner's approval, 2026-10-09), runs at each wake of the read loop, behind the app or in front — its first, a sign-in's token, a Try again, a return to the front, each 30 s in front — never while an account deletion runs, when nothing of the loops' goes; and again once it is over"
    )
    func askAgeAtEachWake() async throws {
        final class Count: @unchecked Sendable {
            private let lock = NSLock()
            private var count = 0
            func add() { lock.withLock { count += 1 } }
            var value: Int { lock.withLock { count } }
        }
        let (asks, checks) = (Count(), Count())
        let rig = try await SignedRig(gated: true, age: { asks.add() })
        await rig.engine.atEachWake { checks.add() }
        try await eventually { asks.value == 1 }
        try await rig.signStudentIn(scoped("a1"))
        try await eventually { asks.value == 2 }
        await rig.engine.retryNow()
        try await eventually { asks.value == 3 }
        await rig.engine.setForeground(true)
        try await eventually { asks.value == 4 }
        try await eventually { rig.clock.deadlines == [at(30)] }
        rig.clock.advance(by: 30)
        try await eventually { asks.value == 5 }

        // Delete account, held at the unlock it sends first: two wakes meanwhile, rule 3's check
        // run at each, the first over before the second begins, and nothing asked at either.
        try await rig.engine.record(.unlock(session: "s", reason: nil))
        let deletion = rig.deleting()
        let unlock = try await rig.server.next(unlockRoute)
        let woken = checks.value
        for wake in 1...2 {
            await rig.engine.retryNow()
            try await eventually { checks.value == woken + wake }
        }
        #expect(asks.value == 5)
        unlock.reply(200, Answer.unlockNoted)
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        try await eventually { asks.value > 5 }
        await rig.stop()
    }
}

/// The yes the engine sends, answered in turn from `answered` — a status and a body, nil no answer
/// — each read of the truth its wakes send meanwhile answered too, in whatever order they come, and
/// a wake asked for after each answer but the last: the yes's requests, in order.
private func yesSent(_ rig: SignedRig, answered: [(Int?, String)]) async throws -> [Server.Exchange]
{
    var (answers, sent) = (answered, [Server.Exchange]())
    while !answers.isEmpty {
        let next = try await rig.server.next()
        guard next.route == recordAgeCheckRoute else {
            #expect(next.route == meRoute)
            next.reply(200, Answer.me(nil))
            continue
        }
        sent.append(next)
        let (status, body) = answers.removeFirst()
        next.reply(status, body)
        if !answers.isEmpty { await rig.engine.retryNow() }
    }
    return sent
}
