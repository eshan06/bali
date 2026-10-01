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
        /// any session and in two classes, no ask for the permission failed, nothing typed to join,
        /// no screen opened over another, Home's tab chosen and no history read, no name being
        /// edited, no sign-out failed, no class being left and no reason picked, unless said
        /// otherwise.
        struct State {
            var problem: String?
            var introSeen = true
            var signedIn: Bool? = true
            var protection: Protection? = permission(.approved)
            var sync: SyncState? = standing(.out)
            var askFailed: ScreenTimeAskError?
            var joining = Joining()
            var opened: [Screen] = []
            var tab = Screen.home
            var history = History()
            var naming = Naming()
            var signOutFailed: String?
            var leaving = Leaving()
            var picking: UnlockReason?
            var pickFailed: String?
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
            // In no class, an unlock the bell rang on before it was sent: Sign out waits for it.
            "joinSignOutHeld": State(
                sync: queued(
                    standing(.out, me: ana(newcomer: true)),
                    .unlock(session: "session", reason: nil))),
            "home": State(),
            "homeLoading": State(sync: standing(.out, me: nil)),
            "homeError": State(sync: standing(.out, me: nil, failed: .networkError)),
            "homeUnread": State(sync: standing(.unread)),
            "homeUnreadShielded": State(protection: shielded(), sync: standing(.unread)),
            "homeFromWaiting": State(sync: standing(.waiting), opened: [.home]),
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
            "focusSuperseded": State(protection: shielded(), sync: superseded()),
            // Signed out mid-class (Cognito refused the sign-in): nothing reaches the teacher.
            "focusSignedOut": State(
                signedIn: false, protection: shielded(),
                sync: waitingOnSignIn(standing(.inSession(period3, .focused)))),
            "unlocked": State(
                sync: queued(
                    standing(.inSession(period3, .unlocked)), .unlock(session: "session", reason: nil),
                    holding: SyncEngine.reasonHold)),
            "unlockedReason": State(
                sync: queued(
                    standing(.inSession(period3, .unlocked)),
                    .unlock(session: "session", reason: .bathroom))),
            "unlockedRecorded": State(sync: standing(.inSession(period3, .unlocked))),
            "unlockedRetap": State(sync: reported(standing(.inSession(period3, .unlocked)))),
            // The reason card (C5c): on its way with the unlock, a pick waits for it; once the
            // server has it, changed to Nurse; a change on its way; one that did not go.
            "unlockedOnItsWay": State(
                sync: sending(
                    queued(
                        standing(.inSession(period3, .unlocked)),
                        .unlock(session: "session", reason: nil)))),
            "unlockedChanged": State(sync: recorded(standing(.inSession(period3, .unlocked)), .nurse)),
            "unlockedPicking": State(
                sync: recorded(standing(.inSession(period3, .unlocked)), nil), picking: .nurse),
            "unlockedPickError": State(
                sync: recorded(standing(.inSession(period3, .unlocked)), .bathroom),
                pickFailed: UnlockedWords.offline),
            // Unlocked's Home (C5c): its tab bar, the apps still open, and Back to Unlocked.
            "homeFromUnlocked": State(sync: standing(.inSession(period3, .unlocked)), opened: [.home]),
            // Protection off reported there: the card's way back is a re-tap, as Unlocked's.
            "homeFromUnlockedRetap": State(
                sync: reported(standing(.inSession(period3, .unlocked))), opened: [.home]),
            // Period 3 in session, the student not in it (C3c): its card in the hero's place.
            "homeInSession": State(sync: standing(.out, me: ana(inSession: true))),
            "history": State(tab: .history, history: anaHistory()),
            "historyEmpty": State(tab: .history, history: history(read: true)),
            "historyError": State(
                tab: .history, history: history(failure: History.words(.networkError))),
            "historyLoading": State(tab: .history, history: history(busy: true)),
            "me": State(sync: standing(.out, me: anaRodriguez), tab: .me),
            "meEditing": State(
                sync: standing(.out, me: anaRodriguez), tab: .me, naming: naming("Ana R.")),
            "meNameError": State(
                sync: standing(.out, me: anaRodriguez), tab: .me,
                naming: naming(
                    "Bea Ortiz", failure: Naming.words(.status(409), .displayNameTaken))),
            // An unlock the bell rang on before it was sent: Sign out waits for it.
            "meSignOutHeld": State(
                sync: queued(
                    standing(.out, me: anaRodriguez), .unlock(session: "session", reason: nil)),
                tab: .me),
            "meSignOutFailed": State(
                sync: standing(.out, me: anaRodriguez), tab: .me,
                signOutFailed: SignOutWords.failed),
            // Where the phone stood not read, Screen Time taken back: Me, its row Off.
            "meScreenTimeOff": State(
                protection: screenTimeOff(), sync: standing(.unread, me: anaRodriguez), tab: .me),
            // Leave (C6c): Period 3's question, the leave under way, one the server refused as the
            // lesson runs, and Leave held while the phone stands in Period 3's lesson — in a state
            // this build does not know, so Home, and so Me, can show.
            "meLeaveAsk": State(
                sync: standing(.out, me: anaRodriguez), tab: .me, leaving: leavingPeriod3()),
            "meLeaving": State(
                sync: standing(.out, me: anaRodriguez), tab: .me,
                leaving: leavingPeriod3(sent: true)),
            "meLeaveError": State(
                sync: standing(.out, me: anaRodriguez), tab: .me,
                leaving: leavingPeriod3(failure: anaRodriguez?.classes.first.map(Leaving.inSession))),
            "meLeaveInSession": State(
                sync: standing(.inSession(period3, nil), me: anaRodriguez), tab: .me),
            "unlockedRefused": State(
                sync: refused(standing(.inSession(period3, .unlocked)), .eventIdConflict)),
            "protectionOff": State(
                protection: screenTimeOff(), sync: standing(.inSession(period3, .protectionOff))),
            "protectionOffBackOn": State(sync: standing(.inSession(period3, .protectionOff))),
            "protectionOffChecking": State(
                protection: permission(.notDetermined),
                sync: standing(.inSession(period3, .protectionOff))),
            "protectionOffAsk": State(
                protection: screenTimeOff(.notDetermined),
                sync: standing(.inSession(period3, .protectionOff))),
            "protectionOffUnreported": State(
                protection: screenTimeOff(unreported: true),
                sync: standing(.inSession(period3, .unlocked))),
            "protectionOffRefused": State(
                protection: screenTimeOff(),
                sync: refused(standing(.inSession(period3, .protectionOff)), .protectionOff)),
            // What Home would say of the classes not read, said here (C5b's review).
            "protectionOffError": State(
                protection: screenTimeOff(),
                sync: standing(.inSession(period3, .protectionOff), me: nil, failed: .networkError)),
            "homeRefused": State(sync: refused(standing(.inSession(period3, nil)), .eventIdConflict)),
            "sessionOver": State(sync: standing(.inSession(periodOver, .focused))),
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

        /// A class whose bell is 27 minutes away — Period 3's, with Ms. Rivera — one whose bell
        /// is 1:52 away (D1's FocusFinal), and one whose bell rang a minute ago.
        private static let period3 = SessionView(id: "session", classId: "p3", endsAt: Date() + 27 * 60)
        private static let lastMinutes = SessionView(
            id: "session", classId: "p3", endsAt: Date() + 112)
        private static let periodOver = SessionView(
            id: "session", classId: "p3", endsAt: Date() - 60)

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

        /// Me with Period 3's Leave pressed, its question asked — `sent`, the leave under way — and
        /// why the last did not finish: `failure`.
        private static func leavingPeriod3(sent: Bool = false, failure: String? = nil) -> Leaving {
            var leaving = Leaving()
            if let period3 = anaRodriguez?.classes.first { leaving.ask(period3) }
            if sent { _ = leaving.send(at: Date()) }
            leaving.failure = failure
            return leaving
        }

        /// Me's name card editing, `name` typed — and why its save failed: `failure`.
        private static func naming(_ name: String, failure: String? = nil) -> Naming {
            var naming = Naming()
            naming.edit(name)
            naming.failure = failure
            return naming
        }

        /// The History screen, `read` or `busy` reading, or its read failed: `failure`.
        private static func history(read: Bool = false, busy: Bool = false, failure: String? = nil)
            -> History
        {
            var history = History()
            (history.read, history.busy, history.failure) = (read, busy, failure)
            return history
        }

        /// D1's History: Ana's moments today and yesterday at D1's times by this phone's clock,
        /// newest first as `GET /v1/me/history` answers — and an older page left: Show earlier.
        private static func anaHistory() -> History {
            /// `hour`:`minute`, `daysAgo` days back, as the API writes a time.
            func at(_ hour: Int, _ minute: Int, _ daysAgo: Int = 0) -> String {
                let calendar = Calendar.current
                let day = calendar.date(byAdding: .day, value: -daysAgo, to: Date()) ?? Date()
                let time = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day)
                return (time ?? day).formatted(Date.ISO8601FormatStyle())
            }
            /// Moment `id`, `type` at `time`, in Period `period` with its teacher.
            func moment(
                _ id: Int, _ type: String, _ time: String, _ period: Int, reason: String = "null",
                countedIn: String = "null"
            ) -> String {
                let (name, teacher) = [
                    3: ("Period 3 — Algebra II", "Ms. Rivera"),
                    5: ("Period 5 — Chemistry", "Mr. Okafor"), 6: ("Period 6 — Geometry", "Ms. Chen"),
                ][period]!
                return #"{"eventId":"m\#(id)","type":"\#(type)","occurredAt":"\#(time)","class":{"id":"p\#(period)","name":"\#(name)"},"teacher":{"displayName":"\#(teacher)"},"session":null,"reason":\#(reason),"recordedAs":null,"countedIn":\#(countedIn)}"#
            }
            let events = [
                moment(7, "session_expired", at(10, 45), 3), moment(6, "refocus", at(10, 16), 3),
                moment(5, "unlock", at(10, 12), 3, reason: #""bathroom""#),
                moment(4, "tap_in", at(9, 58), 3),
                moment(
                    3, "armed_tap_skipped", at(14, 48, 1), 6,
                    countedIn: #"{"id":"p5","name":"Period 5 — Chemistry"}"#),
                moment(2, "session_ended", at(13, 50, 1), 5), moment(1, "tap_in", at(13, 2, 1), 5),
            ]
            var ana = history(read: true)
            let page = try? BaliJSON.makeDecoder().decode(
                HistoryPage.self,
                from: Data(#"{"events":[\#(events.joined(separator: ","))],"nextBefore":"m0"}"#.utf8))
            (ana.events, ana.nextBefore) = (page?.events ?? [], page?.nextBefore)
            return ana
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

        /// The check judged the permission off, read `read` — taken back, or never given here — so
        /// iOS holds no shield; `unreported`, the protection off it found could not be saved.
        private static func screenTimeOff(_ read: Permission = .denied, unreported: Bool = false)
            -> Protection
        {
            var protection = permission(read)
            (protection.permissionOff, protection.unreported) = (true, unreported)
            return protection
        }

        /// `state` with no answer from the server.
        private static func offline(_ state: SyncState) -> SyncState {
            var state = state
            state.link = .unreachable
            return state
        }

        /// `state` with no token to send: the engine waits on the sign-in.
        private static func waitingOnSignIn(_ state: SyncState) -> SyncState {
            var state = state
            state.link = .signIn
            return state
        }

        /// Out of any session, a tap made as the fixture was, not answered yet (decision 7's cap).
        private static func heldTap() -> SyncState { queued(standing(.out), .tap(tagId: "fixture")) }

        /// `state` with `change` made as the fixture was, not sent yet — for `hold`, an unlock
        /// waiting for its reason — kept in an outbox of the fixture's own: only an outbox makes one.
        /// An outbox that fails stops here, saying why — never a fixture quietly holding nothing,
        /// named for a screen it no longer shows (C4's review).
        private static func queued(_ state: SyncState, _ change: Change, holding hold: TimeInterval = 0)
            -> SyncState
        {
            var state = state
            let url = FileManager.default.temporaryDirectory.appending(
                path: "fixture-\(UUID().uuidString).sqlite")
            do {
                let outbox = try Outbox(at: url)
                try outbox.record(change, now: Date(), holding: hold)
                state.queued = try outbox.records()
            } catch {
                fatalError("A fixture's outbox failed: \(error)")
            }
            return state
        }

        /// `state` with this phone's unlock in Period 3 recorded by the server, at `reason` (C5c).
        private static func recorded(_ state: SyncState, _ reason: UnlockReason?) -> SyncState {
            var state = state
            state.recordedUnlock = RecordedUnlock(
                session: period3.id, unlock: "unlock", reason: reason)
            return state
        }

        /// `state` with what it has queued on its way to the server (C5c).
        private static func sending(_ state: SyncState) -> SyncState {
            var state = state
            state.sending = Set(state.queued.map(\.eventId))
            return state
        }

        /// Back to focus in Period 3, which the server refused for `reason` (C5b).
        private static func refused(_ state: SyncState, _ reason: ApiErrorReason) -> SyncState {
            var state = state
            state.refused = Refusal(
                change: .refocus(session: period3.id), status: 409, reason: reason, message: nil)
            return state
        }

        /// Protection off reported in Period 3 since the phone's last tap: only a re-tap leaves it.
        private static func reported(_ state: SyncState) -> SyncState {
            var state = state
            state.reportedOff = period3.id
            return state
        }

        /// Focused in Period 3 again: the student's unlock recorded late, a return this phone's
        /// order cannot place gone ahead of it (A12).
        private static func superseded() -> SyncState {
            var state = standing(.inSession(period3, .focused))
            state.superseded = Superseded(session: period3.id, ordered: true)
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

        /// Ana as D1's Me names her.
        private static let anaRodriguez = ana(name: "Ana Rodríguez")

        /// Ana, as `GET /v1/me` answers her: in Period 3 with Ms. Rivera and Period 5 with Mr.
        /// Okafor, each with the enrollment leaving it deletes — or, a `newcomer`, in no class yet —
        /// named `name`.
        private static func ana(newcomer: Bool = false, name: String = "Ana", inSession: Bool = false)
            -> MeResponse?
        {
            // Period 3's lesson, as the server names it under the class (C3c).
            let bell = period3.endsAt.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
            let live = inSession ? #","liveSession":{"id":"session","endsAt":"\#(bell)"}"# : ""
            let classes =
                newcomer
                ? ""
                : #"{"id":"p3","name":"Period 3 — Algebra II","teacher":{"displayName":"Ms. Rivera"},"enrollmentId":"e3"\#(live)},{"id":"p5","name":"Period 5 — Chemistry","teacher":{"displayName":"Mr. Okafor"},"enrollmentId":"e5"}"#
            return try? BaliJSON.makeDecoder().decode(
                MeResponse.self,
                from: Data(
                    #"{"user":{"id":"ana","role":"student","displayName":"\#(name)"},"classes":[\#(classes)],"session":null}"#
                        .utf8))
        }
    }
#endif
