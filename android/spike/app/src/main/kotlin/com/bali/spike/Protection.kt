package com.bali.spike

import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
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

    /** Is the session's own lock able to cover right now? */
    fun on(context: Context): Boolean = when (Session.mode) {
        Session.A -> a11yEnabled(context) && BlockAccessibilityService.connected
        Session.B -> usageAccess(context) && overlay(context) && PollService.running
        else -> true
    }

    fun summary(context: Context) =
        "a11y:${a11yEnabled(context)}/${BlockAccessibilityService.connected}," +
            "usage:${usageAccess(context)},overlay:${overlay(context)},poll:${PollService.running}"
}
