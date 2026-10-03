import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// The screen for what the phone knows at `now`: the intro seen, signed in, the permission approved
/// and checked (never read approved before, `everApproved`), the student never in a class on this
/// phone (`everInClass`, #143), the engine standing `standing` with `queued` and its newest tap
/// `lastTap`, and Home's tab chosen, unless said otherwise — nil for a sign-in, an enforcer or an
/// engine that has not spoken. The permission is judged off as the enforcer judges it: denied at
/// once, not determined only where `permissionOff` says it has lasted past B5a-2's grace.
private func screen(
    problem: String? = nil, introSeen: Bool = true, signedIn: Bool? = true,
    permission: Permission? = .approved, permissionOff: Bool? = nil, checked: Bool = true,
    shielded: Bool = false, everApproved: Bool = false, everInClass: Bool = false,
    standing: Standing? = .out, queued: [OutboxRecord] = [], lastTap: String? = nil,
    hasClasses: Bool? = nil, sessionOverClosed: SessionView? = nil, opened: [Screen] = [],
    tab: Screen = .home, now: Date = t0
) -> Screen {
    var protection: Protection?
    if let permission {
        protection = Protection()
        protection?.permission = permission
        protection?.permissionOff = permissionOff ?? (permission == .denied)
        protection?.checked = checked
        protection?.shielded = shielded
    }
    var sync: SyncState?
    if let standing {
        sync = SyncState()
        sync?.standing = standing
        sync?.queued = queued
        sync?.lastTap = lastTap
    }
    return Screen.choose(
        problem: problem, introSeen: introSeen, signedIn: signedIn, protection: protection,
        everApproved: everApproved, everInClass: everInClass, sync: sync, hasClasses: hasClasses,
        sessionOverClosed: sessionOverClosed, opened: opened, tab: tab, now: now
    ).screen
}

/// Whether D1's tab bar shows over the phone standing `standing`, with `opened`, at `now` — the
/// router's own answer, beside its screen — the classes not read yet unless `hasClasses` says, the
/// student never in one on this phone unless `everInClass` says (#143).
private func tabbed(
    standing: Standing, opened: [Screen] = [], closed: SessionView? = nil, now: Date = t0,
    hasClasses: Bool? = nil, everInClass: Bool = false
) -> Bool {
    var (protection, sync) = (Protection(), SyncState())
    (protection.checked, protection.permission, sync.standing) = (true, .approved, standing)
    return Screen.choose(
        problem: nil, introSeen: true, signedIn: true, protection: protection, everApproved: false,
        everInClass: everInClass, sync: sync, hasClasses: hasClasses, sessionOverClosed: closed,
        opened: opened, tab: .history, now: now
    ).tabbed
}

/// `GET /v1/me`'s answer `json`, as the phone decodes it.
private func me(_ json: String) throws -> MeResponse {
    try BaliJSON.makeDecoder().decode(MeResponse.self, from: Data(json.utf8))
}

/// A session whose bell is a thousand seconds ahead of `t0`'s cap.
private let later = session(endsAt: 4000)

/// The engine's truth over `outbox` as the file gives it back: its queue, and the phone's newest
/// tap (#146).
private func read(_ outbox: Outbox) throws -> SyncState {
    var state = SyncState()
    (state.queued, state.lastTap) = (try outbox.records(), try outbox.lastTap())
    return state
}

