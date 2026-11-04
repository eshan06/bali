plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// A second build under another package name (`-PspikeId=com.bali.spike.other`) is "another VPN"
// for lock (c)'s takeover line, so no VPN app has to come from the web.
val spikeId = (findProperty("spikeId") as String?) ?: "com.bali.spike"

android {
    namespace = "com.bali.spike"
    compileSdk = 35
    defaultConfig {
        applicationId = spikeId
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "spike-1"
        resValue("string", "app_label", if (spikeId == "com.bali.spike") "Bali spike" else "Bali spike other")
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
