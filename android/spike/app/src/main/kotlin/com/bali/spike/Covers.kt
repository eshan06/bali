package com.bali.spike

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.text.DateFormat
import java.util.Date

/** The plain block screen: what a blocked app shows while it's covered. */
@SuppressLint("ViewConstructor")
class BlockView(context: Context, lock: String) : FrameLayout(context) {
    var onFirstDraw: (() -> Unit)? = null

    init {
        setBackgroundColor(Color.rgb(14, 26, 43))
        isClickable = true // the app under the cover gets no touches
        val until = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(Session.endWall))
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        }
        column.addView(TextView(context).apply {
            text = "Focus until $until"
            textSize = 24f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        column.addView(TextView(context).apply {
            text = "This app opens again after class. (lock $lock)"
            textSize = 16f
            setTextColor(Color.rgb(200, 210, 225))
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 48)
        })
        column.addView(holdToUnlock(context, "cover-$lock"))
        addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    }

    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        onFirstDraw?.let {
            onFirstDraw = null
            it()
        }
    }
}

/** Emergency Unlock: a one-second hold, as on iOS. */
@SuppressLint("ClickableViewAccessibility")
fun holdToUnlock(context: Context, source: String): Button = Button(context).apply {
    text = "Emergency Unlock (hold 1 s)"
    var downAt = 0L
    val fire = Runnable {
        Spike.log("unlock-hold-complete", "source" to source, "heldMs" to (System.currentTimeMillis() - downAt))
        Session.unlock(source)
    }
    setOnTouchListener { view, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downAt = System.currentTimeMillis()
                view.isPressed = true
                Spike.log("unlock-hold-down", "source" to source)
                view.postDelayed(fire, 1000)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                view.isPressed = false
                view.removeCallbacks(fire)
                Spike.log("unlock-hold-up", "source" to source, "heldMs" to (System.currentTimeMillis() - downAt))
            }
        }
        true
    }
}

/**
 * The covers one lock has up: overlay windows of [type], each keyed by what it covers. (a) puts
 * one over each blocked window, at its bounds; (b), which knows no bounds, one over the screen.
 */
class Covers(private val context: Context, private val type: Int, private val lock: String) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val shown = HashMap<String, Pair<BlockView, Rect?>>()

    val count get() = shown.size

    fun show(key: String, pkg: String, bounds: Rect?) {
        val existing = shown[key]
        if (existing != null) {
            if (existing.second != bounds) {
                wm.updateViewLayout(existing.first, params(bounds))
                shown[key] = existing.first to bounds
                Spike.log("cover-moved", "lock" to lock, "key" to key, "pkg" to pkg, "bounds" to bounds?.toShortString())
            }
            return
        }
        val view = BlockView(context, lock)
        view.onFirstDraw = {
            Spike.log("cover-drawn", "lock" to lock, "key" to key, "pkg" to pkg, "bounds" to bounds?.toShortString())
        }
        try {
            wm.addView(view, params(bounds))
            shown[key] = view to bounds
            Spike.log("cover-added", "lock" to lock, "key" to key, "pkg" to pkg, "bounds" to bounds?.toShortString())
        } catch (e: RuntimeException) {
            Spike.log("cover-failed", "lock" to lock, "pkg" to pkg, "err" to "${e.javaClass.simpleName}:${e.message}")
        }
    }

    fun keepOnly(keys: Set<String>, reason: String) {
        for (key in shown.keys - keys) {
            val (view, _) = shown.remove(key) ?: continue
            try {
                wm.removeViewImmediate(view)
            } catch (_: RuntimeException) {
            }
            Spike.log("cover-removed", "lock" to lock, "key" to key, "reason" to reason)
        }
    }

    fun hideAll(reason: String) = keepOnly(emptySet(), reason)

    private fun params(bounds: Rect?): WindowManager.LayoutParams {
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        val lp = if (bounds == null) {
            // The whole screen between the system bars: the status bar and the home gesture stay.
            WindowManager.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
                type, flags, PixelFormat.OPAQUE,
            )
        } else {
            WindowManager.LayoutParams(
                bounds.width(), bounds.height(), type,
                flags or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.OPAQUE,
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = bounds.left
                y = bounds.top
                fitInsetsTypes = 0
            }
        }
        lp.title = "BaliCover-$lock"
        return lp
    }
}
