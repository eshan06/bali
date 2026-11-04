package com.bali.spike.target

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Rational
import android.view.Gravity
import android.widget.TextView
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.sin

/**
 * A blocked app on demand, for the spike's "ways around the cover": `--es do tone|stop|pip|notify`
 * (`--ei delay <s>` for notify), and `--ez pipOnLeave true` to go into picture-in-picture at Home.
 * For lock (c), its internet: `--es do net|netstop|stream|streamstop|dns` (`--ei ms`, `--es host`,
 * `--es name`; see [Net]).
 */
class TargetActivity : Activity() {
    private var pipOnLeave = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "TARGET\na blocked app"
            textSize = 40f
            gravity = Gravity.CENTER
            setTextColor(Color.YELLOW)
            setBackgroundColor(Color.MAGENTA)
        })
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        if (intent.hasExtra("pipOnLeave")) pipOnLeave = intent.getBooleanExtra("pipOnLeave", false)
        val host = intent.getStringExtra("host") ?: "10.0.2.2:8787"
        when (intent.getStringExtra("do")) {
            "tone" -> startTone()
            "stop" -> playing = false
            "pip" -> enterPip()
            "notify" -> notifyLater(intent.getIntExtra("delay", 5))
            // Lock (c): this app's internet, probed, streamed and looked up.
            "net" -> Net.startProbes(host, intent.getIntExtra("ms", 100).toLong())
            "netstop" -> Net.stopProbes()
            "stream" -> Net.startStream(host)
            "streamstop" -> Net.stopStream()
            "dns" -> Net.dns(intent.getStringExtra("name") ?: "www.google.com")
        }
        intent.removeExtra("do")
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pipOnLeave) enterPip()
    }

    private fun enterPip() {
        val ok = enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())
        Log.i(TAG, "target-pip entered=$ok")
    }

    /** A tone that plays on whatever covers this app: it never pauses for anyone. */
    private fun startTone() {
        if (playing) return
        playing = true
        thread(name = "tone") {
            val rate = 44_100
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                )
                .build()
            val buffer = ShortArray(rate / 10)
            var phase = 0.0
            track.play()
            Log.i(TAG, "target-tone-start")
            while (playing) {
                for (i in buffer.indices) {
                    buffer[i] = (sin(phase) * 8000).toInt().toShort()
                    phase += 2 * PI * 440 / rate
                }
                track.write(buffer, 0, buffer.size)
            }
            track.stop()
            track.release()
            Log.i(TAG, "target-tone-stop")
        }
    }

    private fun notifyLater(delaySeconds: Int) {
        Handler(Looper.getMainLooper()).postDelayed({
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("ping", "Pings", NotificationManager.IMPORTANCE_HIGH))
            val open = PendingIntent.getActivity(
                this, 0, Intent(this, TargetActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
            )
            nm.notify(
                7,
                Notification.Builder(this, "ping").setContentTitle("Spike target")
                    .setContentText("Tap to open the target").setSmallIcon(android.R.drawable.star_on)
                    .setContentIntent(open).setAutoCancel(true).build(),
            )
            Log.i(TAG, "target-notified")
        }, delaySeconds * 1000L)
    }

    companion object {
        private const val TAG = "BaliSpikeTarget"

        @Volatile
        private var playing = false
    }
}
