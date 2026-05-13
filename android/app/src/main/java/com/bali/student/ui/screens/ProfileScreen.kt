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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.auth.AmplifyAuth
import com.bali.student.data.model.Student
import com.bali.student.ui.theme.BaliBackground
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileUiState(
    val loading: Boolean = true,
    val student: Student? = null,
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val api: BaliApi,
    private val auth: AmplifyAuth,
) : ViewModel() {
    private val _state = MutableStateFlow(ProfileUiState())
    val state: StateFlow<ProfileUiState> = _state

    init { load() }

    private fun load() {
        viewModelScope.launch {
            runCatching { api.getStudentSelf() }
                .onSuccess { _state.value = ProfileUiState(loading = false, student = it.student) }
                .onFailure { _state.value = ProfileUiState(loading = false, student = null) }
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
fun ProfileScreen(
    onSignedOut: () -> Unit,
    vm: ProfileViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()
    val s = state.student

    BaliBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text(
                "PROFILE",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Your profile",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(20.dp))

            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(56.dp),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    initialsOf(s),
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.Black,
                                    fontSize = 20.sp,
                                )
                            }
                        }
                        Spacer(Modifier.size(16.dp))
                        Column {
                            Text(
                                displayName(s),
                                style = MaterialTheme.typography.titleLarge,
                            )
                            Text(
                                s?.email ?: "Email will appear here",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(16.dp))
                    ProfileRow("Grade", s?.grade ?: "—")
                }
            }

            Spacer(Modifier.height(20.dp))

            OutlinedButton(
                onClick = { vm.signOut(onSignedOut) },
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text("Sign out")
            }
        }
    }
}

@Composable
private fun ProfileRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun displayName(s: Student?): String {
    if (s == null) return "Student"
    val first = s.firstName.orEmpty().trim()
    val last = s.lastName.orEmpty().trim()
    val full = listOf(first, last).filter { it.isNotEmpty() }.joinToString(" ")
    return full.ifEmpty { s.email.substringBefore('@') }
}

private fun initialsOf(s: Student?): String {
    if (s == null) return "?"
    val f = s.firstName?.firstOrNull()?.uppercaseChar()
    val l = s.lastName?.firstOrNull()?.uppercaseChar()
    return when {
        f != null && l != null -> "$f$l"
        f != null -> f.toString()
        else -> s.email.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    }
}
