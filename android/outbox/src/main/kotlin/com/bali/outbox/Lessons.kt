package com.bali.outbox

import com.bali.core.ApiClient
import com.bali.core.DeckResult
import com.bali.core.LessonState
import com.bali.core.LiveLesson
import com.bali.core.PollProblem
import com.bali.core.Slide
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.toJavaDuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// The phone's lesson half (L8 and M8; ARCHITECTURE, "Live lesson", decisions 1, 2, 5, 8 and 11), BaliApp.swift's `Phone`'s: which
// lesson it follows and when, its poll only while Bali's screen is in front, the student's answer and Hide, the card the screens
// draw, and the slide's deck as a screen asks for it (AN13e). Its words are Lesson.kt's (AN13c) and Slide.kt's, the card and the
// slide on screen AS8's, the page drawn AN13f's, and its wiring in the app AN13g's.

/**
 * The phone's lesson half (AN13d and AN13e), BaliApp.swift's `Phone`'s: one a run, beside the account, following the lesson the
 * account's state names ([accounts], [run]) through the lesson's own [client], by the phone's [clock]. What the screens read is
 * [state]; a tap goes through [answer] and [hide], a slide's deck through [ask], Bali's screen in front or behind through
 * [setInFront], and Emergency Unlock's press through [setUnlockHeld]. Swift's main actor is a lock no stretch takes twice
 * ([alone]), never held across a call; an answer runs in the lesson half's own scope ([call]), and so does a deck's fetch, so a
 * screen leaving never cuts either short. Nothing is stored: the lesson, its card, its picks and its deck live in memory alone,
 * and go with who is signed in.
 */
