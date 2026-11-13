package com.bali.bali

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.edit
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.bali.core.BlockRead
import com.bali.core.EnrollmentJoinRequest
import com.bali.core.EventId
import com.bali.core.SignIn
import com.bali.outbox.AgeCheck
import com.bali.outbox.Change
import com.bali.outbox.Enforcer
import com.bali.outbox.Problem
import com.bali.outbox.Protection
import com.bali.outbox.Screen
import com.bali.outbox.Standing
import com.bali.outbox.SyncState
import com.bali.outbox.SystemClock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The phone checks' readout (docs/ANDROID-PHONE-TESTS.md), BaliApp.swift's `Readout`: the engine's link, the
 * sign-in, the standing, what rule 3's check found of the lock, the service and how long it took to bind, and
 * the queue, with the triggers the screens will have. In the Debug build alone, with a launcher entry of its
 * own, until Phase 10's screens: a developer's words, never a student's, and nothing a teacher sees, as iOS's
 * (DECISIONS 2026-09-25, B4c; 2026-11-05, AN7d). Plain Views: today's Compose needs compileSdk 37. In front,
 * it tells the app ([BaliApp.front]), which reads the truth and runs rule 3's check. Its Scan reads a block over
 * NFC and taps it, and Read block code only reads one, for registering it (AN8). Its Join joins a typed code,
 * and History reads the last five moments (AN9i); its Signed in line reads the run's account and names the 13+
 * check (Q3), which has no button before AS2's question, and Delete account isn't here: AS7's. Its Screen line
 * says what the app's router shows (Q11), the screen Phase 10 will draw there. Not here: iOS's marker, asks and
 * monitor, which have no twin.
 */
