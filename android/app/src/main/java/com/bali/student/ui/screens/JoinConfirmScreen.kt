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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.model.ClassJoinPreview
import com.bali.student.ui.theme.BaliBackground
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject

private const val ERR_PREVIEW_NOT_FOUND = "We couldn't find that class. Check the link or code and try again."
private const val ERR_PREVIEW_GENERIC = "We couldn't load this class. Check your connection and try again."
private const val ERR_JOIN_GENERIC = "We couldn't join this class. Try again."

data class JoinConfirmUiState(
    val loading: Boolean = true,
    val joining: Boolean = false,
    val preview: ClassJoinPreview? = null,
    val previewError: String? = null,
    val joinError: String? = null,
    val joinedClassId: String? = null,
)

@HiltViewModel
class JoinConfirmViewModel @Inject constructor(
    private val api: BaliApi,
    savedState: SavedStateHandle,
) : ViewModel() {
    private val classId: String = savedState.get<String>("classId").orEmpty()
    private val _state = MutableStateFlow(JoinConfirmUiState())
    val state: StateFlow<JoinConfirmUiState> = _state

    init { loadPreview() }

    private fun loadPreview() {
        _state.value = _state.value.copy(loading = true, previewError = null)
        viewModelScope.launch {
            runCatching { api.getClassPreview(classId) }
                .onSuccess {
                    _state.value = _state.value.copy(loading = false, preview = it)
                }
                .onFailure { t ->
                    val msg = if (t is HttpException && t.code() == 404) {
                        ERR_PREVIEW_NOT_FOUND
                    } else {
                        ERR_PREVIEW_GENERIC
                    }
                    _state.value = _state.value.copy(loading = false, previewError = msg)
                }
        }
    }

    fun retryPreview() = loadPreview()

    fun join() {
        if (_state.value.joining) return
        _state.value = _state.value.copy(joining = true, joinError = null)
        viewModelScope.launch {
            runCatching { api.joinClass(classId) }
                .onSuccess {
                    _state.value = _state.value.copy(joining = false, joinedClassId = it.classId)
                }
                .onFailure {
                    _state.value = _state.value.copy(joining = false, joinError = ERR_JOIN_GENERIC)
                }
        }
    }

    fun dismissJoinError() {
        _state.value = _state.value.copy(joinError = null)
    }
}

@Composable
fun JoinConfirmScreen(
    onCancel: () -> Unit,
    onJoined: (className: String) -> Unit,
    onViewClass: (classId: String) -> Unit,
    vm: JoinConfirmViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

    // Watch for join completion and propagate up.
    val justJoined = state.joinedClassId
    val preview = state.preview
    if (justJoined != null && preview != null) {
        // Schedule navigation on the next composition tick.
        androidx.compose.runtime.LaunchedEffect(justJoined) {
            onJoined(preview.className)
        }
    }

    BaliBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
        ) {
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = onCancel) { Text("← Back") }
            Spacer(Modifier.height(8.dp))

            when {
                state.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                state.previewError != null -> PreviewErrorCard(
                    message = state.previewError!!,
                    onRetry = vm::retryPreview,
                    onCancel = onCancel,
                )

                preview != null && preview.alreadyEnrolled -> AlreadyEnrolledCard(
                    preview = preview,
                    onViewClass = { onViewClass(preview.classId) },
                    onCancel = onCancel,
                )

                preview != null -> ConfirmCard(
                    preview = preview,
                    joining = state.joining,
                    joinError = state.joinError,
                    onJoin = vm::join,
                    onCancel = onCancel,
                    onDismissError = vm::dismissJoinError,
                )
            }
        }
    }
}

@Composable
private fun ConfirmCard(
    preview: ClassJoinPreview,
    joining: Boolean,
    joinError: String?,
    onJoin: () -> Unit,
    onCancel: () -> Unit,
    onDismissError: () -> Unit,
) {
    Spacer(Modifier.height(8.dp))
    Text(
        "JOIN",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.primary,
    )
    Spacer(Modifier.height(6.dp))
    Text(
        "Join ${preview.className}?",
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
            if (!preview.period.isNullOrBlank()) {
                Text(
                    preview.period.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(4.dp))
            }
            Text(preview.className, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(6.dp))
            Text(
                "Teacher: ${preview.teacherName}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            preview.schoolName?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(2.dp))
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (joinError != null) {
                Spacer(Modifier.height(14.dp))
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
                            joinError,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = onDismissError) { Text("Dismiss") }
                    }
                }
            }

            Spacer(Modifier.height(18.dp))
            Button(
                onClick = onJoin,
                enabled = !joining,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text(if (joining) "Joining class…" else "Join Class")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onCancel,
                enabled = !joining,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text("Cancel")
            }
        }
    }
}

@Composable
private fun AlreadyEnrolledCard(
    preview: ClassJoinPreview,
    onViewClass: () -> Unit,
    onCancel: () -> Unit,
) {
    Spacer(Modifier.height(8.dp))
    Text(
        "Already joined",
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
            Text("You're already in this class.", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                preview.className,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = onViewClass,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text("View Class")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = onCancel,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text("Back")
            }
        }
    }
}

@Composable
private fun PreviewErrorCard(
    message: String,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
) {
    Spacer(Modifier.height(8.dp))
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("We couldn't find that class.", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                message,
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
                OutlinedButton(onClick = onCancel, shape = RoundedCornerShape(12.dp)) {
                    Text("Back")
                }
            }
        }
    }
}
