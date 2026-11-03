package com.bali.spike

import java.net.URI

/**
 * A Bali block's NFC tag, as BaliCore reads it (`ios/BaliCore/Sources/BaliCore/BlockTag.swift`,
 * B6), ported for part 2's read: the code written on it, ten letters and digits, in a well-known
 * Text record or at the end of a URI record, `bali://t/<code>` or `https://<host>/t/<code>`. Read
 * whatever its case, sent upper-case. Anything else is not a Bali block. AN3 ports it for real.
 */
object BlockTag {
    class Record(val format: Int, val type: ByteArray, val payload: ByteArray)

    /** The block's code in [records]: the first record to hold one; null, not a Bali block. */
    fun code(records: List<Record>): String? = records.firstNotNullOfOrNull { codeOf(it) }

    private fun codeOf(record: Record): String? {
        if (record.format != 1) return null
        return when (String(record.type, Charsets.UTF_8)) {
            "T" -> text(record.payload)?.let { codeOf(it) }
            "U" -> link(record.payload)?.let { codeInLink(it) }
            else -> null
        }
    }

    /** A Text record's text: a status byte (top bit UTF-16, low six bits the language's length). */
    fun text(payload: ByteArray): String? {
        if (payload.isEmpty()) return null
        val status = payload[0].toInt() and 0xFF
        val start = 1 + (status and 0x3F)
        if (start > payload.size) return null
        val text = payload.copyOfRange(start, payload.size)
        if (status and 0x80 == 0) return String(text, Charsets.UTF_8)
        val little = text.size >= 2 && text[0] == 0xFF.toByte() && text[1] == 0xFE.toByte()
        val big = text.size >= 2 && text[0] == 0xFE.toByte() && text[1] == 0xFF.toByte()
        val bytes = if (little || big) text.copyOfRange(2, text.size) else text
        if (bytes.size % 2 != 0) return null
        return String(bytes, if (little) Charsets.UTF_16LE else Charsets.UTF_16BE)
    }

    private val linkStarts = mapOf(0x00 to "", 0x02 to "https://www.", 0x04 to "https://")

    /** A URI record's link: its first byte abbreviates how it begins, then the rest in UTF-8. */
    fun link(payload: ByteArray): String? {
        if (payload.isEmpty()) return null
        val start = linkStarts[payload[0].toInt() and 0xFF] ?: return null
        return start + String(payload, 1, payload.size - 1, Charsets.UTF_8)
    }

    /** The code at the end of a block's link: `bali://t/<code>`, or `https://<host>/t/<code>`. */
    fun codeInLink(link: String): String? {
        val uri = try {
            URI(link)
        } catch (e: Exception) {
            return null
        }
        val path = (uri.path ?: "").split('/').filter { it.isNotEmpty() }
        return when (uri.scheme?.lowercase()) {
            "bali" -> if (uri.host?.lowercase() == "t" && path.size == 1) codeOf(path[0]) else null
            "https" -> if (path.size == 2 && path[0].lowercase() == "t") codeOf(path[1]) else null
            else -> null
        }
    }

    /** [text] as a block's code: ten ASCII letters and digits, whatever their case and the space round them. */
    fun codeOf(text: String): String? {
        val code = text.trim()
        val ok = code.length == 10 && code.all { it.code < 128 && it.isLetterOrDigit() }
        return if (ok) code.uppercase() else null
    }
}
