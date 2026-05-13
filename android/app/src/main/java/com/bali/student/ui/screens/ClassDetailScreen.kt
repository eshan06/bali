package com.bali.student.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.focus.AppPackageMap
import com.bali.student.data.focus.FocusModePolicy
import com.bali.student.data.focus.FocusModeStore
import com.bali.student.data.model.BlockingAppEntry
import com.bali.student.data.model.BlockingSnapshot
import com.bali.student.data.model.RecentSession
import com.bali.student.data.model.SimulateCheckInResponse
import com.bali.student.data.model.StudentActiveSessionInfo
import com.bali.student.data.model.StudentClassDetail
import com.bali.student.nfc.NfcReader
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

private const val TEACHER_FALLBACK = "Teacher"
private const val ERR_LOAD = "We couldn't load this class."
private const val ERR_LOAD_DETAIL = "Check your connection and try again."
private const val ERR_NO_SESSION = "No active session found for this class."
private const val ERR_NOT_FOUND = "We couldn't find this class."
private const val ERR_CHECKIN_GENERIC = "We couldn't check you in. Try again."
private const val ERR_NFC_NO_SESSION = "No active session found. Ask your teacher to start class."
private const val ERR_NFC_UNASSIGNED = "This phone has not been assigned by your teacher yet."

private val AppChipRedBg = Color(0xFFFEE2E2)

data class ClassDetailUiState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val checkingIn: Boolean = false,
    val nfcReading: Boolean = false,
    val detail: StudentClassDetail? = null,
    val error: String? = null,
    val checkInError: String? = null,
    val pendingFocusModeNav: Boolean = false,
) {
    val hasLoaded: Boolean get() = detail != null || error != null
}

@HiltViewModel
class ClassDetailViewModel @Inject constructor(
    private val api: BaliApi,
    private val nfcReader: NfcReader,
    private val focusModeStore: FocusModeStore,
    savedState: SavedStateHandle,
) : ViewModel() {
    private val classId: String = savedState.get<String>("classId").orEmpty()
    private val _state = MutableStateFlow(ClassDetailUiState())
    val state: StateFlow<ClassDetailUiState> = _state

    init {
        refresh()
        viewModelScope.launch {
            nfcReader.taps.collect { onNfcTap() }
        }
    }

    fun refresh() {
        val firstLoad = !_state.value.hasLoaded
        _state.value = _state.value.copy(
            loading = firstLoad,
            refreshing = !firstLoad,
            error = null,
        )
        viewModelScope.launch {
            runCatching { api.getClassDetail(classId) }
                .onSuccess {
                    _state.value = _state.value.copy(
                        loading = false,
                        refreshing = false,
                        detail = it,
                        error = null,
                    )
                }
                .onFailure {
                    _state.value = _state.value.copy(
                        loading = false,
                        refreshing = false,
                        error = ERR_LOAD,
                    )
                }
        }
    }

    fun simulateCheckIn(viaNfc: Boolean = false) {
        if (_state.value.checkingIn) return
        _state.value = _state.value.copy(
            checkingIn = true,
            nfcReading = viaNfc,
            checkInError = null,
        )
        viewModelScope.launch {
            runCatching { api.simulateCheckIn(classId) }
                .onSuccess { resp ->
                    runCatching { api.getClassDetail(classId) }
                        .onSuccess { d ->
                            persistPolicy(resp, d)
                            val hasBlocking = resp.blockingPolicy?.blockingActive == true
                            _state.value = _state.value.copy(
                                checkingIn = false,
                                nfcReading = false,
                                detail = d,
                                checkInError = null,
                                pendingFocusModeNav = hasBlocking,
                            )
                        }
                        .onFailure {
                            _state.value = _state.value.copy(
                                checkingIn = false,
                                nfcReading = false,
                            )
                        }
                }
                .onFailure { t ->
                    val msg = when {
                        t is HttpException && t.code() == 409 -> ERR_NO_SESSION
                        t is HttpException && t.code() == 404 -> ERR_NOT_FOUND
                        else -> ERR_CHECKIN_GENERIC
                    }
                    _state.value = _state.value.copy(
                        checkingIn = false,
                        nfcReading = false,
                        checkInError = msg,
                    )
                }
        }
    }

    private fun onNfcTap() {
        val current = _state.value
        if (current.checkingIn) return
        val detail = current.detail
        val active = detail?.activeSession
        when {
            detail == null -> _state.value = current.copy(checkInError = ERR_NFC_NO_SESSION)
            active == null -> _state.value = current.copy(checkInError = ERR_NFC_NO_SESSION)
            active.checkedIn -> Unit // already checked in — ignore
            detail.device == null -> _state.value = current.copy(checkInError = ERR_NFC_UNASSIGNED)
            else -> simulateCheckIn(viaNfc = true)
        }
    }

    fun dismissCheckInError() {
        _state.value = _state.value.copy(checkInError = null)
    }

    fun consumePendingFocusModeNav() {
        _state.value = _state.value.copy(pendingFocusModeNav = false)
    }

    private suspend fun persistPolicy(resp: SimulateCheckInResponse, detail: StudentClassDetail) {
        val snap = resp.blockingPolicy ?: return
        val policy = FocusModePolicy(
            sessionId = resp.sessionId,
            classId = resp.classId,
            className = detail.`class`.name,
            checkInTime = resp.checkInTime,
            attendanceStatus = resp.attendanceStatus,
            blockingActive = snap.blockingActive,
            preset = snap.preset,
            mode = snap.mode,
            blockedPackages = snap.blockedApps.mapNotNull { AppPackageMap.androidPackage(it.bundleId) },
            allowedPackages = snap.allowedApps.mapNotNull { AppPackageMap.androidPackage(it.bundleId) },
            blockedAppNames = snap.blockedApps.map { it.appName },
            allowedAppNames = snap.allowedApps.map { it.appName },
        )
        focusModeStore.save(policy)
    }
}

