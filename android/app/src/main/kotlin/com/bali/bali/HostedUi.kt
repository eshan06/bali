package com.bali.bali

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.bali.core.SignIn
import com.bali.core.SignInError
import java.net.URI
import java.net.URISyntaxException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred

/**
 * [SignIn.signIn]'s browser (SignInView.swift's `hostedUI`): the hosted UI at [url] in a tab that
 * [HostedUiActivity] hosts, opened from this context, a screen's, so in its task; where it sent the student
 * back, as text, or why not: the student's close [SignInError.Cancelled], anything else
 * [SignInError.NotOpened]. A caller cancelled stops waiting, and an answer that comes later is dropped.
 */
suspend fun Context.hostedUi(url: URI): String {
    val pages = (applicationContext as BaliApp).hostedUi
    val waiting = pages.start(url)
    try {
        val host = Intent(this, HostedUiActivity::class.java)
        startActivity(if (this is Activity) host else host.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return waiting.answer.await()
    } finally {
        pages.forget(waiting)
    }
}

/**
 * The sign-in waiting on the hosted UI, one at a time, and the answers that end it: the Auth Tab's, which
 * comes back to the app alone ([answered]), and a Custom Tab's, a link any app can send Bali, so taken only
 * with the waiting attempt's state ([redirected]). The verifier is never here, only in the sign-in's call:
 * a process ended while the tab is open leaves no sign-in for its answer, which is dropped.
 */
internal class HostedUi {
    /** A sign-in waiting on [url], the hosted UI's address: its own id, its attempt's state, its answer. */
    class Waiting(val url: URI) {
        val id: String = UUID.randomUUID().toString()
        val state: String? = stateOf(url)
        val answer = CompletableDeferred<String>()
    }

    private var waiting: Waiting? = null

    @Synchronized fun waiting(): Waiting? = waiting

    /** A sign-in waiting on [url], refused while another waits (the screen holds its buttons meanwhile). */
    @Synchronized fun start(url: URI): Waiting {
        if (waiting != null) throw SignInError.NotOpened("another sign-in page is open")
        return Waiting(url).also { waiting = it }
    }

    /** [answer], the Auth Tab's for the sign-in [id]: it ends that sign-in, if it still waits. */
    @Synchronized fun answered(id: String, answer: String) = end(id) { it.complete(answer) }

    /**
     * [answer], a link Bali was sent: it ends the waiting sign-in only with that attempt's state, and is
     * dropped otherwise, with none waiting or for another attempt, which goes on waiting. True when taken.
     */
    @Synchronized fun redirected(answer: String): Boolean {
        val held = waiting ?: return false
        val sent = try { URI(answer) } catch (error: URISyntaxException) { return false }
        if (held.state == null || stateOf(sent) != held.state) return false
        return end(held.id) { it.complete(answer) }
    }

    /** The sign-in [id] ended with no answer, [why], if it still waits. */
    @Synchronized fun ended(id: String, why: SignInError) = end(id) { it.completeExceptionally(why) }

    /** No longer waiting on [held]: its call ended, answered or cancelled, so a later answer is dropped. */
    @Synchronized fun forget(held: Waiting) {
        if (waiting === held) waiting = null
    }

    private fun end(id: String, how: (CompletableDeferred<String>) -> Boolean): Boolean {
        val held = waiting?.takeIf { it.id == id } ?: return false
        waiting = null
        return how(held.answer)
    }

    private companion object {
        /** The first `state` in [address]'s query, as sent: an attempt's is base64url, which nothing escapes. */
        fun stateOf(address: URI) = address.rawQuery?.split('&')?.firstOrNull { it.substringBefore('=') == "state" }?.substringAfter('=', "")
    }
}
