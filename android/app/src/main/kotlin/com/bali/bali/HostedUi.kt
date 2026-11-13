package com.bali.bali

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.browser.auth.AuthTabIntent
import com.bali.core.Cognito
import com.bali.core.SignIn
import com.bali.core.SignInError
import java.net.URI
import java.net.URISyntaxException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred

/**
 * [SignIn.signIn]'s browser (SignInView.swift's `hostedUI`): the hosted UI at [url] in a tab that [HostedUiActivity] hosts, opened
 * from this context, a screen's, so in its task; where it sent the student back, as text, or why not: the student's close
 * [SignInError.Cancelled], anything else [SignInError.NotOpened]. Where that tab leaves Cognito's session in the phone's browser
 * (AN6e), the sign-in's [cognito] ends it first, on one more page in the same browser, so the code is traded only once it has:
 * that page closed before Cognito sent it back is [SignInError.BrowserNotSignedOut], and nothing is traded. A caller cancelled
 * stops waiting, and an answer that comes later is dropped.
 */
suspend fun Context.hostedUi(url: URI, cognito: Cognito): String {
    val pages = (applicationContext as BaliApp).hostedUi
    val waiting = pages.start(url, cognito)
    try {
        val host = Intent(this, HostedUiActivity::class.java)
        startActivity(if (this is Activity) host else host.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return waiting.answer.await()
    } finally {
        pages.forget(waiting)
    }
}

/**
 * The tab a sign-in page opened in, as the host found the phone's browser: [browser], the one Custom Tabs name, none where no
 * browser has Custom Tabs and one that opens the page did, in a window of its own; whether it was an [auth] Tab; and whether that
 * browser offers [ephemeral] browsing, which the tab asked for.
 */
internal data class Tab(val browser: String?, val auth: Boolean, val ephemeral: Boolean) {
    /**
     * Whether a sign-in in it leaves Cognito's session in the browser, to be ended after it (AN6e; the owner, 2026-11-12): wherever
     * the browser offers no ephemeral tab, and where no browser has Custom Tabs, whose plain browser keeps its cookies.
     */
    val leavesSession: Boolean get() = browser == null || !ephemeral
}

/**
 * The sign-in waiting on the hosted UI, one at a time, and the answers that end it: the Auth Tab's, which comes back to the app
 * alone ([answered]), and a Custom Tab's, a link any app can send Bali, so taken only with the waiting attempt's state
 * ([redirected]). Where the sign-in page's tab left Cognito's session in the browser ([Tab.leavesSession]), the answer is kept and
 * the sign-out page shown next, like that tab (AN6e): only its return at the client's sign-out URL, exactly, hands the answer
 * over. The verifier is never here, only in the sign-in's call: a process ended while a tab is open leaves no sign-in for its
 * answer, which is dropped.
 */
internal class HostedUi {
    /**
     * A page the waiting sign-in shows in a tab, by its own [id], which the host keeps as the tab it opened: [url], opened [like]
     * the sign-in page's tab where it's the sign-out page; none for the sign-in page, whose tab the host chooses.
     */
    class Page(val url: URI, val like: Tab? = null, val id: String = UUID.randomUUID().toString())

    /**
     * A sign-in waiting on the hosted UI at [url], [cognito]'s: its own id, its sign-in page's; its attempt's state; its answer; and
     * the [page] it shows now, the sign-in page, then the sign-out page where that page's tab left a session.
     */
    class Waiting(url: URI, internal val cognito: Cognito? = null) {
        val id: String = UUID.randomUUID().toString()
        val state: String? = stateOf(url)
        val answer = CompletableDeferred<String>()

        @Volatile var page = Page(url, id = id)
            internal set

        /** The tab its sign-in page opened in ([opened]). */
        internal var tab: Tab? = null

        /** The sign-in page's answer, kept while the sign-out page is shown; none before. */
        internal var kept: String? = null
    }

    private var waiting: Waiting? = null

    @Synchronized fun waiting(): Waiting? = waiting

    /** The page the waiting sign-in shows now, for the host to open. */
    @Synchronized fun page(): Page? = waiting?.page

    /** A sign-in waiting on [url], [cognito]'s, refused while another waits (the screen holds its buttons meanwhile). */
    @Synchronized fun start(url: URI, cognito: Cognito? = null): Waiting {
        if (waiting != null) throw SignInError.NotOpened("another sign-in page is open")
        return Waiting(url, cognito).also { waiting = it }
    }

    /** The page [id] opened in [tab]: kept for the sign-in page, whose tab says whether a session stays in the browser after it. */
    @Synchronized fun opened(id: String, tab: Tab) {
        waiting?.takeIf { it.id == id }?.tab = tab
    }

    /**
     * [answer], the Auth Tab's for the page [id], while it's shown: the sign-in page's answer ([signedIn]); the sign-out page's
     * return, at the sign-out URL alone, else that page ended elsewhere. True when taken.
     */
    @Synchronized fun answered(id: String, answer: String): Boolean {
        val held = waiting?.takeIf { it.page.id == id } ?: return false
        val kept = held.kept ?: return signedIn(held, answer)
        if (answer != held.cognito?.signOutUri?.toString()) return end(held, SignInError.NotOpened("the sign-out page ended elsewhere"))
        return end(held, kept)
    }

    /** The Auth Tab's [result] for the page [id]: its [answer], the student's close, or else why not. */
    @Synchronized fun tabEnded(id: String, result: Int, answer: String?) =
        when {
            result == AuthTabIntent.RESULT_OK && answer != null -> answered(id, answer)
            result == AuthTabIntent.RESULT_CANCELED -> ended(id, SignInError.Cancelled)
            else -> ended(id, SignInError.NotOpened("the Auth Tab ended with $result"))
        }

    /**
     * [answer], a link Bali was sent: it ends the sign-in page only with that attempt's state, and the sign-out page only as the
     * client's sign-out URL, exactly, which carries nothing of the attempt; dropped otherwise, with none waiting or for another
     * attempt, which goes on waiting. True when taken.
     */
    @Synchronized fun redirected(answer: String): Boolean {
        val held = waiting ?: return false
        held.kept?.let { kept -> return answer == held.cognito?.signOutUri?.toString() && end(held, kept) }
        val sent = try { URI(answer) } catch (error: URISyntaxException) { return false }
        if (held.state == null || stateOf(sent) != held.state) return false
        return signedIn(held, answer)
    }

    /**
     * The page [id] ended with no answer, [why], while it's shown: a page gone by ends nothing, as the sign-in page's Auth Tab
     * closing as the host comes back over it. On the sign-out page, the student's close (a page that couldn't load among them) is
     * the browser not signed out (AN6e), and one that couldn't open says it was the sign-out page.
     */
    @Synchronized fun ended(id: String, why: SignInError): Boolean {
        val held = waiting?.takeIf { it.page.id == id } ?: return false
        return end(
            held,
            when {
                held.kept == null -> why
                why == SignInError.Cancelled -> SignInError.BrowserNotSignedOut
                why is SignInError.NotOpened -> SignInError.NotOpened("the sign-out page: ${why.why}")
                else -> why
            },
        )
    }

    /** No longer waiting on [held]: its call ended, answered or cancelled, so a later answer is dropped. */
    @Synchronized fun forget(held: Waiting) {
        if (waiting === held) waiting = null
    }

    /**
     * The sign-in page's [answer] for [held]: handed over, unless its tab left Cognito's session in the browser; then it's kept, and
     * the sign-out page shown next, like that tab, so nothing is traded while the session stays (AN6e). With no sign-out page to
     * show, none for a sign-in with no [Cognito], it ends as one that couldn't open. A page no host opened has no tab, and left
     * nothing in a browser: in the app, the answer comes from the tab the host opened.
     */
    private fun signedIn(held: Waiting, answer: String): Boolean {
        if (held.tab?.leavesSession != true) return end(held, answer)
        val signOut = held.cognito?.logoutUrl() ?: return end(held, SignInError.NotOpened("the sign-out page has no address"))
        held.kept = answer
        held.page = Page(signOut, like = held.tab)
        return true
    }

    private fun end(held: Waiting, answer: String): Boolean {
        waiting = null
        return held.answer.complete(answer)
    }

    private fun end(held: Waiting, why: SignInError): Boolean {
        waiting = null
        return held.answer.completeExceptionally(why)
    }

    private companion object {
        /** The first `state` in [address]'s query, as sent: an attempt's is base64url, which nothing escapes. */
        fun stateOf(address: URI) = address.rawQuery?.split('&')?.firstOrNull { it.substringBefore('=') == "state" }?.substringAfter('=', "")
    }
}
