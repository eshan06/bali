package com.bali.student.service

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bali.student.MainActivity
import com.bali.student.data.focus.FocusModeStore
import com.bali.student.ui.theme.BaliBackground
import com.bali.student.ui.theme.BaliTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Full-screen block screen launched by the accessibility service when a
 * blocked app comes to the foreground during an active class session.
 */
@AndroidEntryPoint
class BlockActivity : ComponentActivity() {

    @Inject lateinit var focusModeStore: FocusModeStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // System Back goes to Bali, never back to the blocked app.
        onBackPressedDispatcher.addCallback(this) { returnToBali() }

        val blockedPackage = intent.getStringExtra(EXTRA_BLOCKED_PACKAGE).orEmpty()
        val blockedAppName = lookupAppLabel(blockedPackage)

        setContent {
            BaliTheme {
                val policy by focusModeStore.policy.collectAsState(initial = null)
                BlockContent(
                    blockedAppName = blockedAppName,
                    className = policy?.className,
                    onReturnToBali = ::returnToBali,
                    onViewFocusMode = ::viewFocusMode,
                )
            }
        }
    }

    private fun lookupAppLabel(pkg: String): String {
        if (pkg.isBlank()) return "This app"
        return try {
            val info = packageManager.getApplicationInfo(pkg, 0)
            packageManager.getApplicationLabel(info).toString()
        } catch (_: PackageManager.NameNotFoundException) {
            "This app"
        }
    }

    private fun returnToBali() {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(intent)
        finish()
    }

    private fun viewFocusMode() {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(EXTRA_OPEN_FOCUS_MODE, true)
        }
        startActivity(intent)
        finish()
    }

    companion object {
        const val EXTRA_BLOCKED_PACKAGE = "blocked_package"
        const val EXTRA_OPEN_FOCUS_MODE = "open_focus_mode"
    }
}

@Composable
private fun BlockContent(
    blockedAppName: String,
    className: String?,
    onReturnToBali: () -> Unit,
    onViewFocusMode: () -> Unit,
) {
    BaliBackground {
        Box(
            modifier = Modifier.fillMaxSize().padding(28.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    "FOCUS MODE",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Focus Mode Active",
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(12.dp))
                val classText = className?.let { " during $it" } ?: ""
                Text(
                    "$blockedAppName is blocked$classText.",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Your teacher's session is still running. You'll regain access when class ends.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(28.dp))
                Button(
                    onClick = onReturnToBali,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text("Return to Bali")
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(
                    onClick = onViewFocusMode,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text("View Focus Mode")
                }
            }
        }
    }
}
