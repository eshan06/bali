import Foundation
import Testing

@testable import BaliCore

/// A well-known Text record holding `text`, as a tag writer writes one: a status byte, the language
/// code, then the text — UTF-8, or the UTF-16 `bytes` given.
private func text(_ text: String, language: String = "en", utf16 bytes: [UInt8]? = nil)
    -> BlockTag.Record
{
    let status = UInt8(language.utf8.count) | (bytes == nil ? 0 : 0x80)
    let payload = [status] + Array(language.utf8) + (bytes ?? Array(text.utf8))
    return BlockTag.Record(format: 1, type: Data("T".utf8), payload: Data(payload))
}

/// A well-known URI record: `start` abbreviating how the link begins, then `rest`.
private func uri(_ start: UInt8, _ rest: String) -> BlockTag.Record {
    BlockTag.Record(format: 1, type: Data("U".utf8), payload: Data([start] + Array(rest.utf8)))
}

@Suite("A Bali block's code, as its NFC tag carries it (B6)")
struct BlockTagTests {
    @Test(
        "The code v2 wrote on every block — ten letters and digits in a Text record — is the block's, whatever its case and the space around it, sent upper-case"
    )
    func textRecord() {
        #expect(BlockTag.code(in: [text("T7XK2M9QPF")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text(" t7xk2m9qpf\n")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text("T7XK2M9QPF", language: "en-US")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text("T7XK2M9QPF", language: "")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text("0123456789")]) == "0123456789")
    }

    @Test(
        "A UTF-16 Text record reads as well: big-endian with no byte order mark, or as its mark says"
    )
    func utf16() {
        let big = Array("T7XK2M9QPF".utf16).flatMap { [UInt8($0 >> 8), UInt8($0 & 0xFF)] }
        let little = Array("T7XK2M9QPF".utf16).flatMap { [UInt8($0 & 0xFF), UInt8($0 >> 8)] }
        #expect(BlockTag.code(in: [text("", utf16: big)]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text("", utf16: [0xFE, 0xFF] + big)]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text("", utf16: [0xFF, 0xFE] + little)]) == "T7XK2M9QPF")
        // Little-endian with no mark reads as big-endian: not a code.
        #expect(BlockTag.code(in: [text("", utf16: little)]) == nil)
        // Half a character.
        #expect(BlockTag.code(in: [text("", utf16: big.dropLast())]) == nil)
    }

    @Test(
        "A block's link — v2's QR link, https://<host>/t/<code>, or bali://t/<code> — carries its code too, however the record abbreviates how it begins"
    )
    func link() {
        #expect(BlockTag.code(in: [uri(0x04, "bali.app/t/T7XK2M9QPF")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [uri(0x02, "bali.app/t/t7xk2m9qpf/")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [uri(0x00, "https://bali.app/t/T7XK2M9QPF?from=qr")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [uri(0x00, "bali://t/T7XK2M9QPF")]) == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [uri(0x00, "BALI://T/t7xk2m9qpf")]) == "T7XK2M9QPF")
    }

    @Test(
        "Anything else is not a Bali block: another length, a character not an ASCII letter or digit, another link, another kind of record, or nothing at all",
        arguments: [
            [text("T7XK2M9QP")], [text("T7XK2M9QPFX")], [text("DEVICE-CHECK-1")],
            [text("T7XK2M9QPÉ")], [text("abcdefghß")], [text("T7XK 2M9QP")], [text("")],
            [text("ＴＴＴＴＴＴＴＴＴＴ")], [uri(0x04, "apple.com")], [uri(0x04, "bali.app/t/ABC")],
            [uri(0x04, "bali.app/s/T7XK2M9QPF")], [uri(0x04, "bali.app/t/T7XK2M9QPF/more")],
            [uri(0x04, "bali.app/x/t/T7XK2M9QPF")], [uri(0x03, "bali.app/t/T7XK2M9QPF")],
            [uri(0x05, "T7XK2M9QPF")], [uri(0x00, "http://bali.app/t/T7XK2M9QPF")],
            [uri(0x00, "bali://s/T7XK2M9QPF")], [uri(0x00, "T7XK2M9QPF")],
            // The code, but in a record of another format or type: a media type, an absolute URI.
            [BlockTag.Record(format: 2, type: Data("text/plain".utf8), payload: Data("T7XK2M9QPF".utf8))],
            [BlockTag.Record(format: 3, type: Data("bali://t/T7XK2M9QPF".utf8), payload: Data())],
            [BlockTag.Record(format: 1, type: Data("Sp".utf8), payload: Data("T7XK2M9QPF".utf8))],
            // A Text record too short for its own language code, and records with no payload.
            [BlockTag.Record(format: 1, type: Data("T".utf8), payload: Data([0x05, 0x65, 0x6E]))],
            [BlockTag.Record(format: 1, type: Data("T".utf8), payload: Data())],
            [BlockTag.Record(format: 1, type: Data("U".utf8), payload: Data())], [],
        ])
    func notABlock(records: [BlockTag.Record]) {
        #expect(BlockTag.code(in: records) == nil)
    }

    @Test("The first record that holds a code is the block's: records before it that hold none are passed over")
    func firstCode() {
        #expect(
            BlockTag.code(in: [uri(0x04, "bali.app"), text("hello"), text("T7XK2M9QPF")])
                == "T7XK2M9QPF")
        #expect(BlockTag.code(in: [text("W3RD8K2QAN"), text("T7XK2M9QPF")]) == "W3RD8K2QAN")
    }
}
