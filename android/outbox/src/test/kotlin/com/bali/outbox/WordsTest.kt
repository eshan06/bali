package com.bali.outbox

import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.BlockRead
import com.bali.core.HostedPage
import com.bali.core.MeResponse
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SignInError
import java.io.IOException
import kotlin.reflect.KClass
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The guard over every Android word (AN10d's, each later AN10 step adding its own to `everyWord`): none names what Android
// lacks (Screen Time, iOS, an iPhone, FaceTime, Emergency SOS: DESIGN.md's Android section, the canvas's Words board) nor holds
// an em-dash or an exclamation mark (DESIGN.md, section 7). It reads each word function for every case of the types it keys on,
// never a list of the words themselves: a case added later with no word stops its function's `when` compiling, and one given
// a word but no sample here fails `each` by name.

/**
 * [cases], at least one of each case the sealed [type] declares, checked against them: a case added later and given no sample
 * here fails by name, so its word is read too.
 */
private fun <T : Any> each(type: KClass<T>, vararg cases: T): List<T> {
    val declared = type.java.declaredClasses.filter { type.java.isAssignableFrom(it) }.map { it.name }.toSortedSet()
    assertEquals(declared, cases.map { it.javaClass.name }.toSortedSet(), "${type.java.simpleName}'s cases, each with a sample")
    return cases.toList()
}

/** `GET /v1/me`'s answer [json], as the phone decodes it. */
private fun me(json: String): MeResponse = BaliJson.decodeFromString(MeResponse.serializer(), json)

/**
 * Every word the app says, by the function that says it, each read for every case of the types it keys on: AN10d's, Join's,
 * Home's, a scan's, Tap in's, the sign-in's and the start's. Each later AN10 step adds its own.
 */
private fun everyWord(): Map<String, List<String>> {
    // Every result an answer can have, a status from 100 to 599 or none, and every reason with none.
    val results = listOf(SendResult.NetworkError) + (100..599).map { SendResult.Status(it) }
    val reasons = ApiErrorReason.entries + null
    val failures = results.flatMap { result -> reasons.map { Joining.Failure.NoClass(result, it) } } + Joining.Failure.NotStarted
    val scans =
        each(
            BlockRead::class, BlockRead.Block("T7XK2M9QPF"), BlockRead.NotBali, BlockRead.Cancelled, BlockRead.Unsupported, BlockRead.NfcOff,
            BlockRead.Failed("A scan is under way."),
        )
    val taps = scans.map { TapFailure.NoBlock(it) } + TapFailure.NotKept + TapFailure.NotStarted
    // Where the phone may stand, with the classes not read, read as none, and read as one.
    val inSession = (ParticipationState.entries + null).map { Standing.InSession(session(), it) }
    val standings = each(Standing::class, Standing.Out, Standing.Waiting, Standing.Unread, *inSession.toTypedArray())
    val classes = listOf(null, me(Answer.me(null)), me(Answer.me(null, classes = listOf(Answer.inClass("c")))))
    val states = standings.flatMap { standing -> classes.map { SyncState(standing = standing, me = it) } }
    val refusals = listOf(null, "access_denied", "server_error", "temporarily_unavailable", "invalid_grant").map { SignInError.Refused(it) }
    val signIns =
        each(
            SignInError::class, SignInError.Cancelled, SignInError.NotOpened("another sign-in page is open"), SignInError.Unreachable,
            *refusals.toTypedArray(), SignInError.NotKept,
        )
    return mapOf(
        "Joining.Failure.words" to each(Joining.Failure::class, *failures.toTypedArray()).map { it.words },
        "SyncState.meWords" to each(SendResult::class, *results.toTypedArray()).map { SyncState(meFailed = it).meWords },
        "BlockRead.words" to scans.map { it.words },
        "TapFailure.words" to each(TapFailure::class, *taps.toTypedArray()).map { it.words },
        "StuckTap.words" to StuckTap.entries.flatMap { stuck -> listOf(false, true).map { stuck.words(inNoClass = it) } },
        "SyncState.waitingCard" to states.map { it.waitingCard },
        "SyncState.noClassesCard" to states.flatMap { state -> listOf(false, true).map { state.noClassesCard(everInClass = it) } },
        "SignInError.words" to signIns.flatMap { error -> HostedPage.entries.map { error.words(it) } },
        "Problem.words" to each(Problem::class, Problem.NotSetUp, Problem.StartFailed(IOException("disk I/O error"))).map { it.words },
    ).mapValues { (_, words) -> words.filterNotNull() }
}

/** Every Android word, held to what Android has and to DESIGN.md's voice. */
class WordsTest {
    @Test
    fun noWordNamesWhatAndroidLacksScreenTimeIosAnIphoneFaceTimeOrEmergencySosNorHoldsAnEmDashOrAnExclamationMark() {
        val lacked = listOf("Screen Time", "iOS", "iPhone", "FaceTime", "Emergency SOS")
        for ((function, words) in everyWord()) {
            // Every function read says something, so none is left out of the guard unread.
            assertTrue(words.isNotEmpty(), "$function said nothing")
            for (word in words.toSet()) {
                for (name in lacked) assertFalse(name in word, "$function names $name: $word")
                assertFalse(Char(0x2014) in word, "$function holds an em-dash: $word")
                assertFalse('!' in word, "$function holds an exclamation mark: $word")
            }
        }
    }
}
