package com.bali.bali

import android.app.UiAutomation
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityWindowInfo
import android.widget.ScrollView
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.bali.outbox.Area
import com.bali.outbox.Change
import com.bali.outbox.Enforcer
import com.bali.outbox.LockSwitch
import com.bali.outbox.Outbox
import com.bali.outbox.OutboxDatabase
import com.bali.outbox.SyncEngine
import java.time.Duration
import java.time.Instant
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The cover on the emulator (AN7e), over Android's own windows: a blocked system app covered and sent home, timed against
 * AN1's; what calling for help needs, the student's own apps and Bali's own screen never covered; split screen window by
 * window, the readout bare beside a covered app, the keyboard kept clear and the shade never covered; picture-in-picture;
 * Emergency Unlock; and the lock's end, with no event. The blocked app is a system app, or the tests' own stand-in
 * (StandIn.java). Each test runs a Debug build's engine over a file of its own, handed to the app's start, as ReadoutTest
 * does, and switches the service on as a student would, through the shell of a UiAutomation that leaves accessibility
 * services running. What the rule covers is the JVM's to prove (outbox's CoverTest); here, that the service names the
 * windows, covers each where it is and sends home what it should. A cover is read from the service and seen in the
 * screen's pixels (`screencap`), never in a `uiautomator dump`, which unbinds the service (GOTCHAS).
 */
