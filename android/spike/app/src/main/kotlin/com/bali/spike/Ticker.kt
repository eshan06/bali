package com.bali.spike

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * The check-in tick (AN7's open question): every 30 s from the lock's own service, logged with
 * uptime beside elapsed time (uptime stops while the CPU sleeps; an emulator may never sleep), and
 * sent to the host at [Session.tickHost] — on the emulator 10.0.2.2, never `adb reverse`'s
 * loopback, which Doze may let through.
 */
class Ticker(private val context: Context, private val lock: String) {
    private val main = Handler(Looper.getMainLooper())
    private var running = false
    private var n = 0
    private var elapsed0 = 0L
    private var uptime0 = 0L
    private var lastElapsed = 0L

    private val loop = object : Runnable {
        override fun run() {
            tick()
            main.postDelayed(this, PERIOD_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        n = 0
        elapsed0 = SystemClock.elapsedRealtime()
        uptime0 = SystemClock.uptimeMillis()
        lastElapsed = elapsed0
        main.postDelayed(loop, PERIOD_MS)
        Spike.log("ticker-start", "lock" to lock)
    }

    fun stop(reason: String) {
        if (!running) return
        running = false
        main.removeCallbacks(loop)
        Spike.log("ticker-stop", "lock" to lock, "reason" to reason, "ticks" to n)
    }

    private fun tick() {
        n++
        val elapsed = SystemClock.elapsedRealtime()
        val sinceElapsed = elapsed - elapsed0
        val sinceUptime = SystemClock.uptimeMillis() - uptime0
        val gap = elapsed - lastElapsed
        lastElapsed = elapsed
        val power = context.getSystemService(PowerManager::class.java)
        val protection = Protection.summary(context)
        Spike.log(
            "tick", "lock" to lock, "n" to n, "gapMs" to gap, "sinceElapsed" to sinceElapsed,
            "sinceUptime" to sinceUptime, "sleptMs" to (sinceElapsed - sinceUptime),
            "deviceIdle" to power.isDeviceIdleMode, "screenOn" to power.isInteractive,
            "session" to Session.describe(), "protection" to protection,
        )
        val host = Session.tickHost
        if (host.isEmpty()) return
        val count = n
        val url = "http://$host/tick?lock=$lock&n=$count&sdk=${Build.VERSION.SDK_INT}" +
            "&sinceElapsed=$sinceElapsed&sinceUptime=$sinceUptime&idle=${power.isDeviceIdleMode}" +
            "&wall=${System.currentTimeMillis()}"
        thread(name = "tick-$count") {
            try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                val code = connection.responseCode
                connection.disconnect()
                Spike.log("tick-sent", "lock" to lock, "n" to count, "code" to code)
            } catch (e: Exception) {
                Spike.log("tick-send-failed", "lock" to lock, "n" to count, "err" to "${e.javaClass.simpleName}:${e.message}")
            }
        }
    }

    companion object {
        const val PERIOD_MS = 30_000L
    }
}
