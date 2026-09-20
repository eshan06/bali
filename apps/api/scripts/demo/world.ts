import { type Database, schools, users } from '@bali/db';
import { backdateLastSeen, backdateSessionEnd, makeTestDb } from '@bali/db/testing';
import { type MeResponse, type SessionSnapshot, SILENCE_THRESHOLD_MS } from '@bali/shared';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../../src/app.js';
import { createVerifier } from '../../src/auth/verify.js';
import type { Env } from '../../src/env.js';
import { type CognitoCredentials, fetchCognitoAccessToken } from './cognito.js';
import { type Call, createCall, normalizeBase } from './http.js';

/*
 * The seam between the two ways the exit demo runs.
 *
 * LOCAL (the default, `npm run demo`): an in-process server on a throwaway port
 * over an in-process Postgres, tokens minted against a stand-in issuer. Nothing
 * external, nothing to provision, and time is compressed by backdating rows so
 * the whole run takes seconds.
 *
 * REMOTE (`DEMO_API_URL=…`): the deployed API — Railway dev — with real Cognito
 * sign-ins. There is no database handle out here and there must not be one, so
 * the two things local mode fakes are done for real instead: actors provision
 * themselves through `GET /v1/me`, and time compression becomes *waiting*, which
 * is the honest version — it proves the real deployed sweep does the job, not a
 * sweep the script poked. That makes a remote run minutes long where a local one
 * is seconds; the incidents print progress while they wait.
 *
 * Everything else — every request the demo makes — is identical across the two,
 * which is the point: the exit demo proves the deployed API, not a rehearsal
 * of it.
 */

export type DemoMode = 'local' | 'remote';

export interface DemoActorSpec {
  /** Stable key: the log name and the suffix of this actor's env vars. */
  key: string;
  displayName: string;
  role: 'teacher' | 'student';
}

export interface DemoActor {
  key: string;
  displayName: string;
  /** The `users.id` the API knows this actor by — what events are attributed to. */
  userId: string;
  token: string;
}

export interface SweepResult {
  expired: number;
  wentSilent: number;
}

