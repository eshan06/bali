import BaliCore
import Foundation

/// What the Unlocked screen shows (C5a; D1's Unlocked) for the session the phone stands unlocked
/// in: the class and its bell, what is open until when and whether the teacher sees it yet, the
/// reason the student may give and change — optional, never what the unlock waits on (A1, A20) —
/// and the way back.
public struct UnlockedWords: Sendable, Hashable {
    /// The reason card (C5c): the three, the check on the reason on record. `open`: a pick goes
    /// with the unlock while it has never been sent (`Outbox.explain`), else as a change of it
    /// (A20). `waiting`: the unlock is on its way or stuck, and no pick can reach it until the
    /// server has it.
    public enum Picker: Sendable, Hashable {
        case open(UnlockReason?), waiting(UnlockReason?)

        /// The reason the check is on.
        public var chosen: UnlockReason? {
            switch self {
            case .open(let reason), .waiting(let reason): reason
            }
        }

        /// What the card says under the three, nothing having gone wrong.
        public var caption: String {
            switch self {
            case .open: "Your teacher sees the reason you pick."
            case .waiting(nil): UnlockedWords.onItsWay
            case .waiting: "Your reason goes with your unlock. You can change it once it arrives."
            }
        }
    }

    public let title: String, subtitle: String, body: String
    /// Nil: no unlock of this phone's to give a reason for — one before a relaunch, say.
    public let picker: Picker?
    /// Why the way back is a re-tap, not Lock my apps again: protection off was reported in this
    /// session since the phone's last tap, and a refocus out of it is refused (A2; #96's review) —
    /// or the server refused this session's refocus (C5b).
    public let retap: String?
    /// The unlock stuck — refused, or unsettled to the bound — still kept and retried (rule 5).
    public let stuck: String?

    /// Nil unless the phone stands unlocked in a session.
    public init?(
        _ sync: SyncState, time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) {
        guard case .inSession(let session, .unlocked?) = sync.standing else { return nil }
        let heading = sync.heading(session, time)
        (title, subtitle) = (heading.title ?? "Your class", heading.subtitle)
        // This class's: another class's unlock, stuck, is not the one the screen shows (#119's
        // review) — one under a tap or not filed yet may be any's.
        let (unlock, bell) = (sync.unlock(in: session.id), session.endsAt.formatted(time))
        body =
            "Everything's open until you lock your apps again or the bell at \(bell). "
            + (unlock == nil
                ? "Your teacher can see you unlocked." : "Your teacher will see you unlocked.")
        // This class's unlock still on the phone first, a newer one than any recorded; then the
        // one the server recorded, at the reason on record.
        picker =
            if let unlock {
                unlock.attempts == 0 && !unlock.stuck && !sync.sending.contains(unlock.eventId)
                    ? .open(unlock.change.reason) : .waiting(unlock.change.reason)
            } else if let recorded = sync.recordedUnlock, recorded.session == session.id {
                .open(recorded.reason)
            } else {
                nil
            }
        retap =
            sync.reportedOff == session.id
            ? "Screen Time was off during this class, so tap your teacher's block to lock your apps again."
            : sync.refusedRefocus(in: session.id)
        stuck = unlock?.stuck == true ? Self.unsent : nil
    }

    /// What the reason card says while the unlock is on its way: a pick waits for it to arrive.
    public static let onItsWay = "You can pick a reason once your unlock reaches your teacher."

    /// What the card says of a change of the reason that did not go (rule 5), keyed on the
    /// refusal: the unlock over, the class over, not found — else that it did not go, and how on.
    public static func notChanged(_ answer: APIResponse<UnlockReasonResponse>) -> String {
        switch (answer.error?.error.reason, answer.result) {
        case (.unlockSuperseded?, _): "This unlock is over, so its reason can't change."
        case (.sessionNotRunning?, _): "Class is over, so the reason can't change."
        case (.unlockNotFound?, _): "Bali couldn't find this unlock, so its reason can't change."
        case (_, .networkError): offline
        default: "Bali couldn't change your reason. Try again in a moment."
        }
    }

    /// What the card says of a change no answer came to.
    public static let offline =
        "Bali couldn't change your reason. Check your connection and try again."

    /// What a screen says of an Emergency Unlock stuck on the phone, kept and retried (rule 5).
    public static let unsent = "Bali couldn't send your unlock to your teacher yet. It keeps trying."
}

extension SyncState {
    /// The latest Emergency Unlock queued for `session`: that session's own, or one filed under a
    /// tap or not filed yet, which may be any session's (C5b's review).
    func unlock(in session: String) -> OutboxRecord? {
        queued.last {
            switch $0.change {
            case .unlock(let id, _): id == session
            case .unlockUnderTap, .unlockUnfiled: true
            case .tap, .refocus, .protectionOff: false
            }
        }
    }
}
