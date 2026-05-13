package com.bali.student.data.auth

import android.app.Activity
import com.amplifyframework.auth.AuthProvider
import com.amplifyframework.auth.AuthUserAttributeKey
import com.amplifyframework.auth.cognito.result.AWSCognitoAuthSignOutResult
import com.amplifyframework.auth.options.AuthSignUpOptions
import com.amplifyframework.auth.cognito.AWSCognitoAuthSession
import com.amplifyframework.kotlin.core.Amplify
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AmplifyAuth @Inject constructor() {

    suspend fun signIn(email: String, password: String): Result<Unit> = runCatching {
        Amplify.Auth.signIn(email, password)
        Unit
    }

    suspend fun signInWithGoogle(activity: Activity): Result<Unit> = runCatching {
        Amplify.Auth.signInWithSocialWebUI(AuthProvider.google(), activity)
        Unit
    }

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
    }

    suspend fun currentJwt(): String? = runCatching {
        val session = Amplify.Auth.fetchAuthSession() as AWSCognitoAuthSession
        session.userPoolTokensResult.value?.idToken
    }.getOrNull()

    suspend fun isSignedIn(): Boolean = runCatching {
        Amplify.Auth.fetchAuthSession().isSignedIn
    }.getOrDefault(false)
}
