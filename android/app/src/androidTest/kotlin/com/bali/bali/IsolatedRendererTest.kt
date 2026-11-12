package com.bali.bali

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.LoadParams
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.IBinder
import android.os.Parcel
import android.os.ParcelFileDescriptor
import android.os.Process
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The slide's page drawn in the renderer's isolated process (AN13f; the owner's rulings on Q2 and Q3, 2026-11-12), on the
 * emulators, Android 10 among them, where its own SELinux rules decide what an isolated process reads: each deck drawn in code
 * ([PdfDocument], or by hand where a test needs what it can't make), none kept in the repo; each test's renderer its own, over a
 * scope of its own; the service's calls for tests alone (the Debug build's `ThisBuild`) saying who it is, holding its calls and
 * ending its process, which Bali can't end from outside, its user id being another's. A check that something doesn't happen
 * waits for a mark: an answer, a document's loss, or Android's notice of a process's death.
 */
@RunWith(AndroidJUnit4::class)
class IsolatedRendererTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val renderers = mutableListOf<IsolatedRenderer>()
    private val renderer = renderer()
    private val folder = File(context.noBackupFilesDir, DECK_FOLDER)

    @After
    fun end() {
        // Each renderer's binding let go, a close still on its way or a test that failed holding a document: the next test's
        // process is its own.
        renderers.mapNotNull { it.bound }.forEach { runCatching { context.unbindService(it) } }
        scope.cancel()
    }

    // SlideView.swift draws `deck.page(at: slide.page - 1)`: the slide's page counts from 1, the document's from 0.
    @Test
    fun theSlidesPageIsDrawnByItsOwnNumberFromOneSoPageTwoShowsPageTwosMarks(): Unit =
        runBlocking {
            val document = open(deck(3) { canvas, page -> canvas.drawColor(MARKS[page - 1]) })
            assertColor(Color.GREEN, checkNotNull(document.draw(2, 400, 300)).bitmap.at(200, 150), "page 2")
            document.close()
        }

    // M8's frame is 16:9, and a 4:3 page in it is as large as fits, centred, white beside it, as on the student web (W5).
    @Test
    fun aFourByThreePageInASixteenByNineFrameIsAsLargeAsFitsCentredWithWhiteBesideIt(): Unit =
        runBlocking {
            val document = open(deck(1, 400, 300) { canvas, _ -> canvas.drawColor(Color.BLUE) })
            val page = checkNotNull(document.draw(1, 1600, 900)).bitmap
            // 1200 by 900, from 200 to 1400 across.
            for (x in listOf(5, 100, 195, 1405, 1500, 1594)) assertColor(Color.WHITE, page.at(x, 450), "beside the page, at $x")
            for ((x, y) in listOf(205 to 5, 800 to 450, 1394 to 894)) assertColor(Color.BLUE, page.at(x, y), "the page, at $x, $y")
            document.close()
        }

    // SlideView.swift's `SlideDeck.Phase`: failed where the document won't open or lacks the slide's page, never a crash. Each
    // open refused by the renderer's process itself, bound and answering throughout, its other document drawn there after.
    @Test
    fun aDeckThatIsNoPdfOrHasNoPageIsNoneAndAPageOutsideItsCountIsFailedItsDocumentKept(): Unit =
        runBlocking {
            val document = open(deck(3) { canvas, page -> canvas.drawColor(MARKS[page - 1]) })
            assertEquals(3, document.pages)
            val pid = who().pid
            assertNull("not a PDF", renderer.open(ByteBuffer.wrap("not a deck".toByteArray()).asReadOnlyBuffer()))
            assertNull("no pages", renderer.open(pdf(listOf(CATALOG, "<< /Type /Pages /Kids [] /Count 0 >>"))))
            assertNull("a page past the count", document.draw(4, 400, 300))
            assertNull("page 0", document.draw(0, 400, 300))
            // Not lost by them: a wait for its loss, begun now, still waits.
            val losing = scope.launch(start = CoroutineStart.UNDISPATCHED) { document.awaitLost() }
            assertTrue("lost by a page outside its count", losing.isActive)
            losing.cancel()
            // Kept, as the twin keeps it: the teacher's next page within it shows, in the same process.
            assertColor(Color.BLUE, checkNotNull(document.draw(3, 400, 300)).bitmap.at(200, 150), "page 3, after")
            assertEquals(pid, who().pid)
            document.close()
        }

    // AN13e's seam: a page that fails to draw loses its document, so its slide shows failed and Try again opens it afresh.
    @Test
    fun aPageThatFailsToDrawIsNoneAndLosesItsDocument(): Unit =
        runBlocking {
            // Two pages counted, the second no page at all: pdfium opens the deck, and can't load that page.
            val pages = "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"
            val document = open(pdf(listOf(CATALOG, pages, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] >>", "(not a page)")))
            assertEquals(2, document.pages)
            assertColor(Color.WHITE, checkNotNull(document.draw(1, 400, 300)).bitmap.at(200, 150), "page 1, blank")
            assertNull("a page that won't load", document.draw(2, 400, 300))
            lost(document, "a document whose page failed to draw")
            document.close()
        }

    // The server refuses an encrypted deck (M2b), so one reaching a phone is a check's miss: failed, as a deck not a PDF, refused
    // by the renderer's process itself, bound and answering throughout.
    @Test
    fun aDeckLockedByAPasswordIsNone(): Unit =
        runBlocking {
            val locked = locked("secret")
            // Locked indeed: pdfium here asks for its password, and from Android 15, which takes one, opens with it.
            renderer.carrying(locked).use { bytes -> assertThrows(SecurityException::class.java) { PdfRenderer(bytes).close() } }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                val opened = PdfRenderer(renderer.carrying(locked), LoadParams.Builder().setPassword("secret").build())
                opened.use { assertEquals(1, it.pageCount) }
            }
            val document = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) })
            val pid = who().pid
            assertNull(renderer.open(locked))
            assertColor(Color.GREEN, checkNotNull(document.draw(1, 400, 300)).bitmap.at(200, 150), "the other document, after")
            assertEquals(pid, who().pid)
            document.close()
        }

    // Q2: the draw is the isolated process's, where `BaliApp.onCreate` returns before anything of Bali's starts.
    @Test
    fun theDrawIsInAProcessAndroidIsolatesWhereTheAppsStartMakesNothingOfBalis(): Unit =
        runBlocking {
            val document = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) })
            assertColor(Color.GREEN, checkNotNull(document.draw(1, 400, 300)).bitmap.at(200, 150), "the page")
            val theirs = who()
            assertTrue("the renderer's process isolated", theirs.isolated)
            assertNotEquals(Process.myPid(), theirs.pid)
            assertFalse("the app's start made something of Bali's in the renderer's process", theirs.made)
            // Bali's own process, this one, is no isolated one, and its start made the app's run.
            assertFalse(Process.isIsolated())
            val app = context.applicationContext as BaliApp
            app.launched.join()
            assertNotNull(app.router)
            document.close()
        }

    // Q3 and Q9: from Android 11 the deck goes as a memory file; on Android 10 as a file in the deck folder, deleted as it opens.
    // Each path is called directly where it can run, and Android 10's on Android 10 itself, under its own SELinux rules.
    @Test
    fun eachVersionsPathHandsTheDeckToTheIsolatedProcessAndNeitherLeavesAFileInTheDeckFolder(): Unit =
        runBlocking {
            val deck = deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) }
            renderer.carrying(deck).use { own ->
                val link = Os.readlink("/proc/self/fd/${own.fd}")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    assertEquals("this Android's path", "/memfd:deck (deleted)", link)
                } else {
                    assertTrue("this Android's path: $link", link.startsWith("${folder.canonicalPath}/") && link.endsWith(" (deleted)"))
                }
                assertDeckFolderEmpty("this Android's path, as its descriptor is handed over")
            }
            // Android 10's file reaches the renderer read-only: no write through its descriptor, so no renderer can grow it to fill
            // the phone's storage under Bali's own files (santa's review).
            renderer.carrying(deck, onDisk = true).use { bytes ->
                val refused = assertThrows(ErrnoException::class.java) { Os.write(bytes.fileDescriptor, ByteArray(1), 0, 1) }
                assertEquals("a write through Android 10's descriptor", OsConstants.EBADF, refused.errno)
            }
            val paths = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) listOf(false, true) else listOf(true)
            for (onDisk in paths) {
                val case = if (onDisk) "Android 10's file" else "the memory file"
                val document =
                    checkNotNull(renderer.open { renderer.carrying(deck, onDisk).also { assertDeckFolderEmpty("$case, handed over") } }) { "$case: not opened" }
                assertDeckFolderEmpty("$case, the document open")
                assertColor(Color.GREEN, checkNotNull(document.draw(1, 400, 300)) { "$case: not drawn" }.bitmap.at(200, 150), case)
                document.close()
            }
        }

    // Q3's folder: emptied at each start of Bali's own process, never `no_backup/` itself.
    @Test
    fun theDeckFolderIsEmptiedAtAStartAndTheSignInsAndTheLocksFilesInNoBackupStay(): Unit =
        runBlocking {
            // The app's run ended first, as BaliAppTest's, so nothing of the lock's writes meanwhile.
            val app = context.applicationContext as BaliApp
            app.launched.join()
            app.running.value?.job?.cancelAndJoin()
            val kept = listOf(SIGN_IN_FILE, LOCK_FILE).map { File(context.noBackupFilesDir, it) }
            val found = kept.associateWith { it.takeIf(File::exists)?.readBytes() }
            try {
                kept.forEach { it.writeText("${it.name}'s own") }
                folder.mkdirs()
                File(folder, "left").writeText("a deck a run left")
                // The app's own start (BaliApp.onCreate's first step), as Bali's own process runs it.
                assertTrue("Bali's own process read as another", app.ownStart())
                assertDeckFolderEmpty("after a start")
                kept.forEach {
                    assertTrue("${it.name} gone", it.exists())
                    assertEquals(it.name, "${it.name}'s own", it.readText())
                }
            } finally {
                found.forEach { (file, bytes) -> if (bytes == null) file.delete() else file.writeBytes(bytes) }
            }
        }

    // A page's pixels are several MB, past Binder's 1 MB: they come through memory Bali made (SharedMemory).
    @Test
    fun aFullWidthPageArrivesWholeThroughMemoryBaliMade(): Unit =
        runBlocking {
            val document = open(deck(1, 640, 360) { canvas, _ -> quarters(canvas, 640f, 360f) })
            val page = checkNotNull(document.draw(1, 1440, 810)).bitmap
            assertEquals(1440 to 810, page.width to page.height)
            // Every 30th pixel each way, the last row and column among them, its quarter's colour.
            for (x in (0 until 1440 step 30) + 1438) {
                for (y in (0 until 810 step 30) + 808) {
                    if (abs(x - 720) < 4 || abs(y - 405) < 4 || x < 2 || y < 2) continue
                    assertColor(QUARTERS[(if (y < 405) 0 else 2) + (if (x < 720) 0 else 1)], page.at(x, y), "at $x, $y")
                }
            }
            document.close()
        }

    // PDFPage.said (M8): the page's text, trimmed, TalkBack's label; none for a page with none, which says which slide it is (AS8).
    // From Android 15, where `getTextContents` is; before it, none (Q4).
    @Test
    fun thePagesTextComesWithItFromAndroid15AndNoneForAPageWithNone(): Unit =
        runBlocking {
            val words = Paint().apply { textSize = 40f; color = Color.BLACK }
            val document =
                open(deck(2) { canvas, page -> if (page == 1) canvas.drawText("Photosynthesis", 40f, 150f, words) else canvas.drawColor(Color.BLUE) })
            val said = listOf(1, 2).map { checkNotNull(document.draw(it, 400, 300)).said }
            assertEquals(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) listOf("Photosynthesis", null) else listOf(null, null), said)
            document.close()
        }

    // The owner's why for Q2: a deck that ends pdfium's process is a deck that failed, never Bali's process stopping.
    @Test
    fun theRenderersProcessEndedMidDocumentLosesEveryDocumentItHeldBalisLivesOnAndAFreshOpenWorks(): Unit =
        runBlocking {
            val bali = Process.myPid()
            val first = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) })
            val second = open(deck(2) { canvas, _ -> canvas.drawColor(Color.BLUE) })
            val ended = who().pid
            send(ThisBuild.END, IBinder.FLAG_ONEWAY)
            lost(first, "the first document")
            lost(second, "the second document")
            assertNull("a page of a lost document", first.draw(1, 400, 300))
            // This process, Bali's, lives on: the tests run in it.
            assertEquals(bali, Process.myPid())
            val fresh = open(deck(1) { canvas, _ -> canvas.drawColor(Color.RED) })
            assertColor(Color.RED, checkNotNull(fresh.draw(1, 400, 300)).bitmap.at(200, 150), "a fresh open's page")
            assertNotEquals("a fresh open's process", ended, who().pid)
            listOf(first, second, fresh).forEach { it.close() }
        }

    // AN13e's seam: close returns at once and closes after a draw under way, which is then failed; never a crash on either side.
    @Test
    fun aDrawRacingItsDocumentsCloseIsFailedTheCloseReturningAtOnceAndNeitherCrashing(): Unit =
        runBlocking {
            val racing = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) })
            val other = open(deck(1) { canvas, _ -> canvas.drawColor(Color.BLUE) })
            val pid = who().pid
            send(ThisBuild.HOLD)
            // Under way past its own checks, and held in the service, so it can't end before the close.
            val drawing = scope.async(start = CoroutineStart.UNDISPATCHED) { racing.draw(1, 400, 300) }
            racing.close()
            send(ThisBuild.LET_GO)
            assertNull("a draw its document's close raced", withTimeout(PATIENCE) { drawing.await() })
            assertNull("a draw after the close", racing.draw(1, 400, 300))
            // The renderer's process lived through it: the other document still draws there.
            assertColor(Color.BLUE, checkNotNull(other.draw(1, 400, 300)).bitmap.at(200, 150), "the other document")
            assertEquals(pid, who().pid)
            other.close()
        }

    // Q2: bound only while a deck is open, so the process ends once the last document closes, and the next open binds a new one.
    @Test
    fun theServiceIsUnboundOnceTheLastDocumentClosesItsProcessEnded(): Unit =
        runBlocking {
            val first = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) })
            val second = open(deck(1) { canvas, _ -> canvas.drawColor(Color.BLUE) })
            val binding = checkNotNull(renderer.bound)
            val pid = who().pid
            val died = deathOf(service())
            first.close()
            until { binding.holds.takeIf { it == 1 } }
            assertColor(Color.BLUE, checkNotNull(second.draw(1, 400, 300)).bitmap.at(200, 150), "the other document, its first closed")
            assertEquals(pid, who().pid)
            second.close()
            assertTrue("the renderer's process never ended", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
            assertNull(renderer.bound)
        }

    // AN13e's seam: a cancel closes whatever the open made, as it comes.
    @Test
    fun aCancelledOpenClosesTheDocumentItMadeAsItComes(): Unit =
        runBlocking {
            val kept = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) })
            val died = deathOf(service())
            send(ThisBuild.HOLD)
            val opening = scope.launch(start = CoroutineStart.UNDISPATCHED) { renderer.open(deck(1) { canvas, _ -> canvas.drawColor(Color.BLUE) }) }
            opening.cancelAndJoin()
            send(ThisBuild.LET_GO)
            // Unbound once both are closed: the kept one here, the cancelled open's by the renderer.
            kept.close()
            assertTrue("the cancelled open's document left open", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
        }

    // AN13e's seam: bounded, so a pdfium that hangs ends as none, its process unbound and ended, and a slide never stays loading.
    @Test
    fun anOpenOrADrawThatNeverEndsIsNoneWithinItsLimitItsProcessEndedAndEveryDocumentThereLost(): Unit =
        runBlocking {
            val bounded = renderer(3.seconds)
            val held = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) }, bounded)
            var died = deathOf(service(bounded))
            send(ThisBuild.HOLD, renderer = bounded)
            assertNull("an open that never ends", withTimeout(PATIENCE) { bounded.open(deck(1) { canvas, _ -> canvas.drawColor(Color.BLUE) }) })
            assertTrue("its process never ended", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
            lost(held, "a document open beside the open that never ended")
            held.close()
            val drawn = open(deck(1) { canvas, _ -> canvas.drawColor(Color.BLUE) }, bounded)
            died = deathOf(service(bounded))
            send(ThisBuild.HOLD, renderer = bounded)
            assertNull("a draw that never ends", withTimeout(PATIENCE) { drawn.draw(1, 400, 300) })
            assertTrue("its process never ended", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
            lost(drawn, "the document whose draw never ended")
            drawn.close()
            val fresh = open(deck(1) { canvas, _ -> canvas.drawColor(Color.RED) }, bounded)
            assertColor(Color.RED, checkNotNull(fresh.draw(1, 400, 300)).bitmap.at(200, 150), "a fresh open's page")
            fresh.close()
        }

    // The bound holds whoever waits (santa's review): a draw that never ends, its screen gone meanwhile, still ends its process at
    // the limit, never at a later call.
    @Test
    fun aDrawThatNeverEndsEndsItsProcessAtItsLimitEvenOnceItsScreenStoppedWaiting(): Unit =
        runBlocking {
            val bounded = renderer(3.seconds)
            val document = open(deck(1) { canvas, _ -> canvas.drawColor(Color.GREEN) }, bounded)
            val died = deathOf(service(bounded))
            send(ThisBuild.HOLD, renderer = bounded)
            scope.launch(start = CoroutineStart.UNDISPATCHED) { document.draw(1, 400, 300) }.cancelAndJoin()
            assertTrue("its process never ended", died.await(PATIENCE.inWholeSeconds, TimeUnit.SECONDS))
            lost(document, "the document whose draw never ended")
            document.close()
        }

    /** A renderer of the test's own, let go after it. */
    private fun renderer(limit: Duration = 10.seconds) = IsolatedRenderer(context, scope, limit).also { renderers += it }

    /** [deck] opened by [renderer]: none fails the test. */
    private suspend fun open(deck: ByteBuffer, renderer: IsolatedRenderer = this.renderer): Deck =
        checkNotNull(withTimeout(PATIENCE) { renderer.open(deck) }) { "not opened" } as Deck

    /** The bound service of [renderer], whose process draws. */
    private fun service(renderer: IsolatedRenderer = this.renderer): IBinder =
        runBlocking { checkNotNull(checkNotNull(renderer.bound) { "unbound" }.service.await()) { "never bound" } }

    /** Who the renderer's process is, by its own word (ThisBuild's WHO). */
    private fun who(): Who = call(service(), ThisBuild.WHO) { Who(it.readInt() == 1, it.readInt(), it.readInt() == 1) }

    private class Who(val isolated: Boolean, val pid: Int, val made: Boolean)

    /** [code], one of ThisBuild's, sent to [renderer]'s service. */
    private fun send(code: Int, flags: Int = 0, renderer: IsolatedRenderer = this.renderer) = call(service(renderer), code, flags) {}

    private fun <T> call(service: IBinder, code: Int, flags: Int = 0, read: (Parcel) -> T): T {
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
            service.transact(code, data, if (flags == IBinder.FLAG_ONEWAY) null else reply, flags)
            return read(reply)
        } finally {
            data.recycle()
            reply.recycle()
        }
    }

    /** [document]'s loss reported through the seam ([Deck.awaitLost]); none in time fails the test, naming it. */
    private suspend fun lost(document: Deck, case: String) =
        assertNotNull("$case: never lost", withTimeoutOrNull(PATIENCE) { document.awaitLost() })

    /** Opens as [service]'s process dies: Android's own notice. */
    private fun deathOf(service: IBinder): CountDownLatch = CountDownLatch(1).also { latch -> service.linkToDeath({ latch.countDown() }, 0) }

    private fun assertDeckFolderEmpty(case: String) = assertEquals(case, emptyList<String>(), folder.list()?.toList().orEmpty())

    private companion object {
        val PATIENCE = 30.seconds
    }
}

