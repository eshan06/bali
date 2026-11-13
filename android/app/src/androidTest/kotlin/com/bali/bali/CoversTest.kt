package com.bali.bali

import android.app.UiAutomation
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Log
import android.view.ViewGroup
import android.view.accessibility.AccessibilityWindowInfo
import android.widget.ScrollView
import androidx.core.net.toUri
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
import com.bali.outbox.SYSTEM_UI
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The cover on the emulator (AN7e), over Android's own windows: a blocked system app covered and sent home, timed against
 * AN1's; what calling for help needs, the student's own apps and Bali's own screen never covered, and an app that only
 * declares a part never allowed; split screen window by window, the readout bare beside a covered app, the keyboard kept
 * clear and the shade never covered; picture-in-picture, its menu over it;
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

    /**
     * A system app the allow-list never holds, which opens on these emulators with no prompt of its own in front: Google's
     * Contacts, or AOSP's on Android 10's image.
     */
    private val blocked by lazy { listOf("com.google.android.contacts", "com.android.contacts").first { shell("pm path $it").isNotBlank() } + "/com.android.contacts.activities.PeopleActivity" }

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
                // On Android 10 a readout docked in split screen stays there once its other half has gone.
                closeReadouts()
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
                if (launch == 1) shell("am force-stop ${blocked.substringBefore('/')}")
                val homes = covers { it.homes }
                val from = System.nanoTime()
                shell("am start -n $blocked")
                // Covered over its own window, named by that window's own state event.
                val (window, landed) = until { covers { it.landed }?.takeIf { (window, at) -> at > from && named(window) == blocked.substringBefore('/') } }
                // Then sent home, once, and the cover gone with its window: the launcher in front.
                until { Unit.takeIf { covers { it.homes } == homes + 1 } }
                until { seen().takeIf { windows -> windows.none { it.id == window } && windows.any { it.app == launcher } && covers { it.shown }.isEmpty() } }
                Duration.ofNanos(landed - from)
            }
        Log.i(TAG, "launch to cover on Android ${android.os.Build.VERSION.RELEASE}: ${times.map { it.toMillis() }} ms, median ${times.sorted()[1].toMillis()} ms")
        assertTrue(enforcer.updates.value.locked)
    }

    @Test
    fun callingForHelpThePhoneAndMessagesSettingsWithBalisSwitchAndUninstallTheLauncherAndBalisOwnScreenAreNeverCovered() {
        locked()
        val homes = covers { it.homes }
        val dialer = checkNotNull(context.getSystemService(TelecomManager::class.java).defaultDialerPackage)

        /** [open]ed under the lock: its window, once its own state event has named it [app], never covered; then [leave]. */
        fun never(app: String, open: () -> Unit, besides: Set<Int> = emptySet(), leave: () -> Unit = ::home): Int {
            open()
            val window = until { seen().firstOrNull { it.app == app && it.id !in besides } }
            assertEquals(app, emptyMap<Int, Area>(), covers { it.shown })
            assertEquals(app, 0, coversOnScreen())
            leave()
            return window.id
        }
        never(holder(Intent(Settings.ACTION_SETTINGS)), { shell("am start -a android.settings.SETTINGS") })
        // Where the student switches Bali off, and removes it, the removal asked and never confirmed: Back.
        never(holder(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)), { shell("am start -a android.settings.ACCESSIBILITY_SETTINGS") })
        val removing = Intent(Intent.ACTION_DELETE, "package:${context.packageName}".toUri())
        never(holder(removing), { shell("am start -a android.intent.action.DELETE -d package:${context.packageName}") }) {
            shell("input keyevent KEYCODE_BACK")
            home()
        }
        val dialing = never(dialer, { shell("am start -a android.intent.action.DIAL") })
        never(holder(Intent(EMERGENCY_DIALER)), { shell("am start -a $EMERGENCY_DIALER") })
        // Emergency information, where the image has a system app for it: the Safety app's own screen on Android 17's.
        context.packageManager.resolveActivity(Intent(EMERGENCY_ASSISTANCE), 0)?.let { never(it.activityInfo.packageName, { shell("am start -a $EMERGENCY_ASSISTANCE") }) }
        // Then the call at once, from Messages, as a student who has texted for help calls (AN7g). Messages opens the number's
        // conversation by itself, each of its activities starting the next (on Android 16's and 17's, one after asking the
        // network whether the number is a business's), and the last, a main screen made anew, would come up over the in-call
        // screen. So the call waits until Android has resumed that one, not one left from before: nothing of the link is left.
        val before = MESSAGES_CONVERSATIONS.flatMap(::records).toSet()
        never(checkNotNull(Telephony.Sms.getDefaultSmsPackage(context)), { shell("am start -a android.intent.action.SENDTO -d smsto:5551234") }) {
            until { Unit.takeIf { resumed()?.let { (record, activity) -> activity in MESSAGES_CONVERSATIONS && record !in before } == true } }
        }
        // A call, to the emulator's own pretend network: the in-call screen, a window of the dialer's own.
        val calling = System.currentTimeMillis()
        try {
            never(dialer, { shell("am start -a android.intent.action.CALL -d tel:5551234") }, besides = setOf(dialing))
        } finally {
            // Hung up, ringing or in a call on no line; then the call log as found, the test's own call taken out once the
            // dialer has written it there, which it does a moment after. Android 10's shell has no call-log permission, so
            // there the tests' own app does it (StandIn.Calls).
            shell("input keyevent KEYCODE_ENDCALL")
            until { Unit.takeIf { Regex("""mCallState=[12]""") !in shell("dumpsys telephony.registry") } }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                until { Unit.takeIf { "Row:" in shell("content query --uri content://call_log/calls --where date>=$calling") } }
                shell("content delete --uri content://call_log/calls --where date>=$calling")
                assertEquals("No result found.", shell("content query --uri content://call_log/calls --where date>=$calling").trim())
            } else {
                for (permission in listOf("READ_CALL_LOG", "WRITE_CALL_LOG")) shell("pm grant $STAND_IN_APP android.permission.$permission")
                until { Unit.takeIf { calls(calling) > 0 } }
                assertEquals(0, calls(calling, delete = true))
            }
        }
        never(launcher(), { home() })
        never(context.packageName, { shell("am start -n $READOUT") })
        // None sent home either, and the lock held throughout.
        assertEquals(homes, covers { it.homes })
        assertTrue(enforcer.updates.value.locked)
    }

    @Test
    fun eachSystemAppTheShellFindsForAnEmergencyOrSettingsPartIsAllowedAndAnAppThatOnlyDeclaresOneNever() {
        val allowed = AllowList.of(context)
        // The shell sees every app; Bali only those its `<queries>` show it. Each system app holding a part is allowed.
        val system = shell("pm list packages -s").lines().map { it.removePrefix("package:").trim() }.toSet()
        fun found(query: String) = Regex("""^\s+([\w.]+)/""", RegexOption.MULTILINE).findAll(shell("cmd package $query")).map { it.groupValues[1] }.toList()
        val asked =
            listOf(EMERGENCY_DIALER, "android.intent.action.DIAL_EMERGENCY", EMERGENCY_ASSISTANCE, Settings.ACTION_SETTINGS, Settings.ACTION_ACCESSIBILITY_SETTINGS, "android.content.pm.action.REQUEST_PERMISSIONS", Intent.ACTION_CHOOSER)
        for (action in asked) found("query-activities --brief -a $action").filter { it in system }.let { assertTrue("$action: $it", it.all { app -> app in allowed }) }
        // Emergency alerts, by Android 11's broadcast and Android 10's, as the allow-list asks: the system's receiver allowed;
        // the tests' own app declares Android 11's too (StandIn.Alert), as any app may, and is no system app.
        val alerts = EMERGENCY_ALERTS.flatMap { found("query-receivers --brief -a $it") }
        assertTrue("$alerts", STAND_IN_APP in alerts && alerts.any { it in system && it in allowed })
        assertTrue(STAND_IN_APP !in allowed)
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
        // below it bare, and never sent home. The readout in front first, the split's other half; on Android 10, whose split
        // screen isn't System UI's, the readout docked above in a task of its own, then the stand-in brought beside it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            shell("am start -n $READOUT")
            until { Unit.takeIf { READOUT in focused() } }
            shell("dumpsys activity service SystemUIService WMShell splitscreen moveToSideStage ${task(STAND_IN).first} 1")
        } else {
            // Each started afresh, so in its half: an open task keeps its own.
            closeReadouts()
            shell("am stack remove ${checkNotNull(stackOf(STAND_IN))}")
            until { Unit.takeIf { STAND_IN !in shell("am stack list") } }
            shell("am start -W --windowingMode $SPLIT_SCREEN_PRIMARY -n $READOUT")
            shell("am start -W --windowingMode $SPLIT_SCREEN_SECONDARY -n $STAND_IN")
        }
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
    fun aFullScreenAppSentHomeIntoPictureInPictureStaysCoveredWhereItIsTheStudentStillMovesItAndFullScreenAgainItGoesHomeAgain() {
        locked()
        val homes = covers { it.homes }
        // As a video app goes: full screen, covered and sent home, it goes into picture-in-picture.
        shell("am start -n $STAND_IN --ez ${StandIn.PIP_ON_LEAVE} true")
        // Covered where it is, its cover drawn there on the screen, the small window read afresh each time as it moves in,
        // and read once at rest, where System UI takes its touches.
        val small = until { seen().firstOrNull { it.app in pinned && it.pictureInPicture && it.cover == it.bounds && it.bounds at pipTouches() }?.takeIf { pixel(it.bounds.centerX, it.bounds.centerY) == Covers.PLAIN } }
        assertEquals(homes + 1, covers { it.homes })
        // Dragged up or down, as a student drags it off whatever is under it, and let go there, still, so it stays: the touch
        // goes through its cover to System UI, which moves it, and the cover follows it. Android puts it back where it was
        // last, so it starts low or high.
        val (x, y) = small.bounds.centerX to small.bounds.centerY
        val by = if (y > context.resources.displayMetrics.heightPixels / 2) -300 else 300
        shell("input motionevent DOWN $x $y")
        shell("input motionevent MOVE $x ${y + by}")
        shell("input motionevent MOVE $x ${y + 2 * by}")
        shell("input motionevent UP $x ${y + 2 * by}")
        val moved = until { seen().firstOrNull { it.app in pinned && it.pictureInPicture && it.bounds != small.bounds && it.cover == it.bounds && it.bounds at pipTouches() }?.takeIf { pixel(it.bounds.centerX, it.bounds.centerY) == Covers.PLAIN } }
        // Its menu opened, as a student opens it to bring it back full screen: System UI's own window at its place, over it,
        // the touches the menu's, through the cover, which stays, so the app is never seen under the menu's dimmed glass.
        // Android 10's menu is System UI's activity in the small window's own task, listed in the small window's place as the
        // two grow: covered in its stead, its full-screen button in its middle once at rest.
        val (x2, y2) = moved.bounds.centerX to moved.bounds.centerY
        shell("input tap $x2 $y2")
        val open =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                until {
                    seen().takeIf { windows ->
                        windows.any { it.type == AccessibilityWindowInfo.TYPE_SYSTEM && (it.bounds meets moved.bounds) != null } && windows.firstOrNull { it.id == small.id }?.cover == moved.bounds
                    }?.takeIf { pixel(x2, y2) == Covers.PLAIN }
                }
                moved.bounds
            } else {
                until { atRest { seen().firstOrNull { it.app == SYSTEM_UI && it.pictureInPicture && it.cover == it.bounds }?.bounds }?.takeIf { pixel(it.centerX, it.centerY) == Covers.PLAIN } }
            }
        // Opened full screen from the menu: sent home again, under the cover it kept, which on Android 16 is the one that
        // sent it home first. Android 10 may list it where its animation left it, short of the screen, and say no more, so
        // there it can stay in front under its cover instead, until the screen next changes (AN7h).
        shell("input tap ${open.centerX} ${open.centerY}")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            until { Unit.takeIf { covers { it.homes } == homes + 2 } }
        } else {
            until { Unit.takeIf { covers { it.homes } == homes + 2 || seen().any { it.app == STAND_IN_APP && !it.pictureInPicture && it.cover != null } } }
        }
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
            // At rest, where System UI takes its touches: on Android 10 System UI's menu comes and goes first, an event each way.
            val small = until { seen().firstOrNull { it.app in pinned && it.pictureInPicture && it.cover != null && it.bounds at pipTouches() } }
            // Covered before the end, by the phone's clock; the screen still from here on, so no window event comes.
            assertTrue(Instant.now() < end)
            val gone = until { Instant.now().takeIf { covers { it.shown }.isEmpty() } }
            assertTrue("$gone from $end", !gone.isBefore(end) && gone.isBefore(end.plusSeconds(2)))
            // The small window still there, bare: its own colour at its place, whichever window Android 10 lists there.
            until { Unit.takeIf { pixel(small.bounds.centerX, small.bounds.centerY) == StandIn.COLOUR } }
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
     * it first, again until it shows whole, since a readout made again for its half may not have laid out yet; then
     * tapped twice, the first tap giving the readout the focus, which can come after that tap's own ask for the keyboard.
     * Returns the field's place on the screen.
     */
    private fun typeIn(which: (ReadoutActivity) -> Boolean): Rect {
        val field =
            until {
                var shown: Rect? = null
                instrumentation.runOnMainSync {
                    val readout = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<ReadoutActivity>().firstOrNull(which)
                    val blockTag = readout?.blockTag ?: return@runOnMainSync
                    // At once, and moving no focus, which would bring the keyboard up before any tap.
                    val scroll = blockTag.rootView.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ScrollView
                    scroll.scrollTo(0, scroll.getChildAt(0).height)
                    shown = Rect().takeIf { blockTag.isLaidOut && blockTag.getGlobalVisibleRect(it) && it.height() == blockTag.height }
                }
                shown
            }
        shell("input tap ${field.centerX()} ${field.centerY()}")
        until { Unit.takeIf { READOUT in focused() } }
        shell("input tap ${field.centerX()} ${field.centerY()}")
        return field
    }

    /** How many calls the call log holds since [since], after deleting them where asked: through the tests' own app (StandIn.Calls). */
    private fun calls(since: Long, delete: Boolean = false): Int {
        val answer = shell("am broadcast -n $STAND_IN_APP/com.bali.bali.StandIn\$Calls --el ${StandIn.Calls.SINCE} $since --ez ${StandIn.Calls.DELETE} $delete")
        return checkNotNull(Regex("""result=(-?\d+)""").find(answer)) { answer }.groupValues[1].toInt()
    }

    /** Android 10's stack holding [component]'s task, as `am stack list` names it. */
    private fun stackOf(component: String): Int? {
        var stack: Int? = null
        for (line in shell("am stack list").lines()) {
            Regex("""^Stack id=(\d+)""").find(line.trim())?.let { stack = it.groupValues[1].toInt() }
            if (Regex("""taskId=\d+: ${Regex.escape(component)} """).containsMatchIn(line)) return stack
        }
        return null
    }

    /** Every readout a test opened closed with its task, gone from Android's list of tasks. */
    private fun closeReadouts() {
        instrumentation.runOnMainSync {
            Stage.entries.flatMap { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(it) }.filterIsInstance<ReadoutActivity>().forEach { it.finishAndRemoveTask() }
        }
        until { Unit.takeIf { READOUT !in shell("am stack list") } }
    }

    /** The window with the focus, as `dumpsys window` names it. */
    private fun focused(): String = shell("dumpsys window").lineSequence().firstOrNull { "mCurrentFocus" in it }.orEmpty()

    /** The activity Android has resumed on top, its record and its name, as `dumpsys activity activities` names them (Android 10 with no space). */
    private fun resumed(): Pair<String, String>? =
        Regex("""^\s*ResumedActivity: ?ActivityRecord\{(\w+) u0 (\S+) t-?\d+\}""", RegexOption.MULTILINE).find(shell("dumpsys activity activities"))?.groupValues?.let { it[1] to it[2] }

    /** The records Android holds now of [activity], as `dumpsys activity activities` names them. */
    private fun records(activity: String): Set<String> =
        Regex("""ActivityRecord\{(\w+) u0 ${Regex.escape(activity)} """).findAll(shell("dumpsys activity activities")).map { it.groupValues[1] }.toSet()

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

    /**
     * The apps a small window's cover is listed for: the stand-in's. Android 10 can leave the service's list of windows as its
     * picture-in-picture animations had it, saying no more changed (AN7h): there System UI's menu may stay listed at the small
     * window's place after it has gone, its cover standing in for the small window's.
     */
    private val pinned get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setOf(STAND_IN_APP) else setOf(STAND_IN_APP, SYSTEM_UI)

    /**
     * Where System UI takes the picture-in-picture window's touches, as `dumpsys input` places its input consumer (Android 10
     * quoting its name). None on Android 10 while its menu is up, an activity that takes them, the consumer still listed then:
     * the top of the small window's task, as `am stack list` names it.
     */
    private fun pipTouches(): Area? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R && "topActivity=ComponentInfo{$SYSTEM_UI/" in shell("am stack list")) return null
        return Regex("""name='?pip_input_consumer'?, .*?frame=\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]""").find(shell("dumpsys input"))?.groupValues?.let { Area(it[1].toInt(), it[2].toInt(), it[3].toInt(), it[4].toInt()) }
    }

    /** Whether a small window is where System UI takes its [touches]: on Android 10, which lists a scaled window's place a pixel short, within that pixel. */
    private infix fun Area.at(touches: Area?): Boolean =
        touches != null && if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) this == touches else listOf(left - touches.left, top - touches.top, right - touches.right, bottom - touches.bottom).all { it in -1..0 }

    /** [place]'s answer once it has stopped moving: the same at two reads a moment apart. */
    private fun atRest(place: () -> Area?): Area? {
        val first = place() ?: return null
        Thread.sleep(250)
        return first.takeIf { place() == it }
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

        // Android 10's split screen's two halves, as `am start --windowingMode` names them.
        const val SPLIT_SCREEN_PRIMARY = 3
        const val SPLIT_SCREEN_SECONDARY = 4
        const val EMERGENCY_DIALER = "com.android.phone.EmergencyDialer.DIAL"
        const val EMERGENCY_ASSISTANCE = "android.telephony.action.EMERGENCY_ASSISTANCE"
        val EMERGENCY_ALERTS = listOf("android.provider.action.SMS_EMERGENCY_CB_RECEIVED", "android.provider.Telephony.SMS_EMERGENCY_CB_RECEIVED")
        const val TAG = "BaliCovers"

        /**
         * Where Google Messages, these emulators' SMS app, ends a number's link: the conversation, on a main screen made anew;
         * on Android 10's image, its Messages of 2019, on a conversation's own screen.
         */
        val MESSAGES_CONVERSATIONS = listOf("com.google.android.apps.messaging/.main.MainActivity", "com.google.android.apps.messaging/.ui.conversation.ConversationActivity")
        val PATIENCE = 30.seconds
    }
}
