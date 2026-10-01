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

@MainActor
@Suite("The app")
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
        "A Debug launch names a fixture — `-bali-screen <name>` — rendered in place of the live phone, frozen: never started, and an ask for the permission on it changes nothing (C1b), nor a join code's look-up or a join (C2b), nor an Emergency Unlock (C4), a reason or Back to focus (C5a), nor a History read (C6a), nor a leave (C6c) — which say the phone has not started, never nothing (#106's review); Session over's Done still closes it (C5b). A name not known, or none, is the live app; and every fixture shows the screen it is named for (C1a), then a state of it"
    )
    func fixtures() async throws {
        #expect(PreviewFixtures.chosen(from: ["Bali"]) == nil)
        #expect(PreviewFixtures.chosen(from: ["Bali", "-bali-screen"]) == nil)
        #expect(PreviewFixtures.chosen(from: ["Bali", "-bali-screen", "nope"]) == nil)
        let chosen = try #require(PreviewFixtures.chosen(from: ["Bali", "-bali-screen", "signIn"]))
        let phone = Phone(fixture: chosen)
        #expect(phone.screen == .signIn)
        await phone.start()
        #expect(phone.engine == nil && phone.screen == .signIn)
        for (name, state) in PreviewFixtures.all {
            let screen = String(describing: Phone(fixture: state).screen).prefix { $0 != "(" }
            #expect(name.hasPrefix(screen), "\(name): \(screen)")
        }
        let failed = Phone(fixture: try #require(PreviewFixtures.all["screenTimeError"]))
        #expect(failed.screen == .screenTime && failed.askFailed?.words(.notDetermined) != nil)
        await failed.askScreenTime()
        #expect(failed.askFailed?.words(.notDetermined) != nil)
        let previewing = Phone(fixture: try #require(PreviewFixtures.all["joinPreview"]))
        #expect(previewing.joining.preview?.teacher.displayName == "Ms. Rivera")
        await previewing.join()
        #expect(previewing.joining.preview != nil && previewing.hasClasses == false)
        #expect(previewing.joining.failure == Joining.notStarted && !previewing.joining.busy)
        let refused = Phone(fixture: try #require(PreviewFixtures.all["joinError"]))
        #expect(refused.joining.preview == nil && refused.joining.code == "KWX49Q")
        await refused.lookUp()
        #expect(refused.joining.failure == Joining.notStarted && refused.joining.preview == nil)
        #expect(Phone(fixture: try #require(PreviewFixtures.all["home"])).hasClasses == true)
        let fromHome = Phone(fixture: try #require(PreviewFixtures.all["joinFromHome"]))
        #expect(fromHome.opened == [.join])
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
        #expect(out.screen == .focus && said.stalled != nil && said.claim == .paused)
        // Unlocked (C5a): each fixture's reason card and way back, and the bell the router chooses
        // again at; a frozen phone's reason and Back to focus say it has not started.
        let unlockedCases: [(String, UnlockedWords.Picker?, Bool)] = [
            ("unlocked", .open, false), ("unlockedReason", .given(.bathroom), false),
            ("unlockedRecorded", nil, false), ("unlockedRetap", nil, true),
        ]
        for (name, picker, retap) in unlockedCases {
            let words = UnlockedWords(try #require(PreviewFixtures.all[name]?.sync))
            #expect(words?.picker == picker && (words?.retap != nil) == retap, "\(name)")
        }
        let unlocked = Phone(fixture: try #require(PreviewFixtures.all["unlocked"]))
        #expect(await unlocked.explain(.bathroom) == Joining.notStarted)
        #expect(await unlocked.backToFocus() == Joining.notStarted)
        let home = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        #expect(unlocked.bell != nil && home.bell == nil)
        // History (C6a): D1's days and cards, each state's fixture its own; a frozen phone's read
        // says it has not started.
        let history = try #require(PreviewFixtures.all["history"]?.history)
        let days = history.days(now: Date())
        #expect(days.map(\.title) == ["Today", "Yesterday"] && history.nextBefore != nil)
        #expect(days.flatMap(\.cards).map(\.moments.count) == [4, 2, 1])
        #expect(try #require(PreviewFixtures.all["historyEmpty"]?.history).read)
        #expect(try #require(PreviewFixtures.all["historyError"]?.history).failure != nil)
        #expect(try #require(PreviewFixtures.all["historyLoading"]?.history).busy)
        let error = Phone(fixture: try #require(PreviewFixtures.all["historyError"]))
        await error.readHistory()
        #expect(error.history.failure == Joining.notStarted && !error.history.read)
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
        let over = Phone(fixture: try #require(PreviewFixtures.all["sessionOver"]))
        #expect(over.sync?.sessionOverWords(over.protection)?.hasSuffix("All your apps are back.") == true)
        over.closeSessionOver()
        #expect(over.screen == .home)
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
        #expect(seen.screen == .history && seen.tabbed)
        var read = try #require(seen.sync)
        read.standing = .out
        seen.synced(read)
        #expect(seen.screen == .history && seen.tabbed)
        // Join opened before the bell (over a class's Home this build knows no state of) is left
        // behind: History, never the Join the router would show in its place (santa's round 1).
        let opened = Phone(fixture: try #require(PreviewFixtures.all["sessionOver"]))
        opened.open(.join)
        opened.joining.type("KWX")
        opened.seeHistory()
        #expect(opened.screen == .history && opened.opened.isEmpty && opened.joining == Joining())
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
        #expect(held.signOutFailed == nil && held.screen == .me)
        #expect(me.sync.flatMap(SignOutWords.held) == nil)
        let notOut = Phone(fixture: try #require(PreviewFixtures.all["meSignOutFailed"]))
        #expect(notOut.signOutFailed == SignOutWords.failed)
        // Me over a standing not read, Screen Time taken back: its row reads Off (Riders-2's santa).
        let off = Phone(fixture: try #require(PreviewFixtures.all["meScreenTimeOff"]))
        #expect(off.screen == .me && off.tabbed && off.protection?.permissionOff == true)
        // Leave (C6c): Period 3's question; the leave under way; the server's no said under it;
        // and Leave held while the phone stands in Period 3's lesson, never out of it. A frozen
        // phone's leave says it has not started, the question kept to try again; a change of who
        // is signed in takes it away.
        let asked = Phone(fixture: try #require(PreviewFixtures.all["meLeaveAsk"]))
        let period3 = try #require(asked.sync?.me?.classes.first)
        #expect(asked.leaving.asking == period3 && period3.enrollmentId == "e3")
        #expect(!asked.leaving.busy && asked.screen == .me && asked.tabbed)
        await asked.leave()
        #expect(asked.leaving.failure == Joining.notStarted && asked.leaving.asking == period3)
        asked.signed(in: false)
        #expect(asked.leaving == Leaving())
        #expect(try #require(PreviewFixtures.all["meLeaving"]).leaving.busy)
        let refusedLeave = try #require(PreviewFixtures.all["meLeaveError"]).leaving
        #expect(refusedLeave.failure == Leaving.inSession(period3) && !refusedLeave.busy)
        let inLesson = Phone(fixture: try #require(PreviewFixtures.all["meLeaveInSession"]))
        #expect(inLesson.screen == .me && inLesson.tabbed)
        let lesson = try #require(inLesson.sync)
        #expect(Leaving.held(period3, lesson, now: Date()) == Leaving.inSession(period3))
        #expect(Leaving.held(period3, try #require(me.sync), now: Date()) == nil)
    }

    @Test(
        "D1's tab bar (C6a) shows wherever the router honours a tab — its own Home, History and Me, but while Me's name is edited (C6b) — never over Home opened over Waiting, the last run's shields' Home, Waiting, Join or a session's screens; a tab chosen shows its screen, History read anew each time the student comes to it and as it was when chosen again while it shows (santa's round 1); the tab is Home again once the screens opened close — the standing changed — or who is signed in changes, the history read gone with it; a read that keeps them keeps the tab; Me's Join a class has its way back to Me (C6b)"
    )
    func tabs() async throws {
        let (homes, editing) = (
            ["home", "homeLoading", "homeError", "homeUnread", "homeRefused"],
            ["meEditing", "meNameError"]
        )
        for (name, state) in PreviewFixtures.all {
            let me = name.hasPrefix("me") && !editing.contains(name)
            let tabbed = homes.contains(name) || name.hasPrefix("history") || me
            #expect(Phone(fixture: state).tabbed == tabbed, "\(name)")
        }
        let phone = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        phone.select(.me)
        #expect(phone.screen == .me)
        phone.select(.history)
        #expect(phone.screen == .history && phone.history == History())
        await phone.readHistory()
        #expect(phone.history.failure == Joining.notStarted)
        // Chosen again while it shows: as it was — its screen does not appear anew, so a history
        // forgotten now would say it is reading, forever, with nothing reading (santa's round 1).
        phone.select(.history)
        #expect(phone.history.failure == Joining.notStarted)
        phone.select(.me)
        phone.select(.history)
        #expect(phone.history == History())
        var state = try #require(phone.sync)
        state.heardAt = Date()
        phone.synced(state)
        #expect(phone.screen == .history)
        state.standing = .waiting
        phone.synced(state)
        #expect(phone.tab == .home && phone.screen == .waiting && !phone.tabbed)
        state.standing = .out
        phone.synced(state)
        #expect(phone.screen == .home && phone.tabbed)
        let signedOut = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        signedOut.signed(in: false)
        #expect(signedOut.screen == .signIn && signedOut.history == History())
        signedOut.signed(in: true)
        #expect(signedOut.screen == .home && signedOut.tab == .home)
        // Me's Join a class opens Join over it — no tab bar there — and Back returns to Me.
        let fromMe = Phone(fixture: try #require(PreviewFixtures.all["me"]))
        fromMe.open(.join)
        #expect(fromMe.screen == .join && fromMe.canGoBack && !fromMe.tabbed)
        fromMe.back()
        #expect(fromMe.screen == .me && fromMe.tabbed)
        // Me's name edited: no tab bar, Save and Cancel the ways on; cancelled, the bar is back.
        let named = Phone(fixture: try #require(PreviewFixtures.all["meEditing"]))
        #expect(named.screen == .me && !named.tabbed)
        named.naming = Naming()
        #expect(named.screen == .me && named.tabbed)
        // Mid-edit, a change of standing sends the tab Home (santa's round 1): Home keeps its bar,
        // and Me, chosen again, shows the edit as it was, without one.
        let away = Phone(fixture: try #require(PreviewFixtures.all["meEditing"]))
        var moved = try #require(away.sync)
        moved.standing = .waiting
        away.synced(moved)
        moved.standing = .out
        away.synced(moved)
        #expect(away.screen == .home && away.tabbed && away.naming.editing)
        away.select(.me)
        #expect(away.screen == .me && !away.tabbed && away.naming.name == "Ana R.")
    }

    @Test(
        "A History read's answer (santa's round 1): kept while it is the latest read — a page after the first added after it, its cursor next — and dropped once the student has left History or signed out, so no student is shown another's; a cursor the history does not hold reads again from the top, which a frozen phone says it cannot"
    )
    func historyRead() async throws {
        let older =
            #"{"events":[{"eventId":"m0","type":"tap_in","occurredAt":"2026-09-01T13:00:00Z","class":{"id":"p3","name":"Period 3 — Algebra II"},"teacher":{"displayName":"Ms. Rivera"},"session":null,"reason":null,"recordedAs":null,"countedIn":null}],"nextBefore":null}"#
        let phone = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        let shown = phone.history.events.count
        await phone.historyRead(await client(200, older).history(), for: phone.reads)
        #expect(phone.history.events.count == shown + 1 && phone.history.nextBefore == nil)
        let leaves: [@MainActor (Phone) -> Void] = [{ $0.select(.home) }, { $0.signed(in: false) }]
        for leave in leaves {
            let left = Phone(fixture: try #require(PreviewFixtures.all["history"]))
            let read = left.reads
            leave(left)
            await left.historyRead(await client(200, older).history(), for: read)
            #expect(left.history == History())
        }
        // Show earlier's cursor, which the history does not hold: read again from the top.
        let cursor = #"{"error":{"code":"bad_input","reason":"unknown_cursor","message":"no"}}"#
        let paged = Phone(fixture: try #require(PreviewFixtures.all["history"]))
        await paged.historyRead(await client(400, cursor).history(before: "m0"), for: paged.reads)
        #expect(paged.history.failure == Joining.notStarted && !paged.history.read)
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
        // Sign out is Me's, and the router's own Join's — a student in no class reaches nothing
        // else, the wrong account's way out (the riders) — held there as on Me; never on a Join
        // opened over Home or Me, whose way back reaches Me, nor elsewhere.
        for (name, offers) in [
            ("me", true), ("join", true), ("joinSignOutHeld", true), ("joinFromHome", false),
            ("home", false), ("focus", false), ("signIn", false),
        ] {
            let phone = Phone(fixture: try #require(PreviewFixtures.all[name]))
            #expect(phone.offersSignOut == offers, "\(name)")
        }
        let joinHeld = Phone(fixture: try #require(PreviewFixtures.all["joinSignOutHeld"]))
        #expect(joinHeld.screen == .join && joinHeld.sync.flatMap(SignOutWords.held) != nil)
        await joinHeld.signOut()
        #expect(joinHeld.signOutFailed == nil)
        // Signed out from Join: the code typed goes with who typed it.
        let typed = Phone(fixture: try #require(PreviewFixtures.all["joinError"]))
        typed.signed(in: false)
        #expect(typed.joining == Joining())
    }

    @Test(
        "History's pages through the phone's own engine (C6a-2's review): Show earlier asks for the page after those read — the cursor the last one named — and adds it, the history kept; a read from the top asks for none, and starts over; History gone from the screen, by any way, is forgotten"
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
        phone.forgetHistory()
        #expect(phone.history == History())
    }

    @Test(
        "Sign out through the phone's own sign-in and outbox (C6b-1's review): an Emergency Unlock the outbox file holds unsent, said and nothing tried; a Keychain that cannot forget the tokens now, said; forgotten, nothing said and nobody signed in — each try's words the last one's no more"
    )
    func signOutWiring() async throws {
        let (held, engine) = try standIn(StandIn())
        try await engine.record(.unlock(session: "s", reason: nil))
        await held.signOut()
        #expect(held.signOutFailed == SignOutWords.unsent)
        // Said where the engine's queue shows no unlock but the file holds one: an unrelated
        // publish changes nothing; once a hold the queue showed ends, it goes (santa, 1 and 2).
        held.synced(SyncState())
        #expect(held.signOutFailed == SignOutWords.unsent)
        held.synced(await engine.state)
        held.synced(SyncState())
        #expect(held.signOutFailed == nil)
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
        "Home's Join a class opens Join over it, and Back closes it — the code typed there gone; Waiting's Back to home opens Home over it, and Join over that Home in turn, Back returning to each (santa's round 1: Join fell back to Waiting there); all end once where the phone stands changes, a Join among them starting over (C3). A frozen phone's Tap in says it has not started, never nothing"
    )
    func opened() async throws {
        let home = Phone(fixture: try #require(PreviewFixtures.all["home"]))
        home.open(.join)
        home.joining.type("KWX")
        #expect(home.screen == .join)
        home.back()
        #expect(home.screen == .home && home.joining.code.isEmpty)
        let waiting = Phone(fixture: try #require(PreviewFixtures.all["waiting"]))
        let state = try #require(waiting.sync)
        waiting.open(.home)
        waiting.synced(state)
        #expect(waiting.screen == .home)
        waiting.open(.join)
        #expect(waiting.screen == .join)
        waiting.back()
        #expect(waiting.screen == .home)
        waiting.back()
        #expect(waiting.screen == .waiting)
        waiting.open(.home)
        waiting.open(.join)
        waiting.joining.type("KWX")
        var out = state
        out.standing = .out
        waiting.synced(out)
        waiting.synced(state)
        #expect(waiting.opened.isEmpty && waiting.screen == .waiting)
        #expect(waiting.joining.code.isEmpty)
        // No classes: waiting, Home and Join over it stay — an armed tap needs no enrollment;
        // out, Join is the router's own, keeping what was typed there (santa's round 2).
        let none = try BaliJSON.makeDecoder().decode(
            MeResponse.self,
            from: Data(#"{"user":{"id":"u","role":"student","displayName":null},"classes":[],"session":null}"#.utf8))
        var armed = state
        armed.me = none
        waiting.open(.home)
        waiting.open(.join)
        waiting.synced(armed)
        #expect(waiting.opened == [.home, .join] && waiting.screen == .join)
        let reading = Phone(fixture: try #require(PreviewFixtures.all["homeLoading"]))
        reading.open(.join)
        reading.joining.type("KWX")
        var noClasses = try #require(reading.sync)
        noClasses.me = none
        reading.synced(noClasses)
        #expect(reading.opened.isEmpty && reading.screen == .join && reading.joining.code == "KWX")
        await home.tapIn()
        #expect(home.tapFailed == Joining.notStarted && !home.scanning)
    }

    @Test(
        "Home opened over Waiting has a way back to it while the phone waits (#114's review), as Join opened over Home has; the router's own Home and Waiting have none, nor one the router shows over it"
    )
    func wayBack() throws {
        let waiting = Phone(fixture: try #require(PreviewFixtures.all["waiting"]))
        #expect(!waiting.canGoBack)
        waiting.open(.home)
        #expect(waiting.screen == .home && waiting.canGoBack)
        waiting.back()
        #expect(waiting.screen == .waiting && !waiting.canGoBack)
        #expect(!Phone(fixture: try #require(PreviewFixtures.all["home"])).canGoBack)
        #expect(Phone(fixture: try #require(PreviewFixtures.all["joinFromHome"])).canGoBack)
        // Opened over Home, but the shields on: focus, which has no way back.
        let focused = Phone(fixture: try #require(PreviewFixtures.all["focus"]))
        focused.open(.join)
        #expect(focused.screen == .focus && !focused.canGoBack)
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
        #expect(phone.screen == .join)
        let none = #"{"error":{"code":"not_found","reason":"class_not_found","message":"none"}}"#
        phone.joined(await answer(404, none))
        #expect(phone.screen == .join && phone.opened == [.join])
        #expect(phone.joining.failure == Joining.words(.status(404), .classNotFound))
        let joined = #"{"outcome":"joined","enrollmentId":"e","class":{"id":"c","name":"Class c"}}"#
        phone.joined(await answer(200, joined))
        #expect(phone.screen == .home && phone.opened.isEmpty && phone.joining == Joining())
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
        "The permission once read approved is kept in the phone's own defaults (C1b) — set at a read of approved, cleared once the check judges the permission off (denied, or not determined for a check-in interval), left at a read not determined for a moment — and a fresh Phone reads it back; with it, not determined routes as approved. The flag as it was before is put back after"
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
        #expect(!phone.everApproved && phone.screen == .screenTime)
        phone.remember(read(.notDetermined))
        #expect(!phone.everApproved && !Phone().everApproved)
        phone.remember(read(.approved))
        #expect(phone.everApproved && Phone().everApproved && phone.screen == .home)
        phone.remember(read(.notDetermined))
        #expect(phone.everApproved && phone.screen == .home)
        // Not determined for a check-in interval: never granted, or a grant that did not come back
        // with a restored backup, which restores these defaults.
        phone.remember(read(.notDetermined, off: true))
        #expect(!phone.everApproved && !Phone().everApproved && phone.screen == .screenTime)
        phone.remember(read(.approved))
        phone.remember(read(.denied, off: true))
        #expect(!phone.everApproved && !Phone().everApproved && phone.screen == .screenTime)
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
        "The intro seen is kept in the phone's own defaults: a fresh Phone reads it back (C1a); the flag as it was before is put back after"
    )
    func introSeen() {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.introSeenKey)
        defer { defaults.set(before, forKey: Phone.introSeenKey) }
        defaults.removeObject(forKey: Phone.introSeenKey)
        let phone = Phone()
        #expect(!phone.introSeen && phone.screen == .intro)
        phone.sawIntro()
        #expect(phone.introSeen && Phone().introSeen)
        #expect(phone.screen == .starting)
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
        "Every screen's scroll view reaches the phone's edges — its scroll bar at the screen's edge, never over the cards (the phone's check, 2026-09-30) — with its content inside D1's 24-pt gutters, as the rest of the screen is: each fixture's screen at the phone's own size, the intro's pages and Me's What your teacher sees among them"
    )
    func scrollEdges() throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let screens =
            PreviewFixtures.all.map { ($0.key, AnyView(RootView(phone: Phone(fixture: $0.value)))) }
            + [("consentSheet", AnyView(ConsentSheet()))]
        for (name, screen) in screens {
            let window = UIWindow(windowScene: scene)
            window.frame = scene.screen.bounds
            window.rootViewController = UIHostingController(rootView: screen)
            window.isHidden = false
            defer { window.isHidden = true }
            window.layoutIfNeeded()
            let scrolls = scrollViews(in: window)
            // Every screen scrolls once its text outgrows it, but the starting mark and Storage.
            #expect(scrolls.isEmpty == ["starting", "storage"].contains(name), "\(name)")
            for scroll in scrolls {
                let frame = scroll.convert(scroll.bounds, to: window)
                #expect(frame.minX == 0 && frame.maxX == window.bounds.maxX, "\(name): \(frame)")
                // The bar drawn at the scroll view's own edge, not inset with the content.
                let bar = scroll.verticalScrollIndicatorInsets
                #expect(bar.left == 0 && bar.right == 0, "\(name): \(bar)")
                // The intro's paging holds pages, not content: each page's scroll view is checked.
                guard !scroll.isPagingEnabled else { continue }
                let inset = scroll.adjustedContentInset
                #expect(inset.left == Theme.gutter && inset.right == Theme.gutter, "\(name): \(inset)")
            }
        }
    }

    /// `mark`, 64 × 64, drawn at 1× and read as sRGB bytes — red, green, blue, alpha — at a point
    /// counted from the top left.
    private func pixels(of mark: UIImage) throws -> (Int, Int) -> [Int] {
        let size = CGSize(width: 64, height: 64)
        let format = UIGraphicsImageRendererFormat()
        (format.scale, format.preferredRange) = (1, .standard)
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            mark.draw(in: CGRect(origin: .zero, size: size))
        }
        let image = try #require(drawn.cgImage)
        var bytes = [UInt8](repeating: 0, count: 64 * 64 * 4)
        let read = bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: 64, height: 64, bitsPerComponent: 8,
                bytesPerRow: 64 * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(image, in: CGRect(origin: .zero, size: size))
            return context != nil
        }
        #expect(read)
        return { x, y in (0..<4).map { Int(bytes[(y * 64 + x) * 4 + $0]) } }
    }
}

/// A class of the tests' own, to find their bundle by: it carries D1's tokens (`ios/project.yml`).
private final class TestsBundle {}

/// Every scroll view in `view`, itself among them, outermost first.
@MainActor
private func scrollViews(in view: UIView) -> [UIScrollView] {
    [view as? UIScrollView].compactMap { $0 } + view.subviews.flatMap(scrollViews(in:))
}

/// A phone of the test's own over an engine `server` answers, and a sign-in over `keychain`: what
/// `Phone.start` wires between them and the screens, with no Keychain or network of the phone's.
@MainActor
private func standIn(_ server: StandIn, keychain: Keychain = Keychain(account: "ana")) throws
    -> (Phone, SyncEngine)
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

/// The API as a stand-in answers a phone of the test's own: `GET /v1/me` once, with `me` — after
/// that, a read on its way for good, until the test ends — and history pages from `pages`, in
/// turn, the cursor each asked for kept.
private actor StandIn: HTTPTransport {
    private var me: String?
    private var pages: [String]
    private(set) var befores: [String?] = []

    init(me: String? = nil, pages: [String] = []) { (self.me, self.pages) = (me, pages) }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        var body: String
        switch url.path() {
        case "/v1/me/history":
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            befores.append(query?.first { $0.name == "before" }?.value)
            guard !pages.isEmpty else { throw URLError(.notConnectedToInternet) }
            body = pages.removeFirst()
        case "/v1/me" where me != nil:
            (body, me) = (me ?? "", nil)
        case "/v1/me":
            try await Task.sleep(for: .seconds(3600))
            throw URLError(.cancelled)
        default: throw URLError(.notConnectedToInternet)
        }
        guard
            let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: nil, headerFields: nil)
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
/// naming it — or none; one a test can lock, as a locked phone's is.
private final class Keychain: TokenStore, @unchecked Sendable {
    struct Locked: Error {}
    private let lock = NSLock()
    private var saved: Data?
    private var isLocked = false

    init(account: String?) {
        saved = account.map { account in
            let claims = #"{"sub":"\#(account)","iat":1000000000,"exp":1000003600}"#
            let payload = Data(claims.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            return Data(#"{"access":"h.\#(payload).s","refresh":"r","until":1000000000}"#.utf8)
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
