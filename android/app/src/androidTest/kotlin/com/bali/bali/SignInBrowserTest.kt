package com.bali.bali

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The hosted UI's browser on the emulator: Android 15, whose Chrome 124 has Custom Tabs but neither the
 * Auth Tab nor ephemeral browsing, and stops at its first run (AN1), which no test goes past: a student's
 * Back closes it, nothing is accepted. What's proven is Bali's side: the tab it asks for, the answer's way
 * back through Android's hop from another app (the shell) as the text it was sent, at the build's two-slash
 * callback (AN6d), the guards on it, the student's close, and a host recreated while the tab is open or before
 * the browser covers it (AN6f). And the sign-out page where the browser offers no ephemeral tab (AN6e), once the
 * answer's code is traded and after a closed sign-in page too (AN6f): its tab, its return and its close on Android
 * 15's Chrome 124 and Android 10's 74; none on Android 17's Chrome 145, which offers one, with the Auth Tab. A real
 * tab and a real sign-in, on dev's Android client, are the owner's device check (📱): no test here opens the hosted
 * UI or reaches Cognito, every tab goes to the tests' own made-up domain, and none keeps tokens in the app's own
 * store.
 */
@RunWith(AndroidJUnit4::class)
class SignInBrowserTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val pages = (context.applicationContext as BaliApp).hostedUi
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The sign-in's own Cognito, at the tests' made-up domain, which nothing resolves. */
    private val cognito = Cognito(URI("https://bali.auth.test"), "the-client", URI("com.bali.bali://auth/callback"), URI(SIGNED_OUT))

    /** The sign-in's browser in the app, at that Cognito: each page in the host's tab (AN6c, AN6e, AN6f). */
    private val browser = context.hostedUi(cognito)

    /**
     * Whether the phone's browser leaves Cognito's session after a sign-in, so a sign-out page follows (AN6e): Chrome 124 on Android
     * 15's emulator and 74 on Android 10's offer no ephemeral tab; Chrome 145 on Android 17's does, with the Auth Tab.
     */
    private val leaves = CustomTabsClient.getPackageName(context, null)?.let { !CustomTabsClient.isEphemeralBrowsingSupported(context, it) } ?: true

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

    /**
     * The tab asked of the browser, and the student's Back on it: their close. Where the browser offers no ephemeral tab, the close
     * shows the sign-out page next, like that tab, since Cognito may have signed the student in already (AN6f), and the sign-in
     * ends as the close only once that page has, here closed too; on Android 17's Chrome 145 it ends at once.
     */
    @Test
    fun theHostOpensTheTabThePhonesBrowserOffersWithItsOwnLookAndTheStudentsBackIsAClose() {
        val call = signInPage()
        val tab = tab()
        // The browser Custom Tabs name: an Auth Tab where it has one, else a Custom Tab, ephemeral asked
        // either way; Chrome 124 and 74 here have neither, so a Custom Tab that shares its cookies, and
        // Chrome 145 on Android 17 has both.
        val named = CustomTabsClient.getPackageName(context, null)
        assertEquals(named, tab.`package`)
        assertEquals(page("s1").toString(), tab.dataString)
        assertEquals(CustomTabsClient.isAuthTabSupported(context, named!!), tab.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false))
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
        covered()
        shell("input keyevent 4")
        if (leaves) {
            val signOut = tab(2)
            assertEquals(LOGOUT, signOut.dataString)
            assertEquals(tab.`package`, signOut.`package`)
            assertFalse(signOut.getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
            assertFalse(call.isCompleted)
            covered()
            shell("input keyevent 4")
        }
        assertSame(SignInError.Cancelled, await(call).exceptionOrNull())
        assertEquals(listOfNotNull(page("s1").toString(), LOGOUT.takeIf { leaves }), views().map { it.dataString })
        hostCameAndWent()
    }

    // A configuration changed while the tab is open, as a rotation changes it, makes the host again as it
    // comes back (Android leaves a stopped activity as it is until then).
    @Test
    fun aHostMadeAgainForAChangeWhileTheTabIsOpenOpensNoOtherTabAndTheAnswerStillReachesTheCall() {
        val call = signInPage()
        tab()
        val host = host()
        covered()
        changed {
            // The change reaches Bali a moment after the shell returns, seconds later on an emulator still loaded
            // from its cold boot: an answer sent before it brings the host back as it was, never made again (seen
            // on Android 16 and 17 at AN7c, the host back and done before the change arrived).
            until { context.resources.configuration.fontScale.takeIf { it == 1.3f } }
            send(answer("s1"))
            assertEquals(answer("s1"), await(call).getOrThrow())
            // The host made again shows the sign-out page once asked, where the browser offers no ephemeral tab (AN6e, AN6f).
            signedOutWhereLeft()
            assertNotSame(host, until { hosts.lastActivity?.takeIf { it !== host } })
        }
        assertEquals(listOfNotNull(page("s1").toString(), LOGOUT.takeIf { leaves }), views().map { it.dataString })
    }

    @Test
    fun aHostMadeAgainForAChangeWhileTheTabIsOpenTakesTheStudentsBackForACloseNotATabToOpenAgain() {
        val call = signInPage()
        tab()
        val host = host()
        covered()
        val chrome = until { keysGoTo()?.takeIf { CHROME in it } }
        changed {
            // Chrome makes its window again for the change, a moment after the shell returns, and a Back the input
            // dispatcher sends the old one meanwhile is lost (logcat: no input channel; on a fresh Android 16 at AN7d,
            // the race AN7c named): the Back goes once keys go to Chrome's new window.
            until { keysGoTo()?.takeIf { CHROME in it && it != chrome } }
            shell("input keyevent 4")
            // The host made again takes it as the close: where the browser offers no ephemeral tab, the sign-out page follows,
            // like the sign-in page's tab (AN6f), and the sign-in ends as the close once that page has, here closed too.
            if (leaves) {
                assertEquals(LOGOUT, tab(2).dataString)
                covered()
                assertFalse(call.isCompleted)
                shell("input keyevent 4")
            }
            assertSame(SignInError.Cancelled, await(call).exceptionOrNull())
            assertNotSame(host, until { hosts.lastActivity?.takeIf { it !== host } })
        }
        // The sign-in page's tab never opened again.
        assertEquals(listOfNotNull(page("s1").toString(), LOGOUT.takeIf { leaves }), views().map { it.dataString })
    }

    /**
     * AN6f, call 3 (AN13g's finding): a host made again while it's on screen and the browser hasn't covered it yet, as Android
     * makes it again for a change in the moment between the tab's launch and the browser's first page over it, is no close: the
     * sign-in waits on. The tab is held here, so nothing covers the host; a see-through activity of the tests' own over it pauses
     * it, as Chrome's first-run trampoline did on Android 13; and `recreate()` makes it again there, through `onResume` on its way
     * back to paused. Each look at the host is on the main thread, between Android's steps there, never a window of real time.
     */
    @Test
    fun aHostMadeAgainOnScreenBeforeTheBrowserCoversItIsNoCloseAndTheSignInWaitsOn() {
        val held = Instrumentation.ActivityMonitor(BROWSER, null, true)
        instrumentation.addMonitor(held)
        try {
            val call = signInPage()
            tab()
            val host = host() as HostedUiActivity
            // Android's own call, as the host is an Activity: androidx marks its override deprecated for the result API's sake.
            val plain: Activity = host
            onMain { plain.startActivityForResult(Intent().setClassName(instrumentation.context.packageName, Veil::class.java.name), VEIL) }
            until { onMain { host.lifecycle(Lifecycle.State.STARTED) } }
            onMain { host.recreate() }
            val again = until { onMain { (hosts.lastActivity as? HostedUiActivity)?.takeIf { it !== host && settled(it) } } }
            assertNotNull("the host made again ended the sign-in as the student's close", pages.waiting())
            assertEquals("the host made again took the sign-in page as the student's close", page("s1"), pages.page()?.url)
            assertFalse(call.isCompleted)
            // It kept the tab it opened: the browser was asked once.
            assertEquals(1, views().size)
            // The veil gone, the host in front and still uncovered waits on, until the student leaves it.
            onMain { again.finishActivity(VEIL) }
            until { onMain { again.lifecycle(Lifecycle.State.RESUMED) } }
            assertNotNull(pages.waiting())
            onMain { again.finish() }
            assertSame(SignInError.Cancelled, await(call).exceptionOrNull())
            hostCameAndWent()
        } finally {
            instrumentation.removeMonitor(held)
            onMain { hosts.lastActivity?.finishActivity(VEIL) }
        }
    }

    /** Whether [host] is past Android's making it again: gone, or on screen behind the veil and not finishing. */
    private fun settled(host: HostedUiActivity) = host.lifecycle(Lifecycle.State.DESTROYED) != null || host.lifecycle(Lifecycle.State.STARTED) != null && !host.isFinishing

    /** [state], once [this] host is in it. */
    private fun HostedUiActivity.lifecycle(state: Lifecycle.State) = lifecycle.currentState.takeIf { it == state }

    /** [block]'s value, run on the main thread between Android's own steps there; what it throws, thrown here. */
    private fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(block) }
        return checkNotNull(result).getOrThrow()
    }

    @Test
    fun aLinkSentToClearBalisTaskWhileTheTabIsOpenLandsInATaskOfItsOwnAndEndsNothing() {
        val call = signInPage()
        tab()
        covered()
        // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK: what an app would send to clear the task the
        // tab is open in, which would end the sign-in as the student's close.
        send(answer("s2"), "-f 0x10008000")
        send(answer("s1"))
        assertEquals(answer("s1"), await(call).getOrThrow())
        signedOutWhereLeft()
    }

    /**
     * AN6e and AN6f where the browser offers no ephemeral tab (Chrome 124 and 74 here): the answer is handed over at once, the host
     * back in front with nothing to open while the code is traded; then, as the sign-in asks, the sign-out page opens in the same
     * browser and kind of tab, never ephemeral, at the sign-in's own Cognito's `/logout`, the tests' made-up domain; a near miss is
     * dropped, starting nothing; and the return, sent as Chrome sends one, brings the host back over the tab, closing it, and signs
     * the browser out.
     */
    @Test
    fun theAnswerComesAtOnceThenTheSignOutPageOpensLikeTheSignInsTabAtItsOwnLogoutAndItsReturnSignsTheBrowserOut() {
        assumeTrue("the browser offers an ephemeral tab", leaves)
        val call = signInPage()
        val signIn = tab()
        covered()
        send(answer("s1"))
        assertEquals(answer("s1"), await(call).getOrThrow())
        until { (hosts.lastActivity as HostedUiActivity).lifecycle(Lifecycle.State.RESUMED) }
        assertEquals(1, views().size)
        val out = signedOut()
        val signOut = tab(2)
        assertEquals(LOGOUT, signOut.dataString)
        assertEquals(signIn.`package`, signOut.`package`)
        assertEquals(CustomTabsClient.getPackageName(context, null), signOut.`package`)
        assertEquals(signIn.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false), signOut.getBooleanExtra(AuthTabIntent.EXTRA_LAUNCH_AUTH_TAB, false))
        assertTrue(signOut.hasExtra(CustomTabsIntent.EXTRA_SESSION))
        assertFalse(signOut.getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
        covered()
        val before = started.size
        send("$SIGNED_OUT/more")
        assertFalse(out.isCompleted)
        assertEquals(before, started.size)
        send(SIGNED_OUT)
        await(out).getOrThrow()
        hostCameAndWent()
        // Every tab at the tests' own made-up domain: nothing reached Cognito or dev's hosted UI.
        assertEquals(listOf("bali.auth.test", "bali.auth.test"), views().map { it.data?.host })
    }

    /** The student's Back on the sign-out page: the browser not signed out of Cognito (AN6e), the answer's tokens never kept (AN6f). */
    @Test
    fun theStudentsBackOnTheSignOutPageIsTheBrowserNotSignedOut() {
        assumeTrue("the browser offers an ephemeral tab", leaves)
        val call = signInPage()
        tab()
        covered()
        send(answer("s1"))
        assertEquals(answer("s1"), await(call).getOrThrow())
        val out = signedOut()
        tab(2)
        covered()
        shell("input keyevent 4")
        assertSame(SignInError.BrowserNotSignedOut, await(out).exceptionOrNull())
        assertEquals(2, views().size)
    }

    /** Where the browser offers an ephemeral tab (Chrome 145 here), the answer is handed over at once, with no sign-out page (AN6e). */
    @Test
    fun whereTheBrowserOffersAnEphemeralTabTheAnswerIsHandedOverAtOnceWithNoSignOutPage() {
        assumeFalse("the browser offers no ephemeral tab", leaves)
        val call = signInPage()
        assertTrue(tab().getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false))
        covered()
        send(answer("s1"))
        assertEquals(answer("s1"), await(call).getOrThrow())
        await(signedOut()).getOrThrow()
        hostCameAndWent()
        assertEquals(listOf(page("s1").toString()), views().map { it.dataString })
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

    /**
     * A whole sign-in through the tab: where the browser offers no ephemeral tab, the code traded at the tests' own server first,
     * before the sign-out page opens and so before its return is sent, and nothing kept while that page is open (AN6f); then the
     * tokens kept, sealed, and read back at a relaunch.
     */
    @Test
    fun aSignInThroughTheTabIsTradedFirstKeptSealedOnlyOnceSignedOutAndReadBackAtARelaunch() {
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
        val call = scope.async { runCatching { signIn.signIn(browser = browser) } }
        // The address Chrome was sent, its state the attempt's own; the answer comes once the tab covers the host, as a
        // browser's does after the student signs in.
        val state = tab().dataString!!.toUri().getQueryParameter("state")
        covered()
        send("com.bali.bali://auth/callback?code=the-code&state=$state")
        if (leaves) {
            assertEquals(LOGOUT, tab(2).dataString)
            assertTrue(bodies.single(), bodies.single().contains("grant_type=authorization_code&client_id=the-client&code=the-code&"))
            assertNull(KeystoreTokenStore(kept).load())
            assertFalse(runBlocking { signIn.signedIn().first() })
            covered()
            send(SIGNED_OUT)
        }
        await(call).getOrThrow()
        hostCameAndWent()
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

    /** The sign-in page opened at [page]'s, through [browser] as the sign-in opens it: its answer, or why not. */
    private fun signInPage(state: String = "s1") = scope.async { runCatching { browser.open(page(state)) } }

    /** [browser] signed out of the hosted UI after its answer, as the sign-in asks once the code is traded (AN6f). */
    private fun signedOut() = scope.async { runCatching { browser.signedOut() } }

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

    /**
     * The browser signed out after the answer, as the sign-in asks once the code is traded (AN6f), seen through as a browser would:
     * where it offers no ephemeral tab (AN6e), the sign-out page's tab, its return once the tab covers the host, then the host back
     * and gone; elsewhere at once. Sent sooner on Android 10's emulator, the return came as Chrome's first run was still opening
     * through its `IntentDispatcher`, whose window then covered the host brought back, so it outlived the test, and the next
     * test's start of the host reached it as the runner finished it, opening no tab.
     */
    private fun signedOutWhereLeft() {
        val out = signedOut()
        if (leaves) {
            tab(2)
            covered()
            send(SIGNED_OUT)
        }
        await(out).getOrThrow()
        hostCameAndWent()
    }

    /** The [nth] intent the host sent the browser, once it has: the sign-in page's first, then its sign-out page's. */
    private fun tab(nth: Int = 1): Intent = until { views().getOrNull(nth - 1) }

    /** Every intent the host sent the browser so far. */
    private fun views(): List<Intent> = started.filter { it.action == Intent.ACTION_VIEW }

    /** The host last made or brought to the front, once there is one. */
    private fun host(): Activity = until { hosts.lastActivity }

    /**
     * Waits until the browser covers the host: the one Android made last, stopped, whichever instance that is, so a host made
     * again by a change from outside the test is followed rather than waited on forever (AN13g's run).
     */
    private fun covered() {
        until { (hosts.lastActivity as? HostedUiActivity)?.lifecycle(Lifecycle.State.CREATED) }
    }

    /**
     * Runs [block] with the phone's font scale changed, a configuration change, then puts it back as found, waiting for Bali to have
     * all of it back: the font scale, and its window's size too. A change reaches Bali a moment after the shell returns, seconds
     * later on an emulator still loaded from its cold boot, and one landing in the next test makes its host again (seen on Android
     * 15 at AN7c); on Android 13, System UI laid its navigation bar out again after the font scale was back, a change of the
     * screen's size that made the next test's host again before the browser covered it (AN13g's run).
     */
    private fun changed(block: () -> Unit) {
        val scale = shell("settings get system font_scale").trim()
        val found = Configuration(context.resources.configuration)
        shell("settings put system font_scale 1.3")
        try {
            block()
        } finally {
            shell(if (scale == "null") "settings delete system font_scale" else "settings put system font_scale $scale")
            until { context.resources.configuration.takeIf { it.fontScale == found.fontScale && sized(it) == sized(found) } }
        }
    }

    /** [configuration]'s size, in Android's own measures: its width, height and smallest width. */
    private fun sized(configuration: Configuration) = listOf(configuration.screenWidthDp, configuration.screenHeightDp, configuration.smallestScreenWidthDp)

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

        /** What the host asks of the browser: a page at an https address, in a Custom Tab or the Auth Tab. */
        val BROWSER =
            IntentFilter(Intent.ACTION_VIEW).apply {
                addDataScheme("https")
                addCategory(Intent.CATEGORY_BROWSABLE)
                addCategory(Intent.CATEGORY_DEFAULT)
            }

        /** The veil's request, by which the host finishes it. */
        const val VEIL = 7
    }
}
