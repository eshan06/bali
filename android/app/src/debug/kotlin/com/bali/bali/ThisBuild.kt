package com.bali.bali

import android.app.Application
import android.content.Context
import android.os.IBinder
import android.os.Parcel
import android.os.Process
import com.bali.core.ApiClient
import com.bali.core.HttpTransport
import com.bali.core.TokenProvider
import com.bali.outbox.Outbox
import com.bali.outbox.SyncEngine
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
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

    /**
     * The renderer's service's own calls for a Debug build's tests (IsolatedRendererTest), in its isolated process ([RendererService],
     * [lock] its calls' lock, [app] that process's app): who it is ([WHO]: isolated or not, its process, and whether the app's start
     * made anything of Bali's there), its end as a crash would end it ([END]), and its calls held ([HOLD]) until let go ([LET_GO]).
     * Release's: none, so no Release build can be asked to end.
     */
    fun rendering(code: Int, reply: Parcel?, lock: Any, app: Application): Boolean {
        when (code) {
            WHO -> {
                val bali = app as BaliApp
                val made = listOf({ bali.notes }, { bali.router }, { bali.launched }).any { runCatching(it).isSuccess }
                reply?.run {
                    writeInt(if (Process.isIsolated()) 1 else 0)
                    writeInt(Process.myPid())
                    writeInt(if (made) 1 else 0)
                }
            }
            END -> Process.killProcess(Process.myPid())
            HOLD -> {
                val letGo = CountDownLatch(1).also { held.set(it) }
                val taken = CountDownLatch(1)
                thread {
                    synchronized(lock) {
                        taken.countDown()
                        letGo.await(HELD_AT_MOST, TimeUnit.SECONDS)
                    }
                }
                taken.await(HELD_AT_MOST, TimeUnit.SECONDS)
            }
            LET_GO -> held.getAndSet(null)?.countDown()
            else -> return false
        }
        return true
    }

    private val held = AtomicReference<CountDownLatch?>()

    const val WHO = IBinder.FIRST_CALL_TRANSACTION + 100
    const val END = IBinder.FIRST_CALL_TRANSACTION + 101
    const val HOLD = IBinder.FIRST_CALL_TRANSACTION + 102
    const val LET_GO = IBinder.FIRST_CALL_TRANSACTION + 103

    /** A hold left by a test that failed ends by itself. */
    private const val HELD_AT_MOST = 60L
}
