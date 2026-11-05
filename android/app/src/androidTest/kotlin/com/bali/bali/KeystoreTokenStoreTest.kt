package com.bali.bali

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The sign-in's store on Android's Keystore, on the emulator (KeychainTokenStore's, which iOS's package
 * tests can't reach either): what's kept is read back by a new store, as at a relaunch, and what can never
 * be opened again reads as nothing saved, a sign-out, never a throw, which the sign-in takes for "right
 * now" and asks again forever, the student neither signed in nor out (AN6b).
 */
@RunWith(AndroidJUnit4::class)
class KeystoreTokenStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val file = File(context.noBackupFilesDir, SIGN_IN_FILE)
    private val next = File(file.path + ".new")
    private val tokens = """{"access":"a.b.c","refresh":"r","until":"2026-09-21T14:13:20.000Z"}""".encodeToByteArray()

    @Before
    @After
    fun forgetEverything() {
        file.setReadable(true)
        file.delete()
        next.delete()
        File(context.noBackupFilesDir, "elsewhere").delete()
        keystore().apply {
            deleteEntry(KeystoreTokenStore.KEY)
            deleteEntry(OTHER)
        }
    }

    @Test
    fun nothingSavedIsNone() {
        assertNull(KeystoreTokenStore(context).load())
    }

    @Test
    fun whatIsKeptIsSealedAndReadBackByANewStoreAsAtARelaunchAndReplacedByTheNext() {
        KeystoreTokenStore(context).save(tokens)
        // Sealed: the file holds no byte run of the tokens, and is the nonce, the tokens and the tag.
        val sealed = file.readBytes()
        assertEquals(12 + tokens.size + 16, sealed.size)
        assertFalse(sealed.decodeToString(), sealed.decodeToString().contains("refresh"))
        assertArrayEquals(tokens, KeystoreTokenStore(context).load())
        val newer = """{"access":"d.e.f","refresh":"s"}""".encodeToByteArray()
        KeystoreTokenStore(context).save(newer)
        assertArrayEquals(newer, KeystoreTokenStore(context).load())
        assertFalse(next.exists())
    }

    @Test
    fun theKeyIsTheAppsOwnInTheKeystoreAskingNeitherTheStudentNorTheScreenUnlocked() {
        KeystoreTokenStore(context).save(tokens)
        val key = keystore().getKey(KeystoreTokenStore.KEY, null) as SecretKey
        val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as KeyInfo
        assertEquals(256, info.keySize)
        assertFalse(info.isUserAuthenticationRequired)
        assertNull(key.encoded) // Never leaves the Keystore.
    }

    @Test
    fun clearedIsNothingSavedAgainNoFailureAndTheNextSaveIsKept() {
        val store = KeystoreTokenStore(context)
        store.save(tokens)
        store.clear()
        assertNull(KeystoreTokenStore(context).load())
        store.clear()
        store.save(tokens)
        assertArrayEquals(tokens, KeystoreTokenStore(context).load())
    }

    @Test
    fun aFileWhoseKeyIsGoneReadsAsNothingSavedAndTheNextSaveMakesAKeyAgain() {
        KeystoreTokenStore(context).save(tokens)
        keystore().deleteEntry(KeystoreTokenStore.KEY)
        assertTrue(file.exists())
        assertNull(KeystoreTokenStore(context).load())
        KeystoreTokenStore(context).save(tokens)
        assertArrayEquals(tokens, KeystoreTokenStore(context).load())
    }

    @Test
    fun aKeyTheKeystoreListsButRefusesReadsAsNothingSavedAndTheNextSaveMakesItAgain() {
        KeystoreTokenStore(context).save(tokens)
        // A key by the name that refuses AES-GCM, as a key some phones keep after an update refuses all.
        keystore().deleteEntry(KeystoreTokenStore.KEY)
        val purposes = KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(KeystoreTokenStore.KEY, purposes).setBlockModes(KeyProperties.BLOCK_MODE_CBC)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_PKCS7).build(),
            )
            generateKey()
        }
        assertNull(KeystoreTokenStore(context).load())
        KeystoreTokenStore(context).save(tokens)
        assertArrayEquals(tokens, KeystoreTokenStore(context).load())
    }

    @Test
    fun aFileTheKeyCantOpenReadsAsNothingSaved() {
        // Sealed by a key of another name, as a file restored from another phone would be.
        KeystoreTokenStore(context).save(tokens)
        KeystoreTokenStore(file, OTHER).save(tokens)
        assertNull(KeystoreTokenStore(context).load())
        // Sealed by the key the name had before: the key made again, as by a store elsewhere.
        KeystoreTokenStore(context).save(tokens)
        keystore().deleteEntry(KeystoreTokenStore.KEY)
        KeystoreTokenStore(File(context.noBackupFilesDir, "elsewhere")).save(tokens)
        assertNull(KeystoreTokenStore(context).load())
        // Changed: a byte of the sealed tokens, or of the nonce.
        KeystoreTokenStore(context).save(tokens)
        for (at in listOf(20, 3)) {
            val sealed = file.readBytes()
            file.writeBytes(sealed.copyOf().also { it[at] = (it[at] + 1).toByte() })
            assertNull("$at", KeystoreTokenStore(context).load())
            file.writeBytes(sealed)
        }
        assertArrayEquals(tokens, KeystoreTokenStore(context).load())
        // Too short to be one: nothing, or less than a nonce and a tag.
        for (size in listOf(0, 27)) {
            file.writeBytes(ByteArray(size))
            assertNull("$size", KeystoreTokenStore(context).load())
        }
    }

    @Test
    fun aFileThatCantBeReadRightNowThrowsAndReadsOnceItCan() {
        KeystoreTokenStore(context).save(tokens)
        assertTrue(file.setReadable(false, false))
        assertThrows(IOException::class.java) { KeystoreTokenStore(context).load() }
        assertTrue(file.setReadable(true, false))
        assertArrayEquals(tokens, KeystoreTokenStore(context).load())
    }

    @Test
    fun aSaveACrashCutShortLeavesTheOldTokensAndTheNextSaveOrClearTakesItsFileAway() {
        KeystoreTokenStore(context).save(tokens)
        // Cut short as it wrote, then as it was about to take the file's place.
        for (left in listOf(ByteArray(7), file.readBytes().copyOf(30), ByteArray(64) { 1 })) {
            next.writeBytes(left)
            assertArrayEquals(tokens, KeystoreTokenStore(context).load())
        }
        // A save never writes into the file it replaces, so a crash can't leave it half written: here the
        // old file can't be written at all, and the save lands all the same, by taking its place.
        assertTrue(file.setWritable(false, false))
        val newer = """{"access":"d.e.f","refresh":"s"}""".encodeToByteArray()
        KeystoreTokenStore(context).save(newer)
        assertArrayEquals(newer, KeystoreTokenStore(context).load())
        next.writeBytes(ByteArray(7))
        KeystoreTokenStore(context).clear()
        assertFalse(next.exists())
        assertNull(KeystoreTokenStore(context).load())
    }

    @Test
    fun theFileIsInTheAppsOwnStorageWhereNoBackupGoes() {
        KeystoreTokenStore(context).save(tokens)
        // no_backup/, which Android never backs up; the backup rules leave out every domain besides
        // (OutboxFileTest's nothingOfBalisGoesIntoABackupOrATransferToANewPhone).
        assertEquals(context.noBackupFilesDir.canonicalFile, file.canonicalFile.parentFile)
        assertTrue(file.canonicalPath.startsWith(context.dataDir.canonicalPath + "/"))
        assertNotNull(KeystoreTokenStore(context).load())
    }

    private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private companion object {
        const val OTHER = "another phone's"
    }
}
