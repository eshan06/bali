package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.ApiErrorReason
import com.bali.core.ApiResponse
import com.bali.core.BaliJson
import com.bali.core.EnrollmentJoinRequest
import com.bali.core.EventId
import com.bali.core.JoinCodePreviewResponse
import com.bali.core.MeClass
import com.bali.core.SendResult
import com.bali.core.TokenProvider
import java.io.File
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The Join screen's rules (C2b), over A6's fixtures and the join's, and joining through the engine (C3): BaliOutbox's
// JoinTests and JoinEngineTests, each failure checked as a type and in its words (AN10d), iOS's word for word. And new: a code's
// whole characters, a renewal that throws or ends in a cancel of its own, a join whose caller is cancelled, and a phone whose
// engine hasn't started.

/** The real client, answering every request with `contracts/fixtures/[path]`'s status and body: BaliOutbox's JoinTests' `fixture`. */
fun fixture(path: String): ApiClient {
    val answer = BaliJson.parseToJsonElement(OutboxCases.directory.resolveSibling("fixtures").resolve(path).readText()).jsonObject
    return client(Canned(answer.getValue("status").jsonPrimitive.int, answer.getValue("body").toString()))
}

/** Gives no token, so nothing is sent. */
private object NoToken : TokenProvider {
    override suspend fun accessToken(): String? = null
}

private val request = EnrollmentJoinRequest("6BVZA5", EventId.mint(t0), t0)
private val notFound = Joining.Failure.NoClass(SendResult.Status(404), ApiErrorReason.ClassNotFound)
private val unreachable = Joining.Failure.NoClass(SendResult.NetworkError, null)

/** What the screen says of each, iOS's word for word: BaliOutbox's JoinTests' `notFound`, `unreachable` and `generic`, and its 401's. */
private const val NOT_FOUND = "No class has that code. Check it with your teacher and try again."
private const val UNREACHABLE = "Can't reach the server. Check your connection and try again."
private const val GENERIC = "Something went wrong at Bali. Try again in a moment."
private const val SIGN_IN = "Bali couldn't check your sign-in. Try again."

/** The screen with `6BVZA5` typed and looked up, its preview showing. */
private suspend fun previewing(): Joining {
    val joining = Joining().type("6BVZA5")
    return joining.looked(fixture("join-codes/found.json").previewJoinCode("6BVZA5"), "6BVZA5").also { assertNotNull(it.preview) }
}

/** The Join screen's rules (C2b): BaliOutbox's JoinTests. */
class JoinTest {
    @Test
    fun aCodeIsKeptAsCodesAreWrittenAsciiLettersAndDigitsInUpperCaseAtMostJoinCodeLengthEachWholeCharacterJudgedOnlyAWholeOneIsLookedUp() {
        // Typing clears what went wrong with the code before.
        val typed = Joining().type("kwx 49q")
        assertEquals("KWX49Q", typed.code)
        assertTrue(typed.complete)
        assertEquals("KWX49Q", Joining().type("KWX-49Q-ZZ").code)
        val short = Joining().type("kwx4")
        assertEquals("KWX4", short.code)
        assertFalse(short.complete)
        assertEquals("9", Joining().type("é9ß!").code)
        // Swift's whole characters: a letter made of a base and its accent, and a digit made a keycap, are neither.
        assertEquals("A", Joining().type("é 1️⃣ a").code)
        assertNull(Joining(failure = notFound).type("9A").failure)
        val shared = File(checkNotNull(System.getProperty("bali.shared")) { "bali.shared is unset: run the tests through Gradle (android/README.md)" })
        assertTrue("export const JOIN_CODE_LENGTH = ${Joining.CODE_LENGTH};" in shared.resolve("index.ts").readText())
    }

