package com.bali.core

import java.net.URI
import java.net.URISyntaxException
import java.nio.charset.CharacterCodingException
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Contextual
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

// B4: the student's sign-in (ARCHITECTURE, Auth, decision 1), BaliCore's SignIn.swift. Cognito's
// hosted UI signs them in: the authorization-code grant with PKCE (S256) and a state nonce, over the
// phone's own public client, no secret anywhere and no token in any URL. Here, its parts (AN6a): the
// hosted UI's address, the code in its answer, and the tokens' kept form and claims. `SignIn`, which
// keeps the tokens, is AN6b's. No token, code, verifier or state goes into a log line or an error's
// message: nothing here logs, and no `toString` shows one.

/** The scope Cognito's DeleteUser needs in the access token it is given (C4). BaliCore's `SignIn.deleteScope`. */
internal const val DELETE_SCOPE = "aws.cognito.signin.user.admin"

/**
 * Where this build signs in: Cognito's hosted UI and the phone's app client, public values the
 * build sets ([AppConfig]). BaliCore's `Cognito`.
 */
data class Cognito(
    /** The hosted UI: `https://<prefix>.auth.<region>.amazoncognito.com`. */
    val domain: URI,
    val clientId: String,
    /**
     * Where the hosted UI sends its answer, `bali://auth/callback`, which the app's browser catches
     * (AN6c). Any app on the phone can send a `bali:` link too, where iOS's session catches its own,
     * so only its state makes an answer this attempt's ([code]).
     */
    val redirectUri: URI,
    /**
     * Where Cognito's `/logout` sends the browser back once it has ended the hosted UI's session there ([logoutUrl], AN6e): one of
     * the client's allowed sign-out URLs, which the app's browser catches as it catches the answer. It carries nothing of the
     * attempt. iOS has none: its sign-in is ephemeral, so no session outlives it.
     */
    val signOutUri: URI,
) {
    /**
     * The hosted UI's [page] for [attempt]: its challenge and state, never its verifier. Its scopes
     * are OpenID's and the one Cognito's DeleteUser needs (C4), which the phone's app client must
     * allow, or the sign-in is refused. The sign-up page takes the sign-in's parameters as they are,
     * so a new account comes back at the same redirect, for the same attempt. None, never in
     * practice: the domain is a URL and the rest is escaped.
     */
    internal fun authorizeUrl(attempt: Attempt, page: HostedPage = HostedPage.SignIn): URI? {
        val query =
            form(
                listOf(
                    "response_type" to "code", "client_id" to clientId, "redirect_uri" to redirectUri.toString(),
                    "scope" to "openid email profile $DELETE_SCOPE", "state" to attempt.state,
                    "code_challenge" to attempt.challenge, "code_challenge_method" to "S256",
                ),
            )
        return try {
            URI(endpoint(if (page == HostedPage.SignUp) "signup" else "oauth2/authorize") + "?" + query)
        } catch (error: URISyntaxException) {
            null
        }
    }

    /**
     * The code in the hosted UI's answer, [callback], as the browser hands it back: only at the
     * redirect URI, the answer without its query equal to it exactly, and only for [attempt], by its
     * state. Read with `java.net.URI`, since OkHttp's `HttpUrl` reads only http and https, each
     * query value percent-decoded with a `+` kept as it is, as iOS's `URLComponents` reads one.
     *
     * @throws SignInError.Refused with the answer's OAuth error, such as `access_denied`; with none
     *   for an answer elsewhere, for another attempt, with no code, or one `java.net.URI` can't read.
     */
    internal fun code(callback: String, attempt: Attempt): String {
        val answer =
            try {
                URI(callback)
            } catch (error: URISyntaxException) {
                throw SignInError.Refused(null)
            }
        val query = answer.rawQuery
        val items =
            query?.split('&').orEmpty().map { item ->
                val (name, value) = item.split('=', limit = 2).let { it[0] to it.getOrNull(1) }
                decoded(name) to value?.let(::decoded)
            }

        fun value(name: String): String? = items.firstOrNull { it.first == name }?.second
        val address = if (query == null) callback else callback.replaceFirst("?$query", "")
        if (address != redirectUri.toString() || value("state") != attempt.state) throw SignInError.Refused(null)
        value("error")?.let { throw SignInError.Refused(it) }
        return value("code")?.ifEmpty { null } ?: throw SignInError.Refused(null)
    }

    /** The hosted UI's [path], however many slashes the domain was set with. */
    internal fun endpoint(path: String): String = domain.toString().trimEnd('/') + "/" + path

    /**
     * The hosted UI's sign-out page, `/logout` (AN6e): it ends the hosted UI's session in the browser that opens it, then sends
     * that browser to [signOutUri], given with the client id, each escaped; to a sign-out URL the client doesn't allow, Cognito
     * sends it to its own sign-in page instead (the live check, 2026-11-13). None, never in practice: the domain is a URL and the
     * rest is escaped.
     */
    fun logoutUrl(): URI? =
        try {
            URI(endpoint("logout") + "?" + form(listOf("client_id" to clientId, "logout_uri" to signOutUri.toString())))
        } catch (error: URISyntaxException) {
            null
        }
}

