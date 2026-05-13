package com.bali.student.ui.screens

import android.app.Activity
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bali.student.data.api.BaliApi
import com.bali.student.data.auth.AmplifyAuth
import com.bali.student.ui.theme.BaliBackground
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject

private const val ERR_BAD_CREDENTIALS = "We couldn't sign you in. Check your email and password."
private const val ERR_LOAD_ACCOUNT = "We couldn't load your account. Try again."
private const val ERR_NOT_STUDENT =
    "This app is for students. Please use the web dashboard for teacher tools."

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val needsConfirm: Boolean = false,
    val confirmCode: String = "",
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val auth: AmplifyAuth,
    private val api: BaliApi,
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state

    fun setEmail(v: String) { _state.value = _state.value.copy(email = v, error = null) }
    fun setPassword(v: String) { _state.value = _state.value.copy(password = v, error = null) }
    fun setCode(v: String) { _state.value = _state.value.copy(confirmCode = v, error = null) }

    fun signIn(onSuccess: () -> Unit) {
        val s = _state.value
        if (s.email.isBlank() || s.password.isBlank()) return
        _state.value = s.copy(loading = true, error = null)
        viewModelScope.launch {
            auth.signIn(s.email.trim(), s.password)
                .onSuccess { verifyStudentAndProceed(onSuccess) }
                .onFailure { _state.value = _state.value.copy(loading = false, error = ERR_BAD_CREDENTIALS) }
        }
    }

    fun signInWithGoogle(activity: Activity, onSuccess: () -> Unit) {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            auth.signInWithGoogle(activity)
                .onSuccess { verifyStudentAndProceed(onSuccess) }
                .onFailure { _state.value = _state.value.copy(loading = false, error = ERR_BAD_CREDENTIALS) }
        }
    }

    fun confirm(onSuccess: () -> Unit) {
        val s = _state.value
        if (s.confirmCode.isBlank()) return
        _state.value = s.copy(loading = true, error = null)
        viewModelScope.launch {
            auth.confirmSignUp(s.email.trim(), s.confirmCode.trim())
                .onSuccess {
                    _state.value = _state.value.copy(loading = false, needsConfirm = false)
                    onSuccess()
                }
                .onFailure {
                    _state.value = _state.value.copy(loading = false, error = ERR_BAD_CREDENTIALS)
                }
        }
    }

    private suspend fun verifyStudentAndProceed(onSuccess: () -> Unit) {
        runCatching { api.getStudentSelf() }
            .onSuccess {
                _state.value = _state.value.copy(loading = false)
                onSuccess()
            }
            .onFailure { t ->
                val notStudent = t is HttpException && (t.code() == 403 || t.code() == 404)
                auth.signOut()
                _state.value = _state.value.copy(
                    loading = false,
                    error = if (notStudent) ERR_NOT_STUDENT else ERR_LOAD_ACCOUNT,
                )
            }
    }
}

@Composable
private fun findActivity(): Activity? {
    val context = LocalContext.current
    return remember(context) {
        var ctx = context
        while (ctx is ContextWrapper) {
            if (ctx is Activity) return@remember ctx
            ctx = ctx.baseContext
        }
        null
    }
}

@Composable
fun LoginScreen(
    onSignedIn: () -> Unit,
    vm: LoginViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsState()
    val activity = findActivity()

    BaliBackground {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "bali",
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Black,
                fontSize = 36.sp,
            )
            Spacer(Modifier.height(28.dp))
            Text(
                text = "Welcome to Bali",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Sign in to view your classes and check in during class.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(24.dp))

            Card(
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    OutlinedButton(
                        onClick = { activity?.let { vm.signInWithGoogle(it, onSignedIn) } },
                        enabled = !state.loading && activity != null,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        Text("Continue with Google")
                    }

                    Spacer(Modifier.height(16.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        HorizontalDivider(modifier = Modifier.weight(1f))
                        Text(
                            text = "or",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                        HorizontalDivider(modifier = Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = state.email,
                        onValueChange = vm::setEmail,
                        label = { Text("Email") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.loading,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = state.password,
                        onValueChange = vm::setPassword,
                        label = { Text("Password") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.loading,
                    )

                    if (state.needsConfirm) {
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = state.confirmCode,
                            onValueChange = vm::setCode,
                            label = { Text("Confirmation code") },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !state.loading,
                        )
                    }

                    state.error?.let {
                        Spacer(Modifier.height(14.dp))
                        ErrorBox(message = it)
                    }

                    Spacer(Modifier.height(18.dp))
                    Button(
                        onClick = {
                            if (state.needsConfirm) vm.confirm(onSignedIn) else vm.signIn(onSignedIn)
                        },
                        enabled = !state.loading,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        if (state.loading) {
                            Box(modifier = Modifier.height(20.dp).width(20.dp)) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                )
                            }
                        } else {
                            Text(if (state.needsConfirm) "Confirm" else "Sign in")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorBox(message: String) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = androidx.compose.ui.graphics.Color(0xFFFEECEC),
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(14.dp),
        )
    }
}
