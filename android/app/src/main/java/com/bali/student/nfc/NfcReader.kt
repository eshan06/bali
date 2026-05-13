package com.bali.student.nfc

import android.app.Activity
import android.content.Context
import android.nfc.NfcAdapter
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class NfcAvailability { Available, Disabled, NoHardware }

data class NfcTap(
    val uid: String,
    val source: Source,
    val detectedAt: Long = System.currentTimeMillis(),
) {
    enum class Source { HARDWARE, SIMULATED }
}

/**
 * Holds NFC reader-mode lifecycle and broadcasts detected tags.
 * Other parts of the app (e.g. ClassDetailViewModel) subscribe to [taps]
 * and react to a tap when they're on the right screen.
 */
@Singleton
class NfcReader @Inject constructor() {

    private val _taps = MutableSharedFlow<NfcTap>(extraBufferCapacity = 8)
    val taps: SharedFlow<NfcTap> = _taps.asSharedFlow()

    fun availability(context: Context): NfcAvailability {
        val adapter = NfcAdapter.getDefaultAdapter(context)
        return when {
            adapter == null -> NfcAvailability.NoHardware
            !adapter.isEnabled -> NfcAvailability.Disabled
            else -> NfcAvailability.Available
        }
    }

    fun enableReader(activity: Activity) {
        val adapter = NfcAdapter.getDefaultAdapter(activity) ?: return
        adapter.enableReaderMode(
            activity,
            { tag ->
                val uid = tag.id.toHexString()
                _taps.tryEmit(NfcTap(uid = uid, source = NfcTap.Source.HARDWARE))
            },
            NfcAdapter.FLAG_READER_NFC_A or
                NfcAdapter.FLAG_READER_NFC_B or
                NfcAdapter.FLAG_READER_NFC_F or
                NfcAdapter.FLAG_READER_NFC_V or
                NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
            null,
        )
    }

    fun disableReader(activity: Activity) {
        NfcAdapter.getDefaultAdapter(activity)?.disableReaderMode(activity)
    }

    /**
     * Emit a synthetic tap. Used by the prototype "Simulate NFC Tap"
     * affordance so the test path is identical to the real-hardware path.
     */
    fun simulateTap() {
        _taps.tryEmit(
            NfcTap(
                uid = "simulated-${System.currentTimeMillis()}",
                source = NfcTap.Source.SIMULATED,
            )
        )
    }
}

private fun ByteArray.toHexString(): String =
    joinToString(separator = "") { "%02x".format(it) }
