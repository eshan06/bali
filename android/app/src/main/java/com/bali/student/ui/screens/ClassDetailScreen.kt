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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.model.StudentClassDetail
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ClassDetailUiState(
    val loading: Boolean = true,
    val detail: StudentClassDetail? = null,
    val error: String? = null,
)

@HiltViewModel
class ClassDetailViewModel @Inject constructor(
    private val api: BaliApi,
    savedState: SavedStateHandle,
) : ViewModel() {
    private val classId: String = savedState.get<String>("classId").orEmpty()
    private val _state = MutableStateFlow(ClassDetailUiState())
    val state: StateFlow<ClassDetailUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            runCatching { api.getClassDetail(classId) }
                .onSuccess { _state.value = ClassDetailUiState(loading = false, detail = it) }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        loading = false,
                        error = t.message ?: "Failed to load",
                    )
                }
        }
    }
}

@Composable
fun ClassDetailScreen(
    classId: String,
    onBack: () -> Unit,
    vm: ClassDetailViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(24.dp))
        TextButton(onClick = onBack) { Text("← Back to classes") }
        Spacer(Modifier.height(8.dp))

        when {
            state.loading -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            state.error != null -> {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Text("We couldn't load this class.", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            state.error!!,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        TextButton(onClick = vm::refresh) { Text("Try again") }
                    }
                }
            }
            state.detail != null -> {
                val d = state.detail!!
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        if (!d.`class`.period.isNullOrBlank()) {
                            Text(
                                d.`class`.period.uppercase(),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                        Text(d.`class`.name, style = MaterialTheme.typography.headlineMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            buildString {
                                append(d.`class`.teacherName)
                                d.`class`.schoolName?.let { append(" · "); append(it) }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                            Stat(label = "Attendance", value = "${(d.attendance.rate * 100).toInt()}%")
                            Stat(label = "Sessions", value = d.attendance.total.toString())
                            Stat(label = "Present", value = d.attendance.present.toString())
                        }
                    }
                }
            }
        }
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
