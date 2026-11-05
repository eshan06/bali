package com.bali.bali

import androidx.browser.auth.AuthTabIntent
import com.bali.core.SignInError
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/**
 * The sign-in waiting on the hosted UI, on the JVM: the answers that end it and the ones dropped. A Custom
 * Tab's answer is a link any app on the phone can send Bali, so one for no waiting sign-in, or for another
 * attempt, ends nothing and replaces nothing (#515's reviews); the Auth Tab's answers only the sign-in whose
 * tab it is. The tab, the activities and Android's hop are the emulator's (SignInBrowserTest).
 */
class HostedUiTest {
    private val pages = HostedUi()

    private fun page(state: String) =
        URI("https://bali.auth.test/oauth2/authorize?response_type=code&client_id=c&redirect_uri=com%2Ebali%2Ebali%3A%2Fauth%2Fcallback&state=$state&code_challenge=x")

    private fun answer(state: String, code: String = "the-code") = "com.bali.bali:/auth/callback?code=$code&state=$state"

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
}
