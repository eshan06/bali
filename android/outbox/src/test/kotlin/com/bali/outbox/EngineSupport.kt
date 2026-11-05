package com.bali.outbox

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteDriver
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import com.bali.core.BaliJson
import com.bali.core.HttpAnswer
import com.bali.core.HttpRequest
import com.bali.core.HttpTransport
import com.bali.core.ParticipationState
import com.bali.core.SendResult
import com.bali.core.SessionView
import com.bali.core.TapRequest
import com.bali.core.TokenProvider
import java.io.File
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The engine's test rig, BaliOutbox's EngineSupport.swift: a clock the test moves, a server it answers
// by hand, B4's stand-in for the tokens, and an engine running over them. coroutines-test's virtual
// time can't stand in for the clock: Room's queries run outside its scheduler. The rig's `screenOn` is
// iOS's `foreground`, the check-ins following the screen (AN5c), and `Answer`'s engine answers come
// with the tests that send them.

/** The routes the engine's tests answer, as [Server.Exchange.route] names them: BaliOutbox's tests' own. */
val tapRoute = "POST /v1/taps"
val unlockRoute = "POST /v1/sessions/s/unlock"
val refocusRoute = "POST /v1/sessions/s/refocus"
val protectionOffRoute = "POST /v1/sessions/s/protection-off"
val checkInRoute = "POST /v1/sessions/s/checkin"
val meRoute = "GET /v1/me"

/**
 * How long, in real time, a test waits for the engine before it fails instead of hanging: well past
 * any stall of a JVM runner, where iOS's waits out the Simulator's (150 s). Only a failing wait takes
 * it all.
 */
val patience = 60.seconds

/** [time] as the API writes one, with its milliseconds: a request's `deviceTime`. BaliOutbox's tests' `iso`. */
fun wire(time: Instant): String = DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(time)

/** Waits, in real time, for [condition]; never true in time fails the test. */
suspend fun eventually(condition: suspend () -> Boolean) {
    val deadline = TimeSource.Monotonic.markNow() + patience
    while (deadline.hasNotPassedNow()) {
        if (condition()) return
        delay(1)
    }
    fail("never came true")
}

/** A clock that moves only when the test moves it: BaliOutbox's tests' `TestClock`. */
class TestClock(start: Instant = t0) : SyncClock {
    private class Sleeper(val deadline: Instant, val wake: CancellableContinuation<Unit>)

    private val lock = Any()
    private var current = start

    /** How long the phone has run: time passing moves it, a change of the clock doesn't. */
    private var running = Duration.ZERO
    private val sleepers = mutableListOf<Sleeper>()

    /** Sleeps due, whose wake [advance] holds back until [releaseWakes]. */
    private val held = mutableListOf<Sleeper>()

    override fun now(): Instant = synchronized(lock) { current }

    override fun uptime(): Duration = synchronized(lock) { running }

    /** The deadlines slept on now, soonest first. */
    val deadlines: List<Instant> get() = synchronized(lock) { sleepers.map { it.deadline }.sorted() }

    /**
     * A cancelled sleep ends at once, throwing, a held one too: nothing else would wake it once a test
     * stopped before [releaseWakes], and its coroutine would hang.
     */
    override suspend fun sleep(until: Instant) =
        suspendCancellableCoroutine<Unit> { wake ->
            val sleeper = Sleeper(until, wake)
            wake.invokeOnCancellation {
                synchronized(lock) {
                    sleepers.remove(sleeper)
                    held.remove(sleeper)
                }
            }
            val due =
                synchronized(lock) {
                    when {
                        !wake.isActive -> false
                        until <= current -> true
                        else -> false.also { sleepers += sleeper }
                    }
                }
            if (due) wake.resume(Unit)
        }

    /**
     * Time passes: the clock moves on, and every sleep then due wakes, or, [holdingWakes], is over but
     * not woken until [releaseWakes]: a wake a loaded phone runs late.
     */
    fun advance(by: Duration, holdingWakes: Boolean = false) = move(by, running = true, holdingWakes)

    fun advance(seconds: Long, holdingWakes: Boolean = false) = advance(Duration.ofSeconds(seconds), holdingWakes)

    /** The phone's clock is set, forward or back: the time moves, how long the phone has run doesn't. */
    fun turn(by: Duration) = move(by, running = false, holdingWakes = false)

    /** Wakes the sleeps [advance] held back. */
    fun releaseWakes() {
        val late = synchronized(lock) { held.toList().also { held.clear() } }
        late.forEach { it.wake.resume(Unit) }
    }

