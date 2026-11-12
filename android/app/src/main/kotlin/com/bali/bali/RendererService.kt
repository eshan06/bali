package com.bali.bali

import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.Parcel
import android.os.SharedMemory
import androidx.core.graphics.createBitmap

/**
 * Where a deck is parsed and its pages drawn (the owner's ruling on Q2, 2026-11-12): pdfium, through `PdfRenderer`, in a process
 * of its own that Android isolates (`android:isolatedProcess`): a user id of its own, no permission and none of Bali's files, so a
 * deck that breaks pdfium reaches nothing of Bali's, neither the lock's service nor the sign-in's tokens, and its crash is a deck
 * that failed, never Bali's process stopping. It gets only a descriptor of a deck's bytes and what to draw, and gives back a page's
 * pixels, into memory Bali made, with the page's text. Bound by [IsolatedRenderer] while a deck is open. Its calls come on
 * Binder's threads, each under [lock], since `PdfRenderer` opens one page at a time and isn't thread-safe; and every failure is
 * answered failed, never thrown at Bali.
 */
class RendererService : Service() {
    private val lock = Any()

    /** The decks open, by the number each was given. Under [lock]. */
    private val decks = HashMap<Int, PdfRenderer>()
    private var given = 0

    private val calls =
        object : Binder() {
            override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean =
                when (code) {
                    OPEN -> answer(reply) { open(data, it) }
                    DRAW -> answer(reply) { draw(data, it) }
                    CLOSE -> answer(reply) { synchronized(lock) { decks.remove(data.readInt())?.close() } != null }
                    else -> ThisBuild.rendering(code, reply, lock, application) || super.onTransact(code, data, reply, flags)
                }
        }

    override fun onBind(intent: Intent): IBinder = calls

    override fun onDestroy() {
        synchronized(lock) {
            decks.values.forEach { runCatching { it.close() } }
            decks.clear()
        }
    }

    /** [work]'s answer in [reply], after its mark: done, or failed, whatever it threw. */
    private inline fun answer(reply: Parcel?, work: (Parcel) -> Boolean): Boolean {
        val out = reply ?: return true
        out.writeInt(DONE)
        val done = try { work(out) } catch (failed: Exception) { false }
        if (!done) {
            out.setDataSize(0)
            out.setDataPosition(0)
            out.writeInt(FAILED)
        }
        return true
    }

    /** The deck in the descriptor [data] carries, opened: its number and its pages; failed for one not a PDF, locked, or with none. */
    private fun open(data: Parcel, reply: Parcel): Boolean {
        val bytes = data.readFileDescriptor() ?: return false
        val (deck, pages) =
            synchronized(lock) {
                val deck = try { PdfRenderer(bytes) } catch (unopened: Exception) { bytes.close(); return false }
                val pages = deck.pageCount
                if (pages < 1) { deck.close(); return false }
                given += 1
                decks[given] = deck
                given to pages
            }
        reply.writeInt(deck)
        reply.writeInt(pages)
        return true
    }

    /**
     * A page drawn onto a white bitmap of the size asked for, as large as fits and centred, its pixels copied into the memory Bali
     * sent, and its text with them, from Android 15, else none (Q4).
     */
    private fun draw(data: Parcel, reply: Parcel): Boolean {
        val deck = data.readInt()
        val index = data.readInt()
        val width = data.readInt()
        val height = data.readInt()
        SharedMemory.CREATOR.createFromParcel(data).use { memory ->
            val bitmap = createBitmap(width, height)
            val said =
                synchronized(lock) {
                    val renderer = decks[deck] ?: return false
                    renderer.openPage(index).use { page ->
                        if (page.width < 1 || page.height < 1) return false
                        bitmap.eraseColor(Color.WHITE)
                        page.render(bitmap, null, fit(page.width, page.height, width, height), PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                            page.textContents.joinToString("\n") { it.text }.trim().ifEmpty { null }
                        } else {
                            null
                        }
                    }
                }
            val pixels = memory.mapReadWrite()
            try {
                bitmap.copyPixelsToBuffer(pixels)
            } finally {
                SharedMemory.unmap(pixels)
                bitmap.recycle()
            }
            reply.writeString(said)
        }
        return true
    }

    /** Page points to the bitmap's pixels: the page as large as fits, centred, white beside it (M8's frame). */
    private fun fit(pageWidth: Int, pageHeight: Int, width: Int, height: Int): Matrix =
        Matrix().apply {
            val scale = minOf(width / pageWidth.toFloat(), height / pageHeight.toFloat())
            setScale(scale, scale)
            postTranslate((width - pageWidth * scale) / 2, (height - pageHeight * scale) / 2)
        }

    companion object {
        /** A deck's descriptor in; its number and its pages out. */
        const val OPEN = IBinder.FIRST_CALL_TRANSACTION

        /** A deck's number, a page's index, the bitmap's width and height, and the memory its pixels go into; the page's text out. */
        const val DRAW = IBinder.FIRST_CALL_TRANSACTION + 1

        /** A deck's number: closed. */
        const val CLOSE = IBinder.FIRST_CALL_TRANSACTION + 2

        /** Each answer's mark, first. */
        const val DONE = 1
        const val FAILED = 0
    }
}
