package com.bali.bali

import android.app.Application
import android.content.pm.PackageManager
import com.bali.core.AppConfig
import com.bali.core.HttpTransport
import com.bali.core.OkHttpTransport
import com.bali.core.SignIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** The app's process, and what lives as long as it does, which the engine (AN7) and screens (AN10) take from here. */
class BaliApp : Application() {
    /** The app's scope: never a screen's, a ViewModel's or a service's, in which no renewal starts again once ended (AN6b). */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The one transport, the sign-in's and the engine's (AN3d). */
    val transport: HttpTransport by lazy { OkHttpTransport() }

    /** The build's config; none while a value isn't set, as the client id while it's empty: sign-in isn't set up. */
    val config: AppConfig? by lazy {
        // Deprecated from Android 13 for its flags' type alone.
        @Suppress("DEPRECATION")
        val meta = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA).metaData
        AppConfig.from(AppConfig.Key.entries.associate { it.key to meta?.getString(it.key) })
    }

    /** The student's sign-in, gated as by default: no token to Bali's API before the 13+ check. None while [config] is. */
    val signIn: SignIn? by lazy { config?.let { SignIn(it.cognito, KeystoreTokenStore(this), scope, transport) } }

    /** The sign-in waiting on the hosted UI. */
    internal val hostedUi = HostedUi()
}
