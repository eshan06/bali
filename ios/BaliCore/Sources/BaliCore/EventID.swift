import Foundation

/// Event ids as the API's are written: a lower-case UUIDv7, minted by the phone when it acts,
/// offline too — the Unix time in milliseconds, then random bits (ARCHITECTURE, data model,
/// decision 2). Foundation's `UUID` is a v4.
public enum EventID {
    /// An id of `now`'s millisecond — or, given `after`, of the later of that and the millisecond
    /// past the one `after` begins with, so it sorts after that id however far behind the phone's
    /// clock stands: an answer replaces the one the server holds only when its id sorts after it
    /// (Live lesson, decision 4).
    public static func mint(at now: Date, after held: String? = nil) -> String {
        var bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max) }
        var milliseconds = UInt64(max(0, now.timeIntervalSince1970 * 1000))
        if let held, let time = UInt64(held.replacing("-", with: "").prefix(12), radix: 16) {
            milliseconds = max(milliseconds, time + 1)
        }
        for index in 0..<6 {
            bytes[index] = UInt8(truncatingIfNeeded: milliseconds >> (40 - 8 * index))
        }
        bytes[6] = 0x70 | (bytes[6] & 0x0F)  // version 7
        bytes[8] = 0x80 | (bytes[8] & 0x3F)  // variant 10
        var text = bytes.map { String(format: "%02x", $0) }.joined()
        for offset in [20, 16, 12, 8] {
            text.insert("-", at: text.index(text.startIndex, offsetBy: offset))
        }
        return text
    }
}
