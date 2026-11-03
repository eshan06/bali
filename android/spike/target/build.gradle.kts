// A stand-in for a blocked app: picture-in-picture, a tone, and a notification on demand, so the
// spike's "ways around the cover" lines don't depend on what an emulator image happens to carry.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bali.spike.target"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.bali.spike.target"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "spike-1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false }
}
