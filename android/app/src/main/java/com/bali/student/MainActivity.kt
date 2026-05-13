package com.bali.student

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.amplifyframework.core.Amplify
import com.bali.student.nfc.NfcReader
import com.bali.student.ui.nav.BaliNavHost
import com.bali.student.ui.theme.BaliTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var nfcReader: NfcReader

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            BaliApp()
        }
    }

    override fun onResume() {
        super.onResume()
        nfcReader.enableReader(this)
    }

    override fun onPause() {
        super.onPause()
        nfcReader.disableReader(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Amplify.Auth.handleWebUISignInResponse(intent)
    }
}

@Composable
private fun BaliApp() {
    BaliTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            BaliNavHost()
        }
    }
}
