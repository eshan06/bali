import AuthenticationServices
import BaliCore
import BaliOutbox
import SwiftUI

// The student app (ARCHITECTURE, "iOS app structure"): its screens (C1–C6, `RootView`) over
// `Phone`, which starts the app's one sync engine over the student's Cognito sign-in (B4) and the
// shields' enforcer (B5).
@main
struct BaliApp: App {
    @Environment(\.scenePhase) private var phase
    @State private var phone = Phone.launched()

    var body: some Scene {
        WindowGroup {
            RootView(phone: phone).task { await phone.start() }
        }
        // The outbox is in the app group, shared with the extensions: suspended holding a lock on
        // it, the app would be killed (0xdead10cc). So it takes none behind the app, and takes them
        // again in front — where the engine checks in.
        .onChange(of: phase, initial: true) { _, phase in
            if phase == .background { Outbox.suspend() } else { Outbox.resume() }
            phone.setForeground(phase == .active, behind: phase == .background)
        }
    }

    static let version = ["CFBundleShortVersionString", "CFBundleVersion"]
        .map { Bundle.main.object(forInfoDictionaryKey: $0) as? String ?? "?" }
        .joined(separator: " · ")
}

/// The app's one sign-in, sync engine and enforcer, started once for the app's life, and what they
/// say.
@MainActor @Observable
final class Phone {
    private(set) var signIn: SignIn?
    private(set) var engine: SyncEngine?
    private(set) var enforcer: Enforcer?
    /// Whether someone is signed in; nil until the Keychain can be read (the phone locked).
    private(set) var signedIn: Bool?
    /// Whether a sign-in reached Bali's API this run (`forgetMe`), not only kept from the last: the
    /// router holds the starting screen until `GET /v1/me` answers or fails for it.
    private(set) var signedInThisRun = false
    /// The engine's state, for the screens; nil until it starts.
    private(set) var sync: SyncState?
    /// What a screen may claim of the shields (rule 3); nil until the enforcer starts.
    private(set) var protection: Protection?
    /// Why the engine did not start, shown with a way to try again (rule 5).
    private(set) var problem: String?
    /// What the scene's phase drives once the engine and the enforcer run: the engine's check-in,
    /// and rule 3's check as the app comes back. Theirs — a test's own in `BaliTests`.
    @ObservationIgnored
    var onPhase:
        (
            engine: @MainActor @Sendable (Bool) async -> Void,
            check: @MainActor @Sendable () async -> Void
        )?
    private var foreground = false
    private var starting = false
    /// A fixture's, frozen as it was made (Debug): never started.
    private var frozen = false
    /// The 13+ check (C7) this run: whether Sign up asked it and what the student answered — under
    /// 13 held here alone, never written anywhere (`AgeCheck`). Asked at every Sign up
    /// (`signIn(.signUp, through:)`), and after a sign-in into an account Bali's server holds no
    /// yes for (the gap's fallback), the sign-in giving Bali's API nothing until it is answered.
    private(set) var age = AgeCheck(.unanswered)
    /// Whether the sign-in held now is through the 13+ check (C7-server; `SignIn.checked`), as
    /// `ageNow` reads it: nil while Bali's server is asked for its account's yes (`askAge`), false
    /// once the question shows — no yes, or Bali not reached — and true once through.
    private var cleared: Bool?
    /// Whether the last ask of Bali's server for that yes got no answer, so it is asked again at
    /// the engine's wakes while the question cannot show (`askAgeAgain`).
    private var unreached = false
    /// The age screen's picks, the birth month and year, until Continue answers with them — kept
    /// while the sign-up page it opens is open, as the screen still shows them.
    var birth = Birth()
    /// Whether Delete account is the gap's fallback's: an answer under 13 this run, signed in,
    /// starts it, and nothing else does — the same deletion as Me's, said in the approved canvas's
    /// words where it drew them (santa's round 1).
    var underThirteen: Bool { age.answer == .tooYoung }
    /// Sign in's (C1a): a Cognito page under way — `hostedPage`, which its button's busy words name
    /// — until it ends with no sign-in or the one it made lands (`signed`); and why the last did
    /// not finish, as the sign-in said it: the screen says its `words` (rule 5), the readout all.
    private(set) var signingIn = false
    private(set) var hostedPage = HostedPage.signIn
    private(set) var signInFailed: SignInError?
    /// When the last Cognito page ended — closed, not opened, or sending the student back signed
    /// in — as iOS's sheet starts to go: no screen moves while it does (`Screen.Move.due`).
    @ObservationIgnored private(set) var pageEnded: Date?
    /// Whether the student has seen the intro this run (C1): in memory only, never in the phone's
    /// defaults — once per account, not per phone (the owner's ruling, 2026-10-07): a later run's
    /// Sign up shows it again, a second account's too, and one whose page closed or could not open;
    /// so does this run's after a sign-out (`signed`).
    /// Sign up shows the intro before its page until it has been: `introShows`, in Sign in's place,
    /// until the page it opens ends without a sign-in, or the sign-in it made lands (`signed`), so
    /// no Sign in shows between the two.
    private(set) var introSeen = false
    private(set) var introShows = false
    /// Whether a pass has ever read the Screen Time permission approved (C1b), kept in the phone's
    /// own defaults — not the app group's, which the extensions read: Family Controls can read not
    /// determined for a moment after a launch (B5a-2), and with this set the router routes such a
    /// read as approved, so no Screen Time screen flashes on a phone that gave it. The check
    /// judging the permission off clears it — denied, the marker gone (F1b), or not determined for
    /// `Enforcer.grace`: a grant taken back, or one that did not come back with a restored backup,
    /// which restores these defaults — so the grant screen returns.
    private(set) var everApproved = UserDefaults.standard.bool(forKey: Phone.everApprovedKey)
    static let everApprovedKey = "screenTimeApproved"
    /// The student `GET /v1/me` last listed in a class on this phone, by their id, kept as
    /// `everApproved` is (#143): in no class later, removed from their last or having left it,
    /// Home's empty state says they are in none any more, where a student never in a class here is
    /// told they are not in one yet (the owner's ruling, 2026-10-07: Home for both, never a forced
    /// Join). Keyed on the student, so another student signing in never inherits it, a late read of
    /// the last one's classes included; kept across a sign-out, as the engine keeps their classes
    /// then (C6b-1), and replaced once another student is listed in a class. A fixture's is its
    /// own, never the phone's defaults.
    private(set) var inClass = UserDefaults.standard.string(forKey: Phone.inClassKey)
    static let inClassKey = "inClass"
    /// The last ask for the Screen Time permission that did not finish (C1b), said on its screen
    /// until the next ask (rule 5).
    private(set) var askFailed: ScreenTimeAskError?
    /// The Join screen's (C2b): the code as typed, what it opens, why a try did not finish.
    var joining = Joining()
    /// The screens the student opened over the router's, in order (C3): Home, from Waiting's Back
    /// to home — the regular Home there, with no Back (#151) — or Unlocked's Go to Home; Join, from
    /// Home's Join a class. Back closes the last where it draws one (`canGoBack`); `synced`, as the
    /// state says.
    private(set) var opened: [Screen] = []
    /// Home's Tap in: a scan under way, and why the last recorded no tap (rule 5).
    private(set) var scanning = false
    private(set) var tapFailed: String?
    /// The tab chosen in D1's tab bar (C6a): the router's input, as `opened` is — Home, History or
    /// Me, honoured in place of its own Home only. Home again once `synced` closes what was opened,
    /// or who is signed in changes.
    private(set) var tab = Screen.home
    /// The History screen's (C6a): the moments read, and why a read did not finish — kept while the
    /// app runs, so a visit shows them at once (#141), and forgotten only when who is signed in
    /// changes. `reads` counts them, and the history forgotten, so an answer to a read no longer the
    /// latest, or another student's, is dropped.
    private(set) var history = History()
    private(set) var reads = 0
    /// Signed in, the history not yet read for them: read once `GET /v1/me` names a student (#141)
    /// — never a teacher's account, which the API refuses (F4's review).
    private var historyDue = false
    /// History's days as last drawn (`historyDays`), with the history and the day they were drawn
    /// for.
    @ObservationIgnored private var drawn: (history: History, day: Date, days: [History.Day])?
    /// Whether the app has gone behind since it was last in front: coming back from there with
    /// History shown reads it again (`setForeground`).
    private var wentBehind = false
    /// The session whose Session over the student closed, as it was then (C5b): Home past its bell,
    /// until the bell moves — an extension rings one of its own (C5b's review).
    private(set) var sessionOverClosed: SessionView?
    /// The Me screen's (C6b): the name as the student edits it, and why the last Sign out did not
    /// finish (rule 5).
    var naming = Naming()
    private(set) var signOutFailed: String?
    /// The outbox file asked whether an unlock still waits, while Me says one has not gone
    /// (`synced`): the latest ask, cancelled by the next, whose answer is newer (#172's review).
    @ObservationIgnored private(set) var unsentCheck: Task<Void, Never>?
    /// Me's Leave (C6c): the class whose Leave was pressed, its question, and why the last leave
    /// did not finish.
    var leaving = Leaving()
    /// Me's Delete account (C4b): its question asked, the deletion under way, where it stopped and
    /// its way on, or done — the router's input too: from the press to the end the deletion's own
    /// screen shows and nothing else (`Deleting.shows`, `Screen.deleting`).
    var deleting = Deleting.none
    /// Unlocked's reason card (C5c): the newest reason picked, its check shown until it is
    /// answered, and why the last did not go.
    private(set) var picking: UnlockReason?
    private(set) var pickFailed: String?
    /// The card a pick is on its way for: another made on it meanwhile only moves the check (#140),
    /// and one on a later card goes. Its loop's own, let go as the loop ends, whichever way, so
    /// nothing else resets it (#152's review).
    private var pickSending: Int?
    /// Counts the unlocks Unlocked's card has been about: a pick on its way for one the card has
    /// left says and sends nothing more (#140, santa's round 1).
    private var cards = 0

