package com.bali.student.data.auth

import android.app.Activity
import android.util.Base64
import com.amplifyframework.auth.AuthProvider
import com.amplifyframework.auth.AuthUserAttributeKey
import com.amplifyframework.auth.cognito.result.AWSCognitoAuthSignOutResult
import com.amplifyframework.auth.options.AuthSignUpOptions
import com.amplifyframework.auth.cognito.AWSCognitoAuthSession
import com.amplifyframework.kotlin.core.Amplify
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AmplifyAuth @Inject constructor() {

    private val tokenMutex = Mutex()
    @Volatile private var cachedToken: String? = null
    @Volatile private var cachedExpiryMs: Long = 0L

    suspend fun signIn(email: String, password: String): Result<Unit> = runCatching {
        Amplify.Auth.signIn(email, password)
        Unit
    }.also { invalidateToken() }

    suspend fun signInWithGoogle(activity: Activity): Result<Unit> = runCatching {
        Amplify.Auth.signInWithSocialWebUI(AuthProvider.google(), activity)
        Unit
    }.also { invalidateToken() }

    suspend fun signUp(email: String, password: String): Result<Unit> = runCatching {
        val options = AuthSignUpOptions.builder()
            .userAttribute(AuthUserAttributeKey.email(), email)
            .build()
        Amplify.Auth.signUp(email, password, options)
        Unit
    }

    suspend fun confirmSignUp(email: String, code: String): Result<Unit> = runCatching {
        Amplify.Auth.confirmSignUp(email, code)
        Unit
    }

    suspend fun signOut(): Result<Unit> = runCatching {
        when (val res = Amplify.Auth.signOut()) {
            is AWSCognitoAuthSignOutResult.CompleteSignOut -> Unit
            is AWSCognitoAuthSignOutResult.PartialSignOut -> Unit
            is AWSCognitoAuthSignOutResult.FailedSignOut -> throw res.exception
        }
    }.also { invalidateToken() }

    suspend fun currentJwt(): String? {
        val safetyMarginMs = 60_000L
        val now = System.currentTimeMillis()
        val cached = cachedToken
        if (cached != null && now < cachedExpiryMs - safetyMarginMs) {
            return cached
        }
        return tokenMutex.withLock {
            val now2 = System.currentTimeMillis()
            val rechecked = cachedToken
            if (rechecked != null && now2 < cachedExpiryMs - safetyMarginMs) {
                return@withLock rechecked
            }
            val fresh = runCatching {
                val session = Amplify.Auth.fetchAuthSession() as AWSCognitoAuthSession
                session.userPoolTokensResult.value?.idToken
            }.getOrNull()
            if (fresh != null) {
                cachedToken = fresh
                // Fall back to ~50 minutes if we can't parse the JWT for some reason.
                cachedExpiryMs = parseJwtExpiryMs(fresh) ?: (now2 + 50 * 60_000L)
            } else {
                cachedToken = null
                cachedExpiryMs = 0L
            }
            fresh
        }
    }

    suspend fun isSignedIn(): Boolean = runCatching {
        Amplify.Auth.fetchAuthSession().isSignedIn
    }.getOrDefault(false)

    private fun invalidateToken() {
        cachedToken = null
        cachedExpiryMs = 0L
    }

    private fun parseJwtExpiryMs(token: String): Long? = runCatching {
        val parts = token.split('.')
        if (parts.size < 2) return@runCatching null
        val payloadBytes = Base64.decode(
            parts[1],
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
        )
        val payload = JSONObject(payloadBytes.toString(Charsets.UTF_8))
        if (!payload.has("exp")) return@runCatching null
        payload.getLong("exp") * 1000L
    }.getOrNull()
}
