import Foundation

/// What Bali's own shield over a blocked app or website says (B5c): D1's approved words, from where
/// the phone stands. The shield extension (`ios/BaliShield`) draws them in D1's look; iOS runs it
/// out of process, as it runs the monitor, so it reads the standing and the queue the app keeps in
/// the app group as the monitor does (`Outbox.read`): read only — a student opens blocked apps many
/// times a minute — all of it within `Bell.patience`, a ceiling, and the file closed before it
/// returns. What it cannot read, it gives no time for — never a wrong one.
public struct ShieldWords: Sendable, Hashable {
    public let title: String
    public let subtitle: String

    /// What the shield is over: iOS asks for an app's shield and a website's apart.
    public enum Over: Sendable { case app, website }

    /// The bell as the phone writes a time: in its own locale — 12- or 24-hour, as the phone is
    /// set — and its own time zone: "9:42 AM", or "09:42".
    public static let time = Date.FormatStyle(date: .omitted, time: .shortened)

    /// The words at `now` over `over`, where the phone stands read from the outbox at `url` — nil:
    /// no app group — within `bound`, with `cap`, decision 7's or a device check's.
    public init(
        outboxAt url: URL?, over: Over, now: Date, cap: TimeInterval = SyncState.tapCap,
        time: Date.FormatStyle = ShieldWords.time, within bound: TimeInterval = Bell.patience
    ) {
        var state = url.flatMap { try? Outbox.read($0, within: bound, migrating: false) }
        state?.cap = cap
        self.init(state, over: over, now: now, time: time)
    }

    /// The words for `state` — nil: not read — at `now`. A tap not yet answered keeps the shields
    /// on: no end is known, whatever the phone stood in before — the tap's answer may move it.
    /// Else, focused in a session: until its bell. Else nothing says when they come off — the
    /// file not read, the bell past, or nothing keeping them on (a shield not taken down yet):
    /// Bali's name.
    init(_ state: SyncState?, over: Over, now: Date, time: Date.FormatStyle) {
        if let held = state?.tapHeldUntil, held > now {
            title = "Focused with Bali — waiting for your class"
        } else if case .inSession(let session, .focused?)? = state?.standing, session.endsAt > now {
            title = "Focused with Bali until \(session.endsAt.formatted(time))"
        } else {
            title = "Focused with Bali"
        }
        subtitle =
            "This \(over == .app ? "app" : "website") is paused for class. Calls, FaceTime, "
            + "Messages and Emergency SOS always work. If you need out, Emergency Unlock is always "
            + "in the Bali app."
    }
}
