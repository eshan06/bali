package com.bali.bali

import android.app.Instrumentation
import android.app.UiAutomation
import android.content.Intent
import android.nfc.NfcAdapter
import android.os.ParcelFileDescriptor
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.BaliJson
import com.bali.core.EnrollmentJoinRequest
import com.bali.core.SignIn
import com.bali.outbox.AgeCheck
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
import java.net.URI
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
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
import org.junit.Assert.assertNotEquals
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
 * running. Its account, Join and History (AN9i) take a run over a sign-in of the test's own instead ([signed]). What
 * the engine, the account and the enforcer do is the JVM's to prove; here, that the readout reaches them.
 */
@RunWith(AndroidJUnit4::class)
class ReadoutTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as BaliApp
    private val server = Server()
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
            server.close()
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

    // Q3: the Signed in line reads the run's account and names the 13+ check where it stands, which no button answers before
    // AS2's question; nor is Delete account here (AS7's).
    @Test
    fun theSignedInLineFollowsTheRunsAccountAndNamesThe13PlusCheckWhichNoButtonAnswersAndThereIsNoDeleteAccount() {
        val signIn = signed()
        val readout = open()
        until { readout.lines().takeIf { "Signed in: no\n" in it } }
        // The Engine line reads the run too: this one's engine is over a sign-in, the app's own not set up.
        until { readout.lines().takeIf { "Engine: over the sign-in\n" in it } }
        server.signStudentIn(signIn, scope, "student-1")
        val asked = server.next(AGE_CHECK)
        until { readout.lines().takeIf { "Signed in: yes · 13+ check: asking Bali for this account's yes\n" in it } }
        asked.reply(200, """{"passed":false}""")
        until { readout.lines().takeIf { "Signed in: yes · 13+ check: not through: " in it } }
        runBlocking { signIn.signOut() }
        until { readout.lines().takeIf { "Signed in: no\n" in it } }
        server.signStudentIn(signIn, scope, "student-1")
        server.next(AGE_CHECK).reply(200, PASSED)
        until { readout.lines().takeIf { "Signed in: yes · 13+ check: through\n" in it } }
        val buttons =
            listOf(
                "Sign in", "Sign out", "Open Accessibility settings", "Join", "Scan", "Read block code", "Tap", "Emergency Unlock",
                "History", "Cap a tap at 15 min (phone check)", "Try again",
            )
        assertEquals(buttons, readout.buttons())
    }

    // iOS's Readout's Join: the code typed, through the engine, as the Join screen joins one (its look-up first is AS4's),
    // each press under an event id of its own; joined names the class, not joined says the server's answer.
    @Test
    fun joinSendsTheCodeTypedUnderAFreshEventIdAtEachPressAndSaysJoinedOrNotJoinedWithItsAnswer() {
        through(signed())
        val readout = open()
        // A code of spaces alone, trimmed as the Tap trims a tag: said so at once, by the press's own end nothing sent.
        ReadoutActivity.note.value = ""
        readout.onActivity {
            it.joinCode.setText("   ")
            it.join.performClick()
        }
        assertEquals("type a join code first", said())
        assertFalse("POST /v1/enrollments" in server.waiting)
        val joined = join(readout, "6bvza5")
        joined.reply(200, """{"outcome":"joined","enrollmentId":"e","class":{"id":"c","name":"Period 3"}}""")
        assertEquals("joined Period 3", said())
        val refused = join(readout, "NOCODE")
        refused.reply(404, """{"error":{"code":"not_found","reason":"class_not_found","message":"no class with that join code"}}""")
        assertEquals("not joined: Status(code=404) no class with that join code", said())
        val (first, second) = listOf(joined, refused).map { BaliJson.decodeFromString(EnrollmentJoinRequest.serializer(), it.request.body!!.decodeToString()) }
        assertEquals(listOf("6bvza5", "NOCODE"), listOf(first.joinCode, second.joinCode))
        assertNotEquals(first.eventId, second.eventId)
        // Each a UUIDv7, as every mutation's (CLAUDE.md).
        for (id in listOf(first.eventId, second.eventId)) assertTrue(id, Regex("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}").matches(id))
    }

    // iOS's Readout's History: the student's last five moments, read through the engine's client as `GET /v1/me/history`
    // gives them, newest first, each its wire name and time (History's own rules are AN9g's); or why they weren't read.
    @Test
    fun historyReadsTheLastFiveMomentsNewestFirstEachItsWireNameAndTimeOrSaysWhyNot() {
        through(signed())
        val readout = open()
        ReadoutActivity.note.value = ""
        readout.onActivity { it.history.performClick() }
        val read = server.next(HISTORY)
        assertEquals("limit=5", read.request.url.rawQuery)
        val now = Instant.now().truncatedTo(ChronoUnit.SECONDS)
        val moments = listOf("tap_in", "unlock", "refocus", "protection_off", "enrollment_left").mapIndexed { i, type -> type to now.minusSeconds(60L * i) }
        read.reply(200, page(moments))
        assertEquals(moments.joinToString(" · ") { (type, at) -> "$type ${time(at)}" }, said())
        ReadoutActivity.note.value = ""
        readout.onActivity { it.history.performClick() }
        server.next(HISTORY).reply(503, "")
        assertEquals("history not read: Status(code=503)", said())
        // No moments yet: said so, where iOS's shows nothing.
        ReadoutActivity.note.value = ""
        readout.onActivity { it.history.performClick() }
        server.next(HISTORY).reply(200, page(emptyList()))
        assertEquals("history: no moments yet", said())
    }

    /**
     * This test's run started again over a sign-in of its own (TestSignIn.kt), as a relaunch starts one over the same file:
     * everything that read the file ended first. The sign-in it runs over is the test's to sign in.
     */
    private fun signed(): SignIn {
        runBlocking { withTimeout(PATIENCE) { scope.coroutineContext.job.cancelAndJoin() } }
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val signIn = testSignIn(server, scope)
        engine = runBlocking { SyncEngine.make(outbox, URI(API), signIn, scope, server) }
        app.start(engine, scope)
        return signIn
    }

    /** A student signed in over [signIn] and let through the 13+ check on Bali's yes, as the run's account asks it. */
    private fun through(signIn: SignIn) {
        server.signStudentIn(signIn, scope, "student-1")
        server.next(AGE_CHECK).reply(200, PASSED)
        until { app.running.value?.account?.state?.value?.takeIf { it.age == AgeCheck.Answer.Passed } }
    }

    /** [code] typed and Join pressed: its request, once the engine has sent it. */
    private fun join(readout: ActivityScenario<ReadoutActivity>, code: String): Server.Exchange {
        ReadoutActivity.note.value = ""
        readout.onActivity {
            it.joinCode.setText(code)
            it.join.performClick()
        }
        return server.next("POST /v1/enrollments")
    }

    /** What the last press did, once it has ended. */
    private fun said(): String = until { ReadoutActivity.note.value.takeIf { it.isNotEmpty() } }

    /** A page of the history holding [moments], each its wire type and when, in the order given. */
    private fun page(moments: List<Pair<String, Instant>>): String =
        moments.mapIndexed { i, (type, at) ->
            """{"eventId":"e$i","type":"$type","occurredAt":"$at","class":{"id":"c","name":"Period 3"},"teacher":{"displayName":null}}"""
        }.joinToString(",", """{"events":[""", """],"nextBefore":null}""")

    /** The readout's buttons, each as a tester reads it, shown or not. */
    private fun ActivityScenario<ReadoutActivity>.buttons(): List<String> {
        val found = mutableListOf<String>()

        fun walk(view: View) {
            if (view is Button) found += view.text.toString()
            if (view is ViewGroup) (0 until view.childCount).forEach { walk(view.getChildAt(it)) }
        }
        onActivity { walk(it.findViewById(android.R.id.content)) }
        return found
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
        const val HISTORY = "GET /v1/me/history"
        val PATIENCE = 30.seconds
    }
}
