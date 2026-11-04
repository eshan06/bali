package com.bali.spike

import android.content.Context
import android.os.Handler
import android.os.Looper

/**
 * The fake session: a window of N minutes on the phone's clock (no server), which lock runs it, and
 * Emergency Unlock. The lock is a function of the window: a lock covers only while [active].
 * Kept in the app's own storage so a reboot or a restarted process finds it. Main thread only.
 * [mode] names the locks it runs: "a", "b", "c", or "ac" for (a) and (c) together.
 */
object Session {
    const val A = "a"
    const val B = "b"
    const val C = "c"
    const val AC = "ac"

    private lateinit var app: Context
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<Runnable>()

    var mode = ""
        private set
    var pollMs = 500L
        private set
    var startWall = 0L
        private set
    var endWall = 0L
        private set
    var unlockedWall = 0L
        private set
    var tickHost = "10.0.2.2:8787"
        private set

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        val p = prefs()
        mode = p.getString("mode", "") ?: ""
        pollMs = p.getLong("pollMs", 500)
        startWall = p.getLong("start", 0)
        endWall = p.getLong("end", 0)
        unlockedWall = p.getLong("unlocked", 0)
        tickHost = p.getString("tickHost", tickHost) ?: tickHost
        scheduleBell()
    }

    private fun prefs() = app.getSharedPreferences("session", Context.MODE_PRIVATE)

    private fun save() {
        prefs().edit()
            .putString("mode", mode).putLong("pollMs", pollMs).putLong("start", startWall)
            .putLong("end", endWall).putLong("unlocked", unlockedWall)
            .putString("tickHost", tickHost)
            .commit()
    }

    fun active(now: Long = System.currentTimeMillis()) =
        mode.isNotEmpty() && unlockedWall == 0L && now >= startWall && now < endWall

    /** Does the session run [lock], alone or beside another? */
    fun runs(lock: String) = mode.isNotEmpty() && lock in mode

    fun activeFor(lock: String) = runs(lock) && active()

    fun describe(): String {
        if (mode.isEmpty()) return "none"
        val left = (endWall - System.currentTimeMillis()) / 1000
        return "mode:$mode,poll:$pollMs,active:${active()},leftS:$left,unlocked:${unlockedWall != 0L}"
    }

    fun start(lock: String, minutes: Int, poll: Long) {
        mode = lock
        pollMs = poll
        startWall = System.currentTimeMillis()
        endWall = startWall + minutes * 60_000L
        unlockedWall = 0
        save()
        Spike.log("session-start", "mode" to lock, "minutes" to minutes, "pollMs" to poll, "end" to endWall)
        scheduleBell()
        changed()
    }

    /** Emergency Unlock: the lock off at once, and recorded. */
    fun unlock(source: String) {
        if (!active()) {
            Spike.log("unlock-ignored", "source" to source, "session" to describe())
            return
        }
        unlockedWall = System.currentTimeMillis()
        save()
        Spike.log("emergency-unlock", "source" to source, "mode" to mode)
        changed()
    }

    fun end(source: String) {
        Spike.log("session-end", "source" to source, "mode" to mode)
        mode = ""
        save()
        changed()
    }

    fun setTickHost(host: String) {
        tickHost = host
        save()
        Spike.log("tick-host", "host" to host)
    }

    fun addListener(listener: Runnable) {
        listeners += listener
    }

    fun removeListener(listener: Runnable) {
        listeners -= listener
    }

    private fun changed() = listeners.toList().forEach { it.run() }

    /** The bell: at the window's end every lock checks again, and stops covering. */
    private val bell = Runnable {
        Spike.log("bell", "session" to describe())
        changed()
    }

    private fun scheduleBell() {
        main.removeCallbacks(bell)
        val left = endWall - System.currentTimeMillis()
        if (mode.isNotEmpty() && left > 0) main.postDelayed(bell, left + 50)
    }
}
