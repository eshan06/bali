// The Android student app (docs/ARCHITECTURE.md, "Android app structure", decision 5): `core` and
// `outbox`, plain Kotlin tested on the JVM, and `app`, the Android app. README.md says how to build.
pluginManagement {
    repositories {
        // Google's repository for Google's own groups alone, as Android Studio's template has it.
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "bali"
include(":core", ":outbox", ":app")
