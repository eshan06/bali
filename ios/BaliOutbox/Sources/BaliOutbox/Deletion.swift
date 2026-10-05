import BaliCore
import Foundation

/// Where Me's Delete account stands (C4): `SyncEngine.deleteAccount`'s answer, in states — the Me
/// screen puts them in words (C4b), each failure with a way to try again (rule 5).
public enum AccountDeletion: Sendable, Hashable {
    /// Done: the account deleted, and its Cognito sign-in; the phone signed out, in no session.
    case deleted
    /// This sign-in cannot delete itself: made before the phone asked for the scope Cognito's
    /// DeleteUser needs, or no sign-in can be read now. A fresh sign-in first; nothing sent or deleted.
    case signInFirst
    /// An Emergency Unlock the server has not recorded: it lands first — never let go, and never sent
    /// once the account is gone. Nothing deleted.
    case unlockUnsent
    /// The outbox file could not be read, so whether an unlock waits is not known. Nothing deleted.
    case unread
    /// A teacher with a class or a block (`409 teacher_has_classes`): the school deletes that account.
    case teacherHasClasses
    /// The last answer, when something else the phone queued, or the deletion itself, got none that
    /// settled it: nothing deleted that the phone knows of — though a deletion with no answer may
    /// have landed, which a try again settles, deleting too any account a read has made since (C3).
    case notDeleted(SendResult)
    /// The account is deleted on the server, but not its Cognito sign-in: what Cognito answered. The
    /// sign-in is kept to try again, and gives the API no token meanwhile.
    case signInNotDeleted(SendResult)
}

/// Me's Delete account as the phone keeps it (C4b): the question asked under the button; the
/// deletion under way; where one stopped, in words, with its way on (rule 5); and done. From the
/// press to the end the app shows the deletion's own screen and nothing else (`Screen.deleting`,
/// `shows`): a join or a rename landing after the deletion would make a fresh account, a tap or an
/// Emergency Unlock made meanwhile would wait for the next sign-in, and Sign out while DeleteUser
/// waits would leave the person in Cognito (`docs/DECISIONS.md`, C4a). Its rules and words, so
/// they run on Linux; the app makes the call (`Phone.deleteAccount`).
public enum Deleting: Sendable, Hashable {
    /// Nothing under way: Me shows the button.
    case none
    /// Delete account pressed: Me asks under the button, with Delete account and Cancel.
    case asking
    /// The deletion under way: its screen, with nothing to press until the answer comes.
    case busy
    /// Stopped with nothing deleted that the phone knows of: the title and why, said on its screen,
    /// with Try again where another try can help, and Back.
    case stopped(title: String, why: String, retries: Bool)
    /// The account deleted, its sign-in not yet (`signInNotDeleted`, or `SignIn.deletionPending`
    /// at a relaunch): its screen, with Try again alone, until the sign-in is deleted too.
    case pending
    /// Deleted, the sign-in too: the done screen, until OK.
    case done

    /// Whether the deletion's own screen shows, over every other (`Screen.choose`).
    public var shows: Bool {
        switch self {
        case .none, .asking: false
        case .busy, .stopped, .pending, .done: true
        }
    }

    /// Delete account pressed on Me: its question asked. Nothing once anything is under way.
    public mutating func ask() {
        if case .none = self { self = .asking }
    }

    /// Cancel under the question: no question.
    public mutating func cancel() {
        if case .asking = self { self = .none }
    }

    /// Delete account under the question, or Try again on the screen: true once the deletion may
    /// begin, busy until its answer; false where nothing may — a try that cannot help, nothing
    /// asked, one under way already.
    public mutating func start() -> Bool {
        switch self {
        case .asking, .stopped(_, _, retries: true), .pending:
            self = .busy
            return true
        case .none, .busy, .stopped(_, _, retries: false), .done: return false
        }
    }

    /// The engine's answer to the deletion under way; one to no deletion is dropped.
    public mutating func answered(_ answer: AccountDeletion) {
        guard case .busy = self else { return }
        switch answer {
        case .deleted: self = .done
        case .signInNotDeleted: self = .pending
        case .signInFirst:
            self = .stopped(title: Self.notDeleted, why: Self.signInFirst, retries: false)
        case .teacherHasClasses:
            self = .stopped(title: Self.notDeleted, why: Self.teacherHasClasses, retries: false)
        case .unlockUnsent:
            self = .stopped(title: Self.notDeleted, why: Self.unlockUnsent, retries: true)
        case .unread: self = .stopped(title: Self.notDeleted, why: Self.unread, retries: true)
        // Nothing deleted that the phone knows of: a deletion whose answer was lost may have landed
        // (C4a), so the title claims neither, and Try again settles it.
        case .notDeleted(let result):
            self = .stopped(title: Self.notFinished, why: Joining.words(result, nil), retries: true)
        }
    }