/** Each page's own colour, page 1 first. */
private val MARKS = listOf(Color.RED, Color.GREEN, Color.BLUE)

/** A page's four quarters' colours: top left, top right, bottom left, bottom right. */
private val QUARTERS = listOf(Color.RED, Color.GREEN, Color.BLUE, Color.BLACK)

private const val CATALOG = "<< /Type /Catalog /Pages 2 0 R >>"

/** The standard security handler's padding (ISO 32000-1, 7.6.3.3), which fills each password to 32 bytes. */
private val PAD =
    intArrayOf(
        0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
        0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
    ).map { it.toByte() }.toByteArray()

/** A deck of [pages] pages, each [width] by [height] points, [paint] drawing page n (from 1): Android's own PDF writer's. */
private fun deck(pages: Int, width: Int = 400, height: Int = 300, paint: (Canvas, Int) -> Unit): ByteBuffer {
    val document = PdfDocument()
    try {
        for (n in 1..pages) {
            val page = document.startPage(PdfDocument.PageInfo.Builder(width, height, n).create())
            paint(page.canvas, n)
            document.finishPage(page)
        }
        return ByteBuffer.wrap(ByteArrayOutputStream().also(document::writeTo).toByteArray()).asReadOnlyBuffer()
    } finally {
        document.close()
    }
}

