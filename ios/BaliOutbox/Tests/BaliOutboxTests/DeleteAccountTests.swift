import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

// C4: Delete account through the engine, over the real sign-in — the API, Cognito's token endpoint
// and its DeleteUser all answered by hand.

let deleteMeRoute = "DELETE /v1/me"
/// Cognito's DeleteUser, at `https://cognito-idp.us-east-1.amazonaws.com/`.
let deleteUserRoute = "POST /"
let deletedAnswer = #"{"outcome":"deleted"}"#

/// An access token from a sign-in that asked for the scope DeleteUser needs, its pool named.
func scoped(_ name: String) -> String {
    let payload =
        #"{"sub":"\#(name)","iat":1000000000,"exp":1000003600,"scope":"openid email profile aws.cognito.signin.user.admin","iss":"https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YTloqilwT"}"#
    let encoded = Data(payload.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJSUzI1NiJ9.\(encoded).signature"
}

extension SignedRig {
    /// Signed in with `access` — by default a token that may delete itself — and the read of the
    /// truth the sign-in sends answered with `me`.
    func signIn(_ access: String = scoped("a1"), me: String = Answer.me(nil)) async throws {
        try await signStudentIn(access)
        try await server.next(meRoute).reply(200, me)
    }

    /// Delete account pressed: the engine's answer, once it comes.
    func deleting() -> Task<AccountDeletion, Never> {
        let (engine, signIn) = (engine, signIn)
        return Task { await engine.deleteAccount(signIn) }
    }
}

@Suite("Delete account through the engine (C4)", .timeLimit(.minutes(3)))
struct DeleteAccountTests {
    @Test(
        "A sign-in made before the phone asked for the scope DeleteUser needs signs in again first: nothing sent — an unlock queued not even — nothing deleted, the sign-in kept"
    )
    func signInFirst() async throws {
        let rig = try await SignedRig()
        try await rig.signIn(accessToken("a1"))
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.server.next(unlockRoute).reply(nil)
        await rig.until { $0.retryAt == at(2) }

        #expect(await rig.engine.deleteAccount(rig.signIn) == .signInFirst)
        #expect(await rig.server.waiting.isEmpty)
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])
        #expect(!rig.keychain.isEmpty)
        await rig.stop()
    }

    @Test(
        "The outbox goes before the deletion, every Emergency Unlock first — ahead of a record the phone queued before it — then DELETE /v1/me under the sign-in's token, then Cognito's DeleteUser with nothing between: no GET /v1/me, which would make a fresh account. Done, the sign-in is forgotten and nothing more is sent"
    )
    func deleted() async throws {
        let rig = try await SignedRig()
        try await rig.signIn(me: Answer.me())
        await rig.until { $0.standing == .inSession(session(), .focused) }
        try await rig.engine.record(.protectionOff(session: "s"))
        // No answer: kept, and holding what the phone does after it.
        try await rig.server.next(protectionOffRoute).reply(nil)
        await rig.until { $0.retryAt == at(2) }
        let unlock = try #require(try await rig.engine.emergencyUnlock())

        let deletion = rig.deleting()
        let first = try await rig.server.next()
        #expect(first.route == unlockRoute && first.eventId == unlock.eventId)
        first.reply(200, Answer.unlocked())
        let second = try await rig.server.next()
        #expect(second.route == protectionOffRoute)
        second.reply(200, Answer.protectionOff())
        let delete = try await rig.server.next()
        #expect(delete.route == deleteMeRoute && delete.token == "Bearer \(scoped("a1"))")
        delete.reply(200, deletedAnswer)
        let cognito = try await rig.server.next(deleteUserRoute)
        #expect(await rig.server.waiting.isEmpty)
        // While DeleteUser is on its way, a read of the truth asked for sends nothing — nor does a
        // tap made then, which goes with the account as DeleteUser answers.
        await rig.engine.setForeground(true)
        await rig.until { $0.link == .signIn }
        try await rig.engine.record(.tap(tagId: "tag"))
        await rig.until { $0.queued.count == 1 }
        #expect(await rig.server.waiting.isEmpty)
        cognito.reply(200, "{}")

        #expect(await deletion.value == .deleted)
        #expect(rig.keychain.isEmpty)
        #expect(try rig.outbox.records().isEmpty)
        await rig.engine.retryNow()
        await rig.until { $0.link == .signIn && $0.queued.isEmpty }
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test(
        "A deletion ends the phone's session with no Emergency Unlock (the owner's ruling): the shields come off, the standing is out — kept for a relaunch — and no unlock is recorded, nor sent"
    )
    func sessionEnded() async throws {
        let rig = try await SignedRig()
        let screenTime = FakeScreenTime(marked: true)
        let enforcer = Enforcer(engine: rig.engine, screenTime: screenTime, clock: rig.clock)
        let enforcing = Task { await enforcer.run() }
        try await rig.signIn(me: Answer.me())
        try await eventually { await screenTime.shielding }

        let deletion = rig.deleting()
        // Nothing queued: the deletion is the first thing sent, and Cognito's the second.
        let delete = try await rig.server.next()
        #expect(delete.route == deleteMeRoute)
        delete.reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        #expect(await rig.server.waiting.isEmpty)

        try await eventually { await !screenTime.shielding }
        #expect(await rig.engine.state.standing == .out)
        #expect(try rig.outbox.standing() == .out)
        #expect(try rig.outbox.records().isEmpty)
        enforcing.cancel()
        await rig.stop()
    }

    @Test(
        "An Emergency Unlock the server has not recorded holds the deletion back — no answer, or refused — kept, never let go, and DELETE /v1/me never sent; recorded, the deletion goes"
    )
    func unlockHolds() async throws {
        let rig = try await SignedRig()
        try await rig.signIn()
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.server.next(unlockRoute).reply(nil)
        await rig.until { $0.retryAt == at(2) }

        for (status, body) in [(nil, ""), (400, Answer.refused("invalid_request"))] as [(Int?, String)] {
            let deletion = rig.deleting()
            try await rig.server.next(unlockRoute).reply(status, body)
            #expect(await deletion.value == .unlockUnsent, "\(String(describing: status))")
            #expect(await rig.server.waiting.isEmpty)
            #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])
        }

        let deletion = rig.deleting()
        try await rig.server.next(unlockRoute).reply(200, Answer.unlocked())
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        await rig.stop()
    }

    @Test(
        "A tap the server refused holds nothing back — it goes once more, refused again — and is let go with the account, which no later send could reach; anything else no answer settles holds the deletion back, said by its last answer"
    )
    func refusedTap() async throws {
        let rig = try await SignedRig()
        try await rig.signIn()
        try await rig.engine.record(.tap(tagId: "tag"))
        let notFound = #"{"error":{"code":"not_found","message":"no such block"}}"#
        try await rig.server.next(tapRoute).reply(404, notFound)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))  // the refusal's re-read
        await rig.until { $0.queued.first?.stuck == true }
        try await rig.engine.record(.refocus(session: "s"))
        try await rig.server.next(refocusRoute).reply(503)
        await rig.until { $0.queued.count == 2 && $0.retryAt != nil }

        var deletion = rig.deleting()
        try await rig.server.next(tapRoute).reply(404, notFound)
        try await rig.server.next(refocusRoute).reply(503)
        #expect(await deletion.value == .notDeleted(.status(503)))
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))  // the tap's re-read, held till now

        deletion = rig.deleting()
        try await rig.server.next(tapRoute).reply(404, notFound)
        try await rig.server.next(refocusRoute).reply(200, Answer.refocused())
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        #expect(try rig.outbox.records().isEmpty)
        #expect(await rig.engine.state.queued.isEmpty)
        await rig.stop()
    }

    @Test(
        "DELETE /v1/me with no answer is tried again under the same event id (rule 4); answered 409 event_id_conflict, once more under a fresh one; a teacher with a class or a block is its own answer, nothing else sent"
    )
    func deletionAnswers() async throws {
        let rig = try await SignedRig()
        try await rig.signIn()
        var deletion = rig.deleting()
        let lost = try await rig.server.next(deleteMeRoute)
        lost.reply(nil)
        #expect(await deletion.value == .notDeleted(.networkError))

        deletion = rig.deleting()
        try await rig.server.next(deleteMeRoute).reply(409, Answer.refused("teacher_has_classes"))
        #expect(await deletion.value == .teacherHasClasses)
        #expect(await rig.server.waiting.isEmpty)

        deletion = rig.deleting()
        let again = try await rig.server.next(deleteMeRoute)
        #expect(again.eventId == lost.eventId)
        again.reply(409, Answer.refused("event_id_conflict"))
        let fresh = try await rig.server.next(deleteMeRoute)
        #expect(fresh.eventId != lost.eventId && fresh.eventId != nil)
        fresh.reply(200, #"{"outcome":"already_deleted"}"#)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        await rig.stop()
    }

    @Test(
        "Cognito's DeleteUser failing after the API deleted the account is said, the sign-in kept, and no request goes to the API meanwhile — a relaunch's sign-in neither; the next press tries DeleteUser alone, until it is done"
    )
    func signInNotDeleted() async throws {
        let rig = try await SignedRig()
        try await rig.signIn()
        var deletion = rig.deleting()
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(nil)
        #expect(await deletion.value == .signInNotDeleted(.networkError))
        #expect(!rig.keychain.isEmpty)
        #expect(await rig.signIn.deletionPending())

        await rig.engine.setForeground(true)
        await rig.until { $0.link == .signIn }
        #expect(await rig.server.waiting.isEmpty)
        let relaunched = SignIn(
            cognito: rig.signIn.cognito, store: rig.keychain, transport: rig.server,
            now: { [clock = rig.clock] in clock.now() })
        #expect(await relaunched.accessToken() == nil)

        deletion = rig.deleting()
        try await rig.server.next(deleteUserRoute).reply(500, #"{"__type":"InternalErrorException"}"#)
        #expect(await deletion.value == .signInNotDeleted(.status(500)))
        deletion = rig.deleting()
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        #expect(rig.keychain.isEmpty)
        #expect(await rig.server.waiting.isEmpty)  // DeleteUser alone: no drain, no deletion again
        await rig.stop()
    }

    @Test(
        "What the loops have on its way when Delete account is pressed lands before anything of the deletion goes: a read of the truth unanswered holds it, then it goes"
    )
    func waitsOutTheLoops() async throws {
        let rig = try await SignedRig()
        try await rig.signStudentIn(scoped("a1"))
        let read = try await rig.server.next(meRoute)
        let deletion = rig.deleting()
        try await Task.sleep(for: .milliseconds(200))
        #expect(await rig.server.waiting.isEmpty)  // nothing of the deletion while the read is out
        read.reply(200, Answer.me(nil))
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        await rig.stop()
    }

    @Test(
        "A record the drain has on its way when Delete account is pressed lands before anything of the deletion goes, never sent twice; and while the deletion runs the drain sends nothing — a record made meanwhile goes with the account"
    )
    func drainHeld() async throws {
        let rig = try await SignedRig()
        try await rig.signIn(me: Answer.me())
        await rig.until { $0.standing == .inSession(session(), .focused) }
        try await rig.engine.emergencyUnlock()
        let onItsWay = try await rig.server.next(unlockRoute)
        let deletion = rig.deleting()
        try await Task.sleep(for: .milliseconds(200))
        try #require(await rig.server.waiting.isEmpty)  // neither the unlock again nor the deletion
        onItsWay.reply(200, Answer.unlocked())
        let delete = try await rig.server.next(deleteMeRoute)
        try await rig.engine.record(.protectionOff(session: "s"))
        try await Task.sleep(for: .milliseconds(200))
        try #require(await rig.server.waiting.isEmpty)  // the drain holds it
        delete.reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        #expect(try rig.outbox.records().isEmpty)
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test(
        "A check-in on its way when Delete account is pressed lands before anything of the deletion goes"
    )
    func checkInLands() async throws {
        let rig = try await SignedRig()
        try await rig.signIn(me: Answer.me())
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(200, Answer.me())
        try await eventually { rig.clock.deadlines.contains(at(30)) }
        rig.clock.advance(by: 30)
        let checkIn = try await rig.server.next(checkInRoute)
        let deletion = rig.deleting()
        try await Task.sleep(for: .milliseconds(200))
        #expect(await rig.server.waiting.isEmpty)
        checkIn.reply(200, Answer.live())
        try await rig.server.next(deleteMeRoute).reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await deletion.value == .deleted)
        await rig.stop()
    }

    @Test(
        "An outbox file that cannot be read holds the deletion back — whether an unlock waits is not known — with nothing sent and the sign-in kept"
    )
    func unread() async throws {
        let rig = try await SignedRig()
        try await rig.signIn()
        try await rig.outbox.pool.write { try $0.execute(sql: "ALTER TABLE outbox RENAME TO gone") }
        #expect(await rig.engine.deleteAccount(rig.signIn) == .unread)
        #expect(await rig.server.waiting.isEmpty)
        #expect(await rig.signIn.mayDelete())
        try await rig.outbox.pool.write { try $0.execute(sql: "ALTER TABLE gone RENAME TO outbox") }
        await rig.stop()
    }

    @Test(
        "Pressed again while a deletion is under way, the press shares its answer: one DELETE /v1/me and one DeleteUser — never a second deletion beside the first, whose end would let the loops go while the other's is on its way"
    )
    func pressedTwice() async throws {
        let rig = try await SignedRig()
        try await rig.signIn()
        let (first, second) = (rig.deleting(), rig.deleting())
        let delete = try await rig.server.next(deleteMeRoute)
        try await Task.sleep(for: .milliseconds(200))
        // No second deletion on its way — it would have sent its own by now, and waited for an
        // answer no one gives: required, so the test ends there rather than waits on it.
        try #require(await rig.server.waiting.isEmpty)
        delete.reply(200, deletedAnswer)
        try await rig.server.next(deleteUserRoute).reply(200, "{}")
        #expect(await first.value == .deleted)
        #expect(await second.value == .deleted)
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }
}

@Suite("The outbox before an account deletion (C4)")
struct DeletionOrderTests {
    @Test(
        "Every Emergency Unlock goes first — but one under a tap still queued, which goes after it — then the rest in the order the phone acted: a refocus waits for its unlock, an unlock not filed goes nowhere, and a record tried and still pending holds those behind it"
    )
    func order() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        let underTap = try record(outbox, .unlockUnderTap(tap: tap.eventId, reason: nil))
        let off = try record(outbox, .protectionOff(session: "s"))
        try record(outbox, .unlockUnfiled(reason: nil))
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        let refocus = try record(outbox, .refocus(session: "s"))
        #expect(refocus.follows == unlock.eventId)

        var tried: Set<String> = []
        func next() throws -> String? {
            let record = try outbox.nextBeforeDeletion(tried: tried)
            if let record { tried.insert(record.eventId) }
            return record?.eventId
        }
        #expect(try next() == unlock.eventId)
        #expect(try next() == tap.eventId)  // the refocus waits for its unlock, still queued
        try await send(outbox, tap, 200, Answer.joined())
        #expect(try next() == underTap.eventId)  // its tap gone, filed in its session
        try await send(outbox, try #require(try current(outbox, underTap.eventId)), 200, Answer.unlocked())
        try await send(outbox, unlock, 200, Answer.unlocked())
        #expect(try next() == off.eventId)
        try await send(outbox, off, 200, Answer.protectionOff())
        #expect(try next() == refocus.eventId)
        try await send(outbox, refocus, 200, Answer.refocused())
        #expect(try next() == nil)  // the unlock not filed goes nowhere

        // Tried and still pending, a record holds what the phone did after it.
        let (held, _) = try makeOutbox()
        let first = try record(held, .protectionOff(session: "s"))
        try record(held, .refocus(session: "s"))
        #expect(try held.nextBeforeDeletion(tried: [first.eventId]) == nil)
    }

    @Test(
        "Once the API has deleted the account, every record queued is let go but an Emergency Unlock, which never is"
    )
    func letGo() throws {
        let (outbox, _) = try makeOutbox()
        try record(outbox, .tap(tagId: "tag"))
        try record(outbox, .protectionOff(session: "s"))
        let unlock = try record(outbox, .unlock(session: "s", reason: nil))
        try record(outbox, .refocus(session: "s"))
        try outbox.accountDeleted()
        #expect(try outbox.records().map(\.eventId) == [unlock.eventId])
    }
}
