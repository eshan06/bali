package com.bali.core

import java.net.URI
import java.net.UnknownHostException
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Headers.Companion.headersOf

// B4, SignInTests.swift: PKCE, the hosted UI's address, the code in its answer and the token endpoint,
// and the tokens' kept form and claims, read directly where iOS's tests read them through `SignIn`.

/** RFC 7636's own example (appendix B). */
private const val RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
private const val RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

/** Signing in: PKCE, the hosted UI's address, the code in its answer and the token endpoint (B4). */
class SignInTest : SignIns() {
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
    fun theHostedUisSignOutPageNamesTheClientAndItsSignOutUrlEachEscapedAtTheDomainsLogout() {
        // AN6e: the page that ends the hosted UI's session in a browser with no ephemeral tab, Cognito's /logout, which sends
        // that browser on to the sign-out URL given with the client id, where the client allows it.
        assertEquals(
            URI("https://bali-dev.auth.us-east-1.amazoncognito.com/logout?client_id=phone-client&logout_uri=bali%3A%2F%2Fauth%2Fsignout"),
            cognito.logoutUrl(),
        )
        // Each value escaped as the sign-in page's are, and a domain set with a trailing slash names the same endpoint.
        val odd =
            cognito.copy(
                domain = URI("https://bali-dev.auth.us-east-1.amazoncognito.com/"), clientId = "a b&c=d+e",
                signOutUri = URI("com.bali.bali://auth/signout?x=1"),
            )
        assertEquals(
            URI(
                "https://bali-dev.auth.us-east-1.amazoncognito.com/logout?client_id=a%20b%26c%3Dd%2Be" +
                    "&logout_uri=com%2Ebali%2Ebali%3A%2F%2Fauth%2Fsignout%3Fx%3D1",
            ),
            odd.logoutUrl(),
        )
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
            "bali://elsewhere/callback?code=c0de&state=st",
            "bali://auth/callback/more?code=c0de&state=st",
            "bali:/auth/callback?code=c0de&state=st", // one slash, for a redirect with two (Android's, AN6d)
            "evil://auth/callback?code=c0de&state=st",
            "bali://auth/callback?state=st",
            "bali://auth/callback?code=&state=st",
            // Another attempt's error, or one with no state: no word of Cognito's, as any app can send one.
            "bali://auth/callback?error=access_denied&state=another-attempt",
            "bali://auth/callback?error=access_denied",
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

    @Test
    fun aSignInErrorIsAnOutcomeThatKeepsNoStackTraceAndTakesNoSuppressedExceptionThrowOneOftenAsYouLike() {
        for (error in listOf(SignInError.Cancelled, SignInError.Unreachable, SignInError.NotKept, SignInError.Refused(null), SignInError.BrowserNotSignedOut)) {
            repeat(2) { error.addSuppressed(IllegalStateException("another failure")) }
            assertEquals(0, error.suppressed.size, "$error")
            assertEquals(0, error.stackTrace.size, "$error")
        }
    }

    @Test
    fun aSignInExchangesItsCodeAndVerifierAtTheTokenEndpointNoSecretAndKeepsBothTokens() =
        inTime {
            val endpoint = TransportDouble.answering(200, granted(jwt("a1"), refresh = "refresh-1"))
            val (store, told) = MemoryStore() to Told()
            val phone = signIn(store, endpoint, told = told)
            var opened: URI? = null
            phone.signIn { url ->
                opened = url
                signsIn(url)
            }
            val sent = endpoint.sent.single()
            assertEquals(listOf("POST", TOKEN_ENDPOINT), listOf(sent.method, sent.url.toString()))
            assertEquals(ApiClient.REQUEST_TIMEOUT, sent.timeout) // no answer in time is no answer
            assertEquals(mapOf("Content-Type" to "application/x-www-form-urlencoded"), sent.headers) // no Authorization
            val form = fields(sent.body)
            assertEquals(setOf("grant_type", "client_id", "code", "redirect_uri", "code_verifier"), form.keys)
            assertEquals(
                listOf("authorization_code", "phone-client", "the-code", "bali://auth/callback"),
                listOf(form["grant_type"], form["client_id"], form["code"], form["redirect_uri"]),
            )
            // The verifier sent is the one whose challenge the sign-in page was opened with.
            val page = assertNotNull(opened)
            assertEquals(query(page, "code_challenge"), Attempt(verifier = assertNotNull(form["code_verifier"]), state = "").challenge)
            assertEquals(listOf(jwt("a1"), "refresh-1"), store.tokens?.let { listOf(it.access, it.refresh) })
            assertEquals(jwt("a1"), phone.accessToken())
            assertTrue(phone.signedIn().first())
            assertEquals(1, told.count) // the engine sends what waited on the sign-in at once
        }

    @Test
    fun aSignUpOpensTheHostedUisSignUpPageAndTheNewAccountItSendsBackIsSignedInAsASignInsIs() =
        inTime {
            // The approved Sign in & sign up design: its code and verifier exchanged, both tokens kept, the engine told.
            val endpoint = TransportDouble.answering(200, granted(jwt("a1"), refresh = "refresh-1"))
            val (store, told) = MemoryStore() to Told()
            val phone = signIn(store, endpoint, told = told)
            var opened: URI? = null
            phone.signIn(HostedPage.SignUp) { url ->
                opened = url
                signsIn(url)
            }
            val page = assertNotNull(opened)
            assertEquals("/signup", page.path)
            val form = fields(endpoint.sent.single().body)
            assertEquals(listOf("authorization_code", "the-code"), listOf(form["grant_type"], form["code"]))
            assertEquals(query(page, "code_challenge"), Attempt(verifier = assertNotNull(form["code_verifier"]), state = "").challenge)
            assertEquals(listOf(jwt("a1"), "refresh-1"), store.tokens?.let { listOf(it.access, it.refresh) })
            assertEquals(jwt("a1"), phone.accessToken())
            assertEquals(1, told.count)
        }

    @Test
    fun aSignInThatDoesNotFinishKeepsNothingAndTellsNobodyTheBrowsersOwnWordForWhyPassedOnAsItIs() =
        inTime {
            // C1b: the browser's cancel or failure, Cognito's no at the page or the endpoint, no answer, no refresh token.
            val cases =
                listOf(
                    Triple(null, null, SignInError.Cancelled),
                    Triple(null, null, SignInError.NotOpened("no window to open it in")),
                    Triple("error=access_denied", null, SignInError.Refused("access_denied")),
                    Triple(null, 400 to refusal("invalid_grant"), SignInError.Refused("invalid_grant")),
                    Triple(null, 500 to "oops", SignInError.Unreachable),
                    Triple(null, 200 to granted(jwt("a1")), SignInError.Refused(null)), // no refresh token: nothing to keep
                )
            for ((answer, reply, error) in cases) {
                val endpoint =
                    TransportDouble {
                        val (status, body) = reply ?: fail("$error: nothing should reach the token endpoint")
                        HttpAnswer(status, emptyMap(), body.encodeToByteArray())
                    }
                val (store, told) = MemoryStore() to Told()
                val phone = signIn(store, endpoint, told = told)
                val thrown =
                    assertFailsWith<SignInError>("$error") {
                        phone.signIn { url ->
                            if (reply == null && answer == null) throw error
                            "bali://auth/callback?${answer ?: "code=c"}&state=${query(url, "state")}"
                        }
                    }
                assertEquals(error, thrown)
                assertNull(thrown.message, "$error") // nothing of the attempt's in what is said of it
                assertNull(store.data, "$error")
                assertNull(phone.accessToken(), "$error")
                assertEquals(0, told.count, "$error")
            }
        }

    @Test
    fun aSignInThatCantReachCognitoOrWhoseTokensTheStoreRefusesKeepsNothing() =
        inTime {
            val (store, told) = MemoryStore() to Told()
            val offline = signIn(store, TransportDouble.throwing(UnknownHostException("bali-dev.auth.us-east-1.amazoncognito.com")), told = told)
            assertEquals(SignInError.Unreachable, assertFailsWith<SignInError> { offline.signIn(browser = signsIn) })
            // A transport throwing what none should is no answer too, never a failure the screen can't name.
            val odd = signIn(store, TransportDouble { throw IllegalStateException("odd") }, told = told)
            assertEquals(SignInError.Unreachable, assertFailsWith<SignInError> { odd.signIn(browser = signsIn) })
            store.setLocked(true)
            val locked = signIn(store, TransportDouble.answering(200, granted(jwt("a1"), refresh = "r")), told = told)
            assertEquals(SignInError.NotKept, assertFailsWith<SignInError> { locked.signIn(browser = signsIn) })
            store.setLocked(false)
            assertNull(store.data)
            assertNull(locked.accessToken())
            assertEquals(0, told.count)
        }

    @Test
    fun aSignInWhoseCallerIsCancelledOnceTheBrowserAnsweredGoesOnItsTokensKeptAndTheEngineTold() =
        inTime {
            // The engine's pattern (AN5a): a screen cancelled stops waiting, and what it set going goes on.
            val endpoint = HeldEndpoint()
            val (store, told) = MemoryStore() to Told()
            val phone = signIn(store, endpoint, told = told)
            val screen = async { phone.signIn(browser = signsIn) }
            endpoint.received(1)
            screen.cancelAndJoin()
            endpoint.answer(200, granted(jwt("a1"), refresh = "refresh-1"))
            eventually { told.count == 1 }
            assertTrue(screen.isCancelled)
            assertEquals(jwt("a1"), store.tokens?.access)
            assertEquals(jwt("a1"), phone.accessToken())
        }

    @Test
    fun theCodeIsTradedAsTheSignInPageAnswersAndItsTokensAreUsedForNothingUntilTheSignOutPageComesBack() =
        inTime {
            // AN6f: where the sign-in page's tab left Cognito's session in the browser, the code is traded first, so its tokens are
            // already given when /logout ends that session (AWS's sign-out endpoint: tokens given stay valid), and the sign-out page
            // is asked for only once the trade has answered. The tokens are kept, adopted, given and told of only once that page is
            // back; a Sign up's yes (C7-server) waits with them.
            val endpoint = HeldEndpoint()
            val (store, told) = MemoryStore() to Told()
            val phone = signIn(store, endpoint, told = told)
            val browser = SignOutPage()
            val signing = async { phone.signIn(HostedPage.SignUp, yes = "y1", browser = browser) }
            endpoint.received(1)
            assertFalse(browser.asked.isCompleted, "the sign-out page asked for before the trade answered")
            endpoint.answer(200, granted(jwt("a1"), refresh = "refresh-1"))
            browser.asked.await()
            assertNull(store.data)
            assertNull(phone.accessToken())
            assertNull(phone.account())
            assertNull(phone.yes())
            assertFalse(phone.checked())
            assertEquals(Landing(signedIn = false, account = null, count = 0), phone.landings().first())
            assertEquals(0, told.count)
            assertFalse(signing.isCompleted)
            browser.comeBack()
            signing.await()
            assertEquals(listOf(jwt("a1"), "refresh-1"), store.tokens?.let { listOf(it.access, it.refresh) })
            assertEquals(jwt("a1"), phone.accessToken())
            assertEquals("y1", phone.yes())
            assertEquals(Landing(signedIn = true, account = "a1", count = 1), phone.landings().first())
            assertEquals(1, told.count)
            assertEquals(1, endpoint.sent)
        }

    @Test
    fun tokensTradedForABrowserNotSignedOutAreDroppedKeptNowhereGivenToNobodyAndNobodyTold() =
        inTime {
            // AN6f: the sign-out page closed before Cognito sent it back, or one that couldn't open: the tokens traded are dropped and
            // nothing changes, the sign-in unfinished (fail closed, as AN6e). Nothing is revoked: nothing else ever held them.
            for (why in listOf(SignInError.BrowserNotSignedOut, SignInError.NotOpened("the sign-out page: no browser on the phone opens it"))) {
                val endpoint = TransportDouble.answering(200, granted(jwt("a1"), refresh = "refresh-1"))
                val (store, told) = MemoryStore() to Told()
                val phone = signIn(store, endpoint, told = told)
                val browser = SignOutPage().apply { close(why) }
                assertEquals(why, assertFailsWith<SignInError>("$why") { phone.signIn(browser = browser) })
                assertEquals(listOf(TOKEN_ENDPOINT), endpoint.sent.map { it.url.toString() }, "$why")
                assertNull(store.data, "$why")
                assertNull(phone.accessToken(), "$why")
                assertFalse(phone.signedIn().first(), "$why")
                assertEquals(0, told.count, "$why")
            }
        }

    @Test
    fun theSignOutPageIsAskedForWhetherTheTradeWorkedOrNotAndWhereBothFailTheTradesFailureIsSaid() =
        inTime {
            // AN6f: the session is ended either way, and the sign-in ends only once that page has. Where both fail, the trade's
            // failure is said, the one the student's next try needs fixed: offline, its page that couldn't load and was closed too.
            val anotherAttempts: suspend (URI) -> String = { _ -> "bali://auth/callback?code=the-code&state=another-attempt" }
            val cases =
                listOf(
                    Triple(signsIn, 500 to "oops", SignInError.Unreachable),
                    Triple(signsIn, 400 to refusal("invalid_grant"), SignInError.Refused("invalid_grant")),
                    Triple(signsIn, 200 to granted(jwt("a1")), SignInError.Refused(null)), // no refresh token
                    Triple(anotherAttempts, null, SignInError.Refused(null)), // never traded
                )
            for ((answer, reply, failure) in cases) {
                for (signOut in listOf(null, SignInError.BrowserNotSignedOut, SignInError.NotOpened("the sign-out page: not opened"))) {
                    val endpoint =
                        TransportDouble {
                            val (status, body) = reply ?: fail("$failure: nothing should reach the token endpoint")
                            HttpAnswer(status, emptyMap(), body.encodeToByteArray())
                        }
                    val (store, told) = MemoryStore() to Told()
                    val phone = signIn(store, endpoint, told = told)
                    val browser = SignOutPage(answer)
                    val signing = async { runCatching { phone.signIn(browser = browser) }.exceptionOrNull() }
                    browser.asked.await()
                    assertFalse(signing.isCompleted, "$failure, $signOut: ended before its sign-out page")
                    if (signOut == null) browser.comeBack() else browser.close(signOut)
                    assertEquals(failure, signing.await(), "$failure, $signOut")
                    assertNull(store.data, "$failure, $signOut")
                    assertNull(phone.accessToken(), "$failure, $signOut")
                    assertEquals(0, told.count, "$failure, $signOut")
                }
            }
        }

    @Test
    fun aSignInWhoseCallerIsCancelledOnceTheBrowserAnsweredGoesOnThroughTheSignOutPageItsTokensKeptAsItComesBack() =
        inTime {
            // The engine's pattern (AN5a) through AN6f's sign-out page: a screen cancelled once the sign-in page answered stops
            // waiting, and the trade, the sign-out page and the keeping go on in the sign-in's scope.
            val (store, told) = MemoryStore() to Told()
            val phone = signIn(store, TransportDouble.answering(200, granted(jwt("a1"), refresh = "refresh-1")), told = told)
            val browser = SignOutPage()
            val screen = async { phone.signIn(browser = browser) }
            browser.asked.await()
            screen.cancelAndJoin()
            assertNull(store.data)
            assertEquals(0, told.count)
            browser.comeBack()
            eventually { told.count == 1 }
            assertTrue(screen.isCancelled)
            assertEquals(jwt("a1"), store.tokens?.access)
            assertEquals(jwt("a1"), phone.accessToken())
        }

    @Test
    fun theExchangeGoesOnTheWireOverTheAppsOwnTransportItsFormAndTypeAndNoAuthorizationHeader() =
        inTime {
            // The token endpoint over the API client's OkHttp (AN3d), a local server in Cognito's place.
            MockWebServer().use { server ->
                server.enqueue(MockResponse(200, headersOf("Content-Type", "application/json"), granted(jwt("a1"), refresh = "refresh-1")))
                server.start()
                val local = Cognito(server.url("/").toUri(), "phone-client", URI("bali://auth/callback"), URI("bali://auth/signout"))
                val phone = SignIn(local, MemoryStore(), scope, OkHttpTransport(), Now(), gated = false)
                phone.signIn(browser = signsIn)
                val sent = server.takeRequest()
                assertEquals("POST /oauth2/token HTTP/1.1", sent.requestLine)
                assertEquals("application/x-www-form-urlencoded", sent.headers["Content-Type"])
                assertNull(sent.headers["Authorization"])
                val form = fields(sent.body?.toByteArray())
                assertEquals(listOf("authorization_code", "the-code"), listOf(form["grant_type"], form["code"]))
                assertEquals(jwt("a1"), phone.accessToken())
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
