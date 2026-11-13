package com.bali.bali

import androidx.browser.auth.AuthTabIntent
import com.bali.core.Cognito
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.SignIn
import com.bali.core.SignInError
import com.bali.core.TokenStore
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking

/**
 * The sign-in waiting on the hosted UI, on the JVM: the answers that end it and the ones dropped. A Custom
 * Tab's answer is a link any app on the phone can send Bali, so one for no waiting sign-in, or for another
 * attempt, ends nothing and replaces nothing (#515's reviews); the Auth Tab's answers only the sign-in whose
 * tab it is. Where the sign-in page's tab leaves Cognito's session in the browser, its sign-out page and the
 * return that alone hands the answer over (AN6e). The tab, the activities and Android's hop are the emulator's
 * (SignInBrowserTest).
 */
class HostedUiTest {
    private val pages = HostedUi()

    private fun page(state: String) =
        URI("https://bali.auth.test/oauth2/authorize?response_type=code&client_id=c&redirect_uri=com%2Ebali%2Ebali%3A%2Fauth%2Fcallback&state=$state&code_challenge=x")

    private fun answer(state: String, code: String = "the-code") = "com.bali.bali:/auth/callback?code=$code&state=$state"

    /** A sign-in's own Cognito, at a made-up domain, its sign-out URL the build's (core's AppConfigTest pins it). */
    private val cognito = Cognito(URI("https://bali.auth.test"), "the-client", URI("com.bali.bali://auth/callback"), URI("com.bali.bali://auth/signout"))

    /** Its sign-out page, Cognito's `/logout` with its client id and its sign-out URL, each escaped. */
    private val logout = URI("https://bali.auth.test/logout?client_id=the-client&logout_uri=com%2Ebali%2Ebali%3A%2F%2Fauth%2Fsignout")

    /** Where Cognito sends that page back, exactly (the live check, 2026-11-13). */
    private val signedOut = "com.bali.bali://auth/signout"

    /** The emulators' Chrome 124: Custom Tabs, but neither the Auth Tab nor an ephemeral tab. */
    private val chrome124 = Tab("com.android.chrome", auth = false, ephemeral = false)

    @Test
    fun anAnswerWithTheWaitingAttemptsStateEndsItWithTheAnswerAsSent() {
        val waiting = pages.start(page("s1"))
        assertEquals("s1", waiting.state)
        // As sent, escapes and all: the sign-in reads it, exactly (AN6a).
        val sent = answer("s1", code = "a%2Bb+c")
        assertTrue(pages.redirected(sent))
        assertEquals(sent, runBlocking { waiting.answer.await() })
        assertNull(pages.waiting())
        // Taken once: the same answer again ends nothing.
        assertFalse(pages.redirected(sent))
    }

    @Test
    fun anAnswerForNoWaitingSignInIsDropped() {
        assertFalse(pages.redirected(answer("s1")))
        val waiting = pages.start(page("s1"))
        assertFalse(waiting.answer.isCompleted)
        assertSame(waiting, pages.waiting())
    }

    @Test
    fun anAnswerForAnotherAttemptNeitherEndsNorReplacesTheWaitingOne() {
        val waiting = pages.start(page("s1"))
        for (other in listOf(answer("s2"), answer("s1x"), answer(""), "com.bali.bali:/auth/callback?code=c", "com.bali.bali:/auth/callback")) {
            assertFalse(pages.redirected(other), other)
        }
        // The first state is the answer's, as the sign-in reads it, and one that isn't a URI is none.
        assertFalse(pages.redirected("com.bali.bali:/auth/callback?state=s2&state=s1&code=c"))
        assertFalse(pages.redirected("com.bali.bali:/auth/callback?code=c d&state=s1"))
        assertFalse(waiting.answer.isCompleted)
        assertSame(waiting, pages.waiting())
        assertTrue(pages.redirected(answer("s1")))
        assertEquals(answer("s1"), runBlocking { waiting.answer.await() })
    }

