package com.bali.student.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.model.ActiveSessionLite
import com.bali.student.data.model.PendingInvite
import com.bali.student.data.model.StudentClassSummary
import com.bali.student.ui.theme.AccentAmber
import com.bali.student.ui.theme.AccentGreen
import com.bali.student.ui.theme.AccentOrange
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
import javax.inject.Inject

private const val TEACHER_FALLBACK = "Teacher"
private const val ERR_LOAD = "We couldn't load your classes."
private const val ERR_LOAD_DETAIL = "Check your connection and try again."
private const val ERR_ACCEPT = "We couldn't accept this invite. Try again."

data class ClassesUiState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val firstName: String? = null,
    val classes: List<StudentClassSummary> = emptyList(),
    val pendingInvites: List<PendingInvite> = emptyList(),
    val accepting: Set<String> = emptySet(),
    val acceptError: String? = null,
    val error: String? = null,
) {
    val hasLoaded: Boolean
        get() = firstName != null || classes.isNotEmpty() || pendingInvites.isNotEmpty() || error != null
}

@HiltViewModel
class ClassesViewModel @Inject constructor(
    private val api: BaliApi,
) : ViewModel() {
    private val _state = MutableStateFlow(ClassesUiState())
    val state: StateFlow<ClassesUiState> = _state

    init { refresh() }

    fun refresh() {
        val firstLoad = !_state.value.hasLoaded
        _state.value = _state.value.copy(
            loading = firstLoad,
            refreshing = !firstLoad,
            error = null,
        )
        viewModelScope.launch {
            runCatching { api.getStudentSelf() }
                .onSuccess { self ->
                    _state.value = _state.value.copy(
                        loading = false,
                        refreshing = false,
                        firstName = self.student.firstName,
                        classes = self.classes,
                        pendingInvites = self.pendingInvites,
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

    fun acceptInvite(inviteId: String) {
        if (inviteId in _state.value.accepting) return
        _state.value = _state.value.copy(
            accepting = _state.value.accepting + inviteId,
            acceptError = null,
        )
        viewModelScope.launch {
            runCatching { api.acceptInvite(inviteId) }
                .onSuccess {
                    // Refresh classes + invites; clear the per-invite loading flag.
                    refreshAfterAccept(inviteId)
                }
                .onFailure {
                    _state.value = _state.value.copy(
                        accepting = _state.value.accepting - inviteId,
                        acceptError = ERR_ACCEPT,
                    )
                }
        }
    }

    fun dismissAcceptError() {
        _state.value = _state.value.copy(acceptError = null)
    }

    private suspend fun refreshAfterAccept(inviteId: String) {
        runCatching { api.getStudentSelf() }
            .onSuccess { self ->
                _state.value = _state.value.copy(
                    loading = false,
                    firstName = self.student.firstName,
                    classes = self.classes,
                    pendingInvites = self.pendingInvites,
                    accepting = _state.value.accepting - inviteId,
                    error = null,
                )
            }
            .onFailure {
                _state.value = _state.value.copy(
                    accepting = _state.value.accepting - inviteId,
                    acceptError = ERR_ACCEPT,
                )
            }
    }
}

@Composable
fun ClassesScreen(
    onOpenClass: (String) -> Unit,
    onOpenJoin: () -> Unit,
    vm: ClassesViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

    BaliBackground {
        when {
            state.loading -> LoadingContent(firstName = state.firstName)
            state.error != null -> ErrorContent(message = state.error!!, onRetry = vm::refresh)
            state.classes.isEmpty() && state.pendingInvites.isEmpty() ->
                EmptyContent(firstName = state.firstName, onOpenJoin = onOpenJoin)
            else -> LoadedContent(
                state = state,
                onRefresh = vm::refresh,
                onOpenClass = onOpenClass,
                onAcceptInvite = vm::acceptInvite,
                onDismissAcceptError = vm::dismissAcceptError,
            )
        }
    }
}

@Composable
private fun Header(firstName: String?, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(
            "YOUR CLASSES",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            greeting(firstName),
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "View your classes, check your attendance, and see when Focus Mode is active.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun greeting(firstName: String?): String {
    val trimmed = firstName?.trim().orEmpty()
    return if (trimmed.isNotEmpty()) "Hi, $trimmed." else "Hi there."
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LoadedContent(
    state: ClassesUiState,
    onRefresh: () -> Unit,
    onOpenClass: (String) -> Unit,
    onAcceptInvite: (String) -> Unit,
    onDismissAcceptError: () -> Unit,
) {
    val banner = pickBannerClass(state.classes)

    PullToRefreshBox(
        isRefreshing = state.refreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { Header(firstName = state.firstName) }

            if (banner != null) {
                item { ActiveSessionBanner(banner = banner, onClick = { onOpenClass(banner.cls.id) }) }
            }

            if (state.pendingInvites.isNotEmpty()) {
                item { SectionTitle("Pending invites") }
                items(state.pendingInvites, key = { it.inviteId }) { inv ->
                    InviteCard(
                        invite = inv,
                        accepting = inv.inviteId in state.accepting,
                        onAccept = { onAcceptInvite(inv.inviteId) },
                    )
                }
                if (state.acceptError != null) {
                    item { AcceptErrorCard(message = state.acceptError, onDismiss = onDismissAcceptError) }
                }
            }

            if (state.classes.isNotEmpty()) {
                item { SectionTitle("Your classes") }
                items(state.classes, key = { it.id }) { c ->
                    ClassCard(c, onClick = { onOpenClass(c.id) })
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(top = 8.dp),
    )
}

/* ---------- Active session banner ---------- */

private data class BannerPick(val cls: StudentClassSummary, val urgent: Boolean)

private fun pickBannerClass(classes: List<StudentClassSummary>): BannerPick? {
    val notCheckedIn = classes.firstOrNull { it.activeSession != null && !it.activeSession.checkedIn }
    if (notCheckedIn != null) return BannerPick(notCheckedIn, urgent = true)
    val checkedIn = classes.firstOrNull { it.activeSession != null && it.activeSession.checkedIn }
    if (checkedIn != null) return BannerPick(checkedIn, urgent = false)
    return null
}

@Composable
private fun ActiveSessionBanner(banner: BannerPick, onClick: () -> Unit) {
    val urgent = banner.urgent
    val bg = if (urgent) AmberTint else BrandBlueTint
    val accent = if (urgent) AccentAmber else BrandBlue
    val title = if (urgent) "You have a class in session." else "A class is in session."
    val body = if (urgent) {
        "Tap your Bali block to check in."
    } else {
        "You're already checked in. Focus Mode stays active until the session ends."
    }
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = bg),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PulseDot(color = accent, animate = urgent)
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = accent)
                Spacer(Modifier.height(2.dp))
                Text(body, style = MaterialTheme.typography.bodyMedium, color = accent)
            }
            Spacer(Modifier.size(12.dp))
            Text(
                "View Session",
                style = MaterialTheme.typography.labelSmall,
                color = accent,
            )
        }
    }
}

@Composable
private fun PulseDot(color: Color, animate: Boolean) {
    if (animate) {
        val transition = rememberInfiniteTransition(label = "pulse")
        val alpha by transition.animateFloat(
            initialValue = 0.4f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 900),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "pulse-alpha",
        )
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color)
                .alpha(alpha),
        )
    } else {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color),
        )
    }
}

