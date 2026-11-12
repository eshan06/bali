package com.bali.outbox

// What a teacher sees of a student in their class, and never sees (C1b, C2b, C6b), the lists of iOS's `ConsentCard`
// (JoinView.swift): one list, so the intro's second page, Join's preview and Me's What your teacher sees never say different
// things, and what the one-time screen says it gained (L8a). iOS's word for word, but the focus status, which names Bali's lock
// where the iPhone's names Screen Time (the Words board; the canvas's Consent). The card, its headings ("Sees", "What Ms. Rivera
// sees", "Never sees") and the screens are AS2's, AS4's and AS7's.

/**
 * The consent list (D1's ConsentPreview; the Android canvas's Consent): what a teacher sees of a student in their class, [sees],
 * and never sees, [neverSees], whole ([WHOLE]) or what it gained ([ADDED]). It promises it never grows without asking again
 * (ARCHITECTURE, "Live lesson", decision 11), so a line changes only with the owner's word, on both phones at once.
 */
data class ConsentList(val sees: List<String>, val neverSees: List<String>) {
    companion object {
        /**
         * The whole list, iOS's `ConsentCard.sees` and `neverSees`: the grid's silence and last-seen time too (the owner,
         * 2026-09-27), its Clock off after them (the owner, 2026-10-28), its answers lines last (L8a), how many answered the last
         * of them.
         */
        val WHOLE =
            ConsentList(
                sees =
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
                neverSees = listOf("Your screen, your apps, or what's in them", "Your messages or where you are", "Which answer is yours"),
            )

        /**
         * What the list gained since a student may have seen it, all the one-time screen lists (L8a; 2026-10-28): a clock set
         * ahead, the answers line and how many answered, and the line on answers the owner narrowed. iOS's
         * `ConsentCard.added(sawAnswers: false)`, since no Android build ever showed L8a's list (`Notes`), so neither change goes
         * untold.
         */
        val ADDED = ConsentList(listOf(WHOLE.sees[2]) + WHOLE.sees.takeLast(2), WHOLE.neverSees.takeLast(1))
    }
}
