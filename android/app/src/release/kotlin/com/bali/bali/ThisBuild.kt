package com.bali.bali

import android.content.Context
import com.bali.core.HttpTransport
import com.bali.outbox.Outbox
import com.bali.outbox.SyncEngine
import kotlinx.coroutines.CoroutineScope

/** What a Release build adds to the app's start ([BaliApp.begin]): nothing, so no engine without sign-in, as on iOS (Q2): not set up ([started]). */
@Suppress("UNUSED_PARAMETER", "RedundantSuspendModifier")
internal object ThisBuild {
    suspend fun unsigned(api: String, transport: HttpTransport, scope: CoroutineScope, open: () -> Outbox): SyncEngine? = null

    suspend fun starting(context: Context, engine: SyncEngine) = Unit
}
