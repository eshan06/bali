package com.bali.bali

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.ApiClient
import com.bali.core.BaliJson
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.ParticipationState
import com.bali.core.SessionView
import com.bali.core.TokenProvider
import com.bali.outbox.Change
import com.bali.outbox.Enforcer
import com.bali.outbox.LockSwitch
import com.bali.outbox.Outbox
import com.bali.outbox.OutboxDatabase
import com.bali.outbox.Standing
import com.bali.outbox.SyncClock
import com.bali.outbox.SyncEngine
import java.io.File
import java.io.IOException
import java.net.URI
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.time.toKotlinDuration
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The lock's service on the emulator, Android's own: its switch, read from Android's list and its binding;
 * what it listens to, as ARCHITECTURE's battery plan has it, read in `dumpsys accessibility` and from
 * Android's AccessibilityManager; rule 3's check as the app starts and as the switch changes; the screen
 * heard for the check-ins; and the lock kept for the next run. Each test runs an engine of its own, over its
 * own transport, outbox and clock, handed to the app's start, and switches the service on and off as a
 * student would, through the shell of a UiAutomation that leaves accessibility services running (one that
 * doesn't has Android unbind them all). What the JVM's tests show of the enforcer and the engine isn't
 * shown again here.
 */
@RunWith(AndroidJUnit4::class)
class LockServiceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as BaliApp
    private val server = Server()
    private val clock = SeenClock()
    private lateinit var scope: CoroutineScope
    private lateinit var outbox: Outbox
    private lateinit var engine: SyncEngine

    /** Android's list of switched-on services, and its master switch, as the test found them: put back after. */
    private lateinit var found: Pair<String, String>

    private val enforcer: Enforcer get() = checkNotNull(app.running.value).enforcer

    @Before
    fun start() {
        awake()
        found = shell("settings get secure enabled_accessibility_services").trim() to shell("settings get secure accessibility_enabled").trim()
        context.deleteDatabase(FILE)
        launch()
    }

    // The lock comes off, as it was found, and the service's switch is put back.
    @After
    fun stop(): Unit =
        runBlocking {
            end()
            app.lock.unlock()
            put(found.first)
            shell(if (found.second == "null") "settings delete secure accessibility_enabled" else "settings put secure accessibility_enabled ${found.second}")
            until { Unit.takeIf { !bound() } }
            server.close()
            context.deleteDatabase(FILE)
            awake()
        }

    @Test
    fun theSwitchIsOffOffTheListOnOnceTheServiceIsBoundAndStartingWhileItIsListedButUnbound() {
        assertEquals(LockSwitch.Off, switch())
        switchOn()
        assertTrue(bound())
        // The connect's check and the screen's wake done: the claim on, the wake's read of the truth sent.
        until { server.waiting.takeIf { "GET /v1/me" in it } }
        until { enforcer.updates.value.takeIf { it.switch == LockSwitch.On } }
        // A UiAutomation that suppresses accessibility services has Android unbind Bali's, still on its list.
        until { switch(suppressing = true).takeIf { it == LockSwitch.Starting } }
        val dump = shell("dumpsys accessibility", suppressing = true)
        assertTrue(dump.lineSequence().any { it.trim().startsWith("Enabled services:") && it.contains(SERVICE) })
        assertFalse(bound(suppressing = true))
        // The list unchanged and the engine's read loop held on its unanswered read, only the unbind's own
        // check can find it starting, beginning its grace (santa's review).
        until { enforcer.updates.value.takeIf { it.switch == LockSwitch.Starting } }
        // One that doesn't has it bound again.
        until { switch().takeIf { it == LockSwitch.On } }
    }

    @Test
    fun aServiceAndroidUnbindsBeforeItEverConnectsGoesQuietly() {
        // As Android unbinds one switched off while it binds (santa's review of AN7c): bound by Bali itself, as
        // Android lets the app's own uid, so the system never connects it; then unbound. Bali runs on, and once
        // the service is gone the switch reads off.
        val made = CountDownLatch(1)
        val connection =
            object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName?, service: IBinder?) = made.countDown()

                override fun onServiceDisconnected(name: ComponentName?) = Unit
            }
        assertTrue(context.bindService(Intent(context, LockService::class.java), connection, Context.BIND_AUTO_CREATE))
        assertTrue(made.await(PATIENCE.seconds, TimeUnit.SECONDS))
        context.unbindService(connection)
        until { Unit.takeIf { !shell("dumpsys activity services ${context.packageName}").contains(LockService::class.java.name.substringAfterLast('.')) } }
        assertEquals(LockSwitch.Off, switch())
    }

    @Test
    fun theServiceListensToNothingOutsideALessonToTheWindowsInOneAndToNothingAgainAtEmergencyUnlock(): Unit =
        runBlocking {
            switchOn()
            readOut()
            assertEquals("", listening())
            assertEquals(narrow, told())
            // A tap not answered yet locks at once, to its cap (decision 7).
            engine.record(Change.Tap("tag"))
            until { enforcer.updates.value.takeIf { it.locked } }
            assertEquals(WIDE, until { listening()?.takeIf { it == WIDE } })
            assertEquals(listOf(WINDOW_EVENTS, AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS, emptyList<String>()), told())
            engine.emergencyUnlock()
            until { enforcer.updates.value.takeIf { it.checked && !it.locked && it.until == null } }
            assertEquals("", until { listening()?.takeIf { it.isEmpty() } })
            assertEquals(narrow, told())
        }

    @Test
    fun aLockEndedByItsEndWithNothingWokenThereLeavesNoFileAndTheServiceListeningToNothing(): Unit =
        runBlocking {
            switchOn()
            readOut()
            // The phone check's short cap (B5b), shorter still: the tap's lock ends 5 s on by the phone's clock.
            engine.setTapCap(Duration.ofSeconds(5))
            engine.record(Change.Tap("tag"))
            until { enforcer.updates.value.takeIf { it.locked } }
            assertEquals(WIDE, until { listening()?.takeIf { it == WIDE } })
            // Past it, the enforcer's own pass at the end finds none held.
            until { enforcer.updates.value.takeIf { it.checked && !it.locked } }
            assertEquals("", until { listening()?.takeIf { it.isEmpty() } })
            assertFalse(File(context.noBackupFilesDir, LOCK_FILE).exists())
            assertFalse(ServiceLock(context).locking())
        }

    @Test
    fun switchedOffInASessionProtectionOffIsQueuedWithinASecondAndSwitchedOnAgainTheLockIsBackOn(): Unit =
        runBlocking {
            switchOn()
            // The screen's read of the truth left unanswered, the engine's read loop waits on it: no wake of its own
            // checks the lock, only the switch's change, the service's unbind and its connect.
            tapIn()
            until { enforcer.updates.value.takeIf { it.locked } }
            val off = System.nanoTime()
            put(found.first)
            until(Duration.ofSeconds(1)) { engine.updates.value.queued.firstOrNull { it.change == Change.ProtectionOff("s") } }
            val took = Duration.ofNanos(System.nanoTime() - off)
            assertTrue("$took", took <= Duration.ofSeconds(1))
            assertEquals(Standing.InSession(view, ParticipationState.ProtectionOff), engine.updates.value.standing)
            until { enforcer.updates.value.takeIf { it.switchedOff && !it.locked } }
            // On again in the class it was off in, before its bell: once bound, the phone back where it stood (#167).
            switchOn()
            until { engine.updates.value.queued.firstOrNull { it.change == Change.ProtectionOn("s") } }
            assertEquals(Standing.InSession(view, ParticipationState.Focused), engine.updates.value.standing)
            until { enforcer.updates.value.takeIf { it.locked && it.until == view.endsAt } }
            assertEquals(WIDE, until { listening()?.takeIf { it == WIDE } })
        }

    @Test
    fun startedInASessionWithItsSwitchOffBaliReportsItAtOnceByTheStartsOwnCheck(): Unit =
        runBlocking {
            // The last run tapped in, the service never switched on, so nothing locked or checked in.
            tapIn()
            end()
            // This one has no service to bind, no switch changing and no screen heard: only the start checks.
            launch()
            until { engine.updates.value.queued.firstOrNull { it.change == Change.ProtectionOff("s") } }
            val claim = until { enforcer.updates.value.takeIf { it.checked && it.switchedOff } }
            assertFalse(claim.locked)
        }

    @Test
    fun theScreenGoingOffChecksInOnceThenNothingAndComingOnChecksInOnceThenEvery30Seconds(): Unit =
        runBlocking {
            switchOn()
            readOut()
            tapIn()
            // On: the next check-in 30 s after the screen's read, the engine's one wait.
            val due = until { clock.deadlines.singleOrNull() }
            // Off: one check-in, at once, before the 30 s are up, rule 3's check before it, so the screen's turn
            // off reached the engine; and once its answer is in, the engine's clock holds no wait. That none comes
            // however long the screen stays off is the engine's to prove (AN5c's JVM test, 600 s on its clock).
            val offAt = now()
            shell("input keyevent KEYCODE_SLEEP")
            val asOff = server.next(CHECK_IN)
            assertTrue("${asOff.deviceTime} from $offAt before $due", asOff.at >= offAt && asOff.at < due)
            asOff.reply(200, live)
            val answered = until { engine.updates.value.heardAt?.takeIf { it >= offAt } }
            until { Unit.takeIf { clock.deadlines.isEmpty() } }
            assertEquals(emptyList<String>(), server.waiting)
            // On: one check-in, at once, rung by the screen alone, the engine having no wait of its own; then the
            // next 30 s on.
            val onAt = now()
            awake()
            val asOn = server.next(CHECK_IN)
            assertTrue("${asOn.deviceTime} from $onAt", asOn.at >= onAt && asOn.at < answered + SyncEngine.CHECK_IN_INTERVAL)
            asOn.reply(200, live)
            val next = until { clock.deadlines.singleOrNull() }
            assertTrue("$next", next >= onAt + SyncEngine.CHECK_IN_INTERVAL)
            assertEquals(emptyList<String>(), server.waiting)
        }

    @Test
    fun unboundBaliHearsTheScreenNoMoreSoTheEngineWaitsOnNothingAsWithTheScreenOff(): Unit =
        runBlocking {
            switchOn()
            readOut()
            // Out of a session with the screen on, the engine wakes every 30 s for rule 3's check (C1c).
            val due = until { clock.deadlines.singleOrNull() }
            put(found.first)
            // At once, its wait gone before it would have woken.
            until { now().takeIf { clock.deadlines.isEmpty() } }.let { assertTrue("$it before $due", it < due) }
            assertFalse(bound())
            assertEquals(emptyList<String>(), server.waiting)
        }

    @Test
    fun theLastRunsLockIsReadBackByANewServiceLockFromBalisOwnStorageAndIsGoneOnceTheStudentUnlocks(): Unit =
        runBlocking {
            switchOn()
            readOut()
            assertFalse(ServiceLock(context).locking())
            engine.record(Change.Tap("tag"))
            until { enforcer.updates.value.takeIf { it.locked } }
            // The next run's lock, made with it, reads the file: held, with no end of its own (Q4).
            assertTrue(ServiceLock(context).locking())
            val file = File(context.noBackupFilesDir, LOCK_FILE)
            assertTrue(file.path, file.exists() && file.path.startsWith(context.dataDir.path + "/no_backup/"))
            engine.emergencyUnlock()
            until { enforcer.updates.value.takeIf { it.checked && !it.locked } }
            assertFalse(ServiceLock(context).locking())
            assertFalse(file.exists())
        }

    /** The app started, as at a launch: an engine of the test's own over the test's outbox, as the last run left it. */
    private fun launch() {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        outbox = Outbox.open(Room.databaseBuilder(context, OutboxDatabase::class.java, FILE))
        val token = object : TokenProvider { override suspend fun accessToken() = "token" }
        engine = runBlocking { SyncEngine.open(outbox, ApiClient(URI("https://api.bali.test"), token, server), scope, clock) }
        app.start(engine, scope)
    }

    /** The run ended, as Bali stops: everything that reads the outbox first, then its file closed (the engine rig's teardown, AN5c). */
    private suspend fun end() {
        withTimeout(PATIENCE.toKotlinDuration()) { scope.coroutineContext.job.cancelAndJoin() }
        outbox.close()
    }

    /** The student switches Bali's service on, in Settings as the shell does; back once Android has bound it. */
    private fun switchOn() {
        put(listOf(found.first, SERVICE).filter { it.isNotEmpty() && it != "null" }.joinToString(":"))
        shell("settings put secure accessibility_enabled 1")
        until { switch().takeIf { it == LockSwitch.On } }
    }

    /** Android's list of switched-on services set to [list], as Settings would set it; "null" or empty: none. */
    private fun put(list: String) {
        shell(if (list == "null" || list.isEmpty()) "settings delete secure enabled_accessibility_services" else "settings put secure enabled_accessibility_services $list")
    }

    /** The lock's switch as the app reads it, with the shell's UiAutomation [suppressing] accessibility services or not. */
    private fun switch(suppressing: Boolean = false): LockSwitch {
        automation(suppressing)
        return runBlocking { app.lock.switch() }
    }

    /** Whether Android holds Bali's service bound, as `dumpsys accessibility` says. */
    private fun bound(suppressing: Boolean = false): Boolean = boundLine(suppressing)?.contains("label=$label,") == true

    /** The event types Bali's bound service listens to, as `dumpsys accessibility` prints them; none: not bound. */
    private fun listening(): String? =
        boundLine()?.let { Regex("""label=${Regex.escape(label)},.*?eventTypes=(.*?), notificationTimeout""").find(it)?.groupValues?.get(1) }

    private fun boundLine(suppressing: Boolean = false): String? =
        shell("dumpsys accessibility", suppressing).lineSequence().firstOrNull { it.trim().startsWith("Bound services:") }

    /** The event types, flags and packages Android holds for Bali's service, as its AccessibilityManager gives them. */
    private fun told(): List<Any> {
        val manager = context.getSystemService(AccessibilityManager::class.java)
        val info = manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).single { it.resolveInfo.serviceInfo.name == LockService::class.java.name }
        return listOf(info.eventTypes, info.flags, info.packageNames?.toList().orEmpty())
    }

    private val narrow get() = listOf(0, 0, listOf(context.packageName))

    /** Out of a session, the screen on as the service binds: the truth read, answered with no session. */
    private fun readOut() {
        server.next("GET /v1/me").reply(200, """{"user":{"id":"u","role":"student","displayName":null},"classes":[],"session":null}""")
        until { engine.updates.value.takeIf { it.meReads == 1 } }
    }

    /** Taps into [view] as the server answers it: the phone in that session, focused, nothing queued. */
    private suspend fun tapIn() {
        engine.record(Change.Tap("tag"))
        server.next("POST /v1/taps").reply(200, """{"outcome":"joined","session":${json(view)},"state":"focused"}""")
        until { engine.updates.value.takeIf { it.standing == Standing.InSession(view, ParticipationState.Focused) && it.queued.isEmpty() } }
    }

    /** The screen on and unlocked, as a student would have it. */
    private fun awake() {
        shell("input keyevent KEYCODE_WAKEUP")
        shell("wm dismiss-keyguard")
    }

    private val label get() = context.getString(R.string.lock_service_label)

    private val view = SessionView("s", "c", Instant.now().plus(Duration.ofMinutes(50)).truncatedTo(ChronoUnit.SECONDS))

    private val live get() = """{"status":"live","state":"focused","session":${json(view)}}"""

    private fun json(view: SessionView) = BaliJson.encodeToString(SessionView.serializer(), view)

    /** The phone's time, to the millisecond, as a request's `deviceTime` has it. */
    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MILLIS)

    /** The instrumentation's UiAutomation, connected again where it [suppressing] accessibility services or not, as asked. */
    private fun automation(suppressing: Boolean): UiAutomation =
        instrumentation.getUiAutomation(if (suppressing) 0 else UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)

    private fun shell(command: String, suppressing: Boolean = false): String =
        ParcelFileDescriptor.AutoCloseInputStream(automation(suppressing).executeShellCommand(command)).use { it.readBytes().decodeToString() }

    private companion object {
        const val FILE = "lock-service-test.sqlite"
        const val SERVICE = "com.bali.bali/com.bali.bali.LockService"
        const val CHECK_IN = "POST /v1/sessions/s/checkin"
        const val WINDOW_EVENTS = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or AccessibilityEvent.TYPE_WINDOWS_CHANGED
        const val WIDE = "[TYPE_WINDOW_STATE_CHANGED, TYPE_WINDOWS_CHANGED]"
        val PATIENCE: Duration = Duration.ofSeconds(30)
    }
}

