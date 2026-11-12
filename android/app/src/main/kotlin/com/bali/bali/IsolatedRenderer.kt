package com.bali.bali

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Bitmap
import android.os.Build
import android.os.IBinder
import android.os.Parcel
import android.os.ParcelFileDescriptor
import android.os.SharedMemory
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import androidx.core.graphics.createBitmap
import com.bali.outbox.Document
import com.bali.outbox.Renderer
import java.io.File
import java.io.FileDescriptor
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/** The deck folder, in the app's own `no_backup/`: Android 10's deck, for the instant it has a name (Q3). */
const val DECK_FOLDER = "deck"

/**
 * Empties the deck folder ([DECK_FOLDER]), which a run cut short may have left a file in, at each start of Bali's own process
 * ([BaliApp.onCreate]): that folder alone, never `no_backup/`, which holds the sign-in's file and the lock's.
 */
internal fun emptyDecks(context: Context) {
    File(context.noBackupFilesDir, DECK_FOLDER).listFiles()?.forEach { it.delete() }
}

/**
 * The deck's renderer as the app has it (ARCHITECTURE, "Live lesson", decision 8), AN13e's seam ([Renderer]) filled to the
 * owner's rulings on Q2 and Q3 (2026-11-12): pdfium in [RendererService], an isolated process bound at the first open and unbound
 * once the last document closes, so a new process at the next; each deck handed to it from memory as one descriptor of its bytes
 * ([carrying]); every call into it, the bind's wait with it, bounded by [limit], one that never ends ending that process. Its
 * process gone loses every document it held ([Deck.awaitLost]); Bali's own lives on. Never throws but on its caller's cancel.
 * Android answers its bind on the main thread, so nothing waits there for an open.
 */
class IsolatedRenderer(private val context: Context, internal val scope: CoroutineScope, private val limit: Duration = LIMIT) : Renderer {
    private val sync = Any()

    /** The service while a deck is open or opening; none: unbound. Under [sync]. */
    internal var bound: Binding? = null
        get() = synchronized(sync) { field }
        private set

    /** [deck] opened in the isolated process, handed over by this Android's own path ([carrying]); a cancel closes what it makes. */
    override suspend fun open(deck: ByteBuffer): Document? = open { carrying(deck) }

    /** Opens the deck [carry] gives a descriptor of (each path called directly, Q9). */
    internal suspend fun open(carry: () -> ParcelFileDescriptor): Deck? {
        val opening = scope.async { opened(carry) }
        try {
            return opening.await()
        } catch (cancelled: CancellationException) {
            scope.launch { opening.await()?.close() }
            throw cancelled
        }
    }

    private suspend fun opened(carry: () -> ParcelFileDescriptor): Deck? {
        val binding = take()
        val opened =
            within(binding) { service ->
                carry().use { bytes -> service.answer(RendererService.OPEN, { it.writeFileDescriptor(bytes.fileDescriptor) }) { it.readInt() to it.readInt() } }
            }
        if (opened == null || opened.second < 1) {
            release(binding)
            return null
        }
        return Deck(this, binding, opened.first, opened.second)
    }