/// The API's answer to a tap of a block no teacher registered (`taps/404-unknown-block`), and what
/// Home, Waiting and Protection off say of it.
private let notFound = #"{"error":{"code":"not_found","message":"unknown block"}}"#
private let unknownBlock =
    "Bali doesn't know a block you tapped, so that tap hasn't counted. Ask your teacher to set it up."

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
        "In a running session: unlocked and protection off have their screens — never Screen Time's, however the permission reads: taken back mid-session (denied is judged off at once), protection off's, whose screen says how back; a state this build does not know is home — never focus, never unlocked"
    )
    func inSession() {
        #expect(screen(standing: .inSession(session(), .focused)) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked)) == .unlocked)
        #expect(screen(standing: .inSession(session(), .protectionOff)) == .protectionOff)
        #expect(screen(standing: .inSession(session(), nil)) == .home)
        #expect(
            screen(permission: .denied, standing: .inSession(session(), .unlocked)) == .protectionOff)
        #expect(
            screen(permission: .denied, standing: .inSession(session(), .protectionOff))
                == .protectionOff)
        #expect(screen(permission: .notDetermined, standing: .inSession(session(), nil)) == .home)
    }

    @Test(
        "Screen Time back on leaves the Screen Time off screen with no tap (#167): the phone back where it stood before protection off, at once — Focus, or Unlocked after an Emergency Unlock, focused where that is not known — and another class's, or none, moves nothing"
    )
    func backOn() {
        let off = Standing.inSession(session(), .protectionOff)
        let on = Change.protectionOn(session: "s")
        #expect(screen(standing: off) == .protectionOff)
        #expect(screen(standing: off.acting(on)) == .focus)
        #expect(screen(standing: off.acting(on, offFrom: .focused)) == .focus)
        #expect(screen(standing: off.acting(on, offFrom: .unlocked)) == .unlocked)
        #expect(off.acting(.protectionOn(session: "t")) == off)
        #expect(Standing.out.acting(on) == .out && Standing.waiting.acting(on) == .waiting)
    }

    @Test(
        "In a running session, the permission judged off — denied, or not determined past B5a-2's grace — is Protection off, whose screen says how back (Settings, then a re-tap), whatever the standing says before the check's report lands: unlocked, or a state this build does not know (C5b). Focus still wins where the enforcer keeps the shields — Emergency Unlock is there — and so does Home over the last run's; a read not determined within the grace changes nothing; the grant screen only outside a session"
    )
    func permissionOffInSession() throws {
        let states: [ParticipationState?] = [.unlocked, .protectionOff, nil]
        for state in states {
            let standing = Standing.inSession(session(), state)
            for permission in [Permission.denied, .notDetermined] {
                #expect(
                    screen(permission: permission, permissionOff: true, standing: standing)
                        == .protectionOff, "\(permission) \(String(describing: state))")
            }
        }
        let unlocked = Standing.inSession(session(), .unlocked)
        #expect(screen(permission: .notDetermined, standing: unlocked) == .unlocked)
        let unknown = Standing.inSession(session(), nil)
        #expect(screen(permission: .notDetermined, everApproved: true, standing: unknown) == .home)
        let focused = Standing.inSession(session(), .focused)
        #expect(screen(permission: .denied, standing: focused) == .focus)
        let (outbox, _) = try makeOutbox()
        try record(outbox, .tap(tagId: "tag"))
        #expect(
            screen(
                permission: .denied, standing: .inSession(session(), .protectionOff),
                queued: try outbox.records()) == .focus)
        #expect(screen(permission: .denied, shielded: true, standing: .unread) == .home)
        for standing in [Standing.out, .waiting, .inSession(session(), .protectionOff)] {
            #expect(
                screen(permission: .denied, standing: standing, now: at(3000)) == .screenTime,
                "\(standing)")
        }
    }

    @Test(
        "The bell rung by the phone's own clock (decision 6), no read yet: session over (C5b) — never focus, unlocked or protection off over shields that are off, whatever the classes — until the student closes it: home, the next session's own again, and the same session's own once its bell moved — an extension after Done rings a bell of its own (C5b's review); Screen Time first when the permission is not approved; a second before it, the session's screen"
    )
    func bellRung() {
        for state in [ParticipationState.focused, .unlocked, .protectionOff] {
            let standing = Standing.inSession(session(), state)
            #expect(screen(standing: standing, now: at(3000)) == .sessionOver, "\(state)")
            #expect(screen(standing: standing, now: at(9000)) == .sessionOver, "\(state)")
            #expect(
                screen(standing: standing, sessionOverClosed: session(), now: at(3000)) == .home,
                "\(state)")
            #expect(
                screen(permission: .denied, standing: standing, now: at(3000)) == .screenTime,
                "\(state)")
        }
        let next = Standing.inSession(session("t"), .unlocked)
        #expect(screen(standing: next, sessionOverClosed: session(), now: at(3000)) == .sessionOver)
        let extended = Standing.inSession(session(endsAt: 3600), .focused)
        #expect(
            screen(standing: extended, sessionOverClosed: session(), now: at(3600)) == .sessionOver)
        // The bell as the file kept it, a millisecond off the server's (its dates are written to
        // the millisecond, rounded down): the same bell, still closed (santa's round 1).
        let read = Standing.inSession(session(endsAt: 3000.001), .focused)
        #expect(screen(standing: read, sessionOverClosed: session(), now: at(3001)) == .home)
        #expect(screen(standing: .inSession(session(), .focused), now: at(2999)) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked), now: at(2999)) == .unlocked)
        #expect(
            screen(standing: .inSession(session(), .protectionOff), now: at(2999)) == .protectionOff)
        #expect(
            screen(standing: .inSession(session(), .focused), hasClasses: false, now: at(3000))
                == .sessionOver)
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
        "Out of any session: home — join once the phone knows it has no classes; never session over, whose screen leaves by itself once a read says where the phone stands (C5b)"
    )
    func out() {
        #expect(screen() == .home)
        #expect(screen(hasClasses: true) == .home)
        #expect(screen(hasClasses: false) == .join)
        #expect(screen(sessionOverClosed: session()) == .home)
        #expect(screen(standing: .unread, hasClasses: false) == .home)
    }

    @Test(
        "The screens the student opened over another (C3), in order: Join over Home — wherever Home is chosen, past the bell too once session over is closed — and Home over Waiting, then Join over that Home (santa's round 1: Join fell back to Waiting there); each only over the one under it, so never over anything else: the shields, a session's own screens, session over, Screen Time, the sign-in, the intro, nor the home the last run's shields keep over a standing not read (B6b)"
    )
    func opened() {
        #expect(screen(hasClasses: true, opened: [.join]) == .join)
        #expect(screen(opened: [.join]) == .join)
        let rung = Standing.inSession(session(), .focused)
        #expect(screen(standing: rung, sessionOverClosed: session(), opened: [.join], now: at(3000)) == .join)
        #expect(screen(standing: rung, opened: [.join], now: at(3000)) == .sessionOver)
        #expect(screen(standing: .waiting, opened: [.home]) == .home)
        #expect(screen(standing: .waiting, opened: [.home, .join]) == .join)
        #expect(screen(standing: .waiting, opened: [.join]) == .waiting)
        #expect(screen(standing: .waiting, opened: [.join, .home]) == .waiting)
        #expect(screen(opened: [.join, .join]) == .join)
        #expect(screen(hasClasses: false, opened: [.home]) == .join)
        #expect(screen(hasClasses: true, opened: [.focus]) == .home)
        #expect(screen(standing: .inSession(session(), .focused), opened: [.join]) == .focus)
        #expect(screen(standing: .inSession(session(), .unlocked), opened: [.join]) == .unlocked)
        #expect(screen(permission: .denied, standing: .waiting, opened: [.home]) == .screenTime)
        #expect(screen(signedIn: false, opened: [.join]) == .signIn)
        #expect(screen(introSeen: false, opened: [.join]) == .intro)
        #expect(
            screen(signedIn: false, shielded: true, standing: .unread, opened: [.join]) == .home)
    }

    @Test(
        "D1's tab bar (C6a): History or Me in place of the router's own Home — out, not read, past the bell once session over is closed (C5b), a state not known — and of a Home opened over Waiting, the regular Home there (#151); Home's tab is Home; nowhere else: never over the shields, a session's screens, Waiting itself, Join (its own, or opened over Home), session over, Screen Time, the sign-in, the intro, starting, nor the home the last run's shields keep over a standing not read (B6b)"
    )
    func tabs() {
        for tab in [Screen.history, .me] {
            #expect(screen(tab: tab) == tab)
            #expect(screen(hasClasses: true, tab: tab) == tab)
            #expect(screen(standing: .unread, tab: tab) == tab)
            let rung = Standing.inSession(session(), .focused)
            #expect(screen(standing: rung, sessionOverClosed: session(), tab: tab, now: at(3000)) == tab)
            #expect(screen(standing: rung, tab: tab, now: at(3000)) == .sessionOver)
            #expect(screen(standing: .inSession(session(), nil), tab: tab) == tab)
            #expect(screen(standing: .inSession(session(), .focused), tab: tab) == .focus)
            #expect(screen(standing: .inSession(session(), .unlocked), tab: tab) == .unlocked)
            let off = Standing.inSession(session(), .protectionOff)
            #expect(screen(standing: off, tab: tab) == .protectionOff)
            #expect(screen(standing: .waiting, tab: tab) == .waiting)
            #expect(screen(standing: .waiting, opened: [.home], tab: tab) == tab)
            #expect(screen(opened: [.join], tab: tab) == .join)
            #expect(screen(hasClasses: false, tab: tab) == .join)
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
        // Where the phone stood unread, Home — and so Me — whatever the permission reads: Me's
        // Screen Time row can read Off (santa's round 1, Riders-2).
        #expect(screen(permission: .denied, standing: .unread, tab: .me) == .me)
        // The bar in the same answer as the screen, at the same moment (C6a's review): a class's
        // screen has none, the router's own Home has one, and so has the Home opened over Waiting
        // (#151); Waiting itself, and Join opened over Home, none.
        #expect(!tabbed(standing: .inSession(session(), .unlocked), now: at(2999)))
        #expect(tabbed(standing: .out) && tabbed(standing: .inSession(session(), nil)))
        #expect(!tabbed(standing: .waiting) && tabbed(standing: .waiting, opened: [.home]))
        #expect(!tabbed(standing: .out, opened: [.join]))
    }

    @Test(
        "Home's card while a class of the student's is in session and they are not focused in it (C3c): unlocked there, what is true and until when; out, a class in session by the last read, its way in; gone at the bell by the phone's clock; none focused, under protection off, in a state not known, waiting, unread, or with no class running"
    )
    func homeInSession() throws {
        let unlocked = try synced(.inSession(bell1042, .unlocked))
        let card = try #require(unlocked.inSessionCard(at: t0, time: newYork))
        #expect(card.unlocked && card.bell == bell1042.endsAt && card.retap == nil)
        #expect(plain(card.words) == "You're unlocked in Period 3 — Algebra II until 10:42 AM.")
        // Protection off reported in the class, or its refocus refused: as on Unlocked, the way
        // back is a re-tap, never a refocus the server refuses (santa's round 1).
        var reported = unlocked
        reported.reportedOff = bell1042.id
        #expect(reported.inSessionCard(at: t0)?.retap == UnlockedWords(reported)?.retap)
        #expect(reported.inSessionCard(at: t0)?.retap != nil)
        #expect(unlocked.inSessionCard(at: bell1042.endsAt) == nil)
        let unread = try synced(.inSession(bell1042, .unlocked), me: false)
        #expect(
            plain(unread.inSessionCard(at: t0, time: newYork)?.words)
                == "You're unlocked in your class until 10:42 AM.")
        var out = try synced(.out)
        out.me = try BaliJSON.makeDecoder().decode(
            MeResponse.self,
            from: Data(
                #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"p5","name":"Period 5 — Chemistry"},{"id":"c","name":"Period 3 — Algebra II","liveSession":{"id":"s","endsAt":"\#(iso(bell1042.endsAt))"}}],"session":null}"#
                    .utf8))
        let notIn = try #require(out.inSessionCard(at: t0))
        #expect(!notIn.unlocked && notIn.bell == bell1042.endsAt)
        #expect(notIn.words == "Period 3 — Algebra II is in session. Tap your teacher's block to join.")
        #expect(out.inSessionCard(at: bell1042.endsAt) == nil)
        #expect(try synced(.out).inSessionCard(at: t0) == nil)
        let others: [Standing] = [
            .inSession(bell1042, .focused), .inSession(bell1042, .protectionOff),
            .inSession(bell1042, nil), .waiting, .unread,
        ]
        for standing in others {
            var state = out
            state.standing = standing
            #expect(state.inSessionCard(at: t0) == nil, "\(standing)")
        }
    }

    @Test(
        "Home over Unlocked (C5c; the owner's ruling, 2026-09-30): Unlocked's primary way on, the apps still open — with its tab bar, History and Me honoured there, and Join over it as over any Home; only while Unlocked is the router's own: never over Focus, Protection off or Session over"
    )
    func homeOverUnlocked() {
        let unlocked = Standing.inSession(session(), .unlocked)
        #expect(screen(standing: unlocked, opened: [.home]) == .home)
        #expect(tabbed(standing: unlocked, opened: [.home]))
        for tab in [Screen.history, .me] {
            #expect(screen(standing: unlocked, opened: [.home], tab: tab) == tab)
        }
        #expect(screen(standing: unlocked, opened: [.home, .join], tab: .me) == .join)
        #expect(!tabbed(standing: unlocked, opened: [.home, .join]))
        #expect(screen(standing: .inSession(session(), .focused), opened: [.home]) == .focus)
        let off = Standing.inSession(session(), .protectionOff)
        #expect(screen(standing: off, opened: [.home]) == .protectionOff)
        #expect(screen(standing: unlocked, opened: [.home], now: at(3000)) == .sessionOver)
        #expect(!tabbed(standing: unlocked, opened: [.home], now: at(3000)))
        // Its Unlocked gone — the bell rung, then Session over's Done, or a read saying out — the
        // Home it opened is the router's own Home: its tab bar, its tabs (santa's round 1).
        let rung = Standing.inSession(session(), .unlocked)
        for (standing, closed) in [(rung, session()), (Standing.out, nil)] as [(Standing, SessionView?)] {
            #expect(
                screen(standing: standing, sessionOverClosed: closed, opened: [.home], tab: .me, now: at(3000))
                    == .me)
            #expect(tabbed(standing: standing, opened: [.home], closed: closed, now: at(3000)))
        }
    }

    @Test(
        "Waiting's Back to home (#151, the owner's decision, 2026-10-01): the regular Home — its tab bar, History and Me honoured there, Join over it as over any Home — never a Home stacked over Waiting; Waiting itself stays the tap's answer, with no bar; the Start found is Focus, whatever was opened or chosen; and Home's card says the wait in the hero's place: the tap counted and when the phone locks, only while waiting — C3c's card never then"
    )
    func homeWaiting() throws {
        #expect(screen(standing: .waiting) == .waiting && !tabbed(standing: .waiting))
        #expect(screen(standing: .waiting, opened: [.home]) == .home)
        #expect(tabbed(standing: .waiting, opened: [.home]))
        for tab in [Screen.history, .me] {
            #expect(screen(standing: .waiting, opened: [.home], tab: tab) == tab)
        }
        #expect(screen(standing: .waiting, opened: [.home, .join], tab: .me) == .join)
        #expect(!tabbed(standing: .waiting, opened: [.home, .join]))
        let started = Standing.inSession(session(), .focused)
        for tab in [Screen.home, .history, .me] {
            #expect(screen(standing: started, opened: [.home], tab: tab) == .focus, "\(tab)")
            #expect(screen(standing: started, opened: [.home, .join], tab: tab) == .focus, "\(tab)")
        }
        var waiting = try synced(.waiting)
        #expect(
            waiting.waitingCard
                == "You're tapped in. Your phone locks when class starts, as long as Bali is open.")
        #expect(waiting.inSessionCard(at: t0) == nil)
        let others: [Standing] = [
            .out, .unread, .inSession(bell1042, .focused), .inSession(bell1042, .unlocked),
            .inSession(bell1042, .protectionOff), .inSession(bell1042, nil),
        ]
        for standing in others {
            waiting.standing = standing
            #expect(waiting.waitingCard == nil, "\(standing)")
        }
    }

    @Test(
        "Removed from their last class, or having left it (#143, the owner's ask, 2026-10-01): a student this phone has seen in a class lands on Home, its tab bar, History and Me honoured, Join a class opened over it with its way back, and its card in the hero's place says so, with Join a class; never the first-run Join, which a student never in a class here keeps, another student signed in on this phone too. Nothing else moves: the classes not read yet, waiting, a standing not read, a session's screens, Session over, Screen Time, the sign-in; and Home's other cards, a class in session (C3c) and the wait (#151), and a refused tap said (#146), stand as they were"
    )
    func removedFromLastClass() async throws {
        // The owner's phone: unlocked in a class, then removed from its roster; the read after
        // says out, in no class.
        let unlocked = Standing.inSession(session(), .unlocked)
        #expect(screen(everInClass: true, standing: unlocked, hasClasses: true) == .unlocked)
        #expect(screen(everInClass: true, hasClasses: false) == .home)
        #expect(tabbed(standing: .out, hasClasses: false, everInClass: true))
        for tab in [Screen.history, .me] {
            #expect(screen(everInClass: true, hasClasses: false, tab: tab) == tab)
        }
        #expect(screen(everInClass: true, hasClasses: false, opened: [.join]) == .join)
        #expect(!tabbed(standing: .out, opened: [.join], hasClasses: false, everInClass: true))
        // Never in a class here, a first run or another student signed in: Join, as before.
        #expect(screen(hasClasses: false) == .join)
        #expect(screen(hasClasses: false, tab: .me) == .join)
        #expect(!tabbed(standing: .out, hasClasses: false))
        // Nothing else moves.
        #expect(screen(everInClass: true) == .home)
        #expect(screen(everInClass: true, standing: .waiting, hasClasses: false) == .waiting)
        #expect(screen(everInClass: true, standing: .unread, hasClasses: false) == .home)
        #expect(screen(everInClass: true, standing: unlocked, hasClasses: false) == .unlocked)
        #expect(
            screen(everInClass: true, standing: unlocked, hasClasses: false, now: at(3000))
                == .sessionOver)
        #expect(screen(permission: .denied, everInClass: true, hasClasses: false) == .screenTime)
        #expect(screen(signedIn: false, everInClass: true, hasClasses: false) == .signIn)
        // Home's card in the hero's place: what is true, and the way on; out, in no class, only.
        var out = SyncState()
        (out.standing, out.me) = (.out, try me(Answer.me(nil)))
        #expect(
            out.noClassesCard
                == "You're not in any classes. Join one with the class code from your teacher.")
        #expect(out.inSessionCard(at: t0) == nil && out.waitingCard == nil)
        let others: [Standing] = [
            .waiting, .unread, .inSession(bell1042, .focused), .inSession(bell1042, .unlocked),
            .inSession(bell1042, .protectionOff), .inSession(bell1042, nil),
        ]
        for standing in others {
            var state = out
            state.standing = standing
            #expect(state.noClassesCard == nil, "\(standing)")
        }
        // The wait's card in no class too: an armed tap needs no enrollment (#151).
        var waiting = out
        waiting.standing = .waiting
        #expect(waiting.waitingCard != nil)
        // The classes not read, or one of them: none; C3c's card where that class is in session.
        var notRead = out
        notRead.me = nil
        #expect(notRead.noClassesCard == nil)
        var running = out
        running.me = try me(
            #"{"user":{"id":"u","role":"student","displayName":null},"classes":[{"id":"c","name":"Period 3 — Algebra II","liveSession":{"id":"s","endsAt":"\#(iso(bell1042.endsAt))"}}],"session":null}"#
        )
        #expect(running.noClassesCard == nil && running.inSessionCard(at: t0) != nil)
        // A scan of a block no teacher set up is still said under it (#146).
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "NOCLASS123"))
        try await send(outbox, tap, 404, notFound)
        var refused = try read(outbox)
        (refused.standing, refused.me) = (.out, out.me)
        #expect(refused.noClassesCard != nil && refused.refusedTapWords == unknownBlock)
    }

    @Test(
        "A tap refused for anything but an unknown block names a way on the screen saying it has (#160's review): on Home in no class, which has no Tap in (#143), its Try again, in plain words with no em-dash; Tap in again everywhere else, in a class, waiting or out with the classes not read; a tap still being sent at the retry bound says so on that Home too"
    )
    func refusedTapInNoClass() async throws {
        let (tryAgain, tapAgain) = (
            "Bali couldn't record a tap. Try again, or ask your teacher.",
            "Bali couldn't record a tap. Tap in again, or ask your teacher."
        )
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try await send(outbox, tap, 409, Answer.refused("event_id_conflict"))
        var state = try read(outbox)
        (state.standing, state.me) = (.out, try me(Answer.me(nil)))
        #expect(state.noClassesCard != nil && state.refusedTapWords == tryAgain)
        #expect(!tryAgain.contains("—") && !tryAgain.contains("–"))
        var inClass = state
        inClass.me = try me(Answer.me(nil, classes: [Answer.inClass("c")]))
        var waiting = state
        waiting.standing = .waiting
        var unread = state
        unread.me = nil
        for elsewhere in [inClass, waiting, unread] {
            #expect(elsewhere.noClassesCard == nil, "\(elsewhere.standing)")
            #expect(elsewhere.refusedTapWords == tapAgain, "\(elsewhere.standing)")
        }
        let (unsettled, _) = try makeOutbox()
        let lost = try record(unsettled, .tap(tagId: "tag"))
        for _ in 1...Outbox.bound { try await send(unsettled, lost, 503) }
        var trying = try read(unsettled)
        (trying.standing, trying.me) = (.out, state.me)
        #expect(trying.refusedTapWords == "Bali couldn't record a tap yet. It keeps trying.")
    }

    @Test(
        "A screen opened over another stays open while where the phone stands holds — the classes read, the link, a failed read change nothing, nor a tap sent again — and closes once the standing changes, a tap is made or answered, or, out, the phone knows it has no classes and Join is the router's own then, with no way back (C3) — never for a student once in a class here, whose own is Home (#143): Join opened over it, its code typed, and a tab chosen there stay, the classes gone or a read saying none again (santa's rounds 1 and 2: never while waiting, whose screen is Waiting's whatever the classes). A read saying out, once the bell has rung by the phone's clock, changes nothing the student sees — the class was over for the phone already — so it keeps what they opened or chose since, History from Session over (C5b's hand-off); before the bell, the class ending is a change"
    )
    func keepsOpened() async throws {
        var rung = SyncState()
        rung.standing = .inSession(session(), .focused)
        var read = rung
        read.standing = .out
        #expect(read.keepsOpened(from: rung, at: at(3000)))
        #expect(!read.keepsOpened(from: rung, at: at(2999)))
        read.standing = .inSession(session("t"), .focused)
        #expect(!read.keepsOpened(from: rung, at: at(3000)))
        read.standing = .waiting
        #expect(!read.keepsOpened(from: rung, at: at(3000)))
        // The same class, still past its bell — the sweep not run yet, a state changed, or its
        // bell a millisecond off the copy the file kept (santa's round 1): no change either; its
        // bell moved on, an extension, is one.
        read.standing = .inSession(session(endsAt: 3000.001), .unlocked)
        #expect(read.keepsOpened(from: rung, at: at(3001)))
        read.standing = .inSession(session(endsAt: 3600), .focused)
        #expect(!read.keepsOpened(from: rung, at: at(3001)))
        var before = SyncState()
        before.standing = .waiting
        var after = before
        (after.link, after.meFailed, after.heardAt) = (.unreachable, .networkError, t0)
        #expect(after.keepsOpened(from: before, at: t0))
        after.me = try BaliJSON.makeDecoder().decode(
            MeResponse.self, from: Data(Answer.me(nil, classes: [Answer.inClass("c")]).utf8))
        #expect(after.keepsOpened(from: before, at: t0))
        // No classes while waiting — an armed tap needs no enrollment — is still Waiting's: the
        // Home and Join opened over it stay (santa's round 2). Only out is Join the router's own.
        let none = try BaliJSON.makeDecoder().decode(
            MeResponse.self, from: Data(Answer.me(nil).utf8))
        after.me = none
        #expect(after.hasClasses == false && after.keepsOpened(from: before, at: t0))
        var out = SyncState()
        (out.standing, out.me) = (.out, none)
        var outBefore = out
        outBefore.me = nil
        #expect(!out.keepsOpened(from: outBefore, at: t0))
        #expect(outBefore.keepsOpened(from: outBefore, at: t0))
        // Once in a class here, Join is not the router's own in none (#143): the classes gone,
        // removed or left, a read saying none again (every return to the front makes one), the
        // first read since a launch, close nothing; where the phone stands changing still does.
        var inClass = out
        inClass.me = try me(Answer.me(nil, classes: [Answer.inClass("c")]))
        #expect(!out.keepsOpened(from: inClass, at: t0) && !out.keepsOpened(from: out, at: t0))
        for from in [inClass, out, outBefore] {
            #expect(out.keepsOpened(from: from, at: t0, everInClass: true))
        }
        var unlocked = inClass
        unlocked.standing = .inSession(session(), .unlocked)
        #expect(!out.keepsOpened(from: unlocked, at: t0, everInClass: true))
        #expect(inClass.keepsOpened(from: out, at: t0))
        after.me = nil
        after.standing = .out
        #expect(!after.keepsOpened(from: before, at: t0))
        #expect(!before.keepsOpened(from: nil, at: t0))
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        var tapped = before
        tapped.queued = try outbox.records()
        #expect(!tapped.keepsOpened(from: before, at: t0))
        #expect(!before.keepsOpened(from: tapped, at: t0))
        try await send(outbox, tap, 503)
        var retried = tapped
        retried.queued = try outbox.records()
        #expect(retried.queued.first?.attempts == 1 && retried.keepsOpened(from: tapped, at: t0))
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
        "The screens' own wiring the riders fixed, read from their source — no SwiftUI view can be driven from a test (Riders-2's santa): History keeps its read when it goes, and reads its newest page again each time it shows (#141); Unlocked gives a light haptic as a reason is picked, and every reason is tappable but where a pick cannot act — the unlock on its way — a pick on its way holding none back (C5c, the owner's ruling; #140, whose picks the app's tests drive); Me gives the keyboard back once a save is over"
    )
    func ridersWiring() throws {
        let history = try sourceCode("Bali/UI/HistoryView.swift")
        #expect(history.contains(".onAppear { Task { await phone.refreshHistory() } }"))
        #expect(!history.contains("forgetHistory") && !history.contains("onDisappear"))
        // Its days drawn once per change of the history (F5's review), and the card over the
        // moments kept saying Reading… while a read from the top runs (F4's review).
        #expect(history.contains("let days = phone.historyDays") && !history.contains("days(now:"))
        #expect(history.contains("reading: history.busy && history.fromTop"))
        let unlocked = try sourceCode("Bali/UI/UnlockedView.swift")
        #expect(
            unlocked.contains(
                ".sensoryFeedback(.selection, trigger: phone.picking) { _, picked in picked != nil }"))
        #expect(unlocked.contains(".disabled(!open)"))
        #expect(unlocked.contains("guard !chosen || phone.pickFailed != nil else { return }"))
        let me = try sourceCode("Bali/UI/MeView.swift")
        #expect(me.contains(".onChange(of: naming.busy) { _, busy in"))
        // Me's Screen Time row says Off where the check judges the permission off: reachable
        // over a standing not read (`meScreenTimeOff`; santa's rounds 1 and 2).
        #expect(me.contains(#"value: off ? ("Off", Theme.textSecondary) : ("On", Theme.brand)"#))
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
            var state = try read(unsettled)
            #expect(state.queued.first?.stuck == true && state.queued.first?.lastStatus == status)
            #expect(
                state.refusedTapWords == "Bali couldn't record a tap yet. It keeps trying.",
                "\(status)")
            let (outbox, _) = try makeOutbox()
            let tap = try record(outbox, .tap(tagId: "tag"))
            try await send(outbox, tap, 409, Answer.refused("event_id_conflict"))
            try await send(outbox, tap, status)
            state = try read(outbox)
            #expect(
                state.refusedTapWords
                    == "Bali couldn't record a tap. Tap in again, or ask your teacher.",
                "\(status)")
        }
    }

    @Test(
        "A refused tap stays said as refused whatever answers come after it — the retry bound's worth of server errors included, each of which overwrites its last answer: the refusal is kept on the record (C4's review), an unknown block's words too"
    )
    func refusalKept() async throws {
        for (status, said) in [
            (409, "Bali couldn't record a tap. Tap in again, or ask your teacher."), (404, unknownBlock),
        ] {
            let (outbox, _) = try makeOutbox()
            let tap = try record(outbox, .tap(tagId: "tag"))
            try await send(outbox, tap, status, Answer.refused("event_id_conflict"))
            for _ in 1...Outbox.bound { try await send(outbox, tap, 503) }
            let state = try read(outbox)
            let stuck = try #require(state.queued.first)
            #expect(stuck.lastStatus == 503 && stuck.answers > Outbox.bound, "\(status)")
            #expect(stuck.refusedStatus == status && state.refusedTapWords == said, "\(status)")
        }
    }

    @Test(
        "A tap the server refused is said on Home (rule 5; santa's round 1) — kept and retried until one is recorded, its shields off meanwhile: an unknown block with who can set it up, any other refusal with the way on, one left unsettled by the retry bound as still tried; the latest such tap, and nothing while none is stuck, nor for another kind of record"
    )
    func refusedTap() async throws {
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        var state = try read(outbox)
        #expect(state.refusedTapWords == nil)
        try await send(outbox, tap, 404, notFound)
        state = try read(outbox)
        #expect(state.queued.first?.stuck == true && state.pendingTap == nil)
        #expect(state.refusedTapWords == unknownBlock)
        let conflict = try record(outbox, .tap(tagId: "tag"))
        try await send(outbox, conflict, 409, Answer.refused("event_id_conflict"))
        state = try read(outbox)
        #expect(
            state.refusedTapWords
                == "Bali couldn't record a tap. Tap in again, or ask your teacher.")
        let (unsettled, _) = try makeOutbox()
        let lost = try record(unsettled, .tap(tagId: "tag"))
        for _ in 1...8 { try await send(unsettled, lost, 503) }
        state = try read(unsettled)
        #expect(state.queued.first?.stuck == true)
        #expect(state.refusedTapWords == "Bali couldn't record a tap yet. It keeps trying.")
        let (other, _) = try makeOutbox()
        let unlock = try record(other, .unlock(session: "s", reason: nil))
        try await send(other, unlock, 400, Answer.refused("invalid_request"))
        state = try read(other)
        #expect(state.queued.first?.stuck == true && state.refusedTapWords == nil)
    }

    @Test(
        "A refused tap is said only while it is the phone's newest tap (#146): a later one on its way, or recorded and gone, leaves the refused tap kept, stuck and unsaid — and the screen chosen as before, Home, Waiting or Protection off; one refused in its turn is said in its own words; a file that names no tap leaves the latest stuck one said"
    )
    func refusedTapNewest() async throws {
        let (outbox, _) = try makeOutbox()
        let refused = try record(outbox, .tap(tagId: "NOCLASS123"))
        try await send(outbox, refused, 404, notFound)
        #expect(try read(outbox).refusedTapWords == unknownBlock)
        let next = try record(outbox, .tap(tagId: "tag"))
        var state = try read(outbox)
        #expect(state.refusedTapWords == nil && state.pendingTap == next)
        try await send(outbox, next, 200, Answer.joined())
        state = try read(outbox)
        #expect(state.queued.map(\.eventId) == [refused.eventId] && state.queued[0].stuck)
        #expect(state.lastTap == next.eventId && state.refusedTapWords == nil)
        let standings: [(Standing, Screen)] = [
            (.out, .home), (.waiting, .waiting), (.inSession(later, .protectionOff), .protectionOff),
        ]
        for (standing, shown) in standings {
            for newest in [refused.eventId, next.eventId] {
                #expect(
                    screen(standing: standing, queued: state.queued, lastTap: newest) == shown,
                    "\(standing)")
            }
        }
        state.lastTap = nil
        #expect(state.refusedTapWords == unknownBlock)
        let again = try record(outbox, .tap(tagId: "tag"))
        try await send(outbox, again, 409, Answer.refused("event_id_conflict"))
        #expect(
            try read(outbox).refusedTapWords
                == "Bali couldn't record a tap. Tap in again, or ask your teacher.")
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
                standing: .inSession(session(), .focused), now: at(3000)) == .sessionOver)
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

    @Test(
        "A refused tap is said only while it is the phone's newest tap (#146, the owner's phone: a 3:51 PM scan of a block no teacher set up still said at 4:31 PM, in another class): a later tap — on its way, then joined — ends its card, the refused one still kept, retried, refused again and listed; a relaunch reads the phone's newest tap from the file, and says nothing; a tap after it refused in its turn is said in its own words"
    )
    func refusedTapThenTapped() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "NOCLASS123"))
        try await rig.server.next(tapRoute).reply(404, notFound)
        await rig.until { $0.refusedTapWords == unknownBlock }
        try await rig.engine.record(.tap(tagId: "T7XK2M9QPF"))
        #expect(await rig.engine.state.refusedTapWords == nil)
        try await rig.server.next(tapRoute).reply(200, Answer.joined())
        let joined = await rig.until { $0.standing == .inSession(session(), .focused) }
        #expect(joined.refusedTapWords == nil)
        #expect(joined.queued.map(\.change) == [.tap(tagId: "NOCLASS123")])
        #expect(joined.queued.first?.stuck == true)
        // Kept and retried on its backoff (2 s, no jitter), refused again: never said again.
        rig.clock.advance(by: 2)
        try await rig.server.next(tapRoute).reply(404, notFound)
        let retried = await rig.until { $0.queued.first?.attempts == 2 }
        #expect(retried.refusedTapWords == nil && retried.queued.count == 1)
        await rig.stop()
        let relaunched = try Rig(outbox: rig.outbox)
        #expect(await relaunched.engine.state.queued.map(\.change) == [.tap(tagId: "NOCLASS123")])
        #expect(await relaunched.engine.state.refusedTapWords == nil)
        try await relaunched.engine.record(.tap(tagId: "T7XK2M9QPF"))
        try await relaunched.server.next(tapRoute).reply(409, Answer.refused("event_id_conflict"))
        await relaunched.until {
            $0.refusedTapWords == "Bali couldn't record a tap. Tap in again, or ask your teacher."
        }
        await relaunched.stop()
    }

    @Test(
        "A launch whose read of the file failed reads the phone's newest tap again with the queue, once the file reads (santa's round 1): a refused tap a later one went ahead of is still not said"
    )
    func refusedTapUnreadAtLaunch() async throws {
        let (outbox, _) = try makeOutbox()
        let refused = try record(outbox, .tap(tagId: "NOCLASS123"))
        try await send(outbox, refused, 404, notFound)
        let next = try record(outbox, .tap(tagId: "T7XK2M9QPF"))
        try await send(outbox, next, 200, Answer.joined())
        try await outbox.pool.write { try $0.execute(sql: "ALTER TABLE outboxState RENAME TO gone") }
        let rig = try Rig(outbox: outbox)
        await rig.until { $0.link == .storageFailed }
        try await outbox.pool.write { try $0.execute(sql: "ALTER TABLE gone RENAME TO outboxState") }
        await rig.engine.retryNow()
        let read = await rig.until { !$0.queued.isEmpty }
        #expect(read.queued.map(\.eventId) == [refused.eventId] && read.lastTap == next.eventId)
        #expect(read.refusedTapWords == nil)
        await rig.stop()
    }
}

