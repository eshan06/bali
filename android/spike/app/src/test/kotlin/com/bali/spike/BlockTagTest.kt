package com.bali.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** BaliCore's BlockTagTests (`ios/BaliCore/Tests/BaliCoreTests/BlockTagTests.swift`), ported. */
class BlockTagTest {
    private fun text(text: String, language: String = "en", utf16: ByteArray? = null): BlockTag.Record {
        val status = (language.toByteArray().size or (if (utf16 == null) 0 else 0x80)).toByte()
        val payload = byteArrayOf(status) + language.toByteArray() + (utf16 ?: text.toByteArray())
        return BlockTag.Record(1, "T".toByteArray(), payload)
    }

    private fun uri(start: Int, rest: String) =
        BlockTag.Record(1, "U".toByteArray(), byteArrayOf(start.toByte()) + rest.toByteArray())

    private fun record(format: Int, type: String, payload: String) =
        BlockTag.Record(format, type.toByteArray(), payload.toByteArray())

    @Test
    fun textRecord() {
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("T7XK2M9QPF"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text(" t7xk2m9qpf\n"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("T7XK2M9QPF", language = "en-US"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("T7XK2M9QPF", language = ""))))
        assertEquals("0123456789", BlockTag.code(listOf(text("0123456789"))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(record(1, "T", "BenT7XK2M9QPF"))))
    }

    @Test
    fun utf16() {
        val units = "T7XK2M9QPF".toCharArray()
        val big = units.flatMap { listOf((it.code shr 8).toByte(), (it.code and 0xFF).toByte()) }.toByteArray()
        val little = units.flatMap { listOf((it.code and 0xFF).toByte(), (it.code shr 8).toByte()) }.toByteArray()
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("", utf16 = big))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("", utf16 = byteArrayOf(-2, -1) + big))))
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(text("", utf16 = byteArrayOf(-1, -2) + little))))
        assertNull(BlockTag.code(listOf(text("", utf16 = little))))
        assertNull(BlockTag.code(listOf(text("", utf16 = big.copyOf(big.size - 1)))))
    }

    @Test
    fun link() {
        for (link in listOf(
            uri(0x04, "bali.app/t/T7XK2M9QPF"), uri(0x02, "bali.app/t/t7xk2m9qpf/"),
            uri(0x00, "https://bali.app/t/T7XK2M9QPF?from=qr"), uri(0x00, "bali://t/T7XK2M9QPF"),
            uri(0x00, "BALI://T/t7xk2m9qpf"), uri(0x04, "BALI.APP/T/T7XK2M9QPF"),
        )) {
            assertEquals("T7XK2M9QPF", BlockTag.code(listOf(link)))
        }
    }

    @Test
    fun notABlock() {
        val cases = listOf(
            listOf(text("T7XK2M9QP")), listOf(text("T7XK2M9QPFX")), listOf(text("DEVICE-CHECK-1")),
            listOf(text("T7XK2M9QPÉ")), listOf(text("abcdefghß")), listOf(text("T7XK 2M9QP")), listOf(text("")),
            listOf(text("ＴＴＴＴＴＴＴＴＴＴ")), listOf(uri(0x04, "apple.com")), listOf(uri(0x04, "bali.app/t/ABC")),
            listOf(uri(0x04, "bali.app/s/T7XK2M9QPF")), listOf(uri(0x04, "bali.app/t/T7XK2M9QPF/more")),
            listOf(uri(0x04, "bali.app/x/t/T7XK2M9QPF")), listOf(uri(0x03, "bali.app/t/T7XK2M9QPF")),
            listOf(uri(0x05, "T7XK2M9QPF")), listOf(uri(0x00, "http://bali.app/t/T7XK2M9QPF")),
            listOf(uri(0x00, "bali://s/T7XK2M9QPF")), listOf(uri(0x00, "T7XK2M9QPF")),
            listOf(record(2, "text/plain", "T7XK2M9QPF")), listOf(record(2, "T", "\u0002enT7XK2M9QPF")),
            listOf(record(3, "bali://t/T7XK2M9QPF", "")), listOf(record(4, "bali.app:t", "T7XK2M9QPF")),
            listOf(record(1, "Sp", "T7XK2M9QPF")),
            listOf(record(1, "T", "\u0005en")), listOf(record(1, "T", "")), listOf(record(1, "U", "")), listOf(),
        )
        for (records in cases) assertNull(BlockTag.code(records))
    }

    @Test
    fun firstCode() {
        assertEquals("T7XK2M9QPF", BlockTag.code(listOf(uri(0x04, "bali.app"), text("hello"), text("T7XK2M9QPF"))))
        assertEquals("W3RD8K2QAN", BlockTag.code(listOf(text("W3RD8K2QAN"), text("T7XK2M9QPF"))))
    }
}
