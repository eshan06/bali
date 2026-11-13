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
import androidx.lifecycle.Lifecycle
import com.bali.core.SignInError

/**
 * Hosts the hosted UI's tab and draws nothing (anything of Bali's around the tab is a screen, Phase 10's).
 * It opens each page the waiting sign-in shows once, in the browser Custom Tabs name: an Auth Tab where it has
 * one, else a Custom Tab, ephemeral wherever it offers that, with its own look (the hosted UI's is Cognito's,
 * D2d); never a WebView, whose page an app can read (RFC 8252). The sign-out page that follows a tab that left
 * Cognito's session in the browser opens like that tab, never ephemeral, since it must reach the cookies that
 * tab left (AN6e); shown once the answer's code is traded, it's opened by the host waiting in front (AN6f). Back
 * in front with that page still shown, once the browser has covered it, the tab closed with no answer: the
 * student's close, as AppAuth reads it; before the browser covers it, a host made again or a tab not over it
 * yet, so it waits (AN13g's finding, AN6f). Its task swiped away, the sign-in ends. Made again (a rotation while
 * the tab is open), it keeps the tab it opened, never opening another.
 */
class HostedUiActivity : ComponentActivity() {
    private val pages get() = (application as BaliApp).hostedUi

    /** The page whose tab this host opened. */
    private var opened: String? = null

    /**
     * Whether the browser has had this host off screen since it opened that page (AN6f): only then is the page still shown as it
     * comes back the student's close. Kept across a remake, as [opened] is; Android stopping it to make it again never sets it.
     */
    private var covered = false

    /** This host told, in front, that the sign-out page is shown once the code is traded (AN6f): it opens it. */
    private val toFront: () -> Unit = { runOnUiThread { if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) next() } }

    private val authTab =
        AuthTabIntent.registerActivityResultLauncher(this) { result ->
            opened?.let { pages.tabEnded(it, result.resultCode, result.resultUri?.toString()) }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        opened = savedInstanceState?.getString(OPENED)
        covered = savedInstanceState?.getBoolean(COVERED) == true
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(OPENED, opened)
        outState.putBoolean(COVERED, covered)
    }

    // The Auth Tab's answer is handed over before this, as an activity's result always is.
    override fun onResume() {
        super.onResume()
        pages.front = toFront
        next()
    }

    override fun onPause() {
        if (pages.front === toFront) pages.front = null
        super.onPause()
    }

    // Off screen: the browser over it, unless Android is stopping it to make it again (AN6f).
    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) covered = true
    }

    // Leaving for good with a page of its own still shown ends the sign-in: nothing can open after it. Otherwise it ends nothing.
    override fun onDestroy() {
        if (isFinishing) opened?.let(pages::left)
        super.onDestroy()
    }

    /** Opens the page shown next, waits on with none to open, or goes once nothing waits. */
    private fun next() {
        val page = pages.resumed(opened, covered)
        if (page != null) open(page) else if (pages.waiting() == null) finish()
    }

    private fun open(page: HostedUi.Page) {
        opened = page.id
        covered = false
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
        const val COVERED = "covered"
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