/// The screen for `state` at `now`, and whether its tab bar shows, with `opened` — the router's
/// answer for a phone signed in, its permission approved and checked, Home's tab chosen.
private func shown(_ state: SyncState, opened: [Screen], now: Date = t0) -> (Screen, Bool) {
    var protection = Protection()
    (protection.checked, protection.permission) = (true, .approved)
    let shown = Screen.choose(
        problem: nil, introSeen: true, signedIn: true, protection: protection,
        everApproved: false, everInClass: false, sync: state, hasClasses: state.hasClasses,
        sessionOverClosed: nil, opened: opened, tab: .home, now: now)
    return (shown.screen, shown.tabbed)
}

@Suite("Waiting's Back to home, and the Start (#151)", .timeLimit(.minutes(3)))
struct WaitingHomeTests {
    @Test(
        "Bali opened again while waiting lands on Waiting, the tap's answer: where the phone stands is kept in the file, and nothing the student opened is (#151). The read every 30 s in the foreground (decision 6) runs whatever the screen — the Home opened over Waiting is no input of the engine's — and the Start it finds is Focus, that Home closed"
    )
    func startFromHome() async throws {
        let rig = try Rig()
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
        await rig.stop()
        let relaunched = try Rig(outbox: rig.outbox)
        let waiting = await relaunched.engine.state
        #expect(waiting.standing == .waiting)
        #expect(shown(waiting, opened: []) == (.waiting, false))
        #expect(shown(waiting, opened: [.home]) == (.home, true))
        try await relaunched.foreground(Answer.me(nil))
        relaunched.clock.advance(by: 30)
        try await relaunched.server.next(meRoute).reply(200, Answer.me(session(endsAt: 4000)))
        let started = await relaunched.until { $0.standing != .waiting }
        let now = relaunched.clock.now()
        #expect(started.standing == .inSession(session(endsAt: 4000), .focused))
        #expect(!started.keepsOpened(from: waiting, at: now))
        #expect(shown(started, opened: [.home], now: now) == (.focus, false))
        await relaunched.stop()
    }
}

