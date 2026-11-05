package com.bali.bali

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent

/**
 * Lock (a), Bali's own Accessibility service (ARCHITECTURE, "Android app structure", decision 2), which
 * Android binds, in Bali's process, while the student has it switched on in Settings. What it locks is
 * [ServiceLock]'s, which the enforcer drives: outside a lesson it listens to nothing, in one to window
 * events alone, and it never reads a window's contents (the battery plan). Window events decide nothing
 * yet: the cover is AN7e's. It is how Bali hears the screen go on and off, for the engine's check-ins
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
    // binds without connecting it first, its receiver never registered.
    override fun onUnbind(intent: Intent?): Boolean {
        if (hearing) unregisterReceiver(screen)
        hearing = false
        app.screen.value = false
        app.lock.bound(null)
        app.check()
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit
}