class Lessons(
    /** The account's state, now and at each change ([Account.state]): who is signed in, the consent list's note, the engine's. */
    private val accounts: Flow<Account.State>,
    /**
     * The lesson's own client: the API's over a transport of its own (`OkHttpTransport.apart`), never the engine's, so no poll or
     * answer of the lesson ever waits in a queue ahead of an Emergency Unlock's send (decision 5).
     */
    private val client: ApiClient,
    /** The app's deck renderer (AN13f): opens the slide's deck into its document, one open at a time. */
    private val renderer: Renderer,
    scope: CoroutineScope,
    private val clock: SyncClock = SystemClock,
    /** The moments the clock may have moved further than a sleep counts (the router's looks): the lesson looked at again. */
    private val looks: Flow<Unit> = emptyFlow(),
) {
    /** What the screens read: a value, made anew at each change. */
    class State internal constructor(
        /** The lesson followed: what its last read showed, and why the last poll brought nothing; none while none is followed. */
        val lesson: LessonState?,
        /**
         * The answer card to show (L8): the lesson's question, the open one or the last closed one until another opens, unless this
         * phone hid it; none with none, and once the lesson is no longer the one to follow by the phone's clock (L8c).
         */
        val card: AnswerCard?,
        /**
         * The slide to show (M8): the page the lesson's last read names, with its deck as this phone has it, loading until a screen
         * asks for it ([Lessons.ask]) and while on its way; none when the teacher shows none, and once the lesson is no longer the
         * one to follow by the phone's clock, as the card.
         */
        val slide: SlideShown?,
        private val sync: SyncState?,
        private val over: Set<String>,
        private val at: Instant,
    ) {
        /**
         * The class the lesson comes from, headed as a session's screens head theirs ([lessonHeading]), its bell in [time] at [zone]
         * as the phone writes it: the line over the card and the slide on the permission step (AS3-Lesson). None with no lesson the
         * one to follow.
         */
        fun heading(zone: ZoneId, time: DateTimeFormatter): Pair<String, String>? = sync?.lessonHeading(at, over, zone, time)
    }

    /** The lesson followed, its watch of the lesson's reads, and its poll while Bali's screen is in front. */
    private class Following(val live: LiveLesson, val watch: Job, var poll: Job?)

    /** A pick sent: its count, its question, the answer Bali held as it was made, and the lesson it goes through. */
    private class Pick(val count: Int, val question: String, val held: String?, val live: LiveLesson)

    /** A slide's deck as this phone has it: its SHA-256, where it stands, and its fetch, then its open. iOS's `SlideDeck`. */
    private class SlideDeck(val sha256: String, var phase: SlideShown.Phase, val fetch: Job)

    private val scope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val mutex = Mutex()
    private val published = MutableStateFlow(State(null, null, null, null, emptySet(), clock.now()))

    /** What the screens read, now and at each change: the newest only. */
    val state: StateFlow<State> = published.asStateFlow()

    /** The account's state as last followed: none until the first. */
    private var account: Account.State? = null
    private var front = false
    private var following: Following? = null
    private var lesson: LessonState? = null

    /** The card's own, on this phone alone: the pick on its way, what the last one said, and Hide; let go once another question shows. */
    private var sending: Int? = null
    private var said: AnswerCard.Said? = null
    private var hidden = false

    /** The picks counted, so a pick's answer is said only while it is the latest on the same question. */
    private var picks = 0

    /** Whether Emergency Unlock's press is under way: the card ignores taps meanwhile (the owner's ruling, 2026-10-23). */
    private var unlockHeld = false

    /**
     * The deck of the slide the lesson shows (M8), as a screen asks for it ([ask]): one at a time, in memory alone, let go once the
     * lesson shows another deck or none, and with the lesson; and the asks counted, so only the latest one's answer is kept.
     */
    private var deck: SlideDeck? = null
    private var asks = 0

    /**
     * The sessions a read said are over, never followed again this run; and those a poll was refused (`403`, `404`), each by the
     * reads of `GET /v1/me` taken then ([SyncState.meReads]), followed again once a later read lists them (L8c).
     */
    private val over = mutableSetOf<String>()
    private val refused = mutableMapOf<String, Int>()

    /** The lesson's bell, slept towards ([Screen.bell]), where the lesson is followed afresh (Q7): none with no lesson followed. */
    private var bell: Job? = null
    private var ringsAt: Instant? = null

    /** Follows the account's state as it changes ([followed]), and looks again at each of [looks], until cancelled; the lesson goes as it ends. */
    suspend fun run() {
        try {
            coroutineScope {
                launch { looks.collect { alone(::follow) } }
                accounts.collect { followed(it) }
            }
        } finally {
            alone {
                drop()
                ring(null)
                publish()
            }
        }
    }

    /**
     * The account's [state], as BaliApp.swift's `signed` and `synced` take it for the lesson: a change of who is signed in drops the
     * lesson, its card and its picks with it (#331); then the lesson [state] names is followed.
     */
    internal suspend fun followed(state: Account.State) =
        alone {
            if (state.signIns != account?.signIns) drop()
            account = state
            follow()
        }

    /** Bali's screen in front or behind: the poll runs only in front (the owner's ruling, #330), and again as Bali comes back. */
    suspend fun setInFront(front: Boolean) =
        alone {
            this.front = front
            following?.let {
                it.poll?.cancel()
                it.poll = if (front) poll(it.live) else null
            }
        }

    /** Emergency Unlock's press under way, its one second's hold running, or let go: the card ignores taps meanwhile. */
    suspend fun setUnlockHeld(held: Boolean) = alone { unlockHeld = held }

    /**
     * A tap on answer [option] (L8): sent at once in one request of the lesson's, never through the outbox (decision 5), shown on
     * its way, then what it said: of picks whose answers cross, the last one's. The answer Bali holds sends nothing again, unless the
     * last pick didn't send. None on a closed card, nor while Emergency Unlock is held. BaliApp.swift's `answer`.
     */
    suspend fun answer(option: Int): Unit =
        call {
            val pick =
                alone {
                    val question = card(clock.now())?.takeIf { it.open && !unlockHeld }?.question ?: return@alone null
                    val live = following?.live ?: return@alone null
                    if (option == question.answer?.option && sending == null && said == null) return@alone null
                    picks += 1
                    sending = option
                    said = null
                    publish()
                    Pick(picks, question.id, question.answer?.eventId, live)
                } ?: return@call
            val result = pick.live.answer(pick.question, option)
            alone {
                // The lesson as its answer left it, taken first, as iOS's main actor runs the lesson's read ahead of the tap's
                // end: the card never shows, for a moment, the answer held before this one.
                read(pick.live.state.value, pick.live)
                if (pick.count != picks) return@alone
                sending = null
                said = AnswerCard.Said.of(result, pick.held)
                publish()
            }
        }

    /** Hide, on a closed question: kept by this phone alone, until another question shows. None while Emergency Unlock is held. */
    suspend fun hide() =
        alone {
            if (unlockHeld) return@alone
            hidden = true
            publish()
        }

    /**
     * Asks for the deck [slide] names, while it is the lesson's slide (M8): a screen's call as the slide shows, BaliApp.swift's
     * `loadDeck`. Once per SHA-256: none while one is on its way, nor for the one held, so a page turned fetches nothing, and
     * `LiveLesson` gives a deck it fetched this session from memory; and, [again] (Try again), once more after it came, never while
     * it is on its way. A new deck lets the last one's document go. Its fetch and open run in the lesson half's own scope, a cancel
     * there a normal stop, never said. Only a screen's ask fetches, never a read.
     */
    suspend fun ask(slide: Slide, again: Boolean = false) =
        alone {
            val live = following?.live ?: return@alone
            if (slide.sha256 != lesson?.presentation?.slide?.sha256) return@alone
            val held = deck
            if (held != null && held.sha256 == slide.sha256 && (!again || held.phase == SlideShown.Phase.Loading)) return@alone
            letDeckGo()
            val ask = ++asks
            deck = SlideDeck(slide.sha256, SlideShown.Phase.Loading, scope.launch { opened(live, slide, ask) })
            publish()
        }

    /** Whether the poll runs now: the tests' mark that nothing polls, never a window of time. */
    internal suspend fun polling(): Boolean = alone { following?.poll?.isActive == true }

    /**
     * Follows the lesson the account's state names now ([lessonSession]), signed in, for a student this phone has shown the consent
     * list as it stands (L8a; the owner's ruling, 2026-10-23): a new session's takes the last one's place, its poll and card let go,
     * and the bell is slept towards. BaliApp.swift's `follow`.
     */
    private fun follow() {
        val sync = account?.sync
        val listed = account?.takeIf { it.signedIn == true }?.listSeenBy
        val session = if (listed != null && sync?.me?.user?.id == listed) sync.followedSession(clock.now(), notFollowed()) else null
        if (session?.id != following?.live?.session) {
            drop()
            if (session != null) start(session.id)
        }
        ring(session?.endsAt)
        publish()
    }

    /** Follows [session]'s lesson: its reads watched, and its poll run while Bali's screen is in front. */
    private fun start(session: String) {
        val live = LiveLesson(session, client, clock::now) { clock.sleep(clock.now() + it.toJavaDuration()) }
        val watch = scope.launch { live.state.collect { alone { read(it, live) } } }
        following = Following(live, watch, if (front) poll(live) else null)
        lesson = live.state.value
    }

    /** [live]'s poll, in the lesson half's own scope: its cancel, as Bali goes behind, a normal stop, never a failure said. */
    private fun poll(live: LiveLesson): Job = scope.launch { live.run() }

    /**
     * A read of [live]'s lesson, while it is the one followed: shown, the card's own let go once another question shows, and the
     * lesson dropped once a read says the session is over, another followed if one runs. So is a poll refused `403` or `404`: the
     * student no longer in the class, or no such session, no connection problem, so never the card's line (L8b-2), followed again
     * once a later read of `GET /v1/me` lists it (L8c). BaliApp.swift's `lessonRead`.
     */
    private fun read(state: LessonState, live: LiveLesson) {
        // A lesson no longer followed, its watch let go as this came: nothing of it shows, another student's least of all.
        if (following?.live !== live) return
        if (state.presentation?.question?.id != lesson?.presentation?.question?.id) letCardGo()
        // One deck's document at a time (M8): a deck the lesson no longer shows is let go.
        if (deck?.sha256 != state.presentation?.slide?.sha256) letDeckGo()
        lesson = state
        val refusal = (state.problem as? PollProblem.Refused)?.status?.let { it in 403..404 } == true
        when {
            refusal -> refused[live.session] = account?.sync?.meReads ?: 0
            state.presentation?.running == false -> over += live.session
            else -> return publish()
        }
        follow()
    }

    /** The sessions not to follow now: over, or refused with no read of `GET /v1/me` taken since. BaliApp.swift's `notFollowed`. */
    private fun notFollowed(): Set<String> = over + refused.filterValues { it == account?.sync?.meReads }.keys

    /** No lesson followed: its watch and poll cancelled, the card's own and the deck let go with it. BaliApp.swift's `dropLesson`. */
    private fun drop() {
        following?.run {
            watch.cancel()
            poll?.cancel()
        }
        following = null
        lesson = null
        letCardGo()
        letDeckGo()
    }

    /**
     * The deck [live] gives for [slide], opened for ask [ask]: kept while that ask is the latest, else its document closed at once,
     * never kept; one with no page is closed too. Every result but a deck opened with pages is failed (SlideView.swift's
     * `SlideDeck.Phase`), and so is a document lost once kept, closed there. Opened outside [alone], which is never held across a call.
     */
    private suspend fun opened(live: LiveLesson, slide: Slide, ask: Int) {
        val document = (live.deck(slide) as? DeckResult.Ready)?.let { deck -> guarded { renderer.open(deck.buffer()) } }
        val kept =
            alone {
                val held = deck?.takeIf { ask == asks }
                val kept = document?.takeIf { held != null && it.pages > 0 }
                if (kept == null) document?.close()
                if (held != null) {
                    held.phase = kept?.let { SlideShown.Phase.Ready(it) } ?: SlideShown.Phase.Failed
                    publish()
                }
                kept
            } ?: return
        // Lost after it opened, the renderer's process gone or a page it couldn't draw: failed, Try again opening a fresh one.
        guarded { kept.awaitLost() }
        alone {
            val held = deck?.takeIf { ask == asks } ?: return@alone
            held.phase = SlideShown.Phase.Failed
            kept.close()
            publish()
        }
    }

    /** A call into the renderer: its cancel thrown on, and anything else it throws against its promise none, so no deck ends Bali's process. */
    private suspend fun <T> guarded(call: suspend () -> T): T? =
        try {
            call()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (broken: Exception) {
            null
        }

    /** The deck let go: its fetch on its way cancelled, a cancel there a normal stop, and its document closed. BaliApp.swift's `letDeckGo`. */
    private fun letDeckGo() {
        val held = deck ?: return
        deck = null
        held.fetch.cancel()
        (held.phase as? SlideShown.Phase.Ready)?.document?.close()
    }

    /** The card's own let go: the pick on its way, what the last one said and Hide, and a pick's answer still to come said nowhere. */
    private fun letCardGo() {
        sending = null
        said = null
        hidden = false
        picks += 1
    }

    /**
     * The lesson's bell, [at], slept towards by the phone's clock ([Screen.bell]): there the lesson is followed afresh, so its poll
     * stops and the card goes, Bali reached or not (Q7; L8c), and a later read with the bell moved follows it again. None: none.
     */
    private fun ring(at: Instant?) {
        if (at == ringsAt) return
        bell?.cancel()
        ringsAt = at
        bell =
            at?.let { rings ->
                scope.launch {
                    Screen.bell(rings, looks, clock)
                    alone {
                        if (ringsAt == rings) ringsAt = null
                        follow()
                    }
                }
            }
    }

    /**
     * The card to show at [now] (L8), BaliApp.swift's `card`: the lesson's question unless hidden, only while the lesson is the one
     * to follow by the phone's clock, so at its bell it goes, as Home's card for the class does (L8c).
     */
    private fun card(now: Instant): AnswerCard? {
        val question = lesson?.presentation?.question?.takeIf { !hidden && current(now) } ?: return null
        return AnswerCard(question, lesson?.problem, sending, said)
    }

    /**
     * The slide to show at [now] (M8), BaliApp.swift's `slideShown`: the page the lesson's last read names, with its deck as this
     * phone has it, loading until asked for, only while the lesson is the one to follow by the phone's clock, as the card. A page
     * past its document's pages shows failed, never ready, as SlideView.swift's `page(at:)` gives none there; the document is kept,
     * as the twin keeps it, so the teacher's next page within them shows at once.
     */
    private fun slide(now: Instant): SlideShown? {
        val slide = lesson?.presentation?.slide?.takeIf { current(now) } ?: return null
        val phase = deck?.takeIf { it.sha256 == slide.sha256 }?.phase ?: SlideShown.Phase.Loading
        val past = phase is SlideShown.Phase.Ready && slide.page !in 1..phase.document.pages
        return SlideShown(slide, if (past) SlideShown.Phase.Failed else phase)
    }

    /** Whether the lesson followed is the one to follow at [now] ([lessonSession]): BaliApp.swift's `lessonCurrent`. */
    private fun current(now: Instant): Boolean = following?.let { account?.sync?.lessonSession(now, notFollowed()) == it.live.session } == true

    /** The state the screens read, published. */
    private fun publish() {
        val now = clock.now()
        published.value = State(lesson, card(now), slide(now), account?.sync?.takeIf { current(now) }, notFollowed(), now)
    }

    /** Runs [block] in the lesson half's own scope: its caller cancelled stops waiting at once, and the call goes on. */
    private suspend fun <T> call(block: suspend () -> T): T = scope.async { block() }.await()

    /**
     * Runs [block] with the lesson half to itself, as a stretch of Swift's main actor, and never cut short, so a cancel lands
     * after it. Never from inside another: the lock is no reentrant one.
     */
    private suspend fun <T> alone(block: () -> T): T = withContext(NonCancellable) { mutex.withLock { block() } }
}
