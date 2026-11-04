package com.bali.core

import java.security.SecureRandom
import java.time.Instant

/**
 * Event ids as the API's are written: a lower-case UUIDv7, minted by the phone when it acts,
 * offline too: the Unix time in milliseconds, then random bits (ARCHITECTURE, data model,
 * decision 2). BaliCore's `EventID`. Java's `UUID.randomUUID()` is a v4.
 */
object EventId {
    private val random = SecureRandom()
    private const val HEX = "0123456789abcdef"

    /**
     * An id of [at]'s millisecond, or, given [after], of the later of that and the millisecond past
     * the one [after] begins with, so it sorts after that id however far behind the phone's clock
     * stands: an answer replaces the one the server holds only when its id sorts after it (Live
     * lesson, decision 4). An [after] it can't read is passed over.
     */
    fun mint(at: Instant, after: String? = null): String {
        val bytes = ByteArray(16).also(random::nextBytes)
        var milliseconds = maxOf(0L, at.toEpochMilli())
        val held = after?.replace("-", "")?.take(12)?.toLongOrNull(16)
        if (held != null) milliseconds = maxOf(milliseconds, held + 1)
        for (index in 0 until 6) bytes[index] = (milliseconds shr (40 - 8 * index)).toByte()
        bytes[6] = (0x70 or (bytes[6].toInt() and 0x0F)).toByte() // version 7
        bytes[8] = (0x80 or (bytes[8].toInt() and 0x3F)).toByte() // variant 10
        return buildString {
            bytes.forEachIndexed { index, byte ->
                if (index == 4 || index == 6 || index == 8 || index == 10) append('-')
                append(HEX[byte.toInt() shr 4 and 0x0F]).append(HEX[byte.toInt() and 0x0F])
            }
        }
    }
}