/**
 * [raw] percent-decoded as UTF-8, a `+` kept as it is, as `URLComponents` reads a query value
 * (`URLDecoder` would make it a space); none when its escapes don't make UTF-8.
 */
private fun decoded(raw: String): String? {
    val parts = raw.split('%')
    var bytes = parts[0].encodeToByteArray()
    for (part in parts.drop(1)) {
        val hex = part.take(2).takeIf { it.length == 2 && it.all { char -> char in "0123456789ABCDEFabcdef" } }
        bytes += byteArrayOf((hex ?: return null).toInt(16).toByte()) + part.drop(2).encodeToByteArray()
    }
    return try {
        bytes.decodeToString(throwOnInvalidSequence = true)
    } catch (error: CharacterCodingException) {
        null
    }
}

/**
 * Which of the hosted UI's pages a sign-in opens (the approved Sign in & sign up design): its
 * sign-in page, or its sign-up page, the classic hosted UI's `/signup`, where a new account is
 * made, which then answers as the sign-in page does. BaliCore's `HostedPage`.
 */
enum class HostedPage { SignIn, SignUp }

/**
 * The phone's browser as [SignIn.signIn] uses it (AN6c, AN6f). [open] shows the hosted UI's page and returns where it sent the
 * student back, as text, as soon as it does, or throws why not: the student's close [SignInError.Cancelled], anything else
 * [SignInError.NotOpened]. Where that page's tab left Cognito's session in the browser, [signedOut], asked once the answer's code
 * has been traded, ends it on one more page and returns once that page came back, or throws why not:
 * [SignInError.BrowserNotSignedOut] closed first, [SignInError.NotOpened] one that couldn't open. Where no session was left, it
 * returns at once. iOS's browser is [open] alone: its sign-in is ephemeral, so nothing follows the answer there.
 */
interface Browser {
    suspend fun open(page: URI): String

    suspend fun signedOut() {}
}

/**
 * Who is signed in, as [SignIn.landings] says it (Q2): whether someone [signedIn] is, and their [account], the tokens'
 * `sub`; [count], how many sign-ins have landed in the sign-in's life, a renewal never one, so each sign-in is told
 * from the last, the same account's again included; and [deleted], the account deleted on Bali's server, its sign-in
 * kept for Cognito's DeleteUser ([SignIn.deletionPending]) while signed in, or forgotten for it ([SignIn.forgetDeleted]).
 */
data class Landing(val signedIn: Boolean, val account: String?, val count: Int, val deleted: Boolean = false)

/**
 * One sign-in attempt's secrets (RFC 7636): the verifier, which leaves the phone only for the token
 * endpoint, and the state, which binds the hosted UI's answer to this attempt. Not a data class, so
 * its `toString` shows neither. BaliCore's `Attempt`.
 */
internal class Attempt(val verifier: String = random(bytes = 32), val state: String = random(bytes = 16)) {
    /** base64url(SHA-256(verifier)), unpadded (§4.2). */
    val challenge: String get() = base64url(MessageDigest.getInstance("SHA-256").digest(verifier.encodeToByteArray()))
}

/**
 * [bytes] random bytes as base64url, from `SecureRandom`, never `kotlin.random`, as iOS takes them
 * from CryptoKit's generator: 32 of them make a 43-character verifier (§4.1).
 */
internal fun random(bytes: Int): String = base64url(ByteArray(bytes).also(secure::nextBytes))

private val secure = SecureRandom()