    /// Whether the student `GET /v1/me` names has been listed in a class on this phone (#143):
    /// which words Home's empty state says.
    var everInClass: Bool { listed(sync?.me) }

    /// Whether the student `me` names is the one listed in a class on this phone (#143).
    private func listed(_ me: MeResponse?) -> Bool { me.map { $0.user.id == inClass } ?? false }

    init() {}

    /// The app's phone: the live one — or, in a Debug build launched with `-bali-screen <name>`,
    /// one frozen in that fixture (`PreviewFixtures`).
    static func launched() -> Phone {
        #if DEBUG
            if let fixture = PreviewFixtures.chosen() { return Phone(fixture: fixture) }
        #endif
        return Phone()
    }

    #if DEBUG
        init(fixture: PreviewFixtures.State) {
            (problem, introSeen, signedIn) = (fixture.problem, fixture.introSeen, fixture.signedIn)
            (introShows, signingIn) = (fixture.introShows, fixture.signingIn)
            (hostedPage, signInFailed) = (fixture.hostedPage, fixture.signInFailed)
            (age, birth) = (AgeCheck(fixture.age), fixture.birth)
            (protection, sync, frozen) = (fixture.protection, fixture.sync, true)
            (everApproved, askFailed, joining) = (false, fixture.askFailed, fixture.joining)
            inClass = fixture.everInClass ? fixture.sync?.me?.user.id : nil
            (opened, tab, history) = (fixture.opened, fixture.tab, fixture.history)
            (naming, signOutFailed, email) = (fixture.naming, fixture.signOutFailed, fixture.email)
            (leaving, picking, pickFailed) = (fixture.leaving, fixture.picking, fixture.pickFailed)
            deleting = fixture.deleting
        }

        /// A phone over a sign-in and an engine a test made, never started (BaliTests): the calls
        /// `start` wires between them and the screens, tested over stand-ins for the Keychain and
        /// the server (C6a-2's and C6b-1's reviews) — and, given, what rule 3's check found, so the
        /// router routes as over a running enforcer.
        init(signIn: SignIn, engine: SyncEngine, protection: Protection? = nil) {
            (self.signIn, self.engine, self.protection) = (signIn, engine, protection)
        }
    #endif

    /// The screen to show now, and whether D1's tab bar shows under it (C6a): `Screen.choose`, the
    /// one place that decides, over what the phone knows — asked once, so the two never disagree,
    /// at a bell either (C6a's review). The bar shows wherever the router honours a tab, but while
    /// Me shows its name being edited, whose ways on are Save and Cancel, and whose keyboard it
    /// would otherwise ride above (C6b). Anywhere else — Home, where a change of standing sends the
    /// tab mid-edit — it shows. A view or a test reading both reads this once (#129's review).
    var shown: (screen: Screen, tabbed: Bool) {
        let shown = choose(opened)
        return (shown.screen, shown.tabbed && !(naming.editing && shown.screen == .me))
    }

    /// The router's answer over what the phone knows, with `opened` as the screens opened.
    private func choose(_ opened: [Screen]) -> (screen: Screen, tabbed: Bool) {
        Screen.choose(
            problem: problem, deleting: deleting.shows, age: ageNow, intro: introShows,
            signedIn: signedIn, signedInThisRun: signedInThisRun, protection: protection,
            everApproved: everApproved, sync: sync, sessionOverClosed: sessionOverClosed,
            opened: opened, tab: tab, now: Date())
    }

    /// The 13+ check as the router reads it (C7): signed in, the sign-in's — through it, passed;
    /// Bali's server being asked for its account's yes, the starting mark (C7-server); else the
    /// question, or the stop screen an answer under 13 got this run; signed out, Sign up's question
    /// as it stands. A fixture's is its own.
    var ageNow: AgeCheck.Answer {
        guard signedIn == true, !frozen, age.answer != .tooYoung else { return age.answer }
        return switch cleared {
        case true?: .passed
        case false?: .unanswered
        case nil: .checking
        }
    }

    private var screen: Screen { shown.screen }

