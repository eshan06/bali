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

    /// The student typed `text`: kept as a name can be sent — a pasted tab or line break the space
    /// it looks like, and what a name never carries left out (`printable`), so nothing unseen is
    /// sent and refused (C6b-1's review) — and to the whole characters that fit the longest name,
    /// so no emoji is cut in two. What went wrong with the name before no longer applies. Nothing
    /// changes while a save is under way.
    public mutating func type(_ text: String) {
        guard !busy else { return }
        var (kept, count) = ("", 0)
        for character in Self.printable(text) {
            count += character.unicodeScalars.count
            if count > Self.maxLength { break }
            kept.append(character)
        }
        if kept != name { eventId = nil }
        (name, failure) = (kept, nil)
    }

    /// `text` without what a name never carries, as the API refuses it (`UNPRINTABLE`,
    /// apps/api/src/display-name.ts): control and format characters — but the joiners Persian,
    /// Arabic and Indic names and emoji need — and line and paragraph separators; those that are
    /// blank space made a space.
    static func printable(_ text: String) -> String {
        var kept = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            switch scalar.properties.generalCategory {
            case .control, .format, .lineSeparator, .paragraphSeparator, .surrogate:
                if scalar == "\u{200C}" || scalar == "\u{200D}" {
                    kept.append(scalar)
                } else if scalar.properties.isWhitespace {
                    kept.append(" ")
                }
            default: kept.append(scalar)
            }
        }
        return String(kept)
    }

    /// The name as the API stores it (`tidyDisplayName`): each run of blank space — the blank
    /// braille cell and the null notehead among it — one space, and none at either end.
    static func tidy(_ name: String) -> String {
        name.split { $0.unicodeScalars.allSatisfy(blank) }.joined(separator: " ")
    }

    private static func blank(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.isWhitespace || scalar == "\u{2800}" || scalar == "\u{1D159}"
    }

    /// Something to save: a name with something in it a reader would see — never one of blank
    /// space and characters that draw nothing, which the API refuses (`INVISIBLE`).
    public var complete: Bool {
        !name.unicodeScalars.allSatisfy {
            Self.blank($0) || $0.properties.isDefaultIgnorableCodePoint
        }
    }

    /// What the card says when a blank name is saved — the keyboard's Done — rather than nothing.
    public static let blank = "Type a name to save it."

    /// A save begins: the name as typed, as the API will store it (`tidy`), under its last try's
    /// event id while the name is the same, busy until the answer comes, the last try's words gone.
    public mutating func save(at now: Date) -> UpdateMeRequest {
        let id = eventId ?? EventID.mint(at: now)
        (eventId, busy, failure) = (id, true, nil)
        return UpdateMeRequest(displayName: Self.tidy(name), eventId: id)
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

/// Leaving a class from the Me screen (C6c; D1's Leave, A19's `DELETE /v1/enrollments/{id}`) as
/// the phone keeps it: the class whose Leave was pressed, its question asked under it; the leave
/// under way, one at a time; and why the last did not finish, said under the question, whose
/// Leave class is the way to try again (rule 5). Its rules and words, so they run on Linux; the
/// app sends the call through the engine.
public struct Leaving: Sendable, Hashable {
    /// The class whose Leave was pressed: its question shows while this is set.
    public private(set) var asking: MeClass?
    /// The leave under way: the question stays as it is until the answer comes.
    public private(set) var busy = false
    /// Why the last leave did not finish, in words.
    public var failure: String?
    /// The last leave sent, kept while it is the same enrollment's (rule 4): a try after an answer
    /// that never came goes under its event id, and is answered as its replay.
    private var sent: Sent?

    private struct Sent: Sendable, Hashable {
        let enrollmentId: String
        let eventId: String
    }

    public init() {}

    /// Leave pressed on `row`: its question asked, what went wrong before gone. Nothing while a
    /// leave is under way, nor for a class named with no enrollment to leave by.
    public mutating func ask(_ row: MeClass) {
        guard !busy, row.enrollmentId != nil else { return }
        (asking, failure) = (row, nil)
    }

    /// Whether the question shows under `row`: asked about its enrollment. A class joined again
    /// since is another enrollment, which shows none (santa's round 1): Leave class would send the
    /// old one's leave, answered as already out.
    public func asks(_ row: MeClass) -> Bool {
        asking?.enrollmentId != nil && asking?.enrollmentId == row.enrollmentId
    }

    /// Cancel: no question — once a leave under way has its answer.
    public mutating func cancel() {
        guard !busy else { return }
        (asking, failure) = (nil, nil)
    }

    /// Leave class pressed: the enrollment to leave and the request, busy until the answer comes,
    /// the last try's words gone — under the last try's event id while it is the same enrollment's.
    public mutating func send(at now: Date) -> (enrollmentId: String, request: EndEnrollmentRequest)? {
        guard !busy, let enrollmentId = asking?.enrollmentId else { return nil }
        let eventId =
            sent.flatMap { $0.enrollmentId == enrollmentId ? $0.eventId : nil }
            ?? EventID.mint(at: now)
        sent = Sent(enrollmentId: enrollmentId, eventId: eventId)
        (busy, failure) = (true, nil)
        return (enrollmentId, EndEnrollmentRequest(eventId: eventId))
    }

    /// The answer to the leave of `enrollmentId`: true once the student is out of the class — it
    /// ended, or they were out already — and the question goes. Else why not, said under it, to
    /// try again. One for a leave this question did not send (a sign-out meanwhile) is dropped.
    @discardableResult
    public mutating func left(_ response: APIResponse<EndEnrollmentResponse>, for enrollmentId: String)
        -> Bool
    {
        guard busy, let row = asking, row.enrollmentId == enrollmentId else { return false }
        busy = false
        if response.answer != nil {
            self = Leaving()
            return true
        }
        failure = Self.words(row, response.result, response.error?.error.reason)
        return false
    }

    /// Why the phone holds `row`'s Leave: it stands in that class's lesson, whose bell has not rung
    /// by its own clock. Nil: not held — the server says no to a lesson the phone is not in.
    public static func held(_ row: MeClass, _ sync: SyncState, now: Date) -> String? {
        guard case .inSession(let session, _) = sync.standing, session.classId == row.id,
            session.endsAt > now
        else { return nil }
        return inSession(row)
    }

    /// The question asked under `row` before it is left.
    public static func question(_ row: MeClass) -> String { "Leave \(row.name)?" }

    public static let consequence = "You'll need the class code to join it again."

    /// D1's line under the classes.
    public static let recorded = "Leaving a class is recorded, and your teacher sees it."

    /// Why a class cannot be left now: it is in session, the phone's knowledge or the server's no.
    public static func inSession(_ row: MeClass) -> String {
        "\(row.name) is in session. You can leave it once class is over."
    }

    /// What the question says when a leave did not finish (rule 5): keyed on the status and the
    /// error's `reason`, never its message — else in the Join screen's words.
    public static func words(_ row: MeClass, _ result: SendResult, _ reason: ApiErrorReason?)
        -> String
    {
        switch reason {
        case .classInSession?: inSession(row)
        case .enrollmentNotFound?, .enrollmentNotYours?, .unknownUser?:
            "Bali couldn't find you in this class. It's checking your classes again."
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
        sync.queued.contains { $0.change.isUnlock } ? unsent : nil
    }

    public static let unsent =
        "Your Emergency Unlock hasn't reached your teacher yet. You can sign out once it has."

    /// The outbox file could not be read to say whether an unlock waits: nothing changed.
    public static let unread =
        "Bali can't read what your phone saved right now, so it can't sign you out yet. Try again in a moment."

    /// The Keychain could not forget the sign-in right now: nothing changed.
    public static let failed = "Bali couldn't sign you out. Try again."
}
