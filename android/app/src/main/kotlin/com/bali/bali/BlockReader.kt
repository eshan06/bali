package com.bali.bali

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.bali.core.BlockRead
import com.bali.core.BlockTag
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The phone's NFC reader, reading a Bali block (B6) as iOS's `BlockReader` does: one tag a scan, in Android's
 * reader mode while [screen], a screen of Bali's own, is in front, as iOS's session reads only while Bali is.
 * Thin on purpose: what a tag holds is `BlockTag`'s to say, what a read records `SyncEngine.tap`'s, and how a
 * scan ends [scan]'s, each tested on the JVM; a real tag is the phone check's (docs/ANDROID-PHONE-TESTS.md,
 * AN8). The Debug readout's Scan until AS4's "hold your phone to the block" screen.
 */
class BlockReader(private val screen: ComponentActivity) {
    /**
     * One scan: until a tag is read, Bali's screen leaves the front, NFC is switched off, or the caller stops
     * waiting. One at a time: asked again while one is under way, it says so rather than wait.
     */
    suspend fun read(): BlockRead = withContext(Dispatchers.Main) { scan(Phone(screen)) }

    /** Android's reader mode as [scan] uses it, on the main thread, where [screen]'s lifecycle runs. */
    private class Phone(private val screen: ComponentActivity) : Reader {
        private val nfc: NfcAdapter? = NfcAdapter.getDefaultAdapter(screen)
        private val app: Context = screen.applicationContext
        private var heard: Pair<LifecycleEventObserver, BroadcastReceiver>? = null

        override val present get() = nfc != null
        override val on get() = nfc?.isEnabled == true
        override val inFront get() = screen.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)

        override fun start(tag: (List<BlockTag.Record>) -> Unit, left: () -> Unit, off: () -> Unit) {
            val nfc = checkNotNull(nfc)
            val switched =
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        val state = intent.getIntExtra(NfcAdapter.EXTRA_ADAPTER_STATE, NfcAdapter.STATE_ON)
                        if (state == NfcAdapter.STATE_TURNING_OFF || state == NfcAdapter.STATE_OFF) off()
                    }
                }
            val paused = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) left() }
            // Android's NFC service sends it under its own uid, not the system's, which a receiver not exported never
            // hears; it's a protected broadcast, so no app can send it.
            ContextCompat.registerReceiver(app, switched, IntentFilter(NfcAdapter.ACTION_ADAPTER_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
            screen.lifecycle.addObserver(paused)
            heard = paused to switched
            nfc.enableReaderMode(
                screen,
                { found ->
                    val records = records(found)
                    // Done with the tag while it stays on the phone, so Android hands it to no app after the scan: a
                    // block's link, say.
                    nfc.ignore(found, DEBOUNCE, null, null)
                    tag(records)
                },
                TAGS,
                null,
            )
        }

        override fun stop() {
            val (paused, switched) = heard ?: return
            heard = null
            screen.lifecycle.removeObserver(paused)
            app.unregisterReceiver(switched)
            // A screen gone took its reader mode with it, and Android refuses one gone.
            if (!screen.isDestroyed) nfc?.disableReaderMode(screen)
        }
    }

    private companion object {
        /**
         * Every NFC Forum type that holds NDEF, as iOS's session reads: types 1, 2 and 4 over NFC-A, 4 over NFC-B, 3
         * over NFC-F and 5 over NFC-V. Android's own NDEF check stays on, so a tag comes with its message read.
         */
        const val TAGS = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V

        /** How long, in ms, a tag the reader found must be away from the phone before Android hands it on again. */
        const val DEBOUNCE = 1000

        /**
         * [tag]'s NDEF records as Android read them when it found the tag, handed to `BlockTag` as they come (AN3c):
         * none for an empty tag or one with no NDEF on it.
         */
        fun records(tag: Tag): List<BlockTag.Record> =
            Ndef.get(tag)?.cachedNdefMessage?.records.orEmpty().map { BlockTag.Record(it.tnf, it.type, it.payload) }
    }
}

/**
 * The phone's reader as [scan] uses it, [BlockReader]'s Android or the JVM tests' own: whether the phone has one,
 * whether it's switched on, and whether Bali's screen is in front; then reading, each tag's NDEF records heard as
 * they come, Bali's screen leaving the front and NFC switched off; and reading stopped.
 */
internal interface Reader {
    val present: Boolean
    val on: Boolean
    val inFront: Boolean

    fun start(tag: (List<BlockTag.Record>) -> Unit, left: () -> Unit, off: () -> Unit)

    fun stop()
}

/** Whether a scan is under way: the phone has one reader, so one at a time, whichever screen asks. */
private val scanning = AtomicBoolean(false)

/**
 * One scan over [reader], iOS's `read`: a phone with no NFC can't read, as on iOS; one with NFC switched off reads
 * nothing until it's on, Android's alone; and none begins behind another app or while one is under way. Its answer
 * is the first of a tag's read, Bali's screen leaving the front (the student's close, as iOS's Cancel) and NFC
 * switched off, the switch read again once the reader listens, so one turned off as it started counts; anything
 * after the first is dropped. The reader stops however the scan ends, the caller's cancel among them, and one that
 * won't start is the system's error.
 */
internal suspend fun scan(reader: Reader): BlockRead {
    if (!reader.present) return BlockRead.Unsupported
    if (!reader.on) return BlockRead.NfcOff
    if (!reader.inFront) return BlockRead.Cancelled
    if (!scanning.compareAndSet(false, true)) return BlockRead.Failed("A scan is under way.")
    val answer = CompletableDeferred<BlockRead>()
    try {
        try {
            reader.start({ answer.complete(readOf(it)) }, { answer.complete(BlockRead.Cancelled) }, { answer.complete(BlockRead.NfcOff) })
        } catch (refused: RuntimeException) {
            return BlockRead.Failed(refused.toString())
        }
        if (!reader.on) answer.complete(BlockRead.NfcOff)
        return answer.await()
    } finally {
        reader.stop()
        scanning.set(false)
    }
}

/**
 * What a tag's NDEF [records] hold: a Bali block's code; else no Bali block, a tag with none, an empty one and one
 * with no NDEF on it, a bank card say, among them, as a blank tag is on iOS.
 */
internal fun readOf(records: List<BlockTag.Record>): BlockRead = BlockTag.code(records)?.let(BlockRead::Block) ?: BlockRead.NotBali
