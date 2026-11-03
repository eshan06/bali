package com.bali.spike

import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.WindowManager

/**
 * Lock (b): usage access, polled every [Session.pollMs] from a foreground service, and an overlay
 * ("Display over other apps") over the whole screen while a blocked app is in front. Usage events
 * say which activity resumed last, not where its window is.
 */
class PollService : Service() {
    private lateinit var covers: Covers
    private lateinit var ticker: Ticker
    private val main = Handler(Looper.getMainLooper())
    private var allow: Map<String, String> = emptyMap()
    private var front: String? = null
    private var frontAt = 0L
    private var queriedTo = 0L
    private var protectionOn: Boolean? = null
    private val ops by lazy { getSystemService(AppOpsManager::class.java) }
    private val opWatcher = AppOpsManager.OnOpChangedListener { op, pkg ->
        if (pkg == packageName) main.post { checkProtection("appop:$op") }
    }
    private val onSession = Runnable { if (!Session.activeFor(Session.B)) shutdown("session:${Session.describe()}") }
    private val loop = object : Runnable {
        override fun run() {
            poll()
            if (running) main.postDelayed(this, Session.pollMs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        Session.init(this)
        covers = Covers(this, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, Session.B)
        ticker = Ticker(this, Session.B)
        Spike.log("poll-service-created", "session" to Session.describe())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        Spike.log("poll-service-start", "restarted" to (intent == null), "session" to Session.describe())
        if (!Session.activeFor(Session.B)) {
            shutdown("no-session")
            return START_NOT_STICKY
        }
        if (!running) {
            running = true
            allow = AllowList.compute(this)
            AllowList.log(Session.B, allow)
            queriedTo = System.currentTimeMillis() - 60 * 60_000L // first, the last hour: who's in front
            Session.addListener(onSession)
            ops.startWatchingMode(AppOpsManager.OPSTR_GET_USAGE_STATS, packageName, opWatcher)
            ops.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, packageName, opWatcher)
            ticker.start()
            Spike.log("lock-armed", "lock" to Session.B, "session" to Session.describe())
            main.post(loop)
        }
        return START_STICKY
    }

    private fun poll() {
        if (!Session.activeFor(Session.B)) {
            shutdown("session:${Session.describe()}")
            return
        }
        checkProtection("poll")
        val now = System.currentTimeMillis()
        val events = getSystemService(UsageStatsManager::class.java)
            .queryEvents(queriedTo - OVERLAP_MS, now + 1)
        queriedTo = now
        val event = UsageEvents.Event()
        var newest: String? = null
        var newestAt = frontAt
        var newestClass: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED && event.timeStamp >= newestAt) {
                newest = event.packageName
                newestAt = event.timeStamp
                newestClass = event.className
            }
        }
        if (newest != null && (newest != front || newestAt != frontAt)) {
            if (newest != front) {
                Spike.log(
                    "poll-front", "pkg" to newest, "cls" to newestClass, "eventWall" to newestAt,
                    "lagMs" to (now - newestAt), "pollMs" to Session.pollMs,
                )
            }
            front = newest
            frontAt = newestAt
        }
        val pkg = front ?: return
        if (pkg in allow) covers.hideAll("allowed-in-front:$pkg") else covers.show("screen", pkg, null)
    }

    private fun checkProtection(why: String) {
        val usage = Protection.usageAccess(this)
        val overlay = Protection.overlay(this)
        val on = usage && overlay
        if (on == protectionOn) return
        protectionOn = on
        Spike.log(if (on) "protection-on" else "protection-off", "lock" to Session.B, "why" to why, "usage" to usage, "overlay" to overlay)
    }

    private fun shutdown(reason: String) {
        val was = running
        running = false
        main.removeCallbacks(loop)
        Session.removeListener(onSession)
        if (was) {
            try {
                ops.stopWatchingMode(opWatcher)
            } catch (_: RuntimeException) {
            }
        }
        covers.hideAll(reason)
        ticker.stop(reason)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Spike.log("poll-service-stop", "reason" to reason)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Spike.log("task-removed", "lock" to Session.B, "session" to Session.describe())
    }

    override fun onDestroy() {
        if (running) {
            Spike.log("protection-off", "lock" to Session.B, "why" to "service-destroyed", "session" to Session.describe())
            running = false
            main.removeCallbacks(loop)
            covers.hideAll("destroyed")
            ticker.stop("destroyed")
        }
        Session.removeListener(onSession)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel("lock", "The lesson's lock", NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, "lock")
            .setContentTitle("Bali spike: focus on")
            .setContentText("Lock (b) checks which app is in front")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val OVERLAP_MS = 2_000L

        @Volatile
        var running = false
            private set
    }
}
