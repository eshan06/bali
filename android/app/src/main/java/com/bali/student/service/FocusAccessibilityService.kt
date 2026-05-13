package com.bali.student.service

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import com.bali.student.data.focus.AppPackageMap
import com.bali.student.data.focus.FocusModePolicy
import com.bali.student.data.focus.FocusModeStore
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Brick-style focus enforcer. We get notified by the system whenever a window
 * comes to the front; if the package matches an active Focus Mode policy we
 * boot the student into the Bali block screen.
 *
 * Keeps a hot in-memory copy of the policy so the main-thread event handler
 * doesn't have to touch DataStore on every window change.
 */
@AndroidEntryPoint
class FocusAccessibilityService : AccessibilityService() {

    @Inject lateinit var focusModeStore: FocusModeStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Volatile private var currentPolicy: FocusModePolicy? = null
    @Volatile private var lastBlockedPackage: String? = null
    @Volatile private var lastBlockedAt: Long = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        scope.launch {
            focusModeStore.policy.collect { currentPolicy = it }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        val policy = currentPolicy ?: return
        if (!policy.blockingActive) return
        if (!shouldBlock(pkg, policy)) return

        // Debounce: AccessibilityService can fire multiple window-state events
        // in quick succession for the same package; we don't want to relaunch
        // the block screen on top of itself.
        val now = System.currentTimeMillis()
        if (pkg == lastBlockedPackage && now - lastBlockedAt < 500) return
        lastBlockedPackage = pkg
        lastBlockedAt = now

        launchBlockScreen(pkg)
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun shouldBlock(pkg: String, policy: FocusModePolicy): Boolean {
        if (pkg in AppPackageMap.alwaysAllowed) return false
        if (pkg == applicationContext.packageName) return false
        return when (policy.mode) {
            "block_all_except" -> pkg !in policy.allowedPackages
            else -> pkg in policy.blockedPackages
        }
    }

    private fun launchBlockScreen(blockedPkg: String) {
        val intent = Intent(this, BlockActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_NO_HISTORY,
            )
            putExtra(BlockActivity.EXTRA_BLOCKED_PACKAGE, blockedPkg)
        }
        startActivity(intent)
    }
}