    /// A tab chosen (C6a) — or `synced`'s Home. The history read is kept (#141): History shows it
    /// at once, and its screen reads the newest page again each time it shows (`refreshHistory`).
    func select(_ tab: Screen) { self.tab = tab }

    /// History shows — its screen's own call, each time it appears: the moments kept show meanwhile,
    /// and the newest page is read again from the top, quietly (#141). A frozen phone's fixture
    /// stays as made; with no history at all, its read says it has not started, never nothing
    /// (#106's review; santa's round 1).
    func refreshHistory() async {
        guard !frozen || history == History() else { return }
        await readHistory()
    }

    /// Reads the student's history through the engine: from the top — the moments read kept until
    /// its page takes their place (#141) — or `more`, the page after those read. One at a time, but
    /// a read from the top goes ahead of Show earlier's page under way, whose answer it drops: its
    /// own takes the place of all read. A phone whose engine has not started — a frozen one too —
    /// says so (rule 5).
    func readHistory(more: Bool = false) async {
        guard !history.busy || !more && !history.fromTop, !more || history.nextBefore != nil
        else { return }
        let before = more ? history.nextBefore : nil
        // Counted as it starts, engine or none: a read under way is no longer the latest (F4's
        // review), so its answer is never taken for this one's.
        reads += 1
        let read = reads
        history.reading(more: more)
        guard let engine else { return history.failed(Joining.notStarted) }
        await historyRead(await engine.history(before: before), for: read)
    }

    /// History's days and cards as its screen draws them (`History.days`): drawn once per change
    /// of the history, or of the day (F5's review) — a visit's first pass over a history unchanged
    /// since the last costs nothing — and anew with each read, so a clock or locale changed
    /// meanwhile shows at the next.
    var historyDays: [History.Day] {
        let now = Date()
        let day = Calendar.current.startOfDay(for: now)
        if let drawn, drawn.history == history, drawn.day == day { return drawn.days }
        let days = history.days(now: now)
        drawn = (history, day, days)
        return days
    }

    /// The answer to read `read`: kept while no read has started since nor the history been
    /// forgotten — who is signed in changed — the student on History or not (#141); and with Show
    /// earlier's cursor one the history does not hold, the history read again from the top.
    func historyRead(_ page: APIResponse<HistoryPage>, for read: Int) async {
        guard read == reads else { return }
        if history.answered(page) { await readHistory() }
    }

    /// No history read, and none under way that could still land: who is signed in changed
    /// (`signed`), so no student is shown another's.
    func forgetHistory() { (history, reads) = (History(), reads + 1) }

    /// Whose tokens these are (`SignIn.account`), the last one known: another student's sign-in
    /// is known by it, whether or not the sign-out between them was seen.
    private var account: String?
    /// The forgets of the last student's `me` asked of the engine (`signed`): a state counting
    /// fewer (`SyncState.forgets`) was sent before the latest, so its `me` is not shown (#160's
    /// review).
    private var forgets = 0
    /// Counts the changes of who is signed in (`signed`): a look-up or a join sent before one is
    /// the last student's, so its answer is dropped (Riders-2's review).
    private var signIns = 0
    /// Whose sign-in this is, as the tokens name it now (`SignIn.email`, #147): Me says it by Sign
    /// out, so the name a student's teachers see is never taken for it. Nil when nobody is signed
    /// in or the tokens name none — never the last student's.
    private(set) var email: String?

    /// Follows who is signed in on `signIn` for the app's life: each change to `signed`, with the
    /// account and the email the tokens name then, whether the account is deleted and its sign-in
    /// waits to be (C4b: a relaunch lands on the deletion's screen), and whether the sign-in is
    /// through the 13+ check. Build 8's age note goes first, once the Keychain says who is signed
    /// in: a yes it holds for them is kept with their sign-in for Bali's server, and the note is
    /// deleted (C7-server, the owner's decision 2026-10-08).
    func follow(_ signIn: SignIn) async {
        for await signedIn in await signIn.signedIn() {
            let account = signedIn ? await signIn.account() : nil
            if AgeCheck.forgetNotes(in: .standard, keeping: account) {
                await signIn.passed(account, recording: EventID.mint(at: Date()))
                await retry()
            }
            signed(
                in: signedIn, as: account, email: signedIn ? await signIn.email() : nil,
                pending: signedIn ? await signIn.deletionPending() : false,
                checked: signedIn ? await signIn.checked() : false)
        }
    }

    /// Who is signed in, as the Keychain says — `account`, theirs, where the sign-in could say, and
    /// `email`, whose sign-in it is (#147): a change starts the tabs over at Home, and the history
    /// read, a name being edited, a failed Sign out and a class code typed go with it — a look-up
    /// or a join on its way too, its answer dropped (Riders-2's review); so, where another student
    /// signs in, does the engine's `me` — keyed on the account (C6b-1's review): a sign-out the
    /// stream let go by between two sign-ins is no matter. With no account to tell by, on a sign-in
    /// after a sign-out. Another student's is never shown (C6a, C6b), at any moment: gone from what
    /// the phone shows at once, and from the engine's states until the engine has forgotten it too
    /// (`synced`; #160's review). Signed in, the student's history is read once `GET /v1/me` names
    /// them a student — at once where it already does — so even their first visit to History shows
    /// it (#141); a teacher's account reads none, which the API would refuse (F4's review). A
    /// deletion's question or stop goes with the change too, while one under way, waiting for
    /// DeleteUser or done holds (`Deleting.signInChanged`); `pending`, the API has deleted the
    /// account and its Cognito sign-in waits to be — a relaunch (C4b) — so the deletion's screen
    /// shows at once, Try again its one way on. The intro Sign up showed goes with a change too,
    /// and so does its question kept while its page was open, with the picks: the sign-in its page
    /// made has landed, and so its button's busy words end (`signingIn`), at any sign-in; and at a
    /// sign-out, the intro seen, so the next Sign up this run shows it
    /// again (#292's review). A sign-in made this run with no `me` known forgets too: a read that
    /// failed before it, with no token to send, is not its read (`forgetMe`). A sign-in `checked`,
    /// through the 13+ check, is let through; one that is not, new to this run — made here, or kept
    /// from the last — waits on Bali's server for its account's yes (`askAge`; C7-server).
    func signed(
        in signedIn: Bool?, as account: String? = nil, email: String? = nil, pending: Bool = false,
        checked: Bool = false
    ) {
        let another =
            account.map { self.account != nil && $0 != self.account }
            ?? (signedIn == true && self.signedIn == false)
        let changed = signedIn != self.signedIn || another
        if changed {
            (tab, introShows, birth) = (.home, false, Birth())
            if age.answer == .asked { age = AgeCheck(.unanswered) }
            if signedIn == false { introSeen = false }
            forgetHistory()
            (naming, signOutFailed, leaving) = (Naming(), nil, Leaving())
            (joining, signIns) = (Joining(), signIns + 1)
            deleting.signInChanged()
        }
        if pending, deleting == .none { deleting = .pending }
        if signedIn == true { signingIn = false }
        // Made here, not the Keychain read at launch (nil before it).
        let made = changed && signedIn == true && self.signedIn != nil
        if another || made && sync?.me == nil { forgetMe() }
        if let account { self.account = account }
        (self.signedIn, self.email) = (signedIn, email)
        if signedIn != true || checked {
            cleared = signedIn == true ? true : nil
        } else if changed {
            cleared = nil
            Task { await askAge() }
        }
        if changed { historyDue = signedIn == true && !frozen }
        readDueHistory()
    }

