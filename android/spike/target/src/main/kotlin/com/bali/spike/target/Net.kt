package com.bali.spike.target

import android.util.Log
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * The stand-in app's internet, for lock (c): a probe of the host every [intervalMs], each on its
 * own thread with 1 s timeouts, so one stuck in the tunnel never holds back the next; a stream
 * opened before a session, as a video already playing; and a DNS look-up. Every result is one
 * `BaliSpikeTarget` line with the probe's start on the phone's clock.
 */
object Net {
    private const val TAG = "BaliSpikeTarget"
    private val probing = AtomicBoolean(false)
    private val streaming = AtomicBoolean(false)
    private val pool = Executors.newCachedThreadPool()
    private val n = AtomicInteger()

    @Volatile
    var last = "not tried"
        private set

    fun startProbes(host: String, intervalMs: Long) {
        if (!probing.compareAndSet(false, true)) return
        Log.i(TAG, "target-net-start host=$host intervalMs=$intervalMs")
        thread(name = "probes") {
            while (probing.get()) {
                val i = n.incrementAndGet()
                val start = System.currentTimeMillis()
                pool.execute { probe(host, i, start) }
                Thread.sleep(intervalMs)
            }
        }
    }

    fun stopProbes() {
        if (probing.compareAndSet(true, false)) Log.i(TAG, "target-net-stop")
    }

    private fun probe(host: String, i: Int, start: Long) {
        val result = try {
            val c = URL("http://$host/probe?n=$i").openConnection() as HttpURLConnection
            c.connectTimeout = 1000
            c.readTimeout = 1000
            c.useCaches = false
            c.setRequestProperty("Connection", "close")
            val code = c.responseCode
            c.disconnect()
            "ok=true code=$code"
        } catch (e: Exception) {
            "ok=false err=${e.javaClass.simpleName}:${e.message?.replace(' ', '_')}"
        }
        last = result.substringBefore(" code").substringBefore(" err")
        Log.i(TAG, "target-net n=$i start=$start ms=${System.currentTimeMillis() - start} $result")
    }

    /** A long download from the host, opened before the session: does it stop, and when? */
    fun startStream(host: String) {
        if (!streaming.compareAndSet(false, true)) return
        thread(name = "stream") {
            var total = 0L
            var lastByte = 0L
            try {
                val c = URL("http://$host/stream").openConnection() as HttpURLConnection
                c.connectTimeout = 3000
                c.readTimeout = 3000
                val input = c.inputStream
                Log.i(TAG, "target-stream-open code=${c.responseCode} wall=${System.currentTimeMillis()}")
                val buffer = ByteArray(8192)
                var logged = 0L
                while (streaming.get()) {
                    val read = input.read(buffer)
                    if (read < 0) {
                        Log.i(TAG, "target-stream-ended total=$total lastByteWall=$lastByte wall=${System.currentTimeMillis()}")
                        break
                    }
                    total += read
                    lastByte = System.currentTimeMillis()
                    if (lastByte - logged >= 1000) {
                        Log.i(TAG, "target-stream bytes=$total wall=$lastByte")
                        logged = lastByte
                    }
                }
                c.disconnect()
            } catch (e: Exception) {
                Log.i(
                    TAG, "target-stream-broken err=${e.javaClass.simpleName}:${e.message?.replace(' ', '_')} " +
                        "total=$total lastByteWall=$lastByte wall=${System.currentTimeMillis()}",
                )
            }
            streaming.set(false)
        }
    }

    fun stopStream() = streaming.set(false)

    fun dns(name: String) = thread(name = "dns") {
        val start = System.currentTimeMillis()
        val result = try {
            "ok=true addrs=${InetAddress.getAllByName(name).size}"
        } catch (e: Exception) {
            "ok=false err=${e.javaClass.simpleName}:${e.message?.replace(' ', '_')}"
        }
        Log.i(TAG, "target-dns name=$name start=$start ms=${System.currentTimeMillis() - start} $result")
    }
}
