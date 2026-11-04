// The student app (ARCHITECTURE, "Android app structure", decision 5): the screens, the lock's
// service, NFC, sign-in and push, over core and outbox; no screen until Phase 10's steps. Its id
// and SDK levels are decided in docs/DECISIONS.md (2026-11-04, AN2).
plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.bali.bali"
    // What the PC's SDK and CI's runner both hold, so the plugin never installs a package (README.md).
    compileSdk {
        version = release(36) { minorApiLevel = 1 }
    }
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.bali.bali"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        // The instrumented tests (src/androidTest), on an emulator: README.md, "On the PC".
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Java 17's bytecode, as core's and outbox's.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // core's and outbox's code too, though Android's API check (NewApi) reaches only this
        // module's: theirs is built against the JDK (README.md, "core and outbox").
        checkDependencies = true
        warningsAsErrors = true
        // A newer release or SDK trips these, not the code, so CI would turn red overnight; and
        // targetSdk follows Play's yearly rule, not the newest Android (docs/DECISIONS.md).
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":outbox"))
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.junit)
    // The outbox's file written as SQLite alone, beside Room (OutboxFileTest.kt).
    androidTestImplementation(libs.sqlite.bundled)
}
