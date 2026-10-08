import BaliCore
import Foundation

/// Which screen the student app shows (C1–C6), from what the phone knows: the one place that decides
/// it. A view renders its screen and calls the engine, the enforcer or the sign-in — no rule lives
/// in one — so every rule here runs on Linux.
public enum Screen: Sendable, Hashable {
    /// Nothing known yet: the sign-in, the engine or the enforcer has not spoken.
    case starting
    /// The 13+ check (C7): the question, and the stop screen an answer under 13 gets.
    case age, tooYoung
    /// Your name (the approved Sign in & sign up design; the owner's decision, 2026-10-07): a
    /// student's account with no name names itself, so a teacher always sees a real one.
    case name
    case intro, signIn, screenTime, join, home, waiting, focus, unlocked, protectionOff, sessionOver
    /// Home's neighbours in D1's tab bar (C6): the student's own history, and Me.
    case history, me
    /// Me's Delete account under way, stopped or done (C4b; `Deleting`): its own screen, over every
    /// other from the press to the end, the shields' Focus included — the deletion ends the session
    /// itself, and an unlock made meanwhile would wait for the next sign-in (DECISIONS, C4a).
    case deleting
    /// The app could not start — its storage would not open, or its build is not set up — with why,
    /// shown with a way to try again (rule 5).
    case storage(String)

