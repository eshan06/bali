package com.bali.spike

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.nfc.NdefMessage
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The spike's one screen: the session, each lock's state, Emergency Unlock and the NFC reader.
 * adb drives it too: `am start -n com.bali.spike/.MainActivity --es cmd start --es mode b
 * --ei minutes 50 --ei poll 250`, `--es cmd end`, `--es tickHost 10.0.2.2:8787`.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var nfcText: TextView
    private val main = Handler(Looper.getMainLooper())
    private var reading = false
    private val refresh = object : Runnable {
        override fun run() {
            render()
            main.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Session.init(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 140, 40, 80)
        }
        status = TextView(this).apply { textSize = 13f }
        column.addView(status)
        fun button(label: String, action: () -> Unit) =
            column.addView(Button(this).apply {
                text = label
                setOnClickListener { action() }
            })
        button("Start (a), 50 min") { startLock(Session.A, 50, 0) }
        button("Start (b), poll 250 ms, 50 min") { startLock(Session.B, 50, 250) }
        button("Start (b), poll 500 ms, 50 min") { startLock(Session.B, 50, 500) }
        button("Start (b), poll 1 s, 50 min") { startLock(Session.B, 50, 1000) }
        column.addView(holdToUnlock(this, "app"))
        button("End session") { Session.end("app") }
        button("Accessibility settings") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        button("Usage access settings") { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
        button("Display over other apps") {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        button("Read a block (NFC)") { readBlock() }
        nfcText = TextView(this).apply { textSize = 16f }
        column.addView(nfcText)
        setContentView(ScrollView(this).apply { addView(column) })
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        intent.getStringExtra("tickHost")?.let { Session.setTickHost(it) }
        when (intent.getStringExtra("cmd")) {
            "start" -> startLock(
                intent.getStringExtra("mode") ?: Session.A,
                intent.getIntExtra("minutes", 50),
                intent.getIntExtra("poll", 500).toLong(),
            )
            "end" -> Session.end("adb")
        }
        intent.removeExtra("cmd")
        if (intent.action == NfcAdapter.ACTION_NDEF_DISCOVERED) {
            @Suppress("DEPRECATION")
            val messages = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES)
                ?.filterIsInstance<NdefMessage>().orEmpty()
            val code = BlockTag.code(messages.flatMap { m -> m.records.map { BlockTag.Record(it.tnf.toInt(), it.type, it.payload) } })
            Spike.log("nfc-intent", "code" to code, "data" to intent.data)
            nfcText.text = "Opened by a tag: ${code?.let { "block $it" } ?: "not a Bali block"}"
        }
    }

    private fun startLock(lock: String, minutes: Int, poll: Long) {
        Session.start(lock, minutes, poll)
        if (lock == Session.B) startForegroundService(Intent(this, PollService::class.java))
        render()
    }

    override fun onResume() {
        super.onResume()
        Spike.log("app-front", "session" to Session.describe(), "protection" to Protection.summary(this))
        // As Bali comes to the front it checks its own lock, and says when it's off.
        if (Session.active() && !Protection.on(this)) {
            Spike.log("protection-off-found", "lock" to Session.mode, "protection" to Protection.summary(this))
            if (Session.mode == Session.B && Protection.usageAccess(this) && Protection.overlay(this)) {
                startForegroundService(Intent(this, PollService::class.java))
                Spike.log("lock-restarted", "lock" to Session.B, "by" to "app-front")
            }
        }
        main.post(refresh)
    }

    override fun onPause() {
        main.removeCallbacks(refresh)
        stopReading()
        super.onPause()
    }

    private fun render() {
        val allow = AllowList.compute(this)
        status.text = buildString {
            appendLine("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("Session: ${Session.describe()}")
            appendLine("Protection: ${Protection.summary(this@MainActivity)}")
            appendLine("Tick host: ${Session.tickHost}")
            appendLine("Never covered:")
            allow.forEach { (pkg, why) -> appendLine("  $pkg ($why)") }
        }
    }

    private fun readBlock() {
        val adapter = NfcAdapter.getDefaultAdapter(this)
        if (adapter == null) {
            nfcText.text = "This phone can't read NFC."
            Spike.log("nfc-unavailable")
            return
        }
        if (!adapter.isEnabled) {
            nfcText.text = "NFC is off. Turn it on in Settings, then try again."
            Spike.log("nfc-off")
            return
        }
        reading = true
        nfcText.text = "Hold your phone to the block."
        val readerOn = SystemClock.elapsedRealtime()
        Spike.log("nfc-reader-on")
        adapter.enableReaderMode(
            this, { tag -> onTag(tag, readerOn) },
            NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
                NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V,
            null,
        )
    }

    private fun onTag(tag: Tag, readerOn: Long) {
        val found = SystemClock.elapsedRealtime()
        val message = try {
            Ndef.get(tag)?.use { ndef ->
                ndef.connect()
                ndef.ndefMessage
            }
        } catch (e: Exception) {
            Spike.log("nfc-read-failed", "err" to "${e.javaClass.simpleName}:${e.message}", "tech" to tag.techList.joinToString("|"))
            runOnUiThread { nfcText.text = "Couldn't read the tag. Hold your phone to it again." }
            return
        }
        val records = message?.records?.map { BlockTag.Record(it.tnf.toInt(), it.type, it.payload) }.orEmpty()
        val code = BlockTag.code(records)
        Spike.log(
            "nfc-read", "code" to code, "records" to records.size, "readMs" to (SystemClock.elapsedRealtime() - found),
            "sinceReaderOnMs" to (found - readerOn), "tech" to tag.techList.joinToString("|") { it.substringAfterLast('.') },
        )
        runOnUiThread { nfcText.text = code?.let { "Block $it" } ?: "Not a Bali block." }
    }

    private fun stopReading() {
        if (!reading) return
        reading = false
        NfcAdapter.getDefaultAdapter(this)?.disableReaderMode(this)
        Spike.log("nfc-reader-off")
    }
}
