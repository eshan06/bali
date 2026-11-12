package com.bali.outbox

import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

// The deck's renderer as the lesson half's tests hold it, beside the engine's rig, as LockSupport.kt holds the lock. No iOS twin:
// AppTests opens its decks with PDFKit itself.

/** A deck's bytes as [FakeRenderer] reads them: a PDF of [pages] pages, [title] telling decks apart. */
fun pdf(title: String, pages: Int) = "%PDF-1.7 $title, $pages pages"

/** An open or a close a test holds: [taken] once one waits on it, until [release]. */
class Held {
    private val waiting = CompletableDeferred<Unit>()
    private val let = CompletableDeferred<Unit>()
    private val released = CountDownLatch(1)

    /** Waits for an open or a close to wait on it; none in time fails the test. */
    suspend fun taken() = withTimeoutOrNull(patience) { waiting.await() } ?: fail("nothing was held")

    fun release() {
        released.countDown()
        let.complete(Unit)
    }

    /** An open's wait: through a cancel too, as a renderer's call that can't be stopped. */
    internal suspend fun hold() {
        waiting.complete(Unit)
        withContext(NonCancellable) { let.await() }
    }

    /** A close's wait, on its own thread, as a renderer's close a draw under way holds. */
    internal fun block() {
        waiting.complete(Unit)
        released.await(patience.inWholeMilliseconds, TimeUnit.MILLISECONDS)
    }
}

/**
 * The renderer as a test holds it: each open and close counted; a deck's pages read from its bytes ([pdf]), any other bytes none,
 * as a file that isn't a PDF; an open, or a close, held while the test does what it must ([holdOpen], [holdClose]); its opens
 * refused, or thrown against its promise, where the test says ([opening]); and its documents lost ([lose]). Each deck it is given
 * must be read-only.
 */
class FakeRenderer : Renderer {
    /** How its opens go: as the bytes say, refused, or throwing, as the seam promises never to. */
    enum class Opening { AsTheBytesSay, Refusing, Throwing }

    private val sync = Any()
    private var opened = 0
    private var closed = 0
    private var how = Opening.AsTheBytesSay
    private var openHeld: Held? = null
    private var closeHeld: Held? = null
    private val documents = mutableListOf<Opened>()

    var opening: Opening
        get() = synchronized(sync) { how }
        set(value) = synchronized(sync) { how = value }

    /** Documents open now: each open less each close, so one closed twice shows too. */
    val open: Int get() = synchronized(sync) { opened - closed }
    val opens: Int get() = synchronized(sync) { opened }
    val closes: Int get() = synchronized(sync) { closed }

    /** The next open, its document counted open, is held until the hold's release, a cancel meanwhile included. */
    fun holdOpen(): Held = Held().also { synchronized(sync) { openHeld = it } }

    /** The next close, counted, holds its thread until the hold's release. */
    fun holdClose(): Held = Held().also { synchronized(sync) { closeHeld = it } }

    /** Every document it opened is lost, as its process dying loses them: each one's [Document.awaitLost] returns. */
    fun lose() = synchronized(sync) { documents.toList() }.forEach { it.gone.complete(Unit) }

    override suspend fun open(deck: ByteBuffer): Document? {
        assertTrue(deck.isReadOnly, "the renderer was given a deck it could write")
        val text = ByteArray(deck.remaining()).also { deck.duplicate().get(it) }.decodeToString()
        when (opening) {
            Opening.Refusing -> return null
            Opening.Throwing -> throw IllegalStateException("the renderer broke its promise")
            Opening.AsTheBytesSay -> Unit
        }
        val pages = text.takeIf { it.startsWith("%PDF") }?.substringAfterLast(", ")?.removeSuffix(" pages")?.toIntOrNull() ?: return null
        val document = Opened(pages)
        val held = synchronized(sync) {
            opened += 1
            documents += document
            openHeld.also { openHeld = null }
        }
        held?.hold()
        return document
    }

    /** Asserts the documents open now: one while a deck is held open ([held]: by default, while [lessons]' slide shows ready), none otherwise. */
    fun holds(lessons: Lessons, case: String, held: Boolean = lessons.state.value.slide?.phase is SlideShown.Phase.Ready) =
        assertEquals(if (held) 1 else 0, open, "$case: documents open")

    private inner class Opened(override val pages: Int) : Document {
        val gone = CompletableDeferred<Unit>()

        override suspend fun awaitLost() = gone.await()

        override fun close() {
            val held = synchronized(sync) {
                closed += 1
                closeHeld.also { closeHeld = null }
            }
            held?.block()
        }
    }
}