/** [value]'s first answer, asked until it gives one; none within [patience] fails the test, never hangs it. */
private fun <T : Any> until(patience: Duration = Duration.ofSeconds(30), value: () -> T?): T {
    val by = System.nanoTime() + patience.toNanos()
    while (System.nanoTime() < by) {
        value()?.let { return it }
        Thread.sleep(10)
    }
    error("never came in $patience")
}

/** The phone's clock, its waits seen: when the engine wakes by itself, none while it waits on a ring alone. */
private class SeenClock : SyncClock {
    private val waits = CopyOnWriteArrayList<Instant>()

    val deadlines: List<Instant> get() = waits.toList()

    override fun now(): Instant = Instant.now()

    override fun uptime(): Duration = Duration.ofNanos(System.nanoTime())

    override fun zone(): ZoneId = ZoneId.systemDefault()

    override suspend fun sleep(until: Instant) {
        waits += until
        try {
            delay(Duration.between(Instant.now(), until).toKotlinDuration())
        } finally {
            waits -= until
        }
    }
}

/** The API, answered by hand: each request waits for the test's answer, and gets none once the server closes. The engine rig's `Server`. */
private class Server : HttpTransport {
    class Exchange(val request: HttpRequest) {
        private val answer = CompletableDeferred<Pair<Int, String>?>()
        val route = "${request.method} ${request.url.path}"
        val deviceTime: String get() = Regex(""""deviceTime":"([^"]+)"""").find(request.body?.decodeToString().orEmpty())?.groupValues?.get(1).orEmpty()

        /** When the engine made it, by the phone's clock. */
        val at: Instant get() = Instant.parse(deviceTime)

        fun reply(status: Int, body: String) {
            answer.complete(status to body)
        }

        fun drop() = answer.complete(null)

        suspend fun answered() = answer.await()
    }

    private val lock = Any()
    private val sent = mutableListOf<Exchange>()
    private val untaken = mutableListOf<Exchange>()
    private var closed = false

    /** The routes of the requests sent and not yet taken by [next]. */
    val waiting: List<String> get() = synchronized(lock) { untaken.map { it.route } }

    override suspend fun send(request: HttpRequest): HttpAnswer {
        val exchange = Exchange(request)
        synchronized(lock) {
            sent += exchange
            if (closed) exchange.drop() else untaken += exchange
        }
        val (status, body) = exchange.answered() ?: throw IOException("no answer")
        return HttpAnswer(status, emptyMap(), body.encodeToByteArray())
    }

    /** The next request to [route], once the engine has sent it. */
    fun next(route: String): Exchange = until { synchronized(lock) { untaken.firstOrNull { it.route == route }?.also { untaken -= it } } }

    /** No answer to anything from now on, a request on its way included. */
    fun close() =
        synchronized(lock) {
            closed = true
            sent.forEach { it.drop() }
            untaken.clear()
        }
}
