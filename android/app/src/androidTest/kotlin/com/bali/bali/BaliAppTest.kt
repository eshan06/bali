package com.bali.bali

import android.content.pm.FeatureInfo
import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.AppConfig
import com.bali.core.SendResult
import com.bali.core.SignIn
import com.bali.outbox.Account
import com.bali.outbox.AgeCheck
import com.bali.outbox.Change
import com.bali.outbox.Deleting
import com.bali.outbox.Link
import com.bali.outbox.Outbox
import com.bali.outbox.Problem
import com.bali.outbox.Screen
import com.bali.outbox.SyncEngine
import com.bali.outbox.SyncState
import java.io.File
import java.io.IOException
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
            assertNull(app.problem.value)
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

    // CLAUDE.md's "no silent failures": a start that runs nothing says why, each problem its type (AN10a's), held for the
    // screens to say, the app's router showing it as the storage screen and the Debug readout now (ReadoutTest), never
    // swallowed, and tried again. A start that fails (its outbox, say) keeps its cause; one that makes no engine, a Release
    // build's with no config (ThisBuildTest, on the JVM), is not set up.
    @Test
    fun aStartThatRunsNothingSaysWhyEachProblemItsTypeTheRoutersStorageScreenShowingItAndIsTriedAgain(): Unit =
        runBlocking {
            val refused = IOException("the disk refused the outbox")
            for (problem in listOf(Problem.StartFailed(refused), Problem.NotSetUp)) {
                app.begin { if (problem == Problem.NotSetUp) null else throw refused }
                assertEquals(problem, app.problem.value)
                assertNull(app.running.value)
                until { app.router.shown.value.takeIf { it == Screen.Shown(Screen.Storage(problem), false) } }
                app.begin()
                checkNotNull(app.running.value)
                assertNull(app.problem.value)
                until { app.router.shown.value.takeIf { it.screen != Screen.Storage(problem) } }
                checkNotNull(app.running.value).job.cancelAndJoin()
            }
        }

    // BaliApp.swift's `start` guards both: a start while a run exists, or while another start is under way
    // (Try again pressed twice), makes nothing and opens nothing, so no second engine replaces the first.
    @Test
    fun aStartMakesNothingWhileARunExistsOrAnotherStartIsUnderWay(): Unit =
        runBlocking {
            app.begin()
            val run = checkNotNull(app.running.value)
            app.begin { error("a start made an engine while a run exists") }
            assertSame(run, app.running.value)
            assertNull(app.problem.value)
            run.job.cancelAndJoin()
            // A start held at its making: a second one meanwhile returns at once. Held at most 30 s, so a failure
            // here ends the test rather than hanging it.
            val entered = CountDownLatch(1)
            val making = CountDownLatch(1)
            val refused = IOException("the disk refused the outbox")
            val first =
                launch(Dispatchers.IO) {
                    app.begin {
                        entered.countDown()
                        making.await(30, TimeUnit.SECONDS)
                        throw refused
                    }
                }
            assertTrue(entered.await(30, TimeUnit.SECONDS))
            app.begin { error("a second start made an engine") }
            assertNull(app.problem.value)
            making.countDown()
            first.join()
            assertEquals(Problem.StartFailed(refused), app.problem.value)
            assertNull(app.running.value)
            // Tried again, it starts.
            app.begin()
            assertNull(app.problem.value)
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
    // (TestSignIn.kt), as none of the emulators can sign in. The app's router reads the run's account (AN10c), so a wake asks
    // again only where the question can't show: here over Focus, a tap waiting on the check holding the lock (AN10b).
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
                engine.record(Change.Tap("tag"))
                until { app.router.shown.value.takeIf { it.screen == Screen.Focus } }
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

    // AN10b's notes in the app's own store (AN10c), handed to each run's account: what one run keeps, a later run reads back, the
    // store's file the app's own SharedPreferences, whose domain the backup rules leave out (OutboxFileTest); once the account is
    // deleted, none, off the disk too, and a later run reads none. Over sign-ins, a server and a file of the test's own.
    @Test
    fun theNotesARunKeepsALaterRunReadsBackAndOnceTheAccountIsDeletedNoneOffTheDiskTooAndALaterRunReadsNone(): Unit =
        runBlocking {
            val server = Server()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            context.deleteDatabase(FILE)
            val outbox = context.outbox(FILE)
            val found = app.notes.run { inClass to listSeenBy }
            val file = File(context.dataDir, "shared_prefs/$NOTES_FILE.xml")
            try {
                app.notes.forgetStudent()
                // A run: the student listed in a class here, then shown the consent list.
                val (signIn, account) = run(outbox, server, scope)
                server.signStudentIn(signIn, scope, "u1", mayDelete = true)
                server.next(AGE_CHECK).reply(200, PASSED)
                server.next("GET /v1/me").reply(200, ME)
                until { account.state.value.takeIf { it.inClass == "u1" && it.sync?.me != null } }
                account.sawList()
                assertEquals(listOf("u1", "u1"), app.notes.run { listOf(inClass, listSeenBy) })
                // Written behind: on the disk once the write lands.
                until { disk(file)?.takeIf { """name="inClass">u1<""" in it && """name="listSeenBy">u1<""" in it } }
                // A later run, nobody signed in: its account reads them back.
                val (again, later) = run(outbox, server, scope)
                assertEquals(listOf("u1", "u1"), later.state.value.run { listOf(inClass, listSeenBy) })
                // The student signs in there and deletes the account: none, off the disk too, and a later run reads none.
                server.signStudentIn(again, scope, "u1", mayDelete = true)
                server.next(AGE_CHECK).reply(200, PASSED)
                later.deleting { it.ask() }
                val deleting = scope.async { later.deleteAccount() }
                // Its first request on its way: the notes already off the disk, written through.
                val delete = server.pastReads("DELETE /v1/me")
                until { disk(file) }.let { assertFalse(it, "u1" in it) }
                delete.reply(200, """{"outcome":"deleted"}""")
                server.next("POST /").reply(200, "{}")
                withTimeout(30.seconds) { deleting.await() }
                assertEquals(Deleting.Done, later.state.value.deleting)
                assertEquals(listOf(null, null), app.notes.run { listOf(inClass, listSeenBy) })
                until { disk(file) }.let { assertFalse(it, "u1" in it) }
                val (_, last) = run(outbox, server, scope)
                assertEquals(listOf(null, null), last.state.value.run { listOf(inClass, listSeenBy) })
            } finally {
                // Everything that reads the file ended before it closes (the engine rig's teardown, AN5c); the notes put back.
                app.running.value?.job?.cancelAndJoin()
                withTimeout(30.seconds) { scope.coroutineContext.job.cancelAndJoin() }
                server.close()
                outbox.close()
                context.deleteDatabase(FILE)
                app.notes.inClass = found.first
                app.notes.listSeenBy = found.second
            }
        }

    /** The app's run started over [outbox] afresh, as a relaunch starts one, the last ended first: a sign-in of the test's own, nobody signed in. */
    private suspend fun run(outbox: Outbox, server: Server, scope: CoroutineScope): Pair<SignIn, Account> {
        app.running.value?.job?.cancelAndJoin()
        val signIn = testSignIn(server, scope)
        app.start(SyncEngine.make(outbox, URI(API), signIn, scope, server), scope)
        val account = checkNotNull(checkNotNull(app.running.value).account)
        until { account.state.value.takeIf { it.signedIn == false } }
        return signIn to account
    }

    /** [file]'s text, or none while SharedPreferences has it moved aside to write it (the router's own notes write behind too). */
    private fun disk(file: File): String? = runCatching { file.readText() }.getOrNull()

    /** Each read of the truth answered with [ME] until a request to [route] waits: a deletion waits out the reads on their way (AN9b). */
    private fun Server.pastReads(route: String): Server.Exchange =
        until {
            if ("GET /v1/me" in waiting) next("GET /v1/me").reply(200, ME)
            if (route in waiting) next(route) else null
        }

    private companion object {
        const val FILE = "bali-app-test.sqlite"

        /** `GET /v1/me`'s answer: student u1, named, in a class. */
        const val ME =
            """{"user":{"id":"u1","role":"student","displayName":"Ana"},"classes":[{"id":"c","name":"Period 3","teacher":{"displayName":"Ms. Rivera"}}],"session":null}"""
    }
}
