import BaliCore
import Foundation

/// What the Protection off screen shows (C5b; D1's ProtectionOff) in a running session where the
/// Screen Time permission is off, or was: the class, what happened and that the teacher sees it,
/// and the way back — Screen Time on again, which puts the phone back where it stood by itself
/// (#167), or a re-tap where that could not be done. A refocus out of protection off is refused
/// (A2), so the screen never offers Back to focus.
public struct ProtectionOffWords: Sendable, Hashable {
    /// The way on, from what rule 3's check verified of the permission: Settings where it is
    /// denied; iOS's own prompt where it reads not determined past B5a-2's grace — never given on
    /// this phone, or lost with a restored backup, where Settings lists no Bali; the re-tap once it
    /// reads on again here, which Screen Time back on leaves at once wherever it can (#167); none
    /// yet while a read not determined is within the grace (C4's "Checking Screen Time…"), never
    /// "off" over a grant a relaunch has not read back yet.
    public enum Way: Sendable, Hashable { case settings, ask, retap, checking }

    public let title: String, subtitle: String, headline: String, body: String
    public let way: Way
    /// D1's card, the steps back to class: Screen Time on again, then Bali putting the student back
    /// by itself (#167) — or, on the re-tap's way, the tap.
    public let steps: [String]
    /// A Back to focus the server refused (rule 5).
    public let refused: String?
    /// What the screens it takes over from would say, which it must not drop (rule 5; C5b's
    /// review): an Emergency Unlock of this class stuck on the phone (Unlocked's), a tap the server
    /// refused and the classes not read (Home's) — said with Try again.
    public let problems: [String]

    /// Nil unless the phone stands in a session.
    public init?(
        _ sync: SyncState, _ protection: Protection?,
        time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) {
        guard case .inSession(let session, let state) = sync.standing else { return nil }
        let heading = sync.heading(session, time)
        (title, subtitle) = (heading.title ?? "Your class", heading.subtitle)
        way =
            protection?.permission == .approved
            ? .retap
            : protection?.permissionOff != true
                ? .checking : protection?.permission == .denied ? .settings : .ask
        // Recorded and gone, the teacher sees it; on the phone, or not reported yet, will (C5a's).
        let queued = sync.queued.contains { $0.change == .protectionOff(session: session.id) }
        let sent = state == .protectionOff && !queued
        let sees = sent ? "sees" : "will see"
        // Found and never saved, nothing yet makes it true that the teacher sees it, or will (rule
        // 5) — whichever the way (C5b's review). What the teacher sees is said, never quoted: their
        // grid's label is "Protection off", the phone's "Screen Time off" (D2j).
        let untold = protection?.unreported == true && !sent && !queued
        switch way {
        case .settings, .ask:
            headline = "Screen Time is off"
            body =
                untold
                ? "Bali can't keep you focused without it. It couldn't tell your teacher yet, and keeps trying."
                : "Bali can't keep you focused without it, so your teacher \(sees) that Screen Time is off."
        case .retap:
            headline = "Screen Time is back on"
            // On again, the check reports nothing more: no "keeps trying".
            body =
                "Tap your teacher's block again to rejoin class. "
                + (untold
                    ? "Bali couldn't tell your teacher that Screen Time was off."
                    : "Until then, your teacher \(sees) Screen Time as off.")
        case .checking:
            headline = "Checking Screen Time…"
            body =
                untold
                ? "Bali couldn't tell your teacher that Screen Time was off. It keeps trying."
                : "Until Screen Time is back on, your teacher \(sees) that it's off."
        }
        steps = [
            "Turn Screen Time back on for Bali",
            way == .retap
                ? "Tap your teacher's block again" : "Bali puts you back in class by itself",
        ]
        refused = sync.refusedRefocus(in: session.id)
        problems = [
            sync.unlock(in: session.id)?.stuck == true ? UnlockedWords.unsent : nil,
            sync.refusedTapWords, sync.meWords,
        ].compactMap { $0 }
    }
}
