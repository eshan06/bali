package com.bali.bali

import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.outbox.Problem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking

/**
 * A Release build's start, on the JVM: while sign-in isn't set up it makes no engine, as on iOS, opening
 * nothing, where a Debug build's makes one over no token (DECISIONS 2026-11-05, Q2; BaliAppTest, on the
 * emulator), and says so: not set up, AN10a's problem for the router's storage screen (AN10c). And it holds
 * no readout, which lives in the Debug build alone (AN7d).
 */
class ThisBuildTest {
    private val transport =
        object : HttpTransport {
            override suspend fun send(request: HttpRequest): HttpAnswer = error("a Release build sent ${request.url}")
        }

    private suspend fun unsigned() = ThisBuild.unsigned("https://api.bali.test", transport, CoroutineScope(Job())) { error("a Release build opened the outbox") }

    @Test
    fun aReleaseBuildMakesNoEngineWithoutSignInAndHoldsNoReadout() {
        assertNull(runBlocking { unsigned() })
        assertFailsWith<ClassNotFoundException> { Class.forName("com.bali.bali.ReadoutActivity") }
    }

    @Test
    fun aReleaseBuildsStartWithNoConfigSaysItIsNotSetUpAndRunsNothing() {
        // BaliApp's start over this build's own engine where sign-in isn't set up (BaliApp.begin): none, so not set up.
        val said = runBlocking { started({ unsigned() }) { error("a Release build ran an engine") } }
        assertEquals(Problem.NotSetUp, said)
    }
}
