package com.bali.bali

import android.app.Application
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.provider.Settings
import com.bali.core.AppConfig
import com.bali.core.HttpTransport
import com.bali.core.OkHttpTransport
import com.bali.core.SignIn
import com.bali.outbox.Enforcer
import com.bali.outbox.SyncEngine
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.dropWhile
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.launch

/** The app's process, and what lives as long as it does: the engine and the lock (AN7), which the screens (AN10) take from here. */
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

    /** The lock, Bali's Accessibility service: one for the run, the last run's lock read as it's made (Q4). */
    val lock: ServiceLock by lazy { ServiceLock(this) }

    /** The screen as the lock's service hears it: on while the service is bound and the screen is on. */
    internal val screen = MutableStateFlow(false)

    private val runs = MutableStateFlow<Running?>(null)

    /** The engine and its enforcer while they run: none before [start], and, as on iOS, none while sign-in isn't set up. */
    val running: StateFlow<Running?> = runs.asStateFlow()

    /** The app's one engine, and the enforcer keeping the lock where its truth says. */
    class Running internal constructor(val engine: SyncEngine, val enforcer: Enforcer, internal val job: Job)

    override fun onCreate() {
        super.onCreate()
        val api = config?.api ?: return
        val signIn = signIn ?: return
        scope.launch { start(SyncEngine.make(outbox(), api, signIn, scope, transport)) }
    }

    /**
     * Runs [engine], and an enforcer over [lock], in [scope], the app's (a test's own in the instrumented
     * tests), in place of any run before: BaliApp.swift's `start`. Both runs; the engine told of the screen
     * as the service hears it, for its check-ins (AN5c); and rule 3's check now, so a switch starting as the
     * app starts begins its grace, the service's connect ending it, and at each change of Android's list
     * of switched-on services, so a switch turned off and on again between two check-ins is reported
     * (AN7b). The service's connect and unbind run it too ([check]).
     */
    fun start(engine: SyncEngine, scope: CoroutineScope = this.scope) {
        val job = SupervisorJob(scope.coroutineContext[Job])
        val within = CoroutineScope(scope.coroutineContext + job)
        val enforcer = Enforcer(engine, lock, within)
        val running = Running(engine, enforcer, job)
        runs.getAndUpdate { running }?.job?.cancel()
        job.invokeOnCompletion { runs.compareAndSet(running, null) }
        within.launch { engine.run() }
        within.launch { enforcer.run() }
        // From the screen's first turn on: the engine starts with it off.
        within.launch { screen.dropWhile { !it }.collect { engine.setScreenOn(it) } }
        val switch =
            object : ContentObserver(null) {
                override fun onChange(selfChange: Boolean) = check()
            }
        contentResolver.registerContentObserver(Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), false, switch)
        job.invokeOnCompletion { contentResolver.unregisterContentObserver(switch) }
        check()
    }

    /**
     * Rule 3's check, made now, of the run there is: none before the app's start, whose own check stands for
     * it. A lock that throws, against its promise, checked nothing, and the next check reads it again: it
     * never ends the app, as the enforcer's own recheck never does (santa's review).
     */
    internal fun check() {
        val running = runs.value ?: return
        scope.launch {
            try {
                running.enforcer.check()
            } catch (failed: Exception) {
                if (failed is CancellationException) throw failed
            }
        }
    }
}
