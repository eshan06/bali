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
    /// `protection`, what rule 3's check found, nil until the enforcer runs; `sync`, the engine's
    /// truth, nil until it runs; `hasClasses`, nil while `/v1/me` has not answered (C2);
    /// `lastSessionOver`, a session the phone was in that ended, until the student dismisses it (C5).
    public static func choose(
        problem: String?, introSeen: Bool, signedIn: Bool?, protection: Protection?,
        sync: SyncState?, hasClasses: Bool?, lastSessionOver: SessionView?, now: Date
    ) -> Screen {
        if let problem { return .storage(problem) }
        if !introSeen { return .intro }
        guard let signedIn, let protection, let sync else { return .starting }
        if !signedIn { return .signIn }
        if protection.permission != .approved { return .screenTime }
        // A tap not yet answered holds the shields on (decision 7), whatever the phone stood in —
        // unless the student unlocked after it (decision 11), or its cap has passed: the standing's
        // own screen then, as the enforcer's `shieldedUntil` has it.
        if let held = sync.tapHeldUntil, held > now { return .focus }
        switch sync.standing {
        // Not read from the phone yet: home says so, and Emergency Unlock works there (B6b).
        case .unread: return .home
        case .inSession(_, .focused?): return .focus
        case .inSession(_, .unlocked?): return .unlocked
        case .inSession(_, .protectionOff?): return .protectionOff
        // A state this build does not know: home, which says what it knows — never focus, which
        // the enforcer does not shield for, and never an unlock the student did not make.
        case .inSession(_, nil): return .home
        case .waiting: return .waiting
        case .out where lastSessionOver != nil: return .sessionOver
        case .out: return hasClasses == false ? .join : .home
        }
    }
}

extension SignInError {
    /// What the Sign in screen says under its button when a sign-in did not finish (rule 5): the
    /// kind of failure in plain words, and another try as the way — nil for a sign-in the student
    /// closed: nothing changed, nothing to say.
    public var words: String? {
        switch self {
        case .cancelled: nil
        case .unreachable: "Can't reach the sign-in server. Check your connection and try again."
        case .refused(let reason):
            "The sign-in was refused" + (reason.map { " (\($0))" } ?? "")
                + ". Try again, or ask your teacher."
        case .notKept: "Your phone couldn't keep the sign-in. Try again."
        }
    }
}
