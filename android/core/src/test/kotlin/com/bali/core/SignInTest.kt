package com.bali.core

import java.net.URI
import java.time.Duration
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// B4's parts, SignInTests.swift's that need no `SignIn` (AN6a): PKCE, the hosted UI's address, the
// code in its answer, and the tokens' kept form and claims. The tests that need `SignIn` itself are
// AN6b's (docs/PLAN-ANDROID.md).

private val cognito =
    Cognito(URI("https://bali-dev.auth.us-east-1.amazoncognito.com"), "phone-client", URI("bali://auth/callback"))
private const val TOKEN_ENDPOINT = "https://bali-dev.auth.us-east-1.amazoncognito.com/oauth2/token"

/** RFC 7636's own example (appendix B). */
private const val RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
private const val RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

/** The phone's clock: 2026, while the tokens' own claims are the server's, in 2001. */
private val t0 = Instant.ofEpochSecond(1_790_000_000)

/** A token whose payload is [payload], unsigned: the phone never checks the signature. */
private fun token(payload: String) = "eyJhbGciOiJSUzI1NiJ9.${base64url(payload.encodeToByteArray())}.signature"

/** An access token as Cognito's reads on the phone: a payload with `iat` and `exp`. */
private fun jwt(name: String, lifetime: Long = 3600) =
    token("""{"sub":"$name","iat":1000000000,"exp":${1_000_000_000 + lifetime}}""")

