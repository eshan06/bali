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
 * It opens each page the waiting sign-in shows once, in the browser Custom Tabs name: an Auth Tab where it has
 * one, else a Custom Tab, ephemeral wherever it offers that, with its own look (the hosted UI's is Cognito's,
 * D2d); never a WebView, whose page an app can read (RFC 8252). The sign-out page that follows a tab that left
 * Cognito's session in the browser opens like that tab, never ephemeral, since it must reach the cookies that
 * tab left (AN6e). Back in front with that page still shown, the tab closed with no answer, the student's
 * close, as AppAuth reads it; and so is the host's task swiped away. Made again (a rotation while the tab is
 * open), it keeps the tab it opened, never opening another.
 */
class HostedUiActivity : ComponentActivity() {
    private val pages get() = (application as BaliApp).hostedUi

    /** The page whose tab this host opened. */
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
        val page = pages.page()
        if (page != null && page.id != opened) open(page) else finish()
    }

    // Leaving with its page still shown ends the sign-in: no answer can come now. Otherwise it ends nothing.
    override fun onDestroy() {
        if (isFinishing) opened?.let { pages.ended(it, SignInError.Cancelled) }
        super.onDestroy()
    }

    private fun open(page: HostedUi.Page) {
        opened = page.id
        val address = page.url.toString().toUri()
        // Where it sends the student back: the sign-in page's redirect URI, the sign-out page's sign-out URL.
        val scheme = (address.getQueryParameter("redirect_uri") ?: address.getQueryParameter("logout_uri"))?.toUri()?.scheme
        val tab = page.like ?: tab(scheme)
        pages.opened(page.id, tab)
        val ephemeral = page.like == null
        try {
            if (tab.auth && scheme != null) {
                AuthTabIntent.Builder().setEphemeralBrowsingEnabled(ephemeral).build().apply { intent.setPackage(tab.browser) }.launch(authTab, address, scheme)
            } else {
                // With no browser that has Custom Tabs, one that opens the page does, in its own window.
                CustomTabsIntent.Builder().setEphemeralBrowsingEnabled(ephemeral).build().apply { intent.setPackage(tab.browser) }.launchUrl(this, address)
            }
        } catch (error: ActivityNotFoundException) {
            pages.ended(page.id, SignInError.NotOpened("no browser on the phone opens it"))
            finish()
        }
    }

    /** The tab the browser Custom Tabs name offers a page that sends the student back at [scheme], and whether it's ephemeral there. */
    private fun tab(scheme: String?): Tab {
        val browser = CustomTabsClient.getPackageName(this, null)
        return Tab(
            browser,
            auth = browser != null && scheme != null && CustomTabsClient.isAuthTabSupported(this, browser),
            ephemeral = browser != null && CustomTabsClient.isEphemeralBrowsingSupported(this, browser),
        )
    }

    private companion object {
        const val OPENED = "opened"
    }
}

/**
 * Where a Custom Tab's answer comes back, and the sign-out page's return (AN6e), a link the manifest catches by
 * their scheme. Any app can send one, so it is read only as text, and taken only for the page the waiting
 * sign-in shows, with its attempt's state or as the sign-out URL exactly ([HostedUi.redirected]), which brings
 * the host back over the tab, closing it. It starts nothing a link names, and draws nothing.
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