    /// Bali's server asked whether the account signed in has its 13+ yes (C7-server): the one call
    /// a sign-in makes before its age is settled, the starting mark meanwhile (`ageNow`). Yes, the
    /// sign-in is let through — Bali's API given its token, everything queued sent and the truth
    /// read at once, the mark holding until that read answers (`forgetMe`). No — an account made
    /// through Cognito's own sign-up link, or one never confirmed — or Bali not reached, the safe
    /// side, with no screen of its own (the owner's decision, 2026-10-08): the question. Dropped
    /// once who is signed in has changed, the check passed or answered meanwhile.
    private func askAge() async {
        guard let engine, let signIn else { return }
        let (signIns, account) = (self.signIns, await signIn.account())
        let answer = await engine.ageCheck().answer
        guard signIns == self.signIns, cleared != true, !underThirteen else { return }
        unreached = answer == nil
        guard answer?.passed == true else { return cleared = false }
        await signIn.passed(account)
        guard signIns == self.signIns, cleared != true, !underThirteen else { return }
        cleared = true
        forgetMe()
        await retry()
    }

    /// At each of the engine's wakes (`SyncEngine.askAgeAtEachWake`) — every 30 s in front, a
    /// return to the front, a Try again: Bali's server asked again for the account's 13+ yes while
    /// the last ask could not reach it and the question cannot show — Focus, a session's screens,
    /// come first — so a yes lets the sign-in through at once, and what it held goes before the
    /// bell, an Emergency Unlock with it (#300's review; the owner's approval, 2026-10-09). No yes,
    /// as before: the question once it may show. Never while the question shows: the way on there.
    func askAgeAgain() async {
        guard unreached, cleared == false, !underThirteen, screen != .age else { return }
        await askAge()
    }

    /// A sign-in reaching Bali's API this run — made here, or let through by the 13+ check (the
    /// gap's fallback): what the phone knew of `me`, another student's or a read that failed before
    /// it, is forgotten and read again (the engine's `forgetMe`), and the router holds the starting
    /// screen until that read answers or fails, so no screen flashes before Your name
    /// (`signedInThisRun`; the owner's ruling, 2026-10-07).
    private func forgetMe() {
        signedInThisRun = true
        sync?.me = nil
        sync?.meFailed = nil
        guard let engine else { return }
        forgets += 1
        Task { await engine.forgetMe() }
    }

    /// The history due at a sign-in, read once `me` names who is signed in: a student's, never a
    /// teacher's account's (F4's review).
    private func readDueHistory() {
        guard historyDue, let role = sync?.me?.user.role else { return }
        historyDue = false
        if role.known == .student { Task { await readHistory() } }
    }

    /// Saves the name as typed (`PATCH /v1/me`), through the engine: set, editing ends and the name
    /// is `me`'s; else why not, said under the field. A phone whose engine has not started — a
    /// frozen one too — says so (rule 5).
    func saveName() async {
        guard !naming.busy else { return }
        guard naming.complete else { return naming.failure = Naming.blank }
        guard let engine else { return naming.failure = Joining.notStarted }
        let request = naming.save(at: Date())
        let answer = await engine.rename(request)
        naming.saved(answer, for: request)
    }

    /// Leave class (C6c): the class asked about is left (`DELETE /v1/enrollments/{id}`, A19) through
    /// the engine — under its last try's event id while it is the same class's, so a try after no
    /// answer is its replay. Out, the class is gone from `me` at once; else why not, said under the
    /// question (rule 5). A phone whose engine has not started — a frozen one too — says so.
    func leave() async {
        guard leaving.asking != nil, !leaving.busy else { return }
        guard let engine else { return leaving.failure = Joining.notStarted }
        guard let sent = leaving.send(at: Date()) else { return }
        leaving.left(
            await engine.leave(enrollment: sent.enrollmentId, sent.request), for: sent.enrollmentId)
    }

    /// Me's Sign out (C6b): the sign-in's tokens forgotten — never where the phone stands, its
    /// shields or a queued record (B4) — so Sign in shows, or Focus while the shields are on. Never
    /// while an Emergency Unlock is unsent (`SignOutWords.held`, which the screen says), nor while
    /// the outbox file, asked itself, holds one or cannot say (santa's round 1: a failed read of
    /// the queue shows none); that, a Keychain that cannot forget the tokens now, or a phone not
    /// started, is said (rule 5).
    func signOut() async {
        // The last try's words go, whatever this one does: never two reasons at once (C6b-1's
        // review).
        signOutFailed = nil
        guard sync.flatMap(SignOutWords.held) == nil else { return }
        guard let signIn, let engine else { return signOutFailed = Joining.notStarted }
        switch await engine.unlockUnsent() {
        case false?: break
        case true?: return signOutFailed = SignOutWords.unsent
        case nil: return signOutFailed = SignOutWords.unread
        }
        do {
            try await signIn.signOut()
            signOutFailed = nil
        } catch {
            signOutFailed = SignOutWords.failed
        }
    }

    /// Me's Delete account, confirmed, or the screen's Try again (C4b): the one engine call,
    /// `SyncEngine.deleteAccount` — the outbox first, then `DELETE /v1/me`, then Cognito's DeleteUser
    /// (C4a) — the deletion's screen showing meanwhile and its answer put in words there
    /// (`Deleting.answered`). Nothing where no try can help, nor while one runs. A phone whose
    /// engine has not started — a frozen one too — says so (rule 5). After an answer under 13 this
    /// run, signed in, it is the gap's fallback's, which that answer started: the same steps, said
    /// as the approved canvas draws them (`Deleting.saidUnderThirteen`).
    func deleteAccount() async {
        guard deleting.start() else { return }
        let young = underThirteen
        guard let engine, let signIn else {
            return deleting = .stopped(
                title: Deleting.notDeleted, why: Joining.notStarted, retries: true)
        }
        deleting.answered(await engine.deleteAccount(signIn), underThirteen: young)
    }

    /// The bell of the session the phone stands in, where the router chooses again (C5a).
    var bell: Date? {
        if case .inSession(let session, _)? = sync?.standing { session.endsAt } else { nil }
    }

    /// Session over's Done (C5b): Home, until a read says where the phone stands. Only a session
    /// whose bell has rung by the phone's clock is closed: one a read put the phone in as Done was
    /// pressed is not the one that ended (C5b's review). Whether it closed one.
    @discardableResult
    func closeSessionOver() -> Bool {
        guard case .inSession(let session, _)? = sync?.standing, session.endsAt <= Date() else {
            return false
        }
        sessionOverClosed = session
        select(.home)
        return true
    }