    @Test
    fun aCodesPreviewAsTheApiAnswersItWhatTheCodeOpensATeacherWithNoNameAndAClassTheStudentIsInAlreadyTooOrWhyNotItsResultAndReason(): Unit =
        runBlocking {
            val found = previewing()
            assertEquals(
                listOf<Any?>("Class fx-enroll", "Ms. Rivera", false, null),
                listOf(found.preview?.schoolClass?.name, found.preview?.teacher?.displayName, found.preview?.alreadyEnrolled, found.failure),
            )
            val cases =
                listOf<Pair<String, (Joining) -> Boolean>>(
                    "already-enrolled" to { it.preview?.alreadyEnrolled == true && it.failure == null },
                    "unnamed-teacher" to { it.preview != null && it.preview.teacher.displayName == null },
                    "404-class-not-found" to { it.preview == null && it.failure == notFound && it.failure.words == NOT_FOUND },
                    "400-bad-input" to {
                        it.preview == null && it.failure == Joining.Failure.NoClass(SendResult.Status(400), null) && it.failure.words == GENERIC
                    },
                    "401-unauthorized" to {
                        it.preview == null && it.failure == Joining.Failure.NoClass(SendResult.Status(401), null) && it.failure.words == SIGN_IN
                    },
                )
            for ((name, holds) in cases) {
                val joining = Joining().type("6BVZA5")
                val looked = joining.looked(fixture("join-codes/$name.json").previewJoinCode("6BVZA5"), "6BVZA5")
                assertTrue(holds(looked), "$name: $looked")
            }
            // No answer, no token to send, an answer that doesn't decode.
            val others =
                listOf(
                    Triple(client(Canned(null)), unreachable, UNREACHABLE), Triple(client(Canned(200), NoToken), unreachable, UNREACHABLE),
                    Triple(client(Canned(200, "{}")), Joining.Failure.NoClass(SendResult.Status(200), null), GENERIC),
                )
            for ((other, failure, words) in others) {
                val looked = Joining().type("6BVZA5").looked(other.previewJoinCode("6BVZA5"), "6BVZA5")
                assertEquals(listOf(null, failure, words), listOf(looked.preview, looked.failure, looked.failure?.words))
            }
        }

    @Test
    fun whileALookUpOrAJoinIsUnderWayTheCodeCantChangeNorThePreviewBeLeftTheAnswerIsForTheCodeAsSentOnceItIsOverBothAgain(): Unit =
        runBlocking {
            // The answer is never dropped with nothing said (#106's review).
            val busy = previewing().copy(busy = true).type("ZZZZZZ").back()
            assertEquals("6BVZA5", busy.code)
            assertNotNull(busy.preview)
            val sending = busy.copy(busy = false).back().copy(busy = true).type("ZZZZZZ")
            val answer = fixture("join-codes/found.json").previewJoinCode("6BVZA5")
            val looked = sending.copy(busy = false).looked(answer, "6BVZA5")
            assertEquals(listOf<Any?>("6BVZA5", null), listOf(looked.code, looked.failure))
            assertNotNull(looked.preview)
            assertEquals("ZZZZZZ", looked.type("ZZZZZZ").code)
        }

    @Test
    fun anAnswerForACodeTheStudentHasTypedOverSinceIsDroppedItsClassIsntTheOneTheyWouldJoin(): Unit =
        runBlocking {
            val answer = fixture("join-codes/found.json").previewJoinCode("6BVZA5")
            val looked = Joining().type("6BVZA5").type("6BVZA").looked(answer, "6BVZA5")
            assertEquals(Joining(code = "6BVZA"), looked)
        }

    @Test
    fun theJoinAsTheApiAnswersItJoinedOrInTheClassAlreadyIsInAndTheScreenStartsOverACodeThatOpensNoClassAnyMoreGoesBackToTheCodeAnythingElseStaysOnThePreview(): Unit =
        runBlocking {
            for (name in listOf("joined", "already-enrolled")) {
                assertEquals(Joining() to true, previewing().joined(fixture("enrollments/$name.json").join(request)), name)
            }
            val (gone, goneIn) = previewing().joined(fixture("enrollments/404-class-not-found.json").join(request))
            assertFalse(goneIn)
            assertEquals(Joining(code = "6BVZA5", failure = notFound), gone)
            assertEquals(NOT_FOUND, gone.failure?.words)
            val (offline, offlineIn) = previewing().joined(client(Canned(null)).join(request))
            assertFalse(offlineIn)
            assertNotNull(offline.preview)
            assertEquals(unreachable, offline.failure)
            assertEquals(UNREACHABLE, offline.failure?.words)
            assertEquals(Joining(code = "6BVZA5"), offline.back())
        }

