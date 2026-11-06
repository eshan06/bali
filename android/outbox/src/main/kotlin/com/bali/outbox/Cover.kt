package com.bali.outbox

import java.time.Instant

// Which windows the lock covers (AN7e), on the JVM; LockService.kt sees the windows, Covers.kt draws the covers. No iOS
// twin: its shields cover every app at once (PhoneScreenTime.swift's `shield`).

/** A part of the screen, in pixels, as Android's `Rect` has it: [right] and [bottom] just past it. */
data class Area(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top

    /** Where it overlaps [other]; none where they don't. */
    infix fun meets(other: Area): Area? =
        Area(maxOf(left, other.left), maxOf(top, other.top), minOf(right, other.right), minOf(bottom, other.bottom))
            .takeIf { it.width > 0 && it.height > 0 }

    /** All of it where [other] doesn't overlap it, else its largest part clear of [other], above, below or beside it; none where none is. */
    fun clearOf(other: Area): Area? {
        if (meets(other) == null) return this
        return listOf(Area(left, top, right, other.top), Area(left, other.bottom, right, bottom), Area(left, top, other.left, bottom), Area(other.right, top, right, bottom))
            .filter { it.width > 0 && it.height > 0 }
            .maxByOrNull { it.width.toLong() * it.height }
    }
}

/** The safe area on Android 10, which has no insets outside a window: the part an app's window fills, [width] by [height], placed as Android 10 places it, past the cutout and past a navigation bar on the left, turned 270 degrees. */
fun safeOnAndroid10(whole: Int, width: Int, height: Int, cutLeft: Int, cutTop: Int, cutRight: Int, turned270: Boolean): Area {
    val left = if (turned270) whole - width - cutRight else cutLeft
    return Area(left, cutTop, left + width, cutTop + height)
}

/** A window's kind, as the lock treats it. */
enum class WindowKind {
    /** An app's own window: covered where its app is blocked, and sent home where it fills the screen. */
    App,
    /** One drawn over others, System UI's or another app's, as Android lists both: covered where its app is blocked, never sent home. */
    Drawn,
    /** The keyboard, or a kind the lock doesn't know: never covered, and kept clear. */
    Kept,
    /** An accessibility overlay (the covers among them), or split screen's divider, whose touch reaches into the halves: neither. */
    Passed,
}

/** A window on the screen, as Android lists it to the lock's service: never its contents. */
data class OnScreen(val id: Int, val kind: WindowKind, val bounds: Area, val pictureInPicture: Boolean = false)

/**
 * A cover over [window], at [area]. [home]: its app fills the screen, so goes home once the cover lands (Q5). [held]: it
 * takes the window's touches; a picture-in-picture window's go to System UI, which moves, closes or opens it, never stuck.
 */
data class Covering(val window: Int, val area: Area, val home: Boolean, val held: Boolean)

/**
 * Which windows the lock covers (decision 2; DECISIONS 2026-11-05, AN7e): each window an app the allow-list doesn't hold
 * has named as its own by its state event, at its place within the safe area (the screen but its bars and cutout), while
 * the lock's end is ahead by the phone's clock, nothing woken for it. Never Bali's own, nor a window no event has named,
 * since no window's contents is read (the battery plan). A cover keeps clear of each window above it not covered itself
 * (the shade, a notification, the keyboard), but a picture-in-picture window's own menu. A full-screen app goes home once
 * its cover lands (Q5); a split half or a picture-in-picture window stays covered. Names last only while a lock holds.
 */
class Cover(private val mine: String) {
    private val names = HashMap<Int, String>()

    /** [window]'s app, as the window's own state event names it. */
    fun named(window: Int, app: String) = names.set(window, app)

    /** The app [window] was named for; none: no event has, while the lock holds. */
    fun app(window: Int): String? = names[window]

    fun forget() = names.clear()

    /** The covers now over [windows], listed top first as Android lists them, while [until] is ahead of [now]; else none, every name forgotten. */
    fun covering(windows: List<OnScreen>, allowed: Set<String>, safe: Area, until: Instant?, now: Instant): List<Covering> {
        if (until == null || until <= now) return emptyList<Covering>().also { forget() }
        // The places of the windows above the one at hand that no cover hides.
        val above = mutableListOf<Area>()
        val covers = mutableListOf<Covering>()
        for (window in windows.filter { it.kind != WindowKind.Passed }) {
            val app = names[window.id]
            val area = window.bounds meets safe
            if (window.kind == WindowKind.Kept || app == null || app == mine || app in allowed || area == null) {
                above += window.bounds
                continue
            }
            // A picture-in-picture window's menu, System UI's window at its place, leaves it covered: its cover holds no touch.
            val clear = above.filterNot { window.pictureInPicture && (it meets window.bounds) == it }.fold<Area, Area?>(area) { left, kept -> left?.clearOf(kept) } ?: continue
            covers += Covering(window.id, clear, window.kind == WindowKind.App && !window.pictureInPicture && area == safe, !window.pictureInPicture)
        }
        return covers
    }
}
