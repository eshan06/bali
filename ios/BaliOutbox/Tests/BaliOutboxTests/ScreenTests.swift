import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// The screen for what the phone knows at `now`: the intro seen, signed in, the permission approved
/// and checked (never read approved before, `everApproved`), the engine standing `standing` with
/// `queued`, and Home's tab chosen, unless said otherwise — nil for a sign-in, an enforcer or an
/// engine that has not spoken.
private func screen(
    problem: String? = nil, introSeen: Bool = true, signedIn: Bool? = true,
    permission: Permission? = .approved, checked: Bool = true, shielded: Bool = false,
    everApproved: Bool = false, standing: Standing? = .out, queued: [OutboxRecord] = [],
    hasClasses: Bool? = nil, lastSessionOver: SessionView? = nil, opened: [Screen] = [],
    tab: Screen = .home, now: Date = t0
) -> Screen {
    var protection: Protection?
    if let permission {
        protection = Protection()
        protection?.permission = permission
        protection?.checked = checked
        protection?.shielded = shielded
    }
    var sync: SyncState?
    if let standing {
        sync = SyncState()
        sync?.standing = standing
        sync?.queued = queued
    }
    return Screen.choose(
        problem: problem, introSeen: introSeen, signedIn: signedIn, protection: protection,
        everApproved: everApproved, sync: sync, hasClasses: hasClasses,
        lastSessionOver: lastSessionOver, opened: opened, tab: tab, now: now)
}

/// A session whose bell is a thousand seconds ahead of `t0`'s cap.
private let later = session(endsAt: 4000)

@Suite("Which screen the app shows (C1a)")
struct ScreenTests {
    @Test(
        "Nothing known yet — the sign-in, the enforcer or the engine silent, or the enforcer's first pass not made — is starting; the intro not seen comes before any of it"
    )
    func starting() {
        #expect(screen(signedIn: nil) == .starting)
        #expect(screen(permission: nil) == .starting)
        #expect(screen(checked: false) == .starting)
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
        "Onboarding, in order: the intro not seen; then not signed in; then the permission not approved — denied or not determined — out of any running session"
    )
    func onboarding() {
        #expect(screen(introSeen: false) == .intro)
        #expect(screen(introSeen: false, signedIn: false) == .intro)
        #expect(screen(signedIn: false) == .signIn)
        #expect(screen(signedIn: false, permission: .notDetermined) == .signIn)
        #expect(screen(permission: .notDetermined) == .screenTime)
        #expect(screen(permission: .denied) == .screenTime)
        #expect(screen(permission: .denied, standing: .waiting) == .screenTime)
        #expect(screen(permission: .denied, hasClasses: false) == .screenTime)
    }

    @Test(
        "The shields on — focused in a session the phone's clock says still runs, or a tap held — is focus before the intro, the sign-in and the permission: the focus screen holds Emergency Unlock, always allowed. Once they are off, those rules again"
    )
    func shieldedFirst() throws {
        let focused = Standing.inSession(session(), .focused)
        #expect(screen(signedIn: false, standing: focused) == .focus)
        #expect(screen(introSeen: false, signedIn: nil, permission: nil, standing: focused) == .focus)
        #expect(screen(permission: .denied, standing: focused) == .focus)
        #expect(screen(permission: .notDetermined, checked: false, standing: focused) == .focus)
        let (outbox, _) = try makeOutbox()
        try record(outbox, .tap(tagId: "tag"))
        let held = try outbox.records()
        #expect(screen(signedIn: false, queued: held) == .focus)
        #expect(screen(introSeen: false, permission: .denied, queued: held) == .focus)
        #expect(screen(signedIn: false, queued: held, now: at(SyncState.tapCap)) == .signIn)
        #expect(screen(signedIn: false, standing: focused, now: at(3000)) == .signIn)
        #expect(screen(signedIn: false, standing: .inSession(session(), .unlocked)) == .signIn)
        #expect(screen(introSeen: false, standing: .inSession(session(), .unlocked)) == .intro)
    }

