import BaliCore
import Foundation

/// The Me screen's name (C6b; D1's Me) as the phone keeps it: whether the student is editing it,
/// the name as typed, and why the last save (A8's `PATCH /v1/me`) did not finish, in words (rule
/// 5). Its rules, so they run on Linux; the app sends the call.
public struct Naming: Sendable, Hashable {
    /// The longest name, in code points: `DISPLAY_NAME_MAX_LENGTH` in `@bali/shared`.
    public static let maxLength = 64

    public var editing = false
    public var name = ""
    public var failure: String?
    /// A save under way, one at a time: the name stays as sent until its answer comes.
    public var busy = false
    /// The last save's event id, kept while the name is the one it sent (rule 4): a retry after an
    /// answer that never came is then answered as its replay, never a second rename.
    public private(set) var eventId: String?

    public init() {}

    /// Editing begins on `current`, the name `GET /v1/me` gives.
    public mutating func edit(_ current: String?) {
        self = Naming()
        (editing, name) = (true, current ?? "")
    }

    /// The student typed `text`: kept to the whole characters that fit the longest name, so no
    /// emoji is cut in two. What went wrong with the name before no longer applies. Nothing changes
    /// while a save is under way.
    public mutating func type(_ text: String) {
        guard !busy else { return }
        var (kept, count) = ("", 0)
        for character in text {
            count += character.unicodeScalars.count
            if count > Self.maxLength { break }
            kept.append(character)
        }
        if kept != name { eventId = nil }
        (name, failure) = (kept, nil)
    }

    /// Something to save: a name that is not blank.
    public var complete: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// A save begins: the name as typed, under its last try's event id while the name is the same,
    /// busy until the answer comes, the last try's words gone.
    public mutating func save(at now: Date) -> UpdateMeRequest {
        let id = eventId ?? EventID.mint(at: now)
        (eventId, busy, failure) = (id, true, nil)
        return UpdateMeRequest(displayName: name, eventId: id)
    }

    /// The answer to the save `request` sent: true once the name is set — applied, or a replay's
    /// name now — and editing ends; else why not, said under the field, the name kept for another
    /// try. One for a save this editing did not send — the student signed out meanwhile — is
    /// dropped.
    @discardableResult
    public mutating func saved(_ response: APIResponse<UpdateMeResponse>, for request: UpdateMeRequest)
        -> Bool
    {
        guard busy, request.eventId == eventId else { return false }
        busy = false
        if response.answer != nil {
            self = Naming()
            return true
        }
        failure = Self.words(response.result, response.error?.error.reason)
        return false
    }

    /// What the card says when a save set no name (rule 5): keyed on the status and the error's
    /// `reason`, never its message — else in the Join screen's words.
    public static func words(_ result: SendResult, _ reason: ApiErrorReason?) -> String {
        switch (reason, result) {
        case (.displayNameTaken?, _):
            "A classmate already uses that name. Try another, like adding your last initial."
        case (.displayNameInvalid?, _): "Bali can't use that name. Try another."
        case (_, .status(403)):
            "This is a teacher's account, and only students change their name here."
        default: Joining.words(result, nil)
        }
    }
}

/// What the Me screen says of Sign out (C6b; rule 5).
public enum SignOutWords {
    /// Why Sign out waits: an Emergency Unlock this phone recorded that the server has not. Signed
    /// out, it would wait for the next sign-in and go under whoever makes it (B4's rule) — on a
    /// shared phone, another student. Nil: nothing holds it.
    public static func held(_ sync: SyncState) -> String? {
        sync.queued.contains { $0.change.isUnlock }
            ? "Your Emergency Unlock hasn't reached your teacher yet. You can sign out once it has."
            : nil
    }

    /// The Keychain could not forget the sign-in right now: nothing changed.
    public static let failed = "Bali couldn't sign you out. Try again."
}
