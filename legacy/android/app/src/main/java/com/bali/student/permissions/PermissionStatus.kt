package com.bali.student.permissions

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat

enum class NfcStatus { Available, Disabled, NoHardware }

data class PermissionsSnapshot(
    val accessibilityEnabled: Boolean,
    val notificationsGranted: Boolean,
    val batteryUnrestricted: Boolean,
    val nfc: NfcStatus,
) {
    val readyForFocusMode: Boolean
        get() = accessibilityEnabled && notificationsGranted && batteryUnrestricted
}

object PermissionChecks {

    fun snapshot(context: Context, accessibilityServiceClass: Class<*>): PermissionsSnapshot =
        PermissionsSnapshot(
            accessibilityEnabled = isAccessibilityServiceEnabled(context, accessibilityServiceClass),
            notificationsGranted = hasNotificationPermission(context),
            batteryUnrestricted = isBatteryUnrestricted(context),
            nfc = nfcStatus(context),
        )

    fun isAccessibilityServiceEnabled(context: Context, serviceClass: Class<*>): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val target = "${context.packageName}/${serviceClass.name}"
        return enabled.split(':').any { it.equals(target, ignoreCase = true) }
    }

    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun isBatteryUnrestricted(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun nfcStatus(context: Context): NfcStatus {
        val adapter = NfcAdapter.getDefaultAdapter(context)
        return when {
            adapter == null -> NfcStatus.NoHardware
            !adapter.isEnabled -> NfcStatus.Disabled
            else -> NfcStatus.Available
        }
    }
}