export interface DemoWorld {
  readonly mode: DemoMode;
  readonly base: string;
  /** How long an incident may wait for a sweep-produced event to appear. */
  readonly sweepWaitMs: number;
  /** Ensure every actor exists with the right role, and mint their tokens. */
  provision(actors: DemoActorSpec[]): Promise<Map<string, DemoActor>>;
  /**
   * Bring a live participation past the silence threshold. The teacher token is
   * needed because the only outside view of the server's own `last_seen_at` is
   * the owner-only snapshot.
   */
  compressSilence(where: {
    sessionId: string;
    studentId: string;
    teacherToken: string;
  }): Promise<void>;
  /** Bring a running session past its end time. */
  compressSessionEnd(where: { sessionId: string; endsAt: Date }): Promise<void>;
  /**
   * Run the minute sweep, or return null when this world cannot run it itself
   * and the deployment's own cron must — the caller then polls for the effect
   * rather than the count.
   */
  sweep(): Promise<SweepResult | null>;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Sleep, printing a countdown, so a multi-minute wait never looks like a hang. */
async function waitWithNotice(ms: number, label: string): Promise<void> {
  if (ms <= 0) return;
  const started = Date.now();
  console.log(`  …waiting ${Math.ceil(ms / 1000)}s — ${label}`);
  for (;;) {
    const left = ms - (Date.now() - started);
    if (left <= 0) return;
    await sleep(Math.min(left, 15_000));
    const stillLeft = ms - (Date.now() - started);
    if (stillLeft > 0) console.log(`  …${Math.ceil(stillLeft / 1000)}s left`);
  }
}

// ---------------------------------------------------------------- local mode

const LOCAL_INTERNAL_KEY = 'sim-internal-key-0123456789';
const LOCAL_ISSUER = 'https://sim-issuer.bali.local/pool';
const LOCAL_AUDIENCE = 'sim-app-client';

export async function createLocalWorld(): Promise<DemoWorld> {
  // A migrated, isolated database: PGlite by default, real Postgres when
  // TEST_DATABASE_URL is set (dropped on close either way).
  const { db, close: closeDb } = await makeTestDb();

  // The Cognito stand-in: mint tokens the real verifier accepts, no network.
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'sim-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const getKey = createLocalJWKSet({ keys: [publicJwk] });
  const verifier = createVerifier({
    issuer: LOCAL_ISSUER,
    audience: LOCAL_AUDIENCE,
    getKey,
  });
  const tokenFor = (sub: string): Promise<string> =>
    new SignJWT({ token_use: 'access', client_id: LOCAL_AUDIENCE })
      .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
      .setSubject(sub)
      .setIssuer(LOCAL_ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    SHUTDOWN_DEADLINE_MS: 8000,
    AUTH_ISSUER: LOCAL_ISSUER,
    AUTH_JWKS_URI: `${LOCAL_ISSUER}/.well-known/jwks.json`,
    AUTH_AUDIENCE: LOCAL_AUDIENCE,
    DATABASE_URL: 'postgres://unused@localhost:5432/sim',
    INTERNAL_API_KEY: LOCAL_INTERNAL_KEY,
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
  const call = createCall(base);

  return {
    mode: 'local',
    base,
    // The sweep runs inline here, so its effects are already committed.
    sweepWaitMs: 5_000,
    provision: (specs) => seedLocalActors(db, specs, tokenFor),
    compressSilence: ({ sessionId, studentId }) =>
      backdateLastSeen(
        db,
        { sessionId, studentId },
        new Date(Date.now() - SILENCE_THRESHOLD_MS - 5_000),
      ),
    compressSessionEnd: (where) =>
      backdateSessionEnd(db, { sessionId: where.sessionId }, new Date(Date.now() - 1_000)),
    sweep: () => call<SweepResult>('POST', '/internal/sweep', { internalKey: LOCAL_INTERNAL_KEY }),
    close: async () => {
      await app.close();
      await closeDb();
    },
  };
}

/**
 * Local mode seeds its own cast directly: one school, a provisioned teacher, and
 * the students. Teachers have no self-serve path by design (the role flip is out
 * of band), so seeding is the only way to have one at all.
 */
async function seedLocalActors(
  db: Database,
  specs: DemoActorSpec[],
  tokenFor: (sub: string) => Promise<string>,
): Promise<Map<string, DemoActor>> {
  const [school] = await db.insert(schools).values({ name: 'Demo School' }).returning();
  if (!school) throw new Error('could not create the demo school');

  const actors = new Map<string, DemoActor>();
  for (const spec of specs) {
    const cognitoId = `sim-${spec.key}`;
    const [row] = await db
      .insert(users)
      .values({
        cognitoId,
        role: spec.role,
        schoolId: school.id,
        displayName: spec.displayName,
      })
      .returning();
    if (!row) throw new Error(`could not create the demo user ${spec.key}`);
    actors.set(spec.key, {
      key: spec.key,
      displayName: spec.displayName,
      userId: row.id,
      token: await tokenFor(cognitoId),
    });
  }
  return actors;
}

// --------------------------------------------------------------- remote mode

export interface RemoteConfig {
  base: string;
  region: string;
  clientId: string;
  /** Cognito credentials per actor key. */
  credentials: Map<string, CognitoCredentials>;
  /**
   * The deployment's sweep key, when the operator supplied it. Optional on
   * purpose: the key lives in the platform's service variables, and the demo is
   * perfectly able to wait for the deployment's own cron instead.
   */
  internalKey?: string;
  sweepWaitMs: number;
}

const DEFAULT_REMOTE_SWEEP_WAIT_MS = 150_000; // a per-minute cron, plus margin

/** The env var this actor's Cognito username comes from. */
export function usernameVar(key: string): string {
  return `DEMO_USER_${key.toUpperCase()}`;
}

/** The env var this actor's password comes from (falling back to DEMO_PASSWORD). */
export function passwordVar(key: string): string {
  return `DEMO_PASSWORD_${key.toUpperCase()}`;
}

/**
 * Read remote configuration out of the environment, reporting *every* missing
 * variable at once. Credentials only ever come from the environment — never a
 * flag, never a file in the repo — so nothing here can end up in git or in a
 * log line.
 */
export function resolveRemoteConfig(env: NodeJS.ProcessEnv, specs: DemoActorSpec[]): RemoteConfig {
  const missing: string[] = [];
  const apiUrl = env.DEMO_API_URL?.trim();
  if (!apiUrl) missing.push('DEMO_API_URL');
  const clientId = env.DEMO_COGNITO_CLIENT_ID?.trim();
  if (!clientId) missing.push('DEMO_COGNITO_CLIENT_ID');

  const sharedPassword = env.DEMO_PASSWORD?.trim();
  const credentials = new Map<string, CognitoCredentials>();
  for (const spec of specs) {
    const username = env[usernameVar(spec.key)]?.trim();
    const password = env[passwordVar(spec.key)]?.trim() ?? sharedPassword;
    if (!username) missing.push(usernameVar(spec.key));
    if (!password) missing.push(`${passwordVar(spec.key)} (or DEMO_PASSWORD)`);
    if (username && password) credentials.set(spec.key, { username, password });
  }

  if (missing.length > 0 || !apiUrl || !clientId) {
    throw new Error(
      `the deployed-API demo needs these environment variables: ${missing.join(', ')}. ` +
        'See the README ("Running it against a deployed API").',
    );
  }

  const sweepWaitRaw = env.DEMO_SWEEP_WAIT_MS?.trim();
  const sweepWaitMs = sweepWaitRaw ? Number(sweepWaitRaw) : DEFAULT_REMOTE_SWEEP_WAIT_MS;
  if (!Number.isFinite(sweepWaitMs) || sweepWaitMs <= 0) {
    throw new Error(
      `DEMO_SWEEP_WAIT_MS must be a positive number of milliseconds, got ${sweepWaitRaw ?? ''}`,
    );
  }

  return {
    base: normalizeBase(apiUrl),
    region: env.DEMO_COGNITO_REGION?.trim() ?? env.AWS_REGION?.trim() ?? 'us-east-1',
    clientId,
    credentials,
    internalKey: env.DEMO_INTERNAL_KEY?.trim() || undefined,
    sweepWaitMs,
  };
}

export interface RemoteWorldDeps {
  /** Injection point for tests, so the sign-in path runs without reaching AWS. */
  cognitoFetch?: typeof fetch;
}

export function createRemoteWorld(config: RemoteConfig, deps: RemoteWorldDeps = {}): DemoWorld {
  const call = createCall(config.base);

  return {
    mode: 'remote',
    base: config.base,
    sweepWaitMs: config.sweepWaitMs,
    provision: (specs) => signInRemoteActors(call, config, specs, deps.cognitoFetch),

    /*
     * No database out here, so silence is reached by actually being quiet. The
     * snapshot reports the server's own `last_seen_at` (rule 1 — the server
     * stamps it, never the device), so the wait is computed from the server's
     * clock rather than this machine's.
     */
    compressSilence: async ({ sessionId, studentId, teacherToken }) => {
      const snap = await call<SessionSnapshot>('GET', `/v1/sessions/${sessionId}`, {
        token: teacherToken,
      });
      const row = snap.students.find((s) => s.studentId === studentId);
      const lastSeen = row?.lastSeenAt ? new Date(row.lastSeenAt).getTime() : Date.now();
      const quietUntil = lastSeen + SILENCE_THRESHOLD_MS + 5_000;
      await waitWithNotice(
        quietUntil - Date.now(),
        'the phone must really go quiet (90s threshold)',
      );
    },

    compressSessionEnd: async ({ endsAt }) => {
      await waitWithNotice(
        endsAt.getTime() + 2_000 - Date.now(),
        'the session must reach its end time',
      );
    },

    sweep: async () => {
      if (!config.internalKey) return null; // the deployment's cron will do it
      return call<SweepResult>('POST', '/internal/sweep', { internalKey: config.internalKey });
    },

    close: () => Promise.resolve(),
  };
}

/**
 * Remote mode has no way to create rows, and must not: students provision
 * themselves on their first `GET /v1/me` exactly as a real phone does, and the
 * teacher must already have been flipped to `teacher` out of band. A student
 * token where a teacher is expected is the single most likely misconfiguration,
 * so it fails with the fix rather than a bare 403 later.
 */
async function signInRemoteActors(
  call: Call,
  config: RemoteConfig,
  specs: DemoActorSpec[],
  cognitoFetch?: typeof fetch,
): Promise<Map<string, DemoActor>> {
  const actors = new Map<string, DemoActor>();
  for (const spec of specs) {
    const credentials = config.credentials.get(spec.key);
    if (!credentials) throw new Error(`no credentials resolved for ${spec.key}`);
    const token = await fetchCognitoAccessToken(
      { region: config.region, clientId: config.clientId, fetchImpl: cognitoFetch },
      credentials,
    );
    const me = await call<MeResponse>('GET', '/v1/me', { token });
    if (me.user.role !== spec.role) {
      throw new Error(
        `${credentials.username} signed in as "${me.user.role}" but the demo needs "${spec.role}". ` +
          (spec.role === 'teacher'
            ? 'Every first sign-in provisions a student, so the demo teacher needs the one-time ' +
              `role flip: UPDATE users SET role = 'teacher' WHERE id = '${me.user.id}';`
            : 'Use a different account for this actor.'),
      );
    }
    actors.set(spec.key, {
      key: spec.key,
      displayName: me.user.displayName ?? spec.displayName,
      userId: me.user.id,
      token,
    });
  }
  return actors;
}

/** Build whichever world the environment selects: remote when DEMO_API_URL is set. */
export async function createWorld(
  env: NodeJS.ProcessEnv,
  specs: DemoActorSpec[],
): Promise<DemoWorld> {
  if (!env.DEMO_API_URL?.trim()) return createLocalWorld();
  return createRemoteWorld(resolveRemoteConfig(env, specs));
}