    /// Session over's See history (D1): closed, and History chosen — which the read after the bell
    /// keeps (`keepsOpened`; C5b's hand-off) — over anything opened before the bell, which the
    /// router would show in its place (santa's round 1). Nothing chosen where nothing closed: a
    /// read put the phone in a new class meanwhile.
    func seeHistory() {
        guard closeSessionOver() else { return }
        if opened.contains(.join), !joining.busy { joining = Joining() }
        opened = []
        select(.history)
    }

    /// Opens `screen` over what shows, fading in (#150): the student's own move, never the
    /// router's, whose moves are `RootView`'s and never touch Focus at the Start.
    func open(_ screen: Screen) { withAnimation(Motion.fade) { opened.append(screen) } }

    /// Whether the screen shown was opened over another, so it draws a way back to it (C3): only
    /// where Back leads to another screen — never from a Home its Unlocked became after the bell
    /// (santa's round 1), nor to Waiting: the Home opened over it is the regular Home, its card
    /// saying the wait (#151, the owner's decision).
    var canGoBack: Bool {
        let under = choose(Array(opened.dropLast())).screen
        return opened.last == screen && under != screen && under != .waiting
    }

    /// Whether the screen shown offers Sign out (C6b): Me — every student in no class lands on Home
    /// with its tab bar, so Me is the wrong account's way out (the approved Sign in & sign up
    /// design), where a Join of the router's own once offered it — and Your name, whose only other
    /// way on is a name.
    var offersSignOut: Bool { screen == .me || screen == .name }

    /// Back from the screen opened last, the one under it fading back in (#150) — the keyboard let
    /// go at once, so it goes down with the screen it was up for, never left over the next: Join
    /// raises one as it shows. Let go after the move, never before: its focus change draws the root
    /// at once, before the move, and the move was then never drawn (`AppTests.reduceMotionBack`). A
    /// Join closed starts over, unless a try is under way.
    func back() {
        guard !opened.isEmpty else { return }
        let closed = withAnimation(Motion.fade) { opened.removeLast() }
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        if closed == .join, !joining.busy { joining = Joining() }
    }

    /// The engine's state as it comes: the screens opened over another end as `keepsOpened` says,
    /// a Join among them starting over unless a try is under way — and the tab chosen with them,
    /// Home again (C6a). A student listed in a class is kept as one (#143). One sent before the
    /// engine forgot the last student's `me` comes without it (`signed`; #160's review).
    func synced(_ state: SyncState) {
        var state = state
        if state.forgets < forgets { (state.me, state.meFailed) = (nil, nil) }
        if let me = state.me, !me.classes.isEmpty, me.user.id != inClass {
            keepInClass(me.user.id)
        }
        let keeps = state.keepsOpened(from: sync, at: Date())
        let wasHeld = sync.flatMap(SignOutWords.held) != nil
        // The unlock landed: a pick said to wait for it may go now (santa's round 1).
        if pickFailed == UnlockedWords.onItsWay, state.recordedUnlock != sync?.recordedUnlock {
            pickFailed = nil
        }
        // The card is about another unlock, or none: a pick waiting for the last one goes with it,
        // never to the next, and so does its check (#140, santa's round 1).
        if UnlockedWords(state)?.unlock != sync.flatMap({ UnlockedWords($0) })?.unlock {
            (picking, cards) = (nil, cards + 1)
        }
        sync = state
        readDueHistory()
        // "Unsent" is said where the file holds an unlock the engine's queue does not show
        // (`signOut`). A hold the queue showed ending is that unlock gone: the words go at once,
        // never a moment late under an enabled Sign out. Where none showed, its reads failing
        // throughout (#129's review), the file is asked again at each state whose queue shows no
        // unlock, and they go once it holds none, never while it does (Riders-2's santa). One ask
        // at a time: each cancels the last, whose answer is older (#172's review). Its answer
        // lands after any press's whose read came first, the two executors keeping order, so it
        // clears only these words, never ones a press set since.
        if signOutFailed == SignOutWords.unsent, SignOutWords.held(state) == nil {
            if wasHeld {
                signOutFailed = nil
            } else if let engine {
                unsentCheck?.cancel()
                unsentCheck = Task {
                    guard !Task.isCancelled, await engine.unlockUnsent() == false,
                        !Task.isCancelled, signOutFailed == SignOutWords.unsent
                    else { return }
                    signOutFailed = nil
                }
            }
        }
        guard !keeps else { return }
        pickFailed = nil
        select(.home)
        guard !opened.isEmpty else { return }
        if opened.contains(.join), !joining.busy { joining = Joining() }
        opened = []
    }

    /// Home's Tap in (B6's scan, `SyncEngine.tapIn`): a Bali block's code is the tap — recorded,
    /// shielded at once and sent — and anything else is said under the button (rule 5), nothing
    /// recorded. A phone whose engine has not started says so.
    func tapIn() async {
        guard !scanning else { return }
        guard let engine else { return tapFailed = Joining.notStarted }
        (tapFailed, scanning) = (nil, true)
        defer { scanning = false }
        tapFailed = await engine.tapIn(await BlockReader().read())
    }

    /// The student's Try again (rule 5): everything queued goes now, and the truth is read again.
    func retry() async { await engine?.retryNow() }

    /// Looks the typed code up (`GET /v1/join-codes/{code}`), through the engine: what it opens, or
    /// why not — the last try's words gone meanwhile, the code kept as sent until the answer comes,
    /// unless who is signed in changed meanwhile: the code went with them, and the answer goes
    /// too (`signed`). A phone whose engine has not started — a frozen one too — says so (rule 5).
    func lookUp() async {
        guard !joining.busy else { return }
        guard let engine else { return joining.failure = Joining.notStarted }
        let (code, signIns) = (joining.code, self.signIns)
        (joining.failure, joining.busy) = (nil, true)
        let answer = await engine.lookUp(code)
        guard signIns == self.signIns else { return }
        joining.busy = false
        joining.looked(answer, for: code)
    }

    /// Joins the class the code opens (`POST /v1/enrollments`), through the engine — its event id
    /// minted per press, as the server knows a join's retry by its enrollment: once in, the class
    /// is the engine's at once, so the router moves on; else why not, said — but not once who is
    /// signed in has changed meanwhile (`signed`). A phone whose engine has not started — a frozen
    /// one too — says so (rule 5).
    func join() async {
        guard !joining.busy else { return }
        guard let engine else { return joining.failure = Joining.notStarted }
        let (now, signIns) = (Date(), self.signIns)
        let request = EnrollmentJoinRequest(
            joinCode: joining.code, eventId: EventID.mint(at: now), deviceTime: now)
        (joining.failure, joining.busy) = (nil, true)
        let answer = await engine.join(request)
        guard signIns == self.signIns else { return }
        joined(answer)
    }

    /// A join's answer: in, a Join opened over Home closes, back to what it was opened over; else
    /// why not, said on it.
    func joined(_ answer: APIResponse<EnrollmentJoinResponse>) {
        joining.busy = false
        if joining.joined(answer), opened.last == .join { opened.removeLast() }
    }

