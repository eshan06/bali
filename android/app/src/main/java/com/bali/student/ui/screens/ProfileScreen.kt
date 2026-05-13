package com.bali.student.ui.screens

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.model.Student
import com.bali.student.data.model.StudentProfileUpdate
import com.bali.student.ui.theme.AccentGreen
import com.bali.student.ui.theme.BaliBackground
import com.bali.student.ui.theme.GreenTint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val ERR_LOAD = "We couldn't load your profile."
private const val ERR_SAVE = "We couldn't save your changes. Try again."

data class ProfileUiState(
    val loading: Boolean = true,
    val saving: Boolean = false,
    val student: Student? = null,
    val firstName: String = "",
    val lastName: String = "",
    val grade: String = "",
    val loadError: String? = null,
    val saveError: String? = null,
    val saveSuccess: Boolean = false,
) {
    val dirty: Boolean
        get() {
            val s = student ?: return false
            return firstName.trim() != (s.firstName ?: "").trim() ||
                lastName.trim() != (s.lastName ?: "").trim() ||
                grade.trim() != (s.grade ?: "").trim()
        }

    val canSave: Boolean
        get() = dirty && firstName.isNotBlank() && lastName.isNotBlank() && !saving
}

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val api: BaliApi,
) : ViewModel() {
    private val _state = MutableStateFlow(ProfileUiState())
    val state: StateFlow<ProfileUiState> = _state

    init { load() }

    private fun load() {
        _state.value = _state.value.copy(loading = true, loadError = null)
        viewModelScope.launch {
            runCatching { api.getStudentSelf() }
                .onSuccess { self ->
                    _state.value = _state.value.copy(
                        loading = false,
                        student = self.student,
                        firstName = self.student.firstName.orEmpty(),
                        lastName = self.student.lastName.orEmpty(),
                        grade = self.student.grade.orEmpty(),
                        loadError = null,
                    )
                }
                .onFailure {
                    _state.value = _state.value.copy(loading = false, loadError = ERR_LOAD)
                }
        }
    }

    fun setFirstName(v: String) {
        _state.value = _state.value.copy(firstName = v, saveError = null, saveSuccess = false)
    }
    fun setLastName(v: String) {
        _state.value = _state.value.copy(lastName = v, saveError = null, saveSuccess = false)
    }
    fun setGrade(v: String) {
        _state.value = _state.value.copy(grade = v, saveError = null, saveSuccess = false)
    }

    fun save() {
        val s = _state.value
        if (!s.canSave) return
        _state.value = s.copy(saving = true, saveError = null, saveSuccess = false)
        viewModelScope.launch {
            val body = StudentProfileUpdate(
                firstName = s.firstName.trim(),
                lastName = s.lastName.trim(),
                grade = s.grade.trim().takeIf { it.isNotEmpty() },
            )
            runCatching { api.updateStudentProfile(body) }
                .onSuccess { self ->
                    _state.value = _state.value.copy(
                        saving = false,
                        student = self.student,
                        firstName = self.student.firstName.orEmpty(),
                        lastName = self.student.lastName.orEmpty(),
                        grade = self.student.grade.orEmpty(),
                        saveSuccess = true,
                        saveError = null,
                    )
                }
                .onFailure {
                    _state.value = _state.value.copy(saving = false, saveError = ERR_SAVE)
                }
        }
    }
}

@Composable
fun ProfileScreen(
    vm: ProfileViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()

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
            Spacer(Modifier.height(4.dp))
            Text(
                "Manage your student profile.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))

            when {
                state.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }
                state.loadError != null -> Card(
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        state.loadError!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(20.dp),
                    )
                }
                else -> Loaded(state = state, vm = vm)
            }
        }
    }
}

@Composable
private fun Loaded(state: ProfileUiState, vm: ProfileViewModel) {
    val s = state.student ?: return
    HeaderCard(student = s, displayFirst = state.firstName, displayLast = state.lastName, displayGrade = state.grade)
    Spacer(Modifier.height(14.dp))
    EditCard(state = state, vm = vm)
}

@Composable
private fun HeaderCard(
    student: Student,
    displayFirst: String,
    displayLast: String,
    displayGrade: String,
) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(56.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        initialsOf(displayFirst, displayLast, student.email),
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Black,
                        fontSize = 20.sp,
                    )
                }
            }
            Spacer(Modifier.size(16.dp))
            Column {
                Text(
                    displayNameOf(displayFirst, displayLast, student.email),
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    student.email,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (displayGrade.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Grade ${displayGrade.trim()}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun EditCard(state: ProfileUiState, vm: ProfileViewModel) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            OutlinedTextField(
                value = state.firstName,
                onValueChange = vm::setFirstName,
                label = { Text("First name") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.saving,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.lastName,
                onValueChange = vm::setLastName,
                label = { Text("Last name") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.saving,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.grade,
                onValueChange = vm::setGrade,
                label = { Text("Grade") },
                placeholder = { Text("e.g. 10") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.saving,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = state.student?.email.orEmpty(),
                onValueChange = {},
                label = { Text("Email") },
                singleLine = true,
                readOnly = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Email comes from your sign-in method and can't be changed here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (state.saveError != null) {
                Spacer(Modifier.height(14.dp))
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFEECEC)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        state.saveError,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            if (state.saveSuccess) {
                Spacer(Modifier.height(14.dp))
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = GreenTint),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Profile updated.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = AccentGreen,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = vm::save,
                enabled = state.canSave,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text(if (state.saving) "Saving…" else "Save changes")
            }
        }
    }
}

private fun displayNameOf(first: String, last: String, email: String): String {
    val full = listOf(first.trim(), last.trim()).filter { it.isNotEmpty() }.joinToString(" ")
    return full.ifEmpty { email.substringBefore('@') }
}

private fun initialsOf(first: String, last: String, email: String): String {
    val f = first.trim().firstOrNull()?.uppercaseChar()
    val l = last.trim().firstOrNull()?.uppercaseChar()
    return when {
        f != null && l != null -> "$f$l"
        f != null -> f.toString()
        else -> email.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    }
}