    @Test(
        "In a running session: unlocked and protection off have their screens, whatever the permission reads — taken back mid-session, the check reports protection off, whose screen says how back; a state this build does not know is home — never focus, never unlocked"
    )
    func inSession() {
        #expect(screen(standing: .inSession(session(), .focused)) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked)) == .unlocked)
        #expect(screen(standing: .inSession(session(), .protectionOff)) == .protectionOff)
        #expect(screen(standing: .inSession(session(), nil)) == .home)
        #expect(screen(permission: .denied, standing: .inSession(session(), .unlocked)) == .unlocked)
        #expect(
            screen(permission: .denied, standing: .inSession(session(), .protectionOff))
                == .protectionOff)
        #expect(screen(permission: .notDetermined, standing: .inSession(session(), nil)) == .home)
    }

    @Test(
        "The bell rung by the phone's own clock (decision 6), no read yet: the shields are off, so home — never focus, unlocked or protection off over them — and Screen Time when the permission is not approved; a second before it, the session's screen"
    )
    func bellRung() {
        for state in [ParticipationState.focused, .unlocked, .protectionOff] {
            let standing = Standing.inSession(session(), state)
            #expect(screen(standing: standing, now: at(3000)) == .home, "\(state)")
            #expect(screen(standing: standing, now: at(9000)) == .home, "\(state)")
            #expect(
                screen(permission: .denied, standing: standing, now: at(3000)) == .screenTime,
                "\(state)")
        }
        #expect(screen(standing: .inSession(session(), .focused), now: at(2999)) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked), now: at(2999)) == .unlocked)
        #expect(
            screen(standing: .inSession(session(), .protectionOff), now: at(2999)) == .protectionOff)
        #expect(
            screen(standing: .inSession(session(), .focused), hasClasses: false, now: at(3000))
                == .home)
    }

    @Test(
        "Where the phone stood not read yet: home, whatever the permission reads — Emergency Unlock works there — and, the last run's shields found on, before the intro and the sign-in too (B6b). Waiting for the teacher's Start: waiting"
    )
    func unreadAndWaiting() {
        #expect(screen(standing: .unread) == .home)
        #expect(screen(permission: .denied, standing: .unread) == .home)
        #expect(screen(signedIn: false, shielded: true, standing: .unread) == .home)
        #expect(screen(introSeen: false, checked: false, shielded: true, standing: .unread) == .home)
        #expect(screen(signedIn: false, standing: .unread) == .signIn)
        #expect(screen(signedIn: false, shielded: true) == .signIn)
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
        "The screens the student opened over another (C3), in order: Join over Home — wherever Home is chosen, past the bell too — and Home over Waiting, then Join over that Home (santa's round 1: Join fell back to Waiting there); each only over the one under it, so never over anything else: the shields, a session's own screens, session over, Screen Time, the sign-in, the intro, nor the home the last run's shields keep over a standing not read (B6b)"
    )
    func opened() {
        #expect(screen(hasClasses: true, opened: [.join]) == .join)
        #expect(screen(opened: [.join]) == .join)
        let rung = Standing.inSession(session(), .focused)
        #expect(screen(standing: rung, opened: [.join], now: at(3000)) == .join)
        #expect(screen(standing: .waiting, opened: [.home]) == .home)
        #expect(screen(standing: .waiting, opened: [.home, .join]) == .join)
        #expect(screen(standing: .waiting, opened: [.join]) == .waiting)
        #expect(screen(standing: .waiting, opened: [.join, .home]) == .waiting)
        #expect(screen(opened: [.join, .join]) == .join)
        #expect(screen(hasClasses: false, opened: [.home]) == .join)
        #expect(screen(hasClasses: true, opened: [.focus]) == .home)
        #expect(screen(standing: .inSession(session(), .focused), opened: [.join]) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked), opened: [.join]) == .unlocked)
        #expect(screen(lastSessionOver: session(), opened: [.join]) == .sessionOver)
        #expect(screen(permission: .denied, standing: .waiting, opened: [.home]) == .screenTime)
        #expect(screen(signedIn: false, opened: [.join]) == .signIn)
        #expect(screen(introSeen: false, opened: [.join]) == .intro)
        #expect(
            screen(signedIn: false, shielded: true, standing: .unread, opened: [.join]) == .home)
    }

    @Test(
        "D1's tab bar (C6a): History or Me in place of the router's own Home — out, not read, past the bell, a state not known — and Home's tab is Home; nowhere else: never over the shields, a session's screens, Waiting or a Home opened over it, Join (its own, or opened over Home), session over, Screen Time, the sign-in, the intro, starting, nor the home the last run's shields keep over a standing not read (B6b)"
    )
    func tabs() {
        for tab in [Screen.history, .me] {
            #expect(screen(tab: tab) == tab)
            #expect(screen(hasClasses: true, tab: tab) == tab)
            #expect(screen(standing: .unread, tab: tab) == tab)
            let rung = Standing.inSession(session(), .focused)
            #expect(screen(standing: rung, tab: tab, now: at(3000)) == tab)
            #expect(screen(standing: .inSession(session(), nil), tab: tab) == tab)
            #expect(screen(standing: .inSession(session(), .focused), tab: tab) == .focus)
            #expect(screen(standing: .inSession(session(), .unlocked), tab: tab) == .unlocked)
            let off = Standing.inSession(session(), .protectionOff)
            #expect(screen(standing: off, tab: tab) == .protectionOff)
            #expect(screen(standing: .waiting, tab: tab) == .waiting)
            #expect(screen(standing: .waiting, opened: [.home], tab: tab) == .home)
            #expect(screen(opened: [.join], tab: tab) == .join)
            #expect(screen(hasClasses: false, tab: tab) == .join)
            #expect(screen(lastSessionOver: session(), tab: tab) == .sessionOver)
            #expect(screen(permission: .denied, tab: tab) == .screenTime)
            #expect(screen(signedIn: false, tab: tab) == .signIn)
            #expect(screen(introSeen: false, tab: tab) == .intro)
            #expect(screen(signedIn: nil, tab: tab) == .starting)
            #expect(screen(signedIn: false, shielded: true, standing: .unread, tab: tab) == .home)
            #expect(screen(shielded: true, standing: .unread, tab: tab) == .home)
        }
        #expect(screen(tab: .home) == .home)
        // Only Home's neighbours are tabs: anything else chosen changes nothing.
        #expect(screen(tab: .focus) == .home && screen(tab: .join) == .home)
    }

    @Test(
        "A screen opened over another stays open while where the phone stands holds — the classes read, the link, a failed read change nothing, nor a tap sent again — and closes once the standing changes, a tap is made or answered, or, out, the phone knows it has no classes: Join is the router's own then, with no way back (C3; santa's rounds 1 and 2: never while waiting, whose screen is Waiting's whatever the classes)"
    )
    func keepsOpened() async throws {
        var before = SyncState()
        before.standing = .waiting
        var after = before
        (after.link, after.meFailed, after.heardAt) = (.unreachable, .networkError, t0)
        #expect(after.keepsOpened(from: before))
        after.me = try BaliJSON.makeDecoder().decode(
            MeResponse.self, from: Data(Answer.me(nil, classes: [Answer.inClass("c")]).utf8))
        #expect(after.keepsOpened(from: before))
        // No classes while waiting — an armed tap needs no enrollment — is still Waiting's: the
        // Home and Join opened over it stay (santa's round 2). Only out is Join the router's own.
        let none = try BaliJSON.makeDecoder().decode(
            MeResponse.self, from: Data(Answer.me(nil).utf8))
        after.me = none
        #expect(after.hasClasses == false && after.keepsOpened(from: before))
        var out = SyncState()
        (out.standing, out.me) = (.out, none)
        var outBefore = out
        outBefore.me = nil
        #expect(!out.keepsOpened(from: outBefore) && outBefore.keepsOpened(from: outBefore))
        after.me = nil
        after.standing = .out
        #expect(!after.keepsOpened(from: before) && !before.keepsOpened(from: nil))
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        var tapped = before
        tapped.queued = try outbox.records()
        #expect(!tapped.keepsOpened(from: before) && !before.keepsOpened(from: tapped))
        try await send(outbox, tap, 503)
        var retried = tapped
        retried.queued = try outbox.records()
        #expect(retried.queued.first?.attempts == 1 && retried.keepsOpened(from: tapped))
    }

    @Test(
        "What Home says of a scan that recorded no tap (C3), each with the way on — not a Bali block, a phone that cannot read one, a scan that did not finish, a tap the phone could not save — and nothing for a block's code, the tap, nor for a scan the student closed; what Home and Waiting say while `GET /v1/me` gives no answer, in the Join screen's words"
    )
    func homeWords() {
        #expect(BlockRead.block("T7XK2M9QPF").words == nil && BlockRead.cancelled.words == nil)
        #expect(
            BlockRead.notBali.words
                == "That isn't a Bali block. Hold your phone to your teacher's block.")
        #expect(
            BlockRead.unsupported.words
                == "This iPhone can't read Bali blocks, so it can't tap in. Ask your teacher.")
        #expect(
            BlockRead.failed("A scan is under way.").words == "The scan didn't finish. Try again.")
        #expect(BlockRead.notKept == "Your phone couldn't save the tap. Try again.")
        var state = SyncState()
        #expect(state.meWords == nil)
        state.meFailed = .networkError
        #expect(state.meWords == "Can't reach the server. Check your connection and try again.")
        state.meFailed = .status(503)
        #expect(state.meWords == "Something went wrong at Bali. Try again in a moment.")
    }

    @Test(
        "What Waiting promises (the owner's ruling, 2026-09-29): the phone locks when class starts only while Bali is open — armed, nothing is shielded, and the phone finds the Start by reading it, every 30 s in the foreground (decision 6) — never D1's 'the moment class starts'. The screen's own source is read, so a redraw cannot bring D1's words back unnoticed"
    )
    func waitingWords() throws {
        let waiting = try sourceCode("Bali/UI/WaitingView.swift")
        #expect(
            waiting.contains(
                #""You tapped your teacher's block before class started. Your phone locks when class starts, as long as Bali is open. No need to tap again.""#
            ))
        #expect(!waiting.contains("the moment class starts"))
    }

    @Test(
        "A stuck tap whose last answer the outbox only retries — 401, 408, 429: a sign-in to renew, a timeout, a limit — is still being sent where the retry bound stuck it, never 'tap in again' while it is on its way (#114's review); where a refusal stuck it, a retry's answer says nothing new and the refusal's words stand (santa's review)"
    )
    func retriedTap() async throws {
        for status in [401, 408, 429] {
            let (unsettled, _) = try makeOutbox()
            let lost = try record(unsettled, .tap(tagId: "tag"))
            for _ in 1...Outbox.bound { try await send(unsettled, lost, 503) }
            try await send(unsettled, lost, status)
            var state = SyncState()
            state.queued = try unsettled.records()
            #expect(state.queued.first?.stuck == true && state.queued.first?.lastStatus == status)
            #expect(
                state.refusedTapWords == "Bali couldn't record a tap yet. It keeps trying.",
                "\(status)")
            let (outbox, _) = try makeOutbox()
            let tap = try record(outbox, .tap(tagId: "tag"))
            try await send(outbox, tap, 409, Answer.refused("event_id_conflict"))
            try await send(outbox, tap, status)
            state.queued = try outbox.records()
            #expect(
                state.refusedTapWords
                    == "Bali couldn't record a tap. Tap in again, or ask your teacher.",
                "\(status)")
        }
    }

    @Test(
        "A tap the server refused is said on Home (rule 5; santa's round 1) — kept and retried until one is recorded, its shields off meanwhile: an unknown block with who can set it up, any other refusal with the way on, one left unsettled by the retry bound as still tried; the latest such tap, and nothing while none is stuck, nor for another kind of record"
    )
    func refusedTap() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        var state = SyncState()
        state.queued = try outbox.records()
        #expect(state.refusedTapWords == nil)
        let unknown = #"{"error":{"code":"not_found","message":"unknown block"}}"#
        try await send(outbox, tap, 404, unknown)
        state.queued = try outbox.records()
        #expect(state.queued.first?.stuck == true && state.pendingTap == nil)
        #expect(
            state.refusedTapWords
                == "Bali doesn't know a block you tapped, so that tap hasn't counted. Ask your teacher to set it up."
        )
        let conflict = try record(outbox, .tap(tagId: "tag"))
        try await send(outbox, conflict, 409, Answer.refused("event_id_conflict"))
        state.queued = try outbox.records()
        #expect(
            state.refusedTapWords
                == "Bali couldn't record a tap. Tap in again, or ask your teacher.")
        let (unsettled, _) = try makeOutbox()
        let lost = try record(unsettled, .tap(tagId: "tag"))
        for _ in 1...8 { try await send(unsettled, lost, 503) }
        state.queued = try unsettled.records()
        #expect(state.queued.first?.stuck == true)
        #expect(state.refusedTapWords == "Bali couldn't record a tap yet. It keeps trying.")
        let (other, _) = try makeOutbox()
        let unlock = try record(other, .unlock(session: "s", reason: nil))
        try await send(other, unlock, 400, Answer.refused("invalid_request"))
        state.queued = try other.records()
        #expect(state.queued.first?.stuck == true && state.refusedTapWords == nil)
    }

    @Test(
        "A tap not yet answered holds the shields on, so focus, whatever the phone stood in — to its cap; not once the student unlocked after it (decision 11), nor once it is refused"
    )
    func pendingTap() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        let held = try outbox.records()
        let standings: [Standing] = [
            .out, .waiting, .unread, .inSession(later, .unlocked), .inSession(later, nil),
        ]
        for standing in standings {
            #expect(screen(standing: standing, queued: held) == .focus, "\(standing)")
        }
        #expect(screen(queued: held, now: at(SyncState.tapCap - 1)) == .focus)
        #expect(screen(queued: held, now: at(SyncState.tapCap)) == .home)
        let unlocked = Standing.inSession(later, .unlocked)
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
        "The permission once read approved (C1b): a read not determined — Family Controls' for a moment after a launch — routes as approved, out of any session and past the bell; denied still routes to Screen Time, and so does not determined on a phone that never gave it; nothing else moves"
    )
    func everApproved() {
        #expect(screen(permission: .notDetermined, everApproved: true) == .home)
        #expect(screen(permission: .notDetermined, everApproved: true, standing: .waiting) == .waiting)
        #expect(
            screen(permission: .notDetermined, everApproved: true, hasClasses: false) == .join)
        #expect(
            screen(
                permission: .notDetermined, everApproved: true,
                standing: .inSession(session(), .focused), now: at(3000)) == .home)
        #expect(screen(permission: .denied, everApproved: true) == .screenTime)
        #expect(screen(permission: .notDetermined, everApproved: false) == .screenTime)
        #expect(screen(permission: .notDetermined, checked: false, everApproved: true) == .starting)
        #expect(screen(introSeen: false, permission: .notDetermined, everApproved: true) == .intro)
        #expect(screen(signedIn: false, permission: .notDetermined, everApproved: true) == .signIn)
    }

    @Test(
        "What the Sign in screen says of a sign-in that did not finish: its kind in plain words and another try — nothing for one the student closed, and never a refusal's OAuth code (C1b)"
    )
    func words() {
        #expect(SignInError.cancelled.words == nil)
        #expect(
            SignInError.notOpened("ASWebAuthenticationSessionError 3").words
                == "The sign-in page couldn't open. Try again, or ask your teacher.")
        #expect(
            SignInError.unreachable.words
                == "Can't reach the sign-in server. Check your connection and try again.")
        #expect(
            SignInError.refused("access_denied").words
                == "The sign-in server didn't allow this sign-in. Ask your teacher.")
        for code in ["server_error", "temporarily_unavailable"] {
            #expect(
                SignInError.refused(code).words
                    == "The sign-in server isn't working right now. Try again in a moment.",
                "\(code)")
        }
        let refused = "The sign-in was refused. Try again, or ask your teacher."
        for code in ["invalid_client", "invalid_grant", "invalid_request", "some_new_code"] {
            #expect(SignInError.refused(code).words == refused, "\(code)")
        }
        #expect(SignInError.refused(nil).words == refused)
        #expect(SignInError.notKept.words == "Your phone couldn't keep the sign-in. Try again.")
    }

    @Test(
        "What the Screen Time screen says (C1b): the ask, and once denied — at the prompt or in Settings — that nothing pauses and how back, Open Settings first and asking again second, never promising iOS will ask (#105's review); an ask iOS could not make says so, never what iOS said, with another try — or, over denied, Settings; Don't Allow says nothing more"
    )
    func screenTimeWords() {
        let asked = Permission.notDetermined.screenTimeWords
        #expect(asked.ask == "Ask me" && asked.settings == nil)
        #expect(asked.body.hasPrefix("iOS asks once. Bali uses Screen Time only to pause apps"))
        #expect(asked.body.hasSuffix("your teacher simply sees 'Screen Time off'."))
        #expect(Permission.approved.screenTimeWords == asked)
        let denied = Permission.denied.screenTimeWords
        #expect(denied.settings == "Open Settings" && denied.ask == "Ask again")
        #expect(denied.body.hasPrefix("Screen Time access is turned off for Bali"))
        #expect(denied.body.contains("Settings → Screen Time → Apps with Screen Time Access."))
        #expect(denied.body.hasSuffix("iOS may not ask again here."))
        #expect(!denied.body.contains("or ask again"))
        for permission in [Permission.approved, .denied, .notDetermined] {
            #expect(ScreenTimeAskError.cancelled.words(permission) == nil, "\(permission)")
        }
        let failed = ScreenTimeAskError.failed("FamilyControlsError.invalidAccountType")
        for permission in [Permission.approved, .notDetermined] {
            #expect(
                failed.words(permission)
                    == "Bali couldn't ask iOS for Screen Time. Try again, or ask your teacher.",
                "\(permission)")
        }
        let toSettings =
            "Bali couldn't ask iOS for Screen Time. Turn it on in Settings, or ask your teacher."
        #expect(failed.words(.denied) == toSettings)
    }
}

@Suite("Home's Tap in (C3b)", .timeLimit(.minutes(3)))
struct TapInTests {
    @Test(
        "Home's Tap in through the engine (santa's round 1: untested glue): a block's code is the tap — recorded and sent, nothing said; anything else records nothing and is said, a scan the student closed saying nothing; a tap the phone could not save is said"
    )
    func tapIn() async throws {
        let rig = try Rig()
        #expect(await rig.engine.tapIn(.notBali) == BlockRead.notBali.words)
        #expect(await rig.engine.tapIn(.unsupported) == BlockRead.unsupported.words)
        #expect(await rig.engine.tapIn(.cancelled) == nil)
        #expect(await rig.engine.state.queued.isEmpty)
        #expect(await rig.engine.tapIn(.block("T7XK2M9QPF")) == nil)
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
        try await rig.outbox.pool.write { try $0.execute(sql: "ALTER TABLE outbox RENAME TO gone") }
        #expect(await rig.engine.tapIn(.block("T7XK2M9QPF")) == BlockRead.notKept)
        try await rig.outbox.pool.write { try $0.execute(sql: "ALTER TABLE gone RENAME TO outbox") }
        await rig.stop()
    }
}