@Suite("A wait the server has dropped is Home, never Waiting (#166)", .timeLimit(.minutes(3)))
struct DroppedWaitTests {
    /// A tap answered armed at the rig's clock: the phone waits for the Start.
    private func armed(_ rig: Rig) async throws {
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(200, Answer.armed)
        await rig.until { $0.standing == .waiting && $0.queued.isEmpty }
    }

    /// Class `c` with its session running until `at(4000)`, as `GET /v1/me` names it (C3c).
    private let inSession =
        #"{"id":"c","name":"Class c","teacher":{"displayName":null},"liveSession":{"id":"s","endsAt":"\#(iso(at(4000)))"}}"#

    @Test(
        "A read saying no tap of the student's waits — its school day over, or taken by a Start whose class is over too — ends the wait: Home, never Waiting, and no wait said on it"
    )
    func dropped() async throws {
        let rig = try Rig()
        try await armed(rig)
        try await rig.foreground(Answer.me(nil, classes: [Answer.inClass("c")], armed: false))
        let state = await rig.engine.state
        #expect(state.standing == .out)
        #expect(shown(state, opened: []) == (.home, true))
        #expect(shown(state, opened: [.home]) == (.home, true))
        #expect(state.waitingCard == nil && state.inSessionCard(at: rig.clock.now()) == nil)
        await rig.stop()
    }

