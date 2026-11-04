// BaliOutbox's twin (ARCHITECTURE, "Android app structure", decision 5): the outbox, the sync
// engine, the lock's rules and which screen shows when, plain Kotlin whose tests run on the JVM.
// AN4 picks the outbox's store: Room's JVM build keeps its tests here too.
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
    // Without it the app's Android Lint never reads this module (app/build.gradle.kts).
    alias(libs.plugins.android.lint)
    alias(libs.plugins.animalsniffer)
}

// Java 17's bytecode, which the app's build dexes, whatever JDK runs Gradle (README.md).
java.sourceCompatibility = JavaVersion.VERSION_17
java.targetCompatibility = JavaVersion.VERSION_17
kotlin.compilerOptions.jvmTarget = JvmTarget.JVM_17

dependencies {
    implementation(project(":core"))
    testImplementation(libs.kotlin.test)
    // The classes held to Android 10's API, which Android Lint can't do here (README.md).
    signature(libs.gummy.bears.api29) { artifact { type = "signature" } }
}

// The tests read the repo's contracts/ in place, never a copy (decision 4): an input of the task,
// so a changed table runs them again; and a failure's whole message in the log, where CI shows it.
tasks.test {
    useJUnitPlatform()
    testLogging.exceptionFormat = TestExceptionFormat.FULL
    val contracts = rootDir.resolve("../contracts")
    inputs.dir(contracts).withPropertyName("contracts").withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("bali.contracts", contracts.canonicalPath)
}