/* ---------- Invite card ---------- */

@Composable
private fun InviteCard(invite: PendingInvite, accepting: Boolean, onAccept: () -> Unit) {
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
                if (!invite.period.isNullOrBlank()) {
                    Text(
                        invite.period.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Spacer(Modifier.size(1.dp))
                }
                Pill(text = "New invite", textColor = BrandBlue, bg = BrandBlueTint)
            }
            Spacer(Modifier.height(6.dp))
            Text(invite.className, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                buildString {
                    append(invite.teacherName.ifBlank { TEACHER_FALLBACK })
                    invite.schoolName?.takeIf { it.isNotBlank() }?.let { append(" · "); append(it) }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = onAccept,
                enabled = !accepting,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp),
            ) {
                Text(if (accepting) "Accepting…" else "Accept")
            }
        }
    }
}

@Composable
private fun AcceptErrorCard(message: String, onDismiss: () -> Unit) {
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

/* ---------- Class card ---------- */

private enum class ClassState { NoSession, InSessionNotCheckedIn, CheckedIn, CheckedInLate }

private fun classifyClass(c: StudentClassSummary): ClassState {
    val s = c.activeSession ?: return ClassState.NoSession
    if (!s.checkedIn) return ClassState.InSessionNotCheckedIn
    return if (s.attendanceStatus?.equals("late", ignoreCase = true) == true) {
        ClassState.CheckedInLate
    } else {
        ClassState.CheckedIn
    }
}

private fun focusModeOn(session: ActiveSessionLite?): Boolean =
    session != null && session.blockingEnabled

@Composable
private fun ClassCard(c: StudentClassSummary, onClick: () -> Unit) {
    val state = classifyClass(c)

    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = borderForState(state),
                shape = RoundedCornerShape(20.dp),
            ),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            // Top row: period eyebrow + status pill
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!c.period.isNullOrBlank()) {
                    Text(
                        c.period.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Spacer(Modifier.size(1.dp))
                }
                StatusPill(state = state)
            }
            Spacer(Modifier.height(8.dp))

            Text(c.name, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                teacherAndSchool(c),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(14.dp))
            StatePanel(state = state)

            if (focusModeOn(c.activeSession)) {
                Spacer(Modifier.height(10.dp))
                FocusModeBlock()
            }

            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                Stat(
                    label = "Attendance",
                    value = attendanceLabel(c),
                )
                Stat(
                    label = "Sessions",
                    value = c.totalSessions.toString(),
                )
            }
        }
    }
}