    /// The browser a sign-in opens Cognito's hosted UI in (`WebAuthenticationSession.hostedUI`):
    /// the page at a URL, and where it sent the student back to the scheme given.
    typealias Browser = @MainActor @Sendable (URL, String) async throws(SignInError) -> URL

    /// The one way to Cognito's hosted UI (C1a) — Sign in's two buttons and the readout's, then the
    /// age screen's Continue and the intro's Sign up, which carry Sign up on — opening `page` (the
    /// approved Sign in & sign up design). Sign in opens its page at once: a sign-in into an account
    /// Bali's server holds no 13+ yes for is asked it then (the gap's fallback; C7-server). Sign
    /// up asks the check first, every time (C7; the owner's ruling, 2026-10-07: no account exists
    /// yet to have passed it, and a second person must never sign up unasked), in Sign in's place
    /// with no page opened; its Continue goes on (`answerAge`). After an answer under 13 no page
    /// opens this run, as the stop screen says.
    func signIn(_ page: HostedPage = .signIn, through browser: Browser) async {
        guard !signingIn, age.answer != .tooYoung else { return }
        guard page == .signIn else { return (age, birth) = (AgeCheck(.asked), Birth()) }
        await open(.signIn, vouched: false, through: browser)
    }

    /// Opens `page` through `browser`, one at a time, what did not finish kept (`signInFailed`).
    /// `vouched`, Sign up's page after a 13 or older answer this time: the sign-in it makes — into
    /// the account made there, or one signed into from it — is kept through the 13+ check with a
    /// yes for the engine to record on Bali's server, before anything hears of it
    /// (`SignIn.signIn`'s `yes`; C7-server), so that account is never asked. A page that ends with
    /// no sign-in — closed, or not opened — leaves the intro or the question for Sign in, the
    /// answer and the picks let go, so the next Sign up asks again; one that signs the student in
    /// leaves them, its button busy, until the sign-in lands (`signed`). On a phone not started —
    /// a frozen one too — no page can open, which is said.
    private func open(_ page: HostedPage, vouched: Bool, through browser: Browser) async {
        hostedPage = page
        guard let signIn else { return notOpened(.notOpened(Joining.notStarted)) }
        (signingIn, signInFailed) = (true, nil)
        let scheme = signIn.cognito.redirectURI.scheme ?? ""
        do {
            try await signIn.signIn(page, yes: vouched ? EventID.mint(at: Date()) : nil) {
                @MainActor url throws(SignInError) in
                defer { self.pageEnded = Date() }
                return try await browser(url, scheme)
            }
        } catch {
            notOpened(error)
        }
    }

    /// A page that ended with no sign-in: Sign in, saying why (rule 5).
    private func notOpened(_ error: SignInError) {
        (age, birth, introShows, signInFailed) = (AgeCheck(.unanswered), Birth(), false, error)
        signingIn = false
    }

    /// The age screen's Continue (C7): the picks answer the check, judged by the phone's clock and
    /// calendar today. Nothing until both are picked. Sign up's, 13 or older goes on at once, with
    /// no second press: the intro, where this run has not shown it, the picks let go — or its page,
    /// the question kept with its picks and Signing up… on Continue while the page is open (the
    /// approved design's age board). Under 13, kept nowhere, in memory until the app is reopened,
    /// the picks let go. Signed in (the gap's fallback), no page opens: 13 or older lets the
    /// sign-in through the check, its yes kept with it for the engine to record on Bali's server
    /// (C7-server), and so reach Bali's API, everything queued sent and the truth read at once —
    /// the starting screen held until it answers (`forgetMe`); under 13 deletes the account, as
    /// Delete account does, and nothing is sent of the answer.
    func answerAge(through browser: Browser) async {
        guard let month = birth.month, let year = birth.year, !signingIn else { return }
        let today = Date()
        let passes = AgeCheck.passes(month: month, year: year, today: today)
        if signedIn != true, passes, introSeen {
            return await open(.signUp, vouched: true, through: browser)
        }
        age.answered(month: month, year: year, today: today)
        birth = Birth()
        guard signedIn == true else { return introShows = passes }
        guard passes else {
            deleting.ask()
            return await deleteAccount()
        }
        if let signIn {
            await signIn.passed(await signIn.account(), recording: EventID.mint(at: today))
        }
        cleared = true
        forgetMe()
        await retry()
    }

    /// The intro's Sign up, on its last page (C1): the intro seen for this run, in memory only, and
    /// Sign up's page opened, vouched by the answer that showed the intro, the intro staying,
    /// Signing up… on its button, while the page is open. Only after that answer: no Sign up page
    /// opens unasked.
    func sawIntro(through browser: Browser) async {
        guard !signingIn, age.answer == .passed else { return }
        introSeen = true
        await open(.signUp, vouched: true, through: browser)
    }

    /// Keeps `id` as the student listed in a class on this phone, in its own defaults — a frozen
    /// fixture's in itself only, so no test leaves it there for another (santa's round 1).
    private func keepInClass(_ id: String) {
        inClass = id
        if !frozen { UserDefaults.standard.set(id, forKey: Phone.inClassKey) }
    }

    /// Keeps `everApproved` as a pass read the permission: set at approved, cleared once the check
    /// judges it off, left at a read not determined for a moment — the read it is there to see
    /// past.
    func remember(_ protection: Protection) {
        let approved = protection.permission == .approved
        guard approved || protection.permissionOff, everApproved != approved else { return }
        everApproved = approved
        UserDefaults.standard.set(approved, forKey: Phone.everApprovedKey)
    }

    /// Asks iOS for the Screen Time permission — its own prompt, through the enforcer — and keeps
    /// why it did not finish. Nothing on a frozen phone.
    func askScreenTime() async {
        guard let enforcer else { return }
        askFailed = nil
        do { try await enforcer.requestPermission() } catch {
            askFailed = error as? ScreenTimeAskError ?? .failed("\(error)")
        }
    }

    /// Emergency Unlock (C4), always allowed: recorded where decision 11 files it — the shields off
    /// at once, the record queued, never waiting on the network — or why not (rule 5), which the
    /// screen says: a phone whose engine has not started, a frozen one too, an outbox refusing, or
    /// nothing left to unlock (`SyncEngine.pressUnlock`).
    func emergencyUnlock() async -> UnlockFailure? {
        guard let engine else { return .notStarted }
        return await engine.pressUnlock()
    }

    /// A reason picked on Unlocked (C5c): sent with the latest Emergency Unlock while it has never
    /// been sent, else as a change of it once the server has it (A20) — the check on it at once,
    /// and no pick ever waits on another (#140): one goes at a time, so the server records them in
    /// the order the student made them, and once it answers the newest goes unless it is the one
    /// just sent, the picks between never sent — nor any once the card has left the unlock they
    /// were made for (`synced`). Why the newest did not go is said (rule 5), the check back on the
    /// reason on record. A phone not started says so.
    func pick(_ reason: UnlockReason) async {
        guard let engine else { return pickFailed = Joining.notStarted }
        (picking, pickFailed) = (reason, nil)
        guard pickSending != cards else { return }
        let card = cards
        pickSending = card
        var sent: UnlockReason?
        while let next = picking, next != sent {
            sent = next
            let failed = await engine.explain(next)
            // The card has left the unlock it was made for: nothing more said or sent, and the
            // hold let go — never one a pick on the card since holds.
            guard card == cards else {
                if pickSending == card { pickSending = nil }
                return
            }
            if picking == next { pickFailed = failed }
        }
        (pickSending, picking) = (nil, nil)
    }

