// BaliCore's twin (ARCHITECTURE, "Android app structure", decision 5): the wire types, the
// vocabulary, event ids, the API client and BlockTag, plain Kotlin whose tests run on the JVM.
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    // Without it the app's Android Lint never reads this module (app/build.gradle.kts).
    alias(libs.plugins.android.lint)
    alias(libs.plugins.animalsniffer)
}

// Java 17's bytecode, which the app's build dexes, whatever JDK runs Gradle (README.md).
java.sourceCompatibility = JavaVersion.VERSION_17
java.targetCompatibility = JavaVersion.VERSION_17
kotlin.compilerOptions.jvmTarget = JvmTarget.JVM_17

dependencies {
    // Its types are core's own API's: an error's details, every type's serializer.
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlin.test)
    // The classes held to Android 10's API, which Android Lint can't do here (README.md).
    signature(libs.gummy.bears.api29) { artifact { type = "signature" } }
}

// The tests read the repo's contracts/ and @bali/shared's lists in place, never a copy (decision
// 4): inputs of the task, so a changed fixture or list runs them again; and a failure's whole
// message in the log, where CI shows it.
tasks.test {
    useJUnitPlatform()
    testLogging.exceptionFormat = TestExceptionFormat.FULL
    val contracts = rootDir.resolve("../contracts")
    inputs.dir(contracts).withPropertyName("contracts").withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("bali.contracts", contracts.canonicalPath)
    val shared = rootDir.resolve("../packages/shared/src")
    inputs.dir(shared).withPropertyName("shared").withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("bali.shared", shared.canonicalPath)
}
