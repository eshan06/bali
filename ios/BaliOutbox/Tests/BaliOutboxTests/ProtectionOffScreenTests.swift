import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// What rule 3's check found: `permission` — judged off where denied, or where a read not
/// determined is `lasting` past B5a-2's grace — the shields on or off, and a protection off it
/// found but could not queue (`unreported`).
private func checked(
    _ permission: Permission, lasting: Bool = false, shielded: Bool = false,
    unreported: Bool = false
) -> Protection {
    var protection = Protection()
    (protection.checked, protection.permission, protection.shielded) = (true, permission, shielded)
    (protection.permissionOff, protection.unreported) =
        (permission == .denied || lasting, unreported)
    return protection
}

/// The Protection off screen's words for `state`, on a US phone in New York.
private func words(_ state: SyncState, _ protection: Protection = checked(.denied))
    -> ProtectionOffWords?
{
    ProtectionOffWords(state, protection, time: newYork)
}

/// A Back to focus the server refused in session "s", for `reason`.
private func refused(_ reason: ApiErrorReason?, in session: String = "s") -> Refusal {
    Refusal(change: .refocus(session: session), status: 409, reason: reason, message: nil)
}

let offWords =
    "Bali couldn't take you back to focus, because Screen Time was off during this class. Tap your teacher's block to go back to focus."
let refusedWords =
    "Bali couldn't take you back to focus. Tap your teacher's block to go back, or ask your teacher."

@Suite("What the Protection off and Session over screens say (C5b)")
struct ProtectionOffScreenTests {
    @Test(
        "D1's Protection off: the class and its teacher, Screen Time off, that the teacher sees it — will see, while the report is on the phone or not made yet — and how back; once Screen Time reads on again, the re-tap is the way on. Never Back to focus, which a refocus out of protection off would be refused (A2)"
    )
    func protectionOffWords() throws {
        let off = try #require(words(try synced(.inSession(bell1042, .protectionOff))))
        #expect(off.title == "Period 3 — Algebra II")
        #expect(plain(off.subtitle) == "with Ms. Rivera · ends 10:42 AM")
        #expect(off.headline == "Screen Time is off" && off.way == .settings && off.refused == nil)
        #expect(
            off.body
                == "Bali can't keep you focused without it, so your teacher sees 'Screen Time off'.")
        let (outbox, _) = try makeOutbox()
        try record(outbox, .protectionOff(session: "s"))
        let sending = try synced(.inSession(bell1042, .protectionOff), queued: try outbox.records())
        #expect(
            words(sending)?.body
                == "Bali can't keep you focused without it, so your teacher will see 'Screen Time off'.")
        #expect(words(try synced(.inSession(bell1042, .unlocked)))?.body == words(sending)?.body)
        let back = try #require(
            words(try synced(.inSession(bell1042, .protectionOff)), checked(.approved)))
        #expect(back.headline == "Screen Time is back on" && back.way == .retap)
        #expect(
            back.body
                == "Tap your teacher's block again to rejoin class. Until then, your teacher sees 'Screen Time off'."
        )
        #expect(words(try synced(.inSession(bell1042, .protectionOff), me: false))?.title == "Your class")
        for standing in [Standing.out, .waiting, .unread] {
            #expect(words(try synced(standing)) == nil, "\(standing)")
        }
        #expect(!(try sourceCode("Bali/UI/ProtectionOffView.swift")).contains("Back to focus"))
    }

    @Test(
        "The way on follows what rule 3's check verified (santa's review): denied, Settings; not determined past B5a-2's grace — never given on this phone, or lost with a restored backup, where Settings lists no Bali — iOS's own prompt; on again, the re-tap; a read not determined within the grace claims nothing yet and offers nothing (C4's 'Checking Screen Time…'), never 'off' over a grant a relaunch has not read back yet"
    )
    func way() throws {
        let off = try synced(.inSession(bell1042, .protectionOff))
        #expect(words(off, checked(.denied))?.way == .settings)
        let never = try #require(words(off, checked(.notDetermined, lasting: true)))
        #expect(never.way == .ask && never.headline == "Screen Time is off")
        #expect(words(off, checked(.approved))?.way == .retap)
        let checking = try #require(words(off, checked(.notDetermined)))
        #expect(checking.way == .checking && checking.headline == "Checking Screen Time…")
        #expect(
            checking.body
                == "Your teacher sees 'Screen Time off' until you tap your teacher's block again.")
    }

    @Test(
        "Protection off the check found but could not save is said so — never that the teacher sees or will see it, which nothing on the phone yet makes true (santa's review; rule 5)"
    )
    func unreported() throws {
        let unsaved = try #require(
            words(try synced(.inSession(bell1042, .unlocked)), checked(.denied, unreported: true)))
        #expect(
            unsaved.body
                == "Bali can't keep you focused without it. It couldn't tell your teacher yet, and keeps trying."
        )
    }

    @Test(
        "A Back to focus the server refused is said where the student lands (rule 5), the way back a re-tap: after protection off, why; any other refusal, with who to ask — on Protection off, on Unlocked in place of Back to focus while the unlock stands there, and on the class's Home; once the class is over for the phone — its bell rung, or the phone out of it — nothing, the words stale (santa's review); a refusal of another kind, or none, says nothing"
    )
    func refusedBack() throws {
        var state = try synced(.inSession(bell1042, .protectionOff))
        state.refused = refused(.protectionOff)
        #expect(state.refusedRefocusWords(at: t0) == offWords && words(state)?.refused == offWords)
        #expect(state.refusedRefocusWords(at: bell1042.endsAt) == nil)
        state.refused = refused(.eventIdConflict)
        #expect(state.refusedRefocusWords(at: t0) == refusedWords)
        state.standing = .inSession(bell1042, .unlocked)
        #expect(UnlockedWords(state)?.retap == refusedWords)
        for standing in [Standing.out, .waiting, .inSession(session("t"), .unlocked)] {
            state.standing = standing
            #expect(state.refusedRefocusWords(at: t0) == nil, "\(standing)")
        }
        state.standing = .inSession(bell1042, .unlocked)
        state.refused = refused(.eventIdConflict, in: "another")
        #expect(UnlockedWords(state)?.retap == nil && state.refusedRefocusWords(at: t0) == nil)
        state.refused = Refusal(
            change: .protectionOff(session: "s"), status: 409, reason: nil, message: nil)
        #expect(state.refusedRefocusWords(at: t0) == nil && UnlockedWords(state)?.retap == nil)
    }

    @Test(
        "D1's Session over: the class that ended and when, by its bell — and that every app is back only once rule 3's check found no shield on; a class not read yet is 'your class'; standing in no session, nothing"
    )
    func sessionOverWords() throws {
        let rung = try synced(.inSession(bell1042, .focused))
        #expect(
            plain(rung.sessionOverWords(checked(.approved), time: newYork))
                == "Period 3 — Algebra II ended at 10:42 AM. All your apps are back.")
        #expect(
            plain(rung.sessionOverWords(checked(.approved, shielded: true), time: newYork))
                == "Period 3 — Algebra II ended at 10:42 AM.")
        let unread = try synced(.inSession(bell1042, .unlocked), me: false)
        #expect(
            plain(unread.sessionOverWords(checked(.approved), time: newYork))
                == "Your class ended at 10:42 AM. All your apps are back.")
        #expect(try synced(.out).sessionOverWords(checked(.approved)) == nil)
    }
}