/** An access token from a sign-in that asked for the scope DeleteUser needs, its pool's [issuer] (DeleteUserTests' `admin`). */
private fun admin(name: String, issuer: String = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YTloqilwT") =
    token(
        """{"sub":"$name","iat":1000000000,"exp":1000003600,""" +
            """"scope":"openid email profile aws.cognito.signin.user.admin","iss":"$issuer"}""",
    )

/** Signing in: PKCE, the hosted UI's address and the code in its answer (B4). */
class SignInTest {
    @Test
    fun theS256ChallengeIsRfc7636sOwnExample() {
        assertEquals(RFC_CHALLENGE, Attempt(verifier = RFC_VERIFIER, state = "s").challenge)
    }

    @Test
    fun theAppReadsWhereTheHostedUiAnswersAsItsBrowserNeedsIt() {
        // iOS's `redirect` reads it without an actor's hop; Kotlin has none to make, so here it is what
        // the app's browser catches the answer by (AN6c), read as java.net.URI reads a bali: link.
        assertEquals(listOf("bali", "auth", "/callback"), cognito.redirectUri.let { listOf(it.scheme, it.host, it.path) })
    }

    @Test
    fun everyAttemptsVerifierAndStateAreFreshUrlSafeLongEnoughAndNeverInItsToString() {
        val attempts = List(50) { Attempt() }
        assertEquals(50, attempts.map { it.verifier }.toSet().size)
        assertEquals(50, attempts.map { it.state }.toSet().size)
        val (one) = attempts
        val urlSafe = Regex("[A-Za-z0-9_-]+")
        for (value in listOf(one.verifier, one.state)) assertTrue(urlSafe.matches(value), value)
        assertEquals(43, one.verifier.length) // 32 random bytes: RFC 7636's minimum is 43 characters
        assertEquals(22, one.state.length)
        assertFalse(one.verifier in one.toString() || one.state in one.toString(), one.toString())
    }

    @Test
    fun theHostedUisSignInPageCarriesTheChallengeAndTheStateNeverTheVerifierAndAsksForTheScopeDeleteUserNeeds() {
        val url = assertNotNull(cognito.authorizeUrl(Attempt(verifier = RFC_VERIFIER, state = "st")))
        assertEquals(
            "https://bali-dev.auth.us-east-1.amazoncognito.com/oauth2/authorize" +
                "?response_type=code&client_id=phone-client" +
                "&redirect_uri=bali%3A%2F%2Fauth%2Fcallback" +
                "&scope=openid%20email%20profile%20aws%2Ecognito%2Esignin%2Euser%2Eadmin" +
                "&state=st&code_challenge=$RFC_CHALLENGE&code_challenge_method=S256",
            url.toString(),
        )
        assertFalse(RFC_VERIFIER in url.toString())
        // The sign-up page (the approved Sign in & sign up design): the classic hosted UI's own, given
        // the sign-in page's parameters as they are, so it answers at the same redirect.
        val signUp = assertNotNull(cognito.authorizeUrl(Attempt(verifier = RFC_VERIFIER, state = "st"), HostedPage.SignUp))
        assertEquals(url.toString().replace("/oauth2/authorize?", "/signup?"), signUp.toString())
        assertEquals("/signup", signUp.path)
        // A domain set with a trailing slash names the same endpoints.
        val slashed = cognito.copy(domain = URI("https://bali-dev.auth.us-east-1.amazoncognito.com/"))
        assertEquals(TOKEN_ENDPOINT, slashed.endpoint("oauth2/token"))
        assertEquals(TOKEN_ENDPOINT, cognito.endpoint("oauth2/token"))
    }

    @Test
    fun theAnswersCodeIsTakenOnlyAtTheRedirectUriForThisAttemptWithNoError() {
        val attempt = Attempt(verifier = RFC_VERIFIER, state = "st")
        assertEquals("c0de", cognito.code("bali://auth/callback?code=c0de&state=st", attempt))
        val no = assertFailsWith<SignInError> { cognito.code("bali://auth/callback?error=access_denied&state=st", attempt) }
        assertEquals(SignInError.Refused("access_denied"), no)
        for (other in listOf(
            "bali://auth/callback?code=c0de&state=another-attempt",
            "bali://auth/callback?code=c0de",
            "bali://auth/elsewhere?code=c0de&state=st",
            "evil://auth/callback?code=c0de&state=st",
            "bali://auth/callback?state=st",
            "bali://auth/callback?code=&state=st",
        )) {
            val refused = assertFailsWith<SignInError>(other) { cognito.code(other, attempt) }
            assertEquals(SignInError.Refused(null), refused, other)
            // No code or state in what is said of it.
            assertNull(refused.message, other)
            assertFalse("c0de" in refused.toString(), refused.toString())
        }
    }

    @Test
    fun theAnswerIsReadAsUrlComponentsReadsItEachValueDecodedAfterTheSplitItsPlusKeptTheFirstOfANameTaken() {
        val attempt = Attempt(verifier = RFC_VERIFIER, state = "st")
        fun code(answer: String) = cognito.code(answer, attempt)
        assertEquals("a+b", code("bali://auth/callback?code=a+b&state=st")) // URLDecoder would make it "a b"
        assertEquals("a b+c", code("bali://auth/callback?code=a%20b%2Bc&state=st"))
        assertEquals("a&b=c", code("bali://auth/callback?code=a%26b%3Dc&state=s%74"))
        assertEquals("é", code("bali://auth/callback?code=%C3%A9&state=st"))
        assertEquals("c0de", code("bali://auth/callback?state=st&code=c0de&code=other&state=another-attempt"))
        // An error with no value is none; one with an empty value is Cognito's no all the same.
        assertEquals("c0de", code("bali://auth/callback?error&state=st&code=c0de"))
        assertEquals(SignInError.Refused(""), assertFailsWith<SignInError> { code("bali://auth/callback?error=&code=c0de&state=st") })
        for (other in listOf(
            "bali://auth/callback?code=c0de&state=st#more", // the answer without its query is not the redirect URI
            "bali://auth/callback/?code=c0de&state=st",
            "BALI://auth/callback?code=c0de&state=st",
            "bali:auth/callback?code=c0de&state=st", // no "//": java.net.URI reads it whole, no query
            "bali://auth/callback?code=c0de&state=s%FF", // an escape that makes no UTF-8: no state
            "bali://auth/callback?code=c0de&state=%zz", // java.net.URI can't read a broken escape
            "bali://auth/callback?code=c0de&state=st&x=a b", // nor a space, which iOS 17's URL escapes
            "",
        )) {
            assertEquals(SignInError.Refused(null), assertFailsWith<SignInError>(other) { code(other) }, other)
        }
    }
}

/** The tokens: their claims, read unverified, and the form they are kept in (B4). */
class TokensTest {
    @Test
    fun theAccessTokenIsGivenUntilAMinuteBeforeItsOwnLifetimeEndsWhateverThePhonesClock() {
        assertEquals(Duration.ofSeconds(3600), Tokens.lifetime(jwt("a1")))
        assertEquals(t0.plusSeconds(3600 - 60), Tokens(jwt("a1"), "refresh-1", null, at = t0).until)
        assertEquals(t0.plusSeconds(300 - 60), Tokens(jwt("a1", lifetime = 300), "refresh-1", null, at = t0).until)
        // To the millisecond: a JWT's times may have a fraction.
        assertEquals(Duration.ofMillis(3_599_750), Tokens.lifetime(token("""{"iat":1000000000.5,"exp":1000003600.25}""")))
        // Through no 13+ check yet, and no account deleted.
        val fresh = Tokens(jwt("a1"), "refresh-1", "ana@bali.test", at = t0)
        assertEquals(listOf(null, null, null), listOf(fresh.deleted, fresh.checked, fresh.yes))
        assertEquals("ana@bali.test", fresh.email)
    }

    @Test
    fun aTokenWhoseLifetimeCantBeReadHasNoExpiryThePhoneKnowsAndNoneEverCrashes() {
        for (unread in listOf(
            "opaque", "a.b", "a.b.c.d", "", "x.%%%.y", "x..y", // not three parts, or no base64 between
            token("not json"), token("[1,2]"), token("{}"), token("""{"iat":1000000000}"""),
            token("""{"iat":"1000000000","exp":"1000003600"}"""), // strings, not numbers
            token("""{"iat":null,"exp":1000003600}"""), token("""{"iat":true,"exp":1000003600}"""),
            token("""{"iat":0,"exp":1e400}"""), // past a Double
            "eyJ9.${base64url(byteArrayOf(-1, -2, -3))}.signature", // not UTF-8
        )) {
            assertNull(Tokens.lifetime(unread), unread)
            assertEquals(Tokens.DISTANT_FUTURE, Tokens(unread, "refresh-1", null, at = t0).until, unread)
        }
        // A lifetime past what a Duration holds stops there, and one that ends before it began has
        // ended: each kept and read back as it was.
        for (lifetime in listOf(Long.MAX_VALUE, Long.MIN_VALUE)) {
            val payload = if (lifetime > 0) """{"iat":0,"exp":1e300}""" else """{"iat":1e300,"exp":0}"""
            assertEquals(Duration.ofMillis(lifetime), Tokens.lifetime(token(payload)))
            val tokens = Tokens(token(payload), "refresh-1", null, at = t0)
            assertEquals(tokens, Tokens.from(tokens.kept), tokens.kept.decodeToString())
        }
        assertTrue(Tokens(token("""{"iat":1000003600,"exp":1000000000}"""), "refresh-1", null, at = t0).until < t0)
    }

    @Test
    fun whoIsSignedInIsTheAccountTheTokensAreForAndNoneForTokensThatNameNone() {
        assertEquals("a1", Tokens.subject(jwt("a1")))
        for (unread in listOf("not-a-jwt", token("{}"), token("""{"sub":42}"""), token("""{"sub":null}"""))) {
            assertNull(Tokens.subject(unread), unread)
        }
    }

    @Test
    fun whoseSignInThisIsTheAccountsEmailAsCognitosIdTokenNamesItOrNone() {
        assertEquals("ana@bali.test", Tokens.email(token("""{"sub":"s","email":"ana@bali.test","token_use":"id"}""")))
        assertNull(Tokens.email(token("""{"sub":"s"}""")))
        assertNull(Tokens.email(token("""{"sub":"s","email":["ana@bali.test"]}""")))
        assertNull(Tokens.email("not-a-jwt"))
    }

    @Test
    fun aTokenCarryingTheScopeDeleteUserNeedsFromACognitoPoolMayDeleteItselfAnotherIssuersOrNoneMayNot() {
        assertEquals(URI("https://cognito-idp.us-east-1.amazonaws.com/"), Tokens.deleteEndpoint(admin("a1")))
        assertEquals(
            URI("https://cognito-idp.eu-west-2.amazonaws.com/"),
            Tokens.deleteEndpoint(admin("a1", "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_x")),
        )
        assertNull(Tokens.deleteEndpoint(jwt("a1"))) // a sign-in from before the phone asked for the scope
        for (issuer in listOf(
            "https://cognito-idp.us-east-1.example.com/us-east-1_x",
            "https://cognito-idp.bucket.s3.amazonaws.com/us-east-1_x",
            "https://cognito-idp.s3.amazonaws.com/us-east-1_x", // a bucket named cognito-idp
            "https://cognito-idp.us-east-1.amazonaws.com.evil.test/us-east-1_x",
            "https://evil.test/cognito-idp.us-east-1.amazonaws.com",
            "https://COGNITO-IDP.US-EAST-1.AMAZONAWS.COM/us-east-1_x",
            "cognito-idp.us-east-1.amazonaws.com", // no scheme: a path, no host
        )) {
            assertNull(Tokens.deleteEndpoint(admin("a1", issuer)), issuer)
        }
        // The scope whole, never inside another; and an issuer to send it to.
        val pool = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x"
        assertNull(Tokens.deleteEndpoint(token("""{"scope":"openid aws.cognito.signin.user.admin2","iss":"$pool"}""")))
        assertNull(Tokens.deleteEndpoint(token("""{"iss":"$pool"}""")))
        assertNull(Tokens.deleteEndpoint(token("""{"scope":"aws.cognito.signin.user.admin"}""")))
        assertNull(Tokens.deleteEndpoint("not-a-jwt"))
    }

    @Test
    fun theTokensAreKeptInAFormOfTheirOwnAKeyForEachFieldNoneForAFieldWithNoneAndReadBackAsTheyWere() {
        val tokens = Tokens(jwt("a1"), "refresh-1", "ana@bali.test", t0, deleted = true, checked = true, yes = "y1")
        assertEquals(
            """{"access":"${jwt("a1")}","refresh":"refresh-1","email":"ana@bali.test",""" +
                """"until":"2026-09-21T14:13:20.000Z","deleted":true,"checked":true,"yes":"y1"}""",
            tokens.kept.decodeToString(),
        )
        assertEquals(tokens, Tokens.from(tokens.kept))
        val fresh = Tokens(jwt("a1"), "refresh-1", null, at = t0)
        assertEquals(
            """{"access":"${jwt("a1")}","refresh":"refresh-1","until":"2026-09-21T15:12:20.000Z"}""",
            fresh.kept.decodeToString(),
        )
        assertEquals(fresh, Tokens.from(fresh.kept))
        // No expiry the phone knows, kept as such.
        val unread = Tokens("opaque", "refresh-1", null, at = t0)
        assertTrue(""""until":"4001-01-01T00:00:00.000Z"""" in unread.kept.decodeToString())
        assertEquals(unread, Tokens.from(unread.kept))
    }

    @Test
    fun tokensKeptBeforeAFieldExistedStillReadThatFieldNoneAndAKeyALaterBuildAddsIsPassedOver() {
        val earlier = Tokens.from("""{"access":"a","refresh":"r","until":"2026-09-21T14:13:20Z"}""".encodeToByteArray())
        assertEquals(Tokens("a", "r", null, t0, deleted = null, checked = null, yes = null), earlier)
        val later = """{"access":"a","refresh":"r","until":"2026-09-21T14:13:20.000Z","pushedAt":"later"}"""
        assertEquals(earlier, Tokens.from(later.encodeToByteArray()))
    }

    @Test
    fun keptTokensThisBuildCantReadAreNoneSoTheStudentSignsInAgainAndNoneEverCrashes() {
        val until = "\"until\":\"2026-09-21T14:13:20Z\""
        for (kept in listOf(
            "", "not json", "[]", "{}", "null",
            """{"refresh":"r",$until}""", """{"access":"a",$until}""", """{"access":"a","refresh":"r"}""",
            """{"access":"a","refresh":"r","until":"tomorrow"}""", """{"access":"a","refresh":"r","until":1790000000}""",
            """{"access":"a","refresh":"r",$until,"checked":"yes"}""", """{"access":null,"refresh":"r",$until}""",
        )) {
            assertNull(Tokens.from(kept.encodeToByteArray()), kept)
        }
        assertNull(Tokens.from(byteArrayOf(-1, -2, -3))) // not UTF-8
    }

    @Test
    fun everyWayOfMakingTokensAsksForTheEmailWithNoDefaultSoNoneCanLeaveItOutUnseen() {
        // #159's review, SignInTests.swift's `emailNoDefault`, read from what was built rather than its
        // source: Kotlin builds a constructor with a default into a twin that takes a
        // `DefaultConstructorMarker`, so with none every constructor asks for every field.
        val constructors = Tokens::class.java.declaredConstructors.map { constructor -> constructor.parameterTypes.map { it.name } }
        assertTrue(listOf("java.lang.String", "java.lang.String", "java.lang.String", "java.time.Instant") in constructors)
        for (parameters in constructors) {
            assertFalse("kotlin.jvm.internal.DefaultConstructorMarker" in parameters, parameters.toString())
        }
    }

    @Test
    fun noTokenAndNoEmailInTheTokensToString() {
        val shown = Tokens(jwt("a1"), "refresh-1", "ana@bali.test", at = t0).toString()
        for (secret in listOf(jwt("a1"), "refresh-1", "ana@bali.test")) assertFalse(secret in shown, shown)
    }
}
