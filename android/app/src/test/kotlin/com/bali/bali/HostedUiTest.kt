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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking

/**
 * The sign-in waiting on the hosted UI, on the JVM: the answers that end it and the ones dropped. A Custom
 * Tab's answer is a link any app on the phone can send Bali, so one for no waiting sign-in, or for another
 * attempt, ends nothing and replaces nothing (#515's reviews); the Auth Tab's answers only the sign-in whose
 * tab it is. Where the sign-in page's tab leaves Cognito's session in the browser, its sign-out page and the
 * return that alone signs that browser out (AN6e), shown once the answer's code is traded and after a closed
 * sign-in page too (AN6f); and the host's resume, a close only once the browser has covered it (AN6f). The tab,
 * the activities and Android's hop are the emulator's (SignInBrowserTest).
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

    /** Tabs whose sign-in leaves Cognito's session in the browser: Chrome before 136, an Auth Tab in a browser with no ephemeral tab, and no Custom Tabs browser at all, one that opens the page keeping its cookies. */
    private val leaving = listOf(chrome124, Tab("org.example.browser", auth = true, ephemeral = false), Tab(null, auth = false, ephemeral = false))

    /** Tabs that leave none: Chrome 136, then 137 and later with the Auth Tab. */
    private val ephemeral = listOf(Tab("com.android.chrome", auth = false, ephemeral = true), Tab("com.android.chrome", auth = true, ephemeral = true))

    /**
     * The owner's call (2026-11-12) in AN6f's order: where the tab left Cognito's session in the browser, the sign-in page's answer is
     * handed over at once, no page shown while its code is traded and nothing to answer there; then, once the sign-in asks, its
     * sign-out page, like that tab, at the sign-in's own Cognito, whose return signs the browser out. Where the tab was ephemeral,
     * the sign-in is done at its answer, with no extra page.
     */
    @Test
    fun theAnswerIsHandedOverAtOnceAndTheSignOutPageFollowsOnceTradedWhereTheTabLeftTheSessionNeverWhereEphemeral() {
        for (tab in leaving + ephemeral) {
            assertEquals(tab in leaving, tab.leavesSession, "$tab")
            val waiting = pages.start(page("s1"), cognito)
            // The host chooses the sign-in page's tab.
            assertNull(pages.page()?.like, "$tab")
            pages.opened(waiting.id, tab)
            assertTrue(pages.redirected(answer("s1")), "$tab")
            assertEquals(answer("s1"), runBlocking { waiting.answer.await() }, "$tab")
            if (tab in leaving) {
                assertNull(pages.page(), "$tab: a page shown while the code is traded")
                assertSame(waiting, pages.waiting(), "$tab")
                assertFalse(pages.redirected(signedOut), "$tab: a sign-out link taken while the code is traded")
                assertFalse(pages.redirected(answer("s1")), "$tab: the answer taken twice")
                assertFalse(waiting.signedOut.isCompleted, "$tab")
                pages.signOut(waiting)
                val signOut = assertNotNull(pages.page(), "$tab")
                assertEquals(logout, signOut.url, "$tab")
                assertSame(tab, signOut.like, "$tab")
                assertFalse(waiting.signedOut.isCompleted, "$tab")
                assertTrue(pages.redirected(signedOut), "$tab")
            }
            assertTrue(waiting.signedOut.isCompleted, "$tab: not signed out")
            runBlocking { waiting.signedOut.await() }
            assertNull(pages.waiting(), "$tab")
            // Asked for again, or for an ephemeral tab's sign-in, the sign-out page opens nothing.
            pages.signOut(waiting)
            assertNull(pages.page(), "$tab")
        }
    }

    /**
     * A Custom Tab's return is a link any app can send Bali, and carries nothing of the attempt: the sign-out URL, exactly, while the
     * sign-out page is shown, and once. With nothing waiting, the sign-in page shown or its code being traded, it's dropped, and so
     * is every near miss.
     */
    @Test
    fun aSignOutLinkIsTakenOnlyWhileTheSignOutPageIsShownExactlyAndOnceEveryStrayOrNearMissDroppedEndingNothing() {
        assertFalse(pages.redirected(signedOut), "taken with nothing waiting")
        val waiting = pages.start(page("s1"), cognito)
        val signIn = assertNotNull(pages.page())
        pages.opened(waiting.id, chrome124)
        // Not the sign-in page's answer, which only its attempt's state makes: the sign-in waits on.
        assertFalse(pages.redirected(signedOut), "taken while the sign-in page was shown")
        assertSame(signIn, pages.page())
        assertFalse(waiting.answer.isCompleted)
        assertTrue(pages.redirected(answer("s1")))
        assertFalse(pages.redirected(signedOut), "taken while the code was traded")
        pages.signOut(waiting)
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
            assertFalse(waiting.signedOut.isCompleted, near)
        }
        assertTrue(pages.redirected(signedOut))
        runBlocking { waiting.signedOut.await() }
        assertFalse(pages.redirected(signedOut))
    }

    /**
     * The sign-out page ended without its return, each way, as its own failure of the sign-out, the answer handed over already
     * (AN6f): its close (a page that couldn't load and was closed among them) and its host gone for good, the browser not signed out;
     * a page that couldn't open, or that ended elsewhere, saying which page and never an address. The Auth Tab's return is the
     * sign-out URL's alone too.
     */
    @Test
    fun eachWayTheSignOutPageEndsWithoutItsReturnIsItsOwnFailureAndTheAnswerWasHandedOverAlready() {
        fun shown(tab: Tab = chrome124, given: Cognito? = cognito): HostedUi.Waiting {
            val waiting = pages.start(page("s1"), given)
            pages.opened(waiting.id, tab)
            assertTrue(pages.redirected(answer("s1")))
            pages.signOut(waiting)
            return waiting
        }

        fun ended(waiting: HostedUi.Waiting): Throwable? =
            runBlocking { runCatching { waiting.signedOut.await() }.exceptionOrNull() }.also {
                assertEquals(answer("s1"), runBlocking { waiting.answer.await() })
                assertNull(pages.waiting())
                assertFalse(pages.redirected(signedOut))
            }
        val auth = Tab("org.example.browser", auth = true, ephemeral = false)
        val ends =
            listOf<Pair<SignInError, (HostedUi.Page) -> Boolean>>(
                // The host back in front once the browser covered it, its page still shown; or the host gone for good.
                SignInError.BrowserNotSignedOut to { pages.resumed(it.id, covered = true) == null },
                SignInError.BrowserNotSignedOut to { pages.ended(it.id, SignInError.Cancelled) },
                SignInError.BrowserNotSignedOut to { pages.left(it.id) },
                SignInError.NotOpened("the sign-out page: no browser on the phone opens it") to {
                    pages.ended(it.id, SignInError.NotOpened("no browser on the phone opens it"))
                },
                SignInError.BrowserNotSignedOut to { pages.tabEnded(it.id, AuthTabIntent.RESULT_CANCELED, null) },
                SignInError.NotOpened("the sign-out page: the Auth Tab ended with ${AuthTabIntent.RESULT_VERIFICATION_FAILED}") to {
                    pages.tabEnded(it.id, AuthTabIntent.RESULT_VERIFICATION_FAILED, null)
                },
                SignInError.NotOpened("the sign-out page ended elsewhere") to { pages.tabEnded(it.id, AuthTabIntent.RESULT_OK, "$signedOut/more") },
            )
        for ((why, end) in ends) {
            val waiting = shown(auth)
            assertTrue(end(assertNotNull(pages.page())), "$why")
            assertEquals(why, ended(waiting))
        }
        // The Auth Tab's return at the sign-out URL signs the browser out; the sign-in page's tab can't answer once it's gone by.
        val returned = shown(auth)
        assertFalse(pages.answered(returned.id, answer("s1")))
        assertTrue(pages.tabEnded(assertNotNull(pages.page()).id, AuthTabIntent.RESULT_OK, signedOut))
        assertNull(ended(returned))
        // No sign-out page to show, with no Cognito to name it: as one that couldn't open, the answer handed over all the same.
        assertEquals(SignInError.NotOpened("the sign-out page has no address"), ended(shown(given = null)))
        for ((why, _) in ends) {
            for (secret in listOf("bali.auth.test", "logout", "/auth/", "s1")) assertFalse("$why".contains(secret), "$why")
        }
    }

    /**
     * Once the sign-in page has answered, its tab is gone by: its own late end, as an Auth Tab's close when the host comes back over
     * it (seen on Android 17's emulator), ends nothing, while the code is traded or once the sign-out page is shown, and the sign-out
     * page's return still signs the browser out.
     */
    @Test
    fun theSignInPagesTabEndingLateOnceItAnsweredEndsNothing() {
        val waiting = pages.start(page("s1"), cognito)
        pages.opened(waiting.id, Tab("org.example.browser", auth = true, ephemeral = false))
        assertTrue(pages.redirected(answer("s1")))
        repeat(2) { step ->
            assertFalse(pages.tabEnded(waiting.id, AuthTabIntent.RESULT_CANCELED, null), "the sign-in page's tab's late close, $step")
            assertFalse(pages.ended(waiting.id, SignInError.Cancelled), "the sign-in page's late end, $step")
            assertFalse(waiting.signedOut.isCompleted, "$step")
            pages.signOut(waiting)
        }
        val signOut = assertNotNull(pages.page())
        assertTrue(pages.tabEnded(signOut.id, AuthTabIntent.RESULT_OK, signedOut))
        runBlocking { waiting.signedOut.await() }
    }

    /**
     * AN6f: the student's close of the sign-in page with no answer, where its tab left Cognito's session in the browser, shows the
     * sign-out page next, like that tab, since Cognito may have signed the student in already; the sign-in ends only once that page
     * has, and as the student's close whether it came back, was closed too, couldn't open or lost its host. Never where the tab was
     * ephemeral, and nothing more after a sign-in page that couldn't open.
     */
    @Test
    fun aClosedSignInPageShowsTheSignOutPageNextWhereItsTabLeftTheSessionAndTheSignInStillEndsAsTheClose() {
        val closes =
            listOf<Pair<String, (HostedUi.Page) -> Boolean>>(
                "the host back over it once covered" to { pages.resumed(it.id, covered = true) != null },
                "the Auth Tab's close" to { pages.tabEnded(it.id, AuthTabIntent.RESULT_CANCELED, null) },
            )
        val ends =
            listOf<Pair<String, (HostedUi.Page) -> Boolean>>(
                "came back" to { pages.redirected(signedOut) },
                "closed too" to { pages.ended(it.id, SignInError.Cancelled) },
                "couldn't open" to { pages.ended(it.id, SignInError.NotOpened("no browser on the phone opens it")) },
                "its host gone" to { pages.left(it.id) },
            )
        for (tab in leaving) for ((close, closing) in closes) for ((end, ending) in ends) {
            val waiting = pages.start(page("s1"), cognito)
            val signIn = assertNotNull(pages.page())
            pages.opened(waiting.id, tab)
            assertTrue(closing(signIn), "$tab, $close, $end")
            val signOut = assertNotNull(pages.page(), "$tab, $close, $end: no sign-out page")
            assertEquals(logout, signOut.url, "$tab, $close, $end")
            assertSame(tab, signOut.like, "$tab, $close, $end")
            assertFalse(waiting.answer.isCompleted, "$tab, $close, $end: ended before its sign-out page")
            assertTrue(ending(signOut), "$tab, $close, $end")
            assertSame(SignInError.Cancelled, runBlocking { runCatching { waiting.answer.await() }.exceptionOrNull() }, "$tab, $close, $end")
            assertNull(pages.waiting(), "$tab, $close, $end")
        }
        for (tab in ephemeral) {
            val waiting = pages.start(page("s1"), cognito)
            pages.opened(waiting.id, tab)
            assertTrue(pages.ended(waiting.id, SignInError.Cancelled), "$tab")
            assertNull(pages.waiting(), "$tab: a sign-out page after an ephemeral tab's close")
            assertSame(SignInError.Cancelled, runBlocking { runCatching { waiting.answer.await() }.exceptionOrNull() }, "$tab")
        }
        for (why in listOf(SignInError.NotOpened("no browser on the phone opens it"), SignInError.NotOpened("the Auth Tab ended with 2"))) {
            val waiting = pages.start(page("s1"), cognito)
            pages.opened(waiting.id, chrome124)
            assertTrue(pages.ended(waiting.id, why), "$why")
            assertNull(pages.waiting(), "$why: a sign-out page after a sign-in page that couldn't open")
            assertEquals(why, runBlocking { runCatching { waiting.answer.await() }.exceptionOrNull() }, "$why")
        }
    }

    /**
     * AN13g's finding (AN6f): the host back in front with its page still shown is the student's close only once the browser has had
     * it off screen since it opened that page. Before that it's the host made again, or a browser not over it yet, and it opens
     * nothing again: the sign-in waits on.
     */
    @Test
    fun aHostBackInFrontBeforeTheBrowserCoveredItIsNoCloseAndOnceCoveredItIs() {
        for (tab in listOf(chrome124, ephemeral.first())) {
            val waiting = pages.start(page("s1"), cognito)
            val signIn = assertNotNull(pages.resumed(null, covered = false), "$tab: the host's first page")
            pages.opened(signIn.id, tab)
            assertNull(pages.resumed(signIn.id, covered = false), "$tab: opened again before the browser covered the host")
            assertSame(waiting, pages.waiting(), "$tab")
            assertSame(signIn, pages.page(), "$tab")
            assertFalse(waiting.answer.isCompleted, "$tab: ended before the browser covered the host")
            val next = pages.resumed(signIn.id, covered = true)
            if (tab.leavesSession) {
                assertEquals(logout, assertNotNull(next, "$tab").url, "$tab")
                assertTrue(pages.redirected(signedOut), "$tab")
            } else {
                assertNull(next, "$tab")
            }
            assertNull(pages.waiting(), "$tab")
            assertSame(SignInError.Cancelled, runBlocking { runCatching { waiting.answer.await() }.exceptionOrNull() }, "$tab")
        }
    }

    /**
     * A host in front while the code is traded has nothing to open, and the sign-in waits on; it's told once the sign-out page is
     * shown (its own [HostedUi.front], while it's resumed), and opens it then (AN6f).
     */
    @Test
    fun aHostInFrontWhileTheCodeIsTradedWaitsAndIsToldOnceTheSignOutPageIsShown() {
        val told = AtomicInteger()
        pages.front = { told.incrementAndGet() }
        val waiting = pages.start(page("s1"), cognito)
        val signIn = assertNotNull(pages.resumed(null, covered = false))
        pages.opened(signIn.id, chrome124)
        assertTrue(pages.redirected(answer("s1")))
        assertNull(pages.resumed(signIn.id, covered = true))
        assertSame(waiting, pages.waiting())
        assertEquals(0, told.get())
        pages.signOut(waiting)
        assertEquals(1, told.get())
        val signOut = assertNotNull(pages.resumed(signIn.id, covered = true))
        assertEquals(logout, signOut.url)
        assertNull(pages.resumed(signOut.id, covered = false))
        assertSame(waiting, pages.waiting())
        assertNull(pages.resumed(signOut.id, covered = true))
        assertSame(SignInError.BrowserNotSignedOut, runBlocking { runCatching { waiting.signedOut.await() }.exceptionOrNull() })
        assertEquals(1, told.get())
    }

    /**
     * The host gone for good (its task swiped away) with its tab's page still shown: nothing can open after it, so the sign-in ends
     * at once as that page's close with nothing to follow: the sign-in page's as the student's close, with no sign-out page; and
     * while the code is traded, its sign-out page never to open, the browser not signed out. A page no host of its opened ends
     * nothing.
     */
    @Test
    fun theHostGoneForGoodEndsTheSignInAtOnceAsItsPagesCloseWithNothingToFollow() {
        val signingIn = pages.start(page("s1"), cognito)
        pages.opened(signingIn.id, chrome124)
        assertFalse(pages.left("another page"))
        assertSame(signingIn, pages.waiting())
        assertTrue(pages.left(signingIn.id))
        assertNull(pages.waiting())
        assertSame(SignInError.Cancelled, runBlocking { runCatching { signingIn.answer.await() }.exceptionOrNull() })
        val trading = pages.start(page("s1"), cognito)
        pages.opened(trading.id, chrome124)
        assertTrue(pages.redirected(answer("s1")))
        assertTrue(pages.left(trading.id))
        assertNull(pages.waiting())
        assertEquals(answer("s1"), runBlocking { trading.answer.await() })
        assertSame(SignInError.BrowserNotSignedOut, runBlocking { runCatching { trading.signedOut.await() }.exceptionOrNull() })
        pages.signOut(trading)
        assertNull(pages.page(), "a sign-out page shown after its host left")
        // Gone as the code's trade answered: the sign-out page shown, its host told no more, never opened (santa's round 1).
        val traded = pages.start(page("s1"), cognito)
        pages.opened(traded.id, chrome124)
        assertTrue(pages.redirected(answer("s1")))
        pages.signOut(traded)
        assertNotNull(pages.page())
        assertTrue(pages.left(traded.id), "the host gone before it opened the sign-out page ended nothing")
        assertNull(pages.waiting())
        assertSame(SignInError.BrowserNotSignedOut, runBlocking { runCatching { traded.signedOut.await() }.exceptionOrNull() })
        // And gone after the sign-in page's close showed the sign-out page, before it opened it: the close.
        val closed = pages.start(page("s1"), cognito)
        pages.opened(closed.id, chrome124)
        assertTrue(pages.ended(closed.id, SignInError.Cancelled))
        assertNotNull(pages.page())
        assertTrue(pages.left(closed.id), "the host gone before it opened the close's sign-out page ended nothing")
        assertNull(pages.waiting())
        assertSame(SignInError.Cancelled, runBlocking { runCatching { closed.answer.await() }.exceptionOrNull() })
    }

    /**
     * The app's browser over these pages lets go of its sign-in as its caller does (AN6f): a caller cancelled before the answer
     * leaves nothing waiting, a late answer dropped; one cancelled while the sign-out page is shown lets go of it too.
     */
    @Test
    fun theAppsBrowserLetsGoOfItsSignInWhenItsCallerStopsWaiting() {
        runBlocking {
            val shown = CompletableDeferred<Unit>()
            val browser = pages.browser(cognito) { shown.complete(Unit) }
            val opening = async(Dispatchers.Default) { browser.open(page("s1")) }
            shown.await()
            assertNotNull(pages.waiting())
            opening.cancelAndJoin()
            assertNull(pages.waiting())
            assertFalse(pages.redirected(answer("s1")))
            val again = pages.browser(cognito) {}
            val answering = async(Dispatchers.Default) { again.open(page("s2")) }
            val waiting = until { pages.waiting() }
            pages.opened(waiting.id, chrome124)
            assertTrue(pages.redirected(answer("s2")))
            assertEquals(answer("s2"), answering.await())
            val signingOut = async(Dispatchers.Default) { again.signedOut() }
            until { pages.page() }
            signingOut.cancelAndJoin()
            assertNull(pages.waiting())
            assertFalse(pages.redirected(signedOut))
        }
    }

    /**
     * Through the sign-in and the app's browser over these pages (AN6f): the code is traded as soon as the sign-in page answers, no
     * page shown, so its tokens are given before /logout; the sign-out page is shown once the trade has answered, the host in front
     * told; and the tokens are kept only once that page came back, never when it closed first.
     */
    @Test
    fun throughTheSignInTheCodeIsTradedFirstTheSignOutPageShownOnceItIsAndTheTokensKeptOnlyAsItComesBack() {
        val trades = CopyOnWriteArrayList<String>() // where the sign-in stood as each trade went out
        val token =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest): HttpAnswer {
                    trades +=
                        when {
                            pages.waiting() == null -> "after the sign-out page"
                            pages.page() == null -> "before the sign-out page"
                            else -> "while ${pages.page()?.url?.path} was shown"
                        }
                    return HttpAnswer(200, emptyMap(), """{"access_token":"a.b.c","refresh_token":"r"}""".encodeToByteArray())
                }
            }

        fun signInEnding(end: (HostedUi.Page) -> Boolean): Pair<Throwable?, Memory> =
            runBlocking {
                val store = Memory()
                val signIn = SignIn(cognito, store, CoroutineScope(Job()), token)
                val shown = CompletableDeferred<Unit>()
                val told = CompletableDeferred<Unit>()
                pages.front = { told.complete(Unit) }
                val signing = async(Dispatchers.Default) { runCatching { signIn.signIn(browser = pages.browser(cognito) { shown.complete(Unit) }) }.exceptionOrNull() }
                shown.await()
                val waiting = assertNotNull(pages.waiting())
                pages.opened(waiting.id, chrome124)
                assertTrue(pages.redirected("${cognito.redirectUri}?code=the-code&state=${waiting.state}"))
                told.await()
                val signOut = assertNotNull(pages.page())
                assertEquals(logout, signOut.url)
                assertNull(store.load(), "kept while the sign-out page was shown")
                assertFalse(signing.isCompleted)
                assertTrue(end(signOut))
                signing.await() to store
            }
        val (closed, dropped) = signInEnding { pages.ended(it.id, SignInError.Cancelled) }
        assertSame(SignInError.BrowserNotSignedOut, closed)
        assertNull(dropped.load())
        val (signedIn, kept) = signInEnding { pages.redirected(signedOut) }
        assertNull(signedIn)
        assertNotNull(kept.load())
        // Each traded with no page shown: before its sign-out page opened, while the browser's session still stood.
        assertEquals(listOf("before the sign-out page", "before the sign-out page"), trades)
    }

    /** [value]'s first answer, asked until it gives one: a point the test waits for, failing rather than hanging. */
    private fun <T : Any> until(value: () -> T?): T {
        val by = System.nanoTime() + 60_000_000_000L
        while (System.nanoTime() < by) {
            value()?.let { return it }
            Thread.sleep(1)
        }
        error("never came")
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
