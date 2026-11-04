package com.bali.spike

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.ParcelFileDescriptor
import java.io.IOException

/**
 * Lock (c): a VPN entirely on the phone, with no server and nothing forwarded. While a session
 * runs, only the blocked apps are routed into it (one `addAllowedApplication` per blocked
 * package); the allow-list's apps and Bali itself never are. Every packet a blocked app sends,
 * DNS included, goes into the tunnel and stays there: Bali never reads the tunnel, so it never
 * sees what a packet holds, and the kernel drops whatever its queue can't hold. Nothing is logged
 * but which packages are routed.
 */
class BlockVpnService : VpnService() {
    private var tunnel: ParcelFileDescriptor? = null
    private lateinit var ticker: Ticker
    private val onSession = Runnable { sessionChanged("session") }

    override fun onCreate() {
        super.onCreate()
        Session.init(this)
        ticker = Ticker(this, Session.C)
        Session.addListener(onSession)
        Spike.log("vpn-service-created", "session" to Session.describe())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val by = intent?.getStringExtra("by") ?: intent?.action ?: "restart"
        Spike.log(
            "vpn-service-start", "by" to by, "alwaysOn" to isAlwaysOn, "lockdown" to isLockdownEnabled,
            "session" to Session.describe(),
        )
        sessionChanged("start:$by")
        return START_STICKY
    }

    private fun sessionChanged(why: String) {
        if (Session.activeFor(Session.C)) {
            up(why)
        } else {
            down("session:${Session.describe()}")
            stopSelf()
        }
    }

    private fun up(why: String) {
        if (tunnel != null) return
        // prepare() is null only while the student's consent stands. Called while another
        // app's VPN is up, it hands the VPN to Bali, so Bali calls it only when no other is.
        if (prepare(this) != null) {
            Spike.log("protection-off", "lock" to Session.C, "why" to "no-consent", "by" to why)
            stopSelf()
            return
        }
        val allow = AllowList.compute(this)
        AllowList.log(Session.C, allow)
        val blocked = blockedPackages(this, allow)
        val builder = Builder()
            .setSession("Bali spike lock (c)")
            .addAddress("10.111.222.1", 32)
            .addAddress("fd00:6261:6c69::1", 128)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .addDnsServer("10.111.222.2")
            .addDnsServer("fd00:6261:6c69::2")
            .setConfigureIntent(
                PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE),
            )
        val routed = blocked.filter { pkg ->
            try {
                builder.addAllowedApplication(pkg)
                true
            } catch (_: PackageManager.NameNotFoundException) {
                false
            }
        }
        // A VPN with no allowed application takes every app, Bali's own and the allow-list's.
        if (routed.isEmpty()) {
            Spike.log("vpn-nothing-to-block", "by" to why)
            stopSelf()
            return
        }
        val fd = try {
            builder.establish()
        } catch (e: RuntimeException) {
            Spike.log("vpn-establish-failed", "by" to why, "err" to "${e.javaClass.simpleName}:${e.message}")
            null
        }
        if (fd == null) {
            Spike.log("protection-off", "lock" to Session.C, "why" to "establish-refused", "by" to why)
            stopSelf()
            return
        }
        tunnel = fd
        up = true
        Spike.log("vpn-up", "by" to why, "routed" to routed.size, "packages" to routed.joinToString(","))
        Spike.log("lock-armed", "lock" to Session.C, "session" to Session.describe())
        ticker.start()
    }

    private fun down(reason: String) {
        ticker.stop(reason)
        val fd = tunnel ?: return
        tunnel = null
        up = false
        try {
            fd.close()
        } catch (_: IOException) {
        }
        Spike.log("vpn-down", "reason" to reason)
    }

    /** The student disconnected it in Settings, or another app's VPN took over. */
    override fun onRevoke() {
        Spike.log("protection-off", "lock" to Session.C, "why" to "revoked", "session" to Session.describe())
        down("revoked")
        super.onRevoke()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Spike.log("task-removed", "lock" to Session.C, "session" to Session.describe())
    }

    override fun onDestroy() {
        if (tunnel != null) {
            Spike.log("protection-off", "lock" to Session.C, "why" to "service-destroyed", "session" to Session.describe())
        }
        down("destroyed")
        Session.removeListener(onSession)
        super.onDestroy()
    }

    companion object {
        const val ARM = "com.bali.spike.ARM_VPN"

        @Volatile
        var up = false
            private set

        /**
         * Every app with a launcher icon the allow-list doesn't hold: the apps (c) routes. A VPN
         * routes by uid, not by package, so an app that shares a uid with a part of the
         * allow-list, or runs as one of Android's own uids, is never routed: SIM Toolkit
         * (`com.android.stk`) runs as the phone's uid, 1001, and routing it took the emergency
         * dialer's package (`com.android.phone`) into the tunnel with it.
         */
        fun blockedPackages(context: Context, allow: Map<String, String>): List<String> {
            val pm = context.packageManager
            fun uid(pkg: String) = try {
                pm.getApplicationInfo(pkg, 0).uid
            } catch (_: PackageManager.NameNotFoundException) {
                null
            }
            val allowUids = allow.keys.mapNotNull { uid(it) }.toSet()
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val (routed, kept) = pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo.packageName }.distinct().filter { it !in allow }.sorted()
                .partition { pkg ->
                    val u = uid(pkg)
                    u != null && android.os.Process.isApplicationUid(u) && u !in allowUids
                }
            if (kept.isNotEmpty()) {
                Spike.log("vpn-not-routed", "packages" to kept.joinToString(",") { "$it:${uid(it)}" }, "why" to "shared-or-system-uid")
            }
            return routed
        }

        fun arm(context: Context, by: String) {
            context.startService(Intent(context, BlockVpnService::class.java).setAction(ARM).putExtra("by", by))
        }
    }
}
