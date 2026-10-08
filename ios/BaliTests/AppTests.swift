import AuthenticationServices
import BaliCore
import BaliOutbox
import FamilyControls
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import Bali

// The app target's own tests (B5b-2), hosted in the app on the iOS Simulator: what only the app
// holds. Everything the app only wires up is tested in its packages, on Linux too.

// One test at a time: several set the phone's own defaults (`AgeCheck.key`, `inClass`) across their
// awaits, which another test running between them would read (Claude Review).
@MainActor
@Suite("The app", .serialized)
struct AppTests {
    @Test(
        "This build's Info.plist gives the config reader every value ios/project.yml sets: sign-in is set up (#84's review)"
    )
    func config() throws {
        let config = try #require(AppConfig(info: Bundle.main.infoDictionary ?? [:]))
        #expect(config.cognito.redirectURI == URL(string: "bali://auth/callback"))
        #expect(config.api.scheme == "https" && config.cognito.domain.scheme == "https")
    }

    @Test(
        "Each hop the scene's phase makes reads the phase as it runs (#90's review): in front, then behind at once, runs no check and leaves the engine behind; in front, one check"
    )
    func phase() async {
        @MainActor final class Heard {
            var phases: [Bool] = []
            var checks = 0
        }
        let heard = Heard()
        let phone = Phone()
        phone.onPhase = ({ heard.phases.append($0) }, { heard.checks += 1 })
        phone.setForeground(true)
        phone.setForeground(false)
        // A hop queued on the main actor after theirs: once it has run, so have they.
        await Task {}.value
        #expect(heard.checks == 0)
        #expect(heard.phases == [false, false])
        phone.setForeground(true)
        await Task {}.value
        #expect(heard.checks == 1)
        #expect(heard.phases == [false, false, true])
    }

    @Test(
        "A phone that cannot read NFC — the simulator is one — is told so at once: no scan begins, and nothing waits on one (B6)",
        .disabled(
            if: BlockReader.canRead,
            "This phone reads NFC: a scan would begin here — round 4 checks the reader on it")
    )
    func noNFC() async {
        #expect(await BlockReader().read() == .unsupported)
    }

