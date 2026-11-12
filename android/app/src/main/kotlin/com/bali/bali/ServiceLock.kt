package com.bali.bali

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import com.bali.outbox.Lock
import com.bali.outbox.LockSwitch
import com.bali.outbox.SystemClock
import java.io.File
import java.io.IOException
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The lock's file, in the app's own `no_backup/`: there while a lock holds. */
const val LOCK_FILE = "lock"

/**
 * The lock as the phone has it (decision 2): Bali's Accessibility service ([LockService]) behind the
 * enforcer's seam, iOS's `PhoneScreenTime`. Thin on purpose: what to lock, and when, is the enforcer's,
 * tested on the JVM.
 *
 * Its switch is Android's list of switched-on services, with the service's binding. Its lock is an end it
 * keeps by the phone's clock, with nothing woken there; while one holds, the service listens to the
 * windows, and while none does, to nothing (the battery plan). Its file, there while one holds, is read
 * once, as the lock is made with the run, for the last run's lock (Q4): one with no end of its own, held
 * over a standing not read until the phone knows where it stands or the student unlocks, never over one
 * its storage failed to give back (AN10c2). Never read again
 * within the run, so a lock this run put on is never taken for the last run's. What it holds is the main
 * thread's, as the service's calls are, so its calls run there. None throws.
 */
class ServiceLock(private val context: Context) : Lock {
    private val file = File(context.noBackupFilesDir, LOCK_FILE)
    private val mine = ComponentName(context, LockService::class.java)

    /** This run's lock's end; none: none. */
    private var end: Instant? = null

    /** Whether it holds the last run's lock, read once, here. */
    private var kept = file.exists()

    /** Whether the file is there, as last made or taken away. */
    private var saved = kept

    // The service, while it is bound, and what it listens to: the windows, as last set, or none, not set since it
    // bound. The Debug readout shows both (AN7d), on the main thread.
    internal var service: LockService? = null
        private set
    internal var listening: Boolean? = null
        private set

    /**
     * The Debug readout's Launch line (AN7d), iOS's `PhoneScreenTime.timed`: this run's first read of the switch, by
     * the phone's uptime, the grace's clock; and how long after it a read first said other than starting, and what.
     */
    internal var firstRead: Duration? = null
        private set
    internal var settled: Pair<Duration, LockSwitch>? = null
        private set

    /** Off the list, off; on it, on once the service is bound, else starting. Timed for the readout. */
    override suspend fun switch(): LockSwitch =
        onMain {
            val read =
                when {
                    !listed() -> LockSwitch.Off
                    service != null -> LockSwitch.On
                    else -> LockSwitch.Starting
                }
            val now = SystemClock.uptime()
            val first = firstRead ?: now.also { firstRead = it }
            if (settled == null && read != LockSwitch.Starting) settled = now - first to read
            read
        }

    override suspend fun locking(): Boolean = onMain { follow() }

    override suspend fun lock(until: Instant) {
        onMain {
            end = until
            kept = false
            follow()
        }
    }

    override suspend fun unlock() {
        onMain {
            end = null
            kept = false
            follow()
        }
    }

    /** The service bound, as it connects, or none, as it unbinds: told at once what to listen to. On the main thread. */
    fun bound(service: LockService?) {
        this.service = service
        listening = null
        follow()
    }

    /** Until when the service covers apps ([LockService.cover], AN7e): this run's lock's end; the last run's, which has none, the end of time. */
    internal val until: Instant? get() = if (kept) Instant.MAX else end

    /**
     * Whether a lock holds now, this run's before its end or the last run's, the file and the service
     * following it: the file there while one does, and the service listening to the windows while one
     * does, to nothing but its own package's nothing while none does. A change that didn't take is made
     * again at the next call, so a lock ended by its end leaves no file and no listening behind it.
     */
    private fun follow(): Boolean {
        val holds = kept || end?.let { it > Instant.now() } == true
        if (saved != holds) saved = save(holds)
        service?.let {
            if (listening != holds) listening = listen(it, holds)
            it.cover()
        }
        return holds
    }

    /** Whether the file is there once it's made, or taken away, as [holds] says; unchanged where the disk refuses. */
    private fun save(holds: Boolean): Boolean =
        try {
            if (holds) file.createNewFile() else file.delete()
            file.exists()
        } catch (refused: IOException) {
            saved
        }

    /**
     * What [service] listens to once it's told: in a [lesson], the window events alone, a window's own
     * and the list of them, never its contents; else nothing, from its own package alone, since an event
     * type of none still has every app send its window events. Unchanged where the system can't be told.
     */
    private fun listen(service: LockService, lesson: Boolean): Boolean? =
        try {
            service.serviceInfo?.let { info ->
                info.eventTypes = if (lesson) WINDOW_EVENTS else 0
                info.flags = if (lesson) AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS else 0
                info.packageNames = if (lesson) null else arrayOf(context.packageName)
                service.serviceInfo = info
                lesson
            } ?: listening
        } catch (gone: RuntimeException) {
            // The system's own process gone, as the phone restarts.
            listening
        }

    /** Whether Android's list of switched-on services holds the service: the student's switch, in Settings. */
    internal fun listed(): Boolean =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?.split(':')?.any { ComponentName.unflattenFromString(it) == mine } == true

    private suspend fun <T> onMain(block: () -> T): T = withContext(Dispatchers.Main.immediate) { block() }

    private companion object {
        const val WINDOW_EVENTS = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or AccessibilityEvent.TYPE_WINDOWS_CHANGED
    }
}
