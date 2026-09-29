import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// A US phone in New York writes a time so — `t0` is 10:13:20 AM there.
let newYork = Date.FormatStyle(
    date: .omitted, time: .shortened, locale: Locale(identifier: "en_US"),
    timeZone: TimeZone(identifier: "America/New_York")!)

/// `text` with plain spaces: ICU writes a narrow no-break one before "AM".
func plain(_ text: String?) -> String? {
    text?.replacing("\u{202F}", with: " ").replacing("\u{A0}", with: " ")
}

/// A session whose bell is at 10:42 AM in New York.
let bell1042 = session(endsAt: 1720)

/// The engine standing `standing` with `queued`, its link `link`, and `GET /v1/me` naming class
/// "c" Period 3, with `teacher` — "null" for a teacher with no name — or, `me` false, not read.
func synced(
    _ standing: Standing, queued: [OutboxRecord] = [], link: Link? = .reached,
    teacher: String = #""Ms. Rivera""#, me: Bool = true
) throws -> SyncState {
    var state = SyncState()
    (state.standing, state.queued, state.link) = (standing, queued, link)
    if me {
        state.me = try BaliJSON.makeDecoder().decode(
            MeResponse.self,
            from: Data(
                #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"c","name":"Period 3 — Algebra II","teacher":{"displayName":\#(teacher)}}],"session":null}"#
                    .utf8))
    }
    return state
}

/// What rule 3's check found: the shields verified on — or not, the permission judged `off`.
private func checked(shielded: Bool = true, off: Bool = false) -> Protection {
    var protection = Protection()
    (protection.checked, protection.shielded, protection.permissionOff) = (true, shielded, off)
    protection.permission = shielded ? .approved : off ? .denied : .notDetermined
    return protection
}

/// The Focus screen's words for `state` and `protection` at `now`, on a US phone in New York.
private func focus(
    _ state: SyncState, _ protection: Protection? = checked(), at now: Date = t0
) -> FocusWords {
    FocusWords(state, protection, now: now, time: newYork)
}

/// A tap made at `t0`, not answered yet: decision 7's cap holds the shields until 11:03:20 AM.
private func heldTap() throws -> [OutboxRecord] {
    let (outbox, _) = try makeOutbox()
    try record(outbox, .tap(tagId: "tag"))
    return try outbox.records()
}

