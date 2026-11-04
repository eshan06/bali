package com.bali.spike

import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Process
import android.provider.Settings

/** What each lock runs on, and whether the student has taken it back. */
object Protection {
    fun a11yEnabled(context: Context): Boolean {
        val mine = ComponentName(context, BlockAccessibilityService::class.java)
        val enabled = Settings.Secure.getString(
            context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }

    fun usageAccess(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = ops.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName,
        )
        return if (mode == AppOpsManager.MODE_DEFAULT) {
            context.checkSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        } else {
            mode == AppOpsManager.MODE_ALLOWED
        }
    }

    fun overlay(context: Context) = Settings.canDrawOverlays(context)

    /**
     * Lock (c)'s consent, read without asking: the student's OK to the VPN dialog is the app op
     * `android:activate_vpn`. VpnService.prepare() would answer too, but while another app's VPN
     * is up it hands the VPN to Bali, so it is never the way to look.
     */
    fun vpnConsent(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        return try {
            ops.unsafeCheckOpNoThrow("android:activate_vpn", Process.myUid(), context.packageName) ==
                AppOpsManager.MODE_ALLOWED
        } catch (_: RuntimeException) {
            false
        }
    }

    /** A VPN is up that isn't Bali's: another app's took over, or holds it. */
    fun otherVpn(context: Context): Boolean {
        if (BlockVpnService.up) return false
        val cm = context.getSystemService(ConnectivityManager::class.java)
        return try {
            @Suppress("DEPRECATION")
            cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
        } catch (e: SecurityException) {
            Spike.log("other-vpn-check-failed", "err" to e.javaClass.simpleName)
            false
        }
    }

    /** Is each of the session's locks able to cover right now? */
    fun on(context: Context): Boolean {
        if (Session.runs(Session.A) && !(a11yEnabled(context) && BlockAccessibilityService.connected)) return false
        if (Session.runs(Session.B) && !(usageAccess(context) && overlay(context) && PollService.running)) return false
        if (Session.runs(Session.C) && !BlockVpnService.up) return false
        return true
    }

    fun summary(context: Context) =
        "a11y:${a11yEnabled(context)}/${BlockAccessibilityService.connected}," +
            "usage:${usageAccess(context)},overlay:${overlay(context)},poll:${PollService.running}," +
            "vpn:${vpnConsent(context)}/${BlockVpnService.up}"
}
