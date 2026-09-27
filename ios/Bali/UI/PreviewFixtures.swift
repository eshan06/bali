#if DEBUG
    import BaliCore
    import BaliOutbox
    import Foundation

    /// Named states of the app, from its real types, for every screen's `#Preview` and for the
    /// Simulator with no server: `xcrun simctl launch booted com.bali.Bali -bali-screen <name>`
    /// renders that fixture in place of the live phone (`BaliApp`), frozen — nothing signs in,
    /// syncs or shields, and its Try again does nothing. Debug builds only.
    enum PreviewFixtures {
        /// What `Phone` publishes, as a fixture has it: signed in, the permission approved, out of
        /// any session, unless said otherwise.
        struct State {
            var problem: String?
            var introSeen = true
            var signedIn: Bool? = true
            var protection: Protection? = approved
            var sync: SyncState? = standing(.out)
        }

        /// Each named for the screen it shows (`AppTests.fixtures` pins that).
        static let all: [String: State] = [
            "starting": State(signedIn: nil, protection: nil, sync: nil),
            "intro": State(introSeen: false),
            "signIn": State(signedIn: false),
            "screenTime": State(protection: Protection()),
            "home": State(),
            "waiting": State(sync: standing(.waiting)),
            "focus": State(protection: shielded, sync: standing(.inSession(period3, .focused))),
            "unlocked": State(sync: standing(.inSession(period3, .unlocked))),
            "protectionOff": State(sync: standing(.inSession(period3, .protectionOff))),
            "storage": State(
                problem: "The outbox could not be opened: SQLite error 14: unable to open database",
                signedIn: nil, protection: nil, sync: nil),
        ]

        /// The fixture `arguments` name — `-bali-screen <name>` — or nil: none named, or a name
        /// not known, and the live app shows.
        static func chosen(from arguments: [String] = CommandLine.arguments) -> State? {
            guard let flag = arguments.firstIndex(of: "-bali-screen"), flag + 1 < arguments.count
            else { return nil }
            return all[arguments[flag + 1]]
        }

        /// A class whose bell is 27 minutes away.
        private static let period3 = SessionView(
            id: "session", classId: "class", endsAt: Date() + 27 * 60)

        private static let approved = {
            var protection = Protection()
            protection.permission = .approved
            return protection
        }()

        private static let shielded = {
            var protection = approved
            (protection.shielded, protection.until) = (true, period3.endsAt)
            return protection
        }()

        /// The engine's truth, standing `standing`, the server reached a moment ago.
        private static func standing(_ standing: Standing) -> SyncState {
            var state = SyncState()
            (state.standing, state.link, state.heardAt) = (standing, .reached, Date())
            return state
        }
    }
#endif
