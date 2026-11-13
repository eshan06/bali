package com.bali.bali

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.provider.Settings
import android.provider.Telephony
import android.telecom.InCallService
import android.telecom.TelecomManager
import android.view.inputmethod.InputMethodManager
import androidx.core.net.toUri
import com.bali.outbox.SYSTEM_UI

/**
 * What the lock never covers (ARCHITECTURE, "Android app structure", decision 2), asked of Android as a lock comes on.
 * The parts the student chooses, whoever holds them: the phone and messaging apps (the dialer and SMS roles), the home
 * screen and the keyboards. The parts asked by what they do, held only where a system app holds them, so no app escapes
 * the lock by declaring one: calling for help (the emergency dialers, the emergency call, emergency information and SOS,
 * Telecom, the system's in-call screens, which a maker may ship apart from its dialer, AN1) and emergency alerts;
 * Settings, its Accessibility, permission and uninstall screens, so Bali never keeps the student from switching it off or
 * removing it (ISSUES #7); and the system's chooser. And System UI, the system's own dialogs and Bali, named by hand.
 * Android 11 and later hide each holder but for the `<queries>` beside the service (app/src/debug's manifest).
 */
internal object AllowList {
    fun of(context: Context): Set<String> {
        val packages = context.packageManager
        val telecom = context.getSystemService(TelecomManager::class.java)
        val held = mutableSetOf(context.packageName, SYSTEM_UI, SYSTEM)
        held += listOfNotNull(telecom?.defaultDialerPackage, telecom?.systemDialerPackage, Telephony.Sms.getDefaultSmsPackage(context))
        context.getSystemService(InputMethodManager::class.java)?.enabledInputMethodList?.mapTo(held) { it.packageName }
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val chosen = packages.default(home)?.activityInfo?.packageName?.takeIf { it != SYSTEM }?.also { held += it }
        // With no home screen chosen yet, the system's chooser answering, every one offered of the system's.
        val asked =
            ASKED.map(::Intent) + listOfNotNull(home.takeIf { chosen == null }) + listOf(CALL_EMERGENCY, Intent.ACTION_CALL).map { Intent(it, "tel:112".toUri()) } +
                Intent(Intent.ACTION_DELETE, "package:${context.packageName}".toUri())
        val found =
            asked.flatMap { packages.activities(it) }.map { it.activityInfo } + EMERGENCY_ALERTS.flatMap { packages.receivers(Intent(it)) }.map { it.activityInfo } +
                packages.services(Intent(InCallService.SERVICE_INTERFACE)).map { it.serviceInfo }.filter { it.metaData?.getBoolean(TelecomManager.METADATA_IN_CALL_SERVICE_UI) == true }
        found.filter { it.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0 }.mapTo(held) { it.packageName }
        return held
    }

    // The flags' Int form, deprecated from Android 13 for its type alone, as BaliApp's config reads them.
    @Suppress("DEPRECATION") private fun PackageManager.activities(intent: Intent) = queryIntentActivities(intent, 0)
    @Suppress("DEPRECATION") private fun PackageManager.receivers(intent: Intent) = queryBroadcastReceivers(intent, 0)
    @Suppress("DEPRECATION") private fun PackageManager.services(intent: Intent) = queryIntentServices(intent, PackageManager.GET_META_DATA)
    @Suppress("DEPRECATION") private fun PackageManager.default(intent: Intent) = resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)

    /** The system itself: its own dialogs, and the chooser it answers with where no app holds a part. */
    private const val SYSTEM = "android"

    // Android's own names for these, not public in its SDK; an emergency alert's broadcast by Android 11's name and 10's.
    private const val EMERGENCY_DIALER = "com.android.phone.EmergencyDialer.DIAL"
    private const val DIAL_EMERGENCY = "android.intent.action.DIAL_EMERGENCY"
    private const val EMERGENCY_ASSISTANCE = "android.telephony.action.EMERGENCY_ASSISTANCE"
    private const val CALL_EMERGENCY = "android.intent.action.CALL_EMERGENCY"
    private const val REQUEST_PERMISSIONS = "android.content.pm.action.REQUEST_PERMISSIONS"
    private val EMERGENCY_ALERTS = listOf("android.provider.action.SMS_EMERGENCY_CB_RECEIVED", "android.provider.Telephony.SMS_EMERGENCY_CB_RECEIVED")

    /** The parts asked by their action alone. */
    private val ASKED =
        listOf(EMERGENCY_DIALER, DIAL_EMERGENCY, EMERGENCY_ASSISTANCE, Settings.ACTION_SETTINGS, Settings.ACTION_ACCESSIBILITY_SETTINGS, REQUEST_PERMISSIONS, Intent.ACTION_CHOOSER)
}