    @Test(
        "A Start after the tap's school day joins nothing: the read names no session and no tap waiting, and Home's card says the class is in session, with Tap in (C3c)"
    )
    func startAfterExpiry() async throws {
        let rig = try Rig()
        try await armed(rig)
        try await rig.foreground(Answer.me(nil, classes: [Answer.inClass("c")], armed: true))
        #expect(await rig.engine.state.standing == .waiting)
        rig.clock.advance(by: 30)
        try await rig.server.next(meRoute)
            .reply(200, Answer.me(nil, classes: [inSession], armed: false))
        let state = await rig.until { $0.standing != .waiting }
        let now = rig.clock.now()
        #expect(state.standing == .out)
        #expect(shown(state, opened: [], now: now) == (.home, true))
        let card = try #require(state.inSessionCard(at: now))
        #expect(!card.unlocked && card.bell == at(4000))
        #expect(card.words == "Class c is in session. Tap your teacher's block to join.")
        await rig.stop()
    }

    @Test(
        "A read naming a class over by the phone's clock, the sweep yet to run, and no tap waiting — a Start took the tap and the class has rung — is that class: Session over, never Waiting (santa's round 1)"
    )
    func takenAndOver() async throws {
        let rig = try Rig()
        try await armed(rig)
        try await rig.foreground(Answer.me(session(endsAt: -60), armed: false))
        let state = await rig.engine.state
        #expect(state.standing == .inSession(session(endsAt: -60), .focused))
        #expect(shown(state, opened: []) == (.sessionOver, false))
        await rig.stop()
    }

