package com.bali.outbox

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The outbox contract's cases, as `contracts/outbox/` holds them: the TypeScript's own answer on
 * every input its golden test sends (packages/shared/src/outbox-cases.test.ts), read in place from
 * the repo, as BaliCore's tests read them. Gradle names the folder (build.gradle.kts); AN4 runs
 * every case against the port.
 */
object OutboxCases {
    /** The repo's `contracts/outbox/`. A run outside Gradle leaves it unset, and it throws. */
    val directory =
        File(
            checkNotNull(System.getProperty("bali.contracts")) {
                "bali.contracts is unset: run the tests through Gradle (android/README.md)"
            },
            "outbox",
        )

    /**
     * Every case file, found by walking the folder, never listed by hand. A missing folder
     * throws: the port is never passed by checking nothing.
     */
    fun files(): List<String> {
        check(directory.isDirectory) { "no folder at $directory" }
        return directory.listFiles().orEmpty().filter { it.isFile && it.name.endsWith(".json") }.map { it.name }.sorted()
    }
}

class OutboxContractTest {
    @Test
    fun findsEveryCaseFileInTheRepo() {
        val files = OutboxCases.files()
        assertTrue(files.isNotEmpty(), "no case file in ${OutboxCases.directory}")
        // Every file names the TypeScript function whose answers it holds.
        for (file in files) {
            val text = File(OutboxCases.directory, file).readText()
            assertTrue(text.trimStart().startsWith("{") && "\"function\"" in text, "$file names no function")
        }
    }
}