    /// Back after a stop that deleted nothing, or OK once done: the screen goes. Nothing while the
    /// deletion runs or its sign-in waits to be deleted, which offer no way out but Try again.
    public mutating func close() {
        switch self {
        case .stopped, .done: self = .none
        case .none, .asking, .busy, .pending: break
        }
    }

    /// Who is signed in changed (`Phone.signed`): the question and a stop go with them — the words
    /// were the last sign-in's. The deletion under way, a sign-in waiting to be deleted and the done
    /// screen hold: the deletion's own end is such a change, and its answer is still to come.
    public mutating func signInChanged() {
        switch self {
        case .asking, .stopped: self = .none
        case .none, .busy, .pending, .done: break
        }
    }

    /// What its screen says: the title and the line under it; nil while no screen shows.
    public var said: (title: String, body: String)? {
        switch self {
        case .none, .asking: nil
        case .busy:
            (
                "Deleting your account…",
                "Bali deletes your account first, then your sign-in. This takes a moment."
            )
        case .stopped(let title, let why, _): (title, why)
        case .pending:
            (
                "Your account is deleted",
                "Bali's part is done, but your sign-in isn't deleted yet. Try again to finish."
            )
        case .done:
            (
                "Your account is deleted",
                "Your sign-in is gone too. If you join Bali again, you start fresh."
            )
        }
    }

    /// The question asked under Me's button (the owner's words, 2026-10-05).
    public static let question = "Delete your account?"
    public static let consequence =
        "Bali deletes your account, your name and your sign-in. This can't be undone. Lessons you were in still count in your teachers' reports, with no name on them. If a class is running, you leave it now and your apps unlock. It isn't an Emergency Unlock."

    /// The title of a stop before anything was sent: nothing deleted, for certain.
    public static let notDeleted = "Your account isn't deleted"
    /// The title of a stop at the deletion's own answer, or none: a deletion whose answer was lost
    /// may have landed (C4a), so this claims neither.
    public static let notFinished = "Bali couldn't finish deleting your account"

    /// The sign-in was made before the phone asked for the scope Cognito's DeleteUser needs: a
    /// fresh one first. Nothing sent, nothing deleted.
    static let signInFirst =
        "Your sign-in is from an older version of Bali, so it can't delete your account. Sign out and sign in again, then delete your account."
    /// An Emergency Unlock the server has not recorded: the next try sends it first.
    static let unlockUnsent =
        "Your Emergency Unlock hasn't reached your teacher yet. Check your connection and try again."
    /// The outbox file could not be read, so whether an unlock waits is not known.
    static let unread =
        "Bali can't read what your phone saved right now, so it can't delete your account yet. Try again in a moment."
    /// A teacher with a class or a block (`409 teacher_has_classes`): no try here can help.
    static let teacherHasClasses =
        "A teacher's account with classes or blocks is deleted through your school. Ask your school to arrange it."
}

extension OutboxRecord {
    /// A tap the server refused: kept and retried (tap step 10), but never one it recorded, so it
    /// holds no account deletion back (C4).
    var refusedForGood: Bool {
        if case .tap = change { refusedStatus != nil } else { false }
    }
}

extension Outbox {
    /// The next record to send before an account deletion (C4), none of `tried`: every Emergency
    /// Unlock first — the server places each against what the phone did by its order (A12) — but one
    /// filed under a tap still queued, which goes after that tap, as the drain sends it (decision 11).
    /// Then the rest in the order the phone acted, as `nextDue` takes them: a record tried and still
    /// pending holds those behind it, a refocus waits for its unlock, and an unlock not filed goes
    /// nowhere.
    func nextBeforeDeletion(tried: Set<String>) throws -> OutboxRecord? {
        let records = try records()
        let queued = Set(records.map(\.eventId))
        let sendable = { (record: OutboxRecord) in
            !tried.contains(record.eventId) && !record.change.isUnfiled
                && !(record.follows.map(queued.contains) ?? false)
        }
        let first = records.first { record in
            guard sendable(record), record.change.isUnlock else { return false }
            if case .unlockUnderTap(let tap, _) = record.change { return !queued.contains(tap) }
            return true
        }
        if let first { return first }
        for record in records {
            if sendable(record) { return record }
            if tried.contains(record.eventId), !record.stuck { return nil }
        }
        return nil
    }

    /// The API has deleted the account (C4): every record queued but an Emergency Unlock is let go —
    /// the deleted account's, which any later send would put under a fresh account, or under whoever
    /// signs in next. An unlock never is; the deletion waits for every one first.
    public func accountDeleted() throws {
        try pool.write { try $0.execute(sql: "DELETE FROM outbox WHERE kind != 'unlock'") }
    }
}
