import Foundation

/// A Bali block's NFC tag, as a phone reads it (B6): the block is the code written on it, not the
/// chip — ten letters and digits, as v2 wrote them (`T7XK2M9QPF`), in a well-known Text record or
/// at the end of a URI record, `bali://t/<code>` or `https://<host>/t/<code>` (v2's QR link). Read
/// whatever its case, sent upper-case: the `tagId` a tap sends and a teacher registers. A tag with
/// nothing of the kind is not a Bali block: nothing is recorded for it.
public enum BlockTag {
    /// One NDEF record as the tag holds it: its type name format, its type and its payload.
    public struct Record: Sendable, Hashable {
        public let format: UInt8
        public let type: Data
        public let payload: Data
        public init(format: UInt8, type: Data, payload: Data) {
            (self.format, self.type, self.payload) = (format, type, payload)
        }
    }

    /// The block's code in `records` — the first record to hold one; nil: not a Bali block.
    public static func code(in records: [Record]) -> String? {
        records.lazy.compactMap(code(of:)).first
    }

    /// The code in `record`: an NFC Forum well-known type (format 1), a Text record ("T") holding
    /// it, or a URI record ("U") ending in it; nil for anything else.
    static func code(of record: Record) -> String? {
        guard record.format == 1 else { return nil }
        switch String(decoding: record.type, as: UTF8.self) {
        case "T": return text(record.payload).flatMap(code(_:))
        case "U": return link(record.payload).flatMap(code(inLink:))
        default: return nil
        }
    }

    /// A Text record's text: a status byte — its top bit set for UTF-16, its low six bits the
    /// length of the language code that follows it — then the text.
    static func text(_ payload: Data) -> String? {
        guard let status = payload.first else { return nil }
        let start = payload.startIndex + 1 + Int(status & 0x3F)
        guard start <= payload.endIndex else { return nil }
        let text = Array(payload[start...])
        guard status & 0x80 != 0 else { return String(decoding: text, as: UTF8.self) }
        // UTF-16: big-endian unless its byte order mark says otherwise, as the record defines it.
        let little = text.starts(with: [0xFF, 0xFE])
        let bytes = Array(text.dropFirst(little || text.starts(with: [0xFE, 0xFF]) ? 2 : 0))
        guard bytes.count % 2 == 0 else { return nil }
        let units = stride(from: 0, to: bytes.count, by: 2).map { index in
            let (first, second) = (UInt16(bytes[index]), UInt16(bytes[index + 1]))
            return little ? second << 8 | first : first << 8 | second
        }
        return String(decoding: units, as: UTF16.self)
    }

    /// A URI record's link: its first byte abbreviates how it begins — nothing, or one of the two
    /// ways a block's link can ("http://", "tel:" and the rest begin none) — then the rest, UTF-8.
    static let linkStarts: [UInt8: String] = [0x00: "", 0x02: "https://www.", 0x04: "https://"]
    static func link(_ payload: Data) -> String? {
        guard let first = payload.first, let start = linkStarts[first] else { return nil }
        return start + String(decoding: payload.dropFirst(), as: UTF8.self)
    }

    /// The code at the end of a block's link: `bali://t/<code>`, or `https://<host>/t/<code>`.
    static func code(inLink link: String) -> String? {
        guard let url = URLComponents(string: link) else { return nil }
        let path = url.path.split(separator: "/").map(String.init)
        switch url.scheme?.lowercased() {
        case "bali" where url.host?.lowercased() == "t" && path.count == 1: return code(path[0])
        case "https" where path.count == 2 && path[0].lowercased() == "t": return code(path[1])
        default: return nil
        }
    }

    /// `text` as a block's code — ten ASCII letters and digits, whatever their case and the space
    /// around them — upper-case; nil: not one.
    static func code(_ text: String) -> String? {
        let code = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lettersAndDigits = code.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return code.utf8.count == 10 && lettersAndDigits ? code.uppercased() : nil
    }
}

/// What one scan of the phone's NFC reader found (B6), which the sync engine records only when it
/// is a block (`SyncEngine.tap(_:)`): a Bali block's code; a tag with none; a scan the student
/// closed; a phone that cannot read NFC; or the reader's error, in iOS's words (shown, rule 5).
public enum BlockRead: Sendable, Hashable {
    case block(String), notBali, cancelled, unsupported, failed(String)
}
