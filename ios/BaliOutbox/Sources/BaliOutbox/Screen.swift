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
    /// first pass; `sync`, the engine's truth, nil until it runs; `hasClasses`, nil while `/v1/me`
    /// has not answered (C2); `lastSessionOver`, a session the phone was in that ended, until the
    /// student dismisses it (C5).
    public static func choose(
        problem: String?, introSeen: Bool, signedIn: Bool?, protection: Protection?,
        sync: SyncState?, hasClasses: Bool?, lastSessionOver: SessionView?, now: Date
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
            if protection.permission != .approved { return .screenTime }
            switch sync.standing {
            case .waiting: return .waiting
            case .out where lastSessionOver != nil: return .sessionOver
            case .out where hasClasses == false: return .join
            default: return .home
            }
        }
    }
}
