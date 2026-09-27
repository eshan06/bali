import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// The screen for what the phone knows at `now`: the intro seen, signed in, the permission approved
/// and the engine standing `standing` with `queued`, unless said otherwise — nil for a sign-in, an
/// enforcer or an engine that has not spoken.
private func screen(
    problem: String? = nil, introSeen: Bool = true, signedIn: Bool? = true,
    permission: Permission? = .approved, standing: Standing? = .out, queued: [OutboxRecord] = [],
    hasClasses: Bool? = nil, lastSessionOver: SessionView? = nil, now: Date = t0
) -> Screen {
    var protection: Protection?
    if let permission {
        protection = Protection()
        protection?.permission = permission
    }
    var sync: SyncState?
    if let standing {
        sync = SyncState()
        sync?.standing = standing
        sync?.queued = queued
    }
    return Screen.choose(
        problem: problem, introSeen: introSeen, signedIn: signedIn, protection: protection,
        sync: sync, hasClasses: hasClasses, lastSessionOver: lastSessionOver, now: now)
}

@Suite("Which screen the app shows (C1a)")
struct ScreenTests {
    @Test(
        "Nothing known yet — the sign-in, the enforcer or the engine silent — is starting; the intro not seen comes before any of it"
    )
    func starting() {
        #expect(screen(signedIn: nil) == .starting)
        #expect(screen(permission: nil) == .starting)
        #expect(screen(standing: nil) == .starting)
        #expect(screen(introSeen: false, signedIn: nil, permission: nil, standing: nil) == .intro)
    }

    @Test("The app could not start: storage, with why, over everything else")
    func storage() {
        let why = "The outbox could not be opened"
        #expect(
            screen(problem: why, introSeen: false, signedIn: nil, permission: nil, standing: nil)
                == .storage(why))
        #expect(screen(problem: why, standing: .inSession(session(), .focused)) == .storage(why))
    }

    @Test(
        "Onboarding, in order: the intro not seen; then not signed in; then the permission not approved — denied or not determined — whatever the phone stands in"
    )
    func onboarding() {
        #expect(screen(introSeen: false) == .intro)
        #expect(screen(introSeen: false, signedIn: false) == .intro)
        #expect(screen(signedIn: false) == .signIn)
        #expect(screen(signedIn: false, permission: .notDetermined) == .signIn)
        #expect(screen(permission: .notDetermined) == .screenTime)
        #expect(screen(permission: .denied) == .screenTime)
        #expect(screen(permission: .denied, standing: .inSession(session(), .focused)) == .screenTime)
    }

    @Test(
        "In a session: focused, unlocked and protection off have their screens; a state this build does not know is home — never focus, never unlocked"
    )
    func inSession() {
        #expect(screen(standing: .inSession(session(), .focused)) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked)) == .unlocked)
        #expect(screen(standing: .inSession(session(), .protectionOff)) == .protectionOff)
        #expect(screen(standing: .inSession(session(), nil)) == .home)
    }

    @Test("Where the phone stood not read yet: home. Waiting for the teacher's Start: waiting")
    func unreadAndWaiting() {
        #expect(screen(standing: .unread) == .home)
        #expect(screen(standing: .waiting) == .waiting)
    }

    @Test(
        "Out of any session: home — join once the phone knows it has no classes, and session over while one just ended, whatever its classes; only out"
    )
    func out() {
        #expect(screen() == .home)
        #expect(screen(hasClasses: true) == .home)
        #expect(screen(hasClasses: false) == .join)
        #expect(screen(lastSessionOver: session()) == .sessionOver)
        #expect(screen(hasClasses: false, lastSessionOver: session()) == .sessionOver)
        #expect(screen(standing: .waiting, lastSessionOver: session()) == .waiting)
        #expect(screen(standing: .unread, hasClasses: false) == .home)
    }

    @Test(
        "A tap not yet answered holds the shields on, so focus, whatever the phone stood in — to its cap; not once the student unlocked after it (decision 11), nor once it is refused"
    )
    func pendingTap() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        let held = try outbox.records()
        let standings: [Standing] = [
            .out, .waiting, .unread, .inSession(session(), .unlocked), .inSession(session(), nil),
        ]
        for standing in standings {
            #expect(screen(standing: standing, queued: held) == .focus, "\(standing)")
        }
        #expect(screen(queued: held, now: at(SyncState.tapCap - 1)) == .focus)
        #expect(screen(queued: held, now: at(SyncState.tapCap)) == .home)
        let unlocked = Standing.inSession(session(), .unlocked)
        #expect(screen(standing: unlocked, queued: held, now: at(SyncState.tapCap)) == .unlocked)
        try record(outbox, .unlockUnderTap(tap: tap.eventId, reason: nil))
        let unlockedAfter = try outbox.records()
        #expect(screen(queued: unlockedAfter) == .home)
        #expect(screen(standing: unlocked, queued: unlockedAfter) == .unlocked)
        let (refused, _) = try makeOutbox()
        let refusedTap = try record(refused, .tap(tagId: "tag"))
        try await send(refused, refusedTap, 409, Answer.refused("session_not_running"))
        let stuck = try refused.records()
        #expect(stuck.first?.stuck == true)
        #expect(screen(queued: stuck) == .home)
    }

    @Test(
        "What the Sign in screen says of a sign-in that did not finish: its kind in plain words and another try — nothing for one the student closed"
    )
    func words() {
        #expect(SignInError.cancelled.words == nil)
        #expect(
            SignInError.unreachable.words
                == "Can't reach the sign-in server. Check your connection and try again.")
        #expect(
            SignInError.refused("access_denied").words
                == "The sign-in was refused (access_denied). Try again, or ask your teacher.")
        #expect(
            SignInError.refused(nil).words
                == "The sign-in was refused. Try again, or ask your teacher.")
        #expect(SignInError.notKept.words == "Your phone couldn't keep the sign-in. Try again.")
    }
}
