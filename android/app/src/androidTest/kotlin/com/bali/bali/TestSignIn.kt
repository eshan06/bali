package com.bali.bali

import com.bali.core.Cognito
import com.bali.core.SignIn
import com.bali.core.TokenStore
import java.net.URI
import java.util.Base64
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

// A sign-in of a test's own, as AN7c's tests make an engine of their own: none of the emulators can sign in, so the hosted UI
// is a stand-in handing back the attempt's code, Cognito's token endpoint is the test's [Server], and the tokens are kept in
// memory alone, never in the app's store. The sign-in is gated, as the app's is (C7): no token to Bali's API before the 13+
// check but the check's own read.

/** Bali's API as the tests' engines reach it, through their [Server]. */
internal const val API = "https://api.bali.test"

/** The 13+ check's read (C7-server), and Bali's yes. */
internal const val AGE_CHECK = "GET /v1/me/age-check"
internal const val PASSED = """{"passed":true}"""

private val cognito = Cognito(URI("https://bali.auth.test"), "the-client", URI("com.bali.bali:/auth/callback"))

/** A sign-in over [server], its calls in [scope], the test's. */
internal fun testSignIn(server: Server, scope: CoroutineScope): SignIn = SignIn(cognito, Memory(), scope, server)

/** [student] signs in through [signIn]'s hosted UI, Cognito's token endpoint answered here; back once the sign-in has landed. */
internal fun Server.signStudentIn(signIn: SignIn, scope: CoroutineScope, student: String) {
    val signing =
        scope.async {
            signIn.signIn { page -> "${cognito.redirectUri}?code=the-code&" + page.rawQuery.split('&').first { it.startsWith("state=") } }
        }
    next("POST /oauth2/token").reply(200, """{"access_token":"${accessToken(student)}","refresh_token":"refresh-$student","expires_in":3600,"token_type":"Bearer"}""")
    runBlocking { withTimeout(30.seconds) { signing.await() } }
}

/** An access token as Cognito's reads on the phone, [student] its `sub`, an hour long; unsigned, as the phone never checks it. */
internal fun accessToken(student: String): String {
    val payload = """{"sub":"$student","iat":1000000000,"exp":1000003600}"""
    return "eyJhbGciOiJSUzI1NiJ9.${Base64.getUrlEncoder().withoutPadding().encodeToString(payload.encodeToByteArray())}.signature"
}

/** The token the request was sent under, as the API reads it. */
internal val Server.Exchange.token: String? get() = request.headers["Authorization"]

/** The Keystore store's stand-in, in memory: a test's sign-in leaves nothing on the phone. */
private class Memory : TokenStore {
    @Volatile private var saved: ByteArray? = null

    override fun load(): ByteArray? = saved

    override fun save(tokens: ByteArray) {
        saved = tokens
    }

    override fun clear() {
        saved = null
    }
}