    /// The screen for what the phone knows at `now`: `problem`, why the app could not start;
    /// `deleting`, whether Me's Delete account has its own screen to show (C4b, `Deleting.shows`),
    /// before everything but a start that failed — nothing else is offered from the press to the
    /// end; `age`, the 13+ check's answer (C7) — its question in place of Sign in once Sign up
    /// was pressed with it not passed (the approved Sign in & sign up design), the stop screen
    /// there once answered under 13, and, signed in with it not passed, the question before
    /// anything but a session's screens; `intro`, whether Sign up shows the intro next, before its
    /// page (C1) — a first launch opens on Sign in, and Sign in shows none;
    /// `signedIn`, nil until the Keychain could be read; `signedInThisRun`, whether a sign-in
    /// reached Bali's API this run — made here, or let through by the 13+ check passed under it —
    /// rather than kept from the last: the starting screen then holds where Your name could show
    /// until `sync`'s read of `GET /v1/me` answers or fails;
    /// `protection`, what rule 3's check found, nil until the enforcer runs and unchecked until its
    /// first pass; `everApproved`, whether a pass has ever read the permission approved (C1b) —
    /// Family Controls can read not determined for a moment after a launch (B5a-2), and with this
    /// set such a read routes as approved, while denied never does; `sync`, the engine's truth,
    /// nil until it runs — its `me` naming a student's account with no name, Your name where the
    /// question would show; in no class, never in one or removed from their last, the student
    /// lands on Home and its empty state, never a Join of its own (the owner's ruling, 2026-10-07);
    /// `sessionOverClosed`,
    /// the session whose Session over the student closed, as it was then — its bell moved since, an
    /// extension, it is another's to close (C5b; its review); `opened`, the
    /// screens the student opened over the one chosen, in order (C3) — Home over Waiting (Waiting's
    /// Back to home: the regular Home, its card saying the wait; #151), Join over Home (Home's Join
    /// a class, with a way back) — each shown only while the one under it shows, never over
    /// anything else — and Home over Unlocked, its primary way on (C5c); `tab`, the one chosen in
    /// D1's tab bar (C6a) — History or Me in place of the router's own Home with nothing opened
    /// over it, or of a Home opened over Unlocked or Waiting, and nowhere else: never over the
    /// shields, a session's screens, Waiting itself, the sign-in, the intro, Screen Time, nor the
    /// home the last run's shields keep (B6b). And whether the tab bar shows: wherever a tab is
    /// honoured — in the same answer, at the same `now`, so the screen and its bar never disagree,
    /// at a bell either (C6a's review).
    public static func choose(
        problem: String?, deleting: Bool, age: AgeCheck.Answer, intro: Bool, signedIn: Bool?,
        signedInThisRun: Bool, protection: Protection?, everApproved: Bool, sync: SyncState?,
        sessionOverClosed: SessionView?, opened: [Screen], tab: Screen, now: Date
    ) -> (screen: Screen, tabbed: Bool) {
        if let problem { return (.storage(problem), false) }
        // Delete account pressed (C4b): its screen and nothing else — not Focus either, whose
        // Emergency Unlock would wait for the next sign-in; the deletion takes the shields off
        // itself, as the question said.
        if deleting { return (.deleting, false) }
        // The shields on — the enforcer's own rule, so the screen and the shields agree: focused in
        // a session the phone's own clock says still runs (decision 6), or a tap not yet answered
        // holding them (decision 7, to its cap; not after decision 11's unlock, nor refused) — is
        // focus before anything else, signed out or not: the focus screen holds Emergency Unlock,
        // always allowed.
        if let sync, sync.shieldedUntil(now) != nil { return (.focus, false) }
        // Where the phone stood not read, the last run's shields kept on (B6b): home, which holds
        // Emergency Unlock there, before the sign-in too.
        if sync?.standing == .unread, protection?.shielded == true { return (.home, false) }
        guard let signedIn, let protection, protection.checked, let sync else {
            return (.starting, false)
        }
        // Signed out: Sign in — or, Sign up pressed with the 13+ check not passed (C7), its
        // question in place, the stop screen once answered under 13, then the intro where Sign up
        // shows it. The shields' screens above keep Emergency Unlock before them.
        if !signedIn {
            switch age {
            case .asked: return (.age, false)
            case .tooYoung: return (.tooYoung, false)
            case .unanswered, .passed: return (intro ? .intro : .signIn, false)
            }
        }
        // Signed in, before Screen Time or Home — never over a session's screens, one whose bell
        // has not rung or past it with Session over not closed, nor the home a standing not read
        // keeps: on a phone that has not passed the check (the gap's fallback, the owner's
        // decision 2026-10-06), the question, a sign-in Cognito's own pages made around it
        // reaching Bali's API with nothing until it is answered (`SignIn`'s `cleared`); then Your
        // name (the owner's decision, 2026-10-07), for a student's account `GET /v1/me` names with
        // no name. Not known until a read answers: a sign-in made this run holds the starting
        // screen until one answers or fails — the phone's storage failing, none can be tried — so
        // no other screen flashes before Your name (the owner's ruling, 2026-10-07); a failed one,
        // or a sign-in kept from the last run, lets the screens go on, and Your name shows once a
        // read answers.
        switch sync.standing {
        case .inSession(let session, _)
        where session.endsAt > now || !session.rings(as: sessionOverClosed):
            break
        case .unread: break
        case .inSession, .waiting, .out:
            if age != .passed { return (age == .tooYoung ? .tooYoung : .age, false) }
            if signedInThisRun, sync.me == nil, sync.meFailed == nil, sync.link != .storageFailed {
                return (.starting, false)
            }
            if let user = sync.me?.user, user.role.known == .student, user.displayName == nil {
                return (.name, false)
            }
        }
        var shown = settled(sync, protection, everApproved, sessionOverClosed, now)
        // Home with its tab bar: the router's own, or opened over Unlocked — its primary way
        // on, the apps still open (the owner's ruling, 2026-09-30; C5c) — or over Waiting, the
        // regular Home there (the owner's decision, 2026-10-01; #151). Join opened has none.
        var tabbed = shown == .home
        for screen in opened {
            switch (shown, screen) {
            case (.home, .join), (.waiting, .home), (.unlocked, .home):
                (tabbed, shown) = (screen == .home, screen)
            // A Home opened over a screen that has since become Home itself — Unlocked's, after
            // its bell (santa's round 1) — is that Home: no screen of its own.
            case (.home, .home): continue
            default: return (shown, false)
            }
        }
        return tabbed ? (tab == .history || tab == .me ? tab : .home, true) : (shown, false)
    }

    /// The screen of where the phone stands, signed in and its permission checked.
    private static func settled(
        _ sync: SyncState, _ protection: Protection, _ everApproved: Bool,
        _ sessionOverClosed: SessionView?, _ now: Date
    ) -> Screen {
        switch sync.standing {
        // Not read from the phone yet: home says so, and Emergency Unlock works there (B6b).
        case .unread: return .home
        // In a session still running: its state's screen — and protection off, whatever the state,
        // once the check judges the permission off (denied, or not determined past B5a-2's
        // grace): the check reports it within a moment, and that screen says how back (Settings or
        // iOS's prompt, which puts the phone back where it stood, #167), where Screen Time's would
        // not (C5b). Focused is the rule above; a state
        // this build does not know is home — never focus, which the enforcer does not shield for,
        // and never an unlock the student did not make.
        case .inSession(let session, let state) where session.endsAt > now:
            if state == .protectionOff || protection.permissionOff { return .protectionOff }
            return state == .unlocked ? .unlocked : .home
        // No session runs by the phone's clock — the bell rung, no read yet; waiting; out — so the
        // permission not approved is Screen Time; past the bell, session over until a read says
        // where the phone stands or the student closes it (C5b).
        case .inSession, .waiting, .out:
            let approved =
                protection.permission == .approved
                || (everApproved && protection.permission == .notDetermined)
            if !approved { return .screenTime }
            switch sync.standing {
            case .waiting: return .waiting
            case .inSession(let session, _) where !session.rings(as: sessionOverClosed):
                return .sessionOver
            default: return .home
            }
        }
    }
}

