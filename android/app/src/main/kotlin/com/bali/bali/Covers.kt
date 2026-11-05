package com.bali.bali

import android.accessibilityservice.AccessibilityService
import android.graphics.Canvas
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import com.bali.outbox.Area
import com.bali.outbox.Covering

/**
 * The covers up (AN7e): over each window the lock covers ([com.bali.outbox.Cover]), a window of Bali's own, an
 * accessibility overlay at that window's place, moved with it and taken away with it. Plain in Debug, no words and no
 * buttons, the iPhone shield's background alone, until AS5's block screen is its content (DECISIONS 2026-11-05, Q1).
 * A cover over an app filling the screen sends the app home once it lands, as Home does (Q5), then goes with its
 * window. The lock's service's, on its thread; a window Android won't add or move now is tried at the next call.
 */
internal class Covers(private val service: AccessibilityService) {
    private val windows = service.getSystemService(WindowManager::class.java)
    private val up = HashMap<Int, Plain>()

    /** Where each cover up is, by the window it covers. */
    val shown: Map<Int, Area> get() = up.mapValues { it.value.want.area }

    /** The last cover to land, the window it covers and when (`System.nanoTime`); and how many apps went home: the tests' to read. */
    @Volatile var landed: Pair<Int, Long>? = null
        private set

    @Volatile var homes = 0
        private set

    /** Covers each window [wanted] as it says, every other cover taken away. */
    fun show(wanted: List<Covering>) {
        val kept = wanted.associateBy { it.window }
        for (window in up.keys - kept.keys) up.remove(window)?.let { tried { windows.removeViewImmediate(it) } }
        for (want in wanted) {
            val cover = up[want.window] ?: Plain(want).takeIf { tried { windows.addView(it, params(want)) } }?.also { up[want.window] = it } ?: continue
            if (cover.want.copy(home = want.home) != want && !tried { windows.updateViewLayout(cover, params(want)) }) continue
            cover.want = want
            cover.goHome()
        }
    }

    /** Whether [change] took: Android refuses an unbound service's overlays, and takes them away itself. */
    private fun tried(change: () -> Unit): Boolean =
        try {
            change()
            true
        } catch (refused: RuntimeException) {
            false
        }

    /** A cover's window: an accessibility overlay, never the keyboard's, a touch outside it, or on it where it holds none, going under. */
    private fun params(want: Covering) =
        WindowManager.LayoutParams(
            want.area.width,
            want.area.height,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                if (want.held) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.OPAQUE,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = want.area.left
            y = want.area.top
            title = TITLE
            // At its place exactly, whatever the system bars ask of a window.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) fitInsetsTypes = 0
        }

    /** One cover: plain, and taking every touch it holds, so the app under it gets none. */
    private inner class Plain(var want: Covering) : View(service) {
        private var drawn = false
        private var sent = false

        init {
            setBackgroundColor(PLAIN)
            isClickable = true
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            if (drawn) return
            drawn = true
            landed = want.window to System.nanoTime()
            // Once this frame is drawn, not inside it.
            post(::goHome)
        }

        /** Sends its app home, once, as the cover lands or as the app comes to fill the screen after; never once the cover has gone with its window. */
        fun goHome() {
            if (!drawn || !want.home || sent || !isAttachedToWindow) return
            sent = true
            homes += 1
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
        }
    }

    companion object {
        /** The covers' windows' title, as `dumpsys window` names them. */
        const val TITLE = "BaliCover"

        /** The iPhone shield's background (BaliShield's `0xF7F5F2`), opaque. */
        const val PLAIN = 0xFFF7F5F2.toInt()
    }
}
