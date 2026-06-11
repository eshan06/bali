package com.bali.student.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.bali.student.MainActivity
import com.bali.student.R
import com.bali.student.data.api.BaliApi
import com.bali.student.data.focus.FocusModePolicy
import com.bali.student.data.focus.FocusModeStore
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Foreground service that babysits an active Focus Mode policy:
 * - keeps a persistent "Focus Mode active" notification visible while class is in session
 * - polls the API so we can clear the local policy the moment the teacher ends the session
 * - reports applied / disabled status into the local store so the UI mirrors reality
 */
@AndroidEntryPoint
class FocusModeService : Service() {

    @Inject lateinit var api: BaliApi
    @Inject lateinit var focusModeStore: FocusModeStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Focus Mode active"))
        startPolling()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive) {
                val policy = focusModeStore.current()
                if (policy == null) {
                    stopWithNotice(null)
                    return@launch
                }
                refreshNotification(policy)

                val ended = runCatching { api.getClassDetail(policy.classId) }
                    .map { detail ->
                        val active = detail.activeSession
                        active == null || active.id != policy.sessionId
                    }
                    .getOrDefault(false)

                if (ended) {
                    focusModeStore.updateStatus(FocusModePolicy.STATUS_DISABLED)
                    focusModeStore.clear()
                    stopWithNotice("Focus Mode ended. Apps are available again.")
                    return@launch
                }

                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private fun stopWithNotice(text: String?) {
        if (text != null) updateNotification(text)
        stopForeground(STOP_FOREGROUND_DETACH)
        stopSelf()
    }

    private fun ensureChannel() {
        val mgr = getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Focus Mode",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shows when Focus Mode is active during a class session."
                setShowBadge(false)
            }
        )
    }

    private fun refreshNotification(policy: FocusModePolicy) {
        updateNotification("Focus Mode active for ${policy.className}.")
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val tap = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Bali Focus Mode")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "focus_mode"
        private const val NOTIFICATION_ID = 4242
        private const val POLL_INTERVAL_MS = 30_000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, FocusModeService::class.java),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, FocusModeService::class.java))
        }
    }
}
