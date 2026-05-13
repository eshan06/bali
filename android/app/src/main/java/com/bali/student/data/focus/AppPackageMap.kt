package com.bali.student.data.focus

/**
 * Static mapping from iOS bundle identifiers (which the server returns in the
 * blocking snapshot) to the equivalent Android package names that our
 * accessibility-service-based blocker compares against.
 *
 * The server side is iOS-first today. Rather than re-resolve the snapshot
 * locally, we translate per-app here. App-name fallbacks let us still surface
 * a friendly label for apps we don't have a mapping for yet.
 */
object AppPackageMap {

    private val iosToAndroid: Map<String, String> = mapOf(
        // Social
        "com.burbn.instagram" to "com.instagram.android",
        "com.zhiliaoapp.musically" to "com.zhiliaoapp.musically",
        "com.toyopagroup.picaboo" to "com.snapchat.android",
        "com.facebook.Facebook" to "com.facebook.katana",
        "com.atebits.Tweetie2" to "com.twitter.android",
        "com.google.ios.youtube" to "com.google.android.youtube",
        "com.netflix.Netflix" to "com.netflix.mediaclient",
        "com.spotify.client" to "com.spotify.music",
        // Games
        "com.supercell.laser" to "com.supercell.brawlstars",
        "com.innersloth.amongus" to "com.innersloth.spacemafia",
        "com.mojang.minecraftpe" to "com.mojang.minecraftpe",
        "com.roblox.robloxmobile" to "com.roblox.client",
        "com.supercell.scroll" to "com.supercell.clashroyale",
        // Utility / Full Focus allowed
        "com.apple.mobilephone" to "com.google.android.dialer",
        "com.apple.MobileSMS" to "com.google.android.apps.messaging",
        "com.apple.calculator" to "com.google.android.calculator",
        "com.apple.camera" to "com.google.android.GoogleCamera",
        "com.apple.clock" to "com.google.android.deskclock",
        "com.apple.mobilesafari" to "com.android.chrome",
        "com.apple.mobilenotes" to "com.google.android.keep",
    )

    /**
     * Android packages we never block regardless of policy — system UI,
     * launcher, settings, and Bali itself. Anything here is always allowed
     * (Full Focus included) so the student can get back to Bali.
     */
    val alwaysAllowed: Set<String> = setOf(
        "android",
        "com.android.systemui",
        "com.google.android.systemui",
        "com.android.settings",
        "com.android.launcher",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",
        "com.sec.android.app.launcher",
        "com.miui.home",
        "com.bali.student",
    )

    /** Returns the Android package name we believe matches [iosBundleId], or null if unknown. */
    fun androidPackage(iosBundleId: String): String? = iosToAndroid[iosBundleId]
}
