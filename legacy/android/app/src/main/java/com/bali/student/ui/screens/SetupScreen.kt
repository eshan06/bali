package com.bali.student.ui.screens

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.prefs.StudentPrefs
import com.bali.student.permissions.NfcStatus
import com.bali.student.permissions.PermissionChecks
import com.bali.student.permissions.PermissionsSnapshot
import com.bali.student.service.FocusAccessibilityService
import com.bali.student.ui.theme.AccentAmber
import com.bali.student.ui.theme.AccentGreen
import com.bali.student.ui.theme.AccentRed
import com.bali.student.ui.theme.AmberTint
import com.bali.student.ui.theme.BaliBackground
import com.bali.student.ui.theme.GreenTint
import com.bali.student.ui.theme.NeutralTint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SetupViewModel @Inject constructor(
    private val prefs: StudentPrefs,
) : ViewModel() {
    fun markSetupComplete(onDone: () -> Unit) {
        viewModelScope.launch {
            prefs.setSetupComplete(true)
            onDone()
        }
    }
}

private enum class RowAction {
    OpenAccessibilitySettings,
    RequestNotifications,
    OpenBatterySettings,
    OpenNfcSettings,
    None,
}

private data class SetupRow(
    val title: String,
    val description: String,
    val status: RowStatus,
    val action: RowAction,
)

private data class RowStatus(
    val label: String,
    val ok: Boolean,
    val unavailable: Boolean = false,
)

@Composable
fun SetupScreen(
    onContinue: () -> Unit,
    vm: SetupViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val snapshot = rememberPermissionSnapshot(context)
    val rows = remember(snapshot) { buildRows(snapshot) }

    val notificationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { /* status is re-read on resume */ }

    fun trigger(row: SetupRow) {
        when (row.action) {
            RowAction.OpenAccessibilitySettings -> context.startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            RowAction.RequestNotifications -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    context.startActivity(appNotificationSettingsIntent(context))
                }
            }
            RowAction.OpenBatterySettings -> context.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            RowAction.OpenNfcSettings -> context.startActivity(
                Intent(Settings.ACTION_NFC_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            RowAction.None -> Unit
        }
    }

    BaliBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
        ) {
            Spacer(Modifier.height(40.dp))
            Text(
                "GET STARTED",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Set up Bali",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Bali needs permission to detect when a blocked app is opened during " +
                    "class so it can show the Focus Mode screen. You can continue now " +
                    "and finish setup later.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(rows) { row ->
                    SetupRowCard(row = row, onAction = { trigger(row) })
                }
            }

            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { vm.markSetupComplete(onContinue) },
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text("Continue")
            }
            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = { vm.markSetupComplete(onContinue) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Review later")
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun SetupRowCard(row: SetupRow, onAction: () -> Unit) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(row.title, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        row.description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.size(8.dp))
                StatusPill(status = row.status)
            }
            if (!row.status.ok && !row.status.unavailable && row.action != RowAction.None) {
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onAction,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                ) {
                    Text("Open Settings")
                }
            }
        }
    }
}

@Composable
private fun StatusPill(status: RowStatus) {
    val (fg, bg) = when {
        status.ok -> AccentGreen to GreenTint
        status.unavailable -> MaterialTheme.colorScheme.onSurfaceVariant to NeutralTint
        else -> AccentAmber to AmberTint
    }
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            status.label,
            style = MaterialTheme.typography.labelSmall,
            color = fg,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun rememberPermissionSnapshot(context: Context): PermissionsSnapshot {
    var refreshCounter by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshCounter++
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val derived by remember {
        derivedStateOf {
            // refreshCounter is read here to recompute on resume.
            @Suppress("UNUSED_EXPRESSION") refreshCounter
            PermissionChecks.snapshot(context, FocusAccessibilityService::class.java)
        }
    }
    return derived
}

private fun appNotificationSettingsIntent(context: Context): Intent {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${context.packageName}"))
    }
    return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

private fun buildRows(s: PermissionsSnapshot): List<SetupRow> {
    val accessibility = SetupRow(
        title = "Focus Mode monitoring",
        description = "Lets Bali show the Focus Mode screen when you open a blocked app.",
        status = if (s.accessibilityEnabled) RowStatus("Enabled", ok = true)
            else RowStatus("Not enabled", ok = false),
        action = RowAction.OpenAccessibilitySettings,
    )
    val notifications = SetupRow(
        title = "Notifications",
        description = "So you know when Focus Mode starts and ends.",
        status = if (s.notificationsGranted) RowStatus("Allowed", ok = true)
            else RowStatus("Not enabled", ok = false),
        action = RowAction.RequestNotifications,
    )
    val battery = SetupRow(
        title = "Battery optimization",
        description = "Keeps Bali running during class sessions.",
        status = if (s.batteryUnrestricted) RowStatus("Unrestricted", ok = true)
            else RowStatus("Needs setup", ok = false),
        action = RowAction.OpenBatterySettings,
    )
    val nfc = when (s.nfc) {
        NfcStatus.Available -> SetupRow(
            title = "NFC",
            description = "Used to read your Bali block at check-in.",
            status = RowStatus("Ready", ok = true),
            action = RowAction.None,
        )
        NfcStatus.Disabled -> SetupRow(
            title = "NFC",
            description = "Turn on NFC to check in with your Bali block.",
            status = RowStatus("Off", ok = false),
            action = RowAction.OpenNfcSettings,
        )
        NfcStatus.NoHardware -> SetupRow(
            title = "NFC",
            description = "This phone doesn't have NFC. You'll need a phone with NFC to tap your Bali block.",
            status = RowStatus("Unavailable", ok = false, unavailable = true),
            action = RowAction.None,
        )
    }
    return listOf(accessibility, notifications, battery, nfc)
}
