import BaliCore
import Foundation

/// What the Focus screen shows at `now` (C4; D1's Focus, FocusFinal and FocusOffline), from the
/// engine's truth and what rule 3's check verified. Of the shields it claims `Protection` alone,
/// never the standing: the router shows focus by the enforcer's intent, so a tap held with the
/// permission taken back is focus over no shields — said so, with the way back — and no countdown
/// ticks over nothing shielded (rule 3: v2 showed one).
public struct FocusWords: Sendable, Hashable {
    /// What the check verified: the shields on; Screen Time taken back — denied, or not determined
    /// for a check-in interval, never a launch's moment (B5a-2); or nothing yet.
    public enum Claim: Sendable, Hashable { case paused, screenTimeOff, unverified }

    /// The class, and under it its teacher and bell; a tap not answered yet knows neither.
    public let title: String, subtitle: String
    public let claim: Claim
    /// The time left until the shields come off by the phone's own clock (`shieldedUntil`) — the
    /// bell, or a tap's cap, which is only the latest they can — as the digits say it, how full
    /// the ring is, until when, and whether these are the last two minutes (D1's FocusFinal).
    public let countdown: String, fraction: Double, until: String, final: Bool
    /// No answer from the server (D1's FocusOffline): what its card says; nil online.
    public let offline: String?
    /// iOS refused the wake at the end — this run's window, or the monitor's next with the app
    /// closed (B5b, B5b-2) — so with Bali closed the shields may outlast it; nil when neither.
    public let unscheduled: String?
    /// Under Emergency Unlock.
    public let caption: String

    /// The ring is full with this long left or more: the phone knows the bell, not the start.
    public static let ringSpan: TimeInterval = 50 * 60

    public init(
        _ sync: SyncState, _ protection: Protection?, now: Date,
        time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) {
        // The session named is the one whose bell ends the shields — not one a re-tap's cap
        // outlasts, where the tap's answer may name another — and at the bell, still its own.
        let held = sync.shieldedUntil(now)
        var session: SessionView?
        if case .inSession(let view, .focused?) = sync.standing, view.endsAt >= held ?? view.endsAt {
            session = view
        }
        let ends = held ?? session?.endsAt ?? now
        let (at, capped) = (ends.formatted(time), ends != session?.endsAt)
        if let session {
            let named = sync.me?.classes.first { $0.id == session.classId }
            let bell = "ends \(session.endsAt.formatted(time))"
            title = named?.name ?? "In focus"
            subtitle = named?.teacher?.displayName.map { "with \($0) · \(bell)" } ?? bell
        } else {
            (title, subtitle) = ("You're in", "Your class shows here once Bali hears back.")
        }
        claim =
            protection?.shielded == true
            ? .paused : protection?.permissionOff == true ? .screenTimeOff : .unverified
        let left = max(0, ends.timeIntervalSince(now))
        let seconds = Int(left.rounded(.up))
        let (hours, minutes) = (seconds / 3600, seconds / 60 % 60)
        countdown =
            hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds % 60)
            : String(format: "%d:%02d", minutes, seconds % 60)
        (fraction, final) = (min(1, left / Self.ringSpan), left <= 120)
        until = capped ? "at most until \(at)" : "until \(at)"
        let unreachable = sync.link == .unreachable
        offline =
            !unreachable
            ? nil
            : capped
                ? "Your tap is saved on this phone and reaches your teacher as soon as Bali is back online."
                : "Focus still ends at \(at) — this phone keeps time without Wi-Fi, and Bali catches up when it's back online. Your teacher sees when this phone last checked in."
        unscheduled =
            protection?.unscheduled == true || protection?.monitorUnscheduled != nil
            ? "iOS didn't let Bali schedule when focus ends. If your apps are still paused after class, open Bali."
            : nil
        caption =
            unreachable
            ? "Works without Wi-Fi — an unlock is saved on this phone first. Letting go early does nothing."
            : "Works without Wi-Fi. Letting go early does nothing."
    }

    /// What the claim says under the ring, and nothing while nothing is verified.
    public var claimWords: String? {
        switch claim {
        case .paused: "Every app is paused. Calls, FaceTime, Messages and Emergency SOS always work."
        case .screenTimeOff:
            "Screen Time is off for Bali, so no app is paused. Turn it back on in Settings → Screen Time → Apps with Screen Time Access."
        case .unverified: nil
        }
    }

    /// What the screen says when Emergency Unlock could not be kept (rule 5): the outbox refused
    /// the write, so nothing changed — holding again is the way on.
    public static let unlockNotSaved =
        "Bali couldn't save your unlock, so your apps are still paused. Hold to try again."
}
