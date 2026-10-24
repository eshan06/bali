import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

let pushRoute = "PUT /v1/me/push-token"
let pushRemoveRoute = "DELETE /v1/me/push-token"

/// A device token as iOS gives it, 32 bytes: a leading zero nibble, letters and digits — and the
/// hex Bali's API takes it as (N3).
let deviceToken = Data([0x0a, 0xbc, 0xde, 0xf0] + Array(repeating: 0xff, count: 27) + [0x01])
let deviceTokenHex = "0abcdef0" + String(repeating: "ff", count: 27) + "01"

/// The class-started alert's app half (ARCHITECTURE, "Push: a doorbell for students"): the wait
/// before the read after the alert (the owner's approved fix, DECISIONS 2026-10-22), Home's waiting
/// card meanwhile (the app canvas's option B; Waiting's words are the app's tests'), and the device
/// token's register and removal.
@Suite("The class-started alert", .timeLimit(.minutes(3)))
struct PushTests {
    @Test(
        "The wait: drawn uniformly from 0 to 10 s for an alert that came within a minute of the open — one whose clock was set back since too — and none for an older one, which reads at once"
    )
    func wait() {
        for draw in stride(from: 0.0, through: 1.0, by: 0.125) {
            #expect(PushWait.until(delivered: t0, now: t0, draw: draw) == t0 + 10 * draw, "\(draw)")
        }
        #expect(PushWait.until(delivered: at(-60), now: t0, draw: 1) == at(10))
        #expect(PushWait.until(delivered: at(-5), now: t0, draw: 0.25) == at(2.5))
        #expect(PushWait.until(delivered: at(30), now: t0, draw: 0.5) == at(5))
        #expect(PushWait.until(delivered: at(-60.001), now: t0, draw: 0.5) == nil)
        #expect(PushWait.until(delivered: at(-3600), now: t0, draw: 0) == nil)
    }