    private fun move(by: Duration, running: Boolean, holdingWakes: Boolean) {
        val due =
            synchronized(lock) {
                current += by
                if (running) this.running += by
                val due = sleepers.filter { it.deadline <= current }
                sleepers -= due.toSet()
                if (holdingWakes) emptyList<Sleeper>().also { held += due } else due
            }
        due.forEach { it.wake.resume(Unit) }
    }
}

/** The API, answered by hand: each request waits until the test answers it. BaliOutbox's tests' `Server`. */
class Server : HttpTransport {
    /** One request and its answer, given once: the test's, or none once the server closes. */
    class Exchange(val request: HttpRequest, private val answer: CompletableDeferred<Pair<Int?, String>>) {
        val route = "${request.method} ${request.url.path}"
        val token: String? = request.headers["Authorization"]
        val eventId: String? get() = field("eventId")
        val deviceTime: String? get() = field("deviceTime")

        /** Answers with [status] and [body], or with no answer at all when [status] is none. */
        fun reply(status: Int?, body: String = "") {
            answer.complete(status to body)
        }

        private fun field(name: String) =
            request.body?.let { BaliJson.parseToJsonElement(it.decodeToString()).jsonObject[name]?.jsonPrimitive?.contentOrNull }
    }

    private class Taker(val route: String?, val take: CompletableDeferred<Exchange?>)

    private val lock = Any()
    private val unanswered = mutableListOf<Exchange>()
    private val takers = mutableListOf<Taker>()
    private val exchanges = mutableListOf<Exchange>()
    private var closed = false

    /** The routes of the requests sent and not yet taken by [next]. */
    val waiting: List<String> get() = synchronized(lock) { unanswered.map { it.route } }

    override suspend fun send(request: HttpRequest): HttpAnswer {
        val answer = CompletableDeferred<Pair<Int?, String>>()
        val exchange = Exchange(request, answer)
        synchronized(lock) {
            exchanges += exchange
            val taker = takers.firstOrNull { it.route == null || it.route == exchange.route }
            when {
                closed -> exchange.reply(null)
                taker != null -> {
                    takers -= taker
                    taker.take.complete(exchange)
                }
                else -> unanswered += exchange
            }
        }
        val (status, body) = answer.await()
        return HttpAnswer(status ?: throw IOException("no answer"), emptyMap(), body.encodeToByteArray())
    }

    /**
     * The next request the engine sends, the next to [route] when one is named, once it has; none in
     * time fails the test rather than hanging it.
     */
    suspend fun next(route: String? = null): Exchange {
        val taker = Taker(route, CompletableDeferred())
        synchronized(lock) {
            val sent = unanswered.firstOrNull { route == null || it.route == route }
            if (sent != null) return sent.also { unanswered -= it }
            takers += taker
        }
        withTimeoutOrNull(patience) { taker.take.await() }?.let { return it }
        // Expired, unless a request came just now: taken, it is the test's.
        synchronized(lock) { if (takers.remove(taker)) taker.take.complete(null) }
        return taker.take.await() ?: fail("No request to ${route ?: "any route"} came in time")
    }

    /** No answer to anything from now on, a request in flight included, taken or not, so none holds the engine up. */
    fun close() {
        synchronized(lock) {
            closed = true
            exchanges.forEach { it.reply(null) }
            unanswered.clear()
        }
    }
}

/** B4's stand-in: a token to give, or none, and a refresh that mints a fresh one. BaliOutbox's tests' `Tokens`. */
class Tokens(private val refreshWorks: Boolean = true) : TokenProvider {
    private val lock = Any()
    private var token: String? = "token-1"
    private var count = 0

    /** Refreshes under way, held until [release]; none when refreshes aren't held. */
    private var held: MutableList<CompletableDeferred<Unit>>? = null

    val refreshes: Int get() = synchronized(lock) { count }

    override suspend fun accessToken(): String? = synchronized(lock) { token }

    fun set(token: String?) = synchronized(lock) { this.token = token }

    /** Every refresh from now on runs until [release]: one under way, for as long as the test says. */
    fun hold() = synchronized(lock) { held = mutableListOf() }

    fun release() {
        val waiting = synchronized(lock) { held.orEmpty().also { held = null } }
        waiting.forEach { it.complete(Unit) }
    }

    suspend fun refresh(): Boolean {
        val wait =
            synchronized(lock) {
                count += 1
                held?.let { CompletableDeferred<Unit>().also(it::add) }
            }
        wait?.await()
        return synchronized(lock) {
            if (refreshWorks) token = "token-${count + 1}"
            refreshWorks
        }
    }
}

/** An engine running over an outbox, a hand-answered server, a test clock and B4's stand-in. BaliOutbox's tests' `Rig`. */
class Rig(val engine: SyncEngine, val outbox: Outbox, val server: Server, val clock: TestClock, val tokens: Tokens, scope: CoroutineScope) {
    /** The engine's run, started at once: its first stretch holds the engine before any call the test makes. */
    val running: Job = scope.launch(start = CoroutineStart.UNDISPATCHED) { engine.run() }

