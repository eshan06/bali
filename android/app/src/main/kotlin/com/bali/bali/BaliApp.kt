package com.bali.bali

import android.app.Application
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.provider.Settings
import com.bali.core.AppConfig
import com.bali.core.HttpTransport
import com.bali.core.OkHttpTransport
import com.bali.core.SignIn
import com.bali.outbox.Account
import com.bali.outbox.Enforcer
import com.bali.outbox.Outbox
import com.bali.outbox.SyncEngine
import java.util.concurrent.atomic.AtomicBoolean
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

/** The app's process, and what lives as long as it does: the engine, the lock (AN7) and the account (AN9e), which the screens (AN10) take from here. */
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

    /** Whether a screen of Bali's own is in front (the Debug readout's, AN7d; Phase 10's), for the engine's `setInFront`. */
    internal val front = MutableStateFlow(false)

    /** The app's own outbox, opened once, for its life (OutboxFile.kt): no test opens it, each having a file of its own. */
    private val outboxFile: Outbox by lazy { outbox() }

    private val runs = MutableStateFlow<Running?>(null)

    /** The engine and its enforcer while they run: none before [start], and, as on iOS, none while sign-in isn't set up but a Debug build's. */
    val running: StateFlow<Running?> = runs.asStateFlow()

    private val failure = MutableStateFlow<Exception?>(null)

    /** Why the app's last start failed, until one doesn't: held for a screen to say with Try again (rule 5; the words AN10's), never swallowed. */
    val startFailed: StateFlow<Exception?> = failure.asStateFlow()

    /** The app's own start, as it's created ([begin]): a test that starts a run of its own waits for it first, which could replace that run. */
    internal lateinit var launched: Job

    /**
     * The app's one engine, the enforcer keeping the lock where its truth says, and the account's half over the engine's
     * sign-in: none over an engine with no sign-in, a Debug build's while sign-in isn't set up.
     */
    class Running internal constructor(val engine: SyncEngine, val enforcer: Enforcer, val account: Account?, internal val job: Job)

    override fun onCreate() {
        super.onCreate()
        launched = scope.launch { begin() }
    }

    /** Whether a start is under way ([begin]), iOS's `starting`. */
    private val starting = AtomicBoolean(false)

    /**
     * Makes this build's engine and runs it ([start]), unless one runs or another start is under way:
     * BaliApp.swift's `start`. Over the sign-in, and the outbox [open] gives, the app's own; none while
     * sign-in isn't set up, as on iOS, but a Debug build's ([ThisBuild]). A start that fails is held
     * ([startFailed]) and tried again here.
     */
    internal suspend fun begin(open: () -> Outbox = { outboxFile }) {
        if (!starting.compareAndSet(false, true)) return
        try {
            if (runs.value != null) return
            val signed = config?.let { config -> signIn?.let { SyncEngine.make(open(), config.api, it, scope, transport) } }
            val engine = signed ?: ThisBuild.unsigned(getString(R.string.BALI_API_URL), transport, scope, open) ?: return
            ThisBuild.starting(this, engine)
            start(engine)
            failure.value = null
        } catch (failed: Exception) {
            if (failed is CancellationException) throw failed
            failure.value = failed
        } finally {
            starting.set(false)
        }
    }

    /**
     * Runs [engine], and an enforcer over [lock], in [scope], the app's (a test's own in the instrumented
     * tests), in place of any run before: BaliApp.swift's `start`. Both runs; the engine told of the screen
     * as the service hears it, for its check-ins (AN5c); and rule 3's check now, so a switch starting as the
     * app starts begins its grace, the service's connect ending it, and at each change of Android's list
     * of switched-on services, so a switch turned off and on again between two check-ins is reported
     * (AN7b). The service's connect and unbind run it too ([check]), and Bali's own screen coming to the
     * front ([front]), after the truth is asked for, as iOS's coming back has both. And the account over the
     * engine's sign-in, one a run: its 13+ check's ask at each wake, and the sign-in followed (AN9e).
     */
    fun start(engine: SyncEngine, scope: CoroutineScope = this.scope) {
        val job = SupervisorJob(scope.coroutineContext[Job])
        val within = CoroutineScope(scope.coroutineContext + job)
        val enforcer = Enforcer(engine, lock, within)
        val account = Account.of(engine, within)
        val running = Running(engine, enforcer, account, job)
        runs.getAndUpdate { running }?.job?.cancel()
        job.invokeOnCompletion { runs.compareAndSet(running, null) }
        within.launch { engine.run() }
        within.launch { enforcer.run() }
        account?.let { within.launch { it.run() } }
        // From the screen's first turn on: the engine starts with it off. Bali's own screen in front likewise.
        within.launch { screen.dropWhile { !it }.collect { engine.setScreenOn(it) } }
        within.launch { front.dropWhile { !it }.collect { engine.setInFront(it); if (it) check() } }
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