@RunWith(AndroidJUnit4::class)
class CoversTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as BaliApp
    private lateinit var scope: CoroutineScope
    private lateinit var outbox: Outbox
    private lateinit var engine: SyncEngine

    /** Android's list of switched-on services, and its master switch, as the test found them: put back after. */
    private lateinit var found: Pair<String, String>

    private val enforcer: Enforcer get() = checkNotNull(app.running.value).enforcer
    private val service: LockService get() = checkNotNull(app.lock.service)

    @Before
    fun start(): Unit =
        runBlocking {
            found = shell("settings get secure enabled_accessibility_services").trim() to shell("settings get secure accessibility_enabled").trim()
            context.deleteDatabase(FILE)
            // After the app's own start, which would otherwise replace this run.
            app.launched.join()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            outbox = Outbox.open(Room.databaseBuilder(context, OutboxDatabase::class.java, FILE))
            engine = checkNotNull(ThisBuild.unsigned(context.getString(R.string.BALI_API_URL), app.transport, scope) { outbox })
            app.start(engine, scope)
            awake()
            home()
            switchOn()
        }

    // Everything that reads the test's outbox ended before its file closes (the engine rig's teardown, AN5c); then the
    // lock off, the stand-in closed with its split screen or its picture-in-picture, and, whatever failed before, the
    // switch put back as found: a service left on would stay bound as the run uninstalls Bali, and fail the next tests.
    @After
    fun stop(): Unit =
        runBlocking {
            try {
                withTimeout(PATIENCE) { scope.coroutineContext.job.cancelAndJoin() }
                app.running.value?.job?.cancelAndJoin()
                outbox.close()
                app.lock.unlock()
                shell("am start -n $STAND_IN --ez ${StandIn.FINISH} true")
                until { Unit.takeIf { STAND_IN !in shell("am stack list") } }
                home()
            } finally {
                put(found.first)
                shell(if (found.second == "null") "settings delete secure accessibility_enabled" else "settings put secure accessibility_enabled ${found.second}")
                until { Unit.takeIf { app.lock.service == null } }
                context.deleteDatabase(FILE)
            }
        }

    @Test
    fun aBlockedSystemAppIsCoveredThenSentHomeOnceItsCoverLandsAndTheCoverGoesWithItsWindow() {
        locked()
        val launcher = launcher()
        // As AN1 timed it: from Home, where the test starts and each launch ends, three times, the first cold.
        val times =
            (1..3).map { launch ->
                if (launch == 1) shell("am force-stop ${BLOCKED.substringBefore('/')}")
                val homes = covers { it.homes }
                val from = System.nanoTime()
                shell("am start -n $BLOCKED")
                // Covered over its own window, named by that window's own state event.
                val (window, landed) = until { covers { it.landed }?.takeIf { (window, at) -> at > from && named(window) == BLOCKED.substringBefore('/') } }
                // Then sent home, once, and the cover gone with its window: the launcher in front.
                until { Unit.takeIf { covers { it.homes } == homes + 1 } }
                until { seen().takeIf { windows -> windows.none { it.id == window } && windows.any { it.app == launcher } && covers { it.shown }.isEmpty() } }
                Duration.ofNanos(landed - from)
            }
        Log.i(TAG, "launch to cover on Android ${android.os.Build.VERSION.RELEASE}: ${times.map { it.toMillis() }} ms, median ${times.sorted()[1].toMillis()} ms")
        assertTrue(enforcer.updates.value.locked)
    }

    @Test
    fun callingForHelpTheStudentsPhoneAndMessagesSettingsTheLauncherAndBalisOwnScreenAreNeverCovered() {
        locked()
        val homes = covers { it.homes }
        val dialer = checkNotNull(context.getSystemService(TelecomManager::class.java).defaultDialerPackage)

        /** [open]ed under the lock: its window, once its own state event has named it [app], never covered. */
        fun never(app: String, open: () -> Unit, besides: Set<Int> = emptySet()): Int {
            open()
            val window = until { seen().firstOrNull { it.app == app && it.id !in besides } }
            assertEquals(app, emptyMap<Int, Area>(), covers { it.shown })
            assertEquals(app, 0, coversOnScreen())
            home()
            return window.id
        }
        never(holder(Intent(Settings.ACTION_SETTINGS)), { shell("am start -a android.settings.SETTINGS") })
        val dialing = never(dialer, { shell("am start -a android.intent.action.DIAL") })
        never(holder(Intent(EMERGENCY_DIALER)), { shell("am start -a $EMERGENCY_DIALER") })
        never(checkNotNull(Telephony.Sms.getDefaultSmsPackage(context)), { shell("am start -a android.intent.action.SENDTO -d smsto:5551234") })
        // A call, to the emulator's own pretend network: the in-call screen, a window of the dialer's own.
        val calling = System.currentTimeMillis()
        try {
            never(dialer, { shell("am start -a android.intent.action.CALL -d tel:5551234") }, besides = setOf(dialing))
        } finally {
            // Hung up, ringing or in a call on no line; then the call log as found, the test's own call taken out once the
            // dialer has written it there, which it does a moment after.
            shell("input keyevent KEYCODE_ENDCALL")
            until { Unit.takeIf { Regex("""mCallState=[12]""") !in shell("dumpsys telephony.registry") } }
            until { Unit.takeIf { "Row:" in shell("content query --uri content://call_log/calls --where date>=$calling") } }
            shell("content delete --uri content://call_log/calls --where date>=$calling")
            assertEquals("No result found.", shell("content query --uri content://call_log/calls --where date>=$calling").trim())
        }
        never(launcher(), { home() })
        never(context.packageName, { shell("am start -n $READOUT") })
        // None sent home either, and the lock held throughout.
        assertEquals(homes, covers { it.homes })
        assertTrue(enforcer.updates.value.locked)
    }

    @Test
    fun splitScreenIsCoveredWindowByWindowBesideTheReadoutTheKeyboardKeptClearTheShadeNeverCoveredAndEmergencyUnlockLiftsIt() {
        locked()
        // The blocked app opened full screen: covered and sent home.
        val homes = covers { it.homes }
        shell("am start -n $STAND_IN")
        until { Unit.takeIf { covers { it.homes } == homes + 1 } }
        until { Unit.takeIf { "${launcher()}/" in focused() } }
        // Then beside the readout in split screen, below it: covered where it is, within the safe area, the gesture bar
        // below it bare, and never sent home. The readout in front first, the split's other half.
        shell("am start -n $READOUT")
        until { Unit.takeIf { READOUT in focused() } }
        shell("dumpsys activity service SystemUIService WMShell splitscreen moveToSideStage ${task(STAND_IN).first} 1")
        val half = until { task(STAND_IN).second.takeIf { it.top > 0 && task(READOUT).second.bottom <= it.top } }
        val standIn = until { seen().firstOrNull { it.app == STAND_IN_APP && it.bounds == half && it.cover != null } }
        val cover = checkNotNull(standIn.cover)
        assertEquals(listOf(half.left, half.top, half.right), listOf(cover.left, cover.top, cover.right))
        assertTrue("$cover in $half", cover.bottom < half.bottom)
        until { Unit.takeIf { pixel(cover.centerX, cover.centerY) == Covers.PLAIN } }
        // The readout beside it, Bali's own, bare; the half never sent home, once its cover's landing has run its course.
        val bali = until { seen().firstOrNull { it.app == context.packageName && it.bounds.bottom <= half.top } }
        assertNull(bali.cover)
        instrumentation.runOnMainSync {}
        instrumentation.runOnMainSync {}
        assertEquals(homes + 1, covers { it.homes })
        // The keyboard, risen for the readout's field above, over the covered half: the cover stops where it starts. The
        // readout made again for its half, as Android remakes an activity whose window changes size.
        val field = typeIn { it.window.decorView.height <= half.top }
        assertTrue("$field above $half", field.bottom <= half.top)
        until {
            seen().takeIf { windows ->
                val keyboard = windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
                val kept = windows.firstOrNull { it.id == standIn.id }?.cover
                keyboard != null && kept != null && (kept meets keyboard.bounds) == null
            }
        }
        assertNull(seen().first { it.id == bali.id }.cover)
        shell("input keyevent KEYCODE_BACK")
        until { seen().firstOrNull { it.id == standIn.id }?.takeIf { it.cover == cover && it.bounds == half } }
        // The shade pulled down: nothing covered while it's there; closed again, the half covered again.
        shell("cmd statusbar expand-notifications")
        until { seen().takeIf { windows -> windows.any { it.type == AccessibilityWindowInfo.TYPE_SYSTEM && it.bounds.height > half.height } && covers { it.shown }.isEmpty() } }
        shell("cmd statusbar collapse")
        until { seen().firstOrNull { it.id == standIn.id }?.cover }
        // Emergency Unlock: the cover off at once.
        val unlocking = System.nanoTime()
        runBlocking { checkNotNull(engine.emergencyUnlock()) }
        until { Unit.takeIf { covers { it.shown }.isEmpty() } }
        Log.i(TAG, "Emergency Unlock to no cover on Android ${android.os.Build.VERSION.RELEASE}: ${Duration.ofNanos(System.nanoTime() - unlocking).toMillis()} ms")
        until { enforcer.updates.value.takeIf { it.checked && !it.locked } }
        until { Unit.takeIf { pixel(half.centerX, half.centerY) == StandIn.COLOUR } }
    }

    @Test
    fun aFullScreenAppSentHomeIntoPictureInPictureStaysCoveredWhereItIsAndItsCoverFollowsIt() {
        locked()
        val homes = covers { it.homes }
        // As a video app goes: full screen, covered and sent home, it goes into picture-in-picture.
        shell("am start -n $STAND_IN --ez ${StandIn.PIP_ON_LEAVE} true")
        // Covered where it is, its cover drawn there on the screen, the small window read afresh each time as it moves in.
        val small = until { seen().firstOrNull { it.app == STAND_IN_APP && it.pictureInPicture && it.cover == it.bounds }?.takeIf { pixel(it.bounds.centerX, it.bounds.centerY) == Covers.PLAIN } }
        assertEquals(homes + 1, covers { it.homes })
        // The readout in front, its keyboard risen: the small window moves out of the keyboard's way, and its cover with
        // it, never the readout's.
        shell("am start -n $READOUT")
        until { Unit.takeIf { READOUT in focused() } }
        typeIn { true }
        val moved = until { seen().firstOrNull { it.id == small.id && it.bounds != small.bounds && it.cover == it.bounds }?.takeIf { pixel(it.bounds.centerX, it.bounds.centerY) == Covers.PLAIN } }
        assertNotEquals(small.bounds, moved.bounds)
        assertNull(until { seen().firstOrNull { it.app == context.packageName } }.cover)
        shell("input keyevent KEYCODE_BACK")
    }

    @Test
    fun aLockEndingAFewSecondsOnLosesItsCoverThereWithNoEventAndNothingWokenButTheService(): Unit =
        runBlocking {
            // No enforcer: the test's run ended, so only the lock's own end can take its cover away.
            withTimeout(PATIENCE) { scope.coroutineContext.job.cancelAndJoin() }
            assertNull(app.running.value)
            val end = Instant.now().plusSeconds(15)
            app.lock.lock(end)
            shell("am start -n $STAND_IN --ez ${StandIn.PIP_ON_LEAVE} true")
            val small = until { seen().firstOrNull { it.app == STAND_IN_APP && it.pictureInPicture && it.cover != null } }
            // Covered before the end, by the phone's clock; the screen still from here on, so no window event comes.
            assertTrue(Instant.now() < end)
            val gone = until { Instant.now().takeIf { covers { it.shown }.isEmpty() } }
            assertTrue("$gone from $end", !gone.isBefore(end) && gone.isBefore(end.plusSeconds(2)))
            // The small window still there, bare.
            val bare = until { seen().firstOrNull { it.id == small.id } }
            until { Unit.takeIf { pixel(bare.bounds.centerX, bare.bounds.centerY) == StandIn.COLOUR } }
        }

    /** [value]'s first answer, asked until it gives one; none within 30 s fails the test, saying what the service saw last. */
    private fun <T : Any> until(value: () -> T?): T =
        try {
            com.bali.bali.until(value = value)
        } catch (never: IllegalStateException) {
            throw AssertionError("${never.message}; the service saw ${seen()}", never)
        }

    /** A tap not yet answered, through the engine: the lock on, to its cap, and the service listening to the windows. */
    private fun locked() {
        runBlocking { engine.record(Change.Tap("tag")) }
        until { enforcer.updates.value.takeIf { it.locked } }
    }

    /** A window on the screen as the service sees it: its id, Android's type, its place, the app named for it and its cover's place. */
    private data class Seen(val id: Int, val type: Int, val bounds: Area, val pictureInPicture: Boolean, val app: String?, val cover: Area?)

    /** The windows on the screen, top first, as the service sees them now, on its own thread: what it covers made for the last event. */
    private fun seen(): List<Seen> {
        var seen = emptyList<Seen>()
        instrumentation.runOnMainSync {
            val service = app.lock.service ?: return@runOnMainSync
            val shown = service.covers.shown
            seen =
                service.windows.map { window ->
                    val bounds = Rect().also(window::getBoundsInScreen)
                    Seen(window.id, window.type, Area(bounds.left, bounds.top, bounds.right, bounds.bottom), window.isInPictureInPictureMode, service.rule.app(window.id), shown[window.id])
                }
        }
        return seen
    }

    /** [read] of the service's covers, on its own thread. */
    private fun <T> covers(read: (Covers) -> T): T {
        var value: T? = null
        instrumentation.runOnMainSync { value = read(service.covers) }
        @Suppress("UNCHECKED_CAST")
        return value as T
    }

    /** The app the service named [window] for, on its own thread. */
    private fun named(window: Int): String? {
        var app: String? = null
        instrumentation.runOnMainSync { app = service.rule.app(window) }
        return app
    }

    /**
     * The student taps the readout's tag field for the keyboard, in the readout on the screen now ([which]): scrolled to
     * it first, then tapped twice, the first tap giving the readout the focus, which can come after that tap's own ask
     * for the keyboard. Returns the field's place on the screen.
     */
    private fun typeIn(which: (ReadoutActivity) -> Boolean): Rect {
        val blockTag =
            until {
                var resumed: ReadoutActivity? = null
                instrumentation.runOnMainSync {
                    resumed = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<ReadoutActivity>().firstOrNull(which)
                }
                resumed
            }.blockTag
        instrumentation.runOnMainSync { (blockTag.rootView.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ScrollView).fullScroll(View.FOCUS_DOWN) }
        instrumentation.waitForIdleSync()
        val field = Rect()
        instrumentation.runOnMainSync { assertTrue(blockTag.getGlobalVisibleRect(field) && field.height() == blockTag.height) }
        shell("input tap ${field.centerX()} ${field.centerY()}")
        until { Unit.takeIf { READOUT in focused() } }
        shell("input tap ${field.centerX()} ${field.centerY()}")
        return field
    }

    /** The window with the focus, as `dumpsys window` names it. */
    private fun focused(): String = shell("dumpsys window").lineSequence().firstOrNull { "mCurrentFocus" in it }.orEmpty()

    /** How many covers the window manager holds: each window's own line in `dumpsys window windows`. */
    private fun coversOnScreen(): Int = Regex("""Window #\d+ Window\{\w+ u0 ${Covers.TITLE}\}""").findAll(shell("dumpsys window windows")).count()

    /** The screen's colour at [x], [y], as `screencap` takes it. */
    private fun pixel(x: Int, y: Int): Int {
        val png = ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand("screencap -p")).use { it.readBytes() }
        return BitmapFactory.decodeByteArray(png, 0, png.size).getPixel(x, y)
    }

    /** [component]'s task, and its place, as `am stack list` names them. */
    private fun task(component: String): Pair<Int, Area> =
        until {
            Regex("""taskId=(\d+): ${Regex.escape(component)} bounds=\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]""").find(shell("am stack list"))?.groupValues?.let { found ->
                found[1].toInt() to Area(found[2].toInt(), found[3].toInt(), found[4].toInt(), found[5].toInt())
            }
        }

    /** The app Android answers [intent] with. */
    private fun holder(intent: Intent): String = checkNotNull(context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)).activityInfo.packageName

    /** The student's home screen's app. */
    private fun launcher(): String = holder(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))

    /** The student presses Home: back once the home screen has the focus, so nothing opened next is put behind it. */
    private fun home() {
        shell("input keyevent KEYCODE_HOME")
        until { Unit.takeIf { "${launcher()}/" in focused() } }
    }

    /** The screen on and unlocked, as a student would have it. */
    private fun awake() {
        shell("input keyevent KEYCODE_WAKEUP")
        shell("wm dismiss-keyguard")
    }

    /** The student switches Bali's service on, in Settings as the shell does; back once Android has bound it. */
    private fun switchOn() {
        put(listOf(found.first, SERVICE).filter { it.isNotEmpty() && it != "null" }.joinToString(":"))
        shell("settings put secure accessibility_enabled 1")
        until { runBlocking { app.lock.switch() }.takeIf { it == LockSwitch.On } }
    }

    /** Android's list of switched-on services set to [list], as Settings would set it; "null" or empty: none. */
    private fun put(list: String) {
        shell(if (list == "null" || list.isEmpty()) "settings delete secure enabled_accessibility_services" else "settings put secure enabled_accessibility_services $list")
    }

    // A UiAutomation that leaves accessibility services running: one that doesn't has Android unbind Bali's.
    private fun automation(): UiAutomation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)

    private fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand(command)).use { it.readBytes().decodeToString() }

    private val Area.centerX get() = (left + right) / 2
    private val Area.centerY get() = (top + bottom) / 2

    private companion object {
        const val FILE = "covers-test.sqlite"
        const val SERVICE = "com.bali.bali/com.bali.bali.LockService"
        const val READOUT = "com.bali.bali/com.bali.bali.ReadoutActivity"
        const val STAND_IN = "com.bali.bali.test/com.bali.bali.StandIn"
        const val STAND_IN_APP = "com.bali.bali.test"
        const val EMERGENCY_DIALER = "com.android.phone.EmergencyDialer.DIAL"
        const val TAG = "BaliCovers"

        /** A system app the allow-list never holds, which opens on these emulators with no prompt of its own in front. */
        const val BLOCKED = "com.google.android.contacts/com.android.contacts.activities.PeopleActivity"
        val PATIENCE = 30.seconds
    }
}