    /**
     * [deck]'s bytes in one readable, seekable descriptor, rewound, which the caller closes (Q3): an anonymous memory file from
     * Android 11, nothing on disk; on Android 10, which has no public one, or [onDisk], a file in the deck folder, deleted the moment
     * it is open, before a byte of the deck is written to it.
     */
    internal fun carrying(deck: ByteBuffer, onDisk: Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.R): ParcelFileDescriptor {
        val descriptor = if (!onDisk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Os.memfd_create("deck", OsConstants.MFD_CLOEXEC) else unnamed()
        try {
            // Through a chunk of its own: `Os.write` asks a heap buffer for its array, which a read-only one refuses.
            val bytes = deck.duplicate()
            val chunk = ByteArray(CHUNK)
            while (bytes.hasRemaining()) {
                val size = minOf(CHUNK, bytes.remaining())
                bytes.get(chunk, 0, size)
                var written = 0
                while (written < size) written += Os.write(descriptor, chunk, written, size - written)
            }
            Os.lseek(descriptor, 0, OsConstants.SEEK_SET)
            return ParcelFileDescriptor.dup(descriptor)
        } finally {
            Os.close(descriptor)
        }
    }

    /** A new file in the deck folder, open to write and read, its name deleted at once. */
    private fun unnamed(): FileDescriptor {
        val folder = File(context.noBackupFilesDir, DECK_FOLDER).apply { mkdirs() }
        val file = File(folder, UUID.randomUUID().toString()).path
        val descriptor = Os.open(file, OsConstants.O_RDWR or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_CLOEXEC, OWNER_ONLY)
        try {
            Os.remove(file)
        } catch (kept: ErrnoException) {
            Os.close(descriptor)
            throw kept
        }
        return descriptor
    }

    /** The binding, bound now if there is none, held for one more document. */
    private fun take(): Binding =
        synchronized(sync) {
            val binding = bound ?: Binding().also { bound = it }.also(::bind)
            binding.holds += 1
            binding
        }

    private fun bind(binding: Binding) {
        val bound = try { context.bindService(Intent(context, RendererService::class.java), binding, Context.BIND_AUTO_CREATE) } catch (refused: Exception) { false }
        if (!bound) lose(binding)
    }

    /** One document fewer on [binding], closed or never opened: unbound once none is left, its process ended as Android no longer needs it. */
    internal fun release(binding: Binding) =
        synchronized(sync) {
            binding.holds -= 1
            if (binding.holds == 0) untie(binding)
        }

    /** [binding]'s process gone, or never answering: every document it held lost, and it unbound, so the next open binds afresh. */
    private fun lose(binding: Binding) {
        synchronized(sync) { untie(binding) }
        binding.service.complete(null)
        binding.gone.complete(Unit)
    }

    private fun untie(binding: Binding) {
        if (bound === binding) bound = null
        try {
            context.unbindService(binding)
        } catch (unbound: IllegalArgumentException) {
            // Unbound already, at its loss.
        }
    }

    /**
     * [call] made to [binding]'s service on a thread of its own, once it is bound, within [limit]: its answer, or none where it
     * failed, threw or never came, a call that never ends losing the binding.
     */
    internal suspend fun <T : Any> within(binding: Binding, call: (IBinder) -> T?): T? {
        val answer =
            scope.async(Dispatchers.IO) {
                binding.service.await()?.let { service -> try { call(service) } catch (failed: Exception) { null } }
            }
        val answered = withTimeoutOrNull(limit) { answer.await() }
        if (!answer.isCompleted) lose(binding)
        return answered
    }

    /** One binding to the service: its process, isolated, lives while it is bound. */
    internal inner class Binding : ServiceConnection {
        /** The service once bound; none once lost. */
        val service = CompletableDeferred<IBinder?>()

        /** Completed once its process is gone, or it never answered: every document there lost. */
        val gone = CompletableDeferred<Unit>()

        /** Its documents open, and opens on their way. Under the renderer's lock. */
        var holds = 0

        override fun onServiceConnected(name: ComponentName, service: IBinder) {
            this.service.complete(service)
        }

        override fun onServiceDisconnected(name: ComponentName) = lose(this)

        override fun onBindingDied(name: ComponentName) = lose(this)

        override fun onNullBinding(name: ComponentName) = lose(this)
    }

    private companion object {
        val LIMIT = 10.seconds

        /** rw-------: the deck's file Bali's alone, for its instant. */
        const val OWNER_ONLY = 0x180

        const val CHUNK = 64 * 1024
    }
}

/**
 * A deck open in the renderer's isolated process (AN13e's [Document]), the type the screens draw through (AS8): its [pages], fixed
 * as it opened, and its pages drawn ([draw]). Closed once, at once, the close going after any draw under way; a draw of it then
 * failed, never a crash. Lost once its process is gone or a page fails to draw.
 */
class Deck internal constructor(
    private val renderer: IsolatedRenderer,
    private val binding: IsolatedRenderer.Binding,
    private val number: Int,
    override val pages: Int,
) : Document {
    private val lost = CompletableDeferred<Unit>()
    private val closed = AtomicBoolean(false)

    /** One draw at a time, and the close after them. */
    private val drawing = Mutex()

    init {
        binding.gone.invokeOnCompletion { lost.complete(Unit) }
    }

    override suspend fun awaitLost() = lost.await()

    /**
     * Page [page] (the slide's own, from 1) drawn off the main thread onto a white bitmap [width] by [height], as large as fits and
     * centred, with its text from Android 15 (Q4); none: failed, a page past [pages], a closed document, its process gone, or a page
     * that failed to draw, which loses the document. A cancel throws.
     */
    suspend fun draw(page: Int, width: Int, height: Int): Page? {
        if (page !in 1..pages || width < 1 || height < 1) return null
        return drawing.withLock {
            if (closed.get()) return@withLock null
            val drawn = renderer.within(binding) { it.drawn(page - 1, width, height) }
            if (drawn == null) lost.complete(Unit)
            drawn.takeUnless { closed.get() }
        }
    }

    /** Page [index] drawn by [this] service, into memory made here, read back into a bitmap made here. */
    private fun IBinder.drawn(index: Int, width: Int, height: Int): Page? =
        SharedMemory.create("page", Math.multiplyExact(Math.multiplyExact(width, height), 4)).use { memory ->
            answer(RendererService.DRAW, {
                it.writeInt(number)
                it.writeInt(index)
                it.writeInt(width)
                it.writeInt(height)
                memory.writeToParcel(it, 0)
            }) { reply ->
                val said = reply.readString()
                val pixels = memory.mapReadOnly()
                try {
                    Page(createBitmap(width, height).apply { copyPixelsFromBuffer(pixels) }, said)
                } finally {
                    SharedMemory.unmap(pixels)
                }
            }
        }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        renderer.scope.launch {
            drawing.withLock { renderer.within(binding) { it.answer(RendererService.CLOSE, { data -> data.writeInt(number) }) { Unit } } }
            renderer.release(binding)
        }
    }
}

/** A slide's page drawn ([Deck.draw]): its pixels, and its text where Android gives it, TalkBack's label (Q4); none: "Slide N of M". */
class Page(val bitmap: Bitmap, val said: String?)

/** [code] to this service, [write] its request; [read] over its answer once it says done, else none. */
private inline fun <T> IBinder.answer(code: Int, write: (Parcel) -> Unit, read: (Parcel) -> T): T? {
    val data = Parcel.obtain()
    val reply = Parcel.obtain()
    try {
        write(data)
        transact(code, data, reply, 0)
        return if (reply.readInt() == RendererService.DONE) read(reply) else null
    } finally {
        data.recycle()
        reply.recycle()
    }
}
