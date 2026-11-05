package com.bali.bali

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import com.bali.outbox.Area
import com.bali.outbox.Cover
import com.bali.outbox.OnScreen
import com.bali.outbox.WindowKind
import java.time.Duration
import java.time.Instant

/**
 * Lock (a), Bali's own Accessibility service (ARCHITECTURE, "Android app structure", decision 2), which
 * Android binds, in Bali's process, while the student has it switched on in Settings. What it locks is
 * [ServiceLock]'s, which the enforcer drives: outside a lesson it listens to nothing, in one to window
 * events alone, and it never reads a window's contents (the battery plan). While a lock holds, it covers
 * what [Cover] says ([Covers], AN7e). It is how Bali hears the screen go on and off, for the engine's check-ins
 * ([BaliApp.screen]), and it runs rule 3's check as it binds and as it unbinds, so the switch is judged as
 * it changes. Declared in the Debug build alone, with a developer's label, until AS3 or AS5 declares it in
 * main with AS0's words (DECISIONS 2026-11-05, Q1). Its calls run on the main thread, and what it hears
 * waits for the app's start ([BaliApp.start]).
 */
class LockService : AccessibilityService() {
    private val app get() = application as BaliApp

    private val screen =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                app.screen.value = intent.action == Intent.ACTION_SCREEN_ON
            }
        }

    /** Whether the screen's receiver is registered: only once the service connects, which an unbind can come without. */
    private var hearing = false

    /** Which windows the lock covers, named by their own state events while a lock holds; and the covers up. On the main thread. */
    internal val rule by lazy { Cover(packageName) }
    internal val covers by lazy { Covers(this) }

    /** The allow-list, asked of Android as a lock comes on and kept while it holds. */
    private var allowed: Set<String>? = null
    private val main = Handler(Looper.getMainLooper())

    /** The covers made again at the lock's end, which no event marks. */
    private val atTheEnd = Runnable { cover() }

    override fun onServiceConnected() {
        // No node is ever read, so no cache to keep, nor the events that would keep one.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setCacheEnabled(false)
        app.lock.bound(this)
        // Only registered at run time, these two; and the screen as it is now, which none says.
        if (!hearing) registerReceiver(screen, IntentFilter(Intent.ACTION_SCREEN_ON).apply { addAction(Intent.ACTION_SCREEN_OFF) })
        hearing = true
        app.screen.value = getSystemService(PowerManager::class.java).isInteractive
        app.check()
    }

    // Unbound, Bali hears the screen no more, so the engine's check-ins stop with one, as the screen going
    // off has it: never one every 30 s with the screen off. Android unbinds a service switched off while it
    // binds without connecting it first, its receiver never registered. Its covers go with it.
    override fun onUnbind(intent: Intent?): Boolean {
        if (hearing) unregisterReceiver(screen)
        hearing = false
        app.screen.value = false
        app.lock.bound(null)
        main.removeCallbacks(atTheEnd)
        uncover()
        app.check()
        return super.onUnbind(intent)
    }

    // Each window's app from the window's own state event, never from its contents (the battery plan); then the covers again.
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && event.windowId >= 0) {
            event.packageName?.let { rule.named(event.windowId, it.toString()) }
        }
        cover()
    }

    override fun onInterrupt() = Unit

    /**
     * Covers what the lock covers now ([Cover]), at each window event, each change of the lock and its end, which no event
     * marks, nothing woken but this thread, the lock's already (ARCHITECTURE, "The bell needs no extension"). What Android
     * can't give now, its own process gone as the phone restarts, leaves the covers as they were. On the main thread.
     */
    internal fun cover() {
        main.removeCallbacks(atTheEnd)
        val now = Instant.now()
        val until = app.lock.until?.takeIf { it > now }
        try {
            if (until == null) return uncover()
            val allow = allowed ?: AllowList.of(this).also { allowed = it }
            covers.show(rule.covering(onScreen(), allow, safe(), until, now))
        } catch (gone: RuntimeException) {
            // Asked again at the next event, or at the lock's end below.
        }
        // The last run's lock has no end of its own.
        if (until != null && until < Instant.MAX) main.postDelayed(atTheEnd, Duration.between(now, until).toMillis() + 1)
    }

    /** Nothing covered, and nothing kept of what was: no lock holds, or the service goes. */
    private fun uncover() {
        rule.forget()
        allowed = null
        covers.show(emptyList())
    }

    /** The windows on the screen, top first, as Android lists them: their ids, kinds and places, never their contents. */
    private fun onScreen(): List<OnScreen> =
        windows.map { window ->
            val bounds = Rect().also(window::getBoundsInScreen)
            OnScreen(window.id, kind(window.type), Area(bounds.left, bounds.top, bounds.right, bounds.bottom), window.isInPictureInPictureMode)
        }

    private fun kind(type: Int) =
        when (type) {
            AccessibilityWindowInfo.TYPE_APPLICATION -> WindowKind.App
            AccessibilityWindowInfo.TYPE_SYSTEM -> WindowKind.Drawn
            AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY, AccessibilityWindowInfo.TYPE_MAGNIFICATION_OVERLAY, AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER -> WindowKind.Passed
            else -> WindowKind.Kept
        }

    /**
     * The screen but its system bars and its cutout, so the status bar and the gesture bar stay the student's. Android 10
     * measures no insets outside a window: there, the part an app's window fills (its own way, deprecated since), the status
     * bar's window kept clear as any other.
     */
    private fun safe(): Area {
        val manager = getSystemService(WindowManager::class.java)
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return Point().also { manager.defaultDisplay.getSize(it) }.run { Area(0, 0, x, y) }
        val metrics = manager.currentWindowMetrics
        val bars = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        return metrics.bounds.run { Area(left + bars.left, top + bars.top, right - bars.right, bottom - bars.bottom) }
    }
}