    /** Waits for a state [condition] holds for, and returns it; none in time fails the test. */
    suspend fun until(condition: (SyncState) -> Boolean): SyncState =
        withTimeoutOrNull(patience) { engine.updates.first(condition) } ?: fail("the engine never reached the state waited for")

    /** Waits until the clock has exactly these sleeps: the engine is waiting on them. */
    suspend fun sleeping(vararg deadlines: Instant) = eventually { clock.deadlines == deadlines.toList() }

    /** Taps into [view] as the server answers it: the phone in that session, focused. */
    suspend fun tapIn(view: SessionView = session()) {
        engine.record(Change.Tap("tag"))
        server.next(tapRoute).reply(200, Answer.joined(view))
        until { it.standing == Standing.InSession(view, ParticipationState.Focused) && it.queued.isEmpty() }
    }

    /**
     * The screen on, the read it makes at once answered: in a session its check-in, with [live]; out of
     * one, the truth, with [me]. The read loop then waits for its next check-in. BaliOutbox's tests'
     * `foreground`, whose read of the truth is `GET /v1/me` in a session too.
     */
    suspend fun screenOn(me: String = Answer.me(), live: String = Answer.live()) {
        val standing = engine.updates.value.standing
        engine.setScreenOn(true)
        if (standing is Standing.InSession) {
            server.next("POST /v1/sessions/${standing.session.id}/checkin").reply(200, live)
        } else {
            server.next(meRoute).reply(200, me)
        }
        eventually { clock.deadlines.contains(clock.now() + SyncEngine.CHECK_IN_INTERVAL) }
    }

    /** Stops the engine: its loops must end. */
    suspend fun stop() {
        running.cancel()
        server.close()
        withTimeoutOrNull(patience) { running.join() } ?: fail("the engine's loops never ended")
    }
}

/** Each test's engines, over [OutboxFiles]' outboxes in the app's place: stopped once the test is over. */
abstract class EngineFiles : OutboxFiles() {
    /** The scope the app gives its engine, here the test's. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val rigs = mutableListOf<Rig>()

    /** An engine over [outbox], never run: what a launch starts from. */
    suspend fun engine(outbox: Outbox): SyncEngine = SyncEngine.open(outbox, client(Server()), scope, TestClock())

    /** A rig over [outbox], a fresh one by default: BaliOutbox's tests' `Rig(outbox:refreshWorks:)`. */
    suspend fun rig(outbox: Outbox = makeOutbox().first, refreshWorks: Boolean = true): Rig {
        val (server, clock, tokens) = Triple(Server(), TestClock(), Tokens(refreshWorks))
        val engine = SyncEngine.open(outbox, client(server, tokens), scope, clock) { tokens.refresh() }
        return Rig(engine, outbox, server, clock, tokens, scope).also { rigs += it }
    }

    /**
     * [file]'s outbox, watched: at each commit to it, [Relaunches] opens the engine the next launch
     * would, over an outbox of its own, opened here before anything it watches.
     */
    suspend fun relaunching(file: File): Pair<Outbox, Relaunches> {
        val relaunches = Relaunches(open(file))
        val outbox = open(file, driver = relaunches.driver)
        outbox.records()
        relaunches.file.records()
        return outbox to relaunches
    }

    @AfterTest
    fun stopEngines(): Unit =
        runBlocking {
            rigs.forEach { it.stop() }
            scope.cancel()
        }
}

/**
 * While [watching], at every commit to the file, the engine the next launch would start, were the app
 * killed right then: each opened over [file], the next launch's own outbox, never run. Room has no twin
 * of GRDB's `TransactionObserver`, so the outbox watched is opened over [driver], which sees each commit
 * as it lands, before its write returns. BaliOutbox's tests' `Relaunches`.
 */
class Relaunches(val file: Outbox) {
    private val started = mutableListOf<SyncEngine>()
    private val scope = CoroutineScope(Job())

    @Volatile var watching = false

    val engines: List<SyncEngine> get() = synchronized(started) { started.toList() }

    val driver: SQLiteDriver =
        Watching(
            committed = {
                if (watching) {
                    val engine = runBlocking { SyncEngine.open(file, client(Server()), scope) }
                    synchronized(started) { started += engine }
                }
            },
        )
}

/**
 * A write held once it has begun, as a slow disk holds it, while the test does what it must: [hold] is
 * [Watching]'s `began`, holding each write begun once [arm]ed, until [release].
 */
class HeldWrite {
    private val armed = AtomicBoolean(false)
    private val begun = CompletableDeferred<Unit>()
    private val released = CountDownLatch(1)

