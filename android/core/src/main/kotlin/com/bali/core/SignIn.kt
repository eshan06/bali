package com.bali.core

import java.net.URI
import java.net.URISyntaxException
import java.nio.charset.CharacterCodingException
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import kotlin.math.roundToLong
import kotlinx.serialization.Contextual
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
    /** Where the hosted UI sends its answer, `bali://auth/callback`, which the app's browser catches. */
    val redirectUri: URI,
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
 * words are AN10's. BaliCore's `SignInError`.
 */
sealed class SignInError : Exception() {
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
