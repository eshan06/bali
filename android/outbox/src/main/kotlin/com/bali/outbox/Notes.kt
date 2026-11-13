package com.bali.outbox

// What the phone keeps beside the outbox (AN10b), BaliApp.swift's notes in the phone's own defaults: whether the lock's switch has
// ever read on, and, under the student by their id, whose classes were listed here and who has seen the consent list. The app's
// store is AN10c's, in its SharedPreferences.

/**
 * The phone's notes, BaliApp.swift's `everApproved`, `inClass` and `listSeenBy` in its own defaults, and nothing beside them (L8a's
 * `answersListSeenBy` has no twin: no Android build ever showed L8a's list). Kept as the outbox is, out of the backup and of a
 * transfer to a new phone (ARCHITECTURE, "Android app structure"). A sign-out keeps them, so the same student is never asked
 * again; the account deleted on Bali's server, the two under the student go ([Account]), and once a deletion's request went out
 * with no answer of its own proving the account stands, they stay off the disk for the rest of the run (AN9k). Read and written
 * in the account's and the router's own stretches, so a store never waits on its disk there: the app's keeps them in memory and
 * writes behind (AN10c). The one write that waits on the disk is [forgetStudent]'s, which the account makes with itself let go.
 */
interface Notes {
    /** Whether a pass has ever read the lock's switch on (C1b, Q3): set at on, cleared once the check judges it off ([Router]). */
    var everApproved: Boolean

    /** The student `GET /v1/me` last listed in a class on this phone, by their id (#143): which words Home's empty state says. */
    var inClass: String?

    /** The student who has seen the consent list as it stands on this phone, by their id (L8a): the router's one-time screen. */
    var listSeenBy: String?

    /**
     * [inClass] and [listSeenBy] gone, off the disk before this returns: Delete account's, before it sends anything, so a process
     * ended while the deletion runs leaves nothing of the student's on the phone (AN10c), and the account's once Bali's server has
     * deleted the account, its sign-in forgotten or marked for it (AN9j; AN9k). Written through, so it waits on the disk.
     */
    fun forgetStudent()
}

/** The notes in memory alone, gone with the process: the tests', and an account's when the app hands it none. */
class MemoryNotes : Notes {
    @Volatile override var everApproved = false

    @Volatile override var inClass: String? = null

    @Volatile override var listSeenBy: String? = null

    override fun forgetStudent() {
        inClass = null
        listSeenBy = null
    }
}
