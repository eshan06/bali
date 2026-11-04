package com.bali.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A well-known Text record holding [text], as a tag writer writes one: a status byte, the language
 * code, then the text: UTF-8, or the UTF-16 [utf16] given.
 */
private fun text(text: String, language: String = "en", utf16: ByteArray? = null): BlockTag.Record {
    val status = language.encodeToByteArray().size or (if (utf16 == null) 0 else 0x80)
    val payload = byteArrayOf(status.toByte()) + language.encodeToByteArray() + (utf16 ?: text.encodeToByteArray())
    return BlockTag.Record(1, "T".encodeToByteArray(), payload)
}

/** A well-known URI record: [start] abbreviating how the link begins, then [rest]. */
private fun uri(start: Int, rest: String): BlockTag.Record =
    BlockTag.Record(1, "U".encodeToByteArray(), byteArrayOf(start.toByte()) + rest.encodeToByteArray())

/** A record of the type name format [format], of type [type], holding [payload]. */
private fun record(format: Short, type: String, payload: String): BlockTag.Record =
    BlockTag.Record(format, type.encodeToByteArray(), payload.encodeToByteArray())

/** [records] in words, for a failure's message. */
private fun describe(records: List<BlockTag.Record>): String =
    records.joinToString(prefix = "[", postfix = "]") {
        val payload = it.payload.joinToString(" ") { byte -> (byte.toInt() and 0xFF).toString(16).padStart(2, '0') }
        "${it.format} ${it.type.decodeToString()} $payload"
    }

/** A Bali block's code, as its NFC tag carries it (B6): BlockTagTests.swift's port. */
class BlockTagTest {
    @Test
    fun theCodeV2WroteOnEveryBlockInATextRecordIsTheBlocksWhateverItsCaseAndTheSpaceAroundItSentUpperCase() {
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("T7XK2M9QPF"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text(" t7xk2m9qpf\n"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("T7XK2M9QPF", language = "en-US"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("T7XK2M9QPF", language = ""))))
        assertEquals("0123456789", BlockTag.code(listOf(text("0123456789"))))
        // The status byte's reserved bit set (0x42): the language code's length is its low six bits still.
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(record(1, "T", "${Char(0x42)}enT7XK2M9QPF"))))
    }

    @Test
    fun theSpaceTrimmedAroundACodeIsFoundationsAsBaliCoreTrimsItNotKotlins() {
        fun around(before: Int, after: Int) = listOf(text("${Char(before)}T7XK2M9QPF${Char(after)}"))
        // Foundation's whitespacesAndNewlines holds a next line (0x85) and a zero-width space
        // (0x200B), which Kotlin's isWhitespace() doesn't...
        val spaces = listOf(0x85 to 0x200B, 0x3000 to 0x2028, 0x09 to 0xA0, 0x1680 to 0x202F, 0x2000 to 0x205F)
        for ((before, after) in spaces) {
            assertEquals("T7XK2M9QPF", BlockTag.code(around(before, after)), "${before.toString(16)} ${after.toString(16)}")
        }
        // ...and none of the separators Kotlin's counts as space: no code.
        for (separator in 0x1C..0x1F) assertNull(BlockTag.code(around(separator, 0x20)), separator.toString(16))
    }

    @Test
    fun aUtf16TextRecordReadsAsWellBigEndianWithNoByteOrderMarkOrAsItsMarkSays() {
        val big = "T7XK2M9QPF".encodeToByteArray().flatMap { listOf(0.toByte(), it) }.toByteArray()
        val little = "T7XK2M9QPF".encodeToByteArray().flatMap { listOf(it, 0.toByte()) }.toByteArray()
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("", utf16 = big))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("", utf16 = byteArrayOf(0xFE.toByte(), 0xFF.toByte()) + big))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("", utf16 = byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + little))))
        // Little-endian with no mark reads as big-endian: not a code.
        assertNull(BlockTag.code(listOf(text("", utf16 = little))))
        // Half a character.
        assertNull(BlockTag.code(listOf(text("", utf16 = big.copyOf(big.size - 1)))))
    }

    @Test
    fun aBlocksLinkV2sQrLinkOrBaliTCodeCarriesItsCodeTooHoweverTheRecordAbbreviatesHowItBegins() {
        val links =
            listOf(
                uri(0x04, "bali.app/t/T7XK2M9QPF"), uri(0x02, "bali.app/t/t7xk2m9qpf/"),
                uri(0x00, "https://bali.app/t/T7XK2M9QPF?from=qr"), uri(0x00, "bali://t/T7XK2M9QPF"),
                uri(0x00, "BALI://T/t7xk2m9qpf"), uri(0x04, "BALI.APP/T/T7XK2M9QPF"),
            )
        for (link in links) assertEquals("T7XK2M9QPF", BlockTag.code(listOf(link)), describe(listOf(link)))
    }

    @Test
    fun anythingElseIsNotABaliBlockAnotherLengthCharacterLinkOrKindOfRecordOrNothingAtAll() {
        val cases =
            listOf(
                listOf(text("T7XK2M9QP")), listOf(text("T7XK2M9QPFX")), listOf(text("DEVICE-CHECK-1")),
                listOf(text("T7XK2M9QPÉ")), listOf(text("abcdefghß")), listOf(text("T7XK 2M9QP")), listOf(text("")),
                listOf(text("ＴＴＴＴＴＴＴＴＴＴ")), listOf(uri(0x04, "apple.com")), listOf(uri(0x04, "bali.app/t/ABC")),
                listOf(uri(0x04, "bali.app/s/T7XK2M9QPF")), listOf(uri(0x04, "bali.app/t/T7XK2M9QPF/more")),
                listOf(uri(0x04, "bali.app/x/t/T7XK2M9QPF")), listOf(uri(0x03, "bali.app/t/T7XK2M9QPF")),
                listOf(uri(0x05, "T7XK2M9QPF")), listOf(uri(0x00, "http://bali.app/t/T7XK2M9QPF")),
                listOf(uri(0x00, "bali://s/T7XK2M9QPF")), listOf(uri(0x00, "T7XK2M9QPF")),
                // The code, but in a record of another format or type: a media type (one named "T"
                // too), an absolute URI, an external type, a smart poster.
                listOf(record(2, "text/plain", "T7XK2M9QPF")), listOf(record(2, "T", "${Char(2)}enT7XK2M9QPF")),
                listOf(record(3, "bali://t/T7XK2M9QPF", "")), listOf(record(4, "bali.app:t", "T7XK2M9QPF")),
                listOf(record(1, "Sp", "T7XK2M9QPF")),
                // A Text record too short for its own language code, and records with no payload.
                listOf(record(1, "T", "${Char(5)}en")), listOf(record(1, "T", "")), listOf(record(1, "U", "")), listOf(),
            )
        val read = cases.filter { BlockTag.code(it) != null }
        assertTrue(read.isEmpty(), read.joinToString("\n") { "${describe(it)} read as ${BlockTag.code(it)}" })
    }

    @Test
    fun theFirstRecordThatHoldsACodeIsTheBlocksRecordsBeforeItThatHoldNoneArePassedOver() {
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(uri(0x04, "bali.app"), text("hello"), text("T7XK2M9QPF"))))
        assertEquals("W3RD8K2QAN", BlockTag.code(listOf(text("W3RD8K2QAN"), text("T7XK2M9QPF"))))
    }
}
