package com.bali.student.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.focus.FocusModePolicy
import com.bali.student.data.focus.FocusModeStore
import com.bali.student.ui.theme.AccentAmber
import com.bali.student.ui.theme.AccentGreen
import com.bali.student.ui.theme.AccentOrange
import com.bali.student.ui.theme.AccentRed
import com.bali.student.ui.theme.AmberTint
import com.bali.student.ui.theme.BaliBackground
import com.bali.student.ui.theme.BrandBlue
import com.bali.student.ui.theme.BrandBlueTint
import com.bali.student.ui.theme.GreenTint
import com.bali.student.ui.theme.NeutralTint
import com.bali.student.ui.theme.OrangeTint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

@HiltViewModel
class FocusModeViewModel @Inject constructor(
    store: FocusModeStore,
) : ViewModel() {
    val policy: StateFlow<FocusModePolicy?> = store.policy.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = null,
    )
}

@Composable
fun FocusModeScreen(
    onBack: () -> Unit,
    vm: FocusModeViewModel = hiltViewModel(),
) {
    val policy by vm.policy.collectAsState()

    BaliBackground {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onBack) { Text("← Back") }
            }
            if (policy == null) {
                NoPolicyState()
            } else {
                LoadedPolicy(policy!!)
            }
        }
    }
}

@Composable
private fun NoPolicyState() {
    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(8.dp))
        Text(
            "FOCUS MODE",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Focus Mode",
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(16.dp))
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(
                    "Focus Mode is not active.",
                    style = MaterialTheme.typography.titleLarge,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "Check in to a class session to activate Focus Mode and see what's blocked.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun LoadedPolicy(policy: FocusModePolicy) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { Header(policy) }
        item { OverviewCard(policy) }
        item { AppsCard(policy) }
        item { StatusCard(policy) }
    }
}

@Composable
private fun Header(policy: FocusModePolicy) {
    Column {
        Text(
            "FOCUS MODE",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            policy.className,
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ActivePill(policy.blockingActive)
            AttendancePill(policy.attendanceStatus)
        }
    }
}

@Composable
private fun ActivePill(active: Boolean) {
    val (text, fg, bg) = if (active) Triple("Focus Mode active", BrandBlue, BrandBlueTint)
    else Triple("Focus Mode inactive", MaterialTheme.colorScheme.onSurfaceVariant, NeutralTint)
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (active) {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = fg, modifier = Modifier.size(13.dp))
                Spacer(Modifier.size(6.dp))
            }
            Text(text, style = MaterialTheme.typography.labelSmall, color = fg)
        }
    }
}

@Composable
private fun AttendancePill(status: String) {
    val late = status.equals("late", ignoreCase = true)
    val (text, fg, bg) = if (late) Triple("Late", AccentOrange, OrangeTint)
    else Triple("Present", AccentGreen, GreenTint)
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = fg,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun OverviewCard(policy: FocusModePolicy) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            InfoLine(label = "Preset", value = presetLabel(policy.preset))
            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))
            InfoLine(label = "Checked in", value = formatTimeLocal(policy.checkInTime) ?: "—")
            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))
            val helper = when (policy.preset.lowercase()) {
                "full_focus" -> "Only allowed apps will open during class."
                "no_social_media" -> "Social apps are blocked until class ends."
                "no_games" -> "Games are blocked until class ends."
                "custom" -> "These apps are blocked until class ends."
                else -> "No Focus Mode is active for this session."
            }
            Text(
                helper,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AppsCard(policy: FocusModePolicy) {
    val showAllowed = policy.mode == "block_all_except"
    val names = if (showAllowed) policy.allowedAppNames else policy.blockedAppNames
    val label = if (showAllowed) "Allowed apps" else "Blocked apps"
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text(label, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(12.dp))
            if (names.isEmpty()) {
                Text(
                    if (showAllowed) "All other apps will be blocked." else "No specific apps configured.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                AppNameChips(names = names, allowed = showAllowed)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppNameChips(names: List<String>, allowed: Boolean) {
    val bg = if (allowed) GreenTint else Color(0xFFFEE2E2)
    val fg = if (allowed) AccentGreen else AccentRed
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        names.forEach { name ->
            Surface(shape = RoundedCornerShape(999.dp), color = bg) {
                Text(
                    name,
                    style = MaterialTheme.typography.labelSmall,
                    color = fg,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
    }
}

@Composable
private fun StatusCard(policy: FocusModePolicy) {
    val (text, fg, bg) = when (policy.lastKnownStatus) {
        FocusModePolicy.STATUS_APPLIED -> Triple("Blocking applied", AccentGreen, GreenTint)
        FocusModePolicy.STATUS_FAILED -> Triple("Focus Mode could not be applied", AccentRed, Color(0xFFFEE2E2))
        FocusModePolicy.STATUS_DISABLED -> Triple("Focus Mode ended", MaterialTheme.colorScheme.onSurfaceVariant, NeutralTint)
        else -> Triple("Waiting for Focus Mode confirmation", AccentAmber, AmberTint)
    }
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("Status", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(10.dp))
            Surface(shape = RoundedCornerShape(12.dp), color = bg, modifier = Modifier.fillMaxWidth()) {
                Text(
                    text,
                    style = MaterialTheme.typography.bodyMedium,
                    color = fg,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            "$label: ",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun presetLabel(preset: String): String = when (preset.lowercase()) {
    "no_social_media" -> "No Social Media"
    "no_games" -> "No Games"
    "full_focus" -> "Full Focus"
    "custom" -> "Custom"
    "none" -> "None"
    else -> preset.replace('_', ' ').split(' ').joinToString(" ") { word ->
        word.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }
}

private val TIME_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a")

private fun formatTimeLocal(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        OffsetDateTime.parse(iso)
            .atZoneSameInstant(ZoneId.systemDefault())
            .toLocalTime()
            .format(TIME_FMT)
    }.getOrNull()
}