/** A page's four quarters, each its own colour ([QUARTERS]). */
private fun quarters(canvas: Canvas, width: Float, height: Float) {
    for ((n, colour) in QUARTERS.withIndex()) {
        val left = if (n % 2 == 0) 0f else width / 2
        val top = if (n < 2) 0f else height / 2
        canvas.drawRect(left, top, left + width / 2, top + height / 2, Paint().apply { color = colour })
    }
}

/** A PDF of [objects], each `n 0 obj`'s body from 1, the first its catalog, and [trailer]'s entries, its cross-references counted. */
private fun pdf(objects: List<String>, trailer: String = ""): ByteBuffer {
    val out = StringBuilder("%PDF-1.4\n")
    val offsets = objects.mapIndexed { n, body -> out.length.also { out.append("${n + 1} 0 obj\n$body\nendobj\n") } }
    val xref = out.length
    out.append("xref\n0 ${objects.size + 1}\n0000000000 65535 f \n")
    offsets.forEach { out.append(it.toString().padStart(10, '0')).append(" 00000 n \n") }
    out.append("trailer\n<< /Size ${objects.size + 1} /Root 1 0 R $trailer >>\nstartxref\n$xref\n%%EOF\n")
    return ByteBuffer.wrap(out.toString().toByteArray(Charsets.ISO_8859_1)).asReadOnlyBuffer()
}

