package com.bali.bali

import android.content.Context
import com.bali.core.ApiClient
import com.bali.core.HttpTransport
import com.bali.core.TokenProvider
import com.bali.outbox.Outbox
import com.bali.outbox.SyncEngine
import java.net.URI
import kotlinx.coroutines.CoroutineScope

/** What a Debug build adds to the app's start ([BaliApp.begin]), for the phone checks and the Debug readout (AN7d). */
internal object ThisBuild {
    /**
     * While sign-in isn't set up (the client id empty until the owner's), an engine all the same (DECISIONS
     * 2026-11-05, Q2): over no token at [api], the build's, as a signed-out phone, so nothing is ever sent and a
     * typed tap locks offline to its cap; over the outbox [open] gives, its calls in [scope]. Release's: none.
     */
    suspend fun unsigned(api: String, transport: HttpTransport, scope: CoroutineScope, open: () -> Outbox): SyncEngine? =
        SyncEngine.open(open(), ApiClient(URI(api), NoToken, transport), scope)

    /** No token, ever: a signed-out phone's, each send answered as no token, nothing on the wire. */
    private object NoToken : TokenProvider {
        override suspend fun accessToken(): String? = null
    }

    /** At each start, the readout's cap on a tap not yet answered (B5b's phone check), as BaliApp.swift's start sets it. */
    suspend fun starting(context: Context, engine: SyncEngine) = engine.setTapCap(ReadoutActivity.cap(context))
}
