package com.bali.bali

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import com.bali.core.TokenStore
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.security.InvalidKeyException
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The sign-in's file, in the app's own `no_backup/`. */
const val SIGN_IN_FILE = "sign-in.sealed"

/**
 * Where the sign-in keeps its tokens: sealed with AES-GCM under a key of the app's own in the Android
 * Keystore, which never leaves the phone (iOS's `ThisDeviceOnly`); Android deletes both with the app.
 * BaliCore's `KeychainTokenStore`. The key needs no user authentication, no unlocked phone and no
 * StrongBox: Android's check-ins follow the screen, the lock screen included (AN5c), and many phones have
 * no StrongBox. The file is in `no_backup/`, which no backup takes, and the backup rules leave everything
 * out besides (res/xml): one restored anyway can't be opened without its key, so it reads as nothing saved.
 */
class KeystoreTokenStore(private val file: File, private val alias: String = KEY) : TokenStore {
    constructor(context: Context) : this(File(context.noBackupFilesDir, SIGN_IN_FILE))

    /** Where a save writes before it takes the file's place. */
    private val next = File(file.path + ".new")

    /**
     * None when nothing is saved, and when what is can never be opened again: its key gone, a key the
     * Keystore lists but refuses (as some phones' are after an update), or a file the key can't open (too
     * short, or its tag refused: changed, or sealed by another key). Throws when it can't be read right
     * now. Said plainly: the Keystore gives no key for a lookup it fails, its own code, so such a failure
     * reads as the key gone.
     */
    override fun load(): ByteArray? {
        val sealed = try { Files.readAllBytes(file.toPath()) } catch (nothing: NoSuchFileException) { return null }
        if (sealed.size < IV + TAG) return null
        val key = keystore().getKey(alias, null) as? SecretKey ?: return null
        return try {
            val cipher = Cipher.getInstance(AES_GCM).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG * 8, sealed, 0, IV)) }
            cipher.doFinal(sealed, IV, sealed.size - IV)
        } catch (refused: InvalidKeyException) { null } catch (unopenable: AEADBadTagException) { null }
    }

    /**
     * Seals [tokens] into a file of their own, synced to the disk, which then takes the file's place in one
     * step (rename(2)): a save cut short leaves the old tokens or the new, never a file read as a sign-out.
     * A key the Keystore refuses is made again, its file about to be replaced anyway.
     */
    override fun save(tokens: ByteArray) {
        val cipher = Cipher.getInstance(AES_GCM)
        try { cipher.init(Cipher.ENCRYPT_MODE, key()) } catch (refused: InvalidKeyException) {
            keystore().deleteEntry(alias)
            cipher.init(Cipher.ENCRYPT_MODE, key())
        }
        check(cipher.iv.size == IV) { "the Keystore made a nonce of ${cipher.iv.size} bytes" }
        val sealed = cipher.iv + cipher.doFinal(tokens)
        FileOutputStream(next).use { out ->
            out.write(sealed)
            out.fd.sync()
        }
        Os.rename(next.path, file.path)
    }

    /** Forgets the tokens, and a save a crash left; the key stays, for the next. */
    override fun clear() {
        Files.deleteIfExists(file.toPath())
        Files.deleteIfExists(next.toPath())
    }

    /** The key, made at the first save. */
    private fun key(): SecretKey =
        keystore().getKey(alias, null) as? SecretKey
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
                val purposes = KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                init(
                    KeyGenParameterSpec.Builder(alias, purposes).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build(),
                )
                generateKey()
            }

    private fun keystore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    companion object {
        /** The key's name in the app's Keystore. */
        const val KEY = "sign-in"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val AES_GCM = "AES/GCM/NoPadding"

        /** GCM's nonce, as the Keystore makes it, and its tag, in bytes. */
        private const val IV = 12
        private const val TAG = 16
    }
}
