import { schools, users } from '@bali/db';
import { backdateLastSeen, makeTestDb } from '@bali/db/testing';
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
  type RefocusResponse,
  SILENCE_THRESHOLD_MS,
  type SessionSnapshot,
  type StartSessionResponse,
  type TapResponse,
  type UnlockResponse,
} from '@bali/shared';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../src/app.js';
import { createVerifier } from '../src/auth/verify.js';
import type { Env } from '../src/env.js';

/*
 * The Phase-2 exit demo: a phone + classroom simulator driving the REAL HTTP API
 * (routes, auth, the transition engine) over a real socket — the difference from
 * the Phase-1 walk is that nothing here calls the engine directly; every actor
 * speaks HTTP, the way the phones and the teacher's browser do.
 *
 * It runs end-to-end with NO external services: a local in-process server on a
 * throwaway port, backed by an in-process Postgres (PGlite) — or a real one when
 * TEST_DATABASE_URL is set, which is how the exit demo is run against real
 * Postgres alongside a browser on the portal. Tokens are minted against an
 * in-process stand-in for Cognito (an RSA keypair whose public half a local JWKS
 * serves), exactly as the auth tests do, so the production verifier accepts them
 * with no live pool. A Railway-dev run against real Cognito instead needs dev
 * test students provisioned AWS-side (an author action; see the README).
 *
 * The script is self-checking: each incident asserts the guarantee it exists to
 * prove, so a regression makes `npm run demo` exit non-zero rather than lie. It
 * is also Phase 4's load-gate seed. Run with `npm run demo`.
 */

function line(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const iso = (): string => new Date().toISOString();

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error('expected a row');
  return r;
}

