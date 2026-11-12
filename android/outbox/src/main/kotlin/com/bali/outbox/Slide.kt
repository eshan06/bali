package com.bali.outbox

import com.bali.core.Slide
import java.nio.ByteBuffer

// The slide a live lesson shows (M8; ARCHITECTURE, "Live lesson", decision 8), SlideView.swift's `SlideDeck` and `SlideShown`: its
// deck's phase as this phone has it, the two lines its frame says before the page is in (WordsTest reads them), and the seam the
// app's renderer fills (AN13f), as Lock.kt's is the lock's, so which deck opens when, and when it closes, run on the JVM. Which deck
// the lesson asks for, and when, is the lesson half's (Lessons.kt); the page on screen, "Slide N of M", Pinch to zoom and Try again
// are AS8's, as SlideView.swift draws iOS's.

/**
 * The slide a screen shows (M8): the page the teacher shows, and its deck as this phone has it. Equal by both, so a screen asks for
 * the deck at each change of what shows ([Lessons.ask]), as SlideView.swift's `.task(id:)` does. SlideView.swift's `SlideShown`.
 */
data class SlideShown(val slide: Slide, val phase: Phase) {
    /** Where the slide's deck stands on this phone: SlideView.swift's `SlideDeck.Phase`. */
    sealed interface Phase {
        /** Not asked for yet, or on its way. */
        data object Loading : Phase

        /** Not come, not opened, or without the slide's page: one line with Try again, whatever the cause (rule 5). */
        data object Failed : Phase

        /** In, checked and open: [document], its page `slide.page - 1` the one drawn (AN13f). */
        data class Ready(val document: Document) : Phase
    }
}

/**
 * The line in the slide's frame before its page is in, iOS's word for word and the Android canvas's (AS8-Slide-loading, and
 * AS8-Slide-failed over its Try again, AS8's): none once the page is in. SlideView.swift's two.
 */
val SlideShown.Phase.words: String?
    get() =
        when (this) {
            SlideShown.Phase.Loading -> "Loading the slides…"
            SlideShown.Phase.Failed -> "Bali couldn't load the slides."
            is SlideShown.Phase.Ready -> null
        }

/**
 * A deck's renderer as the phone has it (decision 8): the app's `PdfRenderer` behind this seam, never `android.*` here, so the
 * lesson half's rules run on the JVM. iOS's `PDFDocument(data:)`. AN13f fills it as the owner answered Q2 and Q3 (DECISIONS
 * 2026-11-12): pdfium in an isolated service process, the deck handed over as an anonymous memory file, or on Android 10 a file in
 * a deck folder of its own in `no_backup/`, deleted the moment it opens. Nothing here presupposes either.
 */
interface Renderer {
    /**
     * Opens [deck], the bytes a deck's check let through (`DeckResult.Ready.buffer()`, read-only and in memory, never the array the
     * lesson keeps), into its document, its pages counted; none where it won't open: not a PDF, a password, the renderer's process
     * gone, or an open that can't finish, which is the renderer's to end (AN13f bounds it), so a slide never stays loading. Never
     * throws but on a cancel, which closes whatever it opened before it throws. An open let go may still finish beside the next
     * one's, so the renderer holds no single slot: the lesson half closes the document it no longer wants as it comes.
     */
    suspend fun open(deck: ByteBuffer): Document?
}

/**
 * A deck opened ([Renderer.open]): one kept at a time, closed once the lesson lets it go. A screen may still hold it from an
 * earlier state once it is closed, so drawing a closed one counts as failed, never a crash (AN13f's to build).
 */
interface Document {
    /** How many pages it has: fixed as it opened, read with no call to the renderer, so it never throws. */
    val pages: Int

    /**
     * Returns once the document is lost after it opened, as the app's renderer finds it: its process gone, or a page it couldn't
     * draw (AN13f's). Never while it holds; a cancel ends the wait. Its slide then shows failed, and Try again opens a fresh one.
     */
    suspend fun awaitLost()

    /** Closes it, once: returns at once and never throws, the renderer closing it after any draw under way (AN13f's). */
    fun close()
}