extension SessionView {
    /// Whether `other` is this session with the same bell: to the second — an extension moves it
    /// by minutes, while the copy the file keeps is written to the millisecond, rounded down, so
    /// it can read a millisecond off the server's (santa's round 1).
    func rings(as other: SessionView?) -> Bool {
        other.map { $0.id == id && abs($0.endsAt.timeIntervalSince(endsAt)) < 1 } ?? false
    }
}

extension Screen {
    /// Returns at `bell` by the phone's own clock, `now` — where the router chooses again (C5a) —
    /// or once cancelled: slept towards, and looked at again at each `change` posted to `center`,
    /// iOS saying the time was set. A sleep counts only the time that passes: with the clock set
    /// forward past the bell, it would wait out the time left (C5a's review).
    public static func bell(
        _ bell: Date, change: Notification.Name, center: NotificationCenter = .default,
        now: @escaping @Sendable () -> Date = Date.init
    ) async {
        let (looks, look) = AsyncStream.makeStream(
            of: Void.self, bufferingPolicy: .bufferingNewest(1))
        let observer = center.addObserver(forName: change, object: nil, queue: nil) { _ in
            look.yield()
        }
        let sleeper = Task {
            repeat {
                try? await Task.sleep(for: .seconds(max(0, bell.timeIntervalSince(now()))))
                look.yield()
            } while now() < bell && !Task.isCancelled
        }
        defer {
            sleeper.cancel()
            center.removeObserver(observer)
        }
        for await _ in looks where now() >= bell { return }
    }
}

extension SyncState {
    /// Whether the screens the student opened over another (C3) — and the tab they chose (C6a) —
    /// stay once the engine's state is this, after `before`, at `now`: not once the standing
    /// changes, nor once a tap is made or answered (a new arming is Waiting's again). The classes
    /// read change nothing: in none, the router's own is Home too (#143; the owner's ruling,
    /// 2026-10-07), so Join opened over it, its code typed, and a tab chosen there stay. A read
    /// saying out, or the same class still past its bell (santa's round 1), once the bell has rung
    /// by the phone's clock changes nothing the student sees — the class was over for the phone
    /// already — so History chosen from Session over holds (C5b's hand-off).
    public func keepsOpened(from before: SyncState?, at now: Date) -> Bool {
        var over = false
        if case .inSession(let ended, _)? = before?.standing, ended.endsAt <= now {
            switch standing {
            case .out: over = true
            case .inSession(let session, _): over = session.rings(as: ended)
            case .waiting, .unread: over = false
            }
        }
        return (standing == before?.standing || over)
            && pendingTap?.eventId == before?.pendingTap?.eventId
    }

    /// What Home and Waiting say of the latest tap the server refused (rule 5; kept and retried
    /// until recorded, ARCHITECTURE tap step 10) or the retry bound left unsettled: keyed on the
    /// refusal the record keeps, whatever answers came since (the riders), else its last answer —
    /// a refusal where `tapDisposition` says one; nil while none is stuck. An answer the outbox
    /// only retries (401, 408, 429, a server error, none) says nothing of why it is stuck: short of
    /// the bound's count of answers only a refusal stuck it — one a file older than its kept
    /// refusal holds — whose words stand; at the bound, it is still being sent (#114's review) —
    /// never "tap in again" then. Only while it is the phone's newest tap (#146): once the student
    /// taps again, the later tap is the one that counts — still kept and retried, it says nothing
    /// more (the readout lists it). A file that names no tap leaves the latest stuck one said. On
    /// Home in no class, which has no Tap in (#143), the way on is the Try again beside it (#160's
    /// review).
    public var refusedTapWords: String? {
        let stuck = queued.last { if case .tap = $0.change { $0.stuck } else { false } }
        guard let stuck, (lastTap ?? stuck.eventId) == stuck.eventId else { return nil }
        let tapAgain =
            inNoClass
            ? "Bali couldn't record a tap. Try again, or ask your teacher."
            : "Bali couldn't record a tap. Tap in again, or ask your teacher."
        switch stuck.refusedStatus ?? stuck.lastStatus {
        case 404?:
            return
                "Bali doesn't know a block you tapped, so that tap hasn't counted. Ask your teacher to set it up."
        case let status? where tapDisposition(.status(status), nil) == .retryAndSurface:
            return tapAgain
        default:
            return stuck.answers < Outbox.bound
                ? tapAgain : "Bali couldn't record a tap yet. It keeps trying."
        }
    }