    @Test(
        "Offline, the wait ends where the server drops the tap — the end of the day it was armed, by the phone's clock — at the next wake: Home. Each arming moves it"
    )
    func offlineAtTheEnd() async throws {
        let rig = try Rig()
        try await armed(rig)
        // Armed again the next day: the end of that day.
        rig.clock.advance(by: 86_400)
        try await armed(rig)
        let ends = try #require(await rig.engine.state.waitEnds)
        #expect(ends == SyncState.waitEnds(armedAt: at(86_400)))
        await rig.engine.setForeground(true)
        try await rig.server.next(meRoute).reply(nil)
        await rig.until { $0.meFailed != nil }
        try await rig.sleeping([at(86_430)])
        // A second before it: still waiting.
        rig.clock.advance(by: ends.timeIntervalSince(rig.clock.now()) - 1)
        try await rig.server.next(meRoute).reply(nil)
        try await rig.sleeping([ends.addingTimeInterval(29)])
        let waiting = await rig.engine.state
        #expect(waiting.standing == .waiting)
        #expect(shown(waiting, opened: [], now: rig.clock.now()) == (.waiting, false))
        rig.clock.advance(by: 30)
        let state = await rig.until { $0.standing == .out }
        #expect(shown(state, opened: [], now: rig.clock.now()) == (.home, true))
        await rig.stop()
    }

