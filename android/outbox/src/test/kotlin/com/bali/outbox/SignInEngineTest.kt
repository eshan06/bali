package com.bali.outbox

import com.bali.core.Cognito
import com.bali.core.SignIn
import com.bali.core.TokenStore
import java.net.URI
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

// B4's contract with the engine, over the real sign-in: the engine made as the app makes it
// (`SyncEngine.make`), Cognito's token endpoint and the API both answered by hand, and a clock the
// test moves. BaliOutbox's SignInEngineTests.

val tokenRoute = "POST /oauth2/token"

/** An access token as Cognito's reads on the phone: `iat` and `exp` in its payload, unsigned. */
fun accessToken(name: String): String {
    val payload = """{"sub":"$name","iat":1000000000,"exp":1000003600}"""
    return "eyJhbGciOiJSUzI1NiJ9.${Base64.getUrlEncoder().withoutPadding().encodeToString(payload.encodeToByteArray())}.signature"
}

/** The token endpoint's answer; a refresh token only when given. */
fun grant(access: String, refresh: String? = null): String {
    val refreshToken = refresh?.let { """"refresh_token":"$it",""" }.orEmpty()
    return """{"access_token":"$access",$refreshToken"expires_in":3600,"token_type":"Bearer"}"""
}

/** The Keychain's stand-in. */
class MemoryKeychain : TokenStore {
    private val lock = Any()
    private var saved: ByteArray? = null
    val isEmpty: Boolean get() = synchronized(lock) { saved == null }

    override fun load(): ByteArray? = synchronized(lock) { saved }

    override fun save(tokens: ByteArray) = synchronized(lock) { saved = tokens }

    override fun clear() = synchronized(lock) { saved = null }
}

/** The hosted UI, handing back a code for the attempt it was opened for. */
val hostedUi: suspend (URI) -> String = { url ->
    val state = url.rawQuery.split('&').first { it.startsWith("state=") }.removePrefix("state=")
    "bali://auth/callback?code=the-code&state=$state"
}

/** An engine as the app starts it, over the student's sign-in, with nobody signed in yet. BaliOutbox's tests' `SignedRig`. */
class SignedRig(
    val engine: SyncEngine,
    val signIn: SignIn,
    val outbox: Outbox,
    val server: Server,
    val clock: TestClock,
    val keychain: MemoryKeychain,
    /** The test's, the app's in its place: the engine's and the sign-in's, which their calls run in. */
    val scope: CoroutineScope,
) {
    /** The engine's run, started at once: its first stretch holds the engine before any call the test makes. */
    val running: Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { engine.run() }

    /** The student signs in, Cognito answering with [access] and [refresh]. */
    suspend fun signStudentIn(access: String, refresh: String = "refresh-1") =
        coroutineScope {
            val signingIn = async { signIn.signIn(browser = hostedUi) }
            server.next(tokenRoute).reply(200, grant(access, refresh))
            signingIn.await()
        }

    /** Waits for a state [condition] holds for, and returns it; none in time fails the test. */
    suspend fun until(condition: (SyncState) -> Boolean): SyncState =
        withTimeoutOrNull(patience) { engine.updates.first(condition) } ?: fail("the engine never reached the state waited for")

    /** Stops the engine: its loops must end. */
    suspend fun stop() {
        running.cancel()
        server.close()
        withTimeoutOrNull(patience) { running.join() } ?: fail("the engine's loops never ended")
    }
}

/**
 * The engine the app makes over its sign-in (`SyncEngine.make`), over [outbox], a fresh one by default, one server
 * answering Cognito and the API. BaliOutbox's tests' `SignedRig()`.
 */
suspend fun EngineFiles.signedRig(outbox: Outbox = makeOutbox().first): SignedRig {
    val (server, clock, keychain) = Triple(Server(), TestClock(), MemoryKeychain())
    val cognito = Cognito(URI("https://bali-dev.auth.us-east-1.amazoncognito.com"), "phone-client", URI("bali://auth/callback"))
    // Ungated, as iOS's rig is unless a test asks: the 13+ check is the sign-in's own tests' (C7).
    val signIn = SignIn(cognito, keychain, scope, server, clock::now, gated = false)
    val engine = SyncEngine.make(outbox, URI("https://api.bali.test"), signIn, scope, server, clock)
    return SignedRig(engine, signIn, outbox, server, clock, keychain, scope)
}