/**
 * A one-page deck locked by the user password [password], under the standard security handler's revision 2 (RC4, 40 bits; ISO
 * 32000-1, 7.6.3.3, algorithms 2, 3 and 4), built by hand, since Android writes no locked PDF.
 */
private fun locked(password: String): ByteBuffer {
    fun padded(word: String) = (word.toByteArray(Charsets.ISO_8859_1) + PAD).copyOf(32)
    fun md5(vararg parts: ByteArray) = MessageDigest.getInstance("MD5").run { parts.forEach(::update); digest() }
    val permissions = -4
    val id = ByteArray(16) { it.toByte() }
    val owner = rc4(md5(padded("the owner")).copyOf(5), padded(password))
    val key = md5(padded(password), owner, ByteArray(4) { (permissions shr (8 * it)).toByte() }, id).copyOf(5)
    val user = rc4(key, PAD)
    return pdf(
        listOf(
            CATALOG,
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] >>",
            "<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P $permissions >>",
        ),
        "/Encrypt 4 0 R /ID [<${hex(id)}> <${hex(id)}>]",
    )
}

/** RC4 over [data] by [key]. */
private fun rc4(key: ByteArray, data: ByteArray): ByteArray {
    val s = IntArray(256) { it }
    var j = 0
    for (i in 0 until 256) {
        j = (j + s[i] + (key[i % key.size].toInt() and 0xFF)) and 0xFF
        s[i] = s[j].also { s[j] = s[i] }
    }
    var i = 0
    j = 0
    return ByteArray(data.size) { n ->
        i = (i + 1) and 0xFF
        j = (j + s[i]) and 0xFF
        s[i] = s[j].also { s[j] = s[i] }
        (data[n].toInt() xor s[(s[i] + s[j]) and 0xFF]).toByte()
    }
}

private fun hex(bytes: ByteArray) = bytes.joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }

/** The pixel at [x], [y]. */
private fun Bitmap.at(x: Int, y: Int): Int = getPixel(x, y)

/** [actual] within a few steps of [expected] in each channel, as a page's antialiasing leaves it. */
private fun assertColor(expected: Int, actual: Int, case: String) {
    val near = listOf(24, 16, 8, 0).all { shift -> abs((expected ushr shift and 0xFF) - (actual ushr shift and 0xFF)) <= 8 }
    assertTrue("$case: #${Integer.toHexString(actual)} for #${Integer.toHexString(expected)}", near)
}
