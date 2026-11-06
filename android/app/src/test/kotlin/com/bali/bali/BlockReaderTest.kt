package com.bali.bali

import com.bali.core.BlockRead
import com.bali.core.BlockTag
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** A well-known Text record holding [text], as a tag writer writes one (BlockTagTest's): its status byte, "en", the text. */
private fun text(text: String) = BlockTag.Record(1, "T".encodeToByteArray(), byteArrayOf(2) + "en".encodeToByteArray() + text.encodeToByteArray())

/** A well-known URI record, its "https://" abbreviated as a tag writer writes it, then [rest]. */
private fun link(rest: String) = BlockTag.Record(1, "U".encodeToByteArray(), byteArrayOf(4) + rest.encodeToByteArray())

/**
 * A scan's rules on the JVM ([scan], over a reader of the test's own): the phones on which none begins, one at a
 * time, its answer the first of a tag's read, Bali's screen leaving the front and NFC switched off, a tag with no
 * NDEF passed over, the reader stopped however it ends, and Android's refusals answered, never thrown. What a tag
 * holds is BlockTagTest's; Android's reader mode and a real tag are the phone check's (docs/ANDROID-PHONE-TESTS.md,
 * AN8), and a phone with no NFC the emulators' too (ReadoutTest).
 */
class BlockReaderTest {
    /** A reader the test drives: what it says of the phone, and, once started, the scan's ears, which the test calls. */
    private class Fake(
        override var present: Boolean = true,
        var switchedOn: Boolean = true,
        override var inFront: Boolean = true,
        /** What starting throws, as Android's reader mode may refuse to start. */
        val refuses: RuntimeException? = null,
        /** What stopping throws, as Android's NFC service gone does. */
        val stopFails: RuntimeException? = null,
    ) : Reader {
        var starts = 0
        var stops = 0
        lateinit var tag: (List<BlockTag.Record>?) -> Unit
        lateinit var left: () -> Unit
        lateinit var off: () -> Unit

        /** What reading the switch throws, as Android's NFC service gone does. */
        var switchFails: RuntimeException? = null

        override val on: Boolean get() = switchFails?.let { throw it } ?: switchedOn

        /** What happens as it starts, once it listens: NFC switched off just then, say. */
        var starting: () -> Unit = {}

        override fun start(tag: (List<BlockTag.Record>?) -> Unit, left: () -> Unit, off: () -> Unit) {
            starts++
            refuses?.let { throw it }
            this.tag = tag
            this.left = left
            this.off = off
            starting()
        }

        override fun stop() {
            stops++
            stopFails?.let { throw it }
        }
    }

    /** A scan over [reader], run until it waits for its answer. */
    private fun CoroutineScope.begun(reader: Fake) = async(start = CoroutineStart.UNDISPATCHED) { scan(reader) }

    /** [test], failing by name on a scan that never answers, never hanging; its scans ended either way. */
    private fun bounded(test: suspend CoroutineScope.() -> Unit) = runBlocking { withTimeout(10.seconds) { test() } }

    @Test
    fun aPhoneWithNoNfcCantReadOneWithItSwitchedOffReadsNfcOffAndNoScanBeginsBehindAnotherApp(): Unit =
        bounded {
            // A phone with no NFC first, whatever else holds, as on iOS; then the switch, Android's alone; then the front.
            val phones =
                listOf(
                    Fake(present = false, switchedOn = false, inFront = false) to BlockRead.Unsupported,
                    Fake(switchedOn = false, inFront = false) to BlockRead.NfcOff,
                    Fake(inFront = false) to BlockRead.Cancelled,
                )
            for ((reader, read) in phones) {
                assertEquals(read, scan(reader))
                // Never started, so never stopped.
                assertEquals(0 to 0, reader.starts to reader.stops, "$read")
            }
        }

    @Test
    fun aBlocksCodeIsTheScansAnswerTheReaderStoppedAndWhatItHearsAfterIsDropped(): Unit =
        bounded {
            val reader = Fake()
            val scan = begun(reader)
            assertEquals(1 to 0, reader.starts to reader.stops)
            assertFalse(scan.isCompleted)
            reader.tag(listOf(text("t7xk2m9qpf")))
            assertEquals(BlockRead.Block("T7XK2M9QPF"), scan.await())
            assertEquals(1, reader.stops)
            // The first answer only: another tag, the screen leaving the front, NFC switched off, all after it.
            reader.tag(listOf(text("W3RD8K2QAN")))
            reader.left()
            reader.off()
            assertEquals(BlockRead.Block("T7XK2M9QPF"), scan.await())
            assertEquals(1, reader.stops)
            // A block's link is its code too.
            val linked = Fake()
            val read = begun(linked)
            linked.tag(listOf(link("bali.test/t/W3RD8K2QAN")))
            assertEquals(BlockRead.Block("W3RD8K2QAN"), read.await())
        }

    @Test
    fun aTagWithNoBlocksCodeIsNotABaliBlockAnEmptyOneAmongThem(): Unit =
        bounded {
            for (records in listOf(emptyList(), listOf(text("DEVICE-CHECK-1")), listOf(link("example.com/menu")))) {
                val reader = Fake()
                val scan = begun(reader)
                reader.tag(records)
                assertEquals(BlockRead.NotBali, scan.await(), "${records.size} records")
                assertEquals(1, reader.stops)
            }
        }

    @Test
    fun aTagWithNoNdefOnItIsPassedOverAsOnIosSoTheBlockAfterItIsRead(): Unit =
        bounded {
            // A bank card kept in the phone's case, found as the reader starts: the scan goes on.
            val reader = Fake()
            val scan = begun(reader)
            reader.tag(null)
            reader.tag(null)
            assertFalse(scan.isCompleted)
            assertEquals(0, reader.stops)
            reader.tag(listOf(text("T7XK2M9QPF")))
            assertEquals(BlockRead.Block("T7XK2M9QPF"), scan.await())
            assertEquals(1, reader.stops)
        }

    @Test
    fun baliLeavingTheFrontCancelsTheScanAndNfcSwitchedOffEndsItEvenAsTheReaderStarts(): Unit =
        bounded {
            val left = Fake()
            val leaving = begun(left)
            left.left()
            assertEquals(BlockRead.Cancelled, leaving.await())
            val off = Fake()
            val switching = begun(off)
            off.off()
            assertEquals(BlockRead.NfcOff, switching.await())
            // Switched off after the scan checked the switch, before the reader heard it: read again once it listens.
            val late = Fake().apply { starting = { switchedOn = false } }
            assertEquals(BlockRead.NfcOff, scan(late))
            for (reader in listOf(left, off, late)) assertEquals(1 to 1, reader.starts to reader.stops)
        }

    @Test
    fun oneScanAtATimeAnotherAskedMeanwhileSaysOneIsUnderWayAndLeavesTheFirstAlone(): Unit =
        bounded {
            val first = Fake()
            val scanning = begun(first)
            val second = Fake()
            assertEquals(BlockRead.Failed("A scan is under way."), scan(second))
            assertEquals(0 to 0, second.starts to second.stops)
            // The first goes on to its answer, and once it has one a scan begins again.
            assertEquals(0, first.stops)
            first.tag(listOf(text("T7XK2M9QPF")))
            assertEquals(BlockRead.Block("T7XK2M9QPF"), scanning.await())
            val again = Fake()
            val next = begun(again)
            assertEquals(1, again.starts)
            again.left()
            assertEquals(BlockRead.Cancelled, next.await())
        }

    @Test
    fun theCallerStoppingWaitingStopsTheReaderAndOneThatWontStartIsTheSystemsError(): Unit =
        bounded {
            val reader = Fake()
            var outcome: Result<BlockRead>? = null
            launch(start = CoroutineStart.UNDISPATCHED) { outcome = runCatching { scan(reader) } }.cancelAndJoin()
            assertEquals(1 to 1, reader.starts to reader.stops)
            // A cancel stays the caller's, never an answer.
            assertIs<CancellationException>(outcome?.exceptionOrNull())
            // A reader Android refuses: its error in the system's words, the reader stopped, the next scan free to begin.
            val refused = Fake(refuses = IllegalStateException("Cannot be used when alternative DiscoveryTechnology is set"))
            assertEquals(BlockRead.Failed("java.lang.IllegalStateException: Cannot be used when alternative DiscoveryTechnology is set"), scan(refused))
            assertEquals(1 to 1, refused.starts to refused.stops)
            val next = Fake()
            val scanning = begun(next)
            next.off()
            assertEquals(BlockRead.NfcOff, scanning.await())
        }

    @Test
    fun androidsNfcServiceGoneLeavesAReadAsItWasAndASwitchItCantReadIsTheSystemsErrorEachFreeingTheNextScan(): Unit =
        bounded {
            // A block read, then the reader can't be stopped: the read stands, as the tap it is.
            val reader = Fake(stopFails = IllegalStateException("NFC service gone"))
            val scan = begun(reader)
            reader.tag(listOf(text("T7XK2M9QPF")))
            assertEquals(BlockRead.Block("T7XK2M9QPF"), scan.await())
            assertEquals(1, reader.stops)
            // Its switch can't be read as it starts, nor once it listens: the system's error, never thrown.
            val unread = Fake().apply { switchFails = IllegalStateException("NFC service gone") }
            assertEquals(BlockRead.Failed("java.lang.IllegalStateException: NFC service gone"), scan(unread))
            val late = Fake().apply { starting = { switchFails = IllegalStateException("NFC service gone") } }
            assertEquals(BlockRead.Failed("java.lang.IllegalStateException: NFC service gone"), scan(late))
            assertEquals(1 to 1, late.starts to late.stops)
            // And the next scan begins.
            val next = Fake()
            val scanning = begun(next)
            next.left()
            assertEquals(BlockRead.Cancelled, scanning.await())
        }
}
