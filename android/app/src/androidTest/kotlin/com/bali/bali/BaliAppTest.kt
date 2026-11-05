package com.bali.bali

import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bali.core.AppConfig
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The build's values as the app reads them on the phone: what core's AppConfigTest pins in the files,
 * here through aapt, the manifest and Android's reading of it; and what the app starts on them.
 */
@RunWith(AndroidJUnit4::class)
class BaliAppTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val app = context.applicationContext as BaliApp

    @Test
    fun everyValueArrivesAsTextAndWhileTheClientIdIsEmptySignInIsNotSetUp() {
        @Suppress("DEPRECATION")
        val meta = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
        // Each a string, never a number aapt read one as, which AppConfig would read as not set.
        val built = AppConfig.Key.entries.associate { it.key to checkNotNull(meta.getString(it.key)) { it.key } }
        val clientId = built.getValue(AppConfig.Key.CognitoClientId.key)
        assertEquals(clientId.isEmpty(), app.config == null)
        assertEquals(app.config == null, app.signIn == null)
        val config = checkNotNull(AppConfig.from(built + (AppConfig.Key.CognitoClientId.key to clientId.ifEmpty { "client" })))
        assertEquals(URI("com.bali.bali:/auth/callback"), config.cognito.redirectUri)
    }

    // The build's client id stays empty until the owner's (docs/DEPLOY.md): until then, as on iOS, the app
    // starts no engine, nor an enforcer over the lock. LockServiceTest hands the app engines of its own.
    @Test
    fun withSignInNotSetUpTheAppStartsNoEngine() {
        assertNull(app.signIn)
        assertNull(app.running.value)
    }
}
