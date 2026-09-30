import BaliCore
import Foundation

/// What the Protection off screen shows (C5b; D1's ProtectionOff) in a running session where the
/// Screen Time permission is off, or was: the class, what happened and that the teacher sees it,
/// and the way back — Screen Time on again, then a re-tap. A refocus out of protection off is
/// refused (A2), so the screen never offers Back to focus.
public struct ProtectionOffWords: Sendable, Hashable {
    /// The way on, from what rule 3's check verified of the permission: Settings where it is
    /// denied; iOS's own prompt where it reads not determined past B5a-2's grace — never given on
    /// this phone, or lost with a restored backup, where Settings lists no Bali; the re-tap once it
    /// reads on again; none yet while a read not determined is within the grace (C4's
    /// "Checking Screen Time…"), never "off" over a grant a relaunch has not read back yet.
    public enum Way: Sendable, Hashable { case settings, ask, retap, checking }

    public let title: String, subtitle: String, headline: String, body: String
    public let way: Way
    /// A Back to focus the server refused (rule 5).
    public let refused: String?

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
        let sent =
            state == .protectionOff
            && !sync.queued.contains { $0.change == .protectionOff(session: session.id) }
        let sees = sent ? "sees" : "will see"
        switch way {
        case .settings, .ask:
            headline = "Screen Time is off"
            // Found and not saved, nothing yet makes it true that the teacher will (rule 5).
            body =
                protection?.unreported == true
                ? "Bali can't keep you focused without it. It couldn't tell your teacher yet, and keeps trying."
                : "Bali can't keep you focused without it, so your teacher \(sees) 'Screen Time off'."
        case .retap:
            headline = "Screen Time is back on"
            body =
                "Tap your teacher's block again to rejoin class. Until then, your teacher \(sees) 'Screen Time off'."
        case .checking:
            headline = "Checking Screen Time…"
            body = "Your teacher \(sees) 'Screen Time off' until you tap your teacher's block again."
        }
        refused = sync.refusedRefocus(in: session.id)
    }
}