private fun teacherAndSchool(c: StudentClassSummary): String {
    val teacher = c.teacherName.ifBlank { TEACHER_FALLBACK }
    val school = c.schoolName?.takeIf { it.isNotBlank() }
    return if (school != null) "$teacher · $school" else teacher
}

private fun attendanceLabel(c: StudentClassSummary): String {
    if (c.totalSessions == 0) return "No sessions yet"
    val pct = (c.attendanceRate * 100).toInt().coerceIn(0, 100)
    return "$pct%"
}

private fun borderForState(state: ClassState): Color = when (state) {
    ClassState.NoSession -> Color(0xFFE2E8F0)
    ClassState.InSessionNotCheckedIn -> AccentAmber.copy(alpha = 0.4f)
    ClassState.CheckedIn -> AccentGreen.copy(alpha = 0.4f)
    ClassState.CheckedInLate -> AccentOrange.copy(alpha = 0.4f)
}

@Composable
private fun StatusPill(state: ClassState) {
    val (text, fg, bg) = when (state) {
        ClassState.NoSession -> Triple("No active session", MaterialTheme.colorScheme.onSurfaceVariant, NeutralTint)
        ClassState.InSessionNotCheckedIn -> Triple("Class in session", AccentAmber, AmberTint)
        ClassState.CheckedIn -> Triple("Checked in", AccentGreen, GreenTint)
        ClassState.CheckedInLate -> Triple("Checked in late", AccentOrange, OrangeTint)
    }
    Pill(text = text, textColor = fg, bg = bg)
}

@Composable
private fun Pill(text: String, textColor: Color, bg: Color) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = bg,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = textColor,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun StatePanel(state: ClassState) {
    val (text, fg, bg) = when (state) {
        ClassState.NoSession ->
            Triple("No active session right now.", MaterialTheme.colorScheme.onSurfaceVariant, NeutralTint)
        ClassState.InSessionNotCheckedIn ->
            Triple("Tap your Bali block to check in.", AccentAmber, AmberTint)
        ClassState.CheckedIn ->
            Triple("You're checked in.", AccentGreen, GreenTint)
        ClassState.CheckedInLate ->
            Triple("You checked in late.", AccentOrange, OrangeTint)
    }
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = bg,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = fg,
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
private fun FocusModeBlock() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = BrandBlueTint,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Lock,
                    contentDescription = null,
                    tint = BrandBlue,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.size(6.dp))
                Text(
                    "Focus Mode active",
                    style = MaterialTheme.typography.labelSmall,
                    color = BrandBlue,
                )
            }
        }
        Spacer(Modifier.size(10.dp))
        Text(
            "Some apps are blocked until the session ends.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(2.dp))
        Text(value, style = MaterialTheme.typography.titleLarge)
    }
}

/* ---------- Loading / error / empty ---------- */

@Composable
private fun LoadingContent(firstName: String?) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Header(firstName = firstName)
        Spacer(Modifier.height(16.dp))
        repeat(3) {
            SkeletonCard()
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun SkeletonCard() {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            SkeletonBar(widthFraction = 0.25f, height = 10.dp)
            Spacer(Modifier.height(12.dp))
            SkeletonBar(widthFraction = 0.6f, height = 18.dp)
            Spacer(Modifier.height(8.dp))
            SkeletonBar(widthFraction = 0.4f, height = 12.dp)
            Spacer(Modifier.height(14.dp))
            SkeletonBar(widthFraction = 1f, height = 36.dp, radius = 12.dp)
        }
    }
}

@Composable
private fun SkeletonBar(widthFraction: Float, height: androidx.compose.ui.unit.Dp, radius: androidx.compose.ui.unit.Dp = 4.dp) {
    Box(
        modifier = Modifier
            .fillMaxWidth(widthFraction)
            .height(height)
            .clip(RoundedCornerShape(radius))
            .background(NeutralTint),
    )
}

@Composable
private fun ErrorContent(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Header(firstName = null)
        Spacer(Modifier.height(16.dp))
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
            }
        }
    }
}

@Composable
private fun EmptyContent(firstName: String?, onOpenJoin: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Header(firstName = firstName)
        Spacer(Modifier.height(20.dp))
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text("No classes yet", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Join your first class using a link, class code, or QR code from your teacher.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = onOpenJoin,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                ) {
                    Text("Join a Class")
                }
            }
        }
    }
}
