package com.bali.bali

import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.AppConfig
import com.bali.outbox.Link
import com.bali.outbox.SyncState
import java.io.IOException
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
}
