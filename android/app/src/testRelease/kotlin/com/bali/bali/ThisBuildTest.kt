package com.bali.bali

import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking

/**
 * A Release build's start, on the JVM: while sign-in isn't set up it makes no engine, as on iOS, opening
 * nothing, where a Debug build's makes one over no token (DECISIONS 2026-11-05, Q2; BaliAppTest, on the
 * emulator); and it holds no readout, which lives in the Debug build alone (AN7d).
 */
class ThisBuildTest {
    @Test
    fun aReleaseBuildMakesNoEngineWithoutSignInAndHoldsNoReadout() {
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest): HttpAnswer = error("a Release build sent ${request.url}")
            }
        val engine = runBlocking { ThisBuild.unsigned("https://api.bali.test", transport, CoroutineScope(Job())) { error("a Release build opened the outbox") } }
        assertNull(engine)
        assertFailsWith<ClassNotFoundException> { Class.forName("com.bali.bali.ReadoutActivity") }
    }
}
