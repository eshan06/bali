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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.BuildConfig
import com.bali.student.data.api.BaliApi
import com.bali.student.data.auth.AmplifyAuth
import com.bali.student.data.model.Student
import com.bali.student.ui.theme.BaliBackground
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val loading: Boolean = true,
    val signingOut: Boolean = false,
    val confirmSignOut: Boolean = false,
    val student: Student? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val api: BaliApi,
    private val auth: AmplifyAuth,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state

    init { load() }

    private fun load() {
        viewModelScope.launch {
            runCatching { api.getStudentSelf() }
                .onSuccess { _state.value = _state.value.copy(loading = false, student = it.student) }
                .onFailure { _state.value = _state.value.copy(loading = false, student = null) }
        }
    }

    fun requestSignOut() {
        _state.value = _state.value.copy(confirmSignOut = true)
    }
    fun cancelSignOut() {
        _state.value = _state.value.copy(confirmSignOut = false)
    }
    fun confirmSignOut(onDone: () -> Unit) {
        _state.value = _state.value.copy(signingOut = true)
        viewModelScope.launch {
            auth.signOut()
            onDone()
        }
    }
}

@Composable
fun SettingsScreen(
    onSignedOut: () -> Unit,
    vm: SettingsViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

    BaliBackground {
        Column(modifier = Modifier.fillMaxSize()) {
            Spacer(Modifier.height(24.dp))
            Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                Text(
                    "SETTINGS",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Settings",
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
            Spacer(Modifier.height(20.dp))

            if (state.loading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 20.dp, end = 20.dp, bottom = 24.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    item {
                        AccountSection(
                            student = state.student,
                            onSignOut = vm::requestSignOut,
                        )
                    }
                    item { DeviceSection() }
                    item { PermissionsSection() }
                    item { AppSection() }
                }
            }
        }
    }

    if (state.confirmSignOut) {
        AlertDialog(
            onDismissRequest = vm::cancelSignOut,
            title = { Text("Sign out of Bali?") },
            text = { Text("You'll need to sign in again to view your classes.") },
            confirmButton = {
                TextButton(
                    onClick = { vm.confirmSignOut(onSignedOut) },
                    enabled = !state.signingOut,
                ) {
                    Text(if (state.signingOut) "Signing out…" else "Sign out")
                }
            },
            dismissButton = {
                TextButton(onClick = vm::cancelSignOut, enabled = !state.signingOut) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun AccountSection(student: Student?, onSignOut: () -> Unit) {
    SettingsCard(title = "Account") {
        SettingsRow(
            label = "Name",
            value = displayName(student),
        )
        Divider()
        SettingsRow(
            label = "Email",
            value = student?.email ?: "—",
        )
        Divider()
        SettingsRow(
            label = "Grade",
            value = student?.grade?.takeIf { it.isNotBlank() } ?: "—",
        )
        Spacer(Modifier.height(14.dp))
        OutlinedButton(
            onClick = onSignOut,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
        ) {
            Text("Sign out")
        }
    }
}

@Composable
private fun DeviceSection() {
    SettingsCard(title = "Device") {
        SettingsRow(label = "Bali block", value = "Not registered", trailing = "Coming soon")
        Divider()
        Text(
            "Your teacher assigns this device to your student profile.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PermissionsSection() {
    SettingsCard(title = "Permissions") {
        SettingsRow(label = "NFC", value = "Not checked yet", trailing = "Coming soon")
        Divider()
        SettingsRow(label = "Focus Mode", value = "Not configured", trailing = "Coming soon")
        Divider()
        SettingsRow(label = "Notifications", value = "Not enabled", trailing = "Coming soon")
        Divider()
        SettingsRow(label = "Battery optimization", value = "Needs setup", trailing = "Coming soon")
    }
}

@Composable
private fun AppSection() {
    SettingsCard(title = "App") {
        SettingsRow(label = "Version", value = BuildConfig.VERSION_NAME)
        Divider()
        SettingsRow(label = "Build", value = if (BuildConfig.DEBUG) "Debug" else "Release")
        Divider()
        SettingsRow(label = "API", value = BuildConfig.API_BASE_URL)
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(14.dp))
            content()
        }
    }
}

@Composable
private fun Divider() {
    Spacer(Modifier.height(10.dp))
    HorizontalDivider()
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun SettingsRow(label: String, value: String, trailing: String? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f, fill = true)) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(2.dp))
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
        if (trailing != null) {
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Text(
                    trailing,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

private fun displayName(student: Student?): String {
    if (student == null) return "—"
    val full = listOf(student.firstName.orEmpty().trim(), student.lastName.orEmpty().trim())
        .filter { it.isNotEmpty() }
        .joinToString(" ")
    return full.ifEmpty { student.email.substringBefore('@') }
}
