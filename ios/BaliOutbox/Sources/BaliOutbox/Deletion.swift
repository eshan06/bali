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