    /// Back to focus from an Emergency Unlock (C5a) — or what the Unlocked screen says (rule 5).
    func backToFocus() async -> String? {
        guard let engine else { return Joining.notStarted }
        return await engine.backToFocus()
    }

    /// Starts the sign-in, the engine and the enforcer, unless they run already: a start that
    /// failed can be tried again.
    func start() async {
        guard engine == nil, !starting, !frozen else { return }
        starting = true
        defer { starting = false }
        // The build's settings, the sign-in's and the portal's (C2-app): ios/project.yml,
        // docs/DEPLOY.md.
        guard let config = AppConfig(info: Bundle.main.infoDictionary ?? [:]) else {
            problem = "This copy of Bali isn't set up right. Ask your teacher."
            return
        }
        let transport = URLSessionTransport()
        // Bali's API gets no token until the sign-in is through the 13+ check: its account's yes
        // read from Bali's server, or answered on this phone (the gap's fallback; C7-server).
        let signIn = SignIn(
            cognito: config.cognito, store: KeychainTokenStore(), transport: transport, gated: true)
        let outbox: Outbox
        do {
            guard let url = Outbox.appGroupURL else { throw CocoaError(.fileNoSuchFile) }
            outbox = try await Self.outbox(at: url, forgetting: signIn)
        } catch {
            // The error stays, in parentheses: it is what a support request needs.
            problem =
                "Bali couldn't open its storage on this phone (\(error)). Try again, or ask your teacher."
            return
        }
        problem = nil
        let engine = await SyncEngine.make(
            outbox: outbox, api: config.api, signIn: signIn, transport: transport)
        #if DEBUG
            await engine.setTapCap(Bell.deviceCheckCap)
        #endif
        await engine.askAgeAtEachWake { [weak self] in await self?.askAgeAgain() }
        // The shields follow the engine from its first state — where the phone stood when the app
        // last ran, kept in the app group — so a relaunch never takes them off (B5).
        let enforcer = Enforcer(engine: engine, screenTime: PhoneScreenTime())
        (self.signIn, self.engine, self.enforcer) = (signIn, engine, enforcer)
        onPhase = ({ await engine.setForeground($0) }, { await enforcer.check() })
        Task { await engine.run() }
        Task { await enforcer.run() }
        Task { for await state in await engine.updates() { self.synced(state) } }
        Task {
            for await protection in await enforcer.updates() {
                self.protection = protection
                self.remember(protection)
            }
        }
        Task { await self.follow(signIn) }
        await engine.setForeground(foreground)
    }

    /// The outbox at `url`, an install's first start forgetting first the sign-in a deleted Bali
    /// left, through `signIn`'s own Sign out (the owner's ruling, 2026-10-08): iOS keeps the
    /// Keychain after an app is deleted, never its files, so a reinstall opened signed in as
    /// whoever used the deleted one. No file at `url` is that first start: the outbox lives in the
    /// app group's container, which iOS deletes with the app and keeps through an update, and
    /// every build that signs anyone in makes it at its start, before its sign-in exists. So an
    /// update finds it, whatever the student did, and without it the Keychain holds no sign-in of
    /// this install's. The file made next marks the install; a forget that fails throws before it
    /// is made, so the next start forgets. Nothing else is touched: no engine or enforcer exists
    /// yet, so Focus, the shields and Emergency Unlock are out of its reach.
    static func outbox(at url: URL, forgetting signIn: SignIn) async throws -> Outbox {
        if !FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
            try await signIn.signOut()
        }
        return try Outbox(at: url)
    }

    /// The scene's phase (`behind`: gone to the background): the engine checks in only in the
    /// foreground, and coming back runs rule 3's check at once — Settings may have taken the
    /// permission — and, from the background, reads History again where it shows. Each hop reads
    /// the phase as it is then, so two in quick succession can never leave the engine on the older
    /// one, nor run a check once the app has gone behind: its report refused by the suspended file,
    /// it would show a failure that is none.
    func setForeground(_ foreground: Bool, behind: Bool = false) {
        // Back in front from the background with History shown, its newest page is read again,
        // quietly, as each visit reads it: the screen does not appear again (F4's review). Never
        // from only inactive — Control Center pulled down and up — whose read from the top would
        // take Show earlier's pages from a student reading them (santa's round 1).
        if behind { wentBehind = true }
        if foreground, wentBehind {
            wentBehind = false
            if shown.screen == .history { Task { await refreshHistory() } }
        }
        self.foreground = foreground
        guard let onPhase else { return }
        Task { await onPhase.engine(self.foreground) }
        if foreground { Task { if self.foreground { await onPhase.check() } } }
    }
}