    @Test(
        "An end the file refuses to keep is said — storage failed (rule 5) — and kept in memory: armed again while waiting, where no write of the standing would say it (santa's round 2)"
    )
    func endNotKept() async throws {
        let rig = try Rig()
        try await armed(rig)
        try await rig.outbox.pool.write {
            try $0.execute(
                sql: """
                    CREATE TRIGGER refuse BEFORE INSERT ON outboxState WHEN NEW.key = 'waitEnds'
                    BEGIN SELECT RAISE(ABORT, 'refused'); END
                    """)
        }
        rig.clock.advance(by: 86_400)
        try await armed(rig)
        let state = await rig.engine.state
        #expect(state.link == .storageFailed)
        #expect(state.waitEnds == SyncState.waitEnds(armedAt: at(86_400)))
        #expect(try rig.outbox.waitEnds() == SyncState.waitEnds(armedAt: t0))
        await rig.stop()
    }

    @Test(
        "The end is kept with the wait: Bali opened again past it, offline, is Home; a wait an earlier build kept, with no end, waits until a read ends it"
    )
    func relaunched() async throws {
        let rig = try Rig()
        try await armed(rig)
        await rig.stop()
        let relaunched = try Rig(outbox: rig.outbox)
        let ends = SyncState.waitEnds(armedAt: t0)
        #expect(await relaunched.engine.state.waitEnds == ends)
        relaunched.clock.advance(by: ends.timeIntervalSince(t0))
        await relaunched.engine.setForeground(true)
        try await relaunched.server.next(meRoute).reply(nil)
        let state = await relaunched.until { $0.standing == .out }
        #expect(shown(state, opened: [], now: relaunched.clock.now()) == (.home, true))
        await relaunched.stop()

        let earlier = try makeOutbox().outbox
        try earlier.file(.waiting)
        let kept = try Rig(outbox: earlier)
        #expect(await kept.engine.state.waitEnds == nil)
        kept.clock.advance(by: 7 * 86_400)
        await kept.engine.setForeground(true)
        try await kept.server.next(meRoute).reply(nil)
        try await kept.sleeping([at(7 * 86_400 + 30)])
        #expect(await kept.engine.state.standing == .waiting)
        kept.clock.advance(by: 30)
        try await kept.server.next(meRoute).reply(200, Answer.me(nil, armed: false))
        await kept.until { $0.standing == .out }
        await kept.stop()
    }