@Composable
fun ClassDetailScreen(
    classId: String,
    onBack: () -> Unit,
    onOpenFocusMode: () -> Unit,
    vm: ClassDetailViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

    LaunchedEffect(state.pendingFocusModeNav) {
        if (state.pendingFocusModeNav) {
            onOpenFocusMode()
            vm.consumePendingFocusModeNav()
        }
    }

    BaliBackground {
        Column(modifier = Modifier.fillMaxSize()) {
            BackBar(onBack = onBack)
            when {
                state.loading -> LoadingBody()
                state.error != null -> ErrorBody(message = state.error!!, onRetry = vm::refresh, onBack = onBack)
                state.detail != null -> LoadedBody(
                    detail = state.detail!!,
                    refreshing = state.refreshing,
                    checkingIn = state.checkingIn,
                    nfcReading = state.nfcReading,
                    checkInError = state.checkInError,
                    onRefresh = vm::refresh,
                    onSimulateCheckIn = { vm.simulateCheckIn(viaNfc = false) },
                    onDismissCheckInError = vm::dismissCheckInError,
                )
                else -> Unit
            }
        }
    }
}

/* ---------- Back bar ---------- */

@Composable
private fun BackBar(onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, top = 12.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onBack) { Text("← Back to classes") }
    }
}

/* ---------- Loaded body ---------- */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LoadedBody(
    detail: StudentClassDetail,
    refreshing: Boolean,
    checkingIn: Boolean,
    nfcReading: Boolean,
    checkInError: String?,
    onRefresh: () -> Unit,
    onSimulateCheckIn: () -> Unit,
    onDismissCheckInError: () -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { HeaderSection(detail) }
            item { AttendanceSection(detail) }
            item {
                CurrentSessionSection(
                    session = detail.activeSession,
                    checkingIn = checkingIn,
                    nfcReading = nfcReading,
                    onSimulateCheckIn = onSimulateCheckIn,
                )
            }
            if (checkInError != null) {
                item { CheckInErrorCard(message = checkInError, onDismiss = onDismissCheckInError) }
            }
            if (detail.activeSession?.blockingSnapshot?.blockingActive == true) {
                item { FocusModeSection(detail.activeSession) }
            }
            item { DeviceSection(detail.device) }
            item { RecentSessionsSection(detail.recentSessions) }
        }
    }
}

/* ---------- Header ---------- */

@Composable
private fun HeaderSection(detail: StudentClassDetail) {
    val state = classifyDetail(detail.activeSession)
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!detail.`class`.period.isNullOrBlank()) {
                Text(
                    detail.`class`.period.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            detail.`class`.name,
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            teacherAndSchoolFor(detail),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            DetailStatusPill(state = state)
            if (detail.activeSession?.blockingSnapshot?.blockingActive == true) {
                FocusModePill()
            }
        }
    }
}