#if DEBUG
    /// The device checks' (B5, B6; ios/README.md, rounds 1–4), in a sheet behind `RootView`'s
    /// Readout button: the engine's link, the sign-in, the standing, what rule 3's check found and
    /// the queue — with triggers beside the screens: the block's scan, and a typed tag for rounds
    /// 1–3. Debug builds only.
    struct Readout: View {
        let phone: Phone
        let signIn: SignIn
        let engine: SyncEngine
        let enforcer: Enforcer
        @Environment(\.webAuthenticationSession) private var browser
        @State private var note = ""
        @State private var code = ""
        @State private var tag = ""
        @State private var shortCap = Bell.deviceCheckCap != nil
        @State private var losesBell = Bell.deviceCheckLosesBell

        var body: some View {
            VStack(spacing: 4) {
                Text("Debug readout — temporary").bold()
                Text("Link: \(link)")
                Text("Server last answered: \(heard)")
                Text("Signed in: \(signedIn)")
                HStack {
                    Button("Sign in") { Task { note = await signingIn() } }
                    Button("Sign out") { Task { note = await signingOut() } }
                }
                Text("Standing: \(standing)")
                Text("Screen Time: \(shields)")
                // #144 (F1b), read live every 5 s: the marker the check judges the access by, with
                // the monitor's note, and the asks of iOS — the silent check's, the one no press
                // made; Family Controls' read, which a running app keeps approved, and the windows
                // iOS holds; #145: how long that read said not determined after this launch.
                TimelineView(.periodic(from: .now, by: 5)) { _ in
                    Text("Marker: \(PhoneScreenTime.markerNow)")
                    Text("Asked iOS: \(asks)")
                    Text("iOS: \(PhoneScreenTime.signals)")
                    Text("Launch: \(PhoneScreenTime.launch)")
                }
                Button("Allow Screen Time") {
                    run {
                        try await enforcer.requestPermission()
                        return "asked"
                    }
                }
                HStack {
                    TextField("Join code", text: $code)
                    Button("Join") { run { await join() } }.disabled(code.isEmpty)
                }
                // B6: the block read over NFC and tapped — or only read, to register it on dev.
                HStack {
                    Button("Scan") {
                        run {
                            let read = await BlockReader().read()
                            let tapped = try await engine.tap(read) != nil
                            return said(read, tapped ? "tap recorded" : "")
                        }
                    }
                    Button("Read block code") {
                        run { said(await BlockReader().read(), "read only, nothing recorded") }
                    }
                }
                HStack {
                    TextField("Block tag", text: $tag)
                    Button("Tap") { run { try await act(.tap(tagId: tag)) } }.disabled(tag.isEmpty)
                }
                // Filed where decision 11 says: under a tap not yet answered, else the session.
                if phone.sync?.emergencyUnlock(reason: nil) != nil {
                    Button("Emergency Unlock") {
                        run { try await engine.emergencyUnlock() == nil ? "nothing" : "recorded" }
                    }
                }
                Text("Outbox: \(queue)")
                Button("History") { run { await history() } }
                // B5b's device check: a tap not yet answered capped at the floor, not 50 minutes —
                // kept where the monitor reads it too — the bell's next wake lost on purpose, for
                // its backup (B5b-3), and what the monitor did at its last wakes, newest first,
                // since it can show nothing itself.
                Toggle("Cap a tap at 15 min (device check)", isOn: $shortCap)
                    .onChange(of: shortCap) { _, on in
                        Bell.deviceCheckCap = on ? Bell.floor : nil
                        Task { await engine.setTapCap(Bell.deviceCheckCap) }
                    }
                Toggle("Lose the bell's next wake (device check)", isOn: $losesBell)
                    .onChange(of: losesBell) { _, on in Bell.deviceCheckLosesBell = on }
                Text("Monitor: \(monitor)")
                Text(note)
            }
            .font(.footnote.monospaced())
            .buttonStyle(.bordered)
            .textFieldStyle(.roundedBorder)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding()
        }

        private var link: String {
            switch phone.sync?.link {
            case .reached?: "reached"
            case .unreachable?: "unreachable"
            case .signIn?: "sign-in"
            case .storageFailed?: "storage failed"
            case nil: "no exchange yet"
            }
        }

        private var heard: String {
            phone.sync?.heardAt?.formatted(date: .omitted, time: .standard) ?? "never"
        }

        private var signedIn: String {
            phone.signedIn.map { $0 ? "yes" : "no" } ?? "not known yet (the phone locked?)"
        }

        private var standing: String {
            switch phone.sync?.standing {
            case .inSession(let session, let state)?:
                "\(state?.rawValue ?? "unknown") until \(time(session.endsAt))"
            case .waiting?:
                "waiting for the teacher's Start"
                    + (phone.sync?.waitEnds.map { ", until \(day($0))" } ?? ", no end kept")
            case .unread?: "not read from the phone yet — Emergency Unlock still works"
            case .out?, nil: "in no session"
            }
        }

        /// What rule 3's check found — never the standing alone.
        private var shields: String {
            guard let protection = phone.protection else { return "not checked yet" }
            var line =
                "\(protection.permission) · shields \(protection.shielded ? "on" : "off")"
                + (protection.until.map { ", due until \(time($0))" } ?? "")
                + (protection.unreported ? " · protection off NOT recorded" : "")
                + (protection.unscheduled ? " · bell NOT scheduled" : "")
            if let refused = protection.monitorUnscheduled {
                line += " · the monitor's bell NOT scheduled at \(time(refused)), app closed"
            }
            return line
        }

        private func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }
        private func day(_ date: Date) -> String { date.formatted(date: .abbreviated, time: .shortened) }

        /// The asks of iOS for the access since this launch, newest first (F1b).
        private var asks: String {
            PhoneScreenTime.asks.isEmpty ? "none" : PhoneScreenTime.asks.joined(separator: "\n")
        }

        /// What the monitor did at its last wakes, newest first — which window woke it, too.
        private var monitor: String {
            Bell.wakes.isEmpty ? "not woken yet" : Bell.wakes.joined(separator: "\n")
        }

        /// Runs a trigger, and says how it went.
        private func run(_ trigger: @escaping @MainActor () async throws -> String) {
            Task {
                do { note = try await trigger() } catch { note = "Failed: \(error)" }
            }
        }

        /// What the phone did, through the engine, as the screens will record it.
        private func act(_ change: Change) async throws -> String {
            try await engine.record(change) == nil ? "nothing new to send" : "recorded"
        }

        /// A scan, in words: a block's code and `then`, or why nothing was recorded.
        private func said(_ read: BlockRead, _ then: String) -> String {
            switch read {
            case .block(let code): "block \(code): \(then)"
            case .notBali: "not a Bali block — nothing recorded"
            case .cancelled: "scan cancelled — nothing recorded"
            case .unsupported: "this iPhone cannot read NFC — nothing recorded"
            case .failed(let why): "scan failed: \(why) — nothing recorded"
            }
        }

        /// What is queued, in the order the phone acted: a stuck record with its last answer.
        private var queue: String {
            let queued = (phone.sync?.queued ?? []).map { record in
                let kind =
                    switch record.change {
                    case .tap: "tap"
                    case .unlock: "unlock"
                    case .unlockUnderTap: "unlock under its tap"
                    case .unlockUnfiled: "unlock, its class not known yet"
                    case .refocus: "refocus"
                    case .protectionOff: "protection off"
                    case .protectionOn: "Screen Time back on"
                    }
                let answer = record.lastStatus.map { "\($0)" } ?? "no answer"
                return kind + (record.stuck ? " (stuck: \(answer))" : "")
            }
            return queued.isEmpty ? "empty" : queued.joined(separator: " · ")
        }

        /// The student's latest moments, as `GET /v1/me/history` gives them: newest first.
        private func history() async -> String {
            let page = await engine.client.history(limit: 5)
            guard let events = page.answer?.events else {
                return "history not read: \(page.result)"
            }
            return events.map { "\($0.type.rawValue) \(time($0.occurredAt))" }
                .joined(separator: " · ")
        }

        /// A class joined through the engine, as the Join screen joins one: in `me` at once.
        private func join() async -> String {
            let now = Date()
            let joined = await engine.join(
                EnrollmentJoinRequest(joinCode: code, eventId: EventID.mint(at: now), deviceTime: now))
            return joined.answer.map { "joined \($0.class.name)" }
                ?? "not joined: \(joined.result) \(joined.error?.error.message ?? "")"
        }

        /// Signs in as Sign in does (`Phone.signIn`): what happened.
        private func signingIn() async -> String {
            guard !phone.signingIn else { return "A sign-in is under way already" }
            await phone.signIn(through: browser.hostedUI)
            return phone.signInFailed.map { "Sign-in didn't finish: \($0)" } ?? "Signed in"
        }

        /// Signs out of this phone: what happened.
        private func signingOut() async -> String {
            do {
                try await signIn.signOut()
                return "Signed out"
            } catch {
                return "Sign-out failed: \(error)"
            }
        }
    }
#endif
