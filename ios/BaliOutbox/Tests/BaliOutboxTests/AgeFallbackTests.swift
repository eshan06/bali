import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

// The gap's fallback (C7; the owner's decision, 2026-10-06): a sign-in made around the 13+
// question — on Cognito's own pages, whose sign-in page links to its sign-up — over the engine as
// the app makes it, the sign-in's `cleared` the phone's check, and the API and Cognito answered by
// hand.

/// Whether the phone's 13+ check has passed, as the test sets it.
final class Passed: @unchecked Sendable {
    private let lock = NSLock()
    private var passed = false
    var value: Bool {
        get { lock.withLock { passed } }
        set { lock.withLock { passed = newValue } }
    }
}

@Suite("A sign-in around the 13+ question (C7's fallback)", .timeLimit(.minutes(3)))
struct AgeFallbackTests {
    @Test(
        "Until the phone's 13+ check passes, a sign-in reaches Bali's API with nothing: no read of the truth, no record sent, each kept and waiting on the sign-in; once it passes, everything goes at once under the sign-in's token"
    )
    func nothingBeforeTheAnswer() async throws {
        let passed = Passed()
        let rig = try await SignedRig(cleared: { passed.value })
        let unlock = try #require(try await rig.engine.record(.unlock(session: "s", reason: nil)))
        try await rig.signStudentIn(accessToken("a1"))
        // The sign-in sends everything and reads the truth at once: each finds no token to send.
        await rig.until { $0.link == .signIn && $0.meFailed == .networkError }
        #expect(await rig.server.waiting.isEmpty)
        #expect(try rig.outbox.records().map(\.eventId) == [unlock.eventId])

        passed.value = true
        await rig.engine.retryNow()
        let sent = try await rig.server.next(unlockRoute)
        #expect(sent.eventId == unlock.eventId && sent.token == "Bearer \(accessToken("a1"))")
        let read = try await rig.server.next(meRoute)
        #expect(read.token == "Bearer \(accessToken("a1"))")
        await rig.stop()
    }

    @Test(
        "Answered under 13, the account goes as Delete account deletes one (C4), the check not passed: what the phone queued goes first under the deletion's own token, every Emergency Unlock first — one the server has not recorded holds the deletion back, never let go — then DELETE /v1/me, then Cognito's DeleteUser; nothing is left in the outbox, so the next sign-in on this phone files nothing under its own account (Claude Review's blocker)"
    )
    func deletedUnderThirteen() async throws {
        let passed = Passed()
        let rig = try await SignedRig(cleared: { passed.value })
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

        // Another student signs in on this phone, past the check: nothing of the last one's goes.
        passed.value = true
        try await rig.signStudentIn(accessToken("b1"))
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        await rig.until { $0.me != nil }
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }
}
