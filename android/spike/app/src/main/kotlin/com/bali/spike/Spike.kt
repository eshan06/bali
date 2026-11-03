package com.bali.spike

import android.os.SystemClock
import android.util.Log

/**
 * Every event the spike logs: one logcat line under the tag `BaliSpike`, the three clocks beside
 * it, so timings come from the log (`adb logcat -v epoch -s BaliSpike ActivityTaskManager`).
 * `wall` is the phone's clock, the one logcat's own timestamps use.
 */
object Spike {
    const val TAG = "BaliSpike"

    fun log(event: String, vararg fields: Pair<String, Any?>) {
        val line = buildString {
            append(event)
            append(" wall=").append(System.currentTimeMillis())
            append(" elapsed=").append(SystemClock.elapsedRealtime())
            append(" uptime=").append(SystemClock.uptimeMillis())
            for ((key, value) in fields) append(' ').append(key).append('=').append(value)
        }
        Log.i(TAG, line)
    }
}