    @Test
    fun aScreensOwnCallWhoseTokenTheApiRefusedIsSentOnceMoreWhenItsRenewalGivesAFreshOneOnceOnlyNoneOrOneThatThrowsLeavesThe401AnyOtherAnswerRenewsNothing(): Unit =
        runBlocking {
            val (refused, found) = client(Canned(401)) to fixture("join-codes/found.json")

            /** [Joining.send] over [answers] in turn, the last again once they run out, renewed by [fresh]: the answer, how many sends, how many renewals. */
            suspend fun run(answers: List<ApiClient>, fresh: suspend () -> Boolean): Triple<ApiResponse<JoinCodePreviewResponse>, Int, Int> {
                var (sends, renewals) = 0 to 0
                val answer =
                    Joining.send({
                        renewals += 1
                        fresh()
                    }) {
                        sends += 1
                        answers[minOf(sends, answers.size) - 1].previewJoinCode("6BVZA5")
                    }
                return Triple(answer, sends, renewals)
            }
            val renewed = run(listOf(refused, found)) { true }
            assertEquals(listOf<Any?>("Class fx-enroll", 2, 1), listOf(renewed.first.answer?.schoolClass?.name, renewed.second, renewed.third))
            val again = run(listOf(refused)) { true }
            assertEquals(listOf<Any>(SendResult.Status(401), 2, 1), listOf(again.first.result, again.second, again.third))
            val none = run(listOf(refused, found)) { false }
            assertEquals(listOf<Any>(SendResult.Status(401), 1, 1), listOf(none.first.result, none.second, none.third))
            val refusedToken = Joining().type("6BVZA5").looked(none.first, "6BVZA5").failure
            assertEquals(listOf<Any?>(Joining.Failure.NoClass(SendResult.Status(401), null), SIGN_IN), listOf(refusedToken, refusedToken?.words))
            for (others in listOf(listOf(found), listOf(client(Canned(404))), listOf(client(Canned(null))), listOf(client(Canned(500))))) {
                val other = run(others) { true }
                assertEquals(listOf(1, 0), listOf(other.second, other.third), "${other.first.result}")
            }
            // No iOS twin: a renewal that throws, or ends in a cancel of its own, renewed nothing, and ends nothing.
            val broken = listOf<suspend () -> Boolean>({ error("broken") }, { throw CancellationException("its own") }, { withTimeout(1) { awaitCancellation() } })
            for (renewal in broken) {
                val failed = run(listOf(refused, found), renewal)
                assertEquals(listOf<Any>(SendResult.Status(401), 1, 1), listOf(failed.first.result, failed.second, failed.third))
            }
            // Its caller's own cancel still ends it, sending nothing more and answering nothing: one swallowed would return
            // the 401 to the caller as if the renewal had given none.
            val renewing = CompletableDeferred<Unit>()
            var sends = 0
            var answered = false
            val caller =
                launch {
                    Joining.send({
                        renewing.complete(Unit)
                        awaitCancellation()
                    }) {
                        sends += 1
                        refused.previewJoinCode("6BVZA5")
                    }
                    answered = true
                }
            withTimeout(patience) { renewing.await() }
            caller.cancelAndJoin()
            assertEquals(listOf<Any>(1, false), listOf(sends, answered))
        }

    @Test
    fun everyRefusalInWordsKeyedOnItsStatusAndReasonNeverItsMessageATeachersAccountTooManyTriesAndAnythingElseTheWayOn() {
        assertEquals("This is a teacher's account, and only students can join a class.", Joining.words(SendResult.Status(403), null))
        assertEquals("Too many tries for now. Wait a minute, then try again.", Joining.words(SendResult.Status(429), null))
        assertEquals(NOT_FOUND, Joining.words(SendResult.Status(404), ApiErrorReason.ClassNotFound))
        for ((status, reason) in listOf(404 to null, 409 to ApiErrorReason.EventIdConflict, 500 to null, 503 to null)) {
            assertEquals(GENERIC, Joining.words(SendResult.Status(status), reason), "$status")
        }
        // A failure is said by its answer's words, the same keys.
        assertEquals(NOT_FOUND, notFound.words)
        assertEquals(UNREACHABLE, unreachable.words)
        // No twin in BaliOutbox's tests (iOS's AppTests check it): a press with no engine started, iOS's `Joining.notStarted`.
        assertEquals("Bali is still starting. Try again in a moment.", Joining.Failure.NotStarted.words)
    }
}

private val joinRoute = "POST /v1/enrollments"
private val lookUpRoute = "GET /v1/join-codes/6BVZA5"

/** Joining through the engine, the class at once (C3): BaliOutbox's JoinEngineTests. */
class JoinEngineTest : EngineFiles() {
    @Test
    fun aJoinAnsweredInIsTheEnginesAtOnceTheClassInMeTheTruthReadAgainWhichNamesItsTeacherAClassAlreadyThereNeverAddedTwiceOnlyReadsCountAsReads(): Unit =
        runBlocking {
            // So `hasClasses` is true and the router moves on; never the join a read (`meReads`, L8c).
            val rig = rig()
            rig.screenOn(Answer.me(null))
            assertEquals(listOf<Any?>(false, 1), listOf(rig.engine.updates.value.hasClasses, rig.engine.updates.value.meReads))
            val answer = async { rig.engine.join(request) }
            rig.server.next(joinRoute).reply(200, Answer.joinedClass("c"))
            assertEquals("c", answer.await().answer?.schoolClass?.id)
            var state = rig.engine.updates.value
            assertEquals(listOf<Any?>(true, listOf("c"), null, 1), listOf(state.hasClasses, state.me?.classes?.map(MeClass::id), state.me?.classes?.first()?.teacher, state.meReads))
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"))))
            state = rig.until { it.me?.classes?.firstOrNull()?.teacher != null }
            assertEquals(listOf<Any?>(listOf("c"), 2), listOf(state.me?.classes?.map(MeClass::id), state.meReads))
            val again = async { rig.engine.join(request) }
            rig.server.next(joinRoute).reply(200, Answer.joinedClass("c", outcome = "already_enrolled"))
            again.await()
            assertEquals(1, rig.engine.updates.value.me?.classes?.size)
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"))))
            rig.stop()
        }

