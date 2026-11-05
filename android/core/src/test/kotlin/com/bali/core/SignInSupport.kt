package com.bali.core

import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.AfterTest
import kotlin.test.fail
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

// B4's test rig, SignInTests.swift's: Cognito's token endpoint answered by hand, the Keychain's
// stand-in, a clock the test sets, and the scope the app gives its sign-in.

val cognito = Cognito(URI("https://bali-dev.auth.us-east-1.amazoncognito.com"), "phone-client", URI("bali://auth/callback"))
const val TOKEN_ENDPOINT = "https://bali-dev.auth.us-east-1.amazoncognito.com/oauth2/token"

/** The phone's clock: 2026, while the tokens' own claims are the server's, in 2001. */
val t0: Instant = Instant.ofEpochSecond(1_790_000_000)

/**
 * How long, in real time, a test waits before it fails instead of hanging: well past any stall of a
 * JVM runner. Only a failing wait takes it all.
 */
val patience = 60.seconds

/** Runs a test's [block], failed rather than hung past [patience]. */
fun inTime(block: suspend CoroutineScope.() -> Unit): Unit = runBlocking { withTimeout(patience) { block() } }

/** Waits, in real time, for [condition], which marks a point the test waits for; bounded by [inTime]. */
suspend fun eventually(condition: () -> Boolean) {
    while (!condition()) delay(1)
}

/** A token whose payload is [payload], unsigned: the phone never checks the signature. */
fun token(payload: String) = "eyJhbGciOiJSUzI1NiJ9.${base64url(payload.encodeToByteArray())}.signature"

/** An access token as Cognito's reads on the phone: a payload with `iat` and `exp`. */
fun jwt(name: String, lifetime: Long = 3600) = token("""{"sub":"$name","iat":1000000000,"exp":${1_000_000_000 + lifetime}}""")

