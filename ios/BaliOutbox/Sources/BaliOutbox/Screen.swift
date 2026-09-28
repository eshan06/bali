import BaliCore
import Foundation

/// Which screen the student app shows (C1–C6), from what the phone knows: the one place that decides
/// it. A view renders its screen and calls the engine, the enforcer or the sign-in — no rule lives
/// in one — so every rule here runs on Linux.
public enum Screen: Sendable, Hashable {
    /// Nothing known yet: the sign-in, the engine or the enforcer has not spoken.
    case starting
    case intro, signIn, screenTime, join, home, waiting, focus, unlocked, protectionOff, sessionOver
    /// The app could not start — its storage would not open, or its build is not set up — with why,
    /// shown with a way to try again (rule 5).
    case storage(String)

    /// The screen for what the phone knows at `now`: `problem`, why the app could not start;
    /// `introSeen`, the phone's own flag (C1); `signedIn`, nil until the Keychain could be read;
    /// `protection`, what rule 3's check found, nil until the enforcer runs and unchecked until its
    /// first pass; `everApproved`, whether a pass has ever read the permission approved (C1b) —
    /// Family Controls can read not determined for a moment after a launch (B5a-2), and with this
    /// set such a read routes as approved, while denied never does; `sync`, the engine's truth, nil
    /// until it runs; `hasClasses`, nil while `/v1/me` has not answered (C2); `lastSessionOver`, a
    /// session the phone was in that ended, until the student dismisses it (C5).
    public static func choose(
        problem: String?, introSeen: Bool, signedIn: Bool?, protection: Protection?,
        everApproved: Bool, sync: SyncState?, hasClasses: Bool?, lastSessionOver: SessionView?,
        now: Date
    ) -> Screen {
        if let problem { return .storage(problem) }
        // The shields on — the enforcer's own rule, so the screen and the shields agree: focused in
        // a session the phone's own clock says still runs (decision 6), or a tap not yet answered
        // holding them (decision 7, to its cap; not after decision 11's unlock, nor refused) — is
        // focus before anything else, the intro seen or not, signed out or not: the focus screen
        // holds Emergency Unlock, always allowed.
        if let sync, sync.shieldedUntil(now) != nil { return .focus }
        // Where the phone stood not read, the last run's shields kept on (B6b): home, which holds
        // Emergency Unlock there, before the intro and the sign-in too.
        if sync?.standing == .unread, protection?.shielded == true { return .home }
        if !introSeen { return .intro }
        guard let signedIn, let protection, protection.checked, let sync else { return .starting }
        if !signedIn { return .signIn }
        switch sync.standing {
        // Not read from the phone yet: home says so, and Emergency Unlock works there (B6b).
        case .unread: return .home
        // In a session still running: its state's screen, whatever the permission reads — taken
        // back mid-session, the check reports protection off, whose screen says how back. Focused
        // is the rule above; a state this build does not know is home — never focus, which the
        // enforcer does not shield for, and never an unlock the student did not make.
        case .inSession(let session, let state) where session.endsAt > now:
            switch state {
            case .unlocked?: return .unlocked
            case .protectionOff?: return .protectionOff
            default: return .home
            }
        // No session runs by the phone's clock — the bell rung, no read yet; waiting; out — so the
        // permission not approved is Screen Time; past the bell, home until a read says where the
        // phone stands (C5 may say session over).
        case .inSession, .waiting, .out:
            let approved =
                protection.permission == .approved
                || (everApproved && protection.permission == .notDetermined)
            if !approved { return .screenTime }
            switch sync.standing {
            case .waiting: return .waiting
            case .out where lastSessionOver != nil: return .sessionOver
            case .out where hasClasses == false: return .join
            default: return .home
            }
        }
    }
}

extension SignInError {
    /// What the Sign in screen says under its button when a sign-in did not finish (rule 5): the
    /// kind of failure in plain words, and another try as the way — nil for a sign-in the student
    /// closed: nothing changed, nothing to say. A refusal's OAuth code is never shown: the codes
    /// that mean something to a student have their own words, the rest one line (the readout has
    /// the code).
    public var words: String? {
        switch self {
        case .cancelled: nil
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
                "Screen Time access is turned off for Bali, so nothing pauses during class and your teacher sees 'Screen Time off'. Turn it on in Settings → Screen Time → Apps with Screen Time Access. iOS may not ask again here.",
                "Ask again", "Open Settings"
            )
        case .approved, .notDetermined:
            (
                "iOS asks once. Bali uses Screen Time only to pause apps while your class is in focus. Turning it off later is always possible, and your teacher simply sees 'Screen Time off'.",
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
