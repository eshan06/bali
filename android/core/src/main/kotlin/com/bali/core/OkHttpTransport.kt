package com.bali.core

import java.io.IOException
import java.util.concurrent.TimeUnit.MILLISECONDS
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink

/**
 * The app's transport, over OkHttp: BaliCore's `URLSessionTransport`, set up as its `makeSession`
 * sets iOS's ([makeClient]). A 3xx comes back as itself, never followed, and a request with a body
 * goes once ([Once]), whatever comes back, for the outbox to judge.
 */
class OkHttpTransport internal constructor(private val client: OkHttpClient) : HttpTransport {
    constructor() : this(makeClient())

    override suspend fun send(request: HttpRequest): HttpAnswer {
        val call = call(request)
        return suspendCancellableCoroutine { waiting ->
            waiting.invokeOnCancellation { call.cancel() }
            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: IOException) = waiting.resumeWithException(e)

                    override fun onResponse(call: Call, response: Response) {
                        // Read whole on OkHttp's thread, never the caller's.
                        val answer =
                            try {
                                response.use { HttpAnswer(it.code, it.headers.toMap(), it.body.bytes()) }
                            } catch (error: IOException) {
                                return waiting.resumeWithException(error)
                            }
                        waiting.resume(answer)
                    }
                },
            )
        }
    }

    /** [request] as OkHttp's call; an [IOException] for one OkHttp can't send as it was built. */
    private fun call(request: HttpRequest): Call {
        val url = request.url.toString().toHttpUrlOrNull() ?: throw IOException("not an HTTP URL")
        // OkHttp resolves a path segment of dots, `%2E%2E` as `..`, which no escaping can keep from
        // it: so a code typed as `..` is no answer here, never a request to the path above.
        if (url.encodedPath != request.url.rawPath) throw IOException("a path OkHttp would change")
        val built =
            try {
                Request.Builder().url(url).method(request.method, request.body?.let(::Once))
                    .apply { request.headers.forEach { (name, value) -> header(name, value) } }.build()
            } catch (error: IllegalArgumentException) {
                throw IOException("a request OkHttp can't send")
            }
        // The request's own waits, on a copy sharing the client's connections and threads.
        return client.newBuilder().waiting(request.timeout).build().newCall(built)
    }

    companion object {
        /** How long a whole exchange may take, however steadily its bytes arrive. */
        val EXCHANGE_TIMEOUT: Duration = 30.seconds

        /**
         * No cache and no cookies: nothing about a student is kept, and a read of the truth is never
         * answered from a store. A request's wait for its next byte is bounded, and a whole
         * exchange. No redirect is followed: a 307 or 308 would carry a request's body to whichever
         * host its `Location` names, a 301 or 302 make a POST a GET, and the API never redirects.
         * OkHttp's recovery stays on for a read, sent again on a fresh connection when its pooled
         * one turns out closed, as URLSession sends one; a request with a body never ([Once]).
         */
        internal fun makeClient(): OkHttpClient =
            OkHttpClient.Builder()
                .cache(null)
                .cookieJar(CookieJar.NO_COOKIES)
                .waiting(ApiClient.REQUEST_TIMEOUT)
                .callTimeout(EXCHANGE_TIMEOUT.inWholeMilliseconds, MILLISECONDS)
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(true)
                .build()

        /** Each of a request's waits, for a connection, to send and for the next byte, [timeout]. */
        private fun OkHttpClient.Builder.waiting(timeout: Duration) =
            connectTimeout(timeout.inWholeMilliseconds, MILLISECONDS)
                .writeTimeout(timeout.inWholeMilliseconds, MILLISECONDS)
                .readTimeout(timeout.inWholeMilliseconds, MILLISECONDS)
    }
}

/** A body OkHttp sends at most once (its own switch): never again after a 408, a 503 or a dropped connection. */
private class Once(private val bytes: ByteArray) : RequestBody() {
    override fun contentType(): MediaType? = null // The client's own Content-Type header goes.
    override fun contentLength() = bytes.size.toLong()
    override fun isOneShot() = true
    override fun writeTo(sink: BufferedSink) { sink.write(bytes) }
}
