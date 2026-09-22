import {
  type BlockDetail,
  type CheckInResponse,
  type ClassDetail,
  deriveDisplayState,
  type EndEnrollmentResponse,
  type EndSessionResponse,
  type EnrollmentJoinResponse,
  type EventType,
  type EventsPage,
  type FeedEvent,
  type RefocusResponse,
  type SessionSnapshot,
  type StartSessionResponse,
  type TapResponse,
  type UnlockResponse,
} from '@bali/shared';
import { randomUUID } from 'node:crypto';

import { type Call, createCall } from './demo/http.js';
import { openSseRecorder, type SseRecorder } from './demo/sse.js';
import { createWorld, type DemoActor, type DemoActorSpec, type DemoWorld } from './demo/world.js';

/*
 * The Phase-2 exit demo: a phone + classroom simulator driving the REAL HTTP API
 * (routes, auth, the transition engine) over a real socket — the difference from
 * the Phase-1 walk is that nothing here calls the engine directly; every actor
 * speaks HTTP, the way the phones and the teacher's browser do.
 *
 * It runs in either of two worlds (see ./demo/world.ts), driving the identical
 * requests against both:
 *
 *   npm run demo                      in-process server + in-process Postgres,
 *                                     zero setup, seconds
 *   TEST_DATABASE_URL=… npm run demo  the same, on a real Postgres
 *   DEMO_API_URL=… npm run demo       the DEPLOYED API (Railway dev) with real
 *                                     Cognito sign-ins — the exit-demo run
 *
 * The script is self-checking: each incident asserts the guarantee it exists to
 * prove, so a regression makes `npm run demo` exit non-zero rather than lie. It
 * is also Phase 4's load-gate seed.
 */

