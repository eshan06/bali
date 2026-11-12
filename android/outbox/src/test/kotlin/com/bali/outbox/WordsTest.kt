package com.bali.outbox

import com.bali.core.AnswerResult
import com.bali.core.ApiErrorReason
import com.bali.core.BaliJson
import com.bali.core.BlockRead
import com.bali.core.HistoryEventType
import com.bali.core.HostedPage
import com.bali.core.MeClass
import com.bali.core.MeResponse
import com.bali.core.NoAnswer
import com.bali.core.ParticipationState
import com.bali.core.PollProblem
import com.bali.core.SendResult
import com.bali.core.SignInError
import com.bali.core.StudentAnswer
import com.bali.core.StudentQuestion
import com.bali.core.UnlockReason
import java.io.IOException
import java.time.LocalDate
import kotlin.reflect.KClass
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.awaitCancellation

// The guard over every Android word (AN10d's, each later step adding its own to `everyWord`): none names what Android
// lacks (Screen Time, iOS, an iPhone, FaceTime, Emergency SOS: DESIGN.md's Android section, the canvas's Words board) nor holds
// an em-dash or an exclamation mark (DESIGN.md, section 7). It reads each word function for every case of the types it keys on,
// never a list of the words themselves: a case added later with no word stops its function's `when` compiling, and one given
// a word but no sample here fails `each` by name.

/**
 * [cases], at least one of each case the sealed [type] declares, checked against them: a case added later and given no sample
 * here fails by name, so its word is read too (and, in LessonsTest, its slide's phase).
 */
internal fun <T : Any> each(type: KClass<T>, vararg cases: T): List<T> {
    val declared = type.java.declaredClasses.filter { type.java.isAssignableFrom(it) }.map { it.name }.toSortedSet()
    assertEquals(declared, cases.map { it.javaClass.name }.toSortedSet(), "${type.java.simpleName}'s cases, each with a sample")
    return cases.toList()
}

/** `GET /v1/me`'s answer [json], as the phone decodes it. */
private fun me(json: String): MeResponse = BaliJson.decodeFromString(MeResponse.serializer(), json)

