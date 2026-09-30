import BaliCore
import Foundation

/// What the Unlocked screen shows (C5a; D1's Unlocked) for the session the phone stands unlocked
/// in: the class and its bell, what is open until when and whether the teacher sees it yet, the
/// reason the student may give — optional, never what the unlock waits on (A1) — and the way back.
public struct UnlockedWords: Sendable, Hashable {
    /// The reason card: the three while one can still go with the unlock — its record never sent
    /// (`Outbox.explain`) — the one given, or too late: the unlock gone without one.
    public enum Picker: Sendable, Hashable { case open, given(UnlockReason), late }

    public let title: String, subtitle: String, body: String
    /// Nil: no unlock of this phone's to give a reason for — one before a relaunch, say.
    public let picker: Picker?
    /// Why the way back is a re-tap, not Back to focus: protection off was reported in this session
    /// since the phone's last tap, and a refocus out of it is refused (A2; #96's review).
    public let retap: String?
    /// The unlock stuck — refused, or unsettled to the bound — still kept and retried (rule 5).
    public let stuck: String?

    /// Nil unless the phone stands unlocked in a session. `given`: the reason this screen gave or
    /// saw given; `asked`: it offered the three, so an unlock gone since went without one.
    public init?(
        _ sync: SyncState, given: UnlockReason? = nil, asked: Bool = false,
        time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) {
        guard case .inSession(let session, .unlocked?) = sync.standing else { return nil }
        let heading = sync.heading(session, time)
        (title, subtitle) = (heading.title ?? "Your class", heading.subtitle)
        let (unlock, bell) = (sync.queued.last { $0.change.isUnlock }, session.endsAt.formatted(time))
        body =
            "Everything's open until you go back to focus or the bell at \(bell). "
            + (unlock == nil
                ? "Your teacher can see you unlocked." : "Your teacher will see you unlocked.")
        // What this screen gave comes first: a record still queued may be an older unlock, stuck.
        picker =
            if let given {
                .given(given)
            } else if let unlock {
                unlock.change.reason.map(Picker.given) ?? (unlock.attempts == 0 ? .open : .late)
            } else {
                asked ? .late : nil
            }
        retap =
            sync.reportedOff == session.id
            ? "Screen Time was off during this class, so tap your teacher's block to go back to focus."
            : nil
        stuck =
            unlock?.stuck == true
            ? "Bali couldn't send your unlock to your teacher yet. It keeps trying." : nil
    }

    /// What the reason card says once it is too late for one.
    public static let late = "Your unlock goes to your teacher without a reason."
}
