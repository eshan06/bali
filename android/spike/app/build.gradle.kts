plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bali.spike"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.bali.spike"
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

dependencies {
    testImplementation("junit:junit:4.13.2")
}
