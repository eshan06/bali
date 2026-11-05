package com.bali.bali

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri
import com.bali.core.SignInError

/**
 * Hosts the hosted UI's tab and draws nothing (anything of Bali's around the tab is a screen, Phase 10's).
 * It opens the waiting sign-in's tab once, in the browser Custom Tabs name: an Auth Tab where it has one,
 * else a Custom Tab, ephemeral wherever it offers that, with its own look (the hosted UI's is Cognito's,
 * D2d); never a WebView, whose page an app can read (RFC 8252). Back in front with that sign-in waiting,
 * the tab closed with no answer, the student's close, as AppAuth reads it; and so is the host's task swiped
 * away. Made again (a rotation while the tab is open), it keeps the tab it opened, never opening another.
 */
class HostedUiActivity : ComponentActivity() {
    private val pages get() = (application as BaliApp).hostedUi

    /** The sign-in whose tab this host opened. */
    private var opened: String? = null

    private val authTab =
        AuthTabIntent.registerActivityResultLauncher(this) { result ->
            opened?.let { pages.tabEnded(it, result.resultCode, result.resultUri?.toString()) }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        opened = savedInstanceState?.getString(OPENED)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(OPENED, opened)
    }

    // The Auth Tab's answer is handed over before this, as an activity's result always is.
    override fun onResume() {
        super.onResume()
        val waiting = pages.waiting()
        if (waiting != null && waiting.id != opened) open(waiting) else finish()
    }

    // Leaving with its sign-in still waiting ends it: no answer can come now. Otherwise it ends nothing.
    override fun onDestroy() {
        if (isFinishing) opened?.let { pages.ended(it, SignInError.Cancelled) }
        super.onDestroy()
    }

    private fun open(waiting: HostedUi.Waiting) {
        opened = waiting.id
        val page = waiting.url.toString().toUri()
        val browser = CustomTabsClient.getPackageName(this, null)
        val scheme = page.getQueryParameter("redirect_uri")?.toUri()?.scheme
        try {
            if (browser != null && scheme != null && CustomTabsClient.isAuthTabSupported(this, browser)) {
                AuthTabIntent.Builder().setEphemeralBrowsingEnabled(true).build().apply { intent.setPackage(browser) }.launch(authTab, page, scheme)
            } else {
                // With no browser that has Custom Tabs, one that opens the page does, in its own window.
                CustomTabsIntent.Builder().setEphemeralBrowsingEnabled(true).build().apply { intent.setPackage(browser) }.launchUrl(this, page)
            }
        } catch (error: ActivityNotFoundException) {
            pages.ended(waiting.id, SignInError.NotOpened("no browser on the phone opens it"))
            finish()
        }
    }

    private companion object {
        const val OPENED = "opened"
    }
}

/**
 * Where a Custom Tab's answer comes back, a link the manifest catches by the redirect URI's scheme. Any app
 * can send one, so it is read only as text, and taken only by the waiting sign-in, with its attempt's state
 * ([HostedUi.redirected]), which brings the host back over the tab, closing it. It starts nothing a link
 * names, and draws nothing.
 */
class SignInAnswerActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val answer = intent?.dataString
        if (answer != null && (application as BaliApp).hostedUi.redirected(answer)) {
            startActivity(Intent(this, HostedUiActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
        finish()
    }
}
