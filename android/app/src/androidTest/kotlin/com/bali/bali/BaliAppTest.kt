package com.bali.bali

import android.content.pm.FeatureInfo
import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.AppConfig
import com.bali.core.SendResult
import com.bali.outbox.AgeCheck
import com.bali.outbox.Link
import com.bali.outbox.SyncEngine
import com.bali.outbox.SyncState
import java.io.IOException
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The build's values as the app reads them on the phone: what core's AppConfigTest pins in the files,
 * here through aapt, the manifest and Android's reading of it; and what the app starts on them. Each start
 * here is the app's own, over its own file, which its start opened as the app was created.
 */
@RunWith(AndroidJUnit4::class)
class BaliAppTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val app = context.applicationContext as BaliApp

    // After the app's own start, its run ended: each test starts it again, as Try again would.
    @Before
    fun end(): Unit =
        runBlocking {
            app.launched.join()
            app.running.value?.job?.cancelAndJoin()
        }

    @After
    fun stop(): Unit =
        runBlocking {
            app.running.value?.job?.cancelAndJoin()
            ReadoutActivity.keep(context, false)
        }

    @Test
    fun everyValueArrivesAsTextAndWhileTheClientIdIsEmptySignInIsNotSetUp() {
        @Suppress("DEPRECATION")
        val meta = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
        // Each a string, never a number aapt read one as, which AppConfig would read as not set.
        val built = AppConfig.Key.entries.associate { it.key to checkNotNull(meta.getString(it.key)) { it.key } }
        val clientId = built.getValue(AppConfig.Key.CognitoClientId.key)
        assertEquals(clientId.isEmpty(), app.config == null)
        assertEquals(app.config == null, app.signIn == null)
        val config = checkNotNull(AppConfig.from(built + (AppConfig.Key.CognitoClientId.key to clientId.ifEmpty { "client" })))
        assertEquals(URI("com.bali.bali:/auth/callback"), config.cognito.redirectUri)
        // The portal's address since the owner's ruling (2026-11-07, #540).
        assertEquals(URI("https://app.getbali.app"), config.portal)
    }

    // NFC required (the owner, 2026-11-10), so Play offers Bali to phones with NFC alone. Play's filter alone: an install
    // over adb still goes on a phone with none, as on these emulators, where the suite runs at all.
    @Test
    fun theInstalledManifestRequiresNfc() {
        @Suppress("DEPRECATION")
        val features = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_CONFIGURATIONS).reqFeatures.orEmpty()
        val nfc = features.single { it.name == PackageManager.FEATURE_NFC }
        assertEquals(FeatureInfo.FLAG_REQUIRED, nfc.flags and FeatureInfo.FLAG_REQUIRED)
    }

    // The build's client id stays empty until the owner's (docs/DEPLOY.md): until then a Debug build's start
    // runs an engine all the same, over no token, as a signed-out phone (Q2), where a Release build's makes
    // none, as on iOS (ThisBuildTest, on the JVM). Its file is the app's own, opened as the app started, in the
    // tests' process too, which is why each test that opens an outbox opens a file of its own.
    @Test
    fun withSignInNotSetUpADebugBuildsStartRunsAnEngineOverNoTokenAsASignedOutPhone(): Unit =
        runBlocking {
            assertNull(app.signIn)
            assertNull(app.startFailed.value)
            assertTrue(context.getDatabasePath(OUTBOX_FILE).exists())
            app.begin()
            val engine = checkNotNull(app.running.value).engine
            // An engine with no sign-in has no account half to run.
            assertNull(checkNotNull(app.running.value).account)
            // The truth read, as Bali in front reads it: never sent, for want of a token, so waiting on sign-in.
            engine.setInFront(true)
            until { engine.updates.value.takeIf { it.link == Link.SignIn } }
            assertNull(engine.updates.value.heardAt)
        }

    // CLAUDE.md's "no silent failures": a start that fails (its outbox, say) is held for a screen to say, the
    // Debug readout's now (ReadoutTest), never swallowed, and tried again.
    @Test
    fun aStartThatFailsIsHeldForTheScreensToSayAndTriedAgain(): Unit =
        runBlocking {
            val refused = IOException("the disk refused the outbox")
            app.begin { throw refused }
            assertSame(refused, app.startFailed.value)
            assertNull(app.running.value)
            app.begin()
            checkNotNull(app.running.value)
            assertNull(app.startFailed.value)
        }

    // BaliApp.swift's `start` guards both: a start while a run exists, or while another start is under way
    // (Try again pressed twice), makes nothing and opens nothing, so no second engine replaces the first.
    @Test
    fun aStartMakesNothingWhileARunExistsOrAnotherStartIsUnderWay(): Unit =
        runBlocking {
            app.begin()
            val run = checkNotNull(app.running.value)
            app.begin { error("a start opened the outbox while a run exists") }
            assertSame(run, app.running.value)
            assertNull(app.startFailed.value)
            run.job.cancelAndJoin()
            // A start held at its outbox: a second one meanwhile returns at once. Held at most 30 s, so a failure
            // here ends the test rather than hanging it.
            val entered = CountDownLatch(1)
            val opening = CountDownLatch(1)
            val refused = IOException("the disk refused the outbox")
            val first =
                launch(Dispatchers.IO) {
                    app.begin {
                        entered.countDown()
                        opening.await(30, TimeUnit.SECONDS)
                        throw refused
                    }
                }
            assertTrue(entered.await(30, TimeUnit.SECONDS))
            app.begin { error("a second start opened the outbox") }
            assertNull(app.startFailed.value)
            opening.countDown()
            first.join()
            assertSame(refused, app.startFailed.value)
            assertNull(app.running.value)
            // Tried again, it starts.
            app.begin()
            assertNull(app.startFailed.value)
        }

    // B5b's phone check, as BaliApp.swift's start sets it: the readout's cap, kept, is read at each start.
    @Test
    fun theReadoutsShortCapIsReadAtEachStart(): Unit =
        runBlocking {
            ReadoutActivity.keep(context, true)
            app.begin()
            assertEquals(ReadoutActivity.SHORT_CAP, checkNotNull(app.running.value).engine.updates.value.cap)
            checkNotNull(app.running.value).job.cancelAndJoin()
            ReadoutActivity.keep(context, false)
            app.begin()
            assertEquals(SyncState.TAP_CAP, checkNotNull(app.running.value).engine.updates.value.cap)
        }

    // BaliApp.swift's start: one account a run, over the engine's sign-in, run in the run's job, which hooks the 13+ check's
    // ask at each of the engine's wakes and follows each sign-in. Over a sign-in, a server and a file of the test's own
    // (TestSignIn.kt), as none of the emulators can sign in.
    @Test
    fun aRunsStartRunsItsAccountWhichFollowsEachSignInAndAsksBaliForTheCheckAgainAtEachWake(): Unit =
        runBlocking {
            val server = Server()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            context.deleteDatabase(FILE)
            val outbox = context.outbox(FILE)
            try {
                val signIn = testSignIn(server, scope)
                val engine = SyncEngine.make(outbox, URI(API), signIn, scope, server)
                app.start(engine, scope)
                val account = checkNotNull(checkNotNull(app.running.value).account)
                until { account.state.value.takeIf { it.signedIn == false } }
                server.signStudentIn(signIn, scope, "student-1")
                // Not through the check: Bali asked under the student's own account, the starting mark meanwhile.
                val first = server.next(AGE_CHECK)
                assertEquals("Bearer ${accessToken("student-1")}", first.token)
                until { account.state.value.takeIf { it.signedIn == true && it.age == AgeCheck.Answer.Checking } }
                // The sign-in's own wake over (its read found no token) before Bali goes unanswered: asked again at the next.
                until { engine.updates.value.takeIf { it.meFailed == SendResult.NetworkError } }
                first.drop()
                until { account.state.value.takeIf { it.age == AgeCheck.Answer.Unanswered } }
                engine.retryNow()
                server.next(AGE_CHECK).reply(200, PASSED)
                until { account.state.value.takeIf { it.age == AgeCheck.Answer.Passed } }
                // Through: Bali's API given the student's token.
                assertEquals("Bearer ${accessToken("student-1")}", server.next("GET /v1/me").token)
                // Signed out, then another student signed in: each followed, the other asked under their own account.
                signIn.signOut()
                until { account.state.value.takeIf { it.signedIn == false } }
                server.signStudentIn(signIn, scope, "student-2")
                assertEquals("Bearer ${accessToken("student-2")}", server.next(AGE_CHECK).token)
                until { account.state.value.takeIf { it.signedIn == true && it.age == AgeCheck.Answer.Checking } }
            } finally {
                // Everything that reads the file ended before it closes (the engine rig's teardown, AN5c).
                withTimeout(30.seconds) { scope.coroutineContext.job.cancelAndJoin() }
                server.close()
                outbox.close()
                context.deleteDatabase(FILE)
            }
        }

    private companion object {
        const val FILE = "bali-app-test.sqlite"
    }
}