    val hold: () -> Unit = {
        if (armed.get()) {
            begun.complete(Unit)
            released.await(patience.inWholeMilliseconds, TimeUnit.MILLISECONDS)
        }
    }

    fun arm() = armed.set(true)

    /** Waits for the write to begin; none in time fails the test. */
    suspend fun began() = withTimeoutOrNull(patience) { begun.await() } ?: fail("no write began")

    fun release() {
        armed.set(false)
        released.countDown()
    }
}

/**
 * The bundled driver, its writes watched on the connection that makes each: [began] runs as a write's
 * transaction begins, and [committed] as it lands, before its write returns; [stepping] runs with each
 * statement's SQL as it steps, and refuses the step by throwing, as a failing disk refuses one read.
 * (Room keeps each statement it prepares on its connection, so a step, not a prepare, is each use.)
 */
class Watching(
    private val began: () -> Unit = {},
    private val committed: () -> Unit = {},
    private val stepping: (String) -> Unit = {},
    private val bundled: SQLiteDriver = GuardDriver(),
) : SQLiteDriver by bundled {
    override fun open(fileName: String): SQLiteConnection = Watched(bundled.open(fileName), began, committed, stepping)
}

/**
 * A connection whose transactions are watched: Room begins a write `IMMEDIATE` (its file's creation
 * `EXCLUSIVE`) and a read `DEFERRED`, so only a write's end is a commit.
 */
private class Watched(
    private val connection: SQLiteConnection,
    private val began: () -> Unit,
    private val committed: () -> Unit,
    private val stepping: (String) -> Unit,
) : SQLiteConnection by connection {
    private var writing = false

    override fun prepare(sql: String): SQLiteStatement {
        val statement = connection.prepare(sql)
        val stepped: () -> Unit =
            when {
                sql.startsWith("BEGIN IMMEDIATE") || sql.startsWith("BEGIN EXCLUSIVE") -> {
                    {
                        writing = true
                        began()
                    }
                }
                sql == "END TRANSACTION" -> {
                    {
                        if (writing) {
                            writing = false
                            committed()
                        }
                    }
                }
                sql == "ROLLBACK TRANSACTION" -> ({ writing = false })
                else -> ({})
            }
        return Stepped(statement, { stepping(sql) }, stepped)
    }
}

/** A statement whose every step runs [before] first, which may refuse it, and [stepped] once it has. */
private class Stepped(private val statement: SQLiteStatement, private val before: () -> Unit, private val stepped: () -> Unit) :
    SQLiteStatement by statement {
    override fun step(): Boolean {
        before()
        return statement.step().also { stepped() }
    }
}

/** The rig's clock: BaliOutbox's tests' TestClockTests. */
class TestClockTest {
    @Test
    fun aSleepAdvanceHoldsBackCanStillBeCancelledItsCoroutineEndsAtOnceNeverWaitingOnReleaseWakes(): Unit =
        runBlocking {
            // A test that returns early fails fast instead of hanging (#90's review).
            val clock = TestClock()
            var threw = false
            val sleeper =
                launch {
                    try {
                        clock.sleep(at(10))
                    } catch (cancelled: CancellationException) {
                        threw = true
                        throw cancelled
                    }
                }
            eventually { clock.deadlines == listOf(at(10)) }
            clock.advance(10, holdingWakes = true)
            sleeper.cancel()
            // Not ended in time: woken, so this test fails rather than hangs.
            val ended = withTimeoutOrNull(5.seconds) { sleeper.join() } != null
            if (!ended) clock.releaseWakes()
            assertTrue(ended && threw, "the cancelled sleep ended, throwing")
        }
}

/** The rig's server, which the engine's tests answer by hand. */
class ServerTest {
    @Test
    fun eachRequestWaitsForTheTestsAnswerTheNextToARouteIsTakenByItAndOnceClosedNothingIsAnswered(): Unit =
        runBlocking {
            val server = Server()
            val client = client(server, Tokens())
            val tap = async { client.tap(TapRequest("tag", "e", t0)) }
            val me = async { client.me() }
            // The read, taken by its route though the tap went first, and answered as the test says.
            val read = server.next("GET /v1/me")
            assertEquals("Bearer token-1", read.token)
            read.reply(503)
            assertEquals(SendResult.Status(503), me.await().result)
            val sent = server.next()
            assertEquals(listOf("POST /v1/taps", "e", "2026-09-21T14:13:20.000Z"), listOf(sent.route, sent.eventId, sent.deviceTime))
            assertEquals(emptyList(), server.waiting)
            // Closed, it answers none: the request taken, and every one after.
            server.close()
            assertEquals(SendResult.NetworkError, tap.await().result)
            assertEquals(SendResult.NetworkError, client.me().result)
        }
}
