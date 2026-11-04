package com.bali.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The phone's contract (ARCHITECTURE, "The fixtures are the phone's contract"): the API's real
 * answer to every student request, as `contracts/fixtures/` holds it, read in place from the repo
 * and never copied into this module, as BaliCore's tests read it. Gradle names the folder
 * (build.gradle.kts); AN3 decodes every fixture.
 */
object Contract {
    /** The repo's `contracts/`. A run outside Gradle leaves it unset, and it throws. */
    val root =
        File(
            checkNotNull(System.getProperty("bali.contracts")) {
                "bali.contracts is unset: run the tests through Gradle (android/README.md)"
            },
        )

    val fixtures = File(root, "fixtures")

    /**
     * Every fixture, by its path under `contracts/fixtures/`: found by walking the folder, never
     * listed by hand, so a fixture the API gains is read here the day it lands. A missing folder
     * throws: the contract is never passed by checking nothing.
     */
    fun fixturePaths(): List<String> {
        check(fixtures.isDirectory) { "no folder at $fixtures" }
        return fixtures
            .walk()
            .filter { it.isFile && it.name.endsWith(".json") }
            .map { it.relativeTo(fixtures).invariantSeparatorsPath }
            .sorted()
            .toList()
    }
}

class ContractFixtureTest {
    @Test
    fun findsEveryFixtureInTheRepo() {
        // The repo's contracts/, beside the API's description, and not some other folder.
        assertTrue(File(Contract.root, "openapi.json").isFile, "${Contract.root} isn't the repo's contracts/")
        val paths = Contract.fixturePaths()
        assertTrue(paths.isNotEmpty(), "no fixture under ${Contract.fixtures}")
        for (path in paths) {
            val text = File(Contract.fixtures, path).readText()
            assertTrue(text.trimStart().startsWith("{") && "\"endpoint\"" in text, "$path is no fixture")
        }
    }
}
