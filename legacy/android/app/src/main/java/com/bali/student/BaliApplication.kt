package com.bali.student

import android.app.Application
import android.util.Log
import com.amplifyframework.AmplifyException
import com.amplifyframework.auth.cognito.AWSCognitoAuthPlugin
import com.amplifyframework.core.Amplify
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class BaliApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            Amplify.addPlugin(AWSCognitoAuthPlugin())
            Amplify.configure(applicationContext)
            Log.i("BaliApp", "Amplify configured")
        } catch (e: AmplifyException) {
            Log.e("BaliApp", "Amplify configure failed", e)
        }
    }
}
