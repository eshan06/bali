// AN1's lock spike: throwaway, on its own branch, never merged (docs/PLAN-ANDROID.md, AN1).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "bali-spike"
include(":app", ":target")
