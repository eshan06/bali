package com.bali.outbox

import androidx.sqlite.SQLiteException
import com.bali.core.ApiErrorReason
import com.bali.core.EventId
import com.bali.core.MeClass
import com.bali.core.ParticipationState
import com.bali.core.UpdateMeRequest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

// The name and the sign-in through the engine (C6b): BaliOutbox's MeEngineTests, and new: Sign out's rule reading the file
// itself, and a file that can't be read now; a forget that leaves where the phone stands and its queue as they are, an
// Emergency Unlock among them; a rename whose caller is cancelled, and one answered after the next student's `me` was
// read. Me's own rules (`Naming`) are AN9f's.

private val renameRoute = "PATCH /v1/me"
private val request = UpdateMeRequest("Eve Park", EventId.mint(t0))

/** `PATCH /v1/me`'s answer: the student named [name] now. */
private fun named(name: String) = """{"outcome":"applied","user":{"id":"u","role":"student","displayName":"$name"}}"""

/** `GET /v1/me`'s answer: the student named [name], in [classes], each as [Answer.inClass] writes one, in no session. */
private fun meNamed(name: String, classes: List<String> = emptyList()) =
    """{"user":{"id":"u","role":"student","displayName":"$name"},"classes":[${classes.joinToString(",")}],"session":null}"""

/** The outbox's read of everything queued, as Room's DAO prepares it. */
private const val RECORDS = "ORDER BY COALESCE(orderSeq, seq), seq"

/** The name and the sign-in through the engine (C6b): BaliOutbox's MeEngineTests. */
class MeEngineTest : EngineFiles() {
    @Test
    fun aNameSetIsTheEnginesAtOnceMesUserItsClassesKeptAndTheTruthReadAgainOneRefusedChangesNothingAndReadsNothingA401RenewsTheTokenOnce(): Unit =
        runBlocking {
            // So Home and Me show it; read again as after a join (santa's round 1).
            val rig = rig()
            rig.screenOn(Answer.me(null))
            val refused = async { rig.engine.rename(request) }
            rig.server.next(renameRoute).reply(409, Answer.refused("display_name_taken"))
            assertEquals(ApiErrorReason.DisplayNameTaken, refused.await().error?.error?.reason)
            assertNull(rig.engine.updates.value.me?.user?.displayName)
            // No read asked for: in no class, the loop's next wake reads nothing but one asked for, and sleeps on (iOS's waits
            // for its sleep alone, where a ring could come after).
            rig.clock.advance(30)
            rig.sleeping(at(60))
            assertEquals(emptyList(), rig.server.waiting)
            rig.engine.setInFront(true)
            rig.server.next(meRoute).reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"))))
            rig.until { it.hasClasses == true }
            val answer = async { rig.engine.rename(request) }
            rig.server.next(renameRoute).reply(401)
            val again = rig.server.next(renameRoute)
            assertEquals(listOf("Bearer token-2", request.eventId), listOf(again.token, again.eventId))
            again.reply(200, named("Eve Park"))
            assertEquals("Eve Park", answer.await().answer?.user?.displayName)
            val me = rig.engine.updates.value.me
            assertEquals(listOf<Any?>("Eve Park", listOf("c")), listOf(me?.user?.displayName, me?.classes?.map(MeClass::id)))
            rig.server.next(meRoute).reply(200, meNamed("Eve Park", listOf(Answer.inClass("c"), Answer.inClass("d"))))
            val read = rig.until { it.me?.classes?.size == 2 }
            assertEquals("Eve Park", read.me?.user?.displayName)
            rig.stop()
        }

    @Test
    fun signOutsRuleAsksTheOutboxFileWhetherAnEmergencyUnlockWaitsUnsentNoneThenOnePressedAndQueuedThenNoneOnceTheServerHasRecordedIt(): Unit =
        runBlocking {
            val rig = rig()
            assertEquals(false, rig.engine.unlockUnsent())
            rig.tapIn()
            assertEquals(false, rig.engine.unlockUnsent())
            rig.engine.emergencyUnlock()
            assertEquals(true, rig.engine.unlockUnsent())
            rig.server.next(unlockRoute).reply(200, Answer.unlocked())
            rig.until { it.queued.isEmpty() }
            assertEquals(false, rig.engine.unlockUnsent())
            rig.stop()
        }

    @Test
    fun signOutsRuleReadsTheFileItselfAnUnlockAFailedReadLeftOutOfTheEnginesQueueCountsAndAFileThatCantBeReadNowGivesNone(): Unit =
        runBlocking {
            // No iOS twin (its santa's round 1, through the engine): the engine starts from a file whose queue it couldn't read.
            val file = temporaryFile()
            record(open(file), Change.Unlock("s", null))
            val refusing = AtomicBoolean(true)
            val engine = engine(open(file, driver = Watching(stepping = { if (refusing.get() && RECORDS in it) throw SQLiteException("refused") })))
            assertEquals(listOf<Any?>(emptyList<OutboxRecord>(), Link.StorageFailed), listOf(engine.updates.value.queued, engine.updates.value.link))
            assertNull(engine.unlockUnsent())
            refusing.set(false)
            assertEquals(true, engine.unlockUnsent())
            assertEquals(emptyList(), engine.updates.value.queued)
        }

    @Test
    fun aReadOfTheTruthSentBeforeTheNameWasSetAndAnsweredAfterItNeverTakesTheNameBackItIsOlderTheNextReadThenApplies(): Unit =
        runBlocking {
            val rig = rig()
            rig.screenOn(Answer.me(null))
            rig.engine.setInFront(true)
            val before = rig.server.next(meRoute)
            val answer = async { rig.engine.rename(request) }
            rig.server.next(renameRoute).reply(200, named("Eve Park"))
            answer.await()
            before.reply(200, Answer.me(null))
            rig.engine.setInFront(true)
            // Sent once the stale answer is in: it has taken nothing back.
            val after = rig.server.next(meRoute)
            assertEquals("Eve Park", rig.engine.updates.value.me?.user?.displayName)
            after.reply(200, meNamed("Eve P."))
            rig.until { it.me?.user?.displayName == "Eve P." }
            rig.stop()
        }