/** An access token from a sign-in that asked for the scope DeleteUser needs, its pool's [issuer] (DeleteUserTests' `admin`). */
fun admin(name: String, issuer: String = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YTloqilwT") =
    token(
        """{"sub":"$name","iat":1000000000,"exp":1000003600,""" +
            """"scope":"openid email profile aws.cognito.signin.user.admin","iss":"$issuer"}""",
    )

/**
 * The token endpoint's answer: the tokens, a refresh token only when given, and an ID token naming the
 * account's [email], one naming none when not given.
 */
fun granted(access: String, refresh: String? = null, email: String? = null): String {
    val id = email?.let { """{"sub":"s","email":"$it","token_use":"id"}""" } ?: """{"sub":"s"}"""
    val refreshToken = refresh?.let { """"refresh_token":"$it",""" }.orEmpty()
    return """{"id_token":"${token(id)}","access_token":"$access",$refreshToken"expires_in":3600,"token_type":"Bearer"}"""
}

/** Its OAuth refusal. */
fun refusal(error: String) = """{"error":"$error"}"""

/** The value of [name] in [url]'s query, decoded; none when it has none. */
fun query(url: URI, name: String): String? = fields(url.rawQuery?.encodeToByteArray())[name]

/** A form body's fields, each decoded, a `+` kept as the sign-in's escaping never writes one. */
fun fields(body: ByteArray?): Map<String, String> =
    body?.decodeToString()?.split('&')?.filter { it.isNotEmpty() }.orEmpty().associate { field ->
        val (name, value) = field.split('=', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        name to URLDecoder.decode(value.replace("+", "%2B"), Charsets.UTF_8)
    }

/** The hosted UI, as the app's browser hands it back: signed in, with a code for the attempt the page was opened for. */
val signsIn: suspend (URI) -> String = { url -> "bali://auth/callback?code=the-code&state=${query(url, "state")}" }

/** The Keychain's stand-in: memory, which can be locked, as a store that can't be read right now is. */
class MemoryStore : TokenStore {
    class Locked : Exception("the store is locked")

    private val lock = Any()
    private var saved: ByteArray? = null
    private var locked = false

    val data: ByteArray? get() = synchronized(lock) { saved }
    internal val tokens: Tokens? get() = data?.let(Tokens::from)

    fun setLocked(locked: Boolean) = synchronized(lock) { this.locked = locked }

    override fun load(): ByteArray? = synchronized(lock) { if (locked) throw Locked() else saved }

    override fun save(tokens: ByteArray) = change(tokens)

    override fun clear() = change(null)

    private fun change(data: ByteArray?) =
        synchronized(lock) {
            if (locked) throw Locked()
            saved = data
        }

    companion object {
        /** A store holding [access]'s tokens, as a sign-in at [at] left them. */
        fun holding(access: String, refresh: String = "refresh-1", at: Instant = t0) =
            MemoryStore().apply { save(Tokens(access, refresh, null, at).kept) }
    }
}

/**
 * A clock the test sets, [t0] until it does, counting its [reads]: a caller checking its token's
 * expiry marks the stretch in which it gets the token or joins the renewal under way.
 */
class Now : () -> Instant {
    private val time = AtomicReference(t0)
    private val read = AtomicInteger()

    val reads: Int get() = read.get()

    override fun invoke(): Instant = time.get().also { read.incrementAndGet() }

    fun set(seconds: Long) = time.set(t0.plusSeconds(seconds))
}

/** How many times the sign-in told the engine of a token. */
class Told {
    private val told = AtomicInteger()
    val count: Int get() = told.get()

    fun add() {
        told.incrementAndGet()
    }
}

/** What a test heard, in order. */
class Heard {
    private val lock = Any()
    private val heard = mutableListOf<String>()
    val added: List<String> get() = synchronized(lock) { heard.toList() }

    fun add(value: String) = synchronized(lock) { heard += value }
}

/** The token endpoint's next answer, none for none at all, which a test changes as it goes. */
class Answers(reply: Pair<Int, String>?) {
    @Volatile private var reply = reply

    fun set(reply: Pair<Int, String>?) {
        this.reply = reply
    }

    /** A token endpoint answering each request with the reply now, or, none, with no answer, as OkHttp throws one. */
    fun endpoint() =
        TransportDouble {
            val (status, body) = reply ?: throw IOException("no answer")
            HttpAnswer(status, emptyMap(), body.encodeToByteArray())
        }
}

/** A token endpoint that holds every request until the test answers it. */
class HeldEndpoint : HttpTransport {
    private val lock = Any()
    private val waiting = mutableListOf<CompletableDeferred<Pair<Int, String>>>()
    private val arrivals = mutableListOf<Pair<Int, CompletableDeferred<Unit>>>()
    private var count = 0

    val sent: Int get() = synchronized(lock) { count }

    override suspend fun send(request: HttpRequest): HttpAnswer {
        val answer = CompletableDeferred<Pair<Int, String>>()
        val due =
            synchronized(lock) {
                count += 1
                waiting += answer
                arrivals.filter { it.first <= count }.also { arrivals -= it.toSet() }
            }
        due.forEach { it.second.complete(Unit) }
        val (status, body) = answer.await()
        return HttpAnswer(status, emptyMap(), body.encodeToByteArray())
    }

    /** Returns once [count] requests have come, each held for its answer: the requests' own mark, never a clock. */
    suspend fun received(count: Int) {
        val arrival = synchronized(lock) { if (this.count >= count) null else CompletableDeferred<Unit>().also { arrivals += count to it } }
        arrival?.await()
    }

    /** Answers every request waiting, or only the newest. */
    fun answer(status: Int, body: String, newestOnly: Boolean = false) {
        val answering = synchronized(lock) { if (newestOnly) listOf(waiting.removeAt(waiting.lastIndex)) else waiting.toList().also { waiting.clear() } }
        answering.forEach { it.complete(status to body) }
    }
}

/** What [flow] gives at once, without waiting: a signed-in flow's value now; none when it has none yet. */
fun CoroutineScope.atOnce(flow: Flow<Boolean>): Boolean? {
    var value: Boolean? = null
    launch(start = CoroutineStart.UNDISPATCHED) { value = flow.first() }.cancel()
    return value
}

/** Each test's sign-ins, in the scope the app gives its own, every renewal ended once the test is over. */
abstract class SignIns {
    /** The scope the app gives its sign-in, here the test's. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** A sign-in over [store] and [endpoint], the engine's side counted by [told], as SignInTests.swift's `signIn` makes one. */
    suspend fun signIn(store: TokenStore, endpoint: HttpTransport, now: Now = Now(), told: Told? = null, gated: Boolean = false): SignIn =
        SignIn(cognito, store, scope, endpoint, now, gated).also { phone -> told?.let { counter -> phone.whenTokenArrives { counter.add() } } }

    @AfterTest
    fun endSignIns(): Unit =
        runBlocking { withTimeoutOrNull(patience) { scope.coroutineContext.job.cancelAndJoin() } ?: fail("a renewal never ended") }
}
