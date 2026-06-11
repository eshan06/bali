package com.bali.student.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.bali.student.ui.theme.BaliBackground

private const val ERR_LINK = "We couldn't read that invite link. Check the link and try again."
private const val ERR_CODE = "We couldn't find a class with that code."

private val UUID_REGEX = Regex(
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    RegexOption.IGNORE_CASE,
)
private val JOIN_PATH_REGEX = Regex(
    "/join/([0-9a-f-]{36})",
    RegexOption.IGNORE_CASE,
)

internal fun extractClassId(input: String): String? {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return null
    JOIN_PATH_REGEX.find(trimmed)?.let { return it.groupValues[1].lowercase() }
    UUID_REGEX.find(trimmed)?.let { return it.value.lowercase() }
    return null
}

private enum class JoinTab(val label: String) {
    Link("Link"), Code("Code"), QR("QR")
}

@Composable
fun JoinScreen(onConfirm: (classId: String) -> Unit) {
    var tab by remember { mutableStateOf(JoinTab.Link) }
    var linkInput by remember { mutableStateOf("") }
    var linkError by remember { mutableStateOf<String?>(null) }
    var codeInput by remember { mutableStateOf("") }
    var codeError by remember { mutableStateOf<String?>(null) }

    BaliBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text(
                "JOIN",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Join a class",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Use a link, class code, or QR code from your teacher.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))

            TabRow(
                selectedTabIndex = tab.ordinal,
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.primary,
            ) {
                JoinTab.entries.forEach { t ->
                    Tab(
                        selected = tab == t,
                        onClick = { tab = t },
                        text = { Text(t.label) },
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    when (tab) {
                        JoinTab.Link -> LinkForm(
                            value = linkInput,
                            onChange = {
                                linkInput = it
                                linkError = null
                            },
                            error = linkError,
                            onJoin = {
                                val id = extractClassId(linkInput)
                                if (id == null) linkError = ERR_LINK else onConfirm(id)
                            },
                        )
                        JoinTab.Code -> CodeForm(
                            value = codeInput,
                            onChange = {
                                codeInput = it
                                codeError = null
                            },
                            error = codeError,
                            onJoin = {
                                val id = extractClassId(codeInput)
                                if (id == null) codeError = ERR_CODE else onConfirm(id)
                            },
                        )
                        JoinTab.QR -> QrPlaceholder()
                    }
                }
            }
        }
    }
}

@Composable
private fun LinkForm(
    value: String,
    onChange: (String) -> Unit,
    error: String?,
    onJoin: () -> Unit,
) {
    Text("Paste invite link", style = MaterialTheme.typography.titleLarge)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text("https://.../join/...") },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    )
    if (error != null) {
        Spacer(Modifier.height(8.dp))
        ErrorRow(error)
    }
    Spacer(Modifier.height(16.dp))
    JoinButton(enabled = value.isNotBlank(), onClick = onJoin)
}

@Composable
private fun CodeForm(
    value: String,
    onChange: (String) -> Unit,
    error: String?,
    onJoin: () -> Unit,
) {
    Text("Enter class code", style = MaterialTheme.typography.titleLarge)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text("ABC123") },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
        modifier = Modifier.fillMaxWidth(),
    )
    if (error != null) {
        Spacer(Modifier.height(8.dp))
        ErrorRow(error)
    }
    Spacer(Modifier.height(16.dp))
    JoinButton(enabled = value.isNotBlank(), onClick = onJoin)
}

@Composable
private fun JoinButton(enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
    ) {
        Text("Join Class")
    }
}

@Composable
private fun ErrorRow(message: String) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFEECEC)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
private fun QrPlaceholder() {
    Text("Scan QR code", style = MaterialTheme.typography.titleLarge)
    Spacer(Modifier.height(6.dp))
    Text(
        "Point your camera at the QR code your teacher is showing.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(12.dp))
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            modifier = Modifier.fillMaxSize(),
        ) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "QR scanning coming soon",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Use Link or Code in the meantime.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