    @Test(
        "The end is the midnight after the arming in the phone's own zone — the school's, in class — as the server's armed tap ends at its zone's (decision 5): a day an hour short too"
    )
    func waitEnds() throws {
        var central = Calendar(identifier: .gregorian)
        central.timeZone = try #require(TimeZone(identifier: "America/Chicago"))
        func date(_ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) throws -> Date {
            try #require(
                central.date(
                    from: DateComponents(
                        year: 2026, month: month, day: day, hour: hour, minute: minute)))
        }
        // The owner's tap (#166): 7:10 PM on October 1.
        let owners = SyncState.waitEnds(armedAt: try date(10, 1, 19, 10), calendar: central)
        #expect(owners == (try date(10, 2)))
        // March 8, 2026, the clocks go forward: a day of 23 hours.
        let spring = SyncState.waitEnds(armedAt: try date(3, 8, 10), calendar: central)
        #expect(spring == (try date(3, 9)))
    }
}

/// The phone's clock as the bell's wait reads it: a test clock's time, each read counted. The wait
/// reads it first once its observer is registered (`Screen.bell`), then at each look.
private final class Reads: @unchecked Sendable {
    let clock = TestClock()
    private let lock = NSLock()
    private var count = 0

    func now() -> Date {
        lock.withLock { count += 1 }
        return clock.now()
    }

    var reads: Int { lock.withLock { count } }
}

@Suite("The bell, where the router chooses again (C5a, C5b)", .timeLimit(.minutes(3)))
struct BellRedrawTests {
    @Test(
        "Slept towards by the phone's own clock, and looked at again whenever iOS says the time was set: a clock set forward past the bell ends the wait at once — a sleep counts only the time that passes, and waited out the time left (C5a's review) — while a change short of it does not; the bell reached by sleeping ends it, and so does a cancel"
    )
    func timeSet() async throws {
        let (center, change, reads) = (NotificationCenter(), Notification.Name("time set"), Reads())
        await Screen.bell(Date() + 0.05, change: change, center: center)
        let cancelled = Task { await Screen.bell(Date() + 3600, change: change, center: center) }
        cancelled.cancel()
        await cancelled.value
        let bell = at(3600)
        // A child task, so the suite's time limit cancels a wait that never ends: the test fails.
        async let rung: Date = {
            await Screen.bell(bell, change: change, center: center) { reads.now() }
            return reads.clock.now()
        }()
        // Read once, its observer is registered: a change posted now is seen, and looked at — a
        // second read — short of the bell, which ends nothing (santa's review: no timing).
        try await eventually { reads.reads >= 1 }
        center.post(name: change, object: nil)
        try await eventually { reads.reads >= 2 }
        reads.clock.turn(by: 3600)
        center.post(name: change, object: nil)
        #expect(await rung >= bell)
    }
}
