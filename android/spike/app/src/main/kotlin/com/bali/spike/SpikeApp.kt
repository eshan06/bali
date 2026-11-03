package com.bali.spike

import android.app.ActivityManager
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings

/** The process: why the last one ended, and the Accessibility switch watched while it lives. */
class SpikeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Session.init(this)
        val exits = getSystemService(ActivityManager::class.java)
            .getHistoricalProcessExitReasons(packageName, 0, 1)
        exits.firstOrNull()?.let {
            Spike.log("last-exit", "reason" to it.reason, "desc" to it.description, "atWall" to it.timestamp, "importance" to it.importance)
        }
        Spike.log("process-start", "session" to Session.describe(), "protection" to Protection.summary(this))
        contentResolver.registerContentObserver(
            Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), false,
            object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) {
                    val on = Protection.a11yEnabled(this@SpikeApp)
                    Spike.log("a11y-switch", "enabled" to on, "session" to Session.describe())
                    if (!on && Session.activeFor(Session.A)) {
                        Spike.log("protection-off", "lock" to Session.A, "why" to "switched-off-in-settings")
                    }
                }
            },
        )
    }
}

/** After a reboot, or an update of Bali, lock (b) starts again if the session is still on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Session.init(context)
        Spike.log("boot-receiver", "action" to intent.action, "session" to Session.describe(), "protection" to Protection.summary(context))
        if (!Session.activeFor(Session.B)) return
        try {
            context.startForegroundService(Intent(context, PollService::class.java))
            Spike.log("lock-restarted", "lock" to Session.B, "by" to intent.action)
        } catch (e: RuntimeException) {
            Spike.log("lock-restart-failed", "lock" to Session.B, "by" to intent.action, "err" to "${e.javaClass.simpleName}:${e.message}")
        }
    }
}
