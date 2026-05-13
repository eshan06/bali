package com.bali.student.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.auth.AmplifyAuth
import com.bali.student.data.model.StudentClassSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ClassesUiState(
    val loading: Boolean = true,
    val classes: List<StudentClassSummary> = emptyList(),
    val firstName: String? = null,
    val error: String? = null,
)

@HiltViewModel
class ClassesViewModel @Inject constructor(
    private val api: BaliApi,
    private val auth: AmplifyAuth,
) : ViewModel() {
    private val _state = MutableStateFlow(ClassesUiState())
    val state: StateFlow<ClassesUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching { api.getStudentSelf() }
                .onSuccess { self ->
                    _state.value = ClassesUiState(
                        loading = false,
                        classes = self.classes,
                        firstName = self.student.firstName,
                    )
                }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        loading = false,
                        error = t.message ?: "Failed to load classes",
                    )
                }
        }
    }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            auth.signOut()
            onDone()
        }
    }
}

@Composable
fun ClassesScreen(
    onOpenClass: (String) -> Unit,
    onSignedOut: () -> Unit,
    vm: ClassesViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(24.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    "YOUR CLASSES",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Hi, ${state.firstName ?: "there"}.",
                    style = MaterialTheme.typography.headlineLarge,
                )
            }
            TextButton(onClick = { vm.signOut(onSignedOut) }) {
                Text("Sign out")
            }
        }
        Spacer(Modifier.height(16.dp))

        when {
            state.loading -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            state.error != null -> {
                ErrorCard(message = state.error!!, onRetry = vm::refresh)
            }
            state.classes.isEmpty() -> {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Text("No classes yet.", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Ask your teacher for an invite link or class code.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            else -> {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 4.dp),
                ) {
                    items(state.classes, key = { it.id }) { c ->
                        ClassRow(c, onClick = { onOpenClass(c.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun ClassRow(c: StudentClassSummary, onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            if (!c.period.isNullOrBlank()) {
                Text(
                    c.period.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(4.dp))
            }
            Text(c.name, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                buildString {
                    append(c.teacherName)
                    c.schoolName?.let { append(" · "); append(it) }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (c.activeSession != null) {
                Spacer(Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(MaterialTheme.colorScheme.primaryContainer)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(
                        if (c.activeSession.checkedIn) "Checked in" else "Class in session",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ErrorCard(message: String, onRetry: () -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("We couldn't load your classes.", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(4.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = onRetry) { Text("Try again") }
        }
    }
}
