package com.bali.bali

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Process
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.bali.core.AppConfig
import com.bali.core.HttpTransport
import com.bali.core.OkHttpTransport
import com.bali.core.SignIn
import com.bali.outbox.Account
import com.bali.outbox.Enforcer
import com.bali.outbox.Notes
import com.bali.outbox.Outbox
import com.bali.outbox.Problem
import com.bali.outbox.Router
import com.bali.outbox.SyncClock
import com.bali.outbox.SyncEngine
import com.bali.outbox.SystemClock
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.dropWhile
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The app's process, and what lives as long as it does: the engine, the lock (AN7), the account (AN9i), the notes and the router
 * (AN10c), which the screens (Phase 10) take from here.
 */
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

    private val problems = MutableStateFlow<Problem?>(null)

    /**
     * Why the app's last start runs nothing, until one runs (AN10a's [Problem], the router's `Screen.Storage`): not set up, a
     * Release build with no config, or the start failed, with its cause. Held for a screen to say with Try again (rule 5; the
     * words AN10d's), never swallowed.
     */
    val problem: StateFlow<Problem?> = problems.asStateFlow()

    /** The phone's notes (AN10b), BaliApp.swift's in its own defaults: read as the app is created, before the account or the router reads them. */
    lateinit var notes: Notes
        private set

    /** Which screen shows now (AN10b's [Router]), one for the app's life (Q1), over the run, the start's problem, the notes and [looking]. */
    lateinit var router: Router
        private set

    private val looks = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /**
     * Android saying the phone's clock may have moved further than a sleep counts, each a look the router chooses again at
     * (AN10a's `Screen.bell`): the time set, the zone changed, and the screen coming on, since a `delay` doesn't count the time
     * the phone spends in deep sleep (santa's review of #563). Heard for the app's life ([onCreate]): only a context can register
     * the screen's.
     */
    internal val looking =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                looks.tryEmit(Unit)
            }
        }

    /** The app's own start, as it's created ([begin]): a test that starts a run of its own waits for it first, which could replace that run. */
    internal lateinit var launched: Job

    /**
     * The app's one engine, the enforcer keeping the lock where its truth says, and the account's half over the engine's
     * sign-in: none over an engine with no sign-in, a Debug build's while sign-in isn't set up.
     */
    class Running internal constructor(val engine: SyncEngine, val enforcer: Enforcer, val account: Account?, internal val job: Job)

    override fun onCreate() {
        super.onCreate()
        if (!ownStart()) return
        notes = PreferencesNotes(this)
        router = router()
        val changes = IntentFilter(Intent.ACTION_TIME_CHANGED).apply { addAction(Intent.ACTION_TIMEZONE_CHANGED); addAction(Intent.ACTION_SCREEN_ON) }
        // The system's broadcasts alone, none from another app (Android 14's rule for a receiver a context registers).
        ContextCompat.registerReceiver(this, looking, changes, ContextCompat.RECEIVER_NOT_EXPORTED)
        scope.launch { router.run() }
        launched = scope.launch { begin() }
    }

    /**
     * Bali's own process starting, its deck folder emptied first (Q3); false in the renderer's isolated process (RendererService),
     * which makes the app too, with none of Bali's files and no receiver allowed, so nothing of Bali's starts there.
     */
    internal fun ownStart(): Boolean {
        if (Process.isIsolated()) return false
        emptyDecks(this)
        return true
    }

    /** A router over the app's run, its start's problem, its notes and Android's looks, by [clock]: the app's own, by the phone's. */
    internal fun router(clock: SyncClock = SystemClock): Router =
        Router(running.map { run -> run?.let { Router.Run(it.engine, it.enforcer, it.account) } }, problem, notes, looks = looks, clock = clock)

    /** Whether a start is under way ([begin]), iOS's `starting`. */
    private val starting = AtomicBoolean(false)

    /**
     * Makes this build's engine ([make]) and runs it ([start]), unless one runs or another start is under way: BaliApp.swift's
     * `start`. Over the sign-in, and the app's own outbox; none while sign-in isn't set up, as on iOS, but a Debug build's
     * ([ThisBuild]). A start that runs nothing says why ([problem]), is tried again here, and first takes off the lock the last
     * run left on: no enforcer runs to end it, nor any engine to offer or record an Emergency Unlock over it (AN10a's santa).
     */
    internal suspend fun begin(make: suspend () -> SyncEngine? = { made() }) {
        if (!starting.compareAndSet(false, true)) return
        try {
            if (runs.value != null) return
            val why =
                started(make) { engine ->
                    ThisBuild.starting(this, engine)
                    start(engine)
                }
            if (why != null) lock.unlock()
            problems.value = why
        } finally {
            starting.set(false)
        }
    }

    /**
     * This build's engine over the app's own outbox: over the sign-in where [config], the build's, sets it up, else a Debug
     * build's over no token; none: Release's (Q2). The build sets every value since AN6d, so a test gives it none.
     */
    internal suspend fun made(config: AppConfig? = this.config): SyncEngine? =
        config?.let { set -> signIn?.let { SyncEngine.make(outboxFile, set.api, it, scope, transport).also { engine -> overSignIn = engine } } }
            ?: ThisBuild.unsigned(getString(R.string.BALI_API_URL), transport, scope) { outboxFile }

    /** The engine [made] last made over [signIn]: the Debug readout signs in through [signIn] only while it's the run's. */
    @Volatile
    internal var overSignIn: SyncEngine? = null
        private set

    /**
     * Runs [engine], and an enforcer over [lock], in [scope], the app's (a test's own in the instrumented
     * tests), in place of any run before: BaliApp.swift's `start`. Both runs; the engine told of the screen
     * as the service hears it, for its check-ins (AN5c); and rule 3's check now, so a switch starting as the
     * app starts begins its grace, the service's connect ending it, and at each change of Android's list
     * of switched-on services, so a switch turned off and on again between two check-ins is reported
     * (AN7b). The service's connect and unbind run it too ([check]), and Bali's own screen coming to the
     * front ([front]), after the truth is asked for, as iOS's coming back has both. And the account over the
     * engine's sign-in, one a run (AN9e's `Account`), over the phone's [notes]: its 13+ check's ask hooked at
     * each wake, and each sign-in followed (AN9i).
     */
    fun start(engine: SyncEngine, scope: CoroutineScope = this.scope) {
        val job = SupervisorJob(scope.coroutineContext[Job])
        val within = CoroutineScope(scope.coroutineContext + job)
        val enforcer = Enforcer(engine, lock, within)
        val account = Account.of(engine, within, notes = notes)
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

/**
 * A start, BaliApp.swift's `start`'s end: the engine [make] gives, run by [run]; else why none runs, AN10a's [Problem] as iOS's
 * start says it: none made, a Release build with no config (Q2), not set up; one that throws, the start failed, its cause kept
 * for a support request. An `Error` still ends the app, as the enforcer lets one go.
 */
internal suspend fun started(make: suspend () -> SyncEngine?, run: suspend (SyncEngine) -> Unit): Problem? =
    try {
        val engine = make() ?: return Problem.NotSetUp
        run(engine)
        null
    } catch (failed: Exception) {
        if (failed is CancellationException) throw failed
        Problem.StartFailed(failed)
    }
