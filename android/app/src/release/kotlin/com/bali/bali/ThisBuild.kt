package com.bali.bali

import android.app.Application
import android.content.Context
import android.os.Parcel
import com.bali.core.HttpTransport
import com.bali.outbox.Outbox
import com.bali.outbox.SyncEngine
import kotlinx.coroutines.CoroutineScope

/**
 * What a Release build adds to the app's start ([BaliApp.begin]): nothing, so no engine without sign-in, as on iOS (Q2): not set up
 * ([started]); and to the renderer's service, nothing.
 */
@Suppress("UNUSED_PARAMETER", "RedundantSuspendModifier")
internal object ThisBuild {
    suspend fun unsigned(api: String, transport: HttpTransport, scope: CoroutineScope, open: () -> Outbox): SyncEngine? = null

    suspend fun starting(context: Context, engine: SyncEngine) = Unit

    /** The renderer's service answers none of a Debug build's test calls: none can ask it to end. */
    fun rendering(code: Int, reply: Parcel?, lock: Any, app: Application): Boolean = false
}
