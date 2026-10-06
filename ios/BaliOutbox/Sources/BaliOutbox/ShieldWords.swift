/// What Bali's own shield over a blocked app or website says (B5c): D1's words, kept by the
/// redesign (D2k), the same whatever the phone stands in, its button's label among them. The shield
/// extension (`ios/BaliShield`) draws them in the design system's light tokens and reads
/// nothing to say them (B5c-2, the owner's ruling): iOS's sandbox refuses a shield extension the
/// outbox file — the file coordinator, then SQLite's own locks — so the bell is Bali's to show,
/// where the student opens it, and never a shield's: iOS may keep a shield's words until the
/// shields change (not documented, B5c), so a time there could go stale after an extension.
public struct ShieldWords: Sendable, Hashable {
    public let title: String
    public let subtitle: String
    /// The one button's: with no shield action extension, iOS closes the blocked app (B5c).
    public let button = "OK"

    /// What the shield is over: iOS asks for an app's shield and a website's apart.
    public enum Over: Sendable { case app, website }

    /// The words over `over`.
    public init(over: Over) {
        title = "Focused with Bali"
        subtitle =
            "This \(over == .app ? "app" : "website") is paused for class. Calls, FaceTime, "
            + "Messages and Emergency SOS always work. Open Bali to see when class ends. "
            + "Emergency Unlock is always there."
    }
}
