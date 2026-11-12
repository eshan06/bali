package com.bali.bali

import android.content.Context
import androidx.core.content.edit
import com.bali.outbox.Notes

/** The notes' file, in the app's own `shared_prefs/`. */
const val NOTES_FILE = "notes"

/**
 * The phone's notes ([Notes], AN10b's) in the app's own SharedPreferences, BaliApp.swift's in the phone's own defaults: read whole
 * as the store is made, which the app does before the account or the router reads it ([BaliApp.onCreate]), then kept in memory
 * and written behind (`apply`), so neither ever waits on the disk; [forgetStudent] alone is written through. Its keys are the
 * notes' own names, never renamed, since a later build reads them. In the `sharedpref` domain, which the backup rules leave out
 * of a backup and of a transfer to a new phone with all of Bali's storage (res/xml), and gone with the app. A test's [name] is
 * its own.
 */
internal class PreferencesNotes(context: Context, name: String = NOTES_FILE) : Notes {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    @Volatile private var approved = prefs.getBoolean(EVER_APPROVED, false)

    @Volatile private var listed = prefs.getString(IN_CLASS, null)

    @Volatile private var seen = prefs.getString(LIST_SEEN_BY, null)

    override var everApproved: Boolean
        get() = approved
        set(value) {
            approved = value
            prefs.edit { putBoolean(EVER_APPROVED, value) }
        }

    override var inClass: String?
        get() = listed
        set(value) {
            listed = value
            prefs.edit { putString(IN_CLASS, value) }
        }

    override var listSeenBy: String?
        get() = seen
        set(value) {
            seen = value
            prefs.edit { putString(LIST_SEEN_BY, value) }
        }

    /** Off the disk before it returns (`commit`); a disk that refuses it leaves them for the deletion's own forget at its answer. */
    override fun forgetStudent() {
        listed = null
        seen = null
        prefs.edit(commit = true) {
            remove(IN_CLASS)
            remove(LIST_SEEN_BY)
        }
    }

    private companion object {
        const val EVER_APPROVED = "everApproved"
        const val IN_CLASS = "inClass"
        const val LIST_SEEN_BY = "listSeenBy"
    }
}