async function main(): Promise<void> {
  // A migrated, isolated database: PGlite by default, real Postgres when
  // TEST_DATABASE_URL is set (dropped on close either way).
  const { db, close: closeDb } = await makeTestDb();

  // The Cognito stand-in: mint tokens the real verifier accepts, no network.
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'sim-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const ISSUER = 'https://sim-issuer.bali.local/pool';
  const AUDIENCE = 'sim-app-client';
  const getKey = createLocalJWKSet({ keys: [publicJwk] });
  const verifier = createVerifier({ issuer: ISSUER, audience: AUDIENCE, getKey });
  const tokenFor = (sub: string): Promise<string> =>
    new SignJWT({ token_use: 'access', client_id: AUDIENCE })
      .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

  const INTERNAL_KEY = 'sim-internal-key-0123456789';
  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    SHUTDOWN_DEADLINE_MS: 8000,
    AUTH_ISSUER: ISSUER,
    AUTH_JWKS_URI: `${ISSUER}/.well-known/jwks.json`,
    AUTH_AUDIENCE: AUDIENCE,
    DATABASE_URL: 'postgres://unused@localhost:5432/sim',
    INTERNAL_API_KEY: INTERNAL_KEY,
  };
  const app = buildApp(env, {
    db,
    verifyToken: verifier,
    // A brisk re-poll so the feed reflects writes promptly in the demo.
    stream: { repollMs: 100, heartbeatMs: 1000, maxPerTeacher: 5 },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${addr.port}`;

  interface CallOpts {
    token?: string;
    internalKey?: string;
    body?: unknown;
    expectStatus?: number;
  }
  async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.internalKey) headers['x-internal-key'] = opts.internalKey;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const want = opts.expectStatus ?? 200;
    if (res.status !== want) {
      throw new Error(`${method} ${path} → ${res.status} (wanted ${want}): ${text}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  try {
    line('the accounts (a school, a provisioned teacher, four students)');
    const school = one(await db.insert(schools).values({ name: 'Demo School' }).returning());
    await db
      .insert(users)
      .values({
        cognitoId: 'sim-teacher',
        role: 'teacher',
        schoolId: school.id,
        displayName: 'Ms. Rivera',
      })
      .returning();
    const studentDefs = [
      { sub: 'sim-ana', name: 'Ana' }, // emergency unlock, then refocus
      { sub: 'sim-ben', name: 'Ben' }, // goes silent, then comes back
      { sub: 'sim-cal', name: 'Cal' }, // removed mid-session, then unlocks anyway
      { sub: 'sim-dana', name: 'Dana' }, // stays focused the whole time
    ];
    const studentIds = new Map<string, string>();
    for (const s of studentDefs) {
      const row = one(
        await db
          .insert(users)
          .values({ cognitoId: s.sub, role: 'student', schoolId: school.id, displayName: s.name })
          .returning(),
      );
      studentIds.set(s.sub, row.id);
    }
    const teacherToken = await tokenFor('sim-teacher');
    const tokens = new Map<string, string>();
    for (const s of studentDefs) tokens.set(s.sub, await tokenFor(s.sub));
    console.log('Ms. Rivera teaches; Ana, Ben, Cal, and Dana have phones.');

    line('the teacher sets up a class and a block (over HTTP)');
    const klass = await call<ClassDetail>('POST', '/v1/classes', {
      token: teacherToken,
      body: { name: 'Period 1' },
    });
    const block = await call<BlockDetail>('POST', '/v1/blocks', {
      token: teacherToken,
      body: { tagId: 'SIM-BLOCK-1' },
    });
    console.log(`class "Period 1" (join code ${klass.joinCode}); block tag ${block.tagId}`);

    line('the students join by code');
    const enrollmentIds = new Map<string, string>();
    for (const s of studentDefs) {
      const j = await call<EnrollmentJoinResponse>('POST', '/v1/enrollments', {
        token: tokens.get(s.sub),
        body: { joinCode: klass.joinCode, eventId: randomUUID(), deviceTime: iso() },
      });
      assert(
        j.outcome === 'joined' || j.outcome === 'already_enrolled',
        `${s.name} join outcome ${j.outcome}`,
      );
      enrollmentIds.set(s.sub, j.enrollmentId);
    }
    console.log(`${studentDefs.length} students enrolled.`);

    line('8:00am — the teacher starts the session');
    const started = await call<StartSessionResponse>('POST', `/v1/classes/${klass.id}/sessions`, {
      token: teacherToken,
      body: { durationMinutes: 25 },
    });
    const sid = started.session.id;
    console.log(`session ${started.outcome} (${sid})`);

    line('the bell — every phone taps the block');
    for (const s of studentDefs) {
      const t = await call<TapResponse>('POST', '/v1/taps', {
        token: tokens.get(s.sub),
        body: { tagId: block.tagId, eventId: randomUUID(), deviceTime: iso() },
      });
      assert(t.outcome === 'joined', `${s.name} tap outcome ${t.outcome}`);
      assert(t.state === 'focused', `${s.name} should be focused, got ${String(t.state)}`);
    }
    // A first heartbeat from each phone — the engine answers "live", emits nothing.
    for (const s of studentDefs) {
      const c = await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
        token: tokens.get(s.sub),
        body: { deviceTime: iso() },
      });
      assert(c.status === 'live', `${s.name} check-in status ${c.status}`);
    }
    console.log('all four are focused and checking in.');

    line('8:05am — Ana hits emergency unlock, then refocuses');
    const anaUnlock = await call<UnlockResponse>('POST', `/v1/sessions/${sid}/unlock`, {
      token: tokens.get('sim-ana'),
      body: { eventId: randomUUID(), deviceTime: iso() },
    });
    assert(anaUnlock.outcome === 'applied', `Ana unlock outcome ${anaUnlock.outcome}`);
    assert(
      anaUnlock.state === 'unlocked',
      `Ana should be unlocked, got ${String(anaUnlock.state)}`,
    );
    const anaRefocus = await call<RefocusResponse>('POST', `/v1/sessions/${sid}/refocus`, {
      token: tokens.get('sim-ana'),
      body: { eventId: randomUUID(), deviceTime: iso() },
    });
    assert(anaRefocus.state === 'focused', `Ana should be refocused, got ${anaRefocus.state}`);
    console.log('Ana: focused → unlocked → focused.');

    line('8:07am — Ben goes quiet (a phone in a bag)');
    // Time-compression, the one simulation device: rather than idle for the real
    // 90s silence threshold, backdate Ben's last contact so the very next sweep —
    // exactly what the per-minute cron runs — opens his silence episode now.
    const benId = studentIds.get('sim-ben')!;
    await backdateLastSeen(
      db,
      { sessionId: sid, studentId: benId },
      new Date(Date.now() - SILENCE_THRESHOLD_MS - 5_000),
    );
    const sweep = await call<{ expired: number; wentSilent: number }>('POST', '/internal/sweep', {
      internalKey: INTERNAL_KEY,
    });
    assert(sweep.wentSilent >= 1, `sweep should open ≥1 silence episode, got ${sweep.wentSilent}`);
    const afterSilence = await call<EventsPage>('GET', `/v1/sessions/${sid}/events?after=0`, {
      token: teacherToken,
    });
    const benSilent = afterSilence.events.filter(
      (e) => e.type === 'went_silent' && e.userId === benId,
    );
    assert(benSilent.length === 1, `expected one went_silent for Ben, got ${benSilent.length}`);
    console.log(`sweep opened ${sweep.wentSilent} silence episode(s); Ben is marked silent.`);

    line('8:08am — Ben comes back');
    const benBack = await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
      token: tokens.get('sim-ben'),
      body: { deviceTime: iso() },
    });
    assert(benBack.status === 'live', `Ben check-in status ${benBack.status}`);
    const afterReturn = await call<EventsPage>('GET', `/v1/sessions/${sid}/events?after=0`, {
      token: teacherToken,
    });
    const benCameBack = afterReturn.events.filter(
      (e) => e.type === 'came_back' && e.userId === benId,
    );
    assert(benCameBack.length === 1, `expected one came_back for Ben, got ${benCameBack.length}`);
    console.log('Ben checked in — one came_back, and the plain heartbeats emitted nothing.');

    line('8:10am — Cal is removed mid-session, then his phone unlocks anyway (ISSUES #2)');
    const calId = studentIds.get('sim-cal')!;
    const removal = await call<EndEnrollmentResponse>(
      'DELETE',
      `/v1/enrollments/${enrollmentIds.get('sim-cal')!}`,
      { token: teacherToken },
    );
    assert(removal.reason === 'removed_from_class', `Cal removal reason ${removal.reason}`);
    assert(removal.endedParticipation, 'Cal was live, so his participation should end');
    // Cal's phone hasn't heard yet and hits emergency unlock. The contract: it is
    // never a 404 and never discarded — it is recorded with a note.
    const calUnlock = await call<UnlockResponse>('POST', `/v1/sessions/${sid}/unlock`, {
      token: tokens.get('sim-cal'),
      body: { eventId: randomUUID(), deviceTime: iso() },
    });
    assert(calUnlock.outcome === 'recorded', `Cal unlock outcome ${calUnlock.outcome}`);
    assert(
      calUnlock.recordedAs === 'no_live_participation',
      `Cal unlock recordedAs ${String(calUnlock.recordedAs)}`,
    );
    // His next check-in learns he is gone.
    const calCheck = await call<CheckInResponse>('POST', `/v1/sessions/${sid}/checkin`, {
      token: tokens.get('sim-cal'),
      body: { deviceTime: iso() },
    });
    assert(calCheck.status === 'gone', `Cal check-in status ${calCheck.status}`);
    console.log(
      'Cal removed; his unlock was recorded (no_live_participation), next check-in: gone.',
    );

    line('the live grid (the teacher snapshot, derived like the portal)');
    const snap = await call<SessionSnapshot>('GET', `/v1/sessions/${sid}`, { token: teacherToken });
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
    assert(display.get(studentIds.get('sim-ana')!) === 'focused', 'Ana should read focused');
    assert(display.get(studentIds.get('sim-ben')!) === 'focused', 'Ben should read focused again');
    // Cal was removed, so he drops off the active roster a fresh snapshot builds
    // from; the teacher's live grid learned of his exit from the enrollment_removed
    // event on the feed (below), not from this roster.
    assert(!display.has(calId), 'Cal, removed, is no longer on the active roster');
    assert(display.get(studentIds.get('sim-dana')!) === 'focused', 'Dana should read focused');
    console.log('  (Cal was removed — off the roster; his exit is in the event log below.)');

    line('the permanent event log (rule 6)');
    const log = await call<EventsPage>('GET', `/v1/sessions/${sid}/events?after=0`, {
      token: teacherToken,
    });
    const names = new Map<string, string>();
    for (const s of studentDefs) names.set(studentIds.get(s.sub)!, s.name);
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

    line('8:25am — the session ends');
    const ended = await call<EndSessionResponse>('POST', `/v1/sessions/${sid}/end`, {
      token: teacherToken,
    });
    assert(ended.outcome === 'ended', `end outcome ${ended.outcome}`);
    console.log(`ended; participations closed: ${ended.endedParticipations}`);

    console.log('\n✅ exit demo complete — every guarantee held.');
  } finally {
    await app.close();
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ SIMULATION FAILED:', err);
  process.exit(1);
});
