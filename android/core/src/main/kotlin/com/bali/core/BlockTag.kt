package com.bali.core

import java.net.URI
import java.net.URISyntaxException

/**
 * A Bali block's NFC tag, as a phone reads it (B6): the block is the code written on it, not the
 * chip: ten letters and digits, as v2 wrote them (`T7XK2M9QPF`), in a well-known Text record or at
 * the end of a URI record, `bali://t/<code>` or `https://<host>/t/<code>` (v2's QR link). Read
 * whatever its case, sent upper-case: the `tagId` a tap sends and a teacher registers. A tag with
 * nothing of the kind is not a Bali block: nothing is recorded for it. BaliCore's `BlockTag`.
 */
object BlockTag {
    /**
     * One NDEF record as the tag holds it: its type name format, its type and its payload, as
     * Android's `NdefRecord` gives them (`tnf`, `type`, `payload`), so `core` needs no Android.
     */
    class Record(val format: Short, val type: ByteArray, val payload: ByteArray)

    /** The block's code in [records]: the first record to hold one; none: not a Bali block. */
    fun code(records: List<Record>): String? = records.firstNotNullOfOrNull(::code)

    /**
     * The code in [record]: an NFC Forum well-known type (format 1), a Text record ("T") holding
     * it, or a URI record ("U") ending in it; none for anything else.
     */
    private fun code(record: Record): String? {
        if (record.format != WELL_KNOWN) return null
        return when (record.type.decodeToString()) {
            "T" -> text(record.payload)?.let(::code)
            "U" -> link(record.payload)?.let(::codeInLink)
            else -> null
        }
    }

    private const val WELL_KNOWN: Short = 1

    /**
     * A Text record's text: a status byte (its top bit set for UTF-16, its low six bits the length
     * of the language code that follows it), then the text.
     */
    private fun text(payload: ByteArray): String? {
        val status = payload.firstOrNull()?.toInt() ?: return null
        val start = 1 + (status and 0x3F)
        if (start > payload.size) return null
        val text = payload.copyOfRange(start, payload.size)
        if ((status and 0x80) == 0) return text.decodeToString()
        // UTF-16: big-endian unless its byte order mark says otherwise, as the record defines it.
        val little = text.startsWith(0xFF, 0xFE)
        val bytes = if (little || text.startsWith(0xFE, 0xFF)) text.copyOfRange(2, text.size) else text
        if (bytes.size % 2 != 0) return null
        return String(bytes, if (little) Charsets.UTF_16LE else Charsets.UTF_16BE)
    }

    private fun ByteArray.startsWith(first: Int, second: Int): Boolean =
        size >= 2 && this[0] == first.toByte() && this[1] == second.toByte()

    /**
     * A URI record's link: its first byte abbreviates how it begins (nothing, or one of the two ways
     * a block's link can; "http://", "tel:" and the rest begin none), then the rest, UTF-8.
     */
    private val linkStarts = mapOf(0x00 to "", 0x02 to "https://www.", 0x04 to "https://")

    private fun link(payload: ByteArray): String? {
        val start = payload.firstOrNull()?.let { linkStarts[it.toInt()] } ?: return null
        return start + payload.decodeToString(startIndex = 1)
    }

    /** The code at the end of a block's link: `bali://t/<code>`, or `https://<host>/t/<code>`. */
    private fun codeInLink(link: String): String? {
        val url = try {
            URI(link)
        } catch (error: URISyntaxException) {
            return null
        }
        val path = url.path.orEmpty().split('/').filter { it.isNotEmpty() }
        return when (url.scheme?.lowercase()) {
            "bali" if url.host?.lowercase() == "t" && path.size == 1 -> code(path[0])
            "https" if path.size == 2 && path[0].lowercase() == "t" -> code(path[1])
            else -> null
        }
    }

    /**
     * [text] as a block's code (ten ASCII letters and digits, whatever their case and the space
     * around them), upper-case; none: not one.
     */
    private fun code(text: String): String? {
        val code = text.trim { it.isSpace() }
        val lettersAndDigits = code.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' }
        return if (code.length == 10 && lettersAndDigits) code.uppercase() else null
    }

    /**
     * The space BaliCore trims, Foundation's `whitespacesAndNewlines` (its CFUniChar.c): Kotlin's
     * own `isWhitespace()` differs in six characters, U+001C to U+001F, U+0085 and U+200B.
     */
    private fun Char.isSpace(): Boolean =
        code in 0x09..0x0D || code in 0x2000..0x200B || code in spaces

    private val spaces = intArrayOf(0x20, 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000)
}

/**
 * What one scan of the phone's NFC reader found (B6), which the sync engine records only when it is
 * a block (`SyncEngine.tap(_:)`, AN5's): a Bali block's code; a tag with none; a scan the student
 * closed; a phone that can't read NFC; one whose NFC is switched off; or the reader's error, in the
 * system's words (shown, rule 5). BaliCore's `BlockRead`, with [NfcOff], Android's alone.
 */
sealed interface BlockRead {
    data class Block(val code: String) : BlockRead

    data object NotBali : BlockRead

    data object Cancelled : BlockRead

    data object Unsupported : BlockRead

    /**
     * NFC switched off in the phone's settings, before the scan or during it: Android's alone, since
     * iOS's reader can't be switched off. The screens say it and ask for it on (AN10's words, AS4's
     * screen); nothing is recorded.
     */
    data object NfcOff : BlockRead

    data class Failed(val message: String) : BlockRead
}