// Lint's SetTextI18n guards the words a student reads and a translator translates: these are a developer's alone.
@SuppressLint("SetTextI18n")
class ReadoutActivity : ComponentActivity() {
    private val app get() = application as BaliApp
    internal lateinit var lines: TextView
    internal lateinit var signIn: Button
    internal lateinit var signOut: Button
    internal lateinit var scan: Button
    internal lateinit var readCode: Button
    internal lateinit var blockTag: EditText
    internal lateinit var tap: Button
    internal lateinit var joinCode: EditText
    internal lateinit var join: Button
    internal lateinit var unlock: Button
    internal lateinit var history: Button
    internal lateinit var shortCap: CheckBox
    internal lateinit var tryAgain: Button
    private var drawing: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lines = TextView(this).apply { typeface = Typeface.MONOSPACE }
        signIn = button("Sign in") { signingIn() }
        signOut = button("Sign out") { ownSignIn()?.let { it.signOut(); "signed out" } ?: "${notOwn()}: nobody signed out" }
        // iOS's Allow Screen Time: Android asks nothing, the student switches the service on there.
        val settings = Button(this).apply { text = "Open Accessibility settings"; setOnClickListener { accessibility() } }
        // B6's: the block read over NFC and tapped, or only read, to register it on dev.
        scan = button("Scan") { scanned() }
        readCode = button("Read block code") { said(BlockReader(this).read(), "read only, nothing recorded") }
        blockTag = EditText(this).apply { hint = "Block tag"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS }
        // The tag read here, on the main thread, before the trigger goes.
        tap = Button(this).apply { text = "Tap"; setOnClickListener { blockTag.text.toString().trim().let { typed -> act { tapped(typed) } } } }
        joinCode = EditText(this).apply { hint = "Join code"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS }
        // The code read here, on the main thread, before the trigger goes.
        join = Button(this).apply { text = "Join"; setOnClickListener { joinCode.text.toString().trim().let { typed -> act { joined(typed) } } } }
        unlock = button("Emergency Unlock") { if (app.running.value?.engine?.emergencyUnlock() == null) "nothing to unlock" else "recorded" }
        history = button("History") { history() }
        shortCap = CheckBox(this).apply { text = "Cap a tap at 15 min (phone check)"; isChecked = cap(context) != null; setOnCheckedChangeListener { _, on -> capped(on) } }
        tryAgain = button("Try again") { app.begin(); app.problem.value?.let { "not started again: ${problem(it)}" } ?: "started" }
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(PAD, PAD, PAD, PAD) }
        listOf(lines, row(signIn, signOut), settings, row(joinCode, join), row(scan, readCode), row(blockTag, tap), unlock, history, shortCap, tryAgain)
            .forEach(column::addView)
        setContentView(ScrollView(this).apply { fitsSystemWindows = true; addView(column) })
    }

    // Drawn while it shows: at each note and change of the run's account, and each second, the service and the launch
    // read live, as iOS's timeline reads its own.
    override fun onStart() {
        super.onStart()
        drawing =
            lifecycleScope.launch {
                launch { note.collect { draw() } }
                launch { app.router.shown.collect { draw() } }
                launch { app.running.collectLatest { run -> run?.account?.state?.collect { draw() } } }
                while (true) {
                    draw()
                    delay(REDRAW)
                }
            }
    }

    override fun onStop() {
        drawing?.cancel()
        super.onStop()
    }

    // Bali's own screen in front, and behind: the engine told, its truth read and rule 3's check run as it comes (BaliApp.start).
    override fun onResume() {
        super.onResume()
        app.front.value = true
    }

    override fun onPause() {
        app.front.value = false
        super.onPause()
    }

    /** The lines as they stand, and the buttons the state offers: Emergency Unlock where it names one, Try again where the start failed. */
    private fun draw() {
        val run = app.running.value
        val state = run?.engine?.updates?.value
        val queued = state?.queued.orEmpty().joinToString(" · ") { it.change.javaClass.simpleName + if (it.stuck) " (stuck: ${it.lastStatus ?: "no answer"})" else "" }
        lines.text =
            listOf(
                "Debug readout — temporary",
                "Engine: ${engine(run)}",
                "Screen: ${screen(app.router.shown.value)}",
                "Link: ${state?.link ?: "no exchange yet"}",
                "Server last answered: ${state?.heardAt?.let(::time) ?: "never"}",
                "Signed in: ${signedIn(run)}",
                "Standing: ${standing(state)}",
                "Lock: ${claim(run?.enforcer?.updates?.value)}",
                "Service: ${service()}",
                "Launch: ${launch()}",
                "Outbox: ${queued.ifEmpty { "empty" }}",
                note.value,
            ).joinToString("\n")
        // Filed where decision 11 says: under a tap not yet answered, else the session.
        unlock.isVisible = state?.emergencyUnlock(null) != null
        tryAgain.isVisible = run == null && app.problem.value != null
    }

    /**
     * Who is signed in, and the 13+ check as the run's account has it (Q3): there's no button for it before AS2. A run with no
     * account is one over no sign-in, a Debug build's start with no config (Q2).
     */
    private fun signedIn(run: BaliApp.Running?): String {
        val account = run?.account?.state?.value ?: return if (run == null) "not known yet" else NOT_SET_UP
        return when (account.signedIn) {
            null -> "not known yet"
            false -> "no"
            true ->
                "yes · 13+ check: " +
                    when (account.age) {
                        AgeCheck.Answer.Passed -> "through"
                        AgeCheck.Answer.Checking -> "asking Bali for this account's yes"
                        AgeCheck.Answer.TooYoung -> "answered under 13 this run: its account's deletion"
                        AgeCheck.Answer.Unanswered, AgeCheck.Answer.Asked -> "not through: Bali's API gets no token until it's answered (AS2's question)"
                    }
        }
    }

    // The run's own: an engine with no sign-in has no account.
    private fun engine(run: BaliApp.Running?): String =
        when {
            run == null -> app.problem.value?.let(::problem) ?: "not running"
            run.account == null -> "over no token, as a signed-out phone: sign-in isn't set up, so nothing is sent"
            else -> "over the sign-in"
        }

    /** Why the start runs nothing (AN10a's [Problem]), a failure's cause as its exception names it. */
    private fun problem(problem: Problem): String =
        when (problem) {
            Problem.NotSetUp -> "not set up: no config, so no engine"
            is Problem.StartFailed -> "start failed: ${problem.cause}"
        }

    /** What the router shows now (Q11), as Phase 10's screens will draw it: the screen's type, and the tab bar where it shows. */
    private fun screen(shown: Screen.Shown): String {
        val screen = (shown.screen as? Screen.Storage)?.let { "Storage, ${problem(it.problem)}" } ?: shown.screen.toString()
        return screen + if (shown.tabbed) " · tab bar" else ""
    }

    private fun standing(state: SyncState?): String =
        when (val stood = state?.standing) {
            is Standing.InSession -> "${stood.state?.wire ?: "unknown"} until ${time(stood.session.endsAt)}"
            Standing.Waiting -> "waiting for the teacher's Start" + (state.waitEnds?.let { ", until $it" } ?: ", no end kept")
            Standing.Unread -> "not read from the phone yet — Emergency Unlock still works"
            Standing.Out -> "in no session"
            null -> "no engine"
        }

    /** What rule 3's check found, never the standing alone. */
    private fun claim(claim: Protection?): String {
        if (claim == null || !claim.checked) return "not checked yet"
        val switch = "switch ${claim.switch.name.lowercase()}" + if (claim.switchedOff) ", judged off" else ""
        val until = claim.until?.let { ", due until ${time(it)}" }.orEmpty()
        return "$switch · ${if (claim.locked) "locked" else "not locked"}$until" + if (claim.unreported) " · protection off NOT recorded" else ""
    }

    /** The service as Android has it, and what Bali told it to hear; unbound, Bali hears no screen, so nothing checks in. */
    private fun service(): String {
        val listed = if (app.lock.listed()) "on Android's list" else "off Android's list"
        val hears = mapOf(true to "the windows", false to "nothing")[app.lock.listening] ?: "nothing told yet"
        return if (app.lock.service != null) "$listed, bound, listening to $hears" else "$listed, not bound: Bali hears no screen, so nothing checks in"
    }

    /** How long the switch read starting after this run's first read, against the grace (Q3): iOS's `PhoneScreenTime.launch`. */
    private fun launch(): String {
        val first = app.lock.firstRead ?: return "not read yet"
        val (after, read) = app.lock.settled ?: return "starting for ${seconds(SystemClock.uptime() - first)} so far, off at ${seconds(Enforcer.GRACE)}"
        return if (after.isZero) "${read.name.lowercase()} at the first read" else "starting for ${seconds(after)}, then ${read.name.lowercase()}"
    }

    /**
     * Signs in as Sign in will, through the hosted UI's tab (AN6c), and its sign-out page where that tab left Cognito's session
     * in the browser (AN6e), over the app's own run alone ([ownSignIn]).
     */
    private suspend fun signingIn(): String {
        val signIn = ownSignIn() ?: return "${notOwn()}: nothing opened"
        signIn.signIn { hostedUi(it, signIn.cognito) }
        return "signed in"
    }

    /**
     * The app's own sign-in while the run's engine is the one the app's start made over it ([BaliApp.overSignIn]); none
     * otherwise, so Sign in and Sign out never reach it from another run: none, one over no sign-in (a Debug build's start with
     * no config, Q2), or one over a sign-in of its own, as a test's is. There they do nothing and say why ([notOwn]).
     */
    internal fun ownSignIn(): SignIn? = app.signIn?.takeIf { app.running.value?.engine?.let { it === app.overSignIn } == true }

    /** Why Sign in and Sign out reach no sign-in: no run, a run over none, or one over another's. */
    private fun notOwn(): String {
        val run = app.running.value ?: return "no engine runs"
        return if (run.account == null) NOT_SET_UP else "this run's engine is over a sign-in of its own, not the app's"
    }

    private fun accessibility() =
        try { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } catch (none: ActivityNotFoundException) { note.value = "not opened: $none" }

    /** A tap of the block [typed], through the engine, as the screens will record one. */
    private suspend fun tapped(typed: String): String {
        val engine = app.running.value?.engine ?: return "no engine: nothing recorded"
        if (typed.isEmpty()) return "type a block's tag first"
        return if (engine.record(Change.Tap(typed)) == null) "nothing new to send" else "recorded"
    }

    /** A class joined with the code [typed], through the engine, as the Join screen joins one (its look-up first is AS4's): in `me` at once. */
    private suspend fun joined(typed: String): String {
        val engine = app.running.value?.engine ?: return "no engine: nothing joined"
        if (typed.isEmpty()) return "type a join code first"
        val now = Instant.now()
        val joined = engine.join(EnrollmentJoinRequest(typed, EventId.mint(now), now))
        return joined.answer?.let { "joined ${it.schoolClass.name}" } ?: "not joined: ${joined.result} ${joined.error?.error?.message.orEmpty()}".trim()
    }

    /** The student's latest moments, as `GET /v1/me/history` gives them, newest first: each its wire name and when. */
    private suspend fun history(): String {
        val engine = app.running.value?.engine ?: return "no engine: no history read"
        val page = engine.client.history(limit = 5)
        val events = page.answer?.events ?: return "history not read: ${page.result}"
        return events.joinToString(" · ") { "${it.type.wire} ${time(it.occurredAt)}" }.ifEmpty { "history: no moments yet" }
    }

    /**
     * A scan of the block, tapped through the engine as the screens will tap one (iOS's Scan), and how long the lock
     * took after the read, for the phone check's second (docs/ANDROID-PHONE-TESTS.md, AN8).
     */
    private suspend fun scanned(): String {
        val read = BlockReader(this).read()
        val at = SystemClock.uptime()
        val run = app.running.value ?: return said(read, "no engine: nothing recorded")
        if (run.engine.tap(read) == null) return said(read, "")
        val locked = withTimeoutOrNull(LOCK_PATIENCE.toMillis()) { run.enforcer.updates.first { it.locked } }
        return said(read, "tap recorded, " + if (locked == null) "not locked within ${seconds(LOCK_PATIENCE)}" else "locked ${(SystemClock.uptime() - at).toMillis()} ms after the read")
    }

    /** A scan, in words: a block's code and [then], or why nothing was recorded. */
    private fun said(read: BlockRead, then: String): String =
        when (read) {
            is BlockRead.Block -> "block ${read.code}: $then"
            BlockRead.NotBali -> "not a Bali block — nothing recorded"
            BlockRead.Cancelled -> "scan cancelled — nothing recorded"
            BlockRead.Unsupported -> "this phone can't read NFC — nothing recorded"
            BlockRead.NfcOff -> "NFC is switched off — nothing recorded"
            is BlockRead.Failed -> "scan failed: ${read.message} — nothing recorded"
        }

    /** B5b's phone check: a tap not yet answered capped at 15 minutes, not 50, kept for the next start. */
    private fun capped(on: Boolean) {
        keep(this, on)
        act {
            app.running.value?.engine?.setTapCap(SHORT_CAP.takeIf { on })
            "a tap not answered yet locks for ${if (on) 15 else 50} min"
        }
    }

    /** Runs [trigger] in the app's scope, so a readout made again never cuts it short, and says how it went: iOS's `run`. */
    private fun act(trigger: suspend () -> String) {
        app.scope.launch { note.value = try { trigger() } catch (failed: Exception) { if (failed is CancellationException) throw failed else "failed: $failed" } }
    }

    private fun button(label: String, trigger: suspend () -> String) = Button(this).apply { text = label; setOnClickListener { act(trigger) } }

    private fun row(vararg views: View) = LinearLayout(this).apply { views.forEach { addView(it, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f)) } }

    private fun time(at: Instant): String = TIME.format(at.atZone(ZoneId.systemDefault()))

    private fun seconds(span: Duration): String = String.format(Locale.ROOT, "%.1f s", span.toMillis() / 1000.0)

    internal companion object {
        /** B5b's phone check's cap on a tap not yet answered: iOS's floor, 15 minutes, not decision 7's 50. */
        val SHORT_CAP: Duration = Duration.ofMinutes(15)

        /** How long a scan's note waits for the lock after the tap: far past the second the tap has (AN8). */
        val LOCK_PATIENCE: Duration = Duration.ofSeconds(5)

        /** What the last trigger did: the process's, so a readout made again keeps it. */
        val note = MutableStateFlow("")

        /** The phone's own way of writing a time, with its seconds. */
        val TIME: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM)
        private const val CAPPED = "capped"
        private const val NOT_SET_UP = "sign-in isn't set up in this build"
        private const val PAD = 32
        private const val REDRAW = 1000L

        /** The cap kept in the readout's own preferences, read at each start ([ThisBuild.starting]); none: decision 7's. */
        fun cap(context: Context): Duration? = SHORT_CAP.takeIf { prefs(context).getBoolean(CAPPED, false) }

        /** Keeps the readout's cap, [on] or not, for the next start. */
        fun keep(context: Context, on: Boolean) = prefs(context).edit { putBoolean(CAPPED, on) }

        private fun prefs(context: Context) = context.getSharedPreferences("readout", Context.MODE_PRIVATE)
    }
}