private fun teacherAndSchoolFor(detail: StudentClassDetail): String {
    val teacher = detail.`class`.teacherName.ifBlank { TEACHER_FALLBACK }
    val school = detail.`class`.schoolName?.takeIf { it.isNotBlank() }
    return if (school != null) "$teacher · $school" else teacher
}

private enum class DetailState { NoSession, InSessionNotCheckedIn, CheckedIn, CheckedInLate }

private fun classifyDetail(session: StudentActiveSessionInfo?): DetailState {
    if (session == null) return DetailState.NoSession
    if (!session.checkedIn) return DetailState.InSessionNotCheckedIn
    return if (session.attendanceStatus?.equals("late", ignoreCase = true) == true) {
        DetailState.CheckedInLate
    } else {
        DetailState.CheckedIn
    }
}

@Composable
private fun DetailStatusPill(state: DetailState) {
    val (text, fg, bg) = when (state) {
        DetailState.NoSession -> Triple("No active session", MaterialTheme.colorScheme.onSurfaceVariant, NeutralTint)
        DetailState.InSessionNotCheckedIn -> Triple("Class in session", AccentAmber, AmberTint)
        DetailState.CheckedIn -> Triple("Checked in", AccentGreen, GreenTint)
        DetailState.CheckedInLate -> Triple("Checked in late", AccentOrange, OrangeTint)
    }
    Pill(text = text, textColor = fg, bg = bg)
}

@Composable
private fun FocusModePill() {
    Surface(shape = RoundedCornerShape(999.dp), color = BrandBlueTint) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.Lock,
                contentDescription = null,
                tint = BrandBlue,
                modifier = Modifier.size(13.dp),
            )
            Spacer(Modifier.size(6.dp))
            Text(
                "Focus Mode active",
                style = MaterialTheme.typography.labelSmall,
                color = BrandBlue,
            )
        }
    }
}

