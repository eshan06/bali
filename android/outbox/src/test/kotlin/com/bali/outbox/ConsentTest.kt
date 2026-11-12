package com.bali.outbox

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The consent list (C1b, C2b, C6b; L8a), AN10h: line for line iOS's `ConsentCard` lists, read in place from JoinView.swift, as
// the portal's help page reads them (support.test.ts), but the focus status, which names Bali's lock (the Words board's "Join,
// intro 2, Me" row); each line word for word as the Android canvas's Consent draws it; and what the one-time screen lists.

/** iOS's `ConsentCard.[name]`, read in place (`bali.consent`): its lines as JoinView.swift writes them. */
private fun swift(name: String): List<String> {
    val path = checkNotNull(System.getProperty("bali.consent")) { "bali.consent is unset: run the tests through Gradle (android/README.md)" }
    val source = File(path).readText()
    val opening = "static let $name = ["
    check(opening in source) { "no ConsentCard.$name in JoinView.swift" }
    return Regex("\"([^\"]*)\"").findAll(source.substringAfter(opening).substringBefore("]")).map { it.groupValues[1] }.toList()
}

/** The consent list, held to its sources. */
class ConsentTest {
    @Test
    fun theListIsIosLineForLineButTheFocusStatusWhichNamesBalisLockWordForWordAsTheAndroidCanvasDrawsIt() {
        // The Words board's one change, and nothing else: no line added, dropped or reworded.
        val board = mapOf("Your focus status: focused, unlocked, or Screen Time off" to "Your focus status: focused, unlocked, or Bali's lock off")
        assertEquals(8, swift("sees").size)
        assertEquals(swift("sees").map { board[it] ?: it }, ConsentList.WHOLE.sees)
        assertEquals(swift("neverSees"), ConsentList.WHOLE.neverSees)
        // The canvas's Consent, word for word.
        assertEquals(
            listOf(
                "Your focus status: focused, unlocked, or Bali's lock off",
                "If Bali stops hearing from your phone during class, and when it last did",
                "If your phone's clock is set ahead",
                "When you tap in, and when class ends for you",
                "When you unlock, and the reason if you share one",
                "If you leave this class",
                "Your answers to questions, counted only in the class's totals",
                "How many answered, which can show whether you did",
            ),
            ConsentList.WHOLE.sees,
        )
        assertEquals(listOf("Your screen, your apps, or what's in them", "Your messages or where you are", "Which answer is yours"), ConsentList.WHOLE.neverSees)
    }

    @Test
    fun theOneTimeScreenListsAllTheListGainedAClockSetAheadTheAnswersLinesAndTheNarrowedOneSinceNoAndroidBuildShowedL8asList() {
        // iOS's `added(sawAnswers: false)`: a student this phone holds no record of may have seen neither change.
        assertEquals(
            listOf("If your phone's clock is set ahead", "Your answers to questions, counted only in the class's totals", "How many answered, which can show whether you did"),
            ConsentList.ADDED.sees,
        )
        assertEquals(listOf("Which answer is yours"), ConsentList.ADDED.neverSees)
        assertTrue(ConsentList.WHOLE.sees.containsAll(ConsentList.ADDED.sees) && ConsentList.WHOLE.neverSees.containsAll(ConsentList.ADDED.neverSees))
    }
}
