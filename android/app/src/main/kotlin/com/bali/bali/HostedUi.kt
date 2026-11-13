package com.bali.bali

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.browser.auth.AuthTabIntent
import com.bali.core.Browser
import com.bali.core.Cognito
import com.bali.core.SignIn
import com.bali.core.SignInError
import java.net.URI
import java.net.URISyntaxException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred

/**
 * [SignIn.signIn]'s browser in the app (SignInView.swift's `hostedUI`), at the sign-in's own [cognito] (AN6e): each page in a tab
 * that [HostedUiActivity] hosts, opened from this context, a screen's, so in its task ([HostedUi.browser]).
 */
fun Context.hostedUi(cognito: Cognito): Browser =
    (applicationContext as BaliApp).hostedUi.browser(cognito) {
        val host = Intent(this, HostedUiActivity::class.java)
        startActivity(if (this is Activity) host else host.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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
 * ([redirected]). The answer is handed over at once (AN6f). Where the sign-in page's tab left Cognito's session in the browser
 * ([Tab.leavesSession]), no page is shown while the answer's code is traded, then the sign-out page, like that tab, once the
 * sign-in asks ([signOut]), whose return alone, at the client's sign-out URL exactly, signs that browser out (AN6e); the
 * student's close of the sign-in page shows it too, the sign-in ending as that close. The verifier is never here, only in the
 * sign-in's call: a process ended while a tab is open leaves no sign-in for its answer, which is dropped.
 */
internal class HostedUi {
    /**
     * A page the waiting sign-in shows in a tab, by its own [id], which the host keeps as the tab it opened: [url], opened [like]
     * the sign-in page's tab where it's the sign-out page; none for the sign-in page, whose tab the host chooses.
     */
    class Page(val url: URI, val like: Tab? = null, val id: String = UUID.randomUUID().toString())

    /**
     * A sign-in waiting on the hosted UI at [url], [cognito]'s: its own id, its sign-in page's; its attempt's state; the sign-in
     * page's [answer], or why it has none; the sign-out page's return after it ([signedOut]); and the [page] it shows now.
     */
    class Waiting(url: URI, internal val cognito: Cognito? = null) {
        val id: String = UUID.randomUUID().toString()
        val state: String? = stateOf(url)
        val answer = CompletableDeferred<String>()

        /** The browser signed out after the answer (AN6f): at the sign-out page's return, or at once where the tab left no session. */
        val signedOut = CompletableDeferred<Unit>()

        /** The page it shows now: the sign-in page; none while the answer's code is traded; then the sign-out page (AN6e, AN6f). */
        @Volatile var page: Page? = Page(url, id = id)
            internal set

        /** The tab its sign-in page opened in ([opened]). */
        internal var tab: Tab? = null

        /** Whether its sign-out page follows the sign-in page's close, not its answer: then it ends as that close (AN6f). */
        internal var closed = false
    }

    private var waiting: Waiting? = null

    /** The host in front, told when the sign-out page is shown once the code is traded, to open it (AN6f): its own, while resumed. */
    @Volatile var front: (() -> Unit)? = null

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
        val held = shown(id) ?: return false
        if (id == held.id) return signedIn(held, answer)
        return signOutEnded(held, if (answer == held.signOutUri) null else SignInError.NotOpened("the sign-out page ended elsewhere"))
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
     * client's sign-out URL, exactly, which carries nothing of the attempt; dropped otherwise, with none waiting, for another
     * attempt or while the code is traded, the sign-in waiting on. True when taken.
     */
    @Synchronized fun redirected(answer: String): Boolean {
        val held = waiting ?: return false
        val page = held.page ?: return false
        if (page.id != held.id) return answer == held.signOutUri && signOutEnded(held, null)
        val sent = try { URI(answer) } catch (error: URISyntaxException) { return false }
        if (held.state == null || stateOf(sent) != held.state) return false
        return signedIn(held, answer)
    }

    /**
     * The page [id] ended with no answer, [why], while it's shown, its host still there to open what follows: a page gone by ends
     * nothing, as the sign-in page's Auth Tab closing as the host comes back over it. The student's close of the sign-in page
     * shows the sign-out page next where its tab left Cognito's session in the browser, since Cognito may have signed the student
     * in already (AN6f), the sign-in still ending as that close; one that couldn't open opens nothing more. On the sign-out page
     * after an answer, the student's close (a page that couldn't load among them) is the browser not signed out (AN6e), and one
     * that couldn't open says it was the sign-out page.
     */
    @Synchronized fun ended(id: String, why: SignInError): Boolean {
        val held = shown(id) ?: return false
        if (id != held.id) {
            val notOpened = (why as? SignInError.NotOpened)?.let { SignInError.NotOpened("the sign-out page: ${it.why}") }
            return signOutEnded(held, if (why == SignInError.Cancelled) SignInError.BrowserNotSignedOut else notOpened ?: why)
        }
        val signOut = held.cognito?.logoutUrl()
        if (why != SignInError.Cancelled || held.tab?.leavesSession != true || signOut == null) return end(held, why)
        held.closed = true
        held.page = Page(signOut, like = held.tab)
        return true
    }

    /**
     * The host gone for good, its task swiped away, with the page [id] it opened: no page can open after it, so the sign-in ends
     * now, as that page's close would with nothing to follow. Gone once its sign-in page did (the code being traded, or the
     * sign-out page shown but never opened), the sign-out page never opens: the browser not signed out, or the close it followed.
     */
    @Synchronized fun left(id: String): Boolean {
        val held = waiting ?: return false
        return when {
            held.page?.id == id && id == held.id -> end(held, SignInError.Cancelled)
            held.page?.id == id || id == held.id -> signOutEnded(held, SignInError.BrowserNotSignedOut)
            else -> false
        }
    }

    /**
     * The page the host back in front opens, having opened [opened] (none yet) and been covered by the browser since or not
     * ([covered]); none while the sign-in waits with nothing new to open, or once nothing waits, when the host goes. Its own page
     * still shown once the browser has covered it is the student's close ([ended]), which may show the sign-out page next; before
     * that, it's the host made again, or a browser not over it yet, so it waits (AN13g's finding, AN6f).
     */
    @Synchronized fun resumed(opened: String?, covered: Boolean): Page? {
        val page = waiting?.page ?: return null
        if (page.id != opened) return page
        if (covered) ended(page.id, SignInError.Cancelled)
        return waiting?.page?.takeIf { it.id != opened }
    }

    /** [held]'s answer traded (AN6f): its sign-out page shown now, like its sign-in page's tab, for the host in front ([front]). */
    fun signOut(held: Waiting) {
        val told =
            synchronized(this) {
                if (waiting !== held || held.page != null) return
                held.page = Page(held.cognito?.logoutUrl() ?: return, like = held.tab)
                front
            }
        told?.invoke()
    }

    /** No longer waiting on [held]: its call ended, answered or cancelled, so a later answer is dropped. */
    @Synchronized fun forget(held: Waiting) {
        if (waiting === held) waiting = null
    }

    /**
     * [SignIn.signIn]'s browser over these pages, at [cognito]: [show] brings the host, which opens each page the sign-in shows.
     * Its sign-in page's answer comes back at once (AN6f), and its caller cancelled before it lets go of the sign-in; its
     * sign-out, asked once the code is traded, lets go once the sign-out page has ended, or as its caller stops waiting.
     */
    fun browser(cognito: Cognito, show: () -> Unit): Browser =
        object : Browser {
            @Volatile private var held: Waiting? = null

            override suspend fun open(page: URI): String {
                val waiting = start(page, cognito).also { held = it }
                try {
                    show()
                    return waiting.answer.await()
                } catch (error: Throwable) {
                    forget(waiting)
                    throw error
                }
            }

            override suspend fun signedOut() {
                val waiting = held ?: return
                try {
                    signOut(waiting)
                    waiting.signedOut.await()
                } finally {
                    forget(waiting)
                }
            }
        }

    /** The waiting sign-in, while it shows the page [id]. */
    private fun shown(id: String) = waiting?.takeIf { it.page?.id == id }

    /**
     * The sign-in page's [answer] for [held], handed over at once (AN6f). Where its tab left Cognito's session in the browser, the
     * sign-in waits on with no page shown while the code is traded, its sign-out page next ([signOut]); with none to show, none for
     * a sign-in with no [Cognito], its sign-out fails as one that couldn't open. Elsewhere it's done. A page no host opened has no
     * tab, and left nothing in a browser: in the app, the answer comes from the tab the host opened.
     */
    private fun signedIn(held: Waiting, answer: String): Boolean {
        when {
            held.tab?.leavesSession != true -> signOutEnded(held, null)
            held.cognito?.logoutUrl() == null -> signOutEnded(held, SignInError.NotOpened("the sign-out page has no address"))
            else -> held.page = null
        }
        return held.answer.complete(answer)
    }

    /** [held]'s sign-out page came back ([why] none) or ended with [why]: after a close, the sign-in ends as that close, whatever. */
    private fun signOutEnded(held: Waiting, why: SignInError?): Boolean {
        waiting = null
        return when {
            held.closed -> held.answer.completeExceptionally(SignInError.Cancelled)
            why == null -> held.signedOut.complete(Unit)
            else -> held.signedOut.completeExceptionally(why)
        }
    }

    private fun end(held: Waiting, why: SignInError): Boolean {
        waiting = null
        return held.answer.completeExceptionally(why)
    }

    private companion object {
        /** The first `state` in [address]'s query, as sent: an attempt's is base64url, which nothing escapes. */
        fun stateOf(address: URI) = address.rawQuery?.split('&')?.firstOrNull { it.substringBefore('=') == "state" }?.substringAfter('=', "")

        /** [this] sign-in's sign-out URL, as Cognito sends it back. */
        val Waiting.signOutUri get() = cognito?.signOutUri?.toString()
    }
}
