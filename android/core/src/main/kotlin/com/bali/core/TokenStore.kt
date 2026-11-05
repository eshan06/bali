package com.bali.core

/**
 * Where [SignIn] keeps its tokens between launches: sealed by a key in the Android Keystore on the
 * phone (the app's, AN6c), memory in the tests. BaliCore's `TokenStore`. Its calls block, as the
 * Keychain's do: the sign-in makes them on `Dispatchers.IO`, never its caller's thread.
 */
interface TokenStore {
    /**
     * What was saved; none only when nothing is: nobody signed in. Throws when it can't be read right
     * now: the sign-in then has no token right now and reads again at the next ask, never a sign-out.
     */
    fun load(): ByteArray?

    fun save(tokens: ByteArray)

    /** Forgets what was saved; nothing saved is no failure. */
    fun clear()
}
