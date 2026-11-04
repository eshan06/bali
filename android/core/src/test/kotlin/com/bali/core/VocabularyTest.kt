package com.bali.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `@bali/shared`'s TypeScript, `packages/shared/src/`, read in place from the repo and never
 * copied into this module, as BaliCore's tests read it. Gradle names the folder (build.gradle.kts).
 */
object Shared {
    /** The folder. A run outside Gradle leaves it unset, and it throws. */
    val src =
        File(
            checkNotNull(System.getProperty("bali.shared")) {
                "bali.shared is unset: run the tests through Gradle (android/README.md)"
            },
        )

    /** One file of it; a missing one throws. */
    fun source(file: String): String = File(src, file).readText()

    /**
     * The values of `export const <name> = [...] as const`, or the keys of `= {...} as const`, in
     * [source], its comments left out. A list it can't find throws, never reads as empty.
     */
    fun values(name: String, source: String): List<String> {
        val opening = "export const $name = "
        val start = source.indexOf(opening).also { check(it >= 0) { "no $name" } } + opening.length
        val isObject = source.startsWith("{", start)
        val end = source.indexOf(if (isObject) "} as const" else "] as const", start)
        check(end >= 0) { "$name never ends" }
        val list = source.substring(start, end).lines().joinToString("\n") { it.substringBefore("//") }
        val value = if (isObject) Regex("""(\w+):""") else Regex("""'([^']*)'""")
        return value.findAll(list).map { it.groupValues[1] }.toList()
    }
}

/**
 * Each vocabulary against the `@bali/shared` list it mirrors, read from the TypeScript itself: a
 * value added there fails here until `core` has it too, even one no fixture carries yet. AN3b
 * adds the lists of `api.ts` that each response type keeps for its own outcomes.
 */
class VocabularyTest {
    /** Each vocabulary: the file its list is in, the list, and `core`'s values for it. */
    private val vocabularies: List<Triple<String, String, List<Vocabulary>>> =
        listOf(
            Triple("index.ts", "USER_ROLES", UserRole.entries),
            Triple("index.ts", "PARTICIPATION_STATES", ParticipationState.entries),
            Triple("index.ts", "HISTORY_EVENT_TYPES", HistoryEventType.entries),
            Triple("index.ts", "UNLOCK_RECORDED_AS", UnlockRecordedAs.entries),
            Triple("index.ts", "PROTECTION_OFF_RECORDED_AS", ProtectionOffRecordedAs.entries),
            Triple("index.ts", "RETURN_RECORDED_AS", ReturnRecordedAs.entries),
            Triple("index.ts", "UNLOCK_REASONS", UnlockReason.entries),
            Triple("errors.ts", "API_ERROR_STATUS", ApiErrorCode.entries),
            Triple("errors.ts", "API_ERROR_REASONS", ApiErrorReason.entries),
            Triple("outbox-contract.ts", "TAP_OUTCOMES", TapOutcome.entries),
            Triple("outbox-contract.ts", "STATE_CHANGE_OUTCOMES", StateChangeOutcome.entries),
            Triple("unlock-contract.ts", "UNLOCK_RECORDED_OUTCOMES", UnlockOutcome.entries),
            Triple("api.ts", "PUSH_ENVIRONMENTS", PushEnvironment.entries),
        )

    @Test
    fun eachVocabularyHoldsItsListsValuesInItsOrder() {
        val wrong =
            vocabularies.mapNotNull { (file, list, values) ->
                val typescript = Shared.values(list, Shared.source(file))
                val kotlin = values.map { it.wire }
                if (typescript == kotlin) null else "$list ($file): TypeScript $typescript, core $kotlin"
            }
        assertTrue(wrong.isEmpty(), wrong.joinToString("\n"))
    }

    @Test
    fun displayStateIsTheStoredStatesThenTheDerivedOnes() {
        val stored = Shared.values("PARTICIPATION_STATES", Shared.source("index.ts"))
        val type = Regex("""export type DisplayState = ParticipationState(.*);""").find(Shared.source("state.ts"))
        val derived = Regex("""'([^']*)'""").findAll(checkNotNull(type) { "no DisplayState" }.groupValues[1])
        assertEquals(stored + derived.map { it.groupValues[1] }, DisplayState.entries.map { it.wire })
    }
}