    @Test(
        "Opened from a fresh alert, the read of the truth waits for the hold — the loop sleeps on it, nothing read a moment before — while Waiting and Home say Bali is checking in, until that read lands: the Start found, the phone in class"
    )
    func heldRead() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
        await rig.engine.holdRead(until: at(7))
        await rig.engine.setForeground(true)
        let checking = await rig.until { $0.checkingIn }
        #expect(
            checking.waitingCard
                == "You're tapped in. Your apps lock in a few seconds, as long as Bali is open.")
        try await rig.sleeping([at(7)])
        rig.clock.advance(by: 6.9)
        try await rig.sleeping([at(7)])
        #expect(await rig.server.waiting.isEmpty)
        rig.clock.advance(by: 0.1)
        let read = try await rig.server.next(meRoute)
        #expect(await rig.engine.state.checkingIn, "on its way, still checking in")
        read.reply(200, Answer.me(armed: false))
        let started = await rig.until { !$0.checkingIn }
        #expect(started.standing == .inSession(session(), .focused))
        // Then as without the alert: the next read is the check-in, 30 s on.
        try await rig.sleeping([at(37)])
        await rig.stop()
    }

    @Test(
        "A held read that fails ends the check, the failure said with its Try again — Waiting's own words back; a failure from before the alert is not said while Bali checks in"
    )
    func heldReadFails() async throws {
        let rig = try Rig()
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(nil)
        await rig.until { $0.meFailed != nil }
        await rig.engine.holdRead(until: at(3))
        let checking = await rig.until { $0.checkingIn }
        #expect(checking.meFailed == nil && checking.meWords == nil)
        rig.clock.advance(by: 3)
        try await rig.server.next(meRoute).reply(nil)
        let failed = await rig.until { !$0.checkingIn }
        #expect(failed.meFailed == .networkError && failed.meWords != nil)
        await rig.stop()
    }

    @Test(
        "The phone's clock turned back during the hold never stretches it: a wake that finds the hold more than 10 s ahead reads at once (santa's round 1)"
    )
    func clockTurnedBack() async throws {
        let rig = try Rig()
        await rig.engine.holdRead(until: at(5))
        await rig.engine.setForeground(true)
        try await rig.sleeping([at(5)])
        rig.clock.turn(by: -60)
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        let read = await rig.until { !$0.checkingIn }
        #expect(read.me != nil && rig.clock.now() == at(-60))
        await rig.stop()
    }

    @Test(
        "No alert, no wait: back in front, the truth is read at once, and nothing says Bali is checking in"
    )
    func noAlert() async throws {
        let rig = try Rig()
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        let read = await rig.until { $0.me != nil }
        #expect(!read.checkingIn && rig.clock.now() == t0)
        await rig.stop()
    }

    @Test(
        "The student's own action never waits on the hold, and ends it: a tap goes at once and the truth is read at once; in class, Emergency Unlock takes the shields off at once and its record goes, never held; Back to home or Try again (`endWait`) reads at once"
    )
    func actionsEndTheWait() async throws {
        // A tap.
        var rig = try Rig()
        await rig.engine.holdRead(until: at(9))
        await rig.engine.setForeground(true)
        try await rig.sleeping([at(9)])
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        try await rig.server.next(meRoute).reply(200, Answer.me())
        #expect(rig.clock.now() == t0)
        await rig.stop()
        // Emergency Unlock, in class: the press, as the screens make it, and the record it queues.
        rig = try Rig()
        try await rig.tapIn()
        try await rig.foreground()
        await rig.engine.holdRead(until: at(9))
        try await rig.sleeping([at(9)])
        #expect(await rig.engine.pressUnlock() == nil)
        #expect(await rig.engine.state.standing == .inSession(session(), .unlocked))
        try await rig.server.next(meRoute).reply(200, Answer.me(state: "unlocked"))
        await rig.stop()
        rig = try Rig()
        try await rig.tapIn()
        await rig.engine.holdRead(until: at(9))
        try await rig.engine.emergencyUnlock()
        try await rig.server.next(unlockRoute).reply(200, Answer.unlocked())
        #expect(rig.clock.now() == t0)
        await rig.stop()
        // Back to home, or Try again.
        rig = try Rig()
        await rig.engine.holdRead(until: at(9))
        await rig.engine.setForeground(true)
        try await rig.sleeping([at(9)])
        await rig.engine.endWait()
        try await rig.server.next(meRoute).reply(200, Answer.me(nil))
        #expect(rig.clock.now() == t0)
        await rig.stop()
    }

    @Test(
        "The device token goes at once — after the read the alert held, never before it — as lower-case hex, under the environment it was given and a fresh lower-case UUIDv7, under the student's token, once"
    )
    func registers() async throws {
        var rig = try Rig()
        await rig.engine.registerPushToken(deviceToken, environment: .production)
        let put = try await rig.server.next(pushRoute)
        let sent = try JSONDecoder().decode(
            RegisterPushTokenRequest.self, from: try #require(put.request.httpBody))
        #expect(sent.token == deviceTokenHex && sent.environment == .production)
        #expect(sent.eventId.wholeMatch(of: RecordTests.uuidV7) != nil, "\(sent.eventId)")
        #expect(put.token == "Bearer token-1")
        put.reply(200, #"{"outcome":"registered","environment":"production"}"#)
        await rig.stop()
        // Opened from the alert: after its held read.
        rig = try Rig()
        await rig.engine.holdRead(until: at(5))
        await rig.engine.registerPushToken(deviceToken, environment: .sandbox)
        await rig.engine.setForeground(true)
        try await rig.sleeping([at(5)])
        #expect(await rig.server.waiting.isEmpty)
        rig.clock.advance(by: 5)
        // In a class, so each wake in front reads the truth (C3c).
        let inClass = Answer.me(nil, classes: [Answer.inClass("c")])
        try await rig.server.next(meRoute).reply(200, inClass)
        let after = try await rig.server.next(pushRoute)
        let held = try JSONDecoder().decode(
            RegisterPushTokenRequest.self, from: try #require(after.request.httpBody))
        #expect(held.token == deviceTokenHex && held.environment == .sandbox)
        after.reply(200, #"{"outcome":"replay","environment":"sandbox"}"#)
        // Once: the next read sends it no more.
        try await rig.sleeping([at(35)])
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute).reply(200, inClass)
        try await rig.sleeping([at(65)])
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test(
        "Sign out's removal goes at once, under the student's token: the token as lower-case hex, under a fresh lower-case UUIDv7"
    )
    func removes() async throws {
        let rig = try Rig()
        let removal = Task { await rig.engine.removePushToken(deviceToken) }
        let delete = try await rig.server.next(pushRemoveRoute)
        let sent = try JSONDecoder().decode(
            RemovePushTokenRequest.self, from: try #require(delete.request.httpBody))
        #expect(sent.token == deviceTokenHex)
        #expect(sent.eventId.wholeMatch(of: RecordTests.uuidV7) != nil, "\(sent.eventId)")
        #expect(delete.token == "Bearer token-1")
        delete.reply(200, #"{"outcome":"removed"}"#)
        await removal.value
        await rig.stop()
    }

    @Test(
        "Home's waiting card while Bali checks in after the alert is the app canvas's option B, exactly — never that the apps are locked — and its own otherwise; only while waiting"
    )
    func words() {
        var state = SyncState()
        state.standing = .waiting
        #expect(
            state.waitingCard
                == "You're tapped in. Your phone locks when class starts, as long as Bali is open.")
        state.checkingIn = true
        #expect(
            state.waitingCard
                == "You're tapped in. Your apps lock in a few seconds, as long as Bali is open.")
        for standing in [Standing.out, .unread, .inSession(session(), .focused)] {
            state.standing = standing
            #expect(state.waitingCard == nil, "\(standing)")
        }
    }
}