/** base64url, unpadded (RFC 4648 §5). */
internal fun base64url(data: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(data)

/** [fields] as a query or a form body, each value escaped as the API client escapes a path. */
internal fun form(fields: List<Pair<String, String>>): String =
    fields.joinToString("&") { (name, value) -> "$name=${escaped(value)}" }

/**
 * Why a sign-in didn't finish, for C1's screen, which says so and offers another try (rule 5); its
 * words are AN10's. BaliCore's `SignInError`. An outcome, not a fault: it keeps no stack trace and
 * takes no suppressed exception, so the cases with no value, one object each, stay as they were
 * however often they are thrown.
 */
sealed class SignInError : Exception(null, null, false, false) {
    /** The student closed the sign-in page: nothing changed. */
    data object Cancelled : SignInError()

    /**
     * The sign-in page couldn't open, or ended on its own: what the browser said, for the readout.
     * The app's browser tells the two apart (C1b): only its own cancel is [Cancelled].
     */
    data class NotOpened(val why: String) : SignInError()

    /** Cognito didn't answer: no network, a timeout, a server error. */
    data object Unreachable : SignInError()

    /** Cognito said no, its OAuth error, such as `access_denied`, or answered another attempt. */
    data class Refused(val error: String?) : SignInError()

    /** The phone couldn't keep the tokens (the store refused them): nothing changed. */
    data object NotKept : SignInError()

    /**
     * The sign-in page answered, but the browser it opened in, one that offers no ephemeral tab, wasn't signed out of the hosted
     * UI after it (AN6e): the page that ends that session closed before Cognito sent it back, the student's close or a page that
     * couldn't load. Nothing changed: the tokens its code was traded for are dropped (AN6f), and the next sign-in ends the
     * session again.
     */
    data object BrowserNotSignedOut : SignInError()
}

/**
 * What the sign-in keeps between launches, in the app's store (AN6c), in a form of its own
 * ([kept]): a key for each field, a field a later build adds read as none in tokens kept before
 * it, as iOS's optionals read them. Every field is asked for, none with a default, so no way of
 * making tokens can leave the email out unseen (#159's review). Its `toString` shows no token and
 * no email. BaliCore's `Tokens`.
 */
@Serializable
internal data class Tokens(
    val access: String,
    val refresh: String,
    /**
     * The account's email, as the ID token in the same answer named it (#147): whose sign-in this
     * is, for Me to say. None when it named none, and in tokens kept before it, until a renewal's
     * names one.
     */
    val email: String?,
    /**
     * Until when, by the phone's clock, the access token is given: its own lifetime from when it
     * came, less [MARGIN]. The lifetime is `exp` − `iat`, both the server's clock, so a phone clock
     * set wrong never makes a fresh token look expired, nor an expired one fresh (the server owns
     * the clock). One it can't read is no expiry the phone knows, [DISTANT_FUTURE]: the API
     * refusing the token renews it.
     */
    @Contextual val until: Instant,
    /**
     * The API has deleted the account and its Cognito sign-in waits to be (C4): no token goes to
     * the API from then on, and only Cognito's DeleteUser takes one. Kept through a renewal.
     */
    val deleted: Boolean?,
    /**
     * Whether this sign-in is through the 13+ check (C7-server): Bali's server holds its account's
     * yes, or the student answered 13 or older on this phone. Kept through a renewal and a relaunch,
     * forgotten with the tokens; none in tokens kept before it, checked as a new sign-in is.
     */
    val checked: Boolean?,
    /**
     * The yes Bali's server is still to record for this sign-in's account (`PUT
     * /v1/me/age-check`): the event id it goes under, until it is settled.
     */
    val yes: String?,
) {
    /** Tokens that came at [at], through no 13+ check yet. */
    constructor(access: String, refresh: String, email: String?, at: Instant) :
        this(access, refresh, email, givenUntil(access, at), deleted = null, checked = null, yes = null)

    /** These tokens as the store keeps them: JSON, none of a field with none. */
    val kept: ByteArray get() = BaliJson.encodeToString(serializer(), this).encodeToByteArray()

    override fun toString(): String = "Tokens(until=$until, deleted=$deleted, checked=$checked, yes=$yes)"

    companion object {
        /** How long before its expiry an access token stops being given, so one sent arrives in time. */
        val MARGIN: Duration = Duration.ofSeconds(60)

        /** No expiry the phone knows: Foundation's `distantFuture`. */
        val DISTANT_FUTURE: Instant = Instant.parse("4001-01-01T00:00:00Z")

        /** A token the API refused, never given again ([SignIn.refresh]): Foundation's `distantPast`. */
        val DISTANT_PAST: Instant = Instant.parse("0001-01-01T00:00:00Z")

        /** The tokens [kept] holds; none when it holds none this build can read: the student signs in again. */
        fun from(kept: ByteArray): Tokens? =
            try {
                BaliJson.decodeFromString(serializer(), kept.decodeToString(throwOnInvalidSequence = true))
            } catch (error: Exception) { // kotlinx's SerializationException, or a CharacterCodingException
                null
            }

        /**
         * `exp` − `iat` from [token]'s payload, unverified: the server verifies the token, and this
         * only says when to stop sending it. To the millisecond, never past what `Duration` holds.
         */
        fun lifetime(token: String): Duration? {
            val claims = claims(token) ?: return null
            val seconds = (claims.number("exp") ?: return null) - (claims.number("iat") ?: return null)
            return if (seconds.isFinite()) Duration.ofMillis((seconds * 1000).roundToLong()) else null
        }

        /** `sub` from [token]'s payload, unverified: only ever to tell one account from another. */
        fun subject(token: String): String? = claims(token)?.text("sub")

        /** Whether access token [token] is [account]'s, by its `sub` ([subject]): never for none. */
        fun isFor(token: String, account: String?): Boolean = account != null && subject(token) == account

        /** `email` from an ID token's payload, unverified: only ever shown, to say whose sign-in this is. */
        fun email(token: String): String? = claims(token)?.text("email")

        /**
         * Where the sign-in that gave access token [token] deletes itself (C4): Cognito's own
         * endpoint in its pool's region, read unverified from its issuer and taken only when that is
         * one, `cognito-idp.<region>.amazonaws.com`, so the token is sent nowhere else, while its
         * scopes hold the one DeleteUser needs. None otherwise: a sign-in made before the phone asked
         * for that scope, whose renewals keep the scopes it got.
         */
        fun deleteEndpoint(token: String): URI? {
            val claims = claims(token) ?: return null
            if (claims.text("scope")?.split(' ')?.contains(DELETE_SCOPE) != true) return null
            val issuer = claims.text("iss") ?: return null
            val host =
                try {
                    URI(issuer).host
                } catch (error: URISyntaxException) {
                    null
                }
            return if (host != null && cognitoIdp.matches(host)) URI("https://$host/") else null
        }

        private val cognitoIdp = Regex("cognito-idp\\.[a-z]{2}(-[a-z]+)+-[0-9]+\\.amazonaws\\.com")

        /** Until when access token [access], come at [at], is given ([until]). */
        private fun givenUntil(access: String, at: Instant): Instant =
            lifetime(access)?.let { at + it - MARGIN } ?: DISTANT_FUTURE

        /** [token]'s payload, its middle part, read unverified; none when it isn't a JSON object. */
        private fun claims(token: String): JsonObject? {
            val parts = token.split('.')
            if (parts.size != 3) return null
            val payload = parts[1].replace('-', '+').replace('_', '/')
            return try {
                val json = Base64.getDecoder().decode(payload + "=".repeat((4 - payload.length % 4) % 4))
                BaliJson.parseToJsonElement(json.decodeToString(throwOnInvalidSequence = true)) as? JsonObject
            } catch (error: Exception) { // not base64 (IllegalArgumentException), UTF-8 or JSON (kotlinx's)
                null
            }
        }

        /** The claim [name] when it is a JSON number. */
        private fun JsonObject.number(name: String): Double? =
            (get(name) as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull

        /** The claim [name] when it is a JSON string. */
        private fun JsonObject.text(name: String): String? =
            (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

/**
 * The student's sign-in on this phone, and the tokens it keeps (B4): the API client's [TokenProvider] and
 * the sync engine's [refresh]. The app has one. Only a real no signs anyone out: Cognito refusing the
 * refresh token. BaliCore's `SignIn`.
 *
 * Swift's actor is a lock no stretch takes twice ([alone]), held through each stretch Swift's runs without
 * an `await`, the store's calls included, and let go at each `await`: the browser, the token endpoint, a
 * renewal waited for, the engine told. A renewal is one coroutine in the app's [scope], which every caller
 * waits for ([renew]): a caller cancelled stops waiting, and it goes on for the others.
 */
class SignIn(
    /** Where it signs in: the app's browser catches the answer at its redirect URI (AN6c). */
    val cognito: Cognito,
    private val store: TokenStore,
    /** The app's, as long-lived as the process: one that ends ends every renewal for good. */
    scope: CoroutineScope,
    /** The token endpoint's transport: the API client's own, OkHttp's (AN3d). */
    private val transport: HttpTransport = OkHttpTransport(),
    private val now: () -> Instant = Instant::now,
    /** Whether Bali's API waits on the 13+ check (C7, [Tokens.checked]): by default, failing closed, where iOS's isn't. */
    private val gated: Boolean = true,
) : TokenProvider {
    /** The app's scope, under a job of the sign-in's own, so no renewal's failure ends anything else. */
    private val scope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val lock = Mutex()

    /** The tokens, once the store could be read ([loaded]); none when nobody is signed in. */
    private var tokens: Tokens? = null
    private var loaded = false

    /**
     * The store is behind [tokens] (it couldn't take them then, a rotated refresh token kept nowhere else,
     * or a sign-out), and catches up at the next ask. Ended before then, a refresh token Cognito refused
     * reads as signed in at the next launch, until its renewal is refused again: no queued record touched.
     */
    private var unsaved = false

    /** The renewal under way, which every caller shares. */
    private var renewing: Deferred<Boolean>? = null
    private var tokenArrived: (suspend () -> Unit)? = null
    private var deletionHeard: (suspend (String?) -> Unit)? = null

    /** Whether someone is signed in, once the store could be read: none until then. */
    private val known = MutableStateFlow<Boolean?>(null)

    /** Who is signed in, as each sign-in lands ([landings]): none until the store could be read. */
    private val landing = MutableStateFlow<Landing?>(null)

    /** How many sign-ins have landed in this sign-in's life ([Landing.count]): a renewal is never one. */
    private var landed = 0

    /** Runs [action] after every token but one [refresh] asked for, so the engine sends everything again at once. */
    suspend fun whenTokenArrives(action: suspend () -> Unit) = alone { tokenArrived = action }

    /**
     * Runs [action] with each account Bali's server says is deleted, heard by an [ApiClient] over this sign-in ([deletedOnServer]):
     * the engine's, which reads it as signed out (AN9j).
     */
    suspend fun whenDeletedOnServer(action: suspend (String?) -> Unit) = alone { deletionHeard = action }

    /** What an [ApiClient] heard ([TokenProvider.deletedOnServer]), told to [whenDeletedOnServer]'s action with the sign-in let go. */
    override suspend fun deletedOnServer(account: String?) {
        alone { deletionHeard }?.let { hook -> orElse(Unit) { hook(account) } }
    }

    /**
     * The access token to send now. None when nobody is signed in, the store can't be read right now, an
     * expired one couldn't be renewed (never a sign-out, never a token it knows has expired), the API has
     * deleted the account (C4), or, [gated], the sign-in isn't through the 13+ check: one made around the
     * question reaches Bali's API with nothing but the check's own read (the owner, 2026-10-06 and
     * 2026-10-08). It never throws, nor ends on a cancel of its own: the drain asks before every send.
     */
    override suspend fun accessToken(): String? = given(gate = gated)

    /**
     * [accessToken] for [account] alone, its `sub` as [account] read it (the owner, 2026-11-10: "Close it now"): none
     * while the sign-in held is another's, before a renewal and after it, and nothing renewed for it.
     */
    override suspend fun accessToken(account: String?): String? = given(gate = gated) { Tokens.isFor(it.access, account) }

    /** An account deletion's token, and the 13+ check's own read's (C7-server): [account]'s alone, the check passed or not. */
    override suspend fun deletionToken(account: String?): String? = given(gate = false) { Tokens.isFor(it.access, account) }

    /**
     * The engine's refresh, after the API refused the token it sent: never given again, after a relaunch
     * too, and a renewal tried: true once a fresh one is ready, false when only a sign-in can give one. It
     * never waits on the student, and never throws.
     */
    suspend fun refresh(): Boolean = refreshIf { true }

    /**
     * [refresh] for [account]'s sign-in alone: true once a fresh token of [account]'s is held; false while the sign-in
     * held is another's, nothing renewed or marked refused for it, and once a renewal leaves another's held.
     */
    suspend fun refresh(account: String?): Boolean =
        refreshIf { Tokens.isFor(it.access, account) } && alone { tokens?.let { Tokens.isFor(it.access, account) } == true }

    /** [refresh], while the tokens held are those [holds] takes. */
    private suspend fun refreshIf(holds: (Tokens) -> Boolean): Boolean {
        val renewal =
            alone {
                val held = current()?.takeIf(holds) ?: return@alone null
                tokens = held.copy(until = Tokens.DISTANT_PAST)
                unsaved = !keep(tokens)
                renew(telling = false)
            }
        return renewal != null && outcome(renewal)
    }

    /**
     * Signs the student in through Cognito's hosted UI, replacing any tokens the phone had. [browser] opens [page] and returns
     * where the hosted UI sent the student back, as text (AN6c), or throws why not ([Browser.open]). Its code is traded at once,
     * then the browser is signed out of the hosted UI where its tab left Cognito's session there ([Browser.signedOut], AN6f), and
     * only then are the tokens kept and the engine told: until that page came back they're kept nowhere, given to nobody, and a
     * browser not signed out drops them. That runs in the sign-in's scope: a caller cancelled after the browser answered stops
     * waiting, and it goes on. [yes], a Sign up's 13 or older (C7-server), keeps the tokens through the check with that yes's
     * event id before anything hears of them, so the account it made is never asked.
     *
     * @throws SignInError why it didn't finish; then nothing changed.
     */
    suspend fun signIn(page: HostedPage = HostedPage.SignIn, yes: String? = null, browser: Browser) {
        val attempt = Attempt()
        // It can't fail, the domain a URL and the rest escaped; were it to, nothing is sent.
        val url = cognito.authorizeUrl(attempt, page) ?: throw SignInError.Unreachable
        val answer = browser.open(url)
        scope.async { keepGrant(answer, attempt, yes, browser) }.await()
    }

    /** [signIn] through a browser that leaves no session behind, SignIn.swift's `signIn(_:yes:through:)`: an ephemeral tab's. */
    suspend fun signIn(page: HostedPage = HostedPage.SignIn, yes: String? = null, browser: suspend (URI) -> String) =
        signIn(page, yes, object : Browser { override suspend fun open(page: URI): String = browser(page) })

    /**
     * [answer]'s code and [attempt]'s verifier traded at once, then [browser] signed out of the hosted UI, so the tokens are
     * already given when Cognito's `/logout` ends that session (AN6f); only then kept with [yes], and the engine told. The session
     * is ended whether the trade worked or not, and where both fail the trade's failure is said, the one the student's next try
     * needs fixed. Tokens traded for a browser not signed out are dropped: kept nowhere, given to nobody, so nothing to revoke.
     */
    private suspend fun keepGrant(answer: String, attempt: Attempt, yes: String?, browser: Browser) {
        val traded = try { Result.success(traded(answer, attempt)) } catch (error: SignInError) { Result.failure(error) }
        val notSignedOut =
            try {
                browser.signedOut()
                null
            } catch (error: SignInError) {
                error
            }
        val given = traded.getOrThrow()
        notSignedOut?.let { throw it }
        val told =
            alone {
                val fresh = if (yes == null) given else given.copy(checked = true, yes = yes)
                if (!keep(fresh)) throw SignInError.NotKept
                adopt(fresh, lands = true)
                tokenArrived
            }
        told?.let { hook -> orElse(Unit) { hook() } }
    }

    /** The tokens [answer]'s code and [attempt]'s verifier are traded for at the token endpoint, as they came, or why not. */
    private suspend fun traded(answer: String, attempt: Attempt): Tokens {
        val fields =
            listOf(
                "grant_type" to "authorization_code", "client_id" to cognito.clientId, "code" to cognito.code(answer, attempt),
                "redirect_uri" to cognito.redirectUri.toString(), "code_verifier" to attempt.verifier,
            )
        val grant = exchange(fields).getOrThrow()
        return Tokens(grant.access, grant.refresh ?: throw SignInError.Refused(null), grant.email, now())
    }

    /**
     * The sign-in held now, if [account]'s, is through the 13+ check (C7-server), [recording] the event id
     * its yes is recorded under; the caller then sends what waited (`SyncEngine.retryNow`). True once it is;
     * false while the sign-in held is another's, or none.
     */
    suspend fun passed(account: String?, recording: String? = null): Boolean =
        alone {
            val held = current()?.takeIf { Tokens.subject(it.access) == account } ?: return@alone false
            tokens = held.copy(checked = true, yes = recording ?: held.yes)
            unsaved = !keep(tokens)
            true
        }

    /** Whether the sign-in kept now is through the 13+ check; false when nobody is signed in or the store can't be read. */
    suspend fun checked(): Boolean = alone { current()?.checked == true }

    /** The yes Bali's server is still to record for this sign-in's account, by its event id; none when none waits. */
    suspend fun yes(): String? = alone { current()?.yes }

    /** The yes Bali's server is still to record for [account], while the sign-in held is [account]'s; none else. */
    suspend fun yes(account: String?): String? = alone { current()?.takeIf { Tokens.isFor(it.access, account) }?.yes }

    /** The yes [eventId] names, settled (recorded, or refused for good), let go, while it is still this sign-in's. */
    suspend fun recorded(eventId: String) =
        alone {
            val held = current()?.takeIf { it.yes == eventId } ?: return@alone
            tokens = held.copy(yes = null)
            unsaved = !keep(tokens)
        }

    /**
     * Signs the student out of this phone, forgetting the tokens, never a queued record. Throws what the
     * store threw when it can't forget them right now; then nothing changed, and the screen says so (rule 5).
     */
    suspend fun signOut() =
        alone {
            store.clear()
            adopt(null)
        }

    /**
     * Forgets [account]'s sign-in, its `sub` as [account] read it, as [signOut] forgets it, once Bali's server said its account is
     * deleted (`409 account_deleted`, AN9j): while the sign-in held is [account]'s, never one this phone's own deletion keeps for
     * Cognito's DeleteUser ([deletionPending]), and with no DeleteUser of its own: the API's deleter removes it (C3-cognito). Said
     * as a landing that is [Landing.deleted]. True once forgotten. It never throws: a store that can't forget them now does at the
     * next ask, as a refused refresh token's sign-out.
     */
    suspend fun forgetDeleted(account: String?): Boolean =
        alone {
            current()?.takeIf { Tokens.isFor(it.access, account) && it.deleted != true } ?: return@alone false
            adopt(null, saved = keep(null), deleted = true)
            true
        }

    /** Whether this sign-in can delete its own account (C4, [Tokens.deleteEndpoint]); false: a fresh sign-in first. */
    suspend fun mayDelete(): Boolean = alone { current()?.let { Tokens.deleteEndpoint(it.access) } != null }

    /**
     * The API has deleted [account]'s account (C4), its `sub` as [account] read it: while the sign-in held is
     * that account's, no token goes to the API from now on, a relaunch's included, until Cognito's DeleteUser
     * ([deleteUser]) or a sign-out; a store that can't take it now, at the next ask. Another's is left as it is.
     * Said as a landing that is [Landing.deleted], so the account follows it in the run as a relaunch reads it
     * (AN9j). True once marked; false for another's, none, or one marked already.
     */
    suspend fun accountDeleted(account: String?): Boolean =
        alone {
            val held = current()?.takeIf { Tokens.subject(it.access) == account && it.deleted != true } ?: return@alone false
            val marked = held.copy(deleted = true)
            adopt(marked, saved = keep(marked))
            true
        }

    /** Whether the API has deleted this sign-in's account and its Cognito sign-in waits to be (C4). */
    suspend fun deletionPending(): Boolean = alone { current()?.deleted == true }

    /**
     * Cognito's DeleteUser (C4) for [account], its `sub` as [account] read it: the sign-in deletes itself with
     * its own access token at its pool's endpoint ([Tokens.deleteEndpoint]), no AWS credential, as the API holds
     * none. Deleted, or a user Cognito no longer has, the tokens are forgotten as a sign-out forgets them, and
     * the answer is none; else what Cognito answered, the tokens kept to try again. An expired token is renewed
     * first, and so, once, is one Cognito says it no longer takes: a sign-in it then refuses for good, deleted by
     * a try whose answer never came, is forgotten by that renewal, and gone too. Only [account]'s sign-in, held as
     * it begins, is ever sent, by its refresh token from then on, before a renewal and after it, where iOS's sends
     * whatever tokens there are then: none of [account]'s held as it begins, nothing of it is left here to
     * delete, what Cognito keeps of it the server's (C3-cognito), and the answer is none; another landed
     * meanwhile is no answer, its tokens kept (Q4). It runs in the sign-in's scope, as a sign-in's exchange does:
     * a caller cancelled stops waiting, and it goes on. It never throws, nor ends on a cancel of its own: a scope
     * that has ended is no answer.
     */
    suspend fun deleteUser(account: String?): SendResult? = orElse(SendResult.NetworkError) { scope.async { deletion(account) }.await() }

    private suspend fun deletion(account: String?): SendResult? {
        var own: String? = null // the refresh token of the sign-in it deletes, [account]'s as it began
        var refusedOnce = false // Cognito no longer took its token: renewed, and tried once more
        while (true) {
            val (held, renewal) =
                alone {
                    val held = current()?.takeIf { if (own == null) Tokens.subject(it.access) == account else it.refresh == own }
                    held to held?.takeIf { refusedOnce || now() >= it.until }?.let { renew(telling = false) }
                }
            own = own ?: held?.refresh
            val access =
                when {
                    held == null -> null
                    renewal == null -> held.access
                    outcome(renewal) -> alone { tokens?.takeIf { it.refresh == own }?.access }
                    else -> null
                }
            val endpoint = access?.let(Tokens::deleteEndpoint)
            // None of [account]'s held as it began, or nobody signed in now, a renewal's no among them: nothing
            // left here to delete. Else kept, to try again.
            if (access == null || endpoint == null) return alone { if (loaded && (own == null || tokens == null)) null else SendResult.NetworkError }
            val (result, type) = deleteUser(access, endpoint)
            when {
                (result as? SendResult.Status)?.code in 200..299 || type == "UserNotFoundException" -> {
                    alone { adopt(null, saved = keep(null)) }
                    return null
                }
                type == "NotAuthorizedException" && !refusedOnce -> refusedOnce = true
                else -> return result
            }
        }
    }

    /**
     * One DeleteUser call with [access] at [endpoint], in Cognito's JSON protocol: its status, or no answer, and
     * its error's type, `__type` read past any namespace.
     */
    private suspend fun deleteUser(access: String, endpoint: URI): Pair<SendResult, String?> {
        val headers = mapOf("Content-Type" to "application/x-amz-json-1.1", "X-Amz-Target" to "AWSCognitoIdentityProviderService.DeleteUser")
        val body = JsonObject(mapOf("AccessToken" to JsonPrimitive(access))).toString().encodeToByteArray()
        val request = HttpRequest("POST", endpoint, headers, body, ApiClient.REQUEST_TIMEOUT)
        val reply = orElse(null) { transport.send(request) } ?: return SendResult.NetworkError to null
        val failure =
            try {
                BaliJson.parseToJsonElement(reply.body.decodeToString(throwOnInvalidSequence = true)) as? JsonObject
            } catch (error: Exception) { // not UTF-8, or not JSON: no type
                null
            }
        val type = (failure?.get("__type") as? JsonPrimitive)?.takeIf { it.isString }?.content
        return SendResult.Status(reply.status) to type?.substringAfterLast('#')
    }

    /**
     * Whether someone is signed in: now, once the store could be read, then at each change, the newest only.
     * A token that can't be given right now (offline, the store unreadable) is still signed in. A sign-in landing
     * over another changes nothing here: [landings] says each.
     */
    suspend fun signedIn(): Flow<Boolean> {
        alone { current() }
        return known.filterNotNull()
    }

    /**
     * Who is signed in, said as each sign-in lands (Q2): now, once the store could be read, then at each change, the
     * newest only: a sign-in that lands, over another account's or its own, a sign-out, and the sign-in gone (deleted
     * from Cognito, or its refresh token refused for good); never a renewal, which keeps the account and the count.
     * iOS's stream yields at every sign-in, which its `Phone` reads the account at; [signedIn]'s, which says changes
     * alone, would let a sign-in over another go by.
     */
    suspend fun landings(): Flow<Landing> {
        alone { current() }
        return landing.filterNotNull()
    }

    /** Who is signed in: the tokens' `sub`, read unverified, only ever to tell one student from another (C6b). */
    suspend fun account(): String? = alone { current()?.let { Tokens.subject(it.access) } }

    /** The account's email, as the tokens name it (#147): whose sign-in this is, which Me says. */
    suspend fun email(): String? = alone { current()?.email }

    /**
     * The access token, renewed first when it has expired; none once the API deleted the account or, [gate],
     * while not through the 13+ check, or while the tokens aren't those [holds] takes, the tokens a renewal
     * leaves held to all that too, where iOS's gives them.
     */
    private suspend fun given(gate: Boolean, holds: (Tokens) -> Boolean = { true }): String? {
        fun Tokens.given() = deleted != true && (!gate || checked == true) && holds(this)
        val (token, renewal) =
            alone {
                val held = current()?.takeIf { it.given() }
                when {
                    held == null -> null to null
                    now() < held.until -> held.access to null
                    else -> null to renew(telling = true)
                }
            }
        return when {
            renewal == null -> token
            outcome(renewal) -> alone { tokens?.takeIf { it.given() }?.access }
            else -> null
        }
    }

    /**
     * The tokens, read from the store the first time it can be: one that can't be read right now is read
     * again next time, never a sign-out. Tokens this build can't read are none: the student signs in again.
     */
    private fun current(): Tokens? {
        if (loaded) {
            if (unsaved) unsaved = !keep(tokens)
            return tokens
        }
        val stored = try { store.load() } catch (error: Exception) { return null }
        adopt(stored?.let(Tokens::from))
        return tokens
    }

    /**
     * The phone's tokens from now on, none signed out, told to every watcher; [saved] when the store has them too, [lands]
     * when they are a sign-in's that just landed, never a renewal's ([Landing.count]), and [deleted] when none are, forgotten
     * for their account's deletion ([Landing.deleted], which tokens marked deleted say too).
     */
    private fun adopt(tokens: Tokens?, saved: Boolean = true, lands: Boolean = false, deleted: Boolean = false) {
        this.tokens = tokens
        loaded = true
        unsaved = !saved
        known.value = tokens != null
        if (lands) landed += 1
        landing.value = Landing(tokens != null, tokens?.let { Tokens.subject(it.access) }, landed, deleted || tokens?.deleted == true)
    }

    /** Whether the store now holds [tokens]; none forgets what it had. */
    private fun keep(tokens: Tokens?): Boolean =
        try {
            if (tokens == null) store.clear() else store.save(tokens.kept)
            true
        } catch (error: Exception) {
            false
        }

    /**
     * A renewal with the refresh token, one at a time, which every caller shares, [telling] the engine of
     * its token unless [refresh] asked: started once it is the one under way, in [scope], never a caller's,
     * and let go of as it ends, the one there is, since none starts while one is.
     */
    private fun renew(telling: Boolean): Deferred<Boolean> =
        renewing ?: scope.async(start = CoroutineStart.LAZY) {
            try {
                renewal(telling)
            } finally {
                alone { renewing = null }
            }
        }.also {
            renewing = it
            it.start()
        }

    private suspend fun renewal(telling: Boolean): Boolean {
        val refresh = alone { tokens?.refresh } ?: return false
        val answer = exchange(listOf("grant_type" to "refresh_token", "client_id" to cognito.clientId, "refresh_token" to refresh))
        val (renewed, told) =
            alone {
                // Signed out, or in again, while it ran: the answer is about tokens the phone let go.
                val held = tokens?.takeIf { it.refresh == refresh } ?: return@alone (tokens != null) to null
                val grant = answer.getOrNull()
                when {
                    // A rotated refresh token replaces the one kept; an answer with no email keeps the
                    // account's; an account the API deleted stays deleted (C4).
                    grant != null -> {
                        val fresh =
                            Tokens(grant.access, grant.refresh ?: refresh, grant.email ?: held.email, now())
                                .copy(deleted = held.deleted, checked = held.checked, yes = held.yes)
                        adopt(fresh, saved = keep(fresh))
                        true to tokenArrived.takeIf { telling }
                    }
                    // The one real no: Cognito refused the refresh token. Signed out, and nothing else: every
                    // queued record waits for the next sign-in.
                    answer.exceptionOrNull() == SignInError.Refused("invalid_grant") -> {
                        adopt(null, saved = keep(null))
                        false to null
                    }
                    // No answer, a server error, another refusal: no no. Kept, for the next request to try.
                    else -> false to null
                }
            }
        told?.let { hook -> orElse(Unit) { hook() } }
        return renewed
    }

    /**
     * The token endpoint's answer to [fields] (RFC 6749 §4.1.3, §6): the tokens and the ID token's email
     * (#147) on a 2xx, a refusal with its OAuth error on a 4xx, and no answer otherwise (a 5xx, a redirect).
     */
    private suspend fun exchange(fields: List<Pair<String, String>>): Result<Grant> {
        val unreachable = Result.failure<Grant>(SignInError.Unreachable)
        val url = try { URI(cognito.endpoint("oauth2/token")) } catch (error: URISyntaxException) { return unreachable }
        val headers = mapOf("Content-Type" to "application/x-www-form-urlencoded")
        val request = HttpRequest("POST", url, headers, form(fields).encodeToByteArray(), ApiClient.REQUEST_TIMEOUT)
        val reply = orElse(null) { transport.send(request) } ?: return unreachable
        val answer =
            try {
                BaliJson.decodeFromString(TokenAnswer.serializer(), reply.body.decodeToString(throwOnInvalidSequence = true))
            } catch (error: Exception) { // kotlinx's SerializationException, or a CharacterCodingException
                null
            }
        val (access, error) = answer?.accessToken to answer?.error
        return when {
            reply.status in 200..299 && access != null -> Result.success(Grant(access, answer?.refreshToken, answer?.idToken?.let(Tokens::email)))
            reply.status in 400..499 && error != null -> Result.failure(SignInError.Refused(error))
            else -> unreachable
        }
    }

    /** What [renewal] gave, waited for with the sign-in let go: false when it failed, never a throw. */
    private suspend fun outcome(renewal: Deferred<Boolean>): Boolean = orElse(false) { renewal.await() }

    /** What [block] gives, or [none] when it throws or ends in a cancel of its own, as Swift's `try?`: a caller's own goes on. */
    private suspend fun <T> orElse(none: T, block: suspend () -> T): T =
        try {
            block()
        } catch (cancelled: CancellationException) {
            currentCoroutineContext().ensureActive()
            none
        } catch (error: Exception) {
            none
        }

    /**
     * Runs [block] with the sign-in to itself, a stretch of Swift's actor: never inside another (the lock is
     * no reentrant one), on `Dispatchers.IO`, since the store's calls block, and whole however its caller is
     * cancelled, as the engine's stretches are. It can't suspend, so nothing interleaves inside it.
     */
    private suspend fun <T> alone(block: () -> T): T = withContext(NonCancellable + Dispatchers.IO) { lock.withLock { block() } }
}

/** The token endpoint's grant: the access token, the refresh token when it gave one, and its ID token's email. */
private class Grant(val access: String, val refresh: String?, val email: String?)

/** What the token endpoint answers, as far as the phone reads it: a field of another type is no answer at all. */
@Serializable
private class TokenAnswer(
    @SerialName("access_token") val accessToken: String?,
    @SerialName("refresh_token") val refreshToken: String?,
    @SerialName("id_token") val idToken: String?,
    val error: String?,
)
