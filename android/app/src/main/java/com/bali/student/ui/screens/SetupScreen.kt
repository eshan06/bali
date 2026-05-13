package com.bali.student.ui.screens

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.prefs.StudentPrefs
import com.bali.student.ui.theme.BaliBackground
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

private data class SetupItem(val title: String, val subtitle: String)

private val SetupItems = listOf(
    SetupItem("NFC ready", "Required for in-class check-in"),
    SetupItem("Focus Mode permissions", "Allows Bali to manage app access during class"),
    SetupItem("Notifications", "So you know when Focus Mode starts and ends"),
    SetupItem("Battery settings", "Keeps Bali running during class sessions"),
)

@Composable
fun SetupScreen(
    onContinue: () -> Unit,
    vm: SetupViewModel = hiltViewModel(),
) {
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
                "Before using Focus Mode, your phone will need a few permissions. " +
                    "You can continue for now and finish setup later.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))

            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    SetupItems.forEachIndexed { i, item ->
                        SetupRow(item)
                        if (i != SetupItems.lastIndex) Spacer(Modifier.height(14.dp))
                    }
                }
            }

            Spacer(Modifier.weight(1f))

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
private fun SetupRow(item: SetupItem) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.size(36.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    "●",
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        Spacer(Modifier.size(14.dp))
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(item.title, style = MaterialTheme.typography.titleLarge)
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(
                        "Coming soon",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                item.subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