    @Test(
        "A Debug launch names a fixture — `-bali-screen <name>` — rendered in place of the live phone, frozen: never started, and an ask for the permission on it changes nothing (C1b), nor a join code's look-up or a join (C2b), nor an Emergency Unlock (C4), a reason or Lock my apps again (C5a, C5c), nor a History read (C6a), nor a leave (C6c) — which say the phone has not started, never nothing (#106's review); Session over's Done still closes it (C5b). A name not known, or none, is the live app; and every fixture shows the screen it is named for (C1a), then a state of it"
    )
    func fixtures() async throws {
        #expect(PreviewFixtures.chosen(from: ["Bali"]) == nil)
        #expect(PreviewFixtures.chosen(from: ["Bali", "-bali-screen"]) == nil)
        #expect(PreviewFixtures.chosen(from: ["Bali", "-bali-screen", "nope"]) == nil)
        let chosen = try #require(PreviewFixtures.chosen(from: ["Bali", "-bali-screen", "signIn"]))
        let phone = Phone(fixture: chosen)
        #expect(phone.shown.screen == .signIn)
        await phone.start()
        #expect(phone.engine == nil && phone.shown.screen == .signIn)
        for (name, state) in PreviewFixtures.all {
            let screen = String(describing: Phone(fixture: state).shown.screen).prefix { $0 != "(" }
            #expect(name.hasPrefix(screen), "\(name): \(screen)")
        }
        let failed = Phone(fixture: try #require(PreviewFixtures.all["screenTimeError"]))
        #expect(failed.shown.screen == .screenTime)
        #expect(failed.askFailed?.words(.notDetermined) != nil)
        await failed.askScreenTime()
        #expect(failed.askFailed?.words(.notDetermined) != nil)
        let previewing = Phone(fixture: try #require(PreviewFixtures.all["joinPreview"]))
        #expect(previewing.joining.preview?.teacher.displayName == "Ms. Rivera")
        await previewing.join()
        #expect(previewing.joining.preview != nil && previewing.sync?.hasClasses == false)
        #expect(previewing.joining.failure == Joining.notStarted && !previewing.joining.busy)
        let refused = Phone(fixture: try #require(PreviewFixtures.all["joinError"]))
        #expect(refused.joining.preview == nil && refused.joining.code == "KWX49Q")
        await refused.lookUp()
        #expect(refused.joining.failure == Joining.notStarted && refused.joining.preview == nil)
        #expect(Phone(fixture: try #require(PreviewFixtures.all["home"])).sync?.hasClasses == true)
        let fromHome = Phone(fixture: try #require(PreviewFixtures.all["joinFromHome"]))
        #expect(fromHome.opened == [.join])
        // Join is only ever opened over Home (the owner's ruling, 2026-10-07), its way back there.
        for name in ["join", "joinPreview", "joinError", "joinFromHome"] {
            let join = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(join.shown == (.join, false) && join.opened == [.join], "\(name)")
            join.back()
            #expect(join.shown == (.home, true), "\(name)")
        }
        // Focus (C4): a frozen phone's Emergency Unlock says it has not started, never nothing;
        // the held tap's fixtures hold one, and the one over no shields claims none.
        #expect(
            await Phone(fixture: try #require(PreviewFixtures.all["focus"])).emergencyUnlock()
                == .notStarted)
        for (name, title, claim) in [
            ("focus", "Period 3 — Algebra II", FocusWords.Claim.paused),
            ("focusTapHeld", "You're in", .paused), ("focusNoShields", "You're in", .screenTimeOff),
        ] {
            let fixture = try #require(PreviewFixtures.all[name])
            let words = FocusWords(try #require(fixture.sync), fixture.protection, now: Date())
            #expect(words.title == title && words.claim == claim, "\(name)")
        }
        let late = try #require(PreviewFixtures.all["focusSuperseded"])
        #expect(FocusWords(try #require(late.sync), late.protection, now: Date()).superseded != nil)
        // Signed out mid-class: said beside the countdown, which still holds (C4's review).
        let out = Phone(fixture: try #require(PreviewFixtures.all["focusSignedOut"]))
        let said = FocusWords(try #require(out.sync), out.protection, now: Date(), signedIn: false)
        #expect(out.shown.screen == .focus && said.stalled != nil && said.claim == .paused)
        // Unlocked (C5a, C5c): each fixture's reason card and way back, and the bell the router
        // chooses again at; a frozen phone's pick and Lock my apps again say it has not started.
        let unlockedCases: [(String, UnlockedWords.Picker?, Bool)] = [
            ("unlocked", .open(nil), false), ("unlockedReason", .open(.bathroom), false),
            ("unlockedRecorded", nil, false), ("unlockedRetap", nil, true),
            ("unlockedOnItsWay", .waiting(nil), false), ("unlockedChanged", .open(.nurse), false),
            ("unlockedPicking", .open(nil), false), ("unlockedPickError", .open(.bathroom), false),
        ]
        for (name, picker, retap) in unlockedCases {
            let words = UnlockedWords(try #require(PreviewFixtures.all[name]?.sync))
            #expect(words?.picker == picker && (words?.retap != nil) == retap, "\(name)")
        }
        #expect(Phone(fixture: try #require(PreviewFixtures.all["unlockedPicking"])).picking == .nurse)
        let pickError = Phone(fixture: try #require(PreviewFixtures.all["unlockedPickError"]))
        #expect(pickError.pickFailed == UnlockedWords.offline)
        let unlocked = Phone(fixture: try #require(PreviewFixtures.all["unlocked"]))
        await unlocked.pick(.bathroom)
        #expect(unlocked.pickFailed == Joining.notStarted && unlocked.picking == nil)
        #expect(await unlocked.backToFocus() == Joining.notStarted)
        // Unlocked's Home (C5c): its tab bar, the apps still open, and its way back.
        let overUnlocked = Phone(fixture: try #require(PreviewFixtures.all["homeFromUnlocked"]))
        #expect(overUnlocked.shown.tabbed && overUnlocked.canGoBack)
        overUnlocked.back()
        #expect(overUnlocked.shown == (.unlocked, false))
        // Its Unlocked gone, the Home it opened is the router's own: its tab bar, no Back
        // (santa's round 1).
        let afterBell = Phone(fixture: PreviewFixtures.State(opened: [.home]))
        #expect(afterBell.shown == (.home, true) && !afterBell.canGoBack)
        // Home's card for a class in session (C3c): not in it, and unlocked in it.
        for (name, unlocked, retap) in [
            ("homeInSession", false, false), ("homeFromUnlocked", true, false),
            ("homeFromUnlockedRetap", true, true),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            let card = phone.sync?.inSessionCard(at: Date())
            #expect(phone.shown.screen == .home && card?.unlocked == unlocked, "\(name)")
            #expect((card?.retap != nil) == retap, "\(name)")
        }
        // Waiting's Back to home (#151): the regular Home, its tab bar and no Back, its card the
        // wait's — never C3c's.
        let homeWaiting = Phone(fixture: try #require(PreviewFixtures.all["homeWaiting"]))
        #expect(homeWaiting.shown == (.home, true) && !homeWaiting.canGoBack)
        #expect(homeWaiting.sync?.waitingCard != nil)
        #expect(homeWaiting.sync?.inSessionCard(at: Date()) == nil)
        // In no class (#143; the owner's ruling, 2026-10-07): Home, its tab bar and no Back, its
        // card in the hero's place, never C3c's or the wait's — a newcomer's too, never a Join of
        // the router's own; Sign out is Me's.
        for (name, ever) in [("homeNoClasses", true), ("homeNew", false)] {
            let noClasses = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(noClasses.shown == (.home, true) && !noClasses.canGoBack, "\(name)")
            #expect(noClasses.everInClass == ever, "\(name)")
            #expect(noClasses.sync?.noClassesCard(everInClass: ever) != nil, "\(name)")
            #expect(noClasses.sync?.inSessionCard(at: Date()) == nil, "\(name)")
            #expect(noClasses.sync?.waitingCard == nil && !noClasses.offersSignOut, "\(name)")
            noClasses.select(.me)
            #expect(noClasses.shown == (.me, true) && noClasses.offersSignOut, "\(name)")
        }
        // A pick told to wait for the unlock may go once it lands: those words go then, and no
        // other failure's do (santa's round 2).
        var standing = SyncState()
        standing.standing = .inSession(
            SessionView(id: "s", classId: "c", endsAt: Date() + 600), .unlocked)
        var landed = standing
        landed.recordedUnlock = RecordedUnlock(session: "s", unlock: "u", reason: nil)
        for (words, gone) in [(UnlockedWords.onItsWay, true), (UnlockedWords.offline, false)] {
            let phone = Phone(fixture: PreviewFixtures.State(sync: standing, pickFailed: words))
            phone.synced(standing)
            #expect(phone.pickFailed == words)
            phone.synced(landed)
            #expect((phone.pickFailed == nil) == gone, "\(words)")
            phone.synced(landed)
            #expect((phone.pickFailed == nil) == gone, "\(words)")
        }
        let home = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        #expect(unlocked.bell != nil && home.bell == nil)
        // History (C6a): D1's days and cards, each state's fixture its own — the moments kept with
        // their read again failed among them (#141); a frozen phone's read says it has not
        // started, and its screen's own read as it shows leaves the fixture as made.
        let history = try #require(PreviewFixtures.all["history"]?.history)
        let days = history.days(now: Date())
        #expect(days.map(\.title) == ["Today", "Yesterday"] && history.nextBefore != nil)
        #expect(days.flatMap(\.cards).map(\.moments.count) == [4, 2, 1])
        #expect(history.notUpdated == nil && history.failure == nil)
        #expect(try #require(PreviewFixtures.all["historyEmpty"]?.history).read)
        #expect(try #require(PreviewFixtures.all["historyError"]?.history).failure != nil)
        #expect(try #require(PreviewFixtures.all["historyLoading"]?.history).busy)
        let notUpdated = try #require(PreviewFixtures.all["historyRefreshError"]?.history)
        #expect(notUpdated.events == history.events && notUpdated.nextBefore == history.nextBefore)
        #expect(notUpdated.notUpdated?.hasPrefix("Bali couldn't update your history.") == true)
        #expect(notUpdated.failure == nil && !notUpdated.busy)
        // Its Try again under way, the words kept beside Reading…; a sign-in Bali couldn't check,
        // in one sentence (F4's review).
        let tryingAgain = try #require(PreviewFixtures.all["historyRefreshReading"]?.history)
        #expect(tryingAgain.notUpdated == notUpdated.notUpdated)
        #expect(tryingAgain.busy && tryingAgain.fromTop && tryingAgain.events == history.events)
        #expect(
            PreviewFixtures.all["historyRefreshSignIn"]?.history.notUpdated
                == "Bali couldn't check your sign-in to update your history. Try again.")
        let error = Phone(fixture: try #require(PreviewFixtures.all["historyError"]))
        await error.readHistory()
        #expect(error.history.failure == Joining.notStarted && !error.history.read)
        let shown = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        await shown.refreshHistory()
        #expect(shown.history == history)
        // With no history at all — Home's, its History chosen — that read says so (santa's round 1).
        let unread = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        unread.select(.history)
        await unread.refreshHistory()
        #expect(unread.history.failure == Joining.notStarted && !unread.history.read)
        // Protection off and Session over (C5b): each look's step and words, a refused Back to
        // focus said where the student lands, and Done closing Session over — Home past the bell.
        let looks: [(String, ProtectionOffWords.Way, Bool)] = [
            ("protectionOff", .settings, false), ("protectionOffBackOn", .retap, false),
            ("protectionOffChecking", .checking, false), ("protectionOffAsk", .ask, false),
            ("protectionOffUnreported", .settings, false), ("protectionOffRefused", .settings, true),
            ("protectionOffError", .settings, false),
        ]
        for (name, way, refused) in looks {
            let fixture = try #require(PreviewFixtures.all[name])
            let words = ProtectionOffWords(try #require(fixture.sync), fixture.protection)
            #expect(words?.way == way && (words?.refused != nil) == refused, "\(name)")
            #expect(words?.problems.isEmpty == (name != "protectionOffError"), "\(name)")
        }
        #expect(UnlockedWords(try #require(PreviewFixtures.all["unlockedRefused"]?.sync))?.retap != nil)
        #expect(PreviewFixtures.all["homeRefused"]?.sync?.refusedRefocusWords(at: Date()) != nil)
        // A scan of a block no teacher set up (#146): said while it is the phone's newest tap; a
        // tap since counted, kept and listed, said no more.
        let refusedTap = try #require(PreviewFixtures.all["homeTapRefused"]?.sync)
        #expect(refusedTap.refusedTapWords?.hasPrefix("Bali doesn't know a block you tapped") == true)
        let tappedSince = try #require(PreviewFixtures.all["homeTapRefusedThenTapped"]?.sync)
        #expect(tappedSince.queued.count == 1 && tappedSince.queued.first?.stuck == true)
        #expect(tappedSince.refusedTapWords == nil && tappedSince.lastTap != nil)
        // In no class, a tap refused for anything but an unknown block (#160's review): its way on
        // the Try again beside it, as this Home has no Tap in.
        let noClassStuck = Phone(fixture: try #require(PreviewFixtures.all["homeNoClassesTapStuck"]))
        #expect(noClassStuck.shown == (.home, true))
        #expect(noClassStuck.sync?.noClassesCard(everInClass: true) != nil)
        #expect(
            noClassStuck.sync?.refusedTapWords
                == "Bali couldn't record a tap. Try again, or ask your teacher.")
        let over = Phone(fixture: try #require(PreviewFixtures.all["sessionOver"]))
        #expect(over.sync?.sessionOverWords(over.protection)?.hasSuffix("All your apps are back.") == true)
        over.closeSessionOver()
        #expect(over.shown.screen == .home)
        // Done as a read puts the phone in a class whose bell has not rung: not the one that
        // ended, so nothing is closed — its own Session over stays to come (C5b's review).
        let racing = Phone(fixture: try #require(PreviewFixtures.all["sessionOver"]))
        var next = try #require(racing.sync)
        let running = SessionView(id: "next", classId: "p3", endsAt: Date() + 60)
        next.standing = .inSession(running, .focused)
        racing.synced(next)
        racing.closeSessionOver()
        racing.seeHistory()
        #expect(racing.sessionOverClosed == nil && racing.tab == .home)
        // See history (D1's, C5b's hand-off): History shown, and kept once the read after the bell
        // says where the phone stands.
        let seen = Phone(fixture: try #require(PreviewFixtures.all["sessionOver"]))
        seen.seeHistory()
        #expect(seen.shown == (.history, true))
        var read = try #require(seen.sync)
        read.standing = .out
        seen.synced(read)
        #expect(seen.shown == (.history, true))
        // Join opened before the bell (over a class's Home this build knows no state of) is left
        // behind: History, never the Join the router would show in its place (santa's round 1).
        let opened = Phone(fixture: try #require(PreviewFixtures.all["sessionOver"]))
        opened.open(.join)
        opened.joining.type("KWX")
        opened.seeHistory()
        #expect(opened.shown.screen == .history && opened.opened.isEmpty)
        #expect(opened.joining == Joining())
        // Me (C6b): D1's name card, editing it and a refused save; Sign out held over an unsent
        // unlock — pressed, nothing tried — and one that failed.
        let me = Phone(fixture: try #require(PreviewFixtures.all["me"]))
        #expect(me.sync?.me?.user.displayName == "Ana Rodríguez" && !me.naming.editing)
        #expect(try #require(PreviewFixtures.all["meEditing"]).naming.name == "Ana R.")
        let taken = Naming.words(.status(409), .displayNameTaken)
        #expect(try #require(PreviewFixtures.all["meNameError"]).naming.failure == taken)
        let held = Phone(fixture: try #require(PreviewFixtures.all["meSignOutHeld"]))
        #expect(held.sync.flatMap(SignOutWords.held) != nil)
        await held.signOut()
        #expect(held.signOutFailed == nil && held.shown.screen == .me)
        #expect(me.sync.flatMap(SignOutWords.held) == nil)
        let notOut = Phone(fixture: try #require(PreviewFixtures.all["meSignOutFailed"]))
        #expect(notOut.signOutFailed == SignOutWords.failed)
        // Whose sign-in this is (#147): Ana's email on every Me, said by its Sign out — each
        // fixture whose screen is Me, whatever its name (#159's review).
        for (name, state) in PreviewFixtures.all {
            let phone = Phone(fixture: state)
            let said = phone.shown.screen == .me ? "You're signed in as ana.rodriguez@bali.test." : nil
            #expect(SignOutWords.signedIn(phone.email) == said, "\(name)")
        }
        // Me over a standing not read, Screen Time taken back: its row reads Off (Riders-2's santa).
        let off = Phone(fixture: try #require(PreviewFixtures.all["meScreenTimeOff"]))
        #expect(off.shown == (.me, true) && off.protection?.permissionOff == true)
        // Leave (C6c): Period 3's question; the leave under way; the server's no said under it;
        // and Leave held while the phone stands in Period 3's lesson, never out of it. A frozen
        // phone's leave says it has not started, the question kept to try again; a change of who
        // is signed in takes it away.
        let asked = Phone(fixture: try #require(PreviewFixtures.all["meLeaveAsk"]))
        let period3 = try #require(asked.sync?.me?.classes.first)
        #expect(asked.leaving.asking == period3 && period3.enrollmentId == "e3")
        #expect(!asked.leaving.busy && asked.shown == (.me, true))
        await asked.leave()
        #expect(asked.leaving.failure == Joining.notStarted && asked.leaving.asking == period3)
        asked.signed(in: false)
        #expect(asked.leaving == Leaving())
        #expect(try #require(PreviewFixtures.all["meLeaving"]).leaving.busy)
        let refusedLeave = try #require(PreviewFixtures.all["meLeaveError"]).leaving
        #expect(refusedLeave.failure == Leaving.inSession(period3) && !refusedLeave.busy)
        let inLesson = Phone(fixture: try #require(PreviewFixtures.all["meLeaveInSession"]))
        #expect(inLesson.shown == (.me, true))
        let lesson = try #require(inLesson.sync)
        #expect(Leaving.held(period3, lesson, now: Date()) == Leaving.inSession(period3))
        #expect(Leaving.held(period3, try #require(me.sync), now: Date()) == nil)
        // Delete account (C4b): its question on Me, its tab bar kept; confirmed, the deletion's own
        // screen and no tab bar — a frozen phone's says it has not started, with Try again, and
        // Back returns to Me; under way, over Focus and its shields too; each stop; the sign-in
        // waiting to be deleted; and done, OK leaving to Sign in. Nothing of Me's or Join's is
        // offered there (`offersSignOut`).
        let asking = Phone(fixture: try #require(PreviewFixtures.all["meDeleteAsk"]))
        #expect(asking.shown == (.me, true) && asking.deleting == .asking)
        asking.deleting.cancel()
        #expect(asking.deleting == .none && asking.shown == (.me, true))
        asking.deleting.ask()
        await asking.deleteAccount()
        #expect(
            asking.deleting
                == .stopped(title: Deleting.notDeleted, why: Joining.notStarted, retries: true))
        #expect(asking.shown == (.deleting, false) && !asking.offersSignOut)
        asking.deleting.close()
        #expect(asking.deleting == .none && asking.shown == (.me, true))
        let busy = Phone(fixture: try #require(PreviewFixtures.all["deleting"]))
        #expect(busy.shown == (.deleting, false) && busy.deleting == .busy)
        let shieldedDeleting = Phone(fixture: try #require(PreviewFixtures.all["deletingShielded"]))
        #expect(shieldedDeleting.sync?.shieldedUntil(Date()) != nil)
        #expect(shieldedDeleting.shown == (.deleting, false))
        for (name, retries, title) in [
            ("deletingSignInFirst", false, Deleting.notDeleted),
            ("deletingTeacher", false, Deleting.notDeleted),
            ("deletingUnlockUnsent", true, Deleting.notFinished),
            ("deletingUnread", true, Deleting.notFinished),
            ("deletingNotDeleted", true, Deleting.notFinished),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(phone.shown == (.deleting, false), "\(name)")
            guard case .stopped(let said, let why, let again) = phone.deleting else {
                Issue.record("\(name) is not a stop")
                continue
            }
            #expect(again == retries && !why.isEmpty && said == title, "\(name)")
            #expect(phone.deleting.said?.title == title, "\(name)")
            phone.deleting.close()
            #expect(phone.deleting == .none && phone.shown.screen != .deleting, "\(name)")
        }
        let pending = Phone(fixture: try #require(PreviewFixtures.all["deletingPending"]))
        #expect(pending.shown == (.deleting, false) && pending.deleting == .pending)
        pending.deleting.close()
        #expect(pending.deleting == .pending)
        let done = Phone(fixture: try #require(PreviewFixtures.all["deletingDone"]))
        #expect(done.shown == (.deleting, false) && done.signedIn == false)
        done.deleting.close()
        #expect(done.deleting == .none && done.shown == (.signIn, false))
        // Who is signed in changing takes the question with it, and holds a deletion under way,
        // one waiting for DeleteUser and the done screen; a sign-in whose account is deleted lands
        // on the deletion's screen at once, as a relaunch does (`follow`).
        let askedThenOut = Phone(fixture: try #require(PreviewFixtures.all["meDeleteAsk"]))
        askedThenOut.signed(in: false)
        #expect(askedThenOut.deleting == .none && askedThenOut.shown.screen == .signIn)
        for name in ["deleting", "deletingPending", "deletingDone"] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            let before = phone.deleting
            phone.signed(in: false)
            #expect(phone.deleting == before && phone.shown.screen == .deleting, "\(name)")
        }
        let relaunched = Phone(fixture: try #require(PreviewFixtures.all["me"]))
        relaunched.signed(in: true, as: "ana", pending: true)
        #expect(relaunched.deleting == .pending && relaunched.shown == (.deleting, false))
        let busyStays = Phone(fixture: try #require(PreviewFixtures.all["deleting"]))
        busyStays.signed(in: true, as: "ana", pending: true)
        #expect(busyStays.deleting == .busy)
    }

    @Test(
        "D1's tab bar (C6a) shows wherever the router honours a tab — its own Home, Home opened over Unlocked (C5c) or over Waiting (#151), History and Me, but while Me's name is edited (C6b) — never over the last run's shields' Home, Waiting, Join or a session's screens; a tab chosen shows its screen, History's read kept from one visit to the next (#141) and as it was when chosen again while it shows (santa's round 1); the tab is Home again once the screens opened close — the standing changed — the history read kept, or who is signed in changes, the history read gone with it; a read that keeps them keeps the tab; Me's Join a class has its way back to Me (C6b)"
    )
    func tabs() async throws {
        let (homes, editing) = (
            [
                "home", "homeLoading", "homeError", "homeUnread", "homeRefused", "homeFromUnlocked",
                "homeFromUnlockedRetap", "homeInSession", "homeTapRefused", "homeTapRefusedThenTapped",
                "homeWaiting", "homeNew", "homeNoClasses", "homeNoClassesTapStuck",
            ],
            ["meEditing", "meNameError"]
        )
        for (name, state) in PreviewFixtures.all {
            let me = name.hasPrefix("me") && !editing.contains(name)
            let tabbed = homes.contains(name) || name.hasPrefix("history") || me
            #expect(Phone(fixture: state).shown.tabbed == tabbed, "\(name)")
        }
        let phone = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        phone.select(.me)
        #expect(phone.shown.screen == .me)
        phone.select(.history)
        #expect(phone.shown.screen == .history && phone.history == History())
        await phone.readHistory()
        #expect(phone.history.failure == Joining.notStarted)
        // Chosen again while it shows: as it was — its screen does not appear anew, so a history
        // forgotten now would say it is reading, forever, with nothing reading (santa's round 1).
        phone.select(.history)
        #expect(phone.history.failure == Joining.notStarted)
        // Kept from one visit to the next (#141): its screen reads it again as it shows.
        phone.select(.me)
        phone.select(.history)
        #expect(phone.history.failure == Joining.notStarted)
        var state = try #require(phone.sync)
        state.heardAt = Date()
        phone.synced(state)
        #expect(phone.shown.screen == .history)
        state.standing = .waiting
        phone.synced(state)
        #expect(phone.tab == .home && phone.shown == (.waiting, false))
        #expect(phone.history.failure == Joining.notStarted)
        state.standing = .out
        phone.synced(state)
        #expect(phone.shown == (.home, true))
        let signedOut = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        signedOut.signed(in: false)
        #expect(signedOut.shown.screen == .signIn && signedOut.history == History())
        signedOut.signed(in: true)
        // The starting screen until a read names who signed in (warn 1's fix), then Home.
        #expect(signedOut.shown.screen == .starting && signedOut.tab == .home)
        signedOut.synced(try #require(PreviewFixtures.all["history"]?.sync))
        #expect(signedOut.shown.screen == .home)
        // Me's Join a class opens Join over it — no tab bar there — and Back returns to Me.
        let fromMe = Phone(fixture: try #require(PreviewFixtures.all["me"]))
        fromMe.open(.join)
        #expect(fromMe.shown == (.join, false) && fromMe.canGoBack)
        fromMe.back()
        #expect(fromMe.shown == (.me, true))
        // Me's name edited: no tab bar, Save and Cancel the ways on; cancelled, the bar is back.
        let named = Phone(fixture: try #require(PreviewFixtures.all["meEditing"]))
        #expect(named.shown == (.me, false))
        named.naming = Naming()
        #expect(named.shown == (.me, true))
        // Mid-edit, a change of standing sends the tab Home (santa's round 1): Home keeps its bar,
        // and Me, chosen again, shows the edit as it was, without one.
        let away = Phone(fixture: try #require(PreviewFixtures.all["meEditing"]))
        var moved = try #require(away.sync)
        moved.standing = .waiting
        away.synced(moved)
        moved.standing = .out
        away.synced(moved)
        #expect(away.shown == (.home, true) && away.naming.editing)
        away.select(.me)
        #expect(away.shown == (.me, false) && away.naming.name == "Ana R.")
    }

    @Test(
        "Me lets go of a class's Leave at its lesson's bell by itself (#134's review): drawn alone, with no router to choose again, it is drawn as Me is past that bell once the bell rings by the phone's clock — the line saying the class is in session gone, its Leave no longer dimmed — where before it, it was not",
        .timeLimit(.minutes(3)))
    func leaveAtTheBell() async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let state = try #require(PreviewFixtures.all["meLeaveInSession"]?.sync)
        let period3 = try #require(state.me?.classes.first)
        /// Me in a window of its own, standing in Period 3's lesson, its bell at `bell`.
        func me(ringing bell: Date) -> UIWindow {
            var standing = state
            standing.standing = .inSession(
                SessionView(id: "session", classId: period3.id, endsAt: bell), nil)
            let phone = Phone(fixture: PreviewFixtures.State(sync: standing, tab: .me))
            let window = UIWindow(windowScene: scene)
            window.frame = scene.screen.bounds
            window.rootViewController = UIHostingController(rootView: MeView(phone: phone))
            window.isHidden = false
            window.layoutIfNeeded()
            return window
        }
        // Held, and past the bell, drawn first, with no bell to beat: the first window a test
        // draws is the slow one. A held Leave is drawn otherwise than one past its bell.
        let (rung, held) = (me(ringing: Date() - 60), me(ringing: Date() + 3600))
        let (past, holding) = (drawn(rung), drawn(held))
        #expect(holding != past)
        // Then one whose bell is near: drawn as the held one is, until its bell rings — so it is
        // only this window's own drawing, in one pass on the main actor, that must beat the bell
        // (#172's review: both windows' first drawing had to).
        let bell = Date() + 15
        let ringing = me(ringing: bell)
        defer { (ringing.isHidden, rung.isHidden, held.isHidden) = (true, true, true) }
        #expect(drawn(ringing) == holding)
        try await until { Date() > bell && drawn(ringing) == past }
    }

    @Test(
        "A History read's answer (santa's round 1): kept while it is the latest read — Show earlier's page added after those read, its cursor next; a read from the top's page in their place (#141) — and once the student has left History too, for their next visit (#141), but dropped once they signed out or another student signed in, so no student is shown another's; Show earlier's cursor the history does not hold reads again from the top, the moments kept meanwhile, which a frozen phone says it cannot"
    )
    func historyRead() async throws {
        let older =
            #"{"events":[{"eventId":"m0","type":"tap_in","occurredAt":"2026-09-01T13:00:00Z","class":{"id":"p3","name":"Period 3 — Algebra II"},"teacher":{"displayName":"Ms. Rivera"},"session":null,"reason":null,"recordedAs":null,"countedIn":null}],"nextBefore":null}"#
        // Show earlier's page on its way, as its button leaves the history.
        var paging = try #require(PreviewFixtures.all["history"]?.history)
        paging.fromTop = false
        let earlier = PreviewFixtures.State(tab: .history, history: paging)
        let phone = Phone(fixture: earlier)
        let shown = phone.history.events.count
        await phone.historyRead(await client(200, older).history(), for: phone.reads)
        #expect(phone.history.events.count == shown + 1 && phone.history.nextBefore == nil)
        let top = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        await top.historyRead(await client(200, older).history(), for: top.reads)
        #expect(top.history.events.map(\.eventId) == ["m0"] && top.history.nextBefore == nil)
        let left = Phone(fixture: earlier)
        let leftRead = left.reads
        left.select(.home)
        await left.historyRead(await client(200, older).history(), for: leftRead)
        #expect(left.history.events.count == shown + 1)
        let leaves: [@MainActor (Phone) -> Void] = [
            { $0.signed(in: false) },
            {
                $0.signed(in: true, as: "ana")
                $0.signed(in: true, as: "bea")
            },
        ]
        for leave in leaves {
            let gone = Phone(fixture: earlier)
            let read = gone.reads
            leave(gone)
            await gone.historyRead(await client(200, older).history(), for: read)
            #expect(gone.history == History())
        }
        // Show earlier's cursor, which the history does not hold: read again from the top, the
        // moments kept meanwhile.
        let cursor = #"{"error":{"code":"bad_input","reason":"unknown_cursor","message":"no"}}"#
        let paged = Phone(fixture: earlier)
        await paged.historyRead(await client(400, cursor).history(before: "m0"), for: paged.reads)
        #expect(paged.history.events.count == shown && paged.history.fromTop)
        #expect(paged.history.notUpdated == "Bali couldn't update your history. \(Joining.notStarted)")
        // A read from the top goes ahead of Show earlier's page on its way — on a phone not
        // started too, which says so — so that page, landing after, is dropped, never taken for
        // the newest in place of the moments read (F4's review).
        var onItsWay = paging
        onItsWay.busy = true
        let ahead = Phone(fixture: PreviewFixtures.State(tab: .history, history: onItsWay))
        let showEarlier = ahead.reads
        await ahead.readHistory()
        await ahead.historyRead(await client(200, older).history(before: "m1"), for: showEarlier)
        #expect(ahead.history.events.count == shown && ahead.history.nextBefore != nil)
        #expect(ahead.history.notUpdated == "Bali couldn't update your history. \(Joining.notStarted)")
    }

    @Test(
        "History on screen as the app comes back to the front from the background reads its newest page again, quietly, as each visit does (F4's review: it does not appear again) — never from only inactive, Control Center pulled down and up, whose read from the top would take Show earlier's pages from a student reading them (santa's round 1), nor under another screen"
    )
    func historyInFront() async {
        let shown = Phone(fixture: PreviewFixtures.State(tab: .history))
        #expect(shown.shown.screen == .history)
        shown.setForeground(true)
        shown.setForeground(false)
        shown.setForeground(true)
        // A hop queued on the main actor after any read's: once it has run, a read would show.
        await Task {}.value
        #expect(shown.history == History())
        shown.setForeground(false)
        shown.setForeground(false, behind: true)
        shown.setForeground(false)
        shown.setForeground(true)
        await Task {}.value
        #expect(shown.history.failure == Joining.notStarted)
        shown.forgetHistory()
        shown.setForeground(true)
        await Task {}.value
        #expect(shown.history == History())
        let away = Phone(fixture: PreviewFixtures.State(tab: .me))
        away.setForeground(false, behind: true)
        away.setForeground(true)
        await Task {}.value
        #expect(away.history == History())
    }

    @Test(
        "History's days as its screen draws them (`Phone.historyDays`, kept from one change of the history to the next: F5's review) are always the history's own: the same moments through a read that failed, and a page that changes them drawn anew — never a stale drawing"
    )
    func historyDays() async throws {
        let phone = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        #expect(phone.historyDays == phone.history.days(now: Date()))
        #expect(phone.historyDays.flatMap(\.cards).map(\.moments.count) == [4, 2, 1])
        await phone.readHistory()
        #expect(phone.history.notUpdated != nil)
        #expect(phone.historyDays.flatMap(\.cards).map(\.moments.count) == [4, 2, 1])
        let top = #"{"events":[{"eventId":"m0","type":"tap_in","occurredAt":"2026-09-01T13:00:00Z","class":{"id":"p3","name":"Period 3 — Algebra II"},"teacher":{"displayName":"Ms. Rivera"},"session":null,"reason":null,"recordedAs":null,"countedIn":null}],"nextBefore":null}"#
        await phone.historyRead(await client(200, top).history(), for: phone.reads)
        #expect(phone.history.events.map(\.eventId) == ["m0"])
        #expect(phone.historyDays == phone.history.days(now: Date()))
        #expect(phone.historyDays.flatMap(\.cards).map(\.moments.count) == [1])
    }

    @Test(
        "Me's name and Sign out as the phone keeps them (C6b): a blank name's save says how on (santa's round 1); a frozen phone's save and Sign out say it has not started, never nothing, the name kept to try again; Sign out tries nothing while an Emergency Unlock is unsent; and a change of who is signed in takes a name being edited, and a failed Sign out, with it"
    )
    func nameAndSignOut() async throws {
        let phone = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        phone.naming.edit(" ")
        await phone.saveName()
        #expect(phone.naming.failure == Naming.blank && phone.naming.editing)
        phone.naming.edit("Ana")
        phone.naming.type("Ana R.")
        await phone.saveName()
        #expect(phone.naming.failure == Joining.notStarted && phone.naming.editing)
        #expect(!phone.naming.busy && phone.naming.name == "Ana R.")
        #expect(phone.sync.flatMap(SignOutWords.held) == nil)
        await phone.signOut()
        #expect(phone.signOutFailed == Joining.notStarted)
        phone.signed(in: false)
        #expect(phone.naming == Naming() && phone.signOutFailed == nil)
        // Unlocked's unlock waits for its reason, unsent.
        let unlocked = Phone(fixture: try #require(PreviewFixtures.all["unlocked"]))
        #expect(unlocked.sync.flatMap(SignOutWords.held) != nil)
        await unlocked.signOut()
        #expect(unlocked.signOutFailed == nil)
        // Sign out is Me's — every student in no class lands on Home with its tab bar, so Me is the
        // wrong account's way out (the owner's ruling, 2026-10-07) — and Your name's; never on a
        // Join, opened over Home or Me, whose way back reaches Me, nor elsewhere.
        for (name, offers) in [
            ("me", true), ("join", false), ("joinFromHome", false), ("homeNew", false),
            ("home", false), ("focus", false), ("signIn", false), ("deleting", false),
            ("deletingPending", false), ("name", true),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(phone.offersSignOut == offers, "\(name)")
        }
        // Signed out from Join: the code typed goes with who typed it.
        let typed = Phone(fixture: try #require(PreviewFixtures.all["joinError"]))
        typed.signed(in: false)
        #expect(typed.joining == Joining())
    }

    @Test(
        "A class code typed goes with who typed it, a look-up or a join on its way too (Riders-2's review): signed out, or another student signed in, while one runs, the code goes at once, and its answer, landing after, is dropped — the class it opens, or why not, never said to the next student, nor a look-up of theirs under way, the same code typed again, marked done by it: theirs answers for itself"
    )
    func joiningSignedOut() async throws {
        let found =
            #"{"class":{"id":"p3","name":"Period 3 — Algebra II"},"teacher":{"displayName":"Ms. Rivera"},"alreadyEnrolled":false}"#
        let none = #"{"error":{"code":"not_found","reason":"class_not_found","message":"none"}}"#
        let tries: [(@MainActor (Phone) async -> Void, (status: Int, body: String))] = [
            ({ await $0.lookUp() }, (200, found)), ({ await $0.join() }, (404, none)),
        ]
        let leaves: [@MainActor (Phone) -> Void] = [
            { $0.signed(in: false) }, { $0.signed(in: true, as: "bea") },
        ]
        for (attempt, answer) in tries {
            for leave in leaves {
                let server = StandIn(tries: [answer, (200, found)])
                let (phone, _) = try standIn(server)
                phone.signed(in: true, as: "ana")
                phone.joining.type("KWX49Q")
                let trying = Task { await attempt(phone) }
                try await until { await server.asked.count == 1 }
                leave(phone)
                #expect(phone.joining == Joining())
                // The next student types the same code and looks it up: theirs is under way when
                // the last one's answer lands.
                phone.signed(in: true, as: "bea")
                phone.joining.type("KWX49Q")
                let theirs = Task { await phone.lookUp() }
                try await until { await server.asked.count == 2 }
                await server.letGo()
                await trying.value
                #expect(phone.joining.busy && phone.joining.preview == nil)
                #expect(phone.joining.failure == nil)
                await server.letGo()
                await theirs.value
                #expect(!phone.joining.busy && phone.joining.preview?.class.id == "p3")
            }
        }
    }

    @Test(
        "History's pages through the phone's own engine (C6a-2's review): Show earlier asks for the page after those read — the cursor the last one named — and adds it, the history kept; a read from the top asks for none, and its page takes the place of those read (#141)"
    )
    func historyPages() async throws {
        let server = StandIn(pages: [
            page(["m2"], next: "m2"), page(["m1"], next: nil), page(["m3"], next: nil),
        ])
        let (phone, _) = try standIn(server)
        await phone.readHistory()
        #expect(phone.history.events.map(\.eventId) == ["m2"] && phone.history.nextBefore == "m2")
        await phone.readHistory(more: true)
        #expect(phone.history.events.map(\.eventId) == ["m2", "m1"])
        #expect(phone.history.nextBefore == nil && phone.history.read)
        await phone.readHistory()
        #expect(phone.history.events.map(\.eventId) == ["m3"])
        #expect(await server.befores == [nil, "m2", nil])
    }

    @Test(
        "History kept while the app runs (#141), through the phone's own engine: a second visit shows what the first read at once — the tab changed, and Home again after a read — and its screen reads the newest page again, which takes its place; a read again that fails keeps the moments and says so above them, its Try again from the top (rule 5), Show earlier meanwhile leaving that said"
    )
    func historyKept() async throws {
        let server = StandIn(pages: [page(["m2"], next: "m2"), page(["m3", "m2"], next: "m2")])
        let (phone, _) = try standIn(server)
        phone.select(.history)
        await phone.refreshHistory()
        #expect(phone.history.events.map(\.eventId) == ["m2"])
        phone.select(.home)
        phone.synced(SyncState())
        phone.select(.history)
        #expect(phone.history.events.map(\.eventId) == ["m2"] && phone.history.read)
        await phone.refreshHistory()
        #expect(phone.history.events.map(\.eventId) == ["m3", "m2"])
        #expect(await server.befores == [nil, nil])
        // The server unreachable now (the stand-in has no page left): the moments stay, said.
        await phone.refreshHistory()
        #expect(phone.history.events.map(\.eventId) == ["m3", "m2"] && phone.history.read)
        #expect(
            phone.history.notUpdated
                == "Bali couldn't update your history. Can't reach the server. Check your connection and try again."
        )
        #expect(!phone.history.busy && phone.history.nextBefore == "m2")
        // Show earlier meanwhile, its page not come either: each said in its own place.
        await phone.readHistory(more: true)
        #expect(phone.history.notUpdated != nil && phone.history.failure != nil)
        #expect(await server.befores == [nil, nil, nil, "m2"])
    }

    @Test(
        "A visit's read from the top goes ahead of Show earlier's page still on its way (#141, santa's round 1): the newest page read all the same, in place of all read, and the older page, landing after, dropped; the button reads Reading… for its own page only"
    )
    func historyAhead() async throws {
        let server = StandIn(
            pages: [page(["m2"], next: "m2"), page(["m1"], next: nil), page(["m3", "m2"], next: "m2")],
            hold: "m2")
        let (phone, _) = try standIn(server)
        await phone.refreshHistory()
        async let earlier: Void = phone.readHistory(more: true)
        try await until { await server.befores.count == 2 }
        #expect(phone.history.busy && !phone.history.fromTop)
        phone.select(.home)
        phone.select(.history)
        await phone.refreshHistory()
        #expect(phone.history.events.map(\.eventId) == ["m3", "m2"] && !phone.history.busy)
        await server.letGo()
        await earlier
        #expect(phone.history.events.map(\.eventId) == ["m3", "m2"])
        #expect(phone.history.nextBefore == "m2" && !phone.history.busy)
        #expect(await server.befores == [nil, "m2", nil])
    }

    @Test(
        "History follows who is signed in (#141): a sign-in reads the student's history once `GET /v1/me` names them a student, so even their first visit shows it — never a teacher's account's, which the API refuses (F4's review); another student's sign-in forgets the last one's on the spot, before theirs is read, and a sign-out forgets it — no student is ever shown another's"
    )
    func historySignedIn() async throws {
        let server = StandIn(pages: [page(["a1"], next: nil), page(["b1"], next: nil)])
        let (phone, _) = try standIn(server)
        /// The engine's state once `GET /v1/me` named `id`, a `role`, after `forgets` students'.
        func named(_ id: String, _ role: String = "student", forgets: Int = 0) throws -> SyncState {
            var state = SyncState()
            state.me = try BaliJSON.makeDecoder().decode(
                MeResponse.self,
                from: Data(
                    #"{"user":{"id":"\#(id)","role":"\#(role)","displayName":null},"classes":[],"session":null}"#
                        .utf8))
            state.forgets = forgets
            return state
        }
        phone.signed(in: true, as: "ana")
        // A hop queued on the main actor after any read's: once it has run, a read would show.
        await Task {}.value
        #expect(phone.history == History())
        phone.synced(try named("ana"))
        try await until { phone.history.read }
        #expect(phone.history.events.map(\.eventId) == ["a1"])
        phone.signed(in: true, as: "bea")
        #expect(phone.history == History())
        phone.synced(try named("bea", forgets: 1))
        try await until { phone.history.read }
        #expect(phone.history.events.map(\.eventId) == ["b1"])
        phone.signed(in: false)
        #expect(phone.history == History())
        phone.signed(in: true, as: "tom")
        phone.synced(try named("tom", "teacher", forgets: 2))
        await Task {}.value
        #expect(phone.history == History())
        #expect(await server.befores == [nil, nil])
    }

    @Test(
        "Sign out through the phone's own sign-in and outbox (C6b-1's review): an Emergency Unlock the outbox file holds unsent, said and nothing tried — still said while the file holds it, a state whose queue shows none changing nothing; gone at once when a hold the queue showed ends, never a moment late under an enabled Sign out; and gone once the unlock has gone where no queue the phone was given ever showed it (#129's review: its reads may fail throughout); a Keychain that cannot forget the tokens now, said; forgotten, nothing said and nobody signed in — each try's words the last one's no more",
        .timeLimit(.minutes(3)))
    func signOutWiring() async throws {
        let (held, engine) = try standIn(Reasons())
        try await engine.record(.unlock(session: "s", reason: nil))
        await held.signOut()
        #expect(held.signOutFailed == SignOutWords.unsent)
        // A state whose queue shows no unlock — as a failed read of the queue leaves it — while
        // the file still holds one: still said, the file asked; one ask at a time, each state's
        // cancelling the last's, whose answer is older (#172's review).
        held.synced(SyncState())
        let first = try #require(held.unsentCheck)
        held.synced(SyncState())
        #expect(first.isCancelled && held.unsentCheck?.isCancelled == false)
        await held.unsentCheck?.value
        #expect(held.signOutFailed == SignOutWords.unsent)
        // The queue shows it, then it goes: the hold's end clears the words at once.
        held.synced(await engine.state)
        var running = Task { await engine.run() }
        try await until { await engine.unlockUnsent() == false }
        held.synced(await engine.state)
        #expect(held.signOutFailed == nil)
        running.cancel()
        await running.value
        // Another, never shown in a queue the phone was given: said, and gone once it has gone.
        try await engine.record(.unlock(session: "s", reason: nil))
        await held.signOut()
        #expect(held.signOutFailed == SignOutWords.unsent)
        running = Task { await engine.run() }
        try await until { await engine.unlockUnsent() == false }
        held.synced(SyncState())
        await held.unsentCheck?.value
        #expect(held.signOutFailed == nil)
        running.cancel()
        await running.value
        let keychain = Keychain(account: "ana")
        let (phone, _) = try standIn(StandIn(), keychain: keychain)
        keychain.locked = true
        await phone.signOut()
        #expect(phone.signOutFailed == SignOutWords.failed)
        keychain.locked = false
        await phone.signOut()
        #expect(phone.signOutFailed == nil && keychain.empty)
        #expect(await phone.signIn?.account() == nil)
    }

    @Test(
        "Delete account through the phone's own sign-in and engine (C4b): confirmed, the deletion's screen shows and nothing else until the answer; Cognito's DeleteUser answering nothing leaves the account deleted and the sign-in waiting, said with Try again alone — and a relaunch over the same Keychain lands on that screen at once, before any press; Try again finishes it, the sign-in gone, the done screen holding over Sign in until OK",
        .timeLimit(.minutes(3)))
    func deleteAccountWiring() async throws {
        // Me's, Ana's account past the 13+ check (the gap's fallback is `ageAfterSignInWiring`'s).
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        defaults.set(["ana"], forKey: AgeCheck.key)
        let server = Deleter(deleteUser: [nil, 200], holdsDeletion: true)
        let keychain = Keychain(account: "ana", scoped: true)
        let (phone, engine) = try standIn(server, keychain: keychain)
        let signIn = try #require(phone.signIn)
        let following = Task { await phone.follow(signIn) }
        defer { following.cancel() }
        try await until { phone.signedIn == true }
        // A phone of the test's own runs no enforcer: the router shows the intro, or Starting where
        // the host's defaults hold its flag, so only the deletion's screen is asked after here,
        // never Me.
        #expect(phone.deleting == .none && phone.shown.screen != .deleting)
        phone.deleting.ask()
        #expect(phone.shown.screen != .deleting)
        // The stand-in holds DELETE /v1/me until the test lets it go, so the deletion under way is
        // seen for certain (santa's round 1: a deletion answered at once was busy for a millisecond).
        let deleting = Task { await phone.deleteAccount() }
        try await until { await server.holding }
        #expect(phone.deleting == .busy && phone.shown == (.deleting, false))
        await server.letGo()
        await deleting.value
        #expect(phone.deleting == .pending && phone.shown == (.deleting, false))
        #expect(await signIn.deletionPending() && !keychain.empty)
        let sent = (deletions: await server.deletions, deleteUsers: await server.deleteUsers)
        #expect(sent.deletions == 1 && sent.deleteUsers == 1)
        // A relaunch: a fresh phone over the same Keychain finds the sign-in waiting to be deleted.
        let (relaunched, _) = try standIn(server, keychain: keychain)
        let relaunchedSignIn = try #require(relaunched.signIn)
        let followingRelaunch = Task { await relaunched.follow(relaunchedSignIn) }
        defer { followingRelaunch.cancel() }
        try await until { relaunched.signedIn == true }
        #expect(relaunched.deleting == .pending && relaunched.shown == (.deleting, false))
        // Try again: DeleteUser alone, no deletion again; done, the sign-in forgotten.
        await phone.deleteAccount()
        #expect(phone.deleting == .done && phone.shown == (.deleting, false))
        let again = (deletions: await server.deletions, deleteUsers: await server.deleteUsers)
        #expect(again.deletions == 1 && again.deleteUsers == 2)
        try await until { phone.signedIn == false }
        #expect(phone.deleting == .done && phone.shown == (.deleting, false) && keychain.empty)
        phone.deleting.close()
        #expect(phone.deleting == .none && phone.shown.screen != .deleting)
        _ = engine
    }

    @Test(
        "Me says whose sign-in this is (#147), through the phone's own sign-in: the email its tokens name, read with who is signed in at each change; none once signed out; and another student's sign-in shows theirs, or none where their tokens name none — never the last one's"
    )
    func signedInAs() async throws {
        let (phone, _) = try standIn(StandIn(), keychain: Keychain(account: "ana", email: "ana@bali.test"))
        let signIn = try #require(phone.signIn)
        let following = Task { await phone.follow(signIn) }
        try await until { phone.email != nil }
        #expect(phone.signedIn == true && phone.email == "ana@bali.test")
        await phone.signOut()
        try await until { phone.signedIn == false }
        #expect(phone.email == nil)
        following.cancel()
        await following.value
        phone.signed(in: true, as: "ana", email: "ana@bali.test")
        phone.signed(in: true, as: "bea", email: "bea@bali.test")
        #expect(phone.email == "bea@bali.test")
        phone.signed(in: true, as: "cara")
        #expect(phone.email == nil)
        // Tokens naming no email — kept by a build before #147 — say nothing, until a renewal's ID
        // token names one: the same student's, Me then says it (santa's round 1).
        let email = Data(#"{"sub":"ana","email":"ana@bali.test"}"#.utf8).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
        let server = StandIn(grant: #"{"access_token":"a2","id_token":"h.\#(email).s"}"#)
        let (upgraded, _) = try standIn(server)
        let upgradedSignIn = try #require(upgraded.signIn)
        let quiet = Task { await upgraded.follow(upgradedSignIn) }
        try await until { upgraded.signedIn == true }
        #expect(upgraded.email == nil)
        #expect(await upgradedSignIn.refresh())
        try await until { upgraded.email != nil }
        #expect(upgraded.email == "ana@bali.test" && upgraded.signedIn == true)
        quiet.cancel()
        await quiet.value
    }

    @Test(
        "Another student's sign-in forgets the last one's name and classes, keyed on the account (C6b-1's review): the sign-out between the two not seen — a stream that keeps its newest value only can let it go by — the tabs start over and the engine's `me` goes; the same student again forgets nothing"
    )
    func forgetsAnother() async throws {
        let ana = #"{"user":{"id":"u","role":"student","displayName":"Ana"},"classes":[],"session":null}"#
        let server = StandIn(me: ana)
        let (phone, engine) = try standIn(server)
        let running = Task { await engine.run() }
        await engine.setForeground(true)
        try await until { await engine.state.me != nil }
        phone.signed(in: true, as: "ana")
        phone.select(.me)
        phone.signed(in: true, as: "ana")
        #expect(phone.tab == .me)
        #expect(await engine.state.me != nil)
        phone.signed(in: true, as: "bea")
        #expect(phone.tab == .home && phone.signedIn == true)
        try await until { await engine.state.me == nil }
        running.cancel()
        await running.value
    }

    @Test(
        "Another student's sign-in shows nothing of the last one's, at any moment (#160's review): Ana, once in a class on this phone and in none now, signs out and Bea signs in — Ana's name and classes go from what the phone shows at the sign-in itself, before the engine has forgotten them, so Bea is never greeted as Ana nor shown Ana's empty Home; a state the engine sent before it forgot them, still on its way, shows none of them either; once it has, Bea's own show. Ana signing back in keeps hers. The key as it was before is put back after"
    )
    func nothingOfTheLast() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.inClassKey)
        defer { defaults.set(before, forKey: Phone.inClassKey) }
        /// `GET /v1/me` as it answers student `id`, named `name`, in `classes`.
        func me(_ id: String, _ name: String, _ classes: String = "") throws -> MeResponse {
            try BaliJSON.makeDecoder().decode(
                MeResponse.self,
                from: Data(
                    #"{"user":{"id":"\#(id)","role":"student","displayName":"\#(name)"},"classes":[\#(classes)],"session":null}"#
                        .utf8))
        }
        let ana = #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[],"session":null}"#
        let (phone, engine) = try standIn(StandIn(me: ana))
        let running = Task { await engine.run() }
        await engine.setForeground(true)
        try await until { await engine.state.me != nil }
        // Ana's, as the engine sent it before any forget: in Period 3 once, and in no class now.
        let anas = await engine.state
        let period3 = #"{"id":"p3","name":"Period 3 — Algebra II","enrollmentId":"e3"}"#
        var listed = anas
        listed.me = try me("ana", "Ana", period3)
        phone.signed(in: true, as: "ana")
        phone.synced(listed)
        phone.synced(anas)
        #expect(phone.sync?.me?.user.displayName == "Ana" && phone.everInClass)
        // Ana signs out and back in: hers, kept for her.
        phone.signed(in: false)
        phone.signed(in: true, as: "ana")
        #expect(phone.sync?.me?.user.displayName == "Ana" && phone.everInClass)
        // Bea signs in: nothing of Ana's, at once — and none from the state still on its way.
        phone.signed(in: false)
        phone.signed(in: true, as: "bea")
        #expect(phone.sync?.me == nil && phone.sync?.hasClasses == nil && !phone.everInClass)
        phone.synced(anas)
        #expect(phone.sync?.me == nil && !phone.everInClass)
        // The engine has forgotten Ana's: Bea's own, once read, show.
        try await until { await engine.state.me == nil }
        var beas = await engine.state
        phone.synced(beas)
        #expect(phone.sync?.me == nil)
        beas.me = try me("bea", "Bea")
        phone.synced(beas)
        #expect(phone.sync?.me?.user.displayName == "Bea" && !phone.everInClass)
        running.cancel()
        await running.value
    }

    @Test(
        "Reasons picked on Unlocked while a change of the reason is on its way (#140): each shows its check at once and none is refused, and once the one on its way answers, only the newest goes, the picks between never sent; a pick back to the one on its way sends nothing more",
        .timeLimit(.minutes(3)))
    func picksAtOnce() async throws {
        let (phone, engine, server, running) = try await unlockRecorded()
        let first = Task { await phone.pick(.nurse) }
        try await until { await server.changes.count == 1 }
        #expect(phone.picking == .nurse)
        await phone.pick(.other)
        #expect(phone.picking == .other)
        await phone.pick(.bathroom)
        #expect(phone.picking == .bathroom && phone.pickFailed == nil)
        await server.answer(200, #"{"outcome":"applied","reason":"nurse"}"#)
        try await until { await server.changes.count == 2 }
        #expect(phone.picking == .bathroom)
        // The same card while the newest is on its way — the reason kept published, the session
        // extended — keeps its check (santa's round 2).
        var extended = await engine.state
        phone.synced(extended)
        #expect(phone.picking == .bathroom)
        if case .inSession(let session, let state) = extended.standing {
            extended.standing = .inSession(
                SessionView(id: session.id, classId: session.classId, endsAt: session.endsAt + 600),
                state)
        }
        phone.synced(extended)
        #expect(phone.picking == .bathroom)
        await server.answer(200, #"{"outcome":"applied","reason":"bathroom"}"#)
        await first.value
        #expect(await server.changes.map(\.reason) == ["nurse", "bathroom"])
        #expect(phone.picking == nil && phone.pickFailed == nil)
        #expect(await engine.state.recordedUnlock?.reason == .bathroom)
        let back = Task { await phone.pick(.other) }
        try await until { await server.changes.count == 3 }
        await phone.pick(.nurse)
        await phone.pick(.other)
        await server.answer(200, #"{"outcome":"applied","reason":"other"}"#)
        await back.value
        #expect(await server.changes.map(\.reason) == ["nurse", "bathroom", "other"])
        #expect(phone.picking == nil && phone.pickFailed == nil)
        #expect(await engine.state.recordedUnlock?.reason == .other)
        running.cancel()
        await running.value
    }

    @Test(
        "A pick that did not go is said (#140, rule 5): one on its way with a newer pick behind it is no matter — the newer goes, its own answer said; the newest with no answer, said, the check back on the reason on record, and picked again it goes under the same event id (rule 4); the newest refused, its refusal said, the check on the one kept before it",
        .timeLimit(.minutes(3)))
    func picksNotSent() async throws {
        let (phone, engine, server, running) = try await unlockRecorded()
        let first = Task { await phone.pick(.bathroom) }
        try await until { await server.changes.count == 1 }
        await phone.pick(.other)
        await server.answer(nil)
        try await until { await server.changes.count == 2 }
        await server.answer(200, #"{"outcome":"applied","reason":"other"}"#)
        await first.value
        #expect(phone.picking == nil && phone.pickFailed == nil)
        #expect(await engine.state.recordedUnlock?.reason == .other)
        let lost = Task { await phone.pick(.nurse) }
        try await until { await server.changes.count == 3 }
        await server.answer(nil)
        await lost.value
        #expect(phone.picking == nil && phone.pickFailed == UnlockedWords.offline)
        #expect(await engine.state.recordedUnlock?.reason == .other)
        let again = Task { await phone.pick(.nurse) }
        try await until { await server.changes.count == 4 }
        await server.answer(200, #"{"outcome":"replay","reason":"nurse"}"#)
        await again.value
        #expect(phone.picking == nil && phone.pickFailed == nil)
        #expect(await engine.state.recordedUnlock?.reason == .nurse)
        let last = Task { await phone.pick(.bathroom) }
        try await until { await server.changes.count == 5 }
        await phone.pick(.other)
        await server.answer(200, #"{"outcome":"applied","reason":"bathroom"}"#)
        try await until { await server.changes.count == 6 }
        let over = #"{"error":{"code":"conflict","reason":"unlock_superseded","message":"over"}}"#
        await server.answer(409, over)
        await last.value
        #expect(phone.picking == nil)
        #expect(phone.pickFailed == "This unlock is over, so its reason can't change.")
        #expect(await engine.state.recordedUnlock?.reason == .bathroom)
        let changes = await server.changes
        let sent: [String?] = ["bathroom", "other", "nurse", "nurse", "bathroom", "other"]
        #expect(changes.map(\.reason) == sent)
        // Picked again after no answer: the same change, under its event id (rule 4); a newer
        // pick after one with no answer is a change of its own.
        #expect(changes[3].eventId == changes[2].eventId)
        #expect(changes[1].eventId != changes[0].eventId)
        running.cancel()
        await running.value
    }

    @Test(
        "A pick goes only to the unlock whose card it was made on (#140, santa's round 1): the student locking their apps again and unlocking anew while a change is on its way, the pick waiting behind it is never sent, to either unlock, nor checked on the new card; a pick on the new card goes to it at once, the change on its way no matter",
        .timeLimit(.minutes(3)))
    func picksForTheirUnlock() async throws {
        let (phone, engine, server, running) = try await unlockRecorded()
        /// The student locks their apps again, and unlocks anew: the card is the new unlock's.
        func unlockAnew() async throws {
            #expect(await phone.backToFocus() == nil)
            try await until { await engine.state.queued.isEmpty }
            phone.synced(await engine.state)
            #expect(await phone.emergencyUnlock() == nil)
            phone.synced(await engine.state)
        }
        // Nurse on its way for the first unlock, Other waiting behind it.
        let first = Task { await phone.pick(.nurse) }
        try await until { await server.changes.count == 1 }
        await phone.pick(.other)
        try await unlockAnew()
        #expect(phone.picking == nil)
        await server.answer(200, #"{"outcome":"applied","reason":"nurse"}"#)
        await first.value
        #expect(UnlockedWords(await engine.state)?.picker == .open(nil))
        #expect(phone.picking == nil && phone.pickFailed == nil)
        // The second unlock recorded with Bathroom, Nurse on its way for it; unlocked anew, a pick
        // on the third card goes to the third unlock at once.
        await phone.pick(.bathroom)
        try await until { await engine.state.recordedUnlock?.reason == .bathroom }
        let second = Task { await phone.pick(.nurse) }
        try await until { await server.changes.count == 2 }
        try await unlockAnew()
        await phone.pick(.other)
        #expect(UnlockedWords(await engine.state)?.picker?.chosen == .other)
        await server.answer(200, #"{"outcome":"applied","reason":"nurse"}"#)
        await second.value
        #expect(phone.picking == nil && phone.pickFailed == nil)
        try await until { await engine.state.recordedUnlock?.reason == .other }
        #expect(await server.unlocks == [nil, "bathroom", "other"])
        #expect(await server.changes.map(\.reason) == ["nurse", "nurse"])
        running.cancel()
        await running.value
    }

    @Test(
        "A pick on its way when the card moves to another unlock never holds the new card's picks back (#152's review): it lets go of its own hold as it ends, with nothing else to reset it — the new card's picks are written into its unlock, or sent, at once — and of nothing more, so the new card's changes still go one at a time, its answer landing among them",
        .timeLimit(.minutes(3)))
    func picksPastTheirCard() async throws {
        let (phone, engine, server, running) = try await unlockRecorded()
        // Nurse on its way for the first unlock; the student locks their apps again and unlocks
        // anew, the card the second unlock's — Bathroom written into it, and it recorded.
        let first = Task { await phone.pick(.nurse) }
        try await until { await server.changes.count == 1 }
        #expect(await phone.backToFocus() == nil)
        try await until { await engine.state.queued.isEmpty }
        phone.synced(await engine.state)
        #expect(await phone.emergencyUnlock() == nil)
        phone.synced(await engine.state)
        await phone.pick(.bathroom)
        try await until { await engine.state.recordedUnlock?.reason == .bathroom }
        // Other on its way for the second; the first's answer lands; Nurse, picked meanwhile, only
        // moves the check.
        let second = Task { await phone.pick(.other) }
        try await until { await server.changes.count == 2 }
        await server.answer(200, #"{"outcome":"applied","reason":"nurse"}"#)
        await first.value
        await phone.pick(.nurse)
        #expect(phone.picking == .nurse)
        #expect(await server.changes.count == 2)
        await server.answer(200, #"{"outcome":"applied","reason":"other"}"#)
        try await until { await server.changes.count == 3 }
        await server.answer(200, #"{"outcome":"applied","reason":"nurse"}"#)
        await second.value
        #expect(await server.changes.map(\.reason) == ["nurse", "other", "nurse"])
        #expect(phone.picking == nil && phone.pickFailed == nil)
        #expect(await engine.state.recordedUnlock?.reason == .nurse)
        running.cancel()
        await running.value
    }

    @Test(
        "Picks made one after another while the unlock is still on the phone are each written into it at once (C5a's hold): no change of the reason is sent, and the unlock goes with the newest",
        .timeLimit(.minutes(3)))
    func picksOnThePhone() async throws {
        let server = Reasons()
        let (phone, engine) = try standIn(server)
        var running = Task { await engine.run() }
        try await engine.record(.tap(tagId: "tag"))
        try await until { await engine.state.queued.isEmpty }
        // Nothing sent from here until the picks are made: the unlock stays on the phone.
        running.cancel()
        await running.value
        #expect(await engine.pressUnlock() == nil)
        for reason in [UnlockReason.nurse, .other, .bathroom] {
            await phone.pick(reason)
            #expect(phone.picking == nil && phone.pickFailed == nil, "\(reason)")
        }
        #expect(UnlockedWords(await engine.state)?.picker == .open(.bathroom))
        running = Task { await engine.run() }
        try await until { await engine.state.recordedUnlock != nil }
        #expect(await server.unlocks == ["bathroom"])
        #expect(await server.changes.isEmpty)
        running.cancel()
        await running.value
    }

    @Test(
        "Home's Join a class opens Join over it, and Back closes it — the code typed there gone; Waiting's Back to home opens the regular Home over it (#151), and Join over that Home in turn, Back returning to that Home (santa's round 1: Join fell back to Waiting there); all end once where the phone stands changes, a Join among them starting over (C3). A frozen phone's Tap in says it has not started, never nothing"
    )
    func opened() async throws {
        let home = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        home.open(.join)
        home.joining.type("KWX")
        #expect(home.shown.screen == .join)
        home.back()
        #expect(home.shown.screen == .home && home.joining.code.isEmpty)
        let waiting = Phone(fixture: try #require(PreviewFixtures.all["waiting"]))
        let state = try #require(waiting.sync)
        waiting.open(.home)
        waiting.synced(state)
        #expect(waiting.shown == (.home, true) && !waiting.canGoBack)
        waiting.open(.join)
        #expect(waiting.shown.screen == .join && waiting.canGoBack)
        waiting.back()
        #expect(waiting.shown == (.home, true) && !waiting.canGoBack)
        waiting.open(.join)
        waiting.joining.type("KWX")
        var out = state
        out.standing = .out
        waiting.synced(out)
        waiting.synced(state)
        #expect(waiting.opened.isEmpty && waiting.shown.screen == .waiting)
        #expect(waiting.joining.code.isEmpty)
        // No classes: waiting, Home and Join over it stay — an armed tap needs no enrollment;
        // out, Home is the router's own in no class too (the owner's ruling, 2026-10-07), so
        // Join opened over it stays, keeping what was typed there (santa's round 2).
        let none = try BaliJSON.makeDecoder().decode(
            MeResponse.self,
            from: Data(#"{"user":{"id":"u","role":"student","displayName":"Ana"},"classes":[],"session":null}"#.utf8))
        var armed = state
        armed.me = none
        waiting.open(.home)
        waiting.open(.join)
        waiting.synced(armed)
        #expect(waiting.opened == [.home, .join] && waiting.shown.screen == .join)
        let reading = Phone(fixture: try #require(PreviewFixtures.all["homeLoading"]))
        reading.open(.join)
        reading.joining.type("KWX")
        var noClasses = try #require(reading.sync)
        noClasses.me = none
        reading.synced(noClasses)
        #expect(reading.opened == [.join] && reading.shown.screen == .join && reading.canGoBack)
        #expect(reading.joining.code == "KWX")
        reading.back()
        #expect(reading.shown == (.home, true))
        await home.tapIn()
        #expect(home.tapFailed == Joining.notStarted && !home.scanning)
    }

    @Test(
        "Join opened over Home has a way back to it; Home opened over Waiting has none — it is the regular Home, its card saying the wait (#151, the owner's decision; #114's review had drawn one); the router's own Home and Waiting have none, nor one the router shows over it"
    )
    func wayBack() throws {
        let waiting = Phone(fixture: try #require(PreviewFixtures.all["waiting"]))
        #expect(!waiting.canGoBack)
        waiting.open(.home)
        #expect(waiting.shown.screen == .home && !waiting.canGoBack)
        #expect(!Phone(fixture: try #require(PreviewFixtures.all["home"])).canGoBack)
        #expect(Phone(fixture: try #require(PreviewFixtures.all["joinFromHome"])).canGoBack)
        // Opened over Home, but the shields on: focus, which has no way back.
        let focused = Phone(fixture: try #require(PreviewFixtures.all["focus"]))
        focused.open(.join)
        #expect(focused.shown.screen == .focus && !focused.canGoBack)
    }

    @Test(
        "Waiting's Back to home, then the Start (#151): Home — or History or Me, chosen there — goes to Focus once the read finds the Start, the Home closed and the tab Home again; Bali opened again while waiting, nothing opened kept, lands on Waiting, the tap's answer"
    )
    func startFromHomeWaiting() throws {
        let waiting = try #require(PreviewFixtures.all["waiting"])
        for tab in [Screen.home, .history, .me] {
            let phone = Phone(fixture: waiting)
            phone.open(.home)
            phone.select(tab)
            #expect(phone.shown == (tab, true), "\(tab)")
            var started = try #require(phone.sync)
            started.standing = .inSession(
                SessionView(id: "s", classId: "p3", endsAt: Date() + 600), .focused)
            phone.synced(started)
            #expect(phone.shown == (.focus, false), "\(tab)")
            #expect(phone.opened.isEmpty && phone.tab == .home, "\(tab)")
        }
        let opened = Phone(fixture: waiting)
        #expect(opened.shown == (.waiting, false) && !opened.canGoBack)
    }

    @Test(
        "Waiting fits the smallest iPhone — the iPhone 17e's 390 × 844 less its safe areas, 47 pt above and 34 below — and the owner's iPhone 15 Pro, 393 × 852 less 59 and 34, at the default text size, Back to home included, with its one card, or a failed read or a refused tap said too (#149: the owner's phone); once the text outgrows the screen, it scrolls"
    )
    func waitingFits() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let cases: [(String, DynamicTypeSize)] = [
            ("waiting", .large), ("waitingError", .large), ("waitingTapRefused", .large),
            ("waiting", .accessibility2),
        ]
        let phones = [CGSize(width: 390, height: 844 - 47 - 34), CGSize(width: 393, height: 852 - 59 - 34)]
        for (name, size) in cases {
            for frame in phones {
                let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
                let hosting = UIHostingController(
                    rootView: RootView(phone: phone).environment(\.dynamicTypeSize, size))
                // The safe areas given by the frame, whatever phone runs the tests.
                hosting.safeAreaRegions = []
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(origin: .zero, size: frame)
                window.rootViewController = hosting
                window.isHidden = false
                defer { window.isHidden = true }
                window.layoutIfNeeded()
                let scroll = try #require(scrollViews(in: window).first, "\(name)")
                let (content, shown) = (scroll.contentSize.height, scroll.bounds.height)
                #expect(
                    (content <= shown + 0.5) == (size == .large),
                    "\(name), \(size), \(frame): \(content) in \(shown)")
            }
        }
    }

    @Test(
        "A join's answer (santa's round 1): refused, a Join opened over Home stays, its words said; in, it closes, back to that Home — the class the engine's then"
    )
    func joined() async throws {
        /// `POST /v1/enrollments`, as the API answers it: `status`, `body`.
        func answer(_ status: Int, _ body: String) async -> APIResponse<EnrollmentJoinResponse> {
            let now = Date()
            return await client(status, body).join(
                EnrollmentJoinRequest(
                    joinCode: "KWX49Q", eventId: EventID.mint(at: now), deviceTime: now))
        }
        let phone = Phone(fixture: try #require(PreviewFixtures.all["joinFromHome"]))
        #expect(phone.shown.screen == .join)
        let none = #"{"error":{"code":"not_found","reason":"class_not_found","message":"none"}}"#
        phone.joined(await answer(404, none))
        #expect(phone.shown.screen == .join && phone.opened == [.join])
        #expect(phone.joining.failure == Joining.words(.status(404), .classNotFound))
        let joined = #"{"outcome":"joined","enrollmentId":"e","class":{"id":"c","name":"Class c"}}"#
        phone.joined(await answer(200, joined))
        #expect(phone.shown.screen == .home && phone.opened.isEmpty && phone.joining == Joining())
    }

    @Test(
        "A Debug launch's `-bali-intro-page` opens a page that exists (#105's review): the one named, the nearest one to a number past either end, and the first when none is named or it is no number"
    )
    func introPage() {
        func page(_ named: String?) -> Int {
            IntroView.page(from: ["Bali"] + (named.map { ["-bali-intro-page", $0] } ?? []))
        }
        #expect(IntroView.pages == 0...2)
        #expect([nil, "0", "1", "2"].map(page) == [0, 0, 1, 2])
        #expect(["3", "99", "-1", "two", ""].map(page) == [2, 2, 0, 0, 0])
    }

    @Test(
        "A screen the student opens over another fades in, and the one under it fades back in as they go back (#150): the design system's base 200 ms on its standard easing — and under Reduce Motion no animation at all, the fade instant (DESIGN.md)"
    )
    func fade() {
        #expect(Theme.fade(reduceMotion: false) == .timingCurve(0.2, 0, 0, 1, duration: 0.2))
        #expect(Theme.fade(reduceMotion: true) == nil)
    }

    @Test(
        "A screen fading in (#150) starts as the page's own colour alone, opaque — so the screen it replaces, which SwiftUI keeps until the fade ends and which draws itself anew from the next screen's state, is gone at once — and ends as itself over that colour"
    )
    func opening() throws {
        func drawn(_ shown: Bool) throws -> [Int] {
            let renderer = ImageRenderer(
                content: Rectangle().fill(Theme.text).frame(width: 8, height: 8)
                    .modifier(Opening(shown: shown)))
            renderer.scale = 1
            return try pixels(of: try #require(renderer.uiImage))(4, 4)
        }
        #expect(try drawn(false) == [0xF7, 0xF5, 0xF2, 255])
        #expect(try drawn(true) == [0x21, 0x1F, 0x1B, 255])
    }

    @Test(
        "A screen leaving takes no touch (#161's review): a tap where its code field was lands elsewhere at once — under the fade's own transition, and kept on screen for the whole of a slow fade under its removal's modifier (`Opening.Replaced`), as SwiftUI may keep a screen leaving — so a fast tap meant for the screen arriving never starts what the one leaving would have. The fade's removal is that modifier, as its type says (santa's round 1)"
    )
    func leavingTakesNoTouch() async throws {
        // Read from its type, as `historyLazy` reads History's.
        #expect(String(reflecting: Opening.transition).contains("Opening.Replaced"))
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let kept = AnyTransition.asymmetric(
            insertion: .identity,
            removal: .modifier(
                active: Opening.Replaced(gone: true), identity: Opening.Replaced(gone: false)))
        for (transition, keeps) in [(Opening.transition, false), (kept, true)] {
            let shown = Shown()
            let window = UIWindow(windowScene: scene)
            window.frame = scene.screen.bounds
            window.rootViewController = UIHostingController(
                rootView: Switching(shown: shown, transition: transition))
            window.isHidden = false
            defer { window.isHidden = true }
            try await until { textFields(in: window).first != nil }
            let field = try #require(textFields(in: window).first)
            let frame = field.convert(field.bounds, to: window)
            let center = CGPoint(x: frame.midX, y: frame.midY)
            #expect(window.hitTest(center, with: nil)?.isDescendant(of: field) == true)
            withAnimation(.linear(duration: 60)) { shown.field = false }
            // A render later, the fade a minute from its end.
            try await Task.sleep(for: .milliseconds(100))
            if keeps { #expect(field.window != nil) }
            #expect(window.hitTest(center, with: nil)?.isDescendant(of: field) != true, "\(keeps)")
        }
    }

    @Test(
        "Back lets the keyboard go before the screen moves (#150): Join's code field, focused as Join shows, types in nothing once Back is pressed — the keyboard going down with Join, never left over Home as Home fades back in — nor takes it back while Join fades out and after: looked at after each render, past the fade's end (#161's review)"
    )
    func backLetsKeyboardGo() async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let (phone, key) = (
            Phone(fixture: try #require(PreviewFixtures.all["joinFromHome"])), scene.keyWindow
        )
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        window.rootViewController = UIHostingController(rootView: RootView(phone: phone))
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            key?.makeKey()
        }
        try await until { textFields(in: window).first?.isFirstResponder == true }
        let field = try #require(textFields(in: window).first)
        phone.back()
        #expect(phone.shown.screen == .home && !field.isFirstResponder)
        // Each render through the fade, which SwiftUI keeps Join for, its focus still asked for,
        // and past its end: no field has the keyboard back.
        var taken = false
        let end = ContinuousClock.now + .milliseconds(600)
        while ContinuousClock.now < end, !taken {
            try await Task.sleep(for: .milliseconds(5))
            taken =
                field.isFirstResponder || textFields(in: window).contains { $0.isFirstResponder }
        }
        #expect(!taken)
    }

    @Test(
        "Every colour `Theme` draws, and each chip's, is D1's light value of its token in `bali-tokens.json` — the design system's own file, a token's reference to another followed — shadow-1's opacity too, so the two cannot drift apart unnoticed (#101's review)"
    )
    func tokens() throws {
        let url = try #require(
            Bundle(for: TestsBundle.self).url(forResource: "bali-tokens", withExtension: "json"))
        let file = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        /// A group's tokens, by name: each one's value.
        func values(_ group: String) throws -> [String: Any] {
            let group = file[group] as? [String: Any]
            let tokens = try #require(group?["tokens"] as? [[String: Any]])
            var values: [String: Any] = [:]
            for token in tokens {
                if let name = token["name"] as? String { values[name] = token["value"] }
            }
            return values
        }
        let colours = try values("color")
        /// `name`'s light value — a primitive's one value, or another token's through "{name}".
        func light(_ name: String) -> String? {
            let value = colours[name]
            guard let raw = (value as? [String: Any])?["light"] as? String ?? value as? String
            else { return nil }
            return raw.hasPrefix("{") ? light(String(raw.dropFirst().dropLast())) : raw.uppercased()
        }
        /// `colour` as sRGB bytes, red to blue — and as the file writes one, "#RRGGBB" — with its
        /// opacity.
        func drawn(_ colour: Color) -> (bytes: [Int], hex: String, opacity: Float) {
            let resolved = colour.resolve(in: EnvironmentValues())
            let bytes = [resolved.red, resolved.green, resolved.blue].map {
                Int(($0 * 255).rounded())
            }
            let hex = "#" + bytes.map { String(format: "%02X", $0) }.joined()
            return (bytes, hex, resolved.opacity)
        }
        let pinned: [(token: String, colour: Color)] = [
            ("surface-page", Theme.page), ("surface-card", Theme.card),
            ("surface-sunken", Theme.sunken), ("border-default", Theme.border),
            ("border-strong", Theme.borderStrong), ("text-primary", Theme.text),
            ("text-secondary", Theme.textSecondary), ("text-tertiary", Theme.textTertiary),
            ("action-primary-bg", Theme.brand), ("action-primary-bg-hover", Theme.brandPressed),
            ("action-destructive-bg", Theme.destructive), ("red-700", Theme.destructivePressed),
            ("arc-fill", Theme.arc), ("arc-final2", Theme.arcFinal), ("arc-track", Theme.arcTrack),
            ("green-200", Theme.markTrack),
            ("state-focused-bg", Chip.Kind.focused.look.fill),
            ("state-focused-fg", Chip.Kind.focused.look.ink),
            ("state-emergency-bg", Chip.Kind.unlocked.look.fill),
            ("state-emergency-fg", Chip.Kind.unlocked.look.ink),
            ("state-revoked-bg", Chip.Kind.protectionOff.look.fill),
            ("state-revoked-fg", Chip.Kind.protectionOff.look.ink),
            ("state-ended-bg", Chip.Kind.ended.look.fill),
            ("state-ended-fg", Chip.Kind.ended.look.ink),
            ("state-notjoined-bg", Chip.Kind.notIn.look.fill),
            ("state-notjoined-fg", Chip.Kind.notIn.look.ink),
            // Home's Waiting (D2i): not in's pair, never focus's green.
            ("state-notjoined-bg", Chip.Kind.waiting.look.fill),
            ("state-notjoined-fg", Chip.Kind.waiting.look.ink),
            // History's Screen Time back on (D2j): not in's pair too, never focus's green.
            ("state-notjoined-bg", Chip.Kind.protectionOn.look.fill),
            ("state-notjoined-fg", Chip.Kind.protectionOn.look.ink),
        ]
        for (token, colour) in pinned {
            let found = drawn(colour)
            #expect(found.hex == light(token), "\(token): \(found.hex)")
            #expect(found.opacity == 1, "\(token)")
        }
        // shadow-1, a resting card's: "0 1px 2px rgba(33,28,21,0.06)".
        let shadow = drawn(Theme.shadow)
        let shadows = try values("shadow")
        let resting = try #require((shadows["shadow-1"] as? [String: Any])?["light"] as? String)
        let rgba = shadow.bytes.map(String.init) + [String(format: "%g", shadow.opacity)]
        #expect(resting.hasSuffix("rgba(\(rgba.joined(separator: ",")))"), "\(resting): \(rgba)")
    }

    @Test(
        "Emergency Unlock's words fit D1's 64-pt pill at the default text size on the narrowest iPhone the app runs on, 375 pt less the gutters: the action and who sees it, a line each, where D1's one sentence wrapped mid-phrase (D2i; D2a's audit). At the largest text size the pill grows with them, and its words, offered less height than they need, still keep every line whole — the first was cut short there before"
    )
    func unlockFits() {
        let narrowest = 375 - 2 * Theme.gutter
        let whole = UIHostingController(
            rootView: UnlockControl {}.fixedSize().environment(\.dynamicTypeSize, .large)
        ).sizeThatFits(in: CGSize(width: 10_000, height: 10_000))
        #expect(whole.width <= narrowest && abs(whole.height - 64) < 0.5, "\(whole)")
        let grown = UIHostingController(
            rootView: UnlockControl {}.environment(\.dynamicTypeSize, .accessibility5)
        ).sizeThatFits(in: CGSize(width: narrowest, height: 10_000))
        #expect(grown.height > 100, "\(grown)")
        /// The words' height at the largest text size, 200 pt wide, offered `room`.
        func words(_ room: CGFloat) -> CGFloat {
            UIHostingController(rootView: UnlockWords().environment(\.dynamicTypeSize, .accessibility5))
                .sizeThatFits(in: CGSize(width: 200, height: room)).height
        }
        #expect(abs(words(44) - words(10_000)) < 0.5, "\(words(44)) of \(words(10_000))")
    }

    @Test(
        "The 13+ check (C7) as the phone keeps it: an answer writes nothing — 13 or older or under 13, never the month or the year — the picks going with it, and Continue with nothing picked changes nothing; a fresh Phone starts with the question unanswered, whatever the phone's defaults hold — the phone-wide flag a build before kept vouches for no account (the owner's ruling, 2026-10-07); a frozen fixture's answer writes nothing for another, and each fixture of the check shows its screen with no tab bar — the intro seen, a pass opens the page at once, the question kept with Signing up… while it opens, a frozen phone's landing on Sign in, the page not opened. The keys as they were before are put back after"
    )
    func ageCheck() async throws {
        let (defaults, old) = (UserDefaults.standard, "ageChecked")
        let before = (defaults.object(forKey: AgeCheck.key), defaults.object(forKey: old))
        defer {
            defaults.set(before.0, forKey: AgeCheck.key)
            defaults.set(before.1, forKey: old)
        }
        defaults.removeObject(forKey: AgeCheck.key)
        defaults.set(true, forKey: old)
        let pages = Pages()
        let live = Phone()
        #expect(live.age.answer == .unanswered && !live.birth.complete)
        await live.answerAge(through: pages.browser)
        #expect(live.age.answer == .unanswered && defaults.object(forKey: AgeCheck.key) == nil)
        await live.signIn(.signUp, through: pages.browser)
        #expect(live.age.answer == .asked)
        live.birth = Birth(month: 1, year: 2000)
        await live.answerAge(through: pages.browser)
        #expect(live.age.answer == .passed && live.birth == Birth() && live.introShows)
        #expect(defaults.object(forKey: AgeCheck.key) == nil && Phone().age.answer == .unanswered)
        let young = Phone()
        // This month, Gregorian: the rule counts in it whatever calendar the phone shows.
        let now = Calendar(identifier: .gregorian).dateComponents([.year, .month], from: Date())
        await young.signIn(.signUp, through: pages.browser)
        young.birth = Birth(month: now.month, year: now.year)
        await young.answerAge(through: pages.browser)
        #expect(young.age.answer == .tooYoung && young.birth == Birth() && !young.introShows)
        #expect(defaults.object(forKey: AgeCheck.key) == nil && Phone().age.answer == .unanswered)
        // The fixtures: the question, nothing picked and both picked — the intro seen, so its pass
        // opens the page at once: not opened on a frozen phone, Sign in says so, the answer and the
        // picks let go — the page opening from Continue, and the stop screen.
        let asked = Phone(fixture: try #require(PreviewFixtures.all["age"]))
        #expect(asked.shown == (.age, false) && !asked.birth.complete)
        let picked = Phone(fixture: try #require(PreviewFixtures.all["agePicked"]))
        #expect(picked.shown == (.age, false) && picked.birth == Birth(month: 3, year: 2009))
        await picked.answerAge(through: pages.browser)
        #expect(picked.age.answer == .unanswered && picked.shown == (.signIn, false))
        #expect(picked.signInFailed == .notOpened(Joining.notStarted) && picked.birth == Birth())
        #expect(defaults.object(forKey: AgeCheck.key) == nil)
        let opening = Phone(fixture: try #require(PreviewFixtures.all["ageSigningUp"]))
        #expect(opening.shown == (.age, false) && opening.signingIn && opening.birth.complete)
        let stopped = Phone(fixture: try #require(PreviewFixtures.all["tooYoung"]))
        #expect(stopped.shown == (.tooYoung, false))
        #expect(pages.opened.isEmpty)
    }

    @Test(
        "Sign in and sign up, routed (the approved Sign in & sign up design): a first launch opens on Sign in, never the intro or the question; every Sign up asks the 13+ question — a second this run too, after a pass (the owner's ruling, 2026-10-07) — then shows the intro where this run has not shown it, each in Sign in's place, no page opened, no tab bar, and the intro's Sign up opens the sign-up page; the intro seen, the question's Continue opens it at once; Sign in opens its page at once, never the question; a page that did not open lands on Sign in, which says which page it was"
    )
    func signUpRouted() async throws {
        let (pages, notOpened) = (Pages(), "couldn't open. Try again, or ask your teacher.")
        // A first launch, signed out, nothing answered or seen: Sign in.
        let first = PreviewFixtures.State(age: .unanswered, introSeen: false, signedIn: false)
        let routed = Phone(fixture: first)
        #expect(routed.shown == (.signIn, false))
        await routed.signIn(.signUp, through: pages.browser)
        #expect(routed.shown == (.age, false))
        routed.birth = Birth(month: 1, year: 2000)
        await routed.answerAge(through: pages.browser)
        #expect(routed.shown == (.intro, false) && routed.age.answer == .passed)
        // A frozen phone opens no page: Sign in again, saying the sign-up page did not open.
        await routed.sawIntro(through: pages.browser)
        #expect(routed.shown == (.signIn, false) && routed.introSeen)
        #expect(routed.signInFailed?.words(on: routed.hostedPage) == "The sign-up page \(notOpened)")
        // Sign up again: the question again; its pass, the intro seen, goes to the page at once.
        await routed.signIn(.signUp, through: pages.browser)
        #expect(routed.shown == (.age, false) && !routed.birth.complete)
        routed.birth = Birth(month: 1, year: 2000)
        await routed.answerAge(through: pages.browser)
        #expect(routed.shown == (.signIn, false) && !routed.introShows)
        #expect(routed.signInFailed?.words(on: routed.hostedPage) == "The sign-up page \(notOpened)")
        // Sign in: its page, never the question nor the intro.
        let signingIn = Phone(fixture: first)
        await signingIn.signIn(through: pages.browser)
        #expect(signingIn.shown == (.signIn, false) && signingIn.age.answer == .unanswered)
        #expect(
            signingIn.signInFailed?.words(on: signingIn.hostedPage) == "The sign-in page \(notOpened)")
        // A pass earlier this run vouches for no later Sign up: the question again, not the intro.
        let passed = Phone(fixture: PreviewFixtures.State(introSeen: false, signedIn: false))
        await passed.signIn(.signUp, through: pages.browser)
        #expect(passed.shown == (.age, false) && passed.signInFailed == nil)
        // The intro's Sign up opens nothing but after a pass this time.
        let unasked = Phone(fixture: first)
        await unasked.sawIntro(through: pages.browser)
        #expect(unasked.shown == (.signIn, false) && unasked.signInFailed == nil)
        #expect(pages.opened.isEmpty)
    }

    @Test(
        "Sign in and sign up through the phone's own sign-in (the approved Sign in & sign up design): Sign in opens Cognito's sign-in page at once, no question, no intro; Sign up asks the question, then shows the intro, opening no page, and the intro's Sign up opens the sign-up page, `/signup`, to come back to the sign-in's scheme — the intro showing until the page closes, which lands on Sign in, the answer let go; Sign up again this run asks the question again (the owner's ruling, 2026-10-07: a second person never signs up unasked), and its Continue opens the page at once, the intro seen; a new run's shows the question, the intro, then the page (once per account); a page that did not open is said under the buttons, naming its page, and gone at the next press; under 13, no page opens this run, Sign up's or Sign in's, and nothing is kept. The key as it was before is put back after"
    )
    func signUpAndSignIn() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        defaults.removeObject(forKey: AgeCheck.key)
        let pages = Pages()
        /// The path of the page opened last, and the scheme it was to come back to.
        func last() -> (String?, String?) {
            (pages.opened.last?.url.path(), pages.opened.last?.scheme)
        }
        /// Sign up pressed on `phone`, and its question answered 13 or older.
        func signUp(_ phone: Phone) async {
            await phone.signIn(.signUp, through: pages.browser)
            #expect(phone.age.answer == .asked && !phone.birth.complete)
            phone.birth = Birth(month: 1, year: 2000)
            await phone.answerAge(through: pages.browser)
        }
        let signedOut = { try standIn(StandIn(), keychain: Keychain(account: nil)).0 }
        let live = try signedOut()
        await live.signIn(through: pages.browser)
        #expect(pages.opened.count == 1 && last() == ("/oauth2/authorize", "bali"))
        #expect(live.age.answer == .unanswered && !live.introShows && !live.signingIn)
        // Closed by the student: kept as the sign-in said it, for the readout; the screen says
        // nothing.
        #expect(live.signInFailed == .cancelled)
        #expect(live.signInFailed?.words(on: live.hostedPage) == nil)
        await live.signIn(.signUp, through: pages.browser)
        #expect(live.age.answer == .asked && pages.opened.count == 1)
        live.birth = Birth(month: 1, year: 2000)
        await live.answerAge(through: pages.browser)
        #expect(live.age.answer == .passed && live.introShows && pages.opened.count == 1)
        await live.sawIntro(through: pages.browser)
        #expect(pages.opened.count == 2 && last() == ("/signup", "bali"))
        #expect(live.introSeen && !live.introShows && live.hostedPage == .signUp)
        #expect(live.signInFailed?.words(on: live.hostedPage) == nil)
        #expect(live.age.answer == .unanswered)
        // Sign up again this run: the question again, then the page from its Continue.
        await signUp(live)
        #expect(pages.opened.count == 3 && last().0 == "/signup" && !live.introShows)
        #expect(live.age.answer == .unanswered && live.birth == Birth())
        let relaunched = try signedOut()
        await signUp(relaunched)
        #expect(relaunched.introShows && !relaunched.introSeen && pages.opened.count == 3)
        await relaunched.sawIntro(through: pages.browser)
        #expect(pages.opened.count == 4 && last().0 == "/signup" && !relaunched.introShows)
        pages.answer = .notOpened("no window")
        await signUp(live)
        #expect(
            live.signInFailed?.words(on: live.hostedPage)
                == "The sign-up page couldn't open. Try again, or ask your teacher.")
        await live.signIn(through: pages.browser)
        #expect(
            live.signInFailed?.words(on: live.hostedPage)
                == "The sign-in page couldn't open. Try again, or ask your teacher.")
        pages.answer = .cancelled
        await signUp(live)
        #expect(pages.opened.count == 7 && live.signInFailed?.words(on: live.hostedPage) == nil)
        let young = try signedOut()
        await young.signIn(.signUp, through: pages.browser)
        let now = Calendar(identifier: .gregorian).dateComponents([.year, .month], from: Date())
        young.birth = Birth(month: now.month, year: now.year)
        await young.answerAge(through: pages.browser)
        await young.signIn(.signUp, through: pages.browser)
        await young.signIn(through: pages.browser)
        #expect(young.age.answer == .tooYoung && pages.opened.count == 7)
        #expect(defaults.object(forKey: AgeCheck.key) == nil)
    }

    @Test(
        "A sign-up page that signs the student in files that account as passed on this phone — its Cognito id alone — as the sign-in lands, before it reaches anything, so Bali's API is given its token at once; and keeps the intro, or the question whose Continue opened the page, until the sign-in lands, so no Sign in shows between, letting them go then: a sign-out later shows Sign in, never the intro nor the question (the approved Sign in & sign up design; the owner's ruling, 2026-10-07). A page closed files nothing. The key as it was before is put back after"
    )
    func signUpLands() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        defaults.removeObject(forKey: AgeCheck.key)
        let keychain = Keychain(account: nil)
        let (phone, _) = try gatedStandIn(Grants(["ana", "bea"]), keychain: keychain)
        let pages = Pages()
        /// Sign up pressed, and its question answered 13 or older.
        func signUp() async {
            await phone.signIn(.signUp, through: pages.browser)
            phone.birth = Birth(month: 1, year: 2000)
            await phone.answerAge(through: pages.browser)
        }
        // The intro's Sign up opens nothing before the question is answered.
        await phone.sawIntro(through: pages.browser)
        #expect(pages.opened.isEmpty)
        // The intro's Sign up, its page signing Ana in: filed as it lands, the intro kept till then.
        pages.signsIn = true
        await signUp()
        #expect(phone.introShows && pages.opened.isEmpty)
        await phone.sawIntro(through: pages.browser)
        #expect(pages.opened.map { $0.url.path() } == ["/signup"] && !keychain.empty)
        #expect(AgeCheck.passed("ana", in: defaults) && !AgeCheck.passed("bea", in: defaults))
        #expect(await phone.signIn?.accessToken() != nil)
        #expect(phone.introShows && phone.signInFailed == nil && !phone.signingIn)
        phone.signed(in: true, as: "ana")
        #expect(!phone.introShows && phone.ageNow == .passed)
        phone.signed(in: false)
        #expect(!phone.introShows && phone.age.answer != .asked)
        // Bea's Sign up: the intro again after the sign-out, its page closed — nothing filed —
        // then Sign up again, the question's Continue opening the page, the question and its
        // picks kept until her sign-in lands.
        pages.signsIn = false
        await signUp()
        #expect(phone.introShows)
        await phone.sawIntro(through: pages.browser)
        #expect(pages.opened.count == 2 && defaults.stringArray(forKey: AgeCheck.key) == ["ana"])
        pages.signsIn = true
        await signUp()
        #expect(pages.opened.map { $0.url.path() } == ["/signup", "/signup", "/signup"])
        #expect(AgeCheck.passed("bea", in: defaults) && !phone.introShows)
        #expect(phone.age.answer == .asked && phone.birth.complete && !phone.signingIn)
        phone.signed(in: true, as: "bea")
        #expect(phone.age.answer == .unanswered && phone.birth == Birth())
        #expect(phone.ageNow == .passed)
        phone.signed(in: false)
        #expect(!phone.introShows && phone.age.answer == .unanswered)
    }

    @Test(
        "The 13+ check per account (the owner's ruling, 2026-10-07), through the phone's own sign-in: Sign in into an account that passed on this phone is never asked, Bali's API given its token; another account on the same phone is asked, its sign-in reaching Bali's API with nothing until it answers, then filed; the phone-wide flag a build before kept vouches for neither; under 13 files nothing. The keys as they were before are put back after"
    )
    func agePerAccount() async throws {
        let (defaults, old) = (UserDefaults.standard, "ageChecked")
        let before = (defaults.object(forKey: AgeCheck.key), defaults.object(forKey: old))
        defer {
            defaults.set(before.0, forKey: AgeCheck.key)
            defaults.set(before.1, forKey: old)
        }
        defaults.set(["ana"], forKey: AgeCheck.key)
        defaults.set(true, forKey: old)
        let keychain = Keychain(account: nil)
        let (phone, _) = try gatedStandIn(Grants(["ana", "bea", "cara"]), keychain: keychain)
        let pages = Pages()
        pages.signsIn = true
        /// Signed in through Sign in's page, as Cognito's tokens name `account`.
        func signIn(_ account: String) async {
            await phone.signIn(through: pages.browser)
            phone.signed(in: true, as: account)
        }
        /// Signed out, as Me's Sign out does it.
        func signOut() async {
            await phone.signOut()
            phone.signed(in: false)
        }
        await signIn("ana")
        #expect(phone.ageNow == .passed && phone.age.answer == .unanswered)
        #expect(await phone.signIn?.accessToken() != nil)
        await signOut()
        #expect(keychain.empty && phone.ageNow == .unanswered)
        // Bea, on the same phone: the question, and Bali's API nothing until she answers.
        await signIn("bea")
        #expect(phone.ageNow == .unanswered && !AgeCheck.passed("bea", in: defaults))
        #expect(await phone.signIn?.accessToken() == nil)
        phone.birth = Birth(month: 1, year: 2000)
        await phone.answerAge(through: pages.browser)
        let given = await phone.signIn?.accessToken()
        #expect(phone.ageNow == .passed && given != nil)
        #expect(defaults.stringArray(forKey: AgeCheck.key) == ["ana", "bea"])
        await signOut()
        // Cara under 13: nothing filed, and the fallback's deletion started.
        await signIn("cara")
        #expect(phone.ageNow == .unanswered)
        let now = Calendar(identifier: .gregorian).dateComponents([.year, .month], from: Date())
        phone.birth = Birth(month: now.month, year: now.year)
        await phone.answerAge(through: pages.browser)
        #expect(phone.ageNow == .tooYoung && phone.underThirteen)
        #expect(defaults.stringArray(forKey: AgeCheck.key) == ["ana", "bea"])
        #expect(pages.opened.allSatisfy { $0.url.path() == "/oauth2/authorize" })
    }

    @Test(
        "Sign in as the approved Sign in & sign up design draws it: its title, then Sign up and Sign in, each a button; while a page opens its button says so and neither takes a press; a page that could not open is said under the buttons, naming its page, before the caption; and the intro's last page's button is Sign up, Signing up… and dimmed while its page opens"
    )
    func signInScreen() async throws {
        let title = "Sign\u{A0}up or sign\u{A0}in"
        let cases: [(String, String, String, Bool, String?)] = [
            ("signIn", "Sign up", "Sign in", false, nil),
            ("signInSigningIn", "Sign up", "Signing in…", true, nil),
            ("signInSigningUp", "Signing up…", "Sign in", true, nil),
            (
                "signInNotOpened", "Sign up", "Sign in", false,
                "The sign-in page couldn't open. Try again, or ask your teacher."
            ),
            (
                "signInSignUpNotOpened", "Sign up", "Sign in", false,
                "The sign-up page couldn't open. Try again, or ask your teacher."
            ),
        ]
        for (name, up, inside, busy, failure) in cases {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            let read = try await elements(of: RootView(phone: phone), once: title)
            let labels = read.map { $0.label ?? "" }
            let order =
                [title, up, inside] + (failure.map { [$0] } ?? [])
                + ["Trouble signing in? Ask your teacher."]
            let at = order.compactMap { labels.firstIndex(of: $0) }
            #expect(at.count == order.count && at == at.sorted(), "\(name): \(labels)")
            for button in [up, inside] {
                let traits = try #require(read.first { $0.label == button }, "\(name)").traits
                #expect(traits.contains(.button), "\(name): \(button)")
                #expect(traits.contains(.notEnabled) == busy, "\(name): \(button)")
            }
        }
        for (name, page, label, busy) in [
            ("intro", 0, "Continue", false), ("intro", 2, "Sign up", false),
            ("introSigningUp", 2, "Signing up…", true),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            let read = try await elements(of: IntroView(phone: phone, page: page), once: label)
            let button = try #require(read.first { $0.label == label }, "\(name)")
            #expect(button.traits.contains(.notEnabled) == busy, "\(name), page \(page)")
        }
    }

    @Test(
        "Home in no class as the approved Sign in & sign up design draws it: the student greeted, then its card's words — not in a class yet for a new student, in none any more for one removed from their last (#143) — and Join a class, a button, then the tab bar, with no classes list and no Sign out; Join opened from it has Back and no Sign out"
    )
    func homeInNoClass() async throws {
        for (name, words) in [
            ("homeNew", "You're not in a class yet. Join one with the class code from your teacher."),
            (
                "homeNoClasses",
                "You're not in any classes. Join one with the class code from your teacher."
            ),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            let read = try await elements(of: RootView(phone: phone), once: words)
            let labels = read.map { $0.label ?? "" }
            let order = ["Hi, Ana", words, "Join a class", "Home", "History", "Me"]
            let at = order.compactMap { labels.firstIndex(of: $0) }
            #expect(at.count == order.count && at == at.sorted(), "\(name): \(labels)")
            let join = try #require(read.first { $0.label == "Join a class" }, "\(name)")
            #expect(join.traits.contains(.button) && !join.traits.contains(.notEnabled))
            #expect(labels.filter { $0 == "Join a class" }.count == 1, "\(name): \(labels)")
            #expect(!labels.contains("Your classes") && !labels.contains("Sign out"), "\(name)")
        }
        let join = Phone(fixture: try #require(PreviewFixtures.all["join"]))
        let opened = try await elements(of: RootView(phone: join), once: "Enter your class code")
        #expect(opened.contains { $0.label == "Back" && $0.traits.contains(.button) })
        #expect(!opened.contains { $0.label == "Sign out" || $0.label == "Home" })
    }

    @Test(
        "The age question's Continue as the approved design's age boards draw it: both picked, Continue; a second Sign up this run, its page opening from Continue, Signing up… with no press taken, the question's menus still there (the owner's ruling, 2026-10-07: every Sign up asks)"
    )
    func ageContinue() async throws {
        for (name, label, busy) in [
            ("agePicked", "Continue", false), ("ageSigningUp", "Signing up…", true),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            let read = try await elements(of: RootView(phone: phone), once: label)
            let button = try #require(read.first { $0.label == label }, "\(name)")
            #expect(button.traits.contains(.notEnabled) == busy, "\(name)")
            #expect(read.contains { $0.label == "Month" } && read.contains { $0.label == "Year" })
        }
    }

    @Test(
        "The gap's fallback, routed (the owner's decision, 2026-10-06): a sign-in into an account that has not passed the 13+ check on this phone shows the question first, no tab bar; 13 or older carries on as after any sign-in, no page opened; under 13 lands on the account's deletion under the stop screen's title — a frozen phone's, not started, a stop with Try again alone; each fixture of it says the approved words. A frozen phone writes nothing to the phone's defaults"
    )
    func ageAfterSignIn() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        let pages = Pages()
        // Gated, every read found no token to send: none answered, one failed.
        var gated = try #require(PreviewFixtures.all["ageAfterSignIn"])
        gated.sync?.meFailed = .networkError
        let passing = Phone(fixture: gated)
        #expect(passing.shown == (.age, false))
        passing.birth = Birth(month: 1, year: 2000)
        await passing.answerAge(through: pages.browser)
        // The sign-in reaches Bali now: the starting screen until a read answers (warn 1's fix).
        #expect(passing.age.answer == .passed && passing.shown == (.starting, false))
        #expect(defaults.stringArray(forKey: AgeCheck.key) == before as? [String])
        var read = try #require(gated.sync)
        read.meFailed = nil
        read.me = try BaliJSON.makeDecoder().decode(
            MeResponse.self,
            from: Data(
                #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"p3","name":"Period 3","teacher":{"displayName":"Ms. Rivera"},"enrollmentId":"e3"}],"session":null}"#
                    .utf8))
        passing.synced(read)
        #expect(passing.shown == (.home, true))
        let young = Phone(fixture: try #require(PreviewFixtures.all["ageAfterSignIn"]))
        let now = Calendar(identifier: .gregorian).dateComponents([.year, .month], from: Date())
        young.birth = Birth(month: now.month, year: now.year)
        await young.answerAge(through: pages.browser)
        #expect(young.underThirteen && young.shown == (.deleting, false))
        // Not started, said as Me's says it, Try again its way on.
        #expect(young.deleting.saidUnderThirteen?.title == Deleting.notDeleted)
        guard case .stopped(_, _, retries: true) = young.deleting else {
            Issue.record("\(young.deleting)")
            return
        }
        #expect(pages.opened.isEmpty)
        let unfinished =
            "Bali couldn't finish deleting your account. Check your connection and try again."
        for (name, body) in [
            ("deletingUnderThirteen", "Bali is deleting your account. This takes a moment."),
            ("deletingUnderThirteenNotDeleted", unfinished),
            (
                "deletingUnderThirteenDone",
                "Bali deleted your account. Ask your teacher how to take part in class without the app."
            ),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(phone.shown == (.deleting, false), "\(name)")
            #expect(phone.deleting.saidUnderThirteen?.body == body, "\(name)")
        }
    }

    @Test(
        "The gap's fallback through the phone's own sign-in and engine: signed in, an account that has not passed the 13+ check on this phone, nothing reaches Bali's API — the engine's sends and reads find no token; 13 or older files the account and sends it all at once, no page opened; under 13 deletes the account as Delete account does (C4) — what the gate held goes first, the Emergency Unlock ahead of the tap queued before it, then DELETE /v1/me, then Cognito's DeleteUser, no read of the truth first — the outbox left empty for whoever signs in next, done final for the run under the stop screen's title, nothing filed. The key as it was before is put back after",
        .timeLimit(.minutes(3)))
    func ageAfterSignInWiring() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        /// Signed in, an account that has not passed the check on this phone, the engine running:
        /// the phone, its engine and the stand-in, once the engine has found no token to send.
        func signedInAround() async throws
            -> (Phone, SyncEngine, Recorder, Keychain, Task<Void, Never>)
        {
            defaults.removeObject(forKey: AgeCheck.key)
            let server = Recorder()
            let keychain = Keychain(account: "ana", scoped: true)
            let (phone, engine) = try gatedStandIn(server, keychain: keychain)
            let running = Task { await engine.run() }
            phone.signed(in: true, as: "ana")
            await engine.retryNow()
            try await until { await engine.state.meFailed == .networkError }
            #expect(await engine.state.link == .signIn)
            #expect(await server.asked.isEmpty)
            return (phone, engine, server, keychain, running)
        }
        let pages = Pages()
        let (passing, engine, server, _, running) = try await signedInAround()
        passing.birth = Birth(month: 1, year: 2000)
        await passing.answerAge(through: pages.browser)
        try await until { await server.asked.contains("GET /v1/me") }
        // Its read once or twice: the failure forgotten reads it again (warn 1's fix).
        #expect(Set(await server.asked) == ["GET /v1/me"] && pages.opened.isEmpty)
        running.cancel()
        _ = engine

        let (young, held, deleter, keychain, deleting) = try await signedInAround()
        try await held.record(.tap(tagId: "tag"))
        try await held.record(.unlock(session: "s", reason: nil))
        try await until {
            let state = await held.state
            return state.queued.count == 2 && state.link == .signIn
        }
        #expect(await deleter.asked.isEmpty)
        let now = Calendar(identifier: .gregorian).dateComponents([.year, .month], from: Date())
        young.birth = Birth(month: now.month, year: now.year)
        await young.answerAge(through: pages.browser)
        #expect(young.deleting == .done && young.shown == (.deleting, false))
        #expect(
            young.deleting.saidUnderThirteen?.body
                == "Bali deleted your account. Ask your teacher how to take part in class without the app."
        )
        #expect(
            await deleter.asked
                == ["POST /v1/sessions/s/unlock", "POST /v1/taps", "DELETE /v1/me", "POST /"])
        #expect(await held.state.queued.isEmpty && keychain.empty)
        #expect(defaults.object(forKey: AgeCheck.key) == nil && pages.opened.isEmpty)
        deleting.cancel()
    }

    @Test(
        "Me's Delete account for an account that has not passed the 13+ check on this phone — signed in on a build that kept no per-account pass, Me reached through a session's Home or the home a standing not read keeps — is C4's own, said as Me's, never the fallback's (santa's round 1): the outbox goes first, under the deletion's own token, and an Emergency Unlock the server has not recorded holds the deletion back in C4b's words, with Back; DELETE /v1/me is never sent. The key as it was before is put back after",
        .timeLimit(.minutes(3)))
    func deleteFromMeUnchecked() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        defaults.removeObject(forKey: AgeCheck.key)
        let server = Recorder()
        let (phone, engine) = try gatedStandIn(
            server, keychain: Keychain(account: "ana", scoped: true))
        phone.signed(in: true, as: "ana")
        // A session the stand-in never answers an unlock in.
        try await engine.record(.unlock(session: "t", reason: nil))
        phone.deleting.ask()
        await phone.deleteAccount()
        guard case .stopped(let title, _, retries: true) = phone.deleting else {
            Issue.record("\(phone.deleting)")
            return
        }
        #expect(title == Deleting.notFinished && !phone.underThirteen)
        #expect(
            phone.deleting.said?.body.hasPrefix("Your Emergency Unlock hasn't reached your teacher")
                == true)
        #expect(await server.asked == ["POST /v1/sessions/t/unlock"])
    }

    @Test(
        "Delete account's own screens look as C4b's were approved, the gap's fallback's gutter its own alone (Claude Review): C4b's deletion under way, nothing under its words, sits where the page centres it; the fallback's steps sit on the gutter, as the stop screen's words do (the approved Sign in & sign up design)"
    )
    func deletingLayout() async throws {
        /// Where `title` starts across the screen `fixture` draws.
        func start(_ fixture: String, _ title: String) async throws -> CGFloat {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[fixture]))
            let found = try await elements(of: RootView(phone: phone), once: title).first {
                $0.label == title
            }
            return try #require(found, "\(fixture)").frame.minX
        }
        let gutter = try await start("tooYoung", AgeCheck.notYet)
        #expect(try await start("deletingUnderThirteen", AgeCheck.notYet) == gutter)
        #expect(try await start("deletingUnderThirteenDone", AgeCheck.notYet) == gutter)
        let busy = try await start("deleting", "Deleting your account…")
        #expect(busy > gutter + 0.5, "\(busy) at a gutter of \(gutter)")
    }

    @Test(
        "The gap's fallback never keeps a shielded phone from Emergency Unlock (santa's round 1): stopped where another try can help, its screen has Try again alone, as the canvas draws it; but with the shields on — a record the deletion sent first put the phone back in its class — Back too, as C4b's stops have it, and Back leads to Focus"
    )
    func deletingUnderThirteenShielded() async throws {
        /// Whether the screen `phone` shows offers Back, read once its title is.
        func backs(_ phone: Phone) async throws -> Bool {
            try await elements(of: RootView(phone: phone), once: AgeCheck.notYet).contains {
                $0.label == "Back"
            }
        }
        let calm = Phone(
            fixture: try #require(PreviewFixtures.all["deletingUnderThirteenNotDeleted"]))
        #expect(calm.shown == (.deleting, false))
        #expect(try await !backs(calm))
        var state = try #require(PreviewFixtures.all["deletingShielded"])
        state.age = .tooYoung
        state.deleting.answered(.notDeleted(.networkError), underThirteen: true)
        let shielded = Phone(fixture: state)
        #expect(shielded.shown == (.deleting, false))
        #expect(try await backs(shielded))
        shielded.deleting.close()
        #expect(shielded.shown.screen == .focus)
    }

    @Test(
        "Your name, routed (the owner's decision, 2026-10-07): with Bali not reached yet on a sign-in kept from the last run, Screen Time as before; once a read names a student's account with no name, Your name in its place, no tab bar, Sign out its other way on; named, the router moves on, to Screen Time, then Home in no class, never a Join of its own; a teacher's account never gets it"
    )
    func nameRouted() throws {
        /// `GET /v1/me`'s answer: an account of `role` named `name` — JSON's, null for none — in
        /// no class.
        func user(_ name: String, _ role: String = "student") throws -> MeResponse {
            try BaliJSON.makeDecoder().decode(
                MeResponse.self,
                from: Data(
                    #"{"user":{"id":"ana","role":"\#(role)","displayName":\#(name)},"classes":[],"session":null}"#
                        .utf8))
        }
        var protection = Protection()
        (protection.checked, protection.permission) = (true, .notDetermined)
        var state = SyncState()
        let phone = Phone(fixture: PreviewFixtures.State(protection: protection, sync: state))
        #expect(phone.shown == (.screenTime, false))
        state.me = try user("null")
        phone.synced(state)
        #expect(phone.shown == (.name, false) && phone.offersSignOut)
        state.me = try user(#""Ana Rodriguez""#)
        phone.synced(state)
        #expect(phone.shown == (.screenTime, false))
        protection.permission = .approved
        let inNone = Phone(fixture: PreviewFixtures.State(protection: protection, sync: state))
        #expect(inNone.shown == (.home, true))
        state.me = try user("null", "teacher")
        inNone.synced(state)
        #expect(inNone.shown == (.home, true))
    }

    @Test(
        "No screen flashes before Your name (the owner's ruling, 2026-10-07; the PR's warn 1): a sign-in made this run holds the starting screen, a read that failed before it forgotten, until a read answers — Your name for an account with no name — or fails, when the screens go on; a launch signed in holds nothing, as before"
    )
    func nameHeld() throws {
        let nameless = try BaliJSON.makeDecoder().decode(
            MeResponse.self,
            from: Data(
                #"{"user":{"id":"ana","role":"student","displayName":null},"classes":[],"session":null}"#
                    .utf8))
        var protection = Protection()
        (protection.checked, protection.permission) = (true, .notDetermined)
        // Signed out, a read made with no token to send: failed.
        var failed = SyncState()
        failed.meFailed = .networkError
        var answered = SyncState()
        answered.me = nameless
        let signingUp = Phone(
            fixture: PreviewFixtures.State(signedIn: false, protection: protection, sync: failed))
        #expect(signingUp.shown == (.signIn, false))
        signingUp.signed(in: true, as: "ana")
        #expect(signingUp.shown == (.starting, false) && signingUp.sync?.meFailed == nil)
        signingUp.synced(answered)
        #expect(signingUp.shown == (.name, false))
        // A read that fails since the sign-in: the screens go on, Your name once one answers.
        let offline = Phone(
            fixture: PreviewFixtures.State(signedIn: false, protection: protection, sync: failed))
        offline.signed(in: true, as: "ana")
        offline.synced(failed)
        #expect(offline.shown == (.screenTime, false))
        offline.synced(answered)
        #expect(offline.shown == (.name, false))
        // A launch, the Keychain read signed in: nothing held, as before.
        let launched = Phone(
            fixture: PreviewFixtures.State(signedIn: nil, protection: protection, sync: SyncState()))
        launched.signed(in: true, as: "ana")
        #expect(launched.shown == (.screenTime, false))
    }

    @Test(
        "The hold through the phone's own sign-in and engine (the PR's warn 1): signed out, the engine's read finds no token and fails; once the sign-in lands — an account past the 13+ check on this phone — that failure is forgotten — a state the engine sent before it shows none — and the engine reads `GET /v1/me` with the new token, its answer the phone's. The key as it was before is put back after",
        .timeLimit(.minutes(3)))
    func nameHeldWiring() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        defaults.set(["ana"], forKey: AgeCheck.key)
        let server = Names([])
        let (phone, engine) = try gatedStandIn(server, keychain: Keychain(account: nil))
        let running = Task { await engine.run() }
        defer { running.cancel() }
        phone.signed(in: false)
        await engine.retryNow()
        try await until { await engine.state.meFailed == .networkError }
        let stale = await engine.state
        phone.synced(stale)
        let pages = Pages()
        pages.signsIn = true
        await phone.signIn(through: pages.browser)
        phone.signed(in: true, as: "ana")
        #expect(phone.signedInThisRun && phone.sync?.meFailed == nil)
        phone.synced(stale)
        #expect(phone.sync?.meFailed == nil)
        try await until { await engine.state.me != nil }
        phone.synced(await engine.state)
        #expect(phone.sync?.me?.user.displayName == nil && phone.sync?.meFailed == nil)
        #expect(await server.reads == 1)
    }

    @Test(
        "Your name as the approved Sign in & sign up design draws it: its title, its line, the field, its help, then Continue — waiting for a name, Saving… and dimmed while it saves — any refusal or failure under it in Me's words, then Sign out, dimmed while it saves"
    )
    func nameScreen() async throws {
        let title = "What's your name?"
        let cases: [(String, String, Bool, String?)] = [
            ("name", "Continue", false, nil), ("nameTyping", "Continue", true, nil),
            ("nameSaving", "Saving…", false, nil),
            (
                "nameTaken", "Continue", true,
                "A classmate already uses that name. Try another, like adding your last initial."
            ),
            ("nameInvalid", "Continue", true, "Bali can't use that name. Try another."),
            ("nameBlank", "Continue", false, "Type a name to save it."),
            (
                "nameCantSave", "Continue", true,
                "Can't reach the server. Check your connection and try again."
            ),
        ]
        for (name, button, enabled, failure) in cases {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(phone.shown == (.name, false), "\(name)")
            let read = try await elements(of: RootView(phone: phone), once: title)
            let labels = read.map { $0.label ?? "" }
            let order =
                [
                    title, "Add the name your teachers know you by.", "Name",
                    "Your teachers see this name.", button,
                ] + (failure.map { [$0] } ?? []) + ["Sign out"]
            let at = order.compactMap { labels.firstIndex(of: $0) }
            #expect(at.count == order.count && at == at.sorted(), "\(name): \(labels)")
            let action = try #require(read.first { $0.label == button }, "\(name)").traits
            #expect(action.contains(.button) && action.contains(.notEnabled) == !enabled, "\(name)")
            let signOut = try #require(read.first { $0.label == "Sign out" }, "\(name)").traits
            #expect(signOut.contains(.notEnabled) == (name == "nameSaving"), "\(name)")
        }
    }

    @Test(
        "Your name through the phone's own engine: Continue saves the name as Me's card does, `PATCH /v1/me` — a name a classmate uses, or one Bali can't use, said in Me's words, nothing set; a blank one said with nothing sent; no answer said as the Join screen says it, and Continue again goes under the same event id, its replay (rule 4); set, the name is `me`'s at once, the field let go, and the truth read again",
        .timeLimit(.minutes(3)))
    func nameWiring() async throws {
        let taken =
            #"{"error":{"code":"conflict","reason":"display_name_taken","message":"a classmate already uses that name"}}"#
        let invalid =
            #"{"error":{"code":"bad_input","reason":"display_name_invalid","message":"invalid request"}}"#
        let server = Names([(409, taken), (400, invalid), nil, (200, "")])
        let (phone, engine) = try standIn(server)
        let running = Task { await engine.run() }
        defer { running.cancel() }
        phone.signed(in: true, as: "ana")
        await engine.retryNow()
        try await until { await engine.state.me != nil }
        phone.synced(await engine.state)
        #expect(phone.sync?.me?.user.displayName == nil)
        phone.naming.type("Ana")
        await phone.saveName()
        #expect(
            phone.naming.failure
                == "A classmate already uses that name. Try another, like adding your last initial.")
        phone.naming.type("Ana R")
        await phone.saveName()
        #expect(phone.naming.failure == "Bali can't use that name. Try another.")
        phone.naming.type("  ")
        await phone.saveName()
        #expect(phone.naming.failure == Naming.blank && !phone.naming.busy)
        #expect(await server.renames.count == 2)
        phone.naming.type("Ana Rodriguez")
        await phone.saveName()
        #expect(
            phone.naming.failure == "Can't reach the server. Check your connection and try again.")
        #expect(phone.naming.name == "Ana Rodriguez" && !phone.naming.busy)
        await phone.saveName()
        #expect(phone.naming == Naming())
        let renames = await server.renames
        #expect(renames.map(\.displayName) == ["Ana", "Ana R", "Ana Rodriguez", "Ana Rodriguez"])
        #expect(renames[2].eventId == renames[3].eventId && renames[1].eventId != renames[2].eventId)
        #expect(await engine.state.me?.user.displayName == "Ana Rodriguez")
        try await until { await server.reads == 2 }
        phone.synced(await engine.state)
        #expect(phone.sync?.me?.user.displayName == "Ana Rodriguez")
    }

    @Test(
        "Your name's keyboard as a save ends (#292's review): down while the save runs, back once one that set no name is over, as on Me — and never back once the name is set, so it never pops up for a moment before the router moves on. The name typed as Your name's field types it, never edited as on Me (`Naming.editing` stays false): looked at after each render, for a while past the save"
    )
    func nameKeyboard() async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let (phone, key) = (
            Phone(fixture: try #require(PreviewFixtures.all["name"])), scene.keyWindow
        )
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        window.rootViewController = UIHostingController(rootView: RootView(phone: phone))
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            key?.makeKey()
        }
        let typing = { textFields(in: window).contains { $0.isFirstResponder } }
        try await until { typing() }
        /// A save of the name typed, answered by `PATCH /v1/me` with `status` and `body` once the
        /// keyboard is down for it.
        func save(_ status: Int, _ body: String) async throws {
            let request = phone.naming.save(at: Date())
            try await until { !typing() }
            phone.naming.saved(await client(status, body).updateMe(request), for: request)
        }
        phone.naming.type("Ana")
        try await save(
            409, #"{"error":{"code":"conflict","reason":"display_name_taken","message":"taken"}}"#)
        try await until { typing() }
        try await save(
            200, #"{"outcome":"applied","user":{"id":"ana","role":"student","displayName":"Ana"}}"#)
        #expect(phone.naming == Naming() && phone.shown.screen == .name)
        var back = false
        let end = ContinuousClock.now + .milliseconds(600)
        while ContinuousClock.now < end, !back {
            try await Task.sleep(for: .milliseconds(5))
            back = typing()
        }
        #expect(!back)
    }

    @Test(
        "The permission once read approved is kept in the phone's own defaults (C1b) — set at a read of approved, cleared once the check judges the permission off (denied, or not determined for the grace), left at a read not determined for a moment — and a fresh Phone reads it back; with it, not determined routes as approved. The flag as it was before is put back after"
    )
    func everApproved() throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.everApprovedKey)
        defer { defaults.set(before, forKey: Phone.everApprovedKey) }
        defaults.removeObject(forKey: Phone.everApprovedKey)
        /// What a pass read: `permission`, judged off or not.
        func read(_ permission: Permission, off: Bool = false) -> Protection {
            var protection = Protection()
            (protection.checked, protection.permission, protection.permissionOff) =
                (true, permission, off)
            return protection
        }
        let phone = Phone(fixture: try #require(PreviewFixtures.all["screenTime"]))
        #expect(!phone.everApproved && phone.shown.screen == .screenTime)
        phone.remember(read(.notDetermined))
        #expect(!phone.everApproved && !Phone().everApproved)
        phone.remember(read(.approved))
        #expect(phone.everApproved && Phone().everApproved && phone.shown.screen == .home)
        phone.remember(read(.notDetermined))
        #expect(phone.everApproved && phone.shown.screen == .home)
        // Not determined for the grace: never granted, access off, or a grant that did not come
        // back with a restored backup, which restores these defaults.
        phone.remember(read(.notDetermined, off: true))
        #expect(!phone.everApproved && !Phone().everApproved && phone.shown.screen == .screenTime)
        phone.remember(read(.approved))
        phone.remember(read(.denied, off: true))
        #expect(!phone.everApproved && !Phone().everApproved && phone.shown.screen == .screenTime)
    }

    @Test(
        "Whose classes `GET /v1/me` has listed on this phone is kept in its own defaults (#143), as the permission once approved is, and a fresh Phone reads it back; a frozen fixture's stays its own (santa's round 1). In no class later, removed from their last, the student lands on Home, its tab bar and its card saying they are in none any more, and nothing they opened closes for it: Join opened over Home stays, its code typed, as it does over the empty Home at a read saying none again, and so does a tab chosen there, Me after the Leave of the last class too. Keyed on the student: the same student signing back in is still known; another student in no class gets Home too, its card saying she is not in one yet (the owner's ruling, 2026-10-07), a late read of the last one's classes included, until listed in a class herself. The key as it was before is put back after"
    )
    func everInClass() throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.inClassKey)
        defer { defaults.set(before, forKey: Phone.inClassKey) }
        defaults.removeObject(forKey: Phone.inClassKey)
        /// `GET /v1/me` as it answers student `id`, named, in `classes`.
        func me(_ id: String, _ classes: String = "") throws -> MeResponse {
            try BaliJSON.makeDecoder().decode(
                MeResponse.self,
                from: Data(
                    #"{"user":{"id":"\#(id)","role":"student","displayName":"\#(id)"},"classes":[\#(classes)],"session":null}"#
                        .utf8))
        }
        let period3 = #"{"id":"p3","name":"Period 3 — Algebra II","enrollmentId":"e3"}"#
        // Ana, in Period 3 and Period 5: the live phone keeps her, and a fresh one reads it back.
        var state = try #require(PreviewFixtures.all["home"]?.sync)
        let live = Phone()
        live.synced(state)
        #expect(live.inClass == "ana" && Phone().inClass == "ana")
        defaults.removeObject(forKey: Phone.inClassKey)
        let phone = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        phone.synced(state)
        #expect(phone.inClass == "ana" && Phone().inClass == nil)
        // Removed from both (the owner's phone) while Join a class, opened over Home, has a code
        // typed: Join stays, the code kept; back, Home, its tab bar and its card, never Join.
        phone.open(.join)
        phone.joining.type("KWX")
        state.me = try me("ana")
        phone.synced(state)
        #expect(phone.shown.screen == .join && phone.canGoBack && phone.joining.code == "KWX")
        phone.back()
        #expect(phone.shown == (.home, true) && !phone.canGoBack && phone.everInClass)
        let (none, notYet) = (
            "You're not in any classes. Join one with the class code from your teacher.",
            "You're not in a class yet. Join one with the class code from your teacher."
        )
        #expect(phone.sync?.noClassesCard(everInClass: phone.everInClass) == none)
        // Its own Join a class, then History chosen: a read saying none again, as each return to
        // the front makes, closes neither.
        phone.open(.join)
        phone.joining.type("KWX")
        state.heardAt = Date() + 1
        phone.synced(state)
        #expect(phone.shown.screen == .join && phone.canGoBack && phone.joining.code == "KWX")
        phone.back()
        phone.select(.history)
        state.heardAt = Date() + 2
        phone.synced(state)
        #expect(phone.shown == (.history, true))
        // Ana signed out and back in, still in no class: still Home.
        phone.signed(in: true, as: "ana")
        phone.signed(in: false)
        phone.signed(in: true, as: "ana")
        phone.synced(state)
        #expect(phone.shown == (.home, true) && phone.inClass == "ana")
        // Bea signs in, in no class: Home, not in a class yet, a late read of Ana's classes landing
        // after her sign-in included; listed in a class herself, Bea is the one kept.
        phone.signed(in: true, as: "bea")
        state.me = try me("ana", period3)
        phone.synced(state)
        state.me = try me("bea")
        phone.synced(state)
        #expect(phone.shown == (.home, true) && phone.inClass == "ana" && !phone.everInClass)
        #expect(phone.sync?.noClassesCard(everInClass: phone.everInClass) == notYet)
        state.me = try me("bea", period3)
        phone.synced(state)
        #expect(phone.inClass == "bea")
        // Me's Leave of the last class (C6c): Me stays, the class gone from it; Home has the card.
        let leaving = Phone(fixture: try #require(PreviewFixtures.all["me"]))
        var left = try #require(leaving.sync)
        leaving.synced(left)
        left.me = try me("ana")
        leaving.synced(left)
        #expect(leaving.shown == (.me, true))
        leaving.select(.home)
        #expect(leaving.shown.screen == .home)
        #expect(leaving.sync?.noClassesCard(everInClass: leaving.everInClass) == none)
    }

    @Test(
        "The student's own no is the only cancel (C1b): the browser session's canceledLogin is the sign-in's cancelled — typed, the NSError behind it, or another error type carrying its domain and code, however SwiftUI's session hands it over (#105's review) — and Family Controls' authorizationCanceled the ask's; any other failure is said, what the platform said kept: the session's other codes, its cancel's code in another domain, a cancel of another kind"
    )
    func cancels() {
        let (session, canceledLogin) = (
            ASWebAuthenticationSessionError.errorDomain,
            ASWebAuthenticationSessionError.canceledLogin.rawValue
        )
        /// An error of another type, bridging to the session's domain: the typed error's cast
        /// misses it.
        struct Carried: CustomNSError {
            static var errorDomain: String { ASWebAuthenticationSessionError.errorDomain }
            let errorCode: Int
        }
        #expect(SignInError(browser: ASWebAuthenticationSessionError(.canceledLogin)) == .cancelled)
        #expect(SignInError(browser: NSError(domain: session, code: canceledLogin)) == .cancelled)
        #expect(SignInError(browser: Carried(errorCode: canceledLogin)) == .cancelled)
        let unopened = SignInError(browser: ASWebAuthenticationSessionError(.presentationContextInvalid))
        guard case .notOpened(let why) = unopened else {
            Issue.record("\(unopened)")
            return
        }
        // The bridged error's own description — its domain and code — kept for the readout.
        #expect(why.contains("WebAuthenticationSession") && why.contains("Code=3"))
        let notProvided = ASWebAuthenticationSessionError.presentationContextNotProvided.rawValue
        let others: [any Error] = [
            NSError(domain: session, code: notProvided), Carried(errorCode: notProvided),
            NSError(domain: NSURLErrorDomain, code: canceledLogin), URLError(.cancelled),
            CancellationError(),
        ]
        for error in others {
            let said = SignInError(browser: error)
            if case .notOpened = said { continue }
            Issue.record("\(error): \(said)")
        }
        #expect(ScreenTimeAskError(familyControls: FamilyControlsError.authorizationCanceled) == .cancelled)
        let failed = ScreenTimeAskError(familyControls: FamilyControlsError.invalidAccountType)
        #expect(failed == .failed("\(FamilyControlsError.invalidAccountType)"))
        #expect(
            ScreenTimeAskError(familyControls: URLError(.notConnectedToInternet))
                .words(.notDetermined) != nil)
    }

    @Test(
        "The intro is seen once per account, not per phone (the owner's ruling, 2026-10-07): its Sign up keeps it seen for this run alone, in memory, so Sign up again this run — the question asked again — opens the page from its Continue, and writes nothing to the phone's defaults, a page closed or not opened alike; a new run's Sign up shows it again, the key a build before kept in the phone's defaults never read; a first launch never opens on it (the approved Sign in & sign up design). The key as it was before is put back after"
    )
    func introSeen() async throws {
        let (defaults, old) = (UserDefaults.standard, "introSeen")
        let before = defaults.object(forKey: old)
        defer { defaults.set(before, forKey: old) }
        // A build before kept the intro seen in the phone's defaults.
        defaults.set(true, forKey: old)
        let pages = Pages()
        let signedOut = { try standIn(StandIn(), keychain: Keychain(account: nil)).0 }
        let phone = try signedOut()
        #expect(!phone.introSeen && phone.shown.screen == .starting)
        await signUp(phone, through: pages)
        #expect(phone.introShows && pages.opened.isEmpty)
        // Its page closed, then one that could not open: the page at once, nothing kept.
        defaults.removeObject(forKey: old)
        await phone.sawIntro(through: pages.browser)
        #expect(phone.introSeen && !phone.introShows && pages.opened.count == 1)
        pages.answer = .notOpened("no window")
        await signUp(phone, through: pages)
        #expect(!phone.introShows && pages.opened.count == 2)
        #expect(defaults.object(forKey: old) == nil)
        let relaunched = try signedOut()
        await signUp(relaunched, through: pages)
        #expect(relaunched.introShows && !relaunched.introSeen && pages.opened.count == 2)
    }

    @Test(
        "The intro once per account within a run too (#292's review): an account signed up, then signed out — Your name's Sign out — and the next Sign up this run shows the question, then the intro again before its page; Sign up again with no sign-out between asks the question again (the owner's ruling, 2026-10-07), its Continue opening the page at once, as the approved design draws it. Through the phone's own sign-in, its Sign out and the Keychain's word. The key as it was before is put back after",
        .timeLimit(.minutes(3)))
    func introAfterSignOut() async throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: AgeCheck.key)
        defer { defaults.set(before, forKey: AgeCheck.key) }
        let (phone, _) = try standIn(Names([]), keychain: Keychain(account: nil))
        let signIn = try #require(phone.signIn)
        let following = Task { await phone.follow(signIn) }
        defer { following.cancel() }
        try await until { phone.signedIn == false }
        // Ana signs up: the question, the intro, then her page, which signs her in.
        let pages = Pages()
        await signUp(phone, through: pages)
        #expect(phone.introShows && pages.opened.isEmpty)
        pages.signsIn = true
        await phone.sawIntro(through: pages.browser)
        try await until { phone.signedIn == true }
        #expect(!phone.introShows && pages.opened.count == 1)
        // She signs out; Bea's Sign up, the same run: the question, the intro, no page yet.
        await phone.signOut()
        try await until { phone.signedIn == false }
        await signUp(phone, through: pages)
        #expect(phone.introShows && pages.opened.count == 1)
        // Bea closes her page: Sign up again asks again, and its Continue opens the page at once.
        pages.signsIn = false
        await phone.sawIntro(through: pages.browser)
        await phone.signIn(.signUp, through: pages.browser)
        #expect(phone.age.answer == .asked && pages.opened.count == 2)
        phone.birth = Birth(month: 1, year: 2000)
        await phone.answerAge(through: pages.browser)
        #expect(!phone.introShows && pages.opened.count == 3)
    }

    @Test(
        "The shield extension ships D1's ring mark, the icon of Bali's shield (B5c): drawn as D1 has it — the arc, and the track in its gap at the upper left, around nothing — and never tinted; and the app's `BaliMark`, drawn in SwiftUI, draws the same at 64 (C1b), so the two cannot drift apart unnoticed"
    )
    func mark() throws {
        let plugins = try #require(Bundle.main.builtInPlugInsURL)
        let shield = try #require(Bundle(url: plugins.appending(path: "BaliShield.appex")))
        let asset = try #require(UIImage(named: "BaliMark", in: shield, with: nil))
        #expect(asset.size == CGSize(width: 64, height: 64))
        #expect(asset.renderingMode == .alwaysOriginal)
        let renderer = ImageRenderer(content: BaliMark(size: 64))
        renderer.scale = 1
        let drawn = try #require(renderer.uiImage)
        #expect(drawn.size == CGSize(width: 64, height: 64))
        func opaque(_ hex: Int) -> [Int] { [hex >> 16 & 0xFF, hex >> 8 & 0xFF, hex & 0xFF, 255] }
        func near(_ found: [Int], _ wanted: [Int]) -> Bool {
            zip(found, wanted).allSatisfy { abs($0 - $1) <= 4 }
        }
        let (arc, track) = (opaque(0x2C6F51), opaque(0xBCDCCA))
        for (which, mark) in [("the asset", asset), ("BaliMark", drawn)] {
            let pixel = try pixels(of: mark)
            // On the ring's middle line: right, bottom and lower left the arc; upper left its gap.
            for (x, y) in [(56, 32), (32, 56), (15, 49)] {
                #expect(near(pixel(x, y), arc), "\(which) at \(x), \(y): \(pixel(x, y))")
            }
            #expect(near(pixel(15, 15), track), "\(which): \(pixel(15, 15))")
            #expect(pixel(32, 32)[3] == 0 && pixel(1, 1)[3] == 0, "\(which)")
        }
    }

    @Test(
        "Every screen's scroll view reaches the phone's edges — its scroll bar at the screen's edge, never over the cards (the phone's check, 2026-09-30) — with its content inside D1's 24-pt gutters, as the rest of the screen is: each fixture's screen at the phone's own size, the intro opened at each of its pages and Me's What your teacher sees among them"
    )
    func scrollEdges() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        // The intro's paging lays out only the page shown, so it is opened at each of its pages
        // (`IntroView.pages`; #135's review: paged by hand, the pager's slots were checked, not
        // its pages, and a pager with no width would have stopped the suite).
        let shown = Phone(fixture: try #require(PreviewFixtures.all["intro"]))
        let intro = IntroView.pages.map {
            ("intro, page \($0)", AnyView(IntroView(phone: shown, page: $0)))
        }
        let screens =
            PreviewFixtures.all.map { ($0.key, AnyView(RootView(phone: Phone(fixture: $0.value)))) }
            + [("consentSheet", AnyView(ConsentSheet()))] + intro
        var introDrawn: Set<Data> = []
        for (name, screen) in screens {
            let window = UIWindow(windowScene: scene)
            window.frame = scene.screen.bounds
            window.rootViewController = UIHostingController(rootView: screen)
            window.isHidden = false
            defer { window.isHidden = true }
            window.layoutIfNeeded()
            let scrolls = scrollViews(in: window)
            // Every screen scrolls once its text outgrows it, but the starting mark.
            #expect(scrolls.isEmpty == (name == "starting"), "\(name)")
            expectEdges(of: scrolls, in: window, name)
            // The page a pager shows is among those checked: its own scroll view.
            for pager in scrolls where pager.isPagingEnabled {
                let page = scrolls.contains { $0 !== pager && $0.isDescendant(of: pager) }
                #expect(page, "\(name): no page shown")
            }
            if intro.contains(where: { $0.0 == name }), let drawn = drawn(window) {
                introDrawn.insert(drawn)
            }
        }
        // Each opened at a page of its own.
        #expect(introDrawn.count == IntroView.pages.count)
    }

    @Test(
        "The portal's privacy policy and terms are linked (C2b) from the intro, Sign in and Me — read from each screen's type, as `historyLazy` reads History's — each link's row a 44-pt target; on the intro, drawn under its button on the last page alone, and read by VoiceOver there alone, as links, in a strip kept at least that row tall on the first page too, so the button never moves; and each opens this build's portal's own page, `/privacy` and `/terms`"
    )
    func policyLinks() throws {
        let portal = try #require(PolicyLinks.portal)
        #expect(portal == AppConfig(info: Bundle.main.infoDictionary ?? [:])?.portal)
        #expect(PolicyLinks.Page.allCases.map(\.title) == ["Privacy policy", "Terms"])
        #expect(
            PolicyLinks.Page.allCases.map { $0.url(on: portal).absoluteString }
                == ["https://bali-portal.vercel.app/privacy", "https://bali-portal.vercel.app/terms"])
        let me = Phone(fixture: try #require(PreviewFixtures.all["me"]))
        for (name, screen) in [
            ("intro", String(reflecting: type(of: IntroView(phone: me).body))),
            ("signIn", String(reflecting: type(of: SignInView(phone: me).body))),
            ("me", String(reflecting: type(of: MeView(phone: me).body))),
        ] {
            #expect(screen.contains("PolicyLinks"), "\(name)")
        }
        let row = UIHostingController(rootView: PolicyLinks())
            .sizeThatFits(in: CGSize(width: 390, height: 1000))
        #expect(row.height >= 44, "\(row)")
        // The intro, drawn at the phone's size at its first and last pages: under its button — the
        // brand-filled button, its flat bottom found from the bottom up past its rounded corner,
        // clear of the centred links (santa's round 1: at the corner, the button's own last rows
        // counted as ink) — a strip at least the row and its padding tall, with the links' ink in
        // it on the last page alone.
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        func brand(_ pixel: [Int]) -> Bool {
            zip(pixel, [0x24, 0x5A, 0x43]).allSatisfy { abs($0 - $1) <= 24 }
        }
        let intro = Phone(fixture: try #require(PreviewFixtures.all["intro"]))
        for (page, linked) in [(IntroView.pages.lowerBound, false), (IntroView.pages.upperBound, true)] {
            let window = UIWindow(windowScene: scene)
            window.frame = scene.screen.bounds
            window.rootViewController = UIHostingController(
                rootView: IntroView(phone: intro, page: page))
            window.isHidden = false
            defer { window.isHidden = true }
            window.layoutIfNeeded()
            let png = try #require(drawn(window))
            let image = try #require(UIImage(data: png))
            let pixel = try pixels(of: image)
            let scale = Int(window.screen.scale)
            let width = Int(image.size.width)
            let bottom = Int(image.size.height) - Int(window.safeAreaInsets.bottom) * scale
            let column = Int(Theme.gutter + 2 * Theme.Radius.md) * scale
            var button = bottom - 1
            while button > 0, !brand(pixel(column, button)) { button -= 1 }
            let strip = (button + 1)..<bottom
            #expect(strip.count >= 52 * scale, "page \(page): \(strip) at scale \(scale)")
            let inked = strip.reduce(0) { count, y in
                count + (0..<width).filter { brand(pixel($0, y)) }.count
            }
            #expect((inked > 0) == linked, "page \(page): \(inked) brand pixels under its button")
            // VoiceOver: the links there on the last page alone — never invisible ones before it
            // — each a link, not a button, as the portal's are; the button read on every page,
            // Continue then Sign up, so a walk that finds nothing can't pass for the links hidden.
            let elements = try voiceOver(in: window)
            let label = linked ? "Sign up" : "Continue"
            #expect(elements.contains { $0.accessibilityLabel == label }, "page \(page)")
            let titles = PolicyLinks.Page.allCases.map(\.title)
            let read = elements.filter { titles.contains($0.accessibilityLabel ?? "") }
            #expect(read.map(\.accessibilityLabel) == (linked ? titles : []), "page \(page)")
            for link in read {
                let traits = link.accessibilityTraits
                #expect(traits.contains(.link) && !traits.contains(.button), "\(traits)")
            }
        }
    }

    @Test(
        "Me's account, in D1's look: Sign out, a button VoiceOver reads by its name and finds dimmed while an Emergency Unlock is unsent, then whose sign-in it ends (#147); under the policy links, which never sit beside the red Delete account (C2b); and Delete account last of all (C4b)"
    )
    func meAccount() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        for (name, held) in [("me", false), ("meSignOutHeld", true)] {
            let window = UIWindow(windowScene: scene)
            // Tall enough for the whole of Me to lie on it, nothing scrolled away.
            window.frame = CGRect(x: 0, y: 0, width: scene.screen.bounds.width, height: 3000)
            window.rootViewController = UIHostingController(
                rootView: MeView(phone: Phone(fixture: try #require(PreviewFixtures.all[name]))))
            window.isHidden = false
            defer { window.isHidden = true }
            window.layoutIfNeeded()
            let elements = try voiceOver(in: window)
            let labels = elements.map { $0.accessibilityLabel ?? "" }
            let order = [
                "Terms", "Sign out", "You're signed in as ana.rodriguez@bali.test.", "Delete account",
            ].compactMap { labels.firstIndex(of: $0) }
            #expect(order.count == 4 && order == order.sorted(), "\(name): \(labels)")
            let signOut = try #require(elements.first { $0.accessibilityLabel == "Sign out" })
            #expect(signOut.accessibilityTraits.contains(.button), "\(name)")
            #expect(signOut.accessibilityTraits.contains(.notEnabled) == held, "\(name)")
        }
    }

    @Test(
        "A card's shadow is D1's shadow-1 at its edge alone (#139): drawn once, on the card's shape — never on each line, chip or button inside it, which History redrew line by line as it scrolled — so inside, the card is its own white, and under it, its shadow"
    )
    func cardShadow() throws {
        // A card 80 × 48 on the page, 10 from its edges: its line at 30–70 × 30–38, its bottom 58.
        let renderer = ImageRenderer(
            content: Card { Rectangle().fill(Theme.text).frame(width: 40, height: 8) }
                .frame(width: 80).padding(10).background(Theme.page))
        renderer.scale = 1
        let pixel = try pixels(of: try #require(renderer.uiImage))
        for y in 38...40 { #expect(pixel(50, y) == [255, 255, 255, 255], "\(y): \(pixel(50, y))") }
        let page = [0xF7, 0xF5, 0xF2]
        #expect(zip(pixel(50, 58), page).allSatisfy { $0 < $1 }, "\(pixel(50, 58))")
    }

    @Test(
        "History builds its days and cards as they come on screen (#139): a lazy stack, each card known by its own id (`HistoryTests.cardIds`), never every moment of a long history at once"
    )
    func historyLazy() throws {
        let history = HistoryView(phone: Phone(fixture: try #require(PreviewFixtures.all["history"])))
        #expect(String(reflecting: type(of: history.body)).contains("LazyVStack"))
    }

    /// `image` drawn at 1× and read as sRGB bytes — red, green, blue, alpha — at a point counted
    /// from the top left.
    private func pixels(of image: UIImage) throws -> (Int, Int) -> [Int] {
        let (width, height) = (Int(image.size.width), Int(image.size.height))
        let size = CGSize(width: width, height: height)
        let format = UIGraphicsImageRendererFormat()
        (format.scale, format.preferredRange) = (1, .standard)
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        let cgImage = try #require(drawn.cgImage)
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let read = bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(cgImage, in: CGRect(origin: .zero, size: size))
            return context != nil
        }
        #expect(read)
        return { x, y in (0..<4).map { Int(bytes[(y * width + x) * 4 + $0]) } }
    }
}

/// A class of the tests' own, to find their bundle by: it carries D1's tokens (`ios/project.yml`).
private final class TestsBundle {}

/// What VoiceOver reaches in `window`, in its order: the accessibility elements under it, those
/// hidden from it left out — SwiftUI's own, through its hosting view's elements. The app's
/// accessibility is turned on first, as VoiceOver turns it on: SwiftUI builds no accessibility
/// elements until it is, and a simulator that never had it on — CI's, made fresh for each run —
/// has it off (santa's round 1, C2b). Through libAccessibility, as Cash App's
/// AccessibilitySnapshot turns it on for its snapshots.
@MainActor
private func voiceOver(in window: UIWindow) throws -> [NSObject] {
    let library = try #require(dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW))
    let enable = try #require(dlsym(library, "_AXSApplicationAccessibilitySetEnabled"))
    unsafeBitCast(enable, to: (@convention(c) (Bool) -> Void).self)(true)
    func walk(_ object: NSObject) -> [NSObject] {
        if object.accessibilityElementsHidden { return [] }
        if object.isAccessibilityElement { return [object] }
        if let elements = object.accessibilityElements as? [NSObject] {
            return elements.flatMap(walk)
        }
        return ((object as? UIView)?.subviews ?? []).flatMap(walk)
    }
    return walk(window)
}

/// What VoiceOver reads on `screen`, at the phone's own size — each element's label, frame and
/// traits — once it reads `title`: a simulator's first walk can come before SwiftUI has built the
/// elements (CI's, made fresh for each run).
@MainActor
private func elements(of screen: some View, once title: String) async throws -> [(
    label: String?, frame: CGRect, traits: UIAccessibilityTraits
)] {
    let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
    let window = UIWindow(windowScene: scene)
    window.frame = scene.screen.bounds
    window.rootViewController = UIHostingController(rootView: screen)
    window.isHidden = false
    defer { window.isHidden = true }
    window.layoutIfNeeded()
    var read: [NSObject] = []
    try await until {
        read = (try? voiceOver(in: window)) ?? []
        return read.contains { $0.accessibilityLabel == title }
    }
    return read.map { ($0.accessibilityLabel, $0.accessibilityFrame, $0.accessibilityTraits) }
}

/// Every scroll view in `view`, itself among them, outermost first — of a pager's pages, only the
/// one it shows: the others it lays out lie off screen.
@MainActor
private func scrollViews(in view: UIView) -> [UIScrollView] {
    let scroll = view as? UIScrollView
    let shown = view.subviews.filter { subview in
        scroll.map { !$0.isPagingEnabled || subview.frame.minX == $0.contentOffset.x } ?? true
    }
    return [scroll].compactMap { $0 } + shown.flatMap(scrollViews(in:))
}

/// `window` as the screen would show it now: its pixels, drawn after any update due.
@MainActor
private func drawn(_ window: UIWindow) -> Data? {
    UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
        _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }.pngData()
}

/// Every text field in `view`, itself among them, outermost first.
@MainActor
private func textFields(in view: UIView) -> [UITextField] {
    [view as? UITextField].compactMap { $0 } + view.subviews.flatMap(textFields(in:))
}

/// Each of `scrolls` out to `window`'s edges, its bar not inset with its content and — but the
/// intro's paging, which holds pages, not content — its content inside the gutters.
@MainActor
private func expectEdges(of scrolls: [UIScrollView], in window: UIWindow, _ name: String) {
    for scroll in scrolls {
        let frame = scroll.convert(scroll.bounds, to: window)
        #expect(frame.minX == 0 && frame.maxX == window.bounds.maxX, "\(name): \(frame)")
        let bar = scroll.verticalScrollIndicatorInsets
        #expect(bar.left == 0 && bar.right == 0, "\(name): \(bar)")
        guard !scroll.isPagingEnabled else { continue }
        let inset = scroll.adjustedContentInset
        #expect(inset.left == Theme.gutter && inset.right == Theme.gutter, "\(name): \(inset)")
    }
}

/// A browser of the test's own for `Phone.signIn(through:)`: each page it was asked to open, with
/// the scheme it was to come back to, answered with `answer` — the student closing it, unless set
/// — or, where it `signsIn`, sent back to the redirect with a code for the page's own attempt.
@MainActor
private final class Pages {
    private(set) var opened: [(url: URL, scheme: String)] = []
    var answer = SignInError.cancelled
    var signsIn = false

    var browser: Phone.Browser {
        { url, scheme throws(SignInError) in
            self.opened.append((url, scheme))
            guard self.signsIn else { throw self.answer }
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first { $0.name == "state" }?.value ?? ""
            guard let back = URL(string: "bali://auth/callback?code=the-code&state=\(state)") else {
                throw .notOpened("no callback")
            }
            return back
        }
    }
}

/// Sign up pressed on `phone`, and its 13+ question answered 13 or older, through `pages`.
@MainActor
private func signUp(_ phone: Phone, through pages: Pages) async {
    await phone.signIn(.signUp, through: pages.browser)
    phone.birth = Birth(month: 1, year: 2000)
    await phone.answerAge(through: pages.browser)
}

/// A phone of the test's own over an engine `server` answers, and a sign-in over `keychain`: what
/// `Phone.start` wires between them and the screens, with no Keychain or network of the phone's.
@MainActor
private func standIn(_ server: any HTTPTransport, keychain: Keychain = Keychain(account: "ana"))
    throws -> (Phone, SyncEngine)
{
    struct Signed: TokenProvider {
        func accessToken() async -> String? { "token" }
    }
    let url = FileManager.default.temporaryDirectory.appending(
        path: "phone-\(UUID().uuidString).sqlite")
    let client = APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(), transport: server)
    let engine = SyncEngine(outbox: try Outbox(at: url), client: client)
    let cognito = Cognito(
        domain: URL(string: "https://bali.auth.test")!, clientId: "phone",
        redirectURI: URL(string: "bali://auth/callback")!)
    let signIn = SignIn(cognito: cognito, store: keychain, transport: server)
    return (Phone(signIn: signIn, engine: engine), engine)
}

/// A phone of the test's own as `Phone.start` makes it, over `server` and a sign-in over
/// `keychain`: its engine made over the sign-in, which gives Bali's API a token only once the
/// account signed in has passed the 13+ check in the phone's own defaults (C7's fallback).
@MainActor
private func gatedStandIn(_ server: any HTTPTransport, keychain: Keychain) throws -> (
    Phone, SyncEngine
) {
    let url = FileManager.default.temporaryDirectory.appending(
        path: "phone-\(UUID().uuidString).sqlite")
    let cognito = Cognito(
        domain: URL(string: "https://bali.auth.test")!, clientId: "phone",
        redirectURI: URL(string: "bali://auth/callback")!)
    let signIn = SignIn(
        cognito: cognito, store: keychain, transport: server,
        cleared: { AgeCheck.passed($0, in: .standard) })
    let engine = SyncEngine(
        outbox: try Outbox(at: url),
        client: APIClient(
            baseURL: URL(string: "https://api.bali.test")!, tokens: signIn, transport: server),
        refresh: { await signIn.refresh() })
    return (Phone(signIn: signIn, engine: engine), engine)
}

/// Cognito's token endpoint as a stand-in answers each sign-in: with the next of `accounts`'
/// tokens, the access token naming that account as Cognito's names its `sub`; anything else gets
/// no answer.
private actor Grants: HTTPTransport {
    private var accounts: [String]
    init(_ accounts: [String]) { self.accounts = accounts }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url, url.path() == "/oauth2/token", !accounts.isEmpty,
            let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: nil, headerFields: nil)
        else { throw URLError(.notConnectedToInternet) }
        let access = token(naming: accounts.removeFirst())
        return (Data(#"{"access_token":"\#(access)","refresh_token":"r"}"#.utf8), response)
    }
}

/// An access token as Cognito's names its account, by its `sub`, read unverified as the phone
/// reads it.
private func token(naming account: String) -> String {
    let claims = #"{"sub":"\#(account)","iat":1000000000,"exp":1000003600}"#
    let payload = Data(claims.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "h.\(payload).s"
}

/// The API and Cognito as a stand-in answers the gap's fallback, each request kept as its method
/// and path: `GET /v1/me` with a student in no class, an unlock in session `s` recorded, a tap
/// waiting for a Start, `DELETE /v1/me` with no account there, and Cognito's DeleteUser done;
/// anything else gets no answer.
private actor Recorder: HTTPTransport {
    private(set) var asked: [String] = []

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        let route = "\(request.httpMethod ?? "") \(url.path())"
        asked.append(route)
        let body: String
        switch route {
        case "GET /v1/me":
            body = #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[],"session":null}"#
        case "POST /v1/sessions/s/unlock":
            body = #"{"outcome":"recorded","recordedAs":"no_live_participation","state":null,"session":null,"reason":null}"#
        case "POST /v1/taps": body = #"{"outcome":"armed","session":null,"state":null}"#
        case "DELETE /v1/me": body = #"{"outcome":"already_deleted"}"#
        case "POST /" where url.host() == "cognito-idp.us-east-1.amazonaws.com": body = "{}"
        default: throw URLError(.notConnectedToInternet)
        }
        guard
            let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(body.utf8), response)
    }
}

/// The API as a stand-in answers a phone of the test's own: `GET /v1/me` once, with `me` — after
/// that, a read on its way for good, until the test ends — and history pages from `pages`, in
/// turn, the cursor each asked for kept; a page asked for with `hold` as its cursor answered only
/// once the test lets it go. And Cognito's token endpoint, with `grant` where it is given (#147);
/// and join codes' look-ups and joins with `tries`, in turn, each only once the test lets it go,
/// the path each asked at kept (Riders-2's review).
private actor StandIn: HTTPTransport {
    private var me: String?
    private var pages: [String]
    private(set) var befores: [String?] = []
    private let hold: String?
    private var held: [CheckedContinuation<Void, Never>] = []
    private let grant: String?
    private var tries: [(status: Int, body: String)]
    private(set) var asked: [String] = []

    init(
        me: String? = nil, pages: [String] = [], hold: String? = nil, grant: String? = nil,
        tries: [(status: Int, body: String)] = []
    ) {
        (self.me, self.pages, self.hold, self.grant, self.tries) = (me, pages, hold, grant, tries)
    }

    /// The request held longest, answered now.
    func letGo() {
        guard !held.isEmpty else { return }
        held.removeFirst().resume()
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        var (status, body) = (200, "")
        switch url.path() {
        case let path where !tries.isEmpty
            && (path.hasPrefix("/v1/join-codes/") || path == "/v1/enrollments"):
            (status, body) = tries.removeFirst()
            asked.append(path)
            await withCheckedContinuation { held.append($0) }
        case "/v1/me/history":
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            let before = query?.first { $0.name == "before" }?.value
            befores.append(before)
            guard !pages.isEmpty else { throw URLError(.notConnectedToInternet) }
            body = pages.removeFirst()
            if let hold, before == hold { await withCheckedContinuation { held.append($0) } }
        case "/v1/me" where me != nil:
            (body, me) = (me ?? "", nil)
        case "/v1/me":
            try await Task.sleep(for: .seconds(3600))
            throw URLError(.cancelled)
        case "/oauth2/token" where grant != nil:
            body = grant ?? ""
        default: throw URLError(.notConnectedToInternet)
        }
        guard
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(body.utf8), response)
    }
}

/// A phone of the test's own over `Reasons`, its engine running (#140): tapped into session "s"
/// and unlocked there, the unlock recorded with no reason, so Unlocked's picks are changes of it —
/// and the phone told so, as the engine's updates tell the app's.
@MainActor
private func unlockRecorded() async throws -> (Phone, SyncEngine, Reasons, Task<Void, Never>) {
    let server = Reasons()
    let (phone, engine) = try standIn(server)
    let running = Task { await engine.run() }
    try await engine.record(.tap(tagId: "tag"))
    try await until { await engine.state.queued.isEmpty }
    try await engine.record(.unlock(session: "s", reason: nil))
    try await until { await engine.state.recordedUnlock != nil }
    phone.synced(await engine.state)
    return (phone, engine, server, running)
}

/// The API as a stand-in answers Unlocked's reason (#140): a tap joins session "s", and a refocus
/// there is applied; an unlock there is recorded with the reason it carries, kept in `unlocks`;
/// and each change of an unlock's reason (`PATCH /v1/unlocks/{eventId}`, A20) is kept in
/// `changes`, its reason and event id, and waits for the test's `answer`. Anything else gets no
/// answer.
private actor Reasons: HTTPTransport {
    private(set) var unlocks: [String?] = []
    private(set) var changes: [(reason: String?, eventId: String?)] = []
    private var waiting: [CheckedContinuation<(status: Int, body: String)?, Never>] = []

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        struct Body: Decodable {
            let reason: String?
            let eventId: String?
        }
        guard let url = request.url else { throw URLError(.badURL) }
        let body = request.httpBody.flatMap { try? JSONDecoder().decode(Body.self, from: $0) }
        let session = #"{"id":"s","classId":"c","endsAt":"2099-01-01T00:00:00.000Z"}"#
        var answer: (status: Int, body: String)?
        switch (request.httpMethod ?? "", url.path()) {
        case ("POST", "/v1/taps"):
            answer = (200, #"{"outcome":"joined","session":\#(session),"state":"focused"}"#)
        case ("POST", "/v1/sessions/s/refocus"):
            answer = (200, #"{"outcome":"applied","state":"focused","session":\#(session)}"#)
        case ("POST", "/v1/sessions/s/unlock"):
            unlocks.append(body?.reason)
            let reason = body?.reason.map { #""\#($0)""# } ?? "null"
            answer = (
                200,
                #"{"outcome":"applied","recordedAs":null,"state":"unlocked","session":\#(session),"reason":\#(reason)}"#
            )
        case ("PATCH", let path) where path.hasPrefix("/v1/unlocks/"):
            changes.append((body?.reason, body?.eventId))
            answer = await withCheckedContinuation { waiting.append($0) }
        default: break
        }
        guard let answer,
            let response = HTTPURLResponse(
                url: url, statusCode: answer.status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.notConnectedToInternet) }
        return (Data(answer.body.utf8), response)
    }

    /// Answers the change waiting longest: `status` and `body`, or no answer at all when nil.
    func answer(_ status: Int?, _ body: String = "") {
        guard !waiting.isEmpty else {
            Issue.record("no change of the reason is waiting")
            return
        }
        waiting.removeFirst().resume(returning: status.map { ($0, body) })
    }
}

/// The API and Cognito as a stand-in answers Delete account (C4b): `GET /v1/me` with a student in
/// no class, `DELETE /v1/me` with `deleted` — held, where `holdsDeletion`, until the test lets it go
/// — and Cognito's DeleteUser from `deleteUser` in turn — a status, or nil for no answer at all —
/// counting each; anything else gets no answer.
private actor Deleter: HTTPTransport {
    private var deleteUser: [Int?]
    private let holdsDeletion: Bool
    private var held: CheckedContinuation<Void, Never>?
    private(set) var deletions = 0
    private(set) var deleteUsers = 0

    init(deleteUser: [Int?], holdsDeletion: Bool = false) {
        (self.deleteUser, self.holdsDeletion) = (deleteUser, holdsDeletion)
    }

    /// Whether a `DELETE /v1/me` waits for `letGo`.
    var holding: Bool { held != nil }

    /// The deletion held, answered now.
    func letGo() {
        held?.resume()
        held = nil
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        var (status, body) = (200, "")
        switch (request.httpMethod ?? "", url.host(), url.path()) {
        case ("GET", _, "/v1/me"):
            body = #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[],"session":null}"#
        case ("DELETE", _, "/v1/me"):
            deletions += 1
            if holdsDeletion { await withCheckedContinuation { held = $0 } }
            body = #"{"outcome":"deleted"}"#
        case ("POST", "cognito-idp.us-east-1.amazonaws.com"?, "/"):
            deleteUsers += 1
            guard !deleteUser.isEmpty, let answer = deleteUser.removeFirst() else {
                throw URLError(.notConnectedToInternet)
            }
            (status, body) = (answer, "{}")
        default: throw URLError(.notConnectedToInternet)
        }
        guard
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(body.utf8), response)
    }
}

/// The API as a stand-in answers Your name: `GET /v1/me` with a new student in no class, named as
/// the last name set — none at first — counting each read; and each `PATCH /v1/me` from `answers`,
/// in turn — a status and body, or no answer at all when nil — keeping what it carried, a 200 the
/// name set as A8 answers it; and Cognito's token endpoint with a sign-in's tokens. Anything else
/// gets no answer.
private actor Names: HTTPTransport {
    private var answers: [(status: Int, body: String)?]
    private var name: String?
    private(set) var renames: [UpdateMeRequest] = []
    private(set) var reads = 0

    init(_ answers: [(status: Int, body: String)?]) { self.answers = answers }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        /// The student, named as the server holds them now.
        var user: String {
            let named = name.map { #""\#($0)""# } ?? "null"
            return #"{"id":"ana","role":"student","displayName":\#(named)}"#
        }
        var (status, body) = (200, "")
        switch (request.httpMethod ?? "", url.path()) {
        case ("GET", "/v1/me"):
            reads += 1
            body = #"{"user":\#(user),"classes":[],"session":null}"#
        case ("PATCH", "/v1/me"):
            let sent = try JSONDecoder().decode(UpdateMeRequest.self, from: request.httpBody ?? Data())
            renames.append(sent)
            guard !answers.isEmpty, let answer = answers.removeFirst() else {
                throw URLError(.notConnectedToInternet)
            }
            (status, body) = answer
            if status == 200 {
                name = sent.displayName
                body = #"{"outcome":"applied","user":\#(user)}"#
            }
        case ("POST", "/oauth2/token"):
            body = #"{"access_token":"\#(token(naming: "ana"))","refresh_token":"r1"}"#
        default: throw URLError(.notConnectedToInternet)
        }
        guard
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(body.utf8), response)
    }
}

/// A page of history as `GET /v1/me/history` answers it: a tap for each of `ids`, then `next`.
private func page(_ ids: [String], next: String?) -> String {
    let events = ids.map {
        #"{"eventId":"\#($0)","type":"tap_in","occurredAt":"2026-09-01T13:00:00Z","class":{"id":"p3","name":"Period 3 — Algebra II"},"teacher":{"displayName":"Ms. Rivera"},"session":null,"reason":null,"recordedAs":null,"countedIn":null}"#
    }
    let cursor = next.map { #""\#($0)""# } ?? "null"
    return #"{"events":[\#(events.joined(separator: ","))],"nextBefore":\#(cursor)}"#
}

/// The Keychain's stand-in: the tokens a sign-in of `account` keeps — its access token's payload
/// naming it, and the `email` its ID token named (#147), if any; `scoped`, with the scope and the
/// pool Cognito's DeleteUser needs (C4) — or none; one a test can lock, as a locked phone's is.
private final class Keychain: TokenStore, @unchecked Sendable {
    struct Locked: Error {}
    private let lock = NSLock()
    private var saved: Data?
    private var isLocked = false

    init(account: String?, email: String? = nil, scoped: Bool = false) {
        saved = account.map { account in
            let scope =
                scoped
                ? #","scope":"openid email profile aws.cognito.signin.user.admin","iss":"https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YTloqilwT""#
                : ""
            let claims = #"{"sub":"\#(account)","iat":1000000000,"exp":1000003600\#(scope)}"#
            let payload = Data(claims.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            let named = email.map { #","email":"\#($0)""# } ?? ""
            return Data(#"{"access":"h.\#(payload).s","refresh":"r","until":1000000000\#(named)}"#.utf8)
        }
    }

    var locked: Bool {
        get { lock.withLock { isLocked } }
        set { lock.withLock { isLocked = newValue } }
    }
    var empty: Bool { lock.withLock { saved == nil } }

    func load() throws -> Data? { try lock.withLock { if isLocked { throw Locked() } else { saved } } }
    func save(_ tokens: Data) throws { try change(tokens) }
    func clear() throws { try change(nil) }
    private func change(_ data: Data?) throws {
        try lock.withLock { if isLocked { throw Locked() } else { saved = data } }
    }
}

/// Waits, in real time, for `condition`; never true within a minute fails the test.
@MainActor
private func until(_ condition: () async -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(60)
    while ContinuousClock.now < deadline {
        if await condition() { return }
        try await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("never came true")
}

/// The API as a stand-in answers it: every request with `status` and `body`, signed in.
private func client(_ status: Int, _ body: String) -> APIClient {
    struct Answering: HTTPTransport {
        let status: Int
        let body: String
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            guard let url = request.url,
                let response = HTTPURLResponse(
                    url: url, statusCode: status, httpVersion: nil, headerFields: nil)
            else { throw URLError(.badURL) }
            return (Data(body.utf8), response)
        }
    }
    struct Signed: TokenProvider {
        func accessToken() async -> String? { "token" }
    }
    return APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(),
        transport: Answering(status: status, body: body))
}

/// What a screen's switch shows (`Switching`): a code field, as Join's, or not.
@MainActor @Observable private final class Shown { var field = true }

/// Two screens switched as `RootView` switches its own: a code field, as Join's, while `shown`
/// says, else a line of text — under `transition`.
private struct Switching: View {
    let shown: Shown
    let transition: AnyTransition

    var body: some View {
        ZStack {
            Group {
                if shown.field {
                    TextField("Class code", text: .constant("KWX49Q")).frame(width: 200, height: 64)
                } else {
                    Text("Home")
                }
            }
            .transition(transition)
        }
    }
}