@Composable
private fun Pill(text: String, textColor: Color, bg: Color) {
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = textColor,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

/* ---------- Attendance summary ---------- */

@Composable
private fun AttendanceSection(detail: StudentClassDetail) {
    SectionCard {
        Text("Your attendance", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        if (detail.attendance.total == 0) {
            Text(
                "No sessions yet. Your attendance will appear here after class.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatTile(
                    label = "Attendance",
                    value = "${(detail.attendance.rate * 100).toInt().coerceIn(0, 100)}%",
                    bg = BrandBlueTint,
                    fg = BrandBlue,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = "Sessions",
                    value = detail.attendance.total.toString(),
                    bg = NeutralTint,
                    fg = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatTile(
                    label = "Present",
                    value = detail.attendance.present.toString(),
                    bg = GreenTint,
                    fg = AccentGreen,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = "Late",
                    value = detail.attendance.late.toString(),
                    bg = AmberTint,
                    fg = AccentAmber,
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = "Absent",
                    value = detail.attendance.absent.toString(),
                    bg = Color(0xFFFEE2E2),
                    fg = AccentRed,
                    modifier = Modifier.weight(1f),
                )
                if (detail.attendance.excused > 0) {
                    StatTile(
                        label = "Excused",
                        value = detail.attendance.excused.toString(),
                        bg = Color(0xFFEDE9FE),
                        fg = Color(0xFF7C3AED),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun StatTile(label: String, value: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = bg,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                label.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = fg,
            )
            Spacer(Modifier.height(4.dp))
            Text(value, style = MaterialTheme.typography.titleLarge, color = fg)
        }
    }
}

/* ---------- Current session ---------- */

@Composable
private fun CurrentSessionSection(
    session: StudentActiveSessionInfo?,
    checkingIn: Boolean,
    nfcReading: Boolean,
    onSimulateCheckIn: () -> Unit,
) {
    SectionCard {
        Text("Current session", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(10.dp))

        when (val s = classifyDetail(session)) {
            DetailState.NoSession -> NoSessionPanel()
            DetailState.InSessionNotCheckedIn -> InSessionPanel(
                session = session!!,
                checkingIn = checkingIn,
                nfcReading = nfcReading,
                onSimulateCheckIn = onSimulateCheckIn,
            )
            DetailState.CheckedIn -> CheckedInPanel(session!!, late = false)
            DetailState.CheckedInLate -> CheckedInPanel(session!!, late = true)
        }

        if (session != null && session.checkedIn) {
            Spacer(Modifier.height(12.dp))
            BlockingStatusRow(session)
        }
    }
}

@Composable
private fun NoSessionPanel() {
    StatePanelText(
        title = "No active session",
        body = "When your teacher starts class, you'll see check-in and Focus Mode details here.",
        fg = MaterialTheme.colorScheme.onSurfaceVariant,
        bg = NeutralTint,
    )
}

@Composable
private fun InSessionPanel(
    session: StudentActiveSessionInfo,
    checkingIn: Boolean,
    nfcReading: Boolean,
    onSimulateCheckIn: () -> Unit,
) {
    val panelTitle = if (nfcReading) "Reading Bali block…" else "Class in session"
    val panelBody = if (nfcReading) {
        "Hold your phone steady while we check you in."
    } else {
        "Tap your Bali block to check in."
    }
    StatePanelText(
        title = panelTitle,
        body = panelBody,
        fg = AccentAmber,
        bg = AmberTint,
    )
    Spacer(Modifier.height(8.dp))
    val startedAt = formatTime(session.startedAt)
    if (startedAt != null) {
        InfoLine(label = "Started", value = startedAt)
    }
    val presetLabel = session.blockingSnapshot?.let { presetLabel(it.preset) }
    if (presetLabel != null && session.blockingSnapshot.blockingActive) {
        InfoLine(label = "Focus Mode", value = "$presetLabel — will activate after check-in")
    }
    Spacer(Modifier.height(12.dp))
    Button(
        onClick = onSimulateCheckIn,
        enabled = !checkingIn,
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
    ) {
        Text(if (checkingIn) "Checking in…" else "Simulate Check In")
    }
    Spacer(Modifier.height(6.dp))
    Text(
        "Temporary for development — NFC check-in will replace this.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun CheckedInPanel(session: StudentActiveSessionInfo, late: Boolean) {
    val title = if (late) "You're checked in late" else "You're checked in"
    val checkInTime = formatTime(session.checkInAt)
    val statusWord = if (late) "Late" else "Present"
    val body = if (checkInTime != null) "Checked in at $checkInTime · $statusWord" else statusWord
    StatePanelText(
        title = title,
        body = body,
        fg = if (late) AccentOrange else AccentGreen,
        bg = if (late) OrangeTint else GreenTint,
    )
}

@Composable
private fun StatePanelText(title: String, body: String, fg: Color, bg: Color) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = bg,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = fg)
            Spacer(Modifier.height(2.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium, color = fg)
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

@Composable
private fun BlockingStatusRow(session: StudentActiveSessionInfo) {
    val blockingActive = session.blockingSnapshot?.blockingActive == true
    val (text, fg, bg) = when {
        !blockingActive -> Triple("No blocking policy for this session", MaterialTheme.colorScheme.onSurfaceVariant, NeutralTint)
        session.deviceBlockingStatus == null -> Triple("Waiting for Focus Mode confirmation", BrandBlue, BrandBlueTint)
        session.deviceBlockingStatus.isBlocked -> Triple("Blocking applied", AccentGreen, GreenTint)
        else -> Triple("Focus Mode could not be applied", AccentRed, Color(0xFFFEE2E2))
    }
    Pill(text = text, textColor = fg, bg = bg)
}

@Composable
private fun CheckInErrorCard(message: String, onDismiss: () -> Unit) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFEECEC)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text("Dismiss") }
        }
    }
}

/* ---------- Focus Mode card ---------- */

@Composable
private fun FocusModeSection(session: StudentActiveSessionInfo) {
    val snap = session.blockingSnapshot ?: return
    SectionCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Focus Mode", style = MaterialTheme.typography.titleLarge)
            Pill(text = "Active", textColor = BrandBlue, bg = BrandBlueTint)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            presetLabel(snap.preset),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        val showAllowed = snap.mode == "block_all_except"
        val apps = if (showAllowed) snap.allowedApps else snap.blockedApps
        val label = if (showAllowed) "Allowed apps" else "Blocked apps"
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        if (apps.isEmpty()) {
            Text(
                if (showAllowed) "All other apps are blocked." else "No specific apps configured.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            AppChips(apps = apps, allowed = showAllowed)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppChips(apps: List<BlockingAppEntry>, allowed: Boolean) {
    val bg = if (allowed) GreenTint else AppChipRedBg
    val fg = if (allowed) AccentGreen else AccentRed
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        apps.forEach { app ->
            Surface(shape = RoundedCornerShape(999.dp), color = bg) {
                Text(
                    app.appName.ifBlank { app.bundleId },
                    style = MaterialTheme.typography.labelSmall,
                    color = fg,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
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

/* ---------- Device card ---------- */

@Composable
private fun DeviceSection(device: com.bali.student.data.model.Device?) {
    SectionCard {
        if (device != null) {
            Text("Your Bali block", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            InfoLine(label = "Device", value = device.friendlyName ?: device.deviceId)
            InfoLine(label = "Status", value = "Assigned")
        } else {
            Text("No Bali block assigned", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                "Ask your teacher to assign your device before check-in.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/* ---------- Recent sessions ---------- */

@Composable
private fun RecentSessionsSection(sessions: List<RecentSession>) {
    SectionCard {
        Text("Recent sessions", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        if (sessions.isEmpty()) {
            Text(
                "No sessions yet. Your attendance history will appear here after class.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            sessions.forEachIndexed { i, s ->
                RecentSessionRow(s)
                if (i != sessions.lastIndex) {
                    Spacer(Modifier.height(10.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(10.dp))
                }
            }
        }
    }
}

@Composable
private fun RecentSessionRow(s: RecentSession) {
    val date = formatDate(s.startedAt) ?: "—"
    val statusWord = s.status.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    val statusColor = when (s.status.lowercase()) {
        "present" -> AccentGreen
        "late" -> AccentAmber
        "absent" -> AccentRed
        "excused" -> Color(0xFF7C3AED)
        else -> MaterialTheme.colorScheme.onSurface
    }
    val checkInLabel = formatTime(s.checkInAt)?.let { "Checked in $it" } ?: "No check-in"
    val focusModeLabel = when (s.blockingStatus?.lowercase()) {
        "active" -> "Focus Mode on"
        "student_override" -> "Focus Mode bypassed"
        else -> null
    }

    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(date, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.size(8.dp))
            Pill(text = statusWord, textColor = statusColor, bg = statusColor.copy(alpha = 0.12f))
        }
        Spacer(Modifier.height(4.dp))
        Text(
            buildString {
                append(checkInLabel)
                if (focusModeLabel != null) {
                    append(" · ")
                    append(focusModeLabel)
                }
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/* ---------- Building blocks ---------- */

@Composable
private fun SectionCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) { content() }
    }
}

/* ---------- Loading / error ---------- */

@Composable
private fun LoadingBody() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.height(4.dp))
        SkeletonBar(widthFraction = 0.25f, height = 10.dp)
        SkeletonBar(widthFraction = 0.7f, height = 28.dp)
        SkeletonBar(widthFraction = 0.5f, height = 12.dp)
        Spacer(Modifier.height(2.dp))
        SkeletonCard(lines = 3)
        SkeletonCard(lines = 4)
        SkeletonCard(lines = 3)
    }
}

@Composable
private fun SkeletonCard(lines: Int) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SkeletonBar(widthFraction = 0.4f, height = 18.dp)
            repeat(lines - 1) {
                SkeletonBar(widthFraction = 0.9f, height = 12.dp)
            }
        }
    }
}

@Composable
private fun SkeletonBar(widthFraction: Float, height: androidx.compose.ui.unit.Dp) {
    Box(
        modifier = Modifier
            .fillMaxWidth(widthFraction)
            .height(height)
            .clip(RoundedCornerShape(4.dp))
            .background(NeutralTint),
    )
}

@Composable
private fun ErrorBody(message: String, onRetry: () -> Unit, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(message, style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(
                    ERR_LOAD_DETAIL,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onRetry,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                    ) {
                        Text("Try Again")
                    }
                    OutlinedButton(
                        onClick = onBack,
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("Back to Classes")
                    }
                }
            }
        }
    }
}

/* ---------- Time formatting ---------- */

private val TIME_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a")
private val DATE_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d")

private fun formatTime(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        OffsetDateTime.parse(iso)
            .atZoneSameInstant(ZoneId.systemDefault())
            .toLocalTime()
            .format(TIME_FORMATTER)
    }.getOrNull()
}

private fun formatDate(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        OffsetDateTime.parse(iso)
            .atZoneSameInstant(ZoneId.systemDefault())
            .toLocalDate()
            .format(DATE_FORMATTER)
    }.getOrNull()
}
