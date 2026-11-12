package com.bali.bali

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The phone's notes in the app's own SharedPreferences (AN10c), on the emulator, over stores of the test's own names: what one
 * writes is in the app's own `shared_prefs/`, the domain the backup rules leave out (OutboxFileTest), and a store made later reads
 * it back from the disk, as at a relaunch; the notes under the student leave the disk before their forget returns. Android keeps
 * each SharedPreferences file it has opened in memory for the process's life, so each read from the disk is a file copied under
 * a name never opened before, read by a store made over it.
 */
@RunWith(AndroidJUnit4::class)
class PreferencesNotesTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val names = mutableListOf<String>()

    @After
    fun deleteTheFiles() {
        names.forEach { context.deleteSharedPreferences(it) }
    }

    @Test
    fun whatTheStoreWritesIsInTheAppsOwnSharedPrefsAndAStoreMadeLaterReadsItBackFromTheDiskTheStudentsForgetWrittenThrough() {
        val name = fresh()
        val store = PreferencesNotes(context, name)
        assertEquals(listOf(false, null, null), store.read())
        store.everApproved = true
        store.inClass = "u1"
        store.listSeenBy = "u2"
        val file = File(context.dataDir, "shared_prefs/$name.xml")
        // Written behind: on the disk once the writes land.
        until { disk(file)?.takeIf { """name="everApproved" value="true"""" in it && """name="inClass">u1<""" in it && """name="listSeenBy">u2<""" in it } }
        assertEquals(listOf(true, "u1", "u2"), relaunched(file).read())
        // The student's two off the disk before the forget returns, written through; everApproved, the phone's, kept.
        store.forgetStudent()
        val forgotten = checkNotNull(disk(file))
        assertFalse(forgotten, "u1" in forgotten || "u2" in forgotten)
        assertEquals(listOf(true, null, null), relaunched(file).read())
    }

    /** A name no store has opened in this process: its file is read from the disk. */
    private fun fresh(): String = "notes-test-${System.nanoTime()}".also { names += it }

    /** [file] as a relaunch finds it: copied under a fresh name and read by a store made over it. */
    private fun relaunched(file: File): PreferencesNotes {
        val name = fresh()
        file.copyTo(File(context.dataDir, "shared_prefs/$name.xml"))
        return PreferencesNotes(context, name)
    }

    /** [file]'s text, or none while SharedPreferences has it moved aside to write it. */
    private fun disk(file: File): String? = runCatching { file.readText() }.getOrNull()

    private fun PreferencesNotes.read() = listOf(everApproved, inClass, listSeenBy)
}
