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

/**
 * What the lock never covers (ARCHITECTURE, "Android app structure", decision 2), asked of Android as a lock comes on,
 * from whoever holds each part: the student's phone and messaging apps (the dialer and SMS roles); calling for help, the
 * emergency dialer, Telecom and the system's in-call screens, which a phone maker may ship apart from its dialer (the
 * Samsung's, AN1); Settings with its permission and uninstall screens, so Bali never keeps the student from the switch
 * that turns it off nor from removing it (ISSUES #7); the home screen; the keyboards; System UI and the system's own
 * dialogs; and Bali. The spike's list (AN1). Only System UI and the system are named by hand: Android has no public way
 * to ask. Android 11 and later hide every other holder but for the `<queries>` beside the service (app/src/debug).
 */
internal object AllowList {
    fun of(context: Context): Set<String> {
        val packages = context.packageManager
        val telecom = context.getSystemService(TelecomManager::class.java)
        val held = mutableSetOf(context.packageName, SYSTEM_UI, SYSTEM)
        held += listOfNotNull(telecom?.defaultDialerPackage, telecom?.systemDialerPackage, Telephony.Sms.getDefaultSmsPackage(context))
        fun holders(intent: Intent) = packages.activities(intent).mapTo(held) { it.activityInfo.packageName }
        holders(Intent(EMERGENCY_DIALER))
        holders(Intent(CALL_EMERGENCY, "tel:112".toUri()))
        // A call placed from anywhere passes through Telecom's own screen first.
        holders(Intent(Intent.ACTION_CALL, "tel:112".toUri()))
        packages.services(Intent(InCallService.SERVICE_INTERFACE))
            .filter { it.serviceInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0 }
            .filter { it.serviceInfo.metaData?.getBoolean(TelecomManager.METADATA_IN_CALL_SERVICE_UI) == true }
            .mapTo(held) { it.serviceInfo.packageName }
        holders(Intent(Settings.ACTION_SETTINGS))
        holders(Intent(REQUEST_PERMISSIONS))
        holders(Intent(Intent.ACTION_DELETE, "package:${context.packageName}".toUri()))
        // The student's home screen, or, none chosen yet (the system's chooser answering), every one offered.
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val chosen = packages.default(home)?.activityInfo?.packageName
        if (chosen != null && chosen != SYSTEM) held += chosen else holders(home)
        context.getSystemService(InputMethodManager::class.java)?.enabledInputMethodList?.mapTo(held) { it.packageName }
        return held
    }

    // The flags' Int form, deprecated from Android 13 for its type alone, as BaliApp's config reads them.
    @Suppress("DEPRECATION")
    private fun PackageManager.activities(intent: Intent) = queryIntentActivities(intent, 0)

    @Suppress("DEPRECATION")
    private fun PackageManager.services(intent: Intent) = queryIntentServices(intent, PackageManager.GET_META_DATA)

    @Suppress("DEPRECATION")
    private fun PackageManager.default(intent: Intent) = resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)

    private const val SYSTEM_UI = "com.android.systemui"

    /** The system itself: its own dialogs, and the chooser it answers with where no app holds a part. */
    private const val SYSTEM = "android"

    // Android's own names for these, not public in its SDK.
    private const val EMERGENCY_DIALER = "com.android.phone.EmergencyDialer.DIAL"
    private const val CALL_EMERGENCY = "android.intent.action.CALL_EMERGENCY"
    private const val REQUEST_PERMISSIONS = "android.content.pm.action.REQUEST_PERMISSIONS"
}
