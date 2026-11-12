package com.bali.bali

import android.app.UiAutomation
import android.content.Intent
import android.os.ParcelFileDescriptor
import android.os.Process
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.ApiClient
import com.bali.core.BaliJson
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.TokenProvider
import com.bali.outbox.Change
import com.bali.outbox.Outbox
import com.bali.outbox.OutboxDatabase
import com.bali.outbox.Router
import com.bali.outbox.Screen
import com.bali.outbox.Standing
import com.bali.outbox.SyncClock
import com.bali.outbox.SyncEngine
import java.net.URI
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android's looks in the app (AN10c): the time set, the zone changed and the screen coming on each have the router choose again
 * (AN10a's `Screen.bell`), since a `delay` doesn't count the time the phone spends in deep sleep, so a bell slept towards alone
 * would ring late by however long the phone slept (santa's review of #563). The time's and the zone's are handed to the app's
 * own receiver as Android hands them, a protected broadcast being one no test can send, and Android's dump shows it holds that
 * receiver for all three; the screen's comes from the screen itself too, through the flag Android 14 asks for. The router is made
 * as the app makes its own ([BaliApp.router]), over the app's run, problem, notes and looks, by a clock of the test's whose sleep
 * never ends, as deep sleep stretches one: only a look can show the bell rung, or a clock set back before it.
 */
@RunWith(AndroidJUnit4::class)
class LooksTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as BaliApp
    private val server = Server()
    private val clock = SetClock(Instant.now())
    private lateinit var scope: CoroutineScope
    private lateinit var outbox: Outbox

    /** The class the phone stands in, focused, its bell 50 minutes on. */
    private val view = SessionView("s", "c", Instant.now().plus(Duration.ofMinutes(50)).truncatedTo(ChronoUnit.SECONDS))

    @Before
    fun start(): Unit =
        runBlocking {
            awake()
            context.deleteDatabase(FILE)
            // After the app's own start, which would otherwise replace this run.
            app.launched.join()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            outbox = Outbox.open(Room.databaseBuilder(context, OutboxDatabase::class.java, FILE))
        }

    // Everything that reads the test's outbox ended before its file closes (the engine rig's teardown, AN5c); the screen as found.
    @After
    fun stop(): Unit =
        runBlocking {
            withTimeout(30.seconds) { scope.coroutineContext.job.cancelAndJoin() }
            app.running.value?.job?.cancelAndJoin()
            server.close()
            outbox.close()
            context.deleteDatabase(FILE)
            awake()
        }

    @Test
    fun theTimeSetHasTheRouterChooseAgainPastTheBellAndTheZoneChangedBackBeforeIt() {
        val router = focused()
        clock.now = view.endsAt.plusSeconds(1)
        app.looking.onReceive(context, Intent(Intent.ACTION_TIME_CHANGED))
        router.until(Screen.SignIn)
        // Set back before the bell: Focus again, the lock's own rule, which covers by the phone's clock.
        clock.now = view.endsAt.minusSeconds(60)
        app.looking.onReceive(context, Intent(Intent.ACTION_TIMEZONE_CHANGED))
        router.until(Screen.Focus)
    }

    @Test
    fun theScreenComingOnHasTheRouterChooseAgainHandedAsAndroidHandsItAndFromTheScreenItself() {
        val router = focused()
        clock.now = view.endsAt.plusSeconds(1)
        app.looking.onReceive(context, Intent(Intent.ACTION_SCREEN_ON))
        router.until(Screen.SignIn)
        // Android's own, the screen turned off and on as a student would: a broadcast of the system's, which the flag lets in.
        clock.now = view.endsAt.minusSeconds(60)
        shell("input keyevent KEYCODE_SLEEP")
        awake()
        router.until(Screen.Focus)
    }

    @Test
    fun androidHoldsTheAppsReceiverForTheTimeSetTheZoneChangedAndTheScreenComingOn() {
        // `dumpsys activity broadcasts` lists each receiver registered at run time under its process (this one, the app's), each
        // filter's actions indented under it.
        val filters = mutableListOf<MutableSet<String>>()
        var mine = false
        for (line in shell("dumpsys activity broadcasts").lines()) {
            val said = line.trim()
            when {
                said.startsWith("* ReceiverList{") -> mine = " ${Process.myPid()} ${context.packageName}/" in said
                !line.startsWith("    ") -> mine = false
                mine && said.startsWith("Filter #") -> filters += mutableSetOf<String>()
                mine && said.startsWith("Action: ") -> filters.last() += said.removePrefix("Action: ").trim('"')
            }
        }
        assertTrue("$filters", setOf(Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_SCREEN_ON) in filters)
    }

    /** A run in [view], focused, its tap answered, and a router as the app makes its own, by [clock]: showing Focus. */
    private fun focused(): Router =
        runBlocking {
            val token = object : TokenProvider { override suspend fun accessToken() = "token" }
            val engine = SyncEngine.open(outbox, ApiClient(URI(API), token, server), scope)
            app.start(engine, scope)
            val router = app.router(clock)
            scope.launch { router.run() }
            engine.record(Change.Tap("tag"))
            server.next("POST /v1/taps").reply(200, """{"outcome":"joined","session":${BaliJson.encodeToString(SessionView.serializer(), view)},"state":"focused"}""")
            until { engine.updates.value.takeIf { it.standing == Standing.InSession(view, ParticipationState.Focused) && it.queued.isEmpty() } }
            router.until(Screen.Focus)
            router
        }

    /** Waits for the router to show [screen]; none in time fails the test. */
    private fun Router.until(screen: Screen) = until { shown.value.takeIf { it.screen == screen } }

    /** The screen on and unlocked, as a student would have it. */
    private fun awake() {
        shell("input keyevent KEYCODE_WAKEUP")
        shell("wm dismiss-keyguard")
    }

    private fun shell(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).executeShellCommand(command))
            .use { it.readBytes().decodeToString() }

    private companion object {
        const val FILE = "looks-test.sqlite"
    }
}

/** The phone's clock as a test sets it ([now]), its sleep never ending by itself, as deep sleep stretches a sleep past its time. */
private class SetClock(@Volatile var now: Instant) : SyncClock {
    override fun now(): Instant = now

    override fun uptime(): Duration = Duration.ofNanos(System.nanoTime())

    override fun zone(): ZoneId = ZoneId.systemDefault()

    override suspend fun sleep(until: Instant) = awaitCancellation()
}