/**
 * Every word the app says, by the function that says it, each read for every case of the types it keys on: AN10d's, Join's,
 * Home's, a scan's, Tap in's, the sign-in's and the start's; AN10e's, Focus's, Emergency Unlock's failures and the block
 * screen's; AN10f's, Unlocked's, a reason's and Back to focus's failures, Protection off's, Session over's and Home's card for a
 * class in session; AN10g's, Me's name, Leave and Sign out, whose sign-in it is, Delete account and the 13+ stop; AN10h's,
 * History's and the consent list; AN13c's, the live lesson's heading and the answer card's line; AN13e's, the slide's two.
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
    // Focus where the phone may stand, with a tap held or none, a late unlock of its session or none, every link and sign-in, and
    // each claim the check can make, the switch off with its report kept or not; each claim reached, so each one's words are read.
    val synced =
        standings.flatMap { standing ->
            classes.flatMap { me ->
                listOf(emptyList(), listOf(queued(Change.Tap("tag")))).flatMap { queue ->
                    listOf(null, Superseded("s", ordered = true), Superseded("s", ordered = false)).flatMap { late ->
                        (Link.entries + null).map { SyncState(standing = standing, queued = queue, link = it, superseded = late, me = me) }
                    }
                }
            }
        }
    val protections =
        listOf(null, Protection(), Protection(checked = true, switch = LockSwitch.On, locked = true)) +
            listOf(false, true).map { Protection(checked = true, switch = LockSwitch.Off, switchedOff = true, unreported = it) }
    val focus =
        synced.flatMap { state ->
            protections.flatMap { protection -> listOf(null, false, true).map { FocusWords(state, protection, t0, newYorkZone, usShortTime, it) } }
        }
    assertEquals(FocusWords.Claim.entries.toSet(), focus.map { it.claim }.toSet(), "FocusWords.Claim's cases, each reached")
    // Unlocked, Protection off and Session over where the phone may stand, with the classes as above: an unlock of its class on
    // the phone, stuck or none, one under a tap, protection off on its way, a refused tap; one recorded there or none; protection
    // off reported there or not; a Back to focus refused after protection off, for anything else, or none; and the classes' read
    // failing or not. Under every claim the check can make, each picker, way and kind of Home's card reached.
    val unlock = queued(Change.Unlock("s", UnlockReason.Nurse))
    val queues =
        listOf(
            emptyList(), listOf(unlock), listOf(unlock.copy(attempts = 1, stuck = true)), listOf(queued(Change.UnlockUnderTap("t", null))),
            listOf(queued(Change.ProtectionOff("s"))), listOf(queued(Change.Tap("tag")).copy(stuck = true)),
        )
    val backs = listOf(null) + listOf(ApiErrorReason.ProtectionOff, ApiErrorReason.EventIdConflict).map { Refusal(Change.Refocus("s"), 409, it, null) }
    val sessions =
        standings.flatMap { standing ->
            classes.flatMap { me ->
                queues.flatMap { queue ->
                    listOf(null, RecordedUnlock("s", "u", UnlockReason.Bathroom)).flatMap { kept ->
                        listOf(null, "s").flatMap { off ->
                            backs.flatMap { back ->
                                listOf(null, SendResult.NetworkError).map {
                                    SyncState(standing = standing, queued = queue, refused = back, reportedOff = off, recordedUnlock = kept, me = me, meFailed = it)
                                }
                            }
                        }
                    }
                }
            }
        }
    val claims =
        listOf(null, Protection(), Protection(checked = true, switch = LockSwitch.On, locked = true)) +
            LockSwitch.entries.flatMap { switch ->
                listOf(false, true).flatMap { off -> listOf(false, true).map { Protection(checked = true, switch = switch, switchedOff = off, unreported = it) } }
            }
    val unlocked = sessions.mapNotNull { UnlockedWords.of(it, newYorkZone, usShortTime) }
    val pickers = each(UnlockedWords.Picker::class, *unlocked.mapNotNull { it.picker }.distinct().toTypedArray())
    val off = sessions.flatMap { state -> claims.mapNotNull { ProtectionOffWords.of(state, it, newYorkZone, usShortTime) } }
    assertEquals(ProtectionOffWords.Way.entries.toSet(), off.map { it.way }.toSet(), "ProtectionOffWords.Way's cases, each reached")
    // Out, a class of the student's in session by the last read.
    val live = me(Answer.me(null, classes = listOf("""{"id":"c","name":"Class c","teacher":null,"liveSession":{"id":"s","endsAt":"${wire(at(3000))}"}}""")))
    val cards = (sessions + standings.map { SyncState(standing = it, me = live) }).flatMap { state -> listOf(t0, at(3000)).mapNotNull { state.inSessionCard(it, newYorkZone, usShortTime) } }
    assertEquals(setOf(false, true), cards.map { it.unlocked }.toSet(), "InSessionCard's kinds, each reached")
    val changes = results.flatMap { result -> reasons.map { ReasonFailure.NotChanged(result, it) } }
    // Me's: a save's and a leave's answers, every result with every reason and none; a class's question; Sign out's holds and whose
    // sign-in it is, an email or none; and Delete account's screen at each step, every stop, every result with each reason none
    // came and none, under 13 too.
    val row = MeClass("c", "Period 3", null, "ec", null)
    val names = results.flatMap { result -> reasons.map { Naming.Failure.NotSaved(result, it) } }
    val leaves = results.flatMap { result -> reasons.map { Leaving.Failure.NotLeft(result, it) } }
    val unanswered = results.flatMap { result -> (NoAnswer.entries + null).map { Deleting.Stop.NotDeleted(result, it) } }
    val stops =
        each(
            Deleting.Stop::class, Deleting.Stop.SignInFirst, Deleting.Stop.TeacherHasClasses, Deleting.Stop.NotStarted, Deleting.Stop.UnlockUnsent,
            Deleting.Stop.Unread, *unanswered.toTypedArray(), Deleting.Stop.Unfinished, Deleting.Stop.SignInChanged,
        )
    val deletings =
        each(Deleting::class, Deleting.None, Deleting.Asking, Deleting.Busy, *stops.map { Deleting.Stopped(it) }.toTypedArray(), Deleting.Pending, Deleting.Done)
    // History's: a read's failures, every result with every reason and none, and no engine; every kind of moment with each reason
    // and none, a class counted in and none; each note; and each title, a date this year and another year's.
    val notRead = results.flatMap { result -> reasons.map { History.Failure.NotRead(result, it) } }
    val unread = each(History.Failure::class, *notRead.toTypedArray(), History.Failure.NotStarted)
    val moments =
        HistoryEventType.entries.flatMap { kind ->
            (UnlockReason.entries + null).flatMap { reason -> listOf(null, "Period 5").map { History.Moment("e", kind, t0.atZone(newYorkZone), reason, it, null) } }
        }
    val titles =
        each(History.Title::class, History.Title.Today, History.Title.Yesterday, History.Title.On(LocalDate.of(2026, 9, 16)), History.Title.On(LocalDate.of(2025, 12, 15)))
    // The live lesson's: its heading wherever the phone may stand, with the classes as above and one in session by the last read,
    // before the bell and at it, said over or not; and the answer card for every question a read can show, open or closed, its
    // answer shown or not, the student's own or none, under each poll's problem and none, a pick on its way or none, and what the
    // last pick said, every `Said` and every `AnswerResult` through `Said`, each look reached.
    val headings =
        (states + standings.map { SyncState(standing = it, me = live) }).flatMap { state ->
            listOf(t0, at(3000)).flatMap { now -> listOf(emptySet(), setOf("s")).mapNotNull { state.lessonHeading(now, it, newYorkZone, usShortTime) } }
        }
    val answers = listOf(null, StudentAnswer(1, "e1"), StudentAnswer(2, "e2"))
    val questions =
        listOf(true, false).flatMap { open ->
            listOf(null, 1).flatMap { correct -> answers.map { StudentQuestion("q", "Which value of x solves it?", listOf("1", "2", "3", "6"), open, correct, it) } }
        }
    val polls = listOf(null) + each(PollProblem::class, *NoAnswer.entries.map { PollProblem.Unreachable(it) }.toTypedArray(), PollProblem.RateLimited, PollProblem.Refused(503, null))
    val outcomes =
        each(
            AnswerResult::class, AnswerResult.Answered(StudentAnswer(2, "e2")), AnswerResult.QuestionClosed, AnswerResult.InvalidOption, AnswerResult.EventIdConflict,
            AnswerResult.AccountDeleted, *NoAnswer.entries.map { AnswerResult.Unreachable(it) }.toTypedArray(), AnswerResult.Refused(500, null),
        )
    val saids =
        (listOf(null) + each(AnswerCard.Said::class, AnswerCard.Said.TooLate, AnswerCard.Said.Failed(null), AnswerCard.Said.Failed("e1")) +
            outcomes.flatMap { outcome -> listOf(null, "e1").map { AnswerCard.Said.of(outcome, it) } }).distinct()
    val answerCards =
        questions.flatMap { question -> polls.flatMap { problem -> listOf(null, 0).flatMap { sending -> saids.map { AnswerCard(question, problem, sending, it) } } } }
    each(AnswerCard.Look::class, *answerCards.flatMap { it.looks }.distinct().toTypedArray())
    // The slide's, in each phase of its deck.
    val opened = object : Document {
        override val pages = 12

        override suspend fun awaitLost() {
            awaitCancellation()
        }

        override fun close() = Unit
    }
    val phases = each(SlideShown.Phase::class, SlideShown.Phase.Loading, SlideShown.Phase.Failed, SlideShown.Phase.Ready(opened))
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
        "FocusWords" to
            focus.flatMap { listOf(it.title, it.subtitle, it.claimWords, it.countdown?.digits, it.countdown?.until, it.offline, it.stalled, it.superseded) },
        "UnlockFailure.words" to UnlockFailure.entries.flatMap { failure -> listOf(false, true).map { failure.words(paused = it) } },
        "ShieldWords.words" to ShieldWords.entries.map { it.words },
        "UnlockedWords" to unlocked.flatMap { listOf(it.title, it.subtitle, it.body, it.picker?.caption, it.retap, it.stuck) },
        "UnlockedWords.Picker.caption" to pickers.map { it.caption },
        "ProtectionOffWords" to off.flatMap { listOf(it.title, it.subtitle, it.headline, it.body, it.refused) + it.steps + it.problems },
        "ReasonFailure.words" to
            each(ReasonFailure::class, ReasonFailure.NotStarted, ReasonFailure.NotSaved, ReasonFailure.OnItsWay, *changes.toTypedArray()).map { it.words },
        "RefocusFailure.words" to RefocusFailure.entries.map { it.words },
        "SyncState.inSessionCard" to cards.flatMap { listOf(it.words, it.retap) },
        "SyncState.refusedRefocusWords" to sessions.flatMap { state -> listOf(t0, at(3000)).map { state.refusedRefocusWords(it) } },
        "SyncState.sessionOverWords" to sessions.flatMap { state -> claims.map { state.sessionOverWords(it, newYorkZone, usShortTime) } },
        "Naming.Failure.words" to each(Naming.Failure::class, Naming.Failure.Blank, *names.toTypedArray(), Naming.Failure.NotStarted).map { it.words },
        "Leaving" to listOf(Leaving.question(row), Leaving.CONSEQUENCE, Leaving.inSession(row)),
        "Leaving.Failure.words" to each(Leaving.Failure::class, *leaves.toTypedArray(), Leaving.Failure.NotStarted).map { it.words(row) },
        "SignOutHold.words" to SignOutHold.entries.map { it.words },
        "Account.State.signedInAs" to listOf(null, "", "ana@bali.test").map { Account.State(email = it).signedInAs },
        "Deleting" to listOf(Deleting.QUESTION, Deleting.CONSEQUENCE),
        "Deleting.said" to deletings.flatMap { listOfNotNull(it.said, it.saidUnderThirteen) }.flatMap { listOf(it.title, it.body) },
        "AgeCheck's stop" to listOf(AgeCheck.NOT_YET, AgeCheck.ASK_TEACHER),
        "History.Failure.words" to unread.map { it.words },
        "History.Failure.notUpdatedWords" to unread.map { it.notUpdatedWords },
        "History.Moment.words" to moments.map { it.words },
        "History.Moment.time" to moments.map { it.time(usShortTime) },
        "History.Note.words" to History.Note.entries.map { it.words },
        "History.Title.words" to titles.map { it.words(t0, newYorkZone, usDate, usDateWithYear) },
        "ConsentList" to listOf(ConsentList.WHOLE, ConsentList.ADDED).flatMap { it.sees + it.neverSees },
        "SyncState.lessonHeading" to headings.flatMap { listOf(it.first, it.second) },
        "AnswerCard.line" to answerCards.map { it.line },
        "SlideShown.Phase.words" to phases.map { it.words },
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