    @Test
    fun someoneSigningInWhereSomeoneSignedOutForgetsTheLastStudentsMeAtOnceAReadOnItsWayWithItAndReadsItAgainANameTheyGaveAfterIsntKeptEachForgetCounted(): Unit =
        runBlocking {
            // Every state after a forget carries its count, so the app knows one sent before it (#160's review).
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = listOf(Answer.inClass("c"))))
            assertEquals(0, rig.engine.updates.value.forgets)
            val answer = async { rig.engine.rename(request) }
            val rename = rig.server.next(renameRoute)
            rig.engine.setInFront(true)
            val before = rig.server.next(meRoute)
            rig.engine.forgetMe()
            var state = rig.engine.updates.value
            assertEquals(listOf<Any?>(null, null, 1), listOf(state.me, state.hasClasses, state.forgets))
            rename.reply(200, named("Eve Park"))
            answer.await()
            before.reply(200, Answer.me(null, classes = listOf(Answer.inClass("c"))))
            // Sent once the answer on its way is in: it has brought nothing back.
            val after = rig.server.next(meRoute)
            assertNull(rig.engine.updates.value.me)
            after.reply(200, Answer.me(null, classes = listOf(Answer.inClass("d"))))
            state = rig.until { it.me != null }
            assertEquals(listOf<Any?>(listOf("d"), null, 1), listOf(state.me?.classes?.map(MeClass::id), state.me?.user?.displayName, state.forgets))
            rig.engine.forgetMe()
            assertEquals(2, rig.engine.updates.value.forgets)
            rig.stop()
        }

    @Test
    fun aNameSetAnsweredAfterAnotherStudentsSignInMadeTheEngineForgetTheLastOnesMeNamesNoOneTheNextStudentsReadMeanwhileKeepsTheirOwnName(): Unit =
        runBlocking {
            // No iOS twin: iOS's forget test answers the rename while `me` is still forgotten, where no guard is needed. Here the
            // next student's own `me` is read first, as a join's and a leave's tests read it (F11a-1).
            val rig = rig()
            rig.screenOn(Answer.me(null, classes = listOf(Answer.inClass("c"))))
            val answer = async { rig.engine.rename(request) }
            val rename = rig.server.next(renameRoute)
            rig.engine.forgetMe()
            rig.server.next(meRoute).reply(200, meNamed("Bea", listOf(Answer.inClass("d"))))
            rig.until { it.me?.user?.displayName == "Bea" }
            rename.reply(200, named("Eve Park"))
            assertEquals("Eve Park", answer.await().answer?.user?.displayName)
            assertEquals(listOf<Any?>("Bea", listOf("d")), listOf(rig.engine.updates.value.me?.user?.displayName, rig.engine.updates.value.me?.classes?.map(MeClass::id)))
            rig.server.next(meRoute).reply(200, meNamed("Bea", listOf(Answer.inClass("d"))))
            rig.stop()
        }

    @Test
    fun aForgetLeavesWhereThePhoneStandsAndItsQueueAsTheyAreAnEmergencyUnlockQueuedStaysAndGoesWithTheRecordAheadOfIt(): Unit =
        runBlocking {
            // No iOS twin: B4's rule, that only `me` is the last student's, and the outbox's file never emptied (the unlock contract).
            val rig = rig()
            rig.tapIn()
            val off = assertNotNull(rig.engine.record(Change.ProtectionOff("s")))
            rig.server.next(protectionOffRoute).reply(null)
            rig.until { it.retryAt == at(2) }
            val unlock = assertNotNull(rig.engine.emergencyUnlock())
            val stood = rig.until { it.queued.size == 2 }.standing
            assertEquals(Standing.InSession(session(), ParticipationState.Unlocked), stood)
            rig.engine.forgetMe()
            // The read it asks for: the server's truth, which the records still on their way stand over.
            rig.server.next(meRoute).reply(200, Answer.me())
            rig.until { it.me != null }
            assertEquals(listOf<Any?>(stood, listOf(off.eventId, unlock.eventId)), listOf(rig.engine.updates.value.standing, rig.engine.updates.value.queued.map { it.eventId }))
            assertEquals(listOf(off.eventId, unlock.eventId), rig.outbox.records().map { it.eventId })
            rig.clock.advance(2)
            rig.server.next(protectionOffRoute).reply(200, Answer.protectionOff())
            val sent = rig.server.next(unlockRoute)
            assertEquals(unlock.eventId, sent.eventId)
            sent.reply(200, Answer.unlockUnderOff())
            rig.until { it.queued.isEmpty() }
            rig.stop()
        }

    @Test
    fun aRenameWhoseCallerIsCancelledStillSetsItsNameInMeForTheServerSetItAndTheTruthIsReadAgain(): Unit =
        runBlocking {
            // No iOS twin: as a join's (JoinEngineTest), its answer is applied in the engine's scope however its caller ends.
            val rig = rig()
            rig.screenOn(Answer.me(null))
            val caller = launch { rig.engine.rename(request) }
            val rename = rig.server.next(renameRoute)
            caller.cancelAndJoin()
            rename.reply(200, named("Eve Park"))
            rig.until { it.me?.user?.displayName == "Eve Park" }
            assertTrue(caller.isCancelled)
            rig.server.next(meRoute).reply(200, meNamed("Eve Park"))
            rig.until { it.meReads == 2 }
            rig.stop()
        }
}
