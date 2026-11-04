// BaliOutbox's twin (ARCHITECTURE, "Android app structure", decision 5): the outbox, the sync
// engine, the lock's rules and which screen shows when, plain Kotlin whose tests run on the JVM.
// The outbox's file is Room's, through its JVM build, so its tests run here too (AN4c).
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
    // The tests read contracts/outbox/'s case files as typed values (OutboxContractTest.kt).
    alias(libs.plugins.kotlin.serialization)
    // Room's code, generated from OutboxDatabase.kt; its schema kept in schemas/ (README.md).
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
    // Without it the app's Android Lint never reads this module (app/build.gradle.kts).
    alias(libs.plugins.android.lint)
    alias(libs.plugins.animalsniffer)
}

// Java 17's bytecode, which the app's build dexes, whatever JDK runs Gradle (README.md).
java.sourceCompatibility = JavaVersion.VERSION_17
java.targetCompatibility = JavaVersion.VERSION_17
kotlin.compilerOptions.jvmTarget = JvmTarget.JVM_17

// Each version of the file's schema, written by Room's compiler and committed, so a migration is
// checked against the schema it starts from.
room {
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    // Its records' API is core's types: the requests, the answers, the client (OutboxRecord.kt).
    api(project(":core"))
    // The app builds the file with Room's own builder, Android's, and hands it to Outbox.open.
    api(libs.room.runtime)
    // The sync engine's own API: the scope its calls run in, its state as a flow (SyncEngine.kt).
    api(libs.kotlinx.coroutines.core)
    implementation(libs.sqlite.bundled)
    ksp(libs.room.compiler)
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