function line(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const iso = (): string => new Date().toISOString();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The cast. Keys double as the suffix of each actor's env vars in remote mode. */
const TEACHER: DemoActorSpec = { key: 'teacher', displayName: 'Ms. Rivera', role: 'teacher' };
const STUDENTS: DemoActorSpec[] = [
  { key: 'ana', displayName: 'Ana', role: 'student' }, // emergency unlock, then refocus
  { key: 'ben', displayName: 'Ben', role: 'student' }, // goes silent, then comes back
  { key: 'cal', displayName: 'Cal', role: 'student' }, // removed mid-session, unlocks anyway
  { key: 'dana', displayName: 'Dana', role: 'student' }, // stays focused the whole time
];

/**
 * Keep the phones that are *supposed* to stay live checking in while an incident
 * waits out real time. In local mode the waits are instant and this never fires;
 * against a deployed API it is what makes "Ben went quiet" mean Ben specifically,
 * rather than every phone in the room drifting past the 90-second threshold
 * together. It is also just what the real app does (decision 7).
 */
function startHeartbeats(
  call: Call,
  sessionId: string,
  students: DemoActor[],
  intervalMs = 30_000,
): { stop: () => Promise<void> } {
  let stopped = false;
  let failure: Error | null = null;

  const loop = (async () => {
    let lastBeat = 0; // beat on the first tick, not 30s in
    while (!stopped) {
      // Tick often so `stop()` is noticed promptly, but only beat on schedule.
      await sleep(500);
      if (stopped || Date.now() - lastBeat < intervalMs) continue;
      lastBeat = Date.now();
      for (const s of students) {
        if (stopped) break;
        try {
          await call<CheckInResponse>('POST', `/v1/sessions/${sessionId}/checkin`, {
            token: s.token,
            body: { deviceTime: iso() },
          });
        } catch (err) {
          // A phone that cannot check in is a finding, not something to swallow.
          failure ??= err instanceof Error ? err : new Error(String(err));
          stopped = true;
        }
      }
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loop;
      if (failure) throw failure;
    },
  };
}

/**
 * Run an incident with the room checking in underneath it. The precedence rule
 * matters: a phone that could not check in is always reported, but it must never
 * replace the incident's own error — that is the diagnosis worth keeping.
 */
async function withHeartbeats<T>(
  beats: { stop: () => Promise<void> },
  body: () => Promise<T>,
): Promise<T> {
  let incidentError: Error | null = null;
  let result: T | undefined;
  try {
    result = await body();
  } catch (err) {
    incidentError = err instanceof Error ? err : new Error(String(err));
  }
  // Outside the try, so neither failure can mask the other.
  const beatError = await beats.stop().then(
    () => null,
    (err: unknown) => err as Error,
  );
  if (incidentError) {
    if (beatError) console.error('  (a phone also failed to check in meanwhile):', beatError);
    throw incidentError;
  }
  if (beatError) throw beatError;
  return result as T;
}

async function main(): Promise<void> {
  const specs = [TEACHER, ...STUDENTS];
  const world: DemoWorld = await createWorld(process.env, specs);
  const call = createCall(world.base);
  console.log(`running the exit demo in ${world.mode} mode against ${world.base}`);

  let stream: SseRecorder | null = null;
  let expiryStream: SseRecorder | null = null;
  // Tracked so a failure part-way through still releases the class's session
  // slot — a live session left behind would block the next run's start.
  let openSessionId: string | null = null;
  let teacherToken: string | null = null;

  try {
    line('the accounts (a provisioned teacher and four students)');
    const actors = await world.provision(specs);
    const teacher = actors.get(TEACHER.key);
    assert(teacher, 'the teacher must be provisioned');
    teacherToken = teacher.token;
    const students = STUDENTS.map((spec) => {
      const actor = actors.get(spec.key);
      assert(actor, `${spec.displayName} must be provisioned`);
      return actor;
    });
    const byKey = (key: string): DemoActor => {
      const actor = actors.get(key);
      assert(actor, `${key} must be provisioned`);
      return actor;
    };
    const names = new Map(students.map((s) => [s.userId, s.displayName]));
    console.log(
      `${teacher.displayName} teaches; ${students.map((s) => s.displayName).join(', ')} have phones.`,
    );

    line('the teacher sets up a class and a block (over HTTP)');
    const klass = await call<ClassDetail>('POST', '/v1/classes', {
      token: teacher.token,
      body: { name: `Period 1 (demo ${new Date().toISOString().slice(0, 19)})` },
    }).catch((err: unknown) => {
      // classes.school_id is NOT NULL and nothing ever assigns it, so a teacher
      // provisioned by role alone gets this far and no further.
      if (err instanceof Error && err.message.includes('not assigned to a school')) {
        throw new Error(
          `${teacher.displayName} has no school, so no class can be created. Assign one ` +
            'out of band:\n  UPDATE users SET school_id = (SELECT id FROM schools LIMIT 1) ' +
            `WHERE id = '${teacher.userId}';`,
        );
      }
      throw err;
    });
    const tagId = `SIM-BLOCK-${randomUUID().slice(0, 8)}`;
    const block = await call<BlockDetail>('POST', '/v1/blocks', {
      token: teacher.token,
      body: { tagId },
    });
    console.log(`class "${klass.name}" (join code ${klass.joinCode}); block tag ${block.tagId}`);

    line('the students join by code');
    const enrollmentIds = new Map<string, string>();
    for (const s of students) {
      const j = await call<EnrollmentJoinResponse>('POST', '/v1/enrollments', {
        token: s.token,
        body: { joinCode: klass.joinCode, eventId: randomUUID(), deviceTime: iso() },
      });
      assert(
        j.outcome === 'joined' || j.outcome === 'already_enrolled',
        `${s.displayName} join outcome ${j.outcome}`,
      );
      enrollmentIds.set(s.key, j.enrollmentId);
    }
    console.log(`${students.length} students enrolled.`);

    line('8:00am — the teacher starts the session');
    const started = await call<StartSessionResponse>('POST', `/v1/classes/${klass.id}/sessions`, {
      token: teacher.token,
      body: { durationMinutes: 25 },
    });
    const sid = started.session.id;
    openSessionId = sid;
    console.log(`session ${started.outcome} (${sid})`);

    line('the bell — every phone taps the block');
    for (const s of students) {
      const t = await call<TapResponse>('POST', '/v1/taps', {
        token: s.token,
        body: { tagId: block.tagId, eventId: randomUUID(), deviceTime: iso() },
      });
      assert(
        t.outcome === 'joined',
        `${s.displayName} tap outcome ${t.outcome} — a "switched" here means a session from an ` +
          'earlier run is still live; wait for the sweep to expire it and re-run',
      );
      assert(t.state === 'focused', `${s.displayName} should be focused, got ${String(t.state)}`);
    }
    // A first heartbeat from each phone — the engine answers "live", emits nothing.
    for (const s of students) {
      const c = await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
        token: s.token,
        body: { deviceTime: iso() },
      });
      assert(c.status === 'live', `${s.displayName} check-in status ${c.status}`);
    }
    console.log('all four are focused and checking in.');

    line("the teacher's grid goes live (SSE)");
    // The boot snapshot hands back the seq to stream from, so the grid loads and
    // goes live in one round trip — and the stream is confirmed open before any
    // of the incidents below, so what it receives is genuinely live delivery and
    // not a catch-up read racing the action.
    const boot = await call<SessionSnapshot>('GET', `/v1/sessions/${sid}`, {
      token: teacher.token,
    });
    // `stream` stays nullable for the cleanup in `finally`; `grid` is the same
    // recorder, non-null, so the incident closures below keep a concrete type.
    stream = await openSseRecorder({
      base: world.base,
      sessionId: sid,
      token: teacher.token,
      after: boot.latestSeq,
    });
    const grid = stream;
    console.log(`stream open, resuming from seq ${boot.latestSeq}.`);

    line('8:05am — Ana hits emergency unlock, then refocuses');
    const ana = byKey('ana');
    const anaUnlock = await call<UnlockResponse>('POST', `/v1/sessions/${sid}/unlock`, {
      token: ana.token,
      body: { eventId: randomUUID(), deviceTime: iso() },
    });
    assert(anaUnlock.outcome === 'applied', `Ana unlock outcome ${anaUnlock.outcome}`);
    assert(
      anaUnlock.state === 'unlocked',
      `Ana should be unlocked, got ${String(anaUnlock.state)}`,
    );
    // The unlock must reach the teacher's screen over the stream, not merely be
    // readable afterwards — that is the whole promise of the live grid (rule 6).
    const liveUnlock = await grid.waitFor((e) => e.type === 'unlock' && e.userId === ana.userId, {
      label: "Ana's unlock",
      timeoutMs: world.liveWaitMs,
    });
    console.log(`  live: unlock for Ana arrived on the stream at seq ${liveUnlock.seq}.`);

    const anaRefocus = await call<RefocusResponse>('POST', `/v1/sessions/${sid}/refocus`, {
      token: ana.token,
      body: { eventId: randomUUID(), deviceTime: iso() },
    });
    assert(anaRefocus.state === 'focused', `Ana should be refocused, got ${anaRefocus.state}`);
    await grid.waitFor((e) => e.type === 'refocus' && e.userId === ana.userId, {
      label: "Ana's refocus",
      timeoutMs: world.liveWaitMs,
    });
    console.log('Ana: focused → unlocked → focused, every step live on the grid.');

    line('8:07am — Ben goes quiet (a phone in a bag)');
    const ben = byKey('ben');
    // Everyone else keeps checking in, so the silence that follows is Ben's alone.
    const others = students.filter((s) => s.key !== ben.key);
    const beats = startHeartbeats(call, sid, others);
    await withHeartbeats(beats, async () => {
      await world.compressSilence({
        sessionId: sid,
        studentId: ben.userId,
        teacherToken: teacher.token,
      });
      // Local mode runs the sweep itself; against a deployment without the sweep
      // key, the platform's own per-minute cron does it and we wait for the event.
      // Deliberately not asserted: /internal/sweep reports what THIS call did,
      // both duties are idempotent, and the deployment runs the same sweep every
      // minute — so whether our call or the cron opened the episode is a coin
      // flip. The event below is the proof either way.
      const swept = await world.sweep();
      if (swept) console.log(`  our sweep: ${swept.wentSilent} silence episode(s) opened`);
      const silentEvent = await grid.waitFor(
        (e) => e.type === 'went_silent' && e.userId === ben.userId,
        { label: "Ben's went_silent (from the sweep)", timeoutMs: world.sweepWaitMs },
      );
      console.log(`  live: went_silent for Ben at seq ${silentEvent.seq}.`);
    });
    const afterSilence = await call<EventsPage>('GET', `/v1/sessions/${sid}/events?after=0`, {
      token: teacher.token,
    });
    const benSilent = afterSilence.events.filter(
      (e) => e.type === 'went_silent' && e.userId === ben.userId,
    );
    assert(benSilent.length === 1, `expected one went_silent for Ben, got ${benSilent.length}`);
    console.log('Ben is marked silent — exactly one episode opened.');

    const cal = byKey('cal');

    line('8:08am — Ben comes back');
    // The room reports in first: the pump has been stopped since the silence
    // incident, and Ana's and Dana's last beat can already be ~30s old, so this
    // restores the full margin to the 90s threshold before the long stretch
    // below rather than spending part of it on the gap between pumps.
    for (const other of others) {
      await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
        token: other.token,
        body: { deviceTime: iso() },
      });
    }
    // Then Ben's own check-in, with no pump running, so the episode is closed by
    // his return and nothing else. Starting the pump first would let a background
    // beat win the race: every assertion would still pass, but the incident
    // would prove "some check-in closed it" rather than "Ben's return did", and
    // a regression in exactly that path would be masked.
    const benBack = await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
      token: ben.token,
      body: { deviceTime: iso() },
    });
    assert(benBack.status === 'live', `Ben check-in status ${benBack.status}`);

    // From here the room keeps checking in — Ben included, now that he is back.
    // What follows can run for several liveWaitMs budgets against a deployment,
    // and a silent room drifts past the 90s threshold, whereupon the sweep opens
    // episodes the "exactly one" assertions below forbid.
    const roomBeats = startHeartbeats(call, sid, students);
    await withHeartbeats(roomBeats, async () => {
      const cameBack = await grid.waitFor(
        (e) => e.type === 'came_back' && e.userId === ben.userId,
        {
          label: "Ben's came_back",
          timeoutMs: world.liveWaitMs,
        },
      );
      const afterReturn = await call<EventsPage>('GET', `/v1/sessions/${sid}/events?after=0`, {
        token: teacher.token,
      });
      const benCameBack = afterReturn.events.filter(
        (e) => e.type === 'came_back' && e.userId === ben.userId,
      );
      assert(benCameBack.length === 1, `expected one came_back for Ben, got ${benCameBack.length}`);
      console.log(
        `Ben checked in — one came_back (seq ${cameBack.seq}), and the plain heartbeats emitted nothing.`,
      );

      line('8:10am — Cal is removed mid-session, then his phone unlocks anyway (ISSUES #2)');
      const calEnrollment = enrollmentIds.get(cal.key);
      assert(calEnrollment, 'Cal must have an enrollment id');
      const removal = await call<EndEnrollmentResponse>(
        'DELETE',
        `/v1/enrollments/${calEnrollment}`,
        { token: teacher.token },
      );
      assert(removal.reason === 'removed_from_class', `Cal removal reason ${removal.reason}`);
      assert(removal.endedParticipation, 'Cal was live, so his participation should end');
      // Cal's phone hasn't heard yet and hits emergency unlock. The contract: it is
      // never a 404 and never discarded — it is recorded with a note.
      const calUnlock = await call<UnlockResponse>('POST', `/v1/sessions/${sid}/unlock`, {
        token: cal.token,
        body: { eventId: randomUUID(), deviceTime: iso() },
      });
      assert(calUnlock.outcome === 'recorded', `Cal unlock outcome ${calUnlock.outcome}`);
      assert(
        calUnlock.recordedAs === 'no_live_participation',
        `Cal unlock recordedAs ${String(calUnlock.recordedAs)}`,
      );
      // Both of Cal's events must reach the grid live before the aggregate check
      // below compares the log against the stream — otherwise that check silently
      // asserts zero delivery latency for the two most recent events.
      await grid.waitFor((e) => e.type === 'enrollment_removed' && e.userId === cal.userId, {
        label: "Cal's removal",
        timeoutMs: world.liveWaitMs,
      });
      await grid.waitFor((e) => e.type === 'unlock' && e.userId === cal.userId, {
        label: "Cal's recorded unlock",
        timeoutMs: world.liveWaitMs,
      });
      // His next check-in learns he is gone.
      const calCheck = await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
        token: cal.token,
        body: { deviceTime: iso() },
      });
      assert(calCheck.status === 'gone', `Cal check-in status ${calCheck.status}`);
      console.log(
        'Cal removed; his unlock was recorded (no_live_participation), next check-in: gone.',
      );
    });

    line('the live grid (the teacher snapshot, derived like the portal)');
    // The phones still in the room report in first, exactly as they would every
    // 30 seconds — otherwise a long remote run reads them as silent, which would
    // be a true statement about a simulation artefact rather than about the API.
    for (const s of students.filter((x) => x.key !== cal.key)) {
      await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
        token: s.token,
        body: { deviceTime: iso() },
      });
    }
    const snap = await call<SessionSnapshot>('GET', `/v1/sessions/${sid}`, {
      token: teacher.token,
    });
    const now = new Date();
    const display = new Map<string, string>();
    for (const st of snap.students) {
      const state =
        st.state === null
          ? 'absent'
          : deriveDisplayState(
              {
                state: st.state,
                joinedAt: st.joinedAt ? new Date(st.joinedAt) : now,
                lastSeenAt: st.lastSeenAt ? new Date(st.lastSeenAt) : null,
                endedAt: st.endedAt ? new Date(st.endedAt) : null,
              },
              now,
            );
      display.set(st.studentId, state);
      console.log(`  ${(st.displayName ?? st.studentId).padEnd(6)} ${state}`);
    }
    assert(display.get(byKey('ana').userId) === 'focused', 'Ana should read focused');
    assert(display.get(ben.userId) === 'focused', 'Ben should read focused again');
    // Cal was removed, so he drops off the active roster a fresh snapshot builds
    // from; the teacher's live grid learned of his exit from the enrollment_removed
    // event on the feed (below), not from this roster.
    assert(!display.has(cal.userId), 'Cal, removed, is no longer on the active roster');
    assert(display.get(byKey('dana').userId) === 'focused', 'Dana should read focused');
    console.log('  (Cal was removed — off the roster; his exit is in the event log below.)');

    line('the permanent event log (rule 6)');
    const log = await call<EventsPage>('GET', `/v1/sessions/${sid}/events?after=0`, {
      token: teacher.token,
    });
    for (const e of log.events) {
      console.log(
        `  #${String(e.seq).padStart(2)}  ${e.type.padEnd(20)} ${names.get(e.userId ?? '') ?? '—'}`,
      );
    }
    // The log must carry every promised event exactly, and no heartbeat noise.
    const types = log.events.map((e) => e.type);
    const required: EventType[] = [
      'session_started',
      'tap_in',
      'unlock',
      'refocus',
      'went_silent',
      'came_back',
      'enrollment_removed',
    ];
    for (const t of required) {
      assert(types.includes(t), `event log should contain ${t}`);
    }
    assert(types.filter((t) => t === 'tap_in').length === 4, 'four taps in the log');
    assert(
      types.filter((t) => t === 'unlock').length === 2,
      "Ana's and Cal's unlocks both recorded",
    );
    assert(types.filter((t) => t === 'went_silent').length === 1, 'exactly one went_silent');
    assert(types.filter((t) => t === 'came_back').length === 1, 'exactly one came_back');

    // Everything the log carries for this session should also have reached the
    // grid live. The stream opened at `boot.latestSeq`, so compare against the
    // events from that point on.
    const liveIds = new Set(grid.received().map((e: FeedEvent) => e.eventId));
    const missedLive = log.events.filter((e) => e.seq > boot.latestSeq && !liveIds.has(e.eventId));
    assert(
      missedLive.length === 0,
      `every event after the stream opened should have arrived live; missed ${missedLive
        .map((e) => `${e.type}#${e.seq}`)
        .join(', ')}`,
    );
    const postBoot = log.events.filter((e) => e.seq > boot.latestSeq).length;
    console.log(
      `  all ${String(postBoot)} events written after the stream opened arrived live ` +
        `(${String(grid.received().length)} delivered in total, plus ${String(grid.commentCount())} comment/keep-alive frames).`,
    );

    line('8:25am — the teacher ends the session');
    const ended = await call<EndSessionResponse>('POST', `/v1/sessions/${sid}/end`, {
      token: teacher.token,
    });
    assert(ended.outcome === 'ended', `end outcome ${ended.outcome}`);
    openSessionId = null;
    stream.close();
    stream = null;
    console.log(`ended; participations closed: ${ended.endedParticipations}`);

    line('the next session ends itself at the bell (decision 6)');
    // Ending by hand is the teacher's escape hatch; the promise the product
    // actually makes is that the bell frees the phone whether or not anyone
    // presses anything. That is the sweep's job, so prove the sweep does it.
    const second = await call<StartSessionResponse>('POST', `/v1/classes/${klass.id}/sessions`, {
      token: teacher.token,
      body: { durationMinutes: 1 },
    });
    const expiringId = second.session.id;
    openSessionId = expiringId;
    const dana = byKey('dana');
    const danaTap = await call<TapResponse>('POST', '/v1/taps', {
      token: dana.token,
      body: { tagId: block.tagId, eventId: randomUUID(), deviceTime: iso() },
    });
    assert(danaTap.outcome === 'joined', `Dana second-session tap outcome ${danaTap.outcome}`);
    const secondBoot = await call<SessionSnapshot>('GET', `/v1/sessions/${expiringId}`, {
      token: teacher.token,
    });
    expiryStream = await openSseRecorder({
      base: world.base,
      sessionId: expiringId,
      token: teacher.token,
      after: secondBoot.latestSeq,
    });
    console.log(`session ${expiringId} runs until ${second.session.endsAt}; Dana is focused.`);

    await world.compressSessionEnd({
      sessionId: expiringId,
      startedAt: new Date(second.session.startedAt),
      endsAt: new Date(second.session.endsAt),
    });
    // Same race as the silence sweep: the cron may have expired it first.
    const expirySweep = await world.sweep();
    if (expirySweep) console.log(`  our sweep: ${expirySweep.expired} session(s) expired`);
    const expiredEvent = await expiryStream.waitFor((e) => e.type === 'session_expired', {
      label: 'session_expired (from the sweep)',
      timeoutMs: world.sweepWaitMs,
    });
    console.log(`  live: session_expired at seq ${expiredEvent.seq}.`);

    const expiredSnap = await call<SessionSnapshot>('GET', `/v1/sessions/${expiringId}`, {
      token: teacher.token,
    });
    assert(expiredSnap.ended, 'the expired session should read as ended');
    const danaRow = expiredSnap.students.find((s) => s.studentId === dana.userId);
    assert(danaRow?.endedAt, "Dana's participation should be closed by the expiry");
    // And the phone that never heard a thing learns the truth from its own next
    // request — the response is the reconciliation channel.
    const danaAfter = await call<CheckInResponse>('POST', `/v1/sessions/${expiringId}/checkin`, {
      token: dana.token,
      body: { deviceTime: iso() },
    });
    assert(
      danaAfter.status === 'gone',
      `Dana's check-in after expiry should read gone, got ${danaAfter.status}`,
    );
    openSessionId = null;
    expiryStream.close();
    expiryStream = null;
    console.log(
      `the bell freed the phone by itself; Dana's next check-in reads "${danaAfter.status}".`,
    );

    console.log('\n✅ exit demo complete — every guarantee held.');
  } finally {
    stream?.close();
    expiryStream?.close();
    // Never leave a running session behind: the class allows only one, so a
    // crashed run would otherwise block the next one from starting.
    if (openSessionId && teacherToken) {
      try {
        await call<EndSessionResponse>('POST', `/v1/sessions/${openSessionId}/end`, {
          token: teacherToken,
        });
        console.log(`cleaned up: ended session ${openSessionId}`);
      } catch (err) {
        console.error(`could not clean up session ${openSessionId}:`, err);
      }
    }
    // Never let teardown replace the run's own diagnosis.
    await world.close().catch((err: unknown) => {
      console.error('could not close the demo world:', err);
    });
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ SIMULATION FAILED:', err);
  process.exit(1);
});