    @Test
    fun theAuthTabsAnswerEndsOnlyTheSignInWhoseTabItIs() {
        val waiting = pages.start(page("s1"))
        assertFalse(pages.answered("another tab", answer("s1")))
        assertFalse(waiting.answer.isCompleted)
        // Its state is the sign-in's to check: the Auth Tab's answer comes to the app alone.
        assertTrue(pages.answered(waiting.id, answer("s2")))
        assertEquals(answer("s2"), runBlocking { waiting.answer.await() })
        assertNull(pages.waiting())
    }

    @Test
    fun theAuthTabsResultEndsItsSignInItsAnswerItsCloseCancelledAnythingElseNotOpenedInWordsWithNoAddress() {
        val answered = pages.start(page("s1"))
        assertFalse(pages.tabEnded("another tab", AuthTabIntent.RESULT_OK, answer("s1")))
        assertTrue(pages.tabEnded(answered.id, AuthTabIntent.RESULT_OK, answer("s1")))
        assertEquals(answer("s1"), runBlocking { answered.answer.await() })
        val closed = pages.start(page("s2"))
        assertTrue(pages.tabEnded(closed.id, AuthTabIntent.RESULT_CANCELED, null))
        assertSame(SignInError.Cancelled, assertFailsWith<SignInError.Cancelled> { runBlocking { closed.answer.await() } })
        val codes = listOf(AuthTabIntent.RESULT_VERIFICATION_FAILED, AuthTabIntent.RESULT_VERIFICATION_TIMED_OUT, AuthTabIntent.RESULT_UNKNOWN_CODE)
        for ((result, answer) in codes.map { it to null } + (AuthTabIntent.RESULT_OK to null)) {
            val ended = pages.start(page("s3"))
            assertTrue(pages.tabEnded(ended.id, result, answer))
            val why = assertFailsWith<SignInError.NotOpened> { runBlocking { ended.answer.await() } }.why
            assertEquals("the Auth Tab ended with $result", why)
        }
    }

    @Test
    fun aSignInEndedWithNoAnswerSaysWhyOnlyItsOwn() {
        val waiting = pages.start(page("s1"))
        assertFalse(pages.ended("another tab", SignInError.NotOpened("no")))
        assertTrue(pages.ended(waiting.id, SignInError.Cancelled))
        assertSame(SignInError.Cancelled, assertFailsWith<SignInError.Cancelled> { runBlocking { waiting.answer.await() } })
        assertNull(pages.waiting())
        assertFalse(pages.redirected(answer("s1")))
    }

    @Test
    fun aSecondSignInWhileOneWaitsIsRefusedInWordsWithNoAddressAndTheFirstWaitsOn() {
        val waiting = pages.start(page("s1"))
        val refused = assertFailsWith<SignInError.NotOpened> { pages.start(page("s2")) }
        for (secret in listOf("s1", "s2", "bali.auth.test", "callback")) assertFalse(refused.why.contains(secret), refused.why)
        assertSame(waiting, pages.waiting())
        assertTrue(pages.redirected(answer("s1")))
        assertEquals(answer("s1"), runBlocking { waiting.answer.await() })
    }

    @Test
    fun aSignInForgottenByItsCallerDropsAnAnswerThatComesLaterAndFreesTheNext() {
        val waiting = pages.start(page("s1"))
        pages.forget(waiting)
        assertNull(pages.waiting())
        assertFalse(pages.redirected(answer("s1")))
        assertFalse(pages.answered(waiting.id, answer("s1")))
        assertFalse(waiting.answer.isCompleted)
        // Forgotten again, or after another started, it lets go of nothing else.
        val next = pages.start(page("s2"))
        pages.forget(waiting)
        assertSame(next, pages.waiting())
    }