/** B4's contract with the engine, over the real sign-in. BaliOutbox's SignInEngineTests. */
class SignInEngineTest : EngineFiles() {
    @Test
    fun signedOutARecordWaitsOnSignInNeverDroppedTheSignInSendsItAtOnce(): Unit =
        runBlocking {
            val rig = signedRig()
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.until { it.link == Link.SignIn && it.retryAt == at(60) }
            assertEquals(emptyList(), rig.server.waiting)
            // Read from another module, as the app's browser reads its redirect URI (AN6c).
            assertEquals("bali", rig.signIn.cognito.redirectUri.scheme)

            rig.signStudentIn(accessToken("a1"))
            val sent = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer ${accessToken("a1")}"), listOf(sent.eventId, sent.token))
            assertEquals(t0, rig.clock.now()) // at once, not a minute on
            rig.stop()
        }

    @Test
    fun a401TheSignInRenewsTheTokenWithItsRefreshTokenAndEverythingGoesAgainAtOnce(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signStudentIn(accessToken("a1"))
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(401)

            val renewal = rig.server.next(tokenRoute)
            val form = renewal.request.body?.decodeToString().orEmpty()
            assertTrue("grant_type=refresh_token" in form && "refresh_token=refresh-1" in form, form)
            renewal.reply(200, grant(accessToken("a2")))
            val again = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer ${accessToken("a2")}"), listOf(again.eventId, again.token))
            assertEquals(t0, rig.clock.now())
            again.reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
            rig.stop()
        }

    @Test
    fun cognitoRefusingTheRefreshTokenSignsTheStudentOutTheRecordKeptSendsNothingAndGoesAtTheNextSignIn(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signStudentIn(accessToken("a1"))
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            rig.server.next(unlockRoute).reply(401)
            rig.server.next(tokenRoute).reply(400, """{"error":"invalid_grant"}""")

            // Signed out: the record backs off as a rejection, then waits on sign-in, unsent.
            rig.until { it.link == Link.SignIn && it.retryAt == at(2) }
            assertTrue(rig.keychain.isEmpty)
            rig.clock.advance(2)
            rig.until { it.retryAt == at(62) }
            assertTrue(rig.server.waiting.all { it == meRoute }, "${rig.server.waiting}")
            assertEquals(listOf(unlock.eventId), rig.outbox.records().map { it.eventId })

            rig.signStudentIn(accessToken("a3"), refresh = "refresh-2")
            val sent = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer ${accessToken("a3")}"), listOf(sent.eventId, sent.token))
            assertEquals(at(2), rig.clock.now())
            rig.stop()
        }

    @Test
    fun aTokenTheSignInRenewsOnItsOwnSendsWhatWaitedOnItAtOnce(): Unit =
        runBlocking {
            val rig = signedRig()
            rig.signStudentIn(accessToken("a1"))
            // The sign-in's read of the truth goes out with a1 before the clock moves: the only renewal
            // next is the drain's, not one the read would start and the test answer in its place.
            rig.server.next(meRoute)
            rig.clock.advance(3600) // a1 has expired
            val unlock = assertNotNull(rig.engine.record(Change.Unlock("s", null)))
            // The drain's own request found it expired and renewed it first: Cognito out of reach, so no
            // token, and the record waits on sign-in, unsent.
            rig.server.next(tokenRoute).reply(null)
            rig.until { it.link == Link.SignIn && it.retryAt == at(3660) }

            // A screen's own call through the engine's client renews it.
            val client = rig.engine.client
            val screen = async { client.me() }
            rig.server.next(tokenRoute).reply(200, grant(accessToken("a2")))
            val sent = rig.server.next(unlockRoute)
            assertEquals(listOf(unlock.eventId, "Bearer ${accessToken("a2")}"), listOf(sent.eventId, sent.token))
            assertEquals(at(3600), rig.clock.now()) // at once, not the minute the drain waits
            rig.stop()
            screen.await()
        }
}
