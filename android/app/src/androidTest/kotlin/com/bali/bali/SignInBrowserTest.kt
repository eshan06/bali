package com.bali.bali

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.ParcelFileDescriptor
import android.view.ViewGroup
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.Cognito
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.SignIn
import com.bali.core.SignInError
import java.io.File
import java.net.URI
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The hosted UI's browser on the emulator: Android 15, whose Chrome 124 has Custom Tabs but neither the
 * Auth Tab nor ephemeral browsing, and stops at its first run (AN1), which no test goes past: a student's
 * Back closes it, nothing is accepted. What's proven is Bali's side: the tab it asks for, the answer's way
 * back through Android's hop from another app (the shell) as the text it was sent, at the build's two-slash
 * callback (AN6d), the guards on it, the student's close, and a host recreated while the tab is open. And, since
 * Chrome 124 offers no ephemeral tab, the sign-out page each answer brings (AN6e): its tab, its return, and its
 * close. A real tab and a real sign-in, on dev's Android client, are the owner's device check (📱): no test here
 * opens the hosted UI or reaches Cognito, every tab goes to the tests' own made-up domain, and none keeps tokens
 * in the app's own store.
 */
@RunWith(AndroidJUnit4::class)
class SignInBrowserTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val pages = (context.applicationContext as BaliApp).hostedUi
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The sign-in's own Cognito, at the tests' made-up domain, which nothing resolves. */
    private val cognito = Cognito(URI("https://bali.auth.test"), "the-client", URI("com.bali.bali://auth/callback"), URI(SIGNED_OUT))

    /**
     * Where the whole sign-in keeps its tokens, sealed by the Keystore as the app's are, in a file of its own: the app's own
     * sign-in, set up since AN6d, reads the app's file, and would renew a test's tokens left there with dev's Cognito.
     */
    private val kept = File(context.noBackupFilesDir, "sign-in-browser-test.sealed")

    /** Every activity Bali's process asked for: the host, and the tab's intent to the browser. */
    private val started = CopyOnWriteArrayList<Intent>()
    private val recorder =
        object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                started += Intent(intent)
                return null
            }
        }
    private val hosts = Instrumentation.ActivityMonitor(HostedUiActivity::class.java.name, null, false)

    @Before
    fun watch() {
        instrumentation.addMonitor(recorder)
        instrumentation.addMonitor(hosts)
    }

    @After
    fun leave() {
        instrumentation.removeMonitor(recorder)
        instrumentation.removeMonitor(hosts)
        pages.waiting()?.let(pages::forget)
        scope.cancel()
        // Chrome's first run, in a task of its own, closed; never accepted.
        shell("am force-stop com.android.chrome")
        KeystoreTokenStore(kept).clear()
    }

    @Test
    fun aCustomTabsAnswerComesBackThroughAndroidsHopFromAnotherAppAsTheTextItWasSent() {
        val waiting = pages.start(page("s1"))
        // At the build's callback, two slashes and a host (AN6d), which the manifest's filter takes by its scheme alone.
        val sent = "com.bali.bali://auth/callback?code=4f2e-A_b~c%2Bd+e%41&state=s1"
        send(sent)
        assertEquals(sent, await(waiting.answer))
        // Taken, it brings the host back over the tab, which closes the tab: the one thing it starts.
        hostCameAndWent()
        assertEquals(listOf(HostedUiActivity::class.java.name), started.map { it.component?.className })
    }

    @Test
    fun anAnswerForNoWaitingSignInIsDroppedStartingNothing() {
        send(answer("s1"))
        assertNull(pages.waiting())
        assertEquals(emptyList<Intent>(), started)
    }

    @Test
    fun anAnswerForAnotherAttemptNeitherEndsNorReplacesTheWaitingOne() {
        val waiting = pages.start(page("s1"))
        send(answer("s2"))
        assertSame(waiting, pages.waiting())
        assertFalse(waiting.answer.isCompleted)
        assertEquals(emptyList<Intent>(), started)
        send(answer("s1"))
        assertEquals(answer("s1"), await(waiting.answer))
        hostCameAndWent()
    }

    /**
     * The host a taken answer brought back, come and gone again with nothing waiting, before the test ends: made after it, as
     * once on Android 10's emulator (AN7h's whole run), it opened a tab for the next test's sign-in.
     */
    private fun hostCameAndWent() {
        until { Unit.takeIf { started.any { it.component?.className == HostedUiActivity::class.java.name } } }
        until { Unit.takeIf { "${context.packageName}/.HostedUiActivity" !in shell("dumpsys activity activities") } }
    }

    @Test
    fun theHostOpensTheTabThePhonesBrowserOffersWithItsOwnLookAndTheStudentsBackIsAClose() {
        val call = scope.async { runCatching { context.hostedUi(page("s1"), cognito) } }
        val tab = tab()
        // The browser Custom Tabs name: an Auth Tab where it has one, else a Custom Tab, ephemeral asked
        // either way; Chrome 124 here has neither, so a Custom Tab that shares its cookies.
        val browser = CustomTabsClient.getPackageName(context, null)
        assertEquals(browser, tab.`package`)
        assertEquals(page("s1").toString(), tab.dataString)
        assertEquals(CustomTabsClient.isAuthTabSupported(context, browser!!), tab.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false))
        assertTrue(tab.hasExtra(CustomTabsIntent.EXTRA_SESSION))
        assertTrue(tab.getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
        val ours =
            listOf(
                CustomTabsIntent.EXTRA_TOOLBAR_COLOR, CustomTabsIntent.EXTRA_COLOR_SCHEME_PARAMS, CustomTabsIntent.EXTRA_TITLE_VISIBILITY_STATE,
                CustomTabsIntent.EXTRA_MENU_ITEMS, CustomTabsIntent.EXTRA_ACTION_BUTTON_BUNDLE, CustomTabsIntent.EXTRA_TOOLBAR_ITEMS,
                CustomTabsIntent.EXTRA_CLOSE_BUTTON_ICON,
            )
        for (extra in ours) assertFalse(extra, tab.hasExtra(extra))
        // The host draws nothing: see-through, with no content of its own.
        val host = host()
        instrumentation.runOnMainSync {
            assertEquals(0, host.findViewById<ViewGroup>(android.R.id.content).childCount)
            val translucent = host.theme.obtainStyledAttributes(intArrayOf(android.R.attr.windowIsTranslucent))
            assertTrue(translucent.getBoolean(0, false))
            translucent.recycle()
        }
        covered(host)
        shell("input keyevent 4")
        assertSame(SignInError.Cancelled, await(call).exceptionOrNull())
        assertEquals(1, started.count { it.action == Intent.ACTION_VIEW })
    }

    // A configuration changed while the tab is open, as a rotation changes it, makes the host again as it
    // comes back (Android leaves a stopped activity as it is until then).
    @Test
    fun aHostMadeAgainForAChangeWhileTheTabIsOpenOpensNoOtherTabAndTheAnswerStillReachesTheCall() {
        val call = scope.async { runCatching { context.hostedUi(page("s1"), cognito) } }
        tab()
        val host = host()
        covered(host)
        changed {
            // The change reaches Bali a moment after the shell returns, seconds later on an emulator still loaded
            // from its cold boot: an answer sent before it brings the host back as it was, never made again (seen
            // on Android 16 and 17 at AN7c, the host back and done before the change arrived).
            until { context.resources.configuration.fontScale.takeIf { it == 1.3f } }
            send(answer("s1"))
            // The host made again shows the sign-out page Chrome 124's answer brings (AN6e), then hands the answer over.
            tab(2)
            send(SIGNED_OUT)
            assertEquals(answer("s1"), await(call).getOrThrow())
            assertNotSame(host, until { hosts.lastActivity?.takeIf { it !== host } })
        }
        assertEquals(listOf(page("s1").toString(), LOGOUT), views().map { it.dataString })
    }

    @Test
    fun aHostMadeAgainForAChangeWhileTheTabIsOpenTakesTheStudentsBackForACloseNotATabToOpenAgain() {
        val call = scope.async { runCatching { context.hostedUi(page("s1"), cognito) } }
        tab()
        val host = host()
        covered(host)
        val chrome = until { keysGoTo()?.takeIf { CHROME in it } }
        changed {
            // Chrome makes its window again for the change, a moment after the shell returns, and a Back the input
            // dispatcher sends the old one meanwhile is lost (logcat: no input channel; on a fresh Android 16 at AN7d,
            // the race AN7c named): the Back goes once keys go to Chrome's new window.
            until { keysGoTo()?.takeIf { CHROME in it && it != chrome } }
            shell("input keyevent 4")
            assertSame(SignInError.Cancelled, await(call).exceptionOrNull())
            assertNotSame(host, until { hosts.lastActivity?.takeIf { it !== host } })
        }
        assertEquals(1, started.count { it.action == Intent.ACTION_VIEW })
    }

    @Test
    fun aLinkSentToClearBalisTaskWhileTheTabIsOpenLandsInATaskOfItsOwnAndEndsNothing() {
        val call = scope.async { runCatching { context.hostedUi(page("s1"), cognito) } }
        tab()
        covered(host())
        // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK: what an app would send to clear the task the
        // tab is open in, which would end the sign-in as the student's close.
        send(answer("s2"), "-f 0x10008000")
        send(answer("s1"))
        // Then the sign-out page Chrome 124's answer brings, and its return (AN6e).
        tab(2)
        send(SIGNED_OUT)
        assertEquals(answer("s1"), await(call).getOrThrow())
    }

    /**
     * AN6e on Chrome 124, which offers no ephemeral tab: after the answer, the sign-out page opens in the same browser and kind of
     * tab, never ephemeral, at the sign-in's own Cognito's `/logout`, the tests' made-up domain; the answer waits for its return,
     * a near miss dropped and starting nothing; and the return, sent as Chrome sends one, brings the host back over the tab,
     * closing it, and hands the answer over.
     */
    @Test
    fun afterTheAnswerTheSignOutPageOpensLikeTheSignInsTabAtTheSignInsOwnLogoutAndItsReturnHandsTheAnswerOver() {
        val call = scope.async { runCatching { context.hostedUi(page("s1"), cognito) } }
        val signIn = tab()
        val host = host()
        covered(host)
        send(answer("s1"))
        val signOut = tab(2)
        assertEquals(LOGOUT, signOut.dataString)
        assertEquals(signIn.`package`, signOut.`package`)
        assertEquals(CustomTabsClient.getPackageName(context, null), signOut.`package`)
        assertEquals(signIn.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false), signOut.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false))
        assertTrue(signOut.hasExtra(CustomTabsIntent.EXTRA_SESSION))
        assertFalse(signOut.getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
        covered(host)
        val before = started.size
        send("$SIGNED_OUT/more")
        assertFalse(call.isCompleted)
        assertEquals(before, started.size)
        send(SIGNED_OUT)
        assertEquals(answer("s1"), await(call).getOrThrow())
        hostCameAndWent()
        // Every tab at the tests' own made-up domain: nothing reached Cognito or dev's hosted UI.
        assertEquals(listOf("bali.auth.test", "bali.auth.test"), views().map { it.data?.host })
    }

    /** The student's Back on the sign-out page: the browser not signed out of Cognito (AN6e), nothing handed over. */
    @Test
    fun theStudentsBackOnTheSignOutPageIsTheBrowserNotSignedOutAndNothingIsHandedOver() {
        val call = scope.async { runCatching { context.hostedUi(page("s1"), cognito) } }
        tab()
        val host = host()
        covered(host)
        send(answer("s1"))
        tab(2)
        covered(host)
        shell("input keyevent 4")
        assertSame(SignInError.BrowserNotSignedOut, await(call).exceptionOrNull())
        assertEquals(2, views().size)
    }

    /** A sign-out link with no sign-out page shown is dropped, starting nothing, and a waiting sign-in waits on (AN6e). */
    @Test
    fun aSignOutLinkWithNoSignOutPageShownIsDroppedStartingNothingAndTheSignInWaitsOn() {
        send(SIGNED_OUT)
        assertNull(pages.waiting())
        val waiting = pages.start(page("s1"), cognito)
        send(SIGNED_OUT)
        assertSame(waiting, pages.waiting())
        assertFalse(waiting.answer.isCompleted)
        assertEquals(emptyList<Intent>(), started)
    }

    @Test
    fun aSignInThroughTheTabIsExchangedKeptSealedAndReadBackAtARelaunch() {
        val bodies = CopyOnWriteArrayList<String>()
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest): HttpAnswer {
                    bodies += request.body?.decodeToString().orEmpty()
                    val access = jwt("""{"sub":"student-1","iat":1000000000,"exp":1000003600}""")
                    val id = jwt("""{"email":"student@school.test"}""")
                    return HttpAnswer(200, emptyMap(), """{"access_token":"$access","refresh_token":"r","id_token":"$id"}""".encodeToByteArray())
                }
            }
        val signIn = SignIn(cognito, KeystoreTokenStore(kept), scope, transport)
        val call = scope.async { runCatching { signIn.signIn { context.hostedUi(it, cognito) } } }
        // The address Chrome was sent, its state the attempt's own.
        val state = tab().dataString!!.toUri().getQueryParameter("state")
        send("com.bali.bali://auth/callback?code=the-code&state=$state")
        // Chrome 124 has no ephemeral tab: its sign-out page first, the code not traded while it's open (AN6e).
        assertEquals(LOGOUT, tab(2).dataString)
        assertEquals(emptyList<String>(), bodies)
        send(SIGNED_OUT)
        await(call).getOrThrow()
        assertTrue(bodies.single(), bodies.single().contains("grant_type=authorization_code&client_id=the-client&code=the-code&"))
        runBlocking {
            assertTrue(signIn.signedIn().first())
            val relaunched = SignIn(cognito, KeystoreTokenStore(kept), scope, transport)
            assertEquals("student-1", relaunched.account())
            assertEquals("student@school.test", relaunched.email())
        }
    }

    /** The hosted UI's address for an attempt whose state is [state], as the sign-in builds one. */
    private fun page(state: String) =
        URI("https://bali.auth.test/oauth2/authorize?response_type=code&client_id=c&redirect_uri=com%2Ebali%2Ebali%3A%2F%2Fauth%2Fcallback&state=$state&code_challenge=x")

    private fun answer(state: String) = "com.bali.bali://auth/callback?code=the-code&state=$state"

    /**
     * [text] sent to Bali by another app, the shell, as a browser sends a link, with [flags] for `am start`;
     * back once the answer's activity has read it.
     */
    private fun send(text: String, flags: String = "") {
        val read = instrumentation.addMonitor(SignInAnswerActivity::class.java.name, null, false)
        try {
            shell("am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE $flags -d $text")
            checkNotNull(read.waitForActivityWithTimeout(PATIENCE)) { "the link never reached Bali" }
        } finally {
            instrumentation.removeMonitor(read)
        }
    }

    /** The [nth] intent the host sent the browser, once it has: the sign-in page's first, then its sign-out page's. */
    private fun tab(nth: Int = 1): Intent = until { views().getOrNull(nth - 1) }

    /** Every intent the host sent the browser so far. */
    private fun views(): List<Intent> = started.filter { it.action == Intent.ACTION_VIEW }

    /** The host last made or brought to the front, once there is one. */
    private fun host(): Activity = until { hosts.lastActivity }

    /** Waits until the browser covers [host]: the host stopped. */
    private fun covered(host: Activity) {
        until { (host as HostedUiActivity).lifecycle.currentState.takeIf { it == Lifecycle.State.CREATED } }
    }

    /**
     * Runs [block] with the phone's font scale changed, a configuration change, then puts it back as found,
     * waiting for Bali to have it back: a change reaches Bali a moment after the shell returns, seconds later
     * on an emulator still loaded from its cold boot, and one landing in the next test makes its host again
     * under the tab (seen on Android 15 at AN7c).
     */
    private fun changed(block: () -> Unit) {
        val scale = shell("settings get system font_scale").trim()
        shell("settings put system font_scale 1.3")
        try {
            block()
        } finally {
            shell(if (scale == "null") "settings delete system font_scale" else "settings put system font_scale $scale")
            until { context.resources.configuration.fontScale.takeIf { it == (scale.toFloatOrNull() ?: 1f) } }
        }
    }

    /** The window the input dispatcher sends keys to now, as `dumpsys input` names it: its own id, then its app and activity. */
    private fun keysGoTo(): String? = Regex("""FocusedWindows:\s+displayId=0, name='([^']+)'""").find(shell("dumpsys input"))?.groupValues?.get(1)

    private fun <T> await(deferred: Deferred<T>): T = runBlocking { withTimeout(PATIENCE) { deferred.await() } }

    /** [value]'s first answer, asked until it gives one; a test that never gets one fails, never hangs. */
    private fun <T : Any> until(value: () -> T?): T {
        val by = System.currentTimeMillis() + PATIENCE
        while (System.currentTimeMillis() < by) {
            value()?.let { return it }
            Thread.sleep(20)
        }
        error("never came")
    }

    private fun shell(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes().decodeToString() }

    /** A token whose payload is [payload], unsigned: the phone never checks the signature. */
    private fun jwt(payload: String) = "eyJhbGciOiJSUzI1NiJ9.${Base64.getUrlEncoder().withoutPadding().encodeToString(payload.encodeToByteArray())}.signature"

    private companion object {
        val PATIENCE = 30.seconds.inWholeMilliseconds

        /** The sign-in's sign-out URL, the build's form, where Cognito sends the sign-out page back (AN6e). */
        const val SIGNED_OUT = "com.bali.bali://auth/signout"

        /** Its sign-out page: the sign-in's Cognito's `/logout`, its client id and sign-out URL each escaped. */
        const val LOGOUT = "https://bali.auth.test/logout?client_id=the-client&logout_uri=com%2Ebali%2Ebali%3A%2F%2Fauth%2Fsignout"

        /** Chrome's windows, as the input dispatcher names them. */
        const val CHROME = " com.android.chrome/"
    }
}