    @Test
    fun aPageWithNoStateIsEndedOnlyByItsTabNeverByALink() {
        val waiting = pages.start(URI("https://bali.auth.test/oauth2/authorize?client_id=c"))
        assertNull(waiting.state)
        assertFalse(pages.redirected("com.bali.bali:/auth/callback?code=c"))
        assertTrue(pages.answered(waiting.id, "com.bali.bali:/auth/callback?code=c"))
    }

    /**
     * The build's callback since AN6d, two slashes (core's AppConfigTest pins it), through the hop and the sign-in as the app's
     * activities hand an answer over: taken for its attempt, and the one-slash form and every near miss refused, nothing
     * exchanged for one. The waiting sign-in takes a link by its attempt's state alone, as sent; its address is the sign-in's to
     * judge, against the build's redirect exactly (`Cognito.code`, AN6a), so the form the build sets is the one taken.
     */
    @Test
    fun anAnswerAtTheTwoSlashCallbackSignsInAndTheOneSlashFormAndOtherNearMissesAreRefusedUnexchanged() {
        val exchanged = AtomicInteger()
        val token =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest): HttpAnswer {
                    exchanged.incrementAndGet()
                    return HttpAnswer(200, emptyMap(), """{"access_token":"a.b.c","refresh_token":"r"}""".encodeToByteArray())
                }
            }

        fun signInAt(callback: String): Throwable? =
            runBlocking {
                val signIn = SignIn(cognito, Memory(), CoroutineScope(Job()), token)
                runCatching {
                    signIn.signIn { page ->
                        val waiting = pages.start(page)
                        try {
                            assertTrue(pages.redirected("$callback?code=the-code&state=${waiting.state}"), callback)
                            waiting.answer.await()
                        } finally {
                            pages.forget(waiting)
                        }
                    }
                }.exceptionOrNull()
            }
        assertNull(signInAt("com.bali.bali://auth/callback"))
        assertEquals(1, exchanged.get())
        for (near in listOf(
            "com.bali.bali:/auth/callback", // one slash, RFC 8252's form, which Cognito's console refused (2026-11-12)
            "com.bali.bali://another/callback",
            "com.bali.bali://auth/another",
            "com.bali.bali://auth/callback/more",
            "com.bali.bali://auth/callback/",
            "com.bali.bali:///auth/callback",
        )) {
            assertEquals(SignInError.Refused(null), signInAt(near), near)
        }
        assertEquals(1, exchanged.get())
    }

    /**
     * The owner's call (2026-11-12): where the browser offers no ephemeral tab, or no browser has Custom Tabs and one that opens the
     * page keeps its cookies, the sign-in page's answer is kept and its sign-out page shown next, like its tab, at the sign-in's own
     * Cognito; where the tab was ephemeral, the answer goes straight on, and there's no extra page.
     */
    @Test
    fun theSignOutPageFollowsWhereTheBrowserOffersNoEphemeralTabOrNoneHasCustomTabsAndNeverWhereOneIsOffered() {
        val leaving =
            listOf(
                chrome124, // Chrome before 136
                Tab("org.example.browser", auth = true, ephemeral = false), // an Auth Tab in a browser with no ephemeral tab
                Tab(null, auth = false, ephemeral = false), // no Custom Tabs browser: one that opens the page, with its own cookies
            )
        // Chrome 136, then 137 and later, with the Auth Tab.
        val ephemeral = listOf(Tab("com.android.chrome", auth = false, ephemeral = true), Tab("com.android.chrome", auth = true, ephemeral = true))
        for (tab in leaving + ephemeral) {
            assertEquals(tab in leaving, tab.leavesSession, "$tab")
            val waiting = pages.start(page("s1"), cognito)
            // The host chooses the sign-in page's tab.
            assertNull(pages.page()?.like, "$tab")
            pages.opened(waiting.id, tab)
            assertTrue(pages.redirected(answer("s1")), "$tab")
            if (tab in leaving) {
                val signOut = assertNotNull(pages.page(), "$tab")
                assertEquals(logout, signOut.url, "$tab")
                assertSame(tab, signOut.like, "$tab")
                assertFalse(waiting.answer.isCompleted, "$tab")
                assertTrue(pages.redirected(signedOut), "$tab")
            }
            assertEquals(answer("s1"), runBlocking { waiting.answer.await() }, "$tab")
            assertNull(pages.waiting(), "$tab")
        }
    }

    /**
     * A Custom Tab's return is a link any app can send Bali, and carries nothing of the attempt: the sign-out URL, exactly, while the
     * sign-out page is shown, and once. With nothing waiting, or the sign-in page shown, it's dropped, and so is every near miss.
     */
    @Test
    fun aSignOutLinkIsTakenOnlyWhileTheSignOutPageIsShownExactlyAndOnceEveryStrayOrNearMissDroppedEndingNothing() {
        assertFalse(pages.redirected(signedOut))
        val waiting = pages.start(page("s1"), cognito)
        val signIn = assertNotNull(pages.page())
        pages.opened(waiting.id, chrome124)
        // Not the sign-in page's answer, which only its attempt's state makes: the sign-in waits on.
        assertFalse(pages.redirected(signedOut))
        assertSame(signIn, pages.page())
        assertFalse(waiting.answer.isCompleted)
        assertTrue(pages.redirected(answer("s1")))
        val signOut = assertNotNull(pages.page())
        for (near in listOf(
            "com.bali.bali://another/signout", // another host
            "com.bali.bali://auth/another", // another path
            "com.bali.bali://auth/signout/more", // a path with a tail
            "com.bali.bali://auth/signout/",
            "com.bali.bali://auth/signout?state=s1",
            "com.bali.bali://auth/signout#more",
            "com.bali.bali:/auth/signout",
            "com.bali.bali:///auth/signout",
            "bali://auth/signout",
            "COM.BALI.BALI://auth/signout",
            answer("s1"), // the sign-in page's answer again
        )) {
            assertFalse(pages.redirected(near), near)
            assertSame(signOut, pages.page(), near)
            assertFalse(waiting.answer.isCompleted, near)
        }
        assertTrue(pages.redirected(signedOut))
        assertEquals(answer("s1"), runBlocking { waiting.answer.await() })
        assertFalse(pages.redirected(signedOut))
    }

    /**
     * The sign-out page ended without its return, each way, as its own failure, nothing handed over: its close (a page that couldn't
     * load and was closed among them), the browser not signed out; a page that couldn't open, or that ended elsewhere, saying which
     * page and never an address. The Auth Tab's return is the sign-out URL's alone too.
     */
    @Test
    fun eachWayTheSignOutPageEndsWithoutItsReturnIsItsOwnFailureNothingHandedOverAndTheSignInPagesCloseStaysACancel() {
        fun shown(tab: Tab = chrome124, given: Cognito? = cognito): HostedUi.Waiting {
            val waiting = pages.start(page("s1"), given)
            pages.opened(waiting.id, tab)
            assertTrue(pages.redirected(answer("s1")))
            return waiting
        }

        fun ended(waiting: HostedUi.Waiting): Throwable? =
            runBlocking { runCatching { waiting.answer.await() }.exceptionOrNull() }.also {
                assertNull(pages.waiting())
                assertFalse(pages.redirected(signedOut))
            }
        val auth = Tab("org.example.browser", auth = true, ephemeral = false)
        val ends =
            listOf<Pair<SignInError, (HostedUi.Waiting) -> Boolean>>(
                // The host back in front with the sign-out page still shown, or its task swiped away.
                SignInError.BrowserNotSignedOut to { pages.ended(it.page.id, SignInError.Cancelled) },
                // The host that opened the sign-in page leaving before it showed the sign-out page.
                SignInError.BrowserNotSignedOut to { pages.ended(it.id, SignInError.Cancelled) },
                SignInError.NotOpened("the sign-out page: no browser on the phone opens it") to {
                    pages.ended(it.page.id, SignInError.NotOpened("no browser on the phone opens it"))
                },
                SignInError.BrowserNotSignedOut to { pages.tabEnded(it.page.id, AuthTabIntent.RESULT_CANCELED, null) },
                SignInError.NotOpened("the sign-out page: the Auth Tab ended with ${AuthTabIntent.RESULT_VERIFICATION_FAILED}") to {
                    pages.tabEnded(it.page.id, AuthTabIntent.RESULT_VERIFICATION_FAILED, null)
                },
                SignInError.NotOpened("the sign-out page ended elsewhere") to { pages.tabEnded(it.page.id, AuthTabIntent.RESULT_OK, "$signedOut/more") },
            )
        for ((why, end) in ends) {
            val waiting = shown(auth)
            assertTrue(end(waiting), "$why")
            assertEquals(why, ended(waiting))
        }
        // The Auth Tab's return at the sign-out URL hands the answer over; the sign-in page's tab can't answer once it's gone by.
        val returned = shown(auth)
        assertFalse(pages.answered(returned.id, answer("s1")))
        assertTrue(pages.tabEnded(returned.page.id, AuthTabIntent.RESULT_OK, signedOut))
        assertEquals(answer("s1"), runBlocking { returned.answer.await() })
        // No sign-out page to show, with no Cognito to name it: as one that couldn't open.
        assertEquals(SignInError.NotOpened("the sign-out page has no address"), ended(shown(given = null)))
        // The sign-in page closed before any answer is the student's close, as ever.
        val closed = pages.start(page("s1"), cognito)
        pages.opened(closed.id, chrome124)
        assertTrue(pages.ended(closed.id, SignInError.Cancelled))
        assertSame(SignInError.Cancelled, ended(closed))
        for ((why, _) in ends) {
            for (secret in listOf("bali.auth.test", "logout", "/auth/", "s1")) assertFalse("$why".contains(secret), "$why")
        }
    }

    /**
     * Through the sign-in, as the app's browser hands an answer over: the code is traded only once the sign-out page came back, so
     * a sign-in never holds tokens while Cognito's session stays in the browser, and never when that page closed first.
     */
    @Test
    fun theCodeIsTradedOnlyOnceTheSignOutPageCameBackAndNeverWhenItClosedFirst() {
        val exchanged = AtomicInteger()
        val token =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest): HttpAnswer {
                    exchanged.incrementAndGet()
                    return HttpAnswer(200, emptyMap(), """{"access_token":"a.b.c","refresh_token":"r"}""".encodeToByteArray())
                }
            }

        fun signInEnding(end: (HostedUi.Page) -> Boolean): Throwable? =
            runBlocking {
                val signIn = SignIn(cognito, Memory(), CoroutineScope(Job()), token)
                runCatching {
                    signIn.signIn { page ->
                        val waiting = pages.start(page, cognito)
                        try {
                            pages.opened(waiting.id, chrome124)
                            assertTrue(pages.redirected("${cognito.redirectUri}?code=the-code&state=${waiting.state}"))
                            assertEquals(0, exchanged.get(), "traded while the sign-out page was shown")
                            assertTrue(end(assertNotNull(pages.page())))
                            waiting.answer.await()
                        } finally {
                            pages.forget(waiting)
                        }
                    }
                }.exceptionOrNull()
            }
        assertSame(SignInError.BrowserNotSignedOut, signInEnding { pages.ended(it.id, SignInError.Cancelled) })
        assertEquals(0, exchanged.get())
        assertNull(signInEnding { pages.redirected(signedOut) })
        assertEquals(1, exchanged.get())
    }

    /** The Keystore store's stand-in, in memory. */
    private class Memory : TokenStore {
        private var saved: ByteArray? = null

        override fun load(): ByteArray? = saved

        override fun save(tokens: ByteArray) {
            saved = tokens
        }

        override fun clear() {
            saved = null
        }
    }
}