    /// Home's card while a class of the student's is in session and they are not focused in it
    /// (C3c; the conductor's decision under the owner's delegation, 2026-09-30), at `now` by the
    /// phone's clock: unlocked there — Home opened over Unlocked — or, out, a class in session by
    /// the last read of `GET /v1/me`; gone at its bell. Nil otherwise: Protection off, Focus and
    /// Waiting are their own screens.
    public func inSessionCard(
        at now: Date, time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) -> InSessionCard? {
        switch standing {
        case .inSession(let session, .unlocked?) where session.endsAt > now:
            let name = me?.classes.first { $0.id == session.classId }?.name ?? "your class"
            return InSessionCard(
                unlocked: true, bell: session.endsAt,
                words: "You're unlocked in \(name) until \(session.endsAt.formatted(time)).",
                retap: UnlockedWords(self)?.retap)
        case .out:
            guard
                let running = me?.classes.first(where: { ($0.liveSession?.endsAt ?? now) > now }),
                let bell = running.liveSession?.endsAt
            else { return nil }
            return InSessionCard(
                unlocked: false, bell: bell,
                words: "\(running.name) is in session. Tap your teacher's block to join.")
        case .inSession, .waiting, .unread: return nil
        }
    }

    /// What Home's card says while the phone waits for its teacher's Start (#151; the owner's
    /// decision, 2026-10-01): Waiting's Back to home lands on the regular Home, which says the tap
    /// counted and when the phone locks, in the hero's place — as C3c's card does — never "Tap
    /// your teacher's block" as if it had not. Nil otherwise.
    public var waitingCard: String? {
        standing == .waiting
            ? "You're tapped in. Your phone locks when class starts, as long as Bali is open." : nil
    }

    /// Out of any session, `GET /v1/me` listing the student in no class: Home's empty state, Tap in
    /// no way in for them, since a tap joins only a class the student is in (#143).
    var inNoClass: Bool { standing == .out && hasClasses == false }

    /// What Home's card says in the hero's place there, with Join a class (#143; the owner's
    /// ruling, 2026-10-07: Home, never a forced Join): to a student never in a class on this phone
    /// (`everInClass`), not in one yet; to one removed from their last, or having left it, in none
    /// any more, as it said since #143. Nil anywhere else.
    public func noClassesCard(everInClass: Bool) -> String? {
        guard inNoClass else { return nil }
        return everInClass
            ? "You're not in any classes. Join one with the class code from your teacher."
            : "You're not in a class yet. Join one with the class code from your teacher."
    }

    /// What Home and Waiting say while `GET /v1/me` gives no answer (rule 5), beside Try again: in
    /// the Join screen's words; nil while none failed.
    public var meWords: String? { meFailed.map { Joining.words($0, nil) } }

    /// What the screen the student lands on says of a Back to focus the server refused — dropped,
    /// never sent again — with the way back, a re-tap (C5b; rule 5): while the phone stands in that
    /// class and its bell has not rung by the phone's clock (`now`). Once the class is over for the
    /// phone the words would be stale (santa's review): nil then, and while none was refused since
    /// the phone's last change.
    public func refusedRefocusWords(at now: Date) -> String? {
        guard case .inSession(let session, _) = standing, session.endsAt > now else { return nil }
        return refusedRefocus(in: session.id)
    }

    /// The words for a Back to focus the server refused in `session`, the class the phone stands in.
    func refusedRefocus(in session: String) -> String? {
        guard let refused, refused.change == .refocus(session: session) else { return nil }
        return refused.reason == .protectionOff
            ? "Bali couldn't lock your apps again, because Screen Time was off during this class. Tap your teacher's block to lock them again."
            : "Bali couldn't lock your apps again. Tap your teacher's block to lock them again, or ask your teacher."
    }

    /// What Session over says (C5b; D1's SessionOver) of the session the phone stands in, its bell
    /// rung: the class and when — and that every app is back only once rule 3's check found no
    /// shield on; nil standing in none.
    public func sessionOverWords(
        _ protection: Protection?, time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) -> String? {
        guard case .inSession(let session, _) = standing else { return nil }
        let name = me?.classes.first { $0.id == session.classId }?.name ?? "Your class"
        let ended = "\(name) ended at \(session.endsAt.formatted(time))."
        return protection?.shielded == false ? ended + " All your apps are back." : ended
    }
}