    @Test
    fun aReadOfTheTruthSentBeforeTheJoinAndAnsweredAfterItNeverTakesTheClassAwayItCountsAsNoReadTheReadTheJoinAsksForThenApplies(): Unit =
        runBlocking {
            // Its classes are older than the join (`meChanges`, taken as the read is sent and compared as its answer applies).
            val rig = rig()
            rig.screenOn(Answer.me(null))
            rig.engine.setInFront(true)
            val before = rig.server.next(meRoute)
            val answer = async { rig.engine.join(request) }
            rig.server.next(joinRoute).reply(200, Answer.joinedClass("c"))
            answer.await()
            before.reply(200, Answer.me(null))
            // Sent once the stale answer is in: it has taken nothing away.
            val after = rig.server.next(meRoute)
            assertEquals(listOf<Any?>(listOf("c"), 1), listOf(rig.engine.updates.value.me?.classes?.map(MeClass::id), rig.engine.updates.value.meReads))
            after.reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"), Answer.inClass("d"))))
            val state = rig.until { it.me?.classes?.size == 2 }
            assertEquals(listOf<Any?>(true, 2), listOf(state.hasClasses, state.meReads))
            rig.stop()
        }

    @Test
    fun aJoinAnsweredAfterAnotherStudentsSignInMadeTheEngineForgetTheLastOnesMeAddsItsClassToNoOnesTheReadItAsksForSaysWhereTheyStand(): Unit =
        runBlocking {
            // Never to the next student's, read meanwhile (F11a-1, santa's round 1).
            val rig = rig()
            rig.screenOn(Answer.me(null))
            val answer = async { rig.engine.join(request) }
            val join = rig.server.next(joinRoute)
            rig.engine.forgetMe()
            // The next student's own, read before the last one's join answers.
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("d"))))
            rig.until { it.me?.classes?.map(MeClass::id) == listOf("d") }
            join.reply(200, Answer.joinedClass("c"))
            assertEquals("c", answer.await().answer?.schoolClass?.id)
            assertEquals(listOf("d"), rig.engine.updates.value.me?.classes?.map(MeClass::id))
            rig.stop()
        }

    @Test
    fun aJoinRefusedAddsNoClassAndReadsNothingWhyIsTheScreensToSay(): Unit =
        runBlocking {
            val rig = rig()
            rig.screenOn(Answer.me(null))
            val answer = async { rig.engine.join(request) }
            rig.server.next(joinRoute).reply(404, Answer.refused("class_not_found"))
            assertEquals(ApiErrorReason.ClassNotFound, answer.await().error?.error?.reason)
            assertEquals(false, rig.engine.updates.value.hasClasses)
            // A read asked for would have gone by the loop's next wake, and kept it from sleeping on.
            rig.clock.advance(30)
            rig.sleeping(at(60))
            assertEquals(emptyList(), rig.server.waiting)
            rig.stop()
        }

    @Test
    fun aLookUpGoesThroughTheEnginesOneClientItsTokenRenewedOnceOnA401ByTheEnginesOwnRefresh(): Unit =
        runBlocking {
            val rig = rig()
            val answer = async { rig.engine.lookUp("6BVZA5") }
            rig.server.next(lookUpRoute).reply(401)
            val again = rig.server.next(lookUpRoute)
            assertEquals("Bearer token-2", again.token)
            again.reply(200, """{"class":{"id":"c","name":"Class c"},"teacher":{"displayName":"Ms. Rivera"},"alreadyEnrolled":false}""")
            assertEquals("Ms. Rivera", answer.await().answer?.teacher?.displayName)
            assertEquals(1, rig.tokens.refreshes)
            rig.stop()
        }

    @Test
    fun aJoinWhoseCallerIsCancelledStillPutsItsClassInMeForTheServerJoinedItItsAnswerAppliedInTheEnginesScopeAndTheTruthReadAgain(): Unit =
        runBlocking {
            // No iOS twin (AN9's split): a screen gone never loses a class the server joined. In no class, the read loop reads
            // nothing at its wakes that would bring it, and Join would show again.
            val rig = rig()
            rig.screenOn(Answer.me(null))
            val caller = launch { rig.engine.join(request) }
            val join = rig.server.next(joinRoute)
            caller.cancelAndJoin()
            join.reply(200, Answer.joinedClass("c"))
            val state = rig.until { it.hasClasses == true }
            assertEquals(listOf("c"), state.me?.classes?.map(MeClass::id))
            assertTrue(caller.isCancelled)
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"))))
            rig.until { it.meReads == 2 }
            rig.stop()
        }
}
