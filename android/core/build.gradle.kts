// BaliCore's twin (ARCHITECTURE, "Android app structure", decision 5): the wire types, the
// vocabulary, event ids, the API client and BlockTag, plain Kotlin whose tests run on the JVM.
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
    // Without it the app's Android Lint never reads this module (app/build.gradle.kts).
    alias(libs.plugins.android.lint)
}

// Java 17's bytecode, which the app's build dexes, whatever JDK runs Gradle (README.md).
java.sourceCompatibility = JavaVersion.VERSION_17
java.targetCompatibility = JavaVersion.VERSION_17
kotlin.compilerOptions.jvmTarget = JvmTarget.JVM_17

dependencies { testImplementation(libs.kotlin.test) }

// The tests read the repo's contracts/ in place, never a copy (decision 4): an input of the task,
// so a changed fixture runs them again; and a failure's whole message in the log, where CI shows it.
tasks.test {
    useJUnitPlatform()
    testLogging.exceptionFormat = TestExceptionFormat.FULL
    val contracts = rootDir.resolve("../contracts")
    inputs.dir(contracts).withPropertyName("contracts").withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("bali.contracts", contracts.canonicalPath)
}
