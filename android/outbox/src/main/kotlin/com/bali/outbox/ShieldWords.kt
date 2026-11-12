package com.bali.outbox

// What the block screen says (B5c), BaliOutbox's ShieldWords.swift: each of its parts a type, its words a function of it
// (WordsTest reads every one). The screen, the cover the lock puts over a blocked app (AN7e), is AS5's.

/**
 * The block screen's parts (B5c; AS5's block screen boards), each said in its own words ([words]): Bali's name alone, the line
 * under it cut (the owner, 2026-11-04), where the iPhone's shield says "This app is paused for class. Open Bali to Emergency
 * Unlock."; then OK, which goes to the home screen as the shield's OK closes the app, and Open Bali, which opens Bali, where
 * Emergency Unlock is (C5). The same words whatever the phone stands in, never a time, and nothing read to say them (B5c-2): the
 * screen draws once (the battery plan). Android's lock covers apps alone, so there is no website's case, where the shield has
 * one. BaliOutbox's `ShieldWords`.
 */
enum class ShieldWords {
    /** Bali's name, the screen's one line. */
    Title,

    /** Leaves the block screen for the home screen. */
    Ok,

    /** Opens Bali, whose Focus holds Emergency Unlock. */
    OpenBali,
}

/** What each part of the block screen says: the shield's title and OK, and the Words board's Open Bali. */
val ShieldWords.words: String
    get() =
        when (this) {
            ShieldWords.Title -> "Focused with Bali"
            ShieldWords.Ok -> "OK"
            ShieldWords.OpenBali -> "Open Bali"
        }