@Suite("What the Focus screen says (C4)")
struct FocusTests {
    @Test(
        "D1's Focus: the class and its teacher, the countdown to the bell by the phone's clock, the ring as full as the time left, the shields as the check verified them, and Emergency Unlock's line"
    )
    func focused() throws {
        let words = focus(try synced(.inSession(bell1042, .focused)))
        #expect(words.title == "Period 3 — Algebra II")
        #expect(plain(words.subtitle) == "with Ms. Rivera · ends 10:42 AM")
        #expect(words.countdown == "28:40" && plain(words.until) == "until 10:42 AM")
        #expect(words.fraction == 1720 / FocusWords.ringSpan && !words.final)
        #expect(words.claim == .paused)
        #expect(
            words.claimWords
                == "Every app is paused. Calls, FaceTime, Messages and Emergency SOS always work.")
        #expect(words.offline == nil && words.unscheduled == nil)
        #expect(words.caption == "Works without Wi-Fi. Letting go early does nothing.")
    }

    @Test(
        "The countdown: minutes and seconds, hours once over one, never a second early — it reads 0:00 only at the bell; the ring full at 50 minutes or more, empty at the bell; the last two minutes D1's FocusFinal"
    )
    func countdown() throws {
        let state = try synced(.inSession(bell1042, .focused))
        let cases: [(TimeInterval, String, Bool)] = [
            (1720 - 121, "2:01", false), (1720 - 120, "2:00", true), (1720 - 112, "1:52", true),
            (1720 - 0.3, "0:01", true), (1720, "0:00", true), (1800, "0:00", true),
        ]
        for (now, digits, final) in cases {
            let words = focus(state, at: at(now))
            #expect(words.countdown == digits && words.final == final, "\(now)")
            #expect(words.title == "Period 3 — Algebra II", "\(now)")
        }
        #expect(focus(state, at: at(1720 - 112)).secondsLeft == 112)
        #expect(focus(state, at: at(1720 - 0.3)).secondsLeft == 1)
        #expect(focus(state, at: at(1720)).fraction == 0)
        let long = try synced(.inSession(session(endsAt: 3905), .focused))
        #expect(focus(long).countdown == "1:05:05" && focus(long).fraction == 1)
        let half = try synced(.inSession(session(endsAt: FocusWords.ringSpan / 2), .focused))
        #expect(focus(half).fraction == 0.5)
    }

    @Test(
        "A class `GET /v1/me` has not named — not read yet, or not among its classes — is 'In focus'; a teacher with no name is left out, never 'with your teacher'"
    )
    func names() throws {
        let unread = focus(try synced(.inSession(bell1042, .focused), me: false))
        #expect(unread.title == "In focus" && plain(unread.subtitle) == "ends 10:42 AM")
        let other = SessionView(id: "s", classId: "other", endsAt: at(1720))
        #expect(focus(try synced(.inSession(other, .focused))).title == "In focus")
        let unnamed = focus(try synced(.inSession(bell1042, .focused), teacher: "null"))
        #expect(unnamed.title == "Period 3 — Algebra II")
        #expect(plain(unnamed.subtitle) == "ends 10:42 AM")
    }

    @Test(
        "A tap not answered yet (decision 7): 'You're in', no class named, and its cap only the latest the shields come off — whatever the phone stood in, unless the bell of the session it is focused in ends them first; offline, its card says the tap is saved"
    )
    func tapHeld() throws {
        let tap = try heldTap()
        let held = focus(try synced(.out, queued: tap))
        #expect(held.title == "You're in")
        #expect(held.subtitle == "Your class shows here once Bali hears back.")
        #expect(held.countdown == "50:00" && plain(held.until) == "at most until 11:03 AM")
        #expect(held.offline == nil)
        #expect(
            focus(try synced(.out, queued: tap, link: .unreachable)).offline
                == "Your tap is saved on this phone and reaches your teacher as soon as Bali is back online."
        )
        // Re-tapped while focused: the cap outlasting the bell, the tap's answer may name another.
        let outlasts = focus(try synced(.inSession(bell1042, .focused), queued: tap))
        #expect(outlasts.title == "You're in" && plain(outlasts.until) == "at most until 11:03 AM")
        let later = focus(try synced(.inSession(session(endsAt: 4000), .focused), queued: tap))
        #expect(later.title == "Period 3 — Algebra II" && plain(later.until) == "until 11:20 AM")
        // Unlocked, then re-tapped: the tap holds them, and no session is focused.
        #expect(focus(try synced(.inSession(bell1042, .unlocked), queued: tap)).title == "You're in")
    }

    @Test(
        "It claims what the check verified, never the standing: the shields on is paused; the permission taken back — a tap held, focused still until the report lands — is Screen Time off and the way back, never 'paused'; nothing checked yet, or not determined for a moment, claims nothing but that the check runs"
    )
    func claim() throws {
        let focused = try synced(.inSession(bell1042, .focused))
        let off = focus(focused, checked(shielded: false, off: true))
        #expect(off.claim == .screenTimeOff)
        #expect(
            off.claimWords
                == "Screen Time is off for Bali, so no app is paused. Turn it back on in Settings → Screen Time → Apps with Screen Time Access."
        )
        #expect(focus(try synced(.out, queued: try heldTap()), checked(shielded: false, off: true)).claim == .screenTimeOff)
        for unverified in [nil, Protection(), checked(shielded: false)] {
            let words = focus(focused, unverified)
            #expect(words.claim == .unverified && words.claimWords == "Checking Screen Time…")
        }
    }

    @Test(
        "An Emergency Unlock the outbox could not keep is said, holding again the way on — its apps 'still paused' only where the check verified the shields on, never over Screen Time off or nothing checked yet (rule 3; santa's review); a phone not started says so, and a press that found nothing to unlock (#116's review)"
    )
    func unlockFailed() throws {
        let focused = try synced(.inSession(bell1042, .focused))
        /// What the screen says of `failure` under `protection`'s claim, as the Focus screen asks.
        func said(_ failure: UnlockFailure, _ protection: Protection? = checked()) -> String {
            failure.words(paused: focus(focused, protection).claim == .paused)
        }
        #expect(
            said(.notSaved)
                == "Bali couldn't save your unlock, so your apps are still paused. Hold to try again.")
        for protection in [checked(shielded: false, off: true), nil, checked(shielded: false)] {
            #expect(
                said(.notSaved, protection) == "Bali couldn't save your unlock. Hold to try again.",
                "\(String(describing: protection))")
        }
        #expect(said(.notStarted) == Joining.notStarted)
        #expect(said(.nothing) == "Nothing is paused now, so there was nothing to unlock.")
    }

    @Test(
        "A Release build holds Emergency Unlock wherever the shields can be on — the Focus screen, and Home over the last run's shields where the phone stood unread — beside Home's Tap in, which shields a phone: both or neither, never Tap in alone (C3b's rider; ARCHITECTURE: nothing shields a phone with no way out)"
    )
    func releaseHasBoth() throws {
        /// `path`'s code as a Release build compiles it: every `#if DEBUG` block out.
        func release(_ path: String) throws -> String {
            try sourceCode(path).replacing(try Regex("#if DEBUG[\\s\\S]*?#endif"), with: "")
        }
        let home = try release("Bali/UI/HomeView.swift")
        let tapIn = home.split(separator: "\n").contains {
            $0.trimmingCharacters(in: .whitespaces) == "tapIn"
        }
        #expect(tapIn, "Home's Tap in is not in a Release build")
        #expect(home.contains("EmergencyUnlock("), "Home over an unread standing has no unlock")
        #expect(try release("Bali/UI/FocusView.swift").contains("EmergencyUnlock("))
    }

    @Test(
        "No answer from the server (D1's FocusOffline): the bell still kept by the phone, and an unlock saved on it first; waiting on sign-in, storage refused or no exchange yet is no 'no connection'"
    )
    func offline() throws {
        let words = focus(try synced(.inSession(bell1042, .focused), link: .unreachable))
        #expect(
            plain(words.offline)
                == "Focus still ends at 10:42 AM — this phone keeps time without Wi-Fi, and Bali catches up when it's back online. Your teacher sees when this phone last checked in."
        )
        #expect(
            words.caption
                == "Works without Wi-Fi — an unlock is saved on this phone first. Letting go early does nothing."
        )
        for link in [Link.signIn, .storageFailed, nil] {
            #expect(focus(try synced(.inSession(bell1042, .focused), link: link)).offline == nil)
        }
    }

    @Test(
        "A wake iOS refused at the end — this run's window, or the monitor's next with the app closed (B5b-2) — is said, with the way on: Bali opened after class; neither, nothing"
    )
    func unscheduled() throws {
        let focused = try synced(.inSession(bell1042, .focused))
        var refused = checked()
        refused.unscheduled = true
        var monitor = checked()
        monitor.monitorUnscheduled = at(-60)
        for protection in [refused, monitor] {
            #expect(
                focus(focused, protection).unscheduled
                    == "iOS didn't let Bali schedule when focus ends. If your apps are still paused after class, open Bali."
            )
        }
        #expect(focus(focused).unscheduled == nil)
    }
}
