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
        /// any session and in two classes, no ask for the permission failed, nothing typed to join
        /// and no screen opened over another, unless said otherwise.
        struct State {
            var problem: String?
            var introSeen = true
            var signedIn: Bool? = true
            var protection: Protection? = permission(.approved)
            var sync: SyncState? = standing(.out)
            var askFailed: ScreenTimeAskError?
            var joining = Joining()
            var opened: [Screen] = []
        }

        /// Each named for the screen it shows, then a state of it (`AppTests.fixtures` pins that).
        static let all: [String: State] = [
            "starting": State(signedIn: nil, protection: nil, sync: nil),
            "intro": State(introSeen: false),
            "signIn": State(signedIn: false),
            "screenTime": State(protection: permission(.notDetermined)),
            "screenTimeDenied": State(protection: permission(.denied)),
            "screenTimeError": State(
                protection: permission(.notDetermined),
                askFailed: .failed("FamilyControlsError.networkError")),
            "join": State(sync: standing(.out, me: ana(newcomer: true)), joining: joining()),
            "joinPreview": State(
                sync: standing(.out, me: ana(newcomer: true)),
                joining: joining(opens: period3Preview)),
            "joinError": State(
                sync: standing(.out, me: ana(newcomer: true)),
                joining: joining(failure: Joining.words(.status(404), .classNotFound))),
            "joinFromHome": State(joining: joining(), opened: [.join]),
            "home": State(),
            "homeLoading": State(sync: standing(.out, me: nil)),
            "homeError": State(sync: standing(.out, me: nil, failed: .networkError)),
            "homeUnread": State(sync: standing(.unread)),
            "waiting": State(sync: standing(.waiting)),
            "waitingError": State(sync: standing(.waiting, failed: .networkError)),
            "focus": State(protection: shielded(), sync: standing(.inSession(period3, .focused))),
            "focusFinal": State(
                protection: shielded(), sync: standing(.inSession(lastMinutes, .focused))),
            "focusOffline": State(
                protection: shielded(), sync: offline(standing(.inSession(period3, .focused)))),
            "focusTapHeld": State(protection: shielded(), sync: offline(heldTap())),
            "focusNoShields": State(protection: screenTimeOff(), sync: heldTap()),
            "focusUnscheduled": State(
                protection: shielded(unscheduled: true),
                sync: standing(.inSession(period3, .focused))),
            "unlocked": State(sync: standing(.inSession(period3, .unlocked))),
            "protectionOff": State(sync: standing(.inSession(period3, .protectionOff))),
            "storage": State(
                problem: "The outbox could not be opened: SQLite error 14: unable to open database",
                signedIn: nil, protection: nil, sync: nil),
        ]

        /// The fixture `arguments` name — `-bali-screen <name>` — or nil: none named, or a name
        /// not known, and the live app shows.
        static func chosen(from arguments: [String] = CommandLine.arguments) -> State? {
            value(of: "-bali-screen", in: arguments).flatMap { all[$0] }
        }

        /// What follows `flag` in `arguments`, if anything does: `-bali-screen <name>`, or the
        /// intro's `-bali-intro-page <n>`.
        static func value(of flag: String, in arguments: [String] = CommandLine.arguments)
            -> String?
        {
            guard let at = arguments.firstIndex(of: flag), at + 1 < arguments.count else {
                return nil
            }
            return arguments[at + 1]
        }

        /// A class whose bell is 27 minutes away — Period 3's, with Ms. Rivera — and one whose bell
        /// is 1:52 away (D1's FocusFinal).
        private static let period3 = SessionView(id: "session", classId: "p3", endsAt: Date() + 27 * 60)
        private static let lastMinutes = SessionView(
            id: "session", classId: "p3", endsAt: Date() + 112)

        /// What `KWX49Q` opens, as `GET /v1/join-codes/{code}` answers: Period 3, with Ms. Rivera.
        private static let period3Preview = try? BaliJSON.makeDecoder().decode(
            JoinCodePreviewResponse.self,
            from: Data(
                #"{"class":{"id":"class","name":"Period 3 — Algebra II"},"teacher":{"displayName":"Ms. Rivera"},"alreadyEnrolled":false}"#
                    .utf8))

        /// The Join screen with `KWX49Q` typed: what it `opens`, once looked up, or why not.
        private static func joining(opens: JoinCodePreviewResponse? = nil, failure: String? = nil)
            -> Joining
        {
            var joining = Joining()
            (joining.code, joining.preview, joining.failure) = ("KWX49Q", opens, failure)
            return joining
        }

        /// What rule 3's check found: `permission`, checked.
        private static func permission(_ permission: Permission) -> Protection {
            var protection = Protection()
            (protection.checked, protection.permission) = (true, permission)
            return protection
        }

        /// The check found the shields on — and, `unscheduled`, iOS refusing the wake at the bell.
        private static func shielded(unscheduled: Bool = false) -> Protection {
            var protection = permission(.approved)
            (protection.shielded, protection.unscheduled) = (true, unscheduled)
            return protection
        }

        /// The check judged the permission taken back: iOS dropped every shield.
        private static func screenTimeOff() -> Protection {
            var protection = permission(.denied)
            protection.permissionOff = true
            return protection
        }

        /// `state` with no answer from the server.
        private static func offline(_ state: SyncState) -> SyncState {
            var state = state
            state.link = .unreachable
            return state
        }

        /// Out of any session, a tap made as the fixture was, not answered yet (decision 7's cap) —
        /// kept in an outbox of the fixture's own, since only an outbox makes one.
        private static func heldTap() -> SyncState {
            var state = standing(.out)
            let url = FileManager.default.temporaryDirectory.appending(
                path: "fixture-\(UUID().uuidString).sqlite")
            let outbox = try? Outbox(at: url)
            _ = try? outbox?.record(.tap(tagId: "fixture"), now: Date())
            state.queued = (try? outbox?.records()) ?? []
            return state
        }

        /// The engine's truth, standing `standing`, the server reached a moment ago, `GET /v1/me`
        /// answering `me` — its last read `failed`, and the link down, when said.
        private static func standing(
            _ standing: Standing, me: MeResponse? = ana(), failed: SendResult? = nil
        ) -> SyncState {
            var state = SyncState()
            (state.standing, state.link, state.heardAt, state.me) = (standing, .reached, Date(), me)
            if let failed { (state.meFailed, state.link) = (failed, .unreachable) }
            return state
        }

        /// Ana, as `GET /v1/me` answers her: in Period 3 with Ms. Rivera and Period 5 with Mr.
        /// Okafor — or, a `newcomer`, in no class yet.
        private static func ana(newcomer: Bool = false) -> MeResponse? {
            let classes =
                newcomer
                ? ""
                : #"{"id":"p3","name":"Period 3 — Algebra II","teacher":{"displayName":"Ms. Rivera"}},{"id":"p5","name":"Period 5 — Chemistry","teacher":{"displayName":"Mr. Okafor"}}"#
            return try? BaliJSON.makeDecoder().decode(
                MeResponse.self,
                from: Data(
                    #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[\#(classes)],"session":null}"#
                        .utf8))
        }
    }
#endif
