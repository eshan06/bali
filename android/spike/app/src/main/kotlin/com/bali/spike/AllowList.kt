package com.bali.spike

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import android.view.inputmethod.InputMethodManager

/**
 * What neither lock ever covers (ARCHITECTURE, "Android app structure", decision 2), each part
 * taken from Android itself wherever it can say who holds it. Only System UI is named by hand:
 * Android has no public way to ask for it.
 */
object AllowList {
    /** Package → why it is never covered. */
    fun compute(context: Context): Map<String, String> {
        val pm = context.packageManager
        val out = linkedMapOf<String, String>()
        fun add(pkg: String?, why: String) {
            // "android" answers when no one holds a part: the system's own chooser, not a holder.
            if (pkg.isNullOrEmpty() || pkg == "android") return
            out.merge(pkg, why) { old, new -> if (new in old.split('+')) old else "$old+$new" }
        }
        fun resolve(intent: Intent) =
            pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        fun resolveAll(intent: Intent) =
            pm.queryIntentActivities(intent, 0).map { it.activityInfo.packageName }

        val telecom = context.getSystemService(TelecomManager::class.java)
        add(telecom?.defaultDialerPackage, "dialer-role")
        add(telecom?.systemDialerPackage, "system-dialer")
        add(Telephony.Sms.getDefaultSmsPackage(context), "sms-role")
        resolveAll(Intent("com.android.phone.EmergencyDialer.DIAL")).forEach { add(it, "emergency") }
        resolveAll(Intent("android.intent.action.CALL_EMERGENCY", Uri.parse("tel:112")))
            .forEach { add(it, "emergency") }
        // A call placed from anywhere passes through Telecom's own screen first.
        resolveAll(Intent(Intent.ACTION_CALL, Uri.parse("tel:112"))).forEach { add(it, "call") }
        add(resolve(Intent(Settings.ACTION_SETTINGS)), "settings")
        // Settings' own screens that live in other packages: the permissions, and Uninstall.
        // Bali never blocks its own removal or the switch that turns it off.
        resolveAll(Intent("android.content.pm.action.REQUEST_PERMISSIONS"))
            .forEach { add(it, "settings-permissions") }
        resolveAll(Intent(Intent.ACTION_DELETE, Uri.parse("package:${context.packageName}")))
            .forEach { add(it, "settings-uninstall") }
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val defaultHome = resolve(home)
        if (defaultHome != null && defaultHome != "android") add(defaultHome, "home")
        else resolveAll(home).forEach { add(it, "home") }
        context.getSystemService(InputMethodManager::class.java)?.enabledInputMethodList
            ?.forEach { add(it.packageName, "keyboard") }
        add("com.android.systemui", "system-ui")
        add(context.packageName, "bali")
        return out
    }

    fun log(lock: String, allow: Map<String, String>) {
        Spike.log("allow-list", "lock" to lock, "packages" to allow.entries.joinToString(",") { "${it.key}:${it.value}" })
    }
}
