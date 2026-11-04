// Each plugin's version, in one place (gradle/libs.versions.toml); each module applies its own.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
}
