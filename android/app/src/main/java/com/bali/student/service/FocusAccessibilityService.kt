package com.bali.student.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
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

private const val TAG = "FocusAccessibility"

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
        // Configure programmatically so the service works even if the
        // accessibility XML meta-data fails to load (we hit this on AVD).
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 50
            flags = 0
        }
        Log.i(TAG, "service connected, eventTypes=${serviceInfo?.eventTypes}")
        scope.launch {
            focusModeStore.policy.collect { policy ->
                currentPolicy = policy
                Log.i(
                    TAG,
                    "policy update: active=${policy?.blockingActive} mode=${policy?.mode} " +
                        "blocked=${policy?.blockedPackages} allowed=${policy?.allowedPackages}",
                )
            }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        val policy = currentPolicy
        if (policy == null) {
            Log.d(TAG, "window=$pkg policy=null")
            return
        }
        if (!policy.blockingActive) {
            Log.d(TAG, "window=$pkg policy.blockingActive=false")
            return
        }
        val blocked = shouldBlock(pkg, policy)
        Log.d(TAG, "window=$pkg blocked=$blocked mode=${policy.mode}")
        if (!blocked) return

        // Debounce: AccessibilityService can fire multiple window-state events
        // in quick succession for the same package; we don't want to relaunch
        // the block screen on top of itself.
        val now = System.currentTimeMillis()
        if (pkg == lastBlockedPackage && now - lastBlockedAt < 500) return
        lastBlockedPackage = pkg
        lastBlockedAt = now

        Log.i(TAG, "launching block screen for $pkg")
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
