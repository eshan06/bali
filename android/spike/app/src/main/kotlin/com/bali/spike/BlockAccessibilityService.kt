package com.bali.spike

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo

/**
 * Lock (a): an Accessibility service that sees which app comes to the front and covers it. It
 * reads the windows on screen, each with its bounds, and covers each blocked app's window where
 * it is, so split screen and picture-in-picture are covered window by window. It reads nothing
 * from inside another app but its package name, and keeps none of it.
 */
class BlockAccessibilityService : AccessibilityService() {
    private lateinit var covers: Covers
    private lateinit var ticker: Ticker
    private var allow: Map<String, String> = emptyMap()
    private val packageOfWindow = HashMap<Int, String>()
    private var lastApps = ""
    private val onSession = Runnable { sessionChanged() }

    override fun onServiceConnected() {
        Session.init(this)
        covers = Covers(this, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY, Session.A)
        ticker = Ticker(this, Session.A)
        connected = true
        Session.addListener(onSession)
        Spike.log("a11y-connected", "session" to Session.describe())
        sessionChanged()
    }

    private fun sessionChanged() {
        if (Session.activeFor(Session.A)) {
            allow = AllowList.compute(this)
            AllowList.log(Session.A, allow)
            ticker.start()
            Spike.log("lock-armed", "lock" to Session.A, "session" to Session.describe())
        } else {
            ticker.stop("session:${Session.describe()}")
        }
        evaluate("session")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val pkg = event.packageName?.toString()
                if (pkg != null && event.windowId >= 0) packageOfWindow[event.windowId] = pkg
                Spike.log(
                    "a11y-state", "pkg" to pkg, "cls" to event.className, "win" to event.windowId,
                    "eventUptime" to event.eventTime,
                )
                evaluate("state:$pkg")
            }
            AccessibilityEvent.TYPE_WINDOWS_CHANGED -> {
                Spike.log(
                    "a11y-windows", "changes" to event.windowChanges, "win" to event.windowId,
                    "eventUptime" to event.eventTime,
                )
                evaluate("windows")
            }
        }
    }

    private fun evaluate(why: String) {
        if (!::covers.isInitialized) return
        if (!Session.activeFor(Session.A)) {
            covers.hideAll(if (Session.mode == Session.A) "unlocked-or-bell" else "no-session")
            return
        }
        val onScreen = try {
            windows
        } catch (e: RuntimeException) {
            Spike.log("a11y-windows-failed", "err" to e.javaClass.simpleName)
            emptyList()
        }
        // The shade, quick settings or the lock screen open: System UI is never covered.
        val tall = resources.displayMetrics.heightPixels / 3
        val system = onScreen.firstOrNull {
            it.type == AccessibilityWindowInfo.TYPE_SYSTEM && boundsOf(it).height() > tall
        }
        if (system != null) {
            covers.hideAll("system-ui:${system.title}")
            return
        }
        val screen = safeArea()
        val wanted = HashMap<String, Pair<String, Rect>>()
        val apps = StringBuilder()
        for (window in onScreen) {
            if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            val pkg = packageOfWindow[window.id]
                ?: window.root?.packageName?.toString()?.also { packageOfWindow[window.id] = it }
            val bounds = boundsOf(window)
            apps.append(window.id).append(':').append(pkg).append(':').append(bounds.toShortString())
            if (window.isInPictureInPictureMode) apps.append(":pip")
            apps.append(';')
            if (pkg == null || pkg in allow) continue
            if (!bounds.intersect(screen)) continue
            wanted["w${window.id}"] = pkg to bounds
        }
        if (apps.toString() != lastApps) {
            lastApps = apps.toString()
            Spike.log("a11y-apps", "why" to why, "apps" to lastApps)
        }
        covers.keepOnly(wanted.keys, "not-on-screen")
        for ((key, value) in wanted) covers.show(key, value.first, value.second)
    }

    private fun boundsOf(window: AccessibilityWindowInfo) = Rect().also { window.getBoundsInScreen(it) }

    /** The screen between the system bars: the status bar and the home gesture are never covered. */
    private fun safeArea(): Rect = try {
        val metrics = getSystemService(WindowManager::class.java).currentWindowMetrics
        val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
            WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
        )
        val b = metrics.bounds
        Rect(b.left + insets.left, b.top + insets.top, b.right - insets.right, b.bottom - insets.bottom)
    } catch (e: RuntimeException) {
        Rect(0, 0, resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        Spike.log("protection-off", "lock" to Session.A, "why" to "service-unbound", "session" to Session.describe())
        teardown("unbound")
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        Spike.log("a11y-destroyed", "session" to Session.describe())
        teardown("destroyed")
        super.onDestroy()
    }

    private fun teardown(reason: String) {
        connected = false
        Session.removeListener(onSession)
        if (::covers.isInitialized) covers.hideAll(reason)
        if (::ticker.isInitialized) ticker.stop(reason)
    }

    companion object {
        @Volatile
        var connected = false
            private set
    }
}
