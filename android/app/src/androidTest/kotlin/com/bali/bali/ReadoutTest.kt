package com.bali.bali

import android.app.Instrumentation
import android.app.UiAutomation
import android.content.Intent
import android.nfc.NfcAdapter
import android.os.ParcelFileDescriptor
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.outbox.Change
import com.bali.outbox.Enforcer
import com.bali.outbox.Link
import com.bali.outbox.LockSwitch
import com.bali.outbox.Outbox
import com.bali.outbox.OutboxDatabase
import com.bali.outbox.OutboxRecord
import com.bali.outbox.SyncEngine
import com.bali.outbox.SyncState
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Debug readout on the emulator (AN7d; its Scan, AN8's), driven as a tester drives it: its buttons pressed, its lines read.
 * Each test runs a Debug build's engine over no token (ThisBuild, Q2), as the app's start makes one while
 * sign-in isn't set up, but over the test's own file and scope, handed to the app's start; the service
 * switched on as a student would, through the shell of a UiAutomation that leaves accessibility services
 * running. What the engine and the enforcer do is the JVM's to prove; here, that the readout reaches them.
 */
@RunWith(AndroidJUnit4::class)
class ReadoutTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as BaliApp
    private lateinit var scope: CoroutineScope
    private lateinit var outbox: Outbox
    private lateinit var engine: SyncEngine
    private var readout: ActivityScenario<ReadoutActivity>? = null

    /** Android's list of switched-on services, and its master switch, as the test found them: put back after. */
    private lateinit var found: Pair<String, String>

    private val enforcer: Enforcer get() = checkNotNull(app.running.value).enforcer

    @Before
    fun start(): Unit =
        runBlocking {
            found = shell("settings get secure enabled_accessibility_services").trim() to shell("settings get secure accessibility_enabled").trim()
            ReadoutActivity.keep(context, false)
            ReadoutActivity.note.value = ""
            context.deleteDatabase(FILE)
            // After the app's own start, which would otherwise replace this run.
            app.launched.join()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            outbox = Outbox.open(Room.databaseBuilder(context, OutboxDatabase::class.java, FILE))
            engine = checkNotNull(ThisBuild.unsigned(context.getString(R.string.BALI_API_URL), app.transport, scope) { outbox })
            app.start(engine, scope)
        }

    // Everything that reads the test's outbox ended before its file closes (the engine rig's teardown, AN5c),
    // the app's own run too, a Try again's; then the lock off and the switch put back as found.
    @After
    fun stop(): Unit =
        runBlocking {
            readout?.close()
            withTimeout(PATIENCE) { scope.coroutineContext.job.cancelAndJoin() }
            app.running.value?.job?.cancelAndJoin()
            outbox.close()
            app.lock.unlock()
            put(found.first)
            shell(if (found.second == "null") "settings delete secure accessibility_enabled" else "settings put secure accessibility_enabled ${found.second}")
            until { Unit.takeIf { app.lock.service == null } }
            context.deleteDatabase(FILE)
            ReadoutActivity.keep(context, false)
            ReadoutActivity.note.value = ""
        }

    @Test
    fun aTypedTapIsQueuedAndLockedOfflineToItsCapTheShortCapMovesItsEndAndEmergencyUnlockShowsAndDropsTheLock() {
        switchOn()
        val readout = open()
        // Nothing locks yet, so no Emergency Unlock.
        until { readout.lines().takeIf { "Lock: switch on · not locked" in it } }
        assertFalse(readout.shows { it.unlock })
        readout.onActivity {
            it.blockTag.setText("04:A2:1B")
            it.tap.performClick()
        }
        val tap = until { engine.updates.value.queued.firstOrNull { it.change == Change.Tap("04:A2:1B") } }
        // Locked at once, offline, to decision 7's cap, and said so; the service listens to the windows.
        val capped = tap.recordedAt + SyncState.TAP_CAP
        until { enforcer.updates.value.takeIf { it.locked && it.until == capped } }
        val shown = until { readout.lines().takeIf { "Lock: switch on · locked, due until ${time(capped)}" in it } }
        assertTrue(shown, "Service: on Android's list, bound, listening to the windows" in shown)
        assertTrue(shown, "Outbox: Tap" in shown)
        assertTrue(shown, Regex("""Launch: (\w+ at the first read|starting for \d+\.\d s, then \w+)""").containsMatchIn(shown))
        until { readout.shows { it.unlock }.takeIf { it } }
        // The phone check's cap: the end 15 minutes after the tap, kept for the next start.
        readout.onActivity { it.shortCap.performClick() }
        val short = tap.recordedAt + ReadoutActivity.SHORT_CAP
        until { enforcer.updates.value.takeIf { it.locked && it.until == short } }
        until { readout.lines().takeIf { "due until ${time(short)}" in it } }
        assertEquals(ReadoutActivity.SHORT_CAP, ReadoutActivity.cap(context))
        // Emergency Unlock, filed under the tap: the lock off at once.
        readout.onActivity { it.unlock.performClick() }
        until { engine.updates.value.queued.firstOrNull { it.change == Change.UnlockUnderTap(tap.eventId, null) } }
        until { enforcer.updates.value.takeIf { it.checked && !it.locked && it.until == null } }
        until { readout.lines().takeIf { "Outbox: Tap · UnlockUnderTap" in it && "not locked" in it } }
        // Never on the wire: waiting on sign-in, the server never heard from.
        val state = engine.updates.value
        assertEquals(Link.SignIn, state.link)
        assertNull(state.heardAt)
        assertTrue("Server last answered: never" in readout.lines())
    }

    @Test
    fun signInOpensNothingWhileSignInIsNotSetUpAndSaysSo() {
        val started = CopyOnWriteArrayList<Intent>()
        val recorder =
            object : Instrumentation.ActivityMonitor() {
                override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                    started += Intent(intent)
                    return null
                }
            }
        val readout = open()
        until { readout.lines().takeIf { "Signed in: sign-in isn't set up in this build" in it } }
        instrumentation.addMonitor(recorder)
        try {
            readout.onActivity { it.signIn.performClick() }
            // The press's own end, its note: by then nothing was started.
            val said = until { ReadoutActivity.note.value.takeIf { it.isNotEmpty() } }
            assertTrue(said, said.startsWith("sign-in isn't set up in this build"))
            assertEquals(emptyList<Intent>(), started)
        } finally {
            instrumentation.removeMonitor(recorder)
        }
    }

    @Test
    fun scanAndReadBlockCodeOnAPhoneWithNoNfcSaySoAndRecordNothing() {
        // The emulators have no NFC; a phone with it is the phone check's (docs/ANDROID-PHONE-TESTS.md, AN8).
        assumeTrue("this phone has NFC", NfcAdapter.getDefaultAdapter(context) == null)
        switchOn()
        val readout = open()
        until { readout.lines().takeIf { "Lock: switch on · not locked" in it } }
        for (press in listOf<(ReadoutActivity) -> Unit>({ it.scan.performClick() }, { it.readCode.performClick() })) {
            ReadoutActivity.note.value = ""
            readout.onActivity { press(it) }
            // The press's own end, its note: by then anything it recorded is queued.
            assertEquals("this phone can't read NFC — nothing recorded", until { ReadoutActivity.note.value.takeIf { it.isNotEmpty() } })
        }
        assertEquals(emptyList<OutboxRecord>(), engine.updates.value.queued)
        assertEquals(emptyList<OutboxRecord>(), runBlocking { outbox.records() })
        assertFalse(enforcer.updates.value.locked)
        assertTrue("Outbox: empty" in readout.lines())
    }

    @Test
    fun inFrontItHasTheTruthReadAndBehindItSendsAnUnlockHeldForItsReason(): Unit =
        runBlocking {
            // The service off, so no screen heard: nothing reads the truth but Bali coming to the front, and the
            // readout says nothing checks in.
            until { enforcer.updates.value.takeIf { it.checked } }
            assertNull(engine.updates.value.link)
            val readout = open()
            assertTrue(app.front.value)
            until { engine.updates.value.takeIf { it.link == Link.SignIn } }
            until { readout.lines().takeIf { "Service: off Android's list, not bound: Bali hears no screen, so nothing checks in" in it } }
            // An unlock held for its reason, as Unlocked's will be (C5a), then the readout behind: it goes now.
            val tap = checkNotNull(engine.record(Change.Tap("tag")))
            val unlock = checkNotNull(engine.record(Change.UnlockUnderTap(tap.eventId, null), Duration.ofSeconds(15)))
            val held = checkNotNull(outbox.records().firstOrNull { it.eventId == unlock.eventId }).nextAttemptAt
            assertEquals(unlock.recordedAt + Duration.ofSeconds(15), held)
            readout.moveToState(Lifecycle.State.STARTED)
            assertFalse(app.front.value)
            val sent = until { runBlocking { outbox.records() }.firstOrNull { it.eventId == unlock.eventId }?.nextAttemptAt?.takeIf { it < held } }
            assertTrue("$sent", sent >= unlock.recordedAt)
        }

    @Test
    fun aStartThatFailedIsShownWithTryAgainWhichStartsTheApp(): Unit =
        runBlocking {
            // This test's run ended, and the app's start refused (its outbox, say): nothing runs, and the readout
            // says why, with a way to try again (CLAUDE.md, "no silent failures").
            withTimeout(PATIENCE) { scope.coroutineContext.job.cancelAndJoin() }
            app.begin { throw IOException("the disk refused the outbox") }
            val readout = open()
            until { readout.lines().takeIf { "Engine: start failed: java.io.IOException: the disk refused the outbox" in it } }
            assertTrue(readout.shows { it.tryAgain })
            // Tried again, the app's own start, over its own file.
            readout.onActivity { it.tryAgain.performClick() }
            until { ReadoutActivity.note.value.takeIf { it == "started" } }
            assertNull(app.startFailed.value)
            until { readout.lines().takeIf { "Engine: over no token, as a signed-out phone" in it } }
            assertFalse(until { readout.shows { it.tryAgain }.takeIf { !it } })
        }

    /** The readout, opened as from the launcher, in front. */
    private fun open(): ActivityScenario<ReadoutActivity> = ActivityScenario.launch(ReadoutActivity::class.java).also { readout = it }

    private fun ActivityScenario<ReadoutActivity>.lines(): String {
        var lines = ""
        onActivity { lines = it.lines.text.toString() }
        return lines
    }

    private fun ActivityScenario<ReadoutActivity>.shows(view: (ReadoutActivity) -> android.view.View): Boolean {
        var shows = false
        onActivity { shows = view(it).isVisible }
        return shows
    }

    private fun time(at: Instant): String = ReadoutActivity.TIME.format(at.atZone(ZoneId.systemDefault()))

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
    private fun shell(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).executeShellCommand(command))
            .use { it.readBytes().decodeToString() }

    private companion object {
        const val FILE = "readout-test.sqlite"
        const val SERVICE = "com.bali.bali/com.bali.bali.LockService"
        val PATIENCE = 30.seconds
    }
}