/// Home's card for a class in session (C3c): `unlocked` there, its way back Lock my apps again —
/// or, `retap`, why a re-tap is (Unlocked's own rule) — else not in it, its way in Tap in; what it
/// says, and its bell, when it goes.
public struct InSessionCard: Sendable, Hashable {
    public let unlocked: Bool
    public let bell: Date
    public let words: String
    public var retap: String? = nil
}

extension BlockRead {
    /// What Home says under Tap in when a scan recorded no tap (rule 5): nil for a block's code —
    /// the tap — and for a scan the student closed, which changed nothing.
    public var words: String? {
        switch self {
        case .block, .cancelled: nil
        case .notBali: "That isn't a Bali block. Hold your phone to your teacher's block."
        case .unsupported:
            "This iPhone can't read Bali blocks, so it can't tap in. Ask your teacher."
        case .failed: "The scan didn't finish. Try again."
        }
    }

    /// What Home says when a block was read but the phone could not keep its tap (rule 5).
    public static let notKept = "Your phone couldn't save the tap. Try again."
}

extension SignInError {
    /// What the Sign in screen says under its buttons when a sign-in through `page` did not finish
    /// (rule 5): the kind of failure in plain words, and another try as the way — nil for a page
    /// the student closed: nothing changed, nothing to say. A refusal's OAuth code is never shown:
    /// the codes that mean something to a student have their own words, the rest one line (the
    /// readout has the code). Only a page that could not open names its page.
    public func words(on page: HostedPage) -> String? {
        switch self {
        case .cancelled: nil
        case .notOpened where page == .signUp:
            "The sign-up page couldn't open. Try again, or ask your teacher."
        case .notOpened: "The sign-in page couldn't open. Try again, or ask your teacher."
        case .unreachable: "Can't reach the sign-in server. Check your connection and try again."
        case .refused("access_denied"?):
            "The sign-in server didn't allow this sign-in. Ask your teacher."
        case .refused("server_error"?), .refused("temporarily_unavailable"?):
            "The sign-in server isn't working right now. Try again in a moment."
        case .refused: "The sign-in was refused. Try again, or ask your teacher."
        case .notKept: "Your phone couldn't keep the sign-in. Try again."
        }
    }
}

extension Permission {
    /// What the Screen Time screen says (C1b) under "Let Bali pause apps during class", from the
    /// permission as rule 3's check last read it — nothing granted yet, or taken back, at the
    /// prompt or in Settings, with the way back — and its buttons: the ask, and once denied
    /// Settings before it, as the primary action. iOS may not prompt again from denied, so Settings
    /// is the sure way back and the body never promises a prompt; the ask stays, second — should
    /// iOS not prompt, the screen reads denied again (#105's review).
    public var screenTimeWords: (body: String, ask: String, settings: String?) {
        switch self {
        case .denied:
            (
                "Screen Time access is turned off for Bali, so nothing pauses during class and your teacher sees that it's off. Turn it on in Settings → Screen Time → Apps with Screen Time Access. iOS may not ask again here.",
                "Ask again", "Open Settings"
            )
        case .approved, .notDetermined:
            (
                "iOS asks once. Bali uses Screen Time only to pause apps while your class is in focus. Turning it off later is always possible, and your teacher simply sees that it's off.",
                "Ask me", nil
            )
        }
    }
}

/// Why iOS did not give the Screen Time permission when asked (C1b), as the app reads Family
/// Controls' error, and what the screen says of it (rule 5).
public enum ScreenTimeAskError: Error, Sendable, Hashable {
    /// The student tapped Don't Allow: the permission reads denied then, and the screen's body says
    /// how back — nothing more to say.
    case cancelled
    /// iOS could not ask, or would not (no passcode on the phone, a child's account, a
    /// restriction, no network): what it said, for the readout, never for the student.
    case failed(String)

    /// What the screen says of it, over `permission` as read now: once denied, Settings is the way
    /// on — another try may never prompt (#105's review).
    public func words(_ permission: Permission) -> String? {
        switch (self, permission) {
        case (.cancelled, _): nil
        case (.failed, .denied):
            "Bali couldn't ask iOS for Screen Time. Turn it on in Settings, or ask your teacher."
        case (.failed, _): "Bali couldn't ask iOS for Screen Time. Try again, or ask your teacher."
        }
    }
}
