import { type Database, startSession, tapIn, users } from '@bali/db';
import { backdateLastSeen } from '@bali/db/testing';
import { SILENCE_THRESHOLD_MS } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { normalizeBase } from '../scripts/demo/http.js';
import {
  createRemoteWorld,
  type DemoActorSpec,
  passwordVar,
  type RemoteConfig,
  resolveRemoteConfig,
  usernameVar,
} from '../scripts/demo/world.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer } from './helpers/test-issuer.js';

/*
 * The deployed-API half of the exit demo. Remote mode is the one path that
 * cannot be rehearsed by `npm run demo`, so it is pinned here against a real
 * server on a real socket: actors provision themselves through `GET /v1/me`
 * exactly as phones do, a teacher who was never flipped fails with the fix in
 * the message, and the sweep is either run or deliberately left to the
 * deployment's cron.
 *
 * The sign-in itself is stubbed — reaching AWS from a test would make the suite
 * depend on a live pool — but everything it feeds is real.
 */

const TEACHER: DemoActorSpec = { key: 'teacher', displayName: 'Ms. Rivera', role: 'teacher' };
const ANA: DemoActorSpec = { key: 'ana', displayName: 'Ana', role: 'student' };

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let base: string;
let issuer: Awaited<ReturnType<typeof makeTestIssuer>>;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  app = buildApp(testEnv, {
    db,
    verifyToken: issuer.verifier,
    stream: { repollMs: 80, heartbeatMs: 1000, maxPerTeacher: 5 },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

/**
 * A stand-in for Cognito that hands back a token the API's verifier accepts.
 * The username's local part is the Cognito subject, so a test can line a user up
 * with a seeded row.
 */
function stubCognito(): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { AuthParameters: { USERNAME: string } };
    const sub = body.AuthParameters.USERNAME.split('@')[0] ?? '';
    const token = await issuer.sign({ sub });
    return new Response(JSON.stringify({ AuthenticationResult: { AccessToken: token } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

function remoteConfig(overrides: Partial<RemoteConfig> = {}): RemoteConfig {
  return {
    base,
    region: 'us-east-1',
    clientId: 'app-client-id',
    credentials: new Map([
      [TEACHER.key, { username: 'demo-teacher@example.test', password: 'pw' }],
      [ANA.key, { username: 'demo-ana@example.test', password: 'pw' }],
    ]),
    sweepWaitMs: 5_000,
    liveWaitMs: 15_000,
    ...overrides,
  };
}

describe('resolveRemoteConfig', () => {
  const specs = [TEACHER, ANA];

  const complete = (): NodeJS.ProcessEnv => ({
    DEMO_API_URL: 'https://api.example.test',
    DEMO_COGNITO_CLIENT_ID: 'client-id',
    DEMO_PASSWORD: 'shared-password',
    [usernameVar('teacher')]: 'teacher@example.test',
    [usernameVar('ana')]: 'ana@example.test',
  });

  it('reads credentials from the environment, with a shared password fallback', () => {
    const config = resolveRemoteConfig(complete(), specs);

    expect(config.base).toBe('https://api.example.test');
    expect(config.clientId).toBe('client-id');
    expect(config.credentials.get('ana')).toEqual({
      username: 'ana@example.test',
      password: 'shared-password',
    });
    // Nothing to run the sweep with, so the deployment's own cron must.
    expect(config.internalKey).toBeUndefined();
  });

  it('lets a per-actor password override the shared one', () => {
    const env = { ...complete(), [passwordVar('ana')]: 'ana-only' };

    expect(resolveRemoteConfig(env, specs).credentials.get('ana')?.password).toBe('ana-only');
  });

  it('names every missing variable at once, not just the first', () => {
    const env: NodeJS.ProcessEnv = { DEMO_API_URL: 'https://api.example.test' };

    const err = (() => {
      try {
        resolveRemoteConfig(env, specs);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(err?.message).toContain('DEMO_COGNITO_CLIENT_ID');
    expect(err?.message).toContain(usernameVar('teacher'));
    expect(err?.message).toContain(usernameVar('ana'));
    expect(err?.message).toContain('DEMO_PASSWORD');
  });

  it('rejects a non-numeric sweep wait rather than silently waiting forever', () => {
    expect(() => resolveRemoteConfig({ ...complete(), DEMO_SWEEP_WAIT_MS: 'soon' }, specs)).toThrow(
      /DEMO_SWEEP_WAIT_MS/,
    );
  });

  it('defaults the region to AWS_REGION when the demo does not set one', () => {
    expect(resolveRemoteConfig({ ...complete(), AWS_REGION: 'eu-west-2' }, specs).region).toBe(
      'eu-west-2',
    );
  });

  it('falls back past an EMPTY region rather than building a hostless endpoint', () => {
    // '' is not nullish, so `??` would keep it and produce
    // https://cognito-idp..amazonaws.com — a DNS error instead of a fallback.
    const env = { ...complete(), DEMO_COGNITO_REGION: '', AWS_REGION: 'eu-west-2' };

    expect(resolveRemoteConfig(env, specs).region).toBe('eu-west-2');
  });

  it('falls back past an EMPTY per-actor password to the shared one', () => {
    const env = { ...complete(), [passwordVar('ana')]: '' };

    expect(resolveRemoteConfig(env, specs).credentials.get('ana')?.password).toBe(
      'shared-password',
    );
  });
});

describe('normalizeBase', () => {
  it('drops a trailing slash so paths concatenate cleanly', () => {
    expect(normalizeBase('https://api.example.test/')).toBe('https://api.example.test');
  });

  it('assumes https for a bare host, the shape a platform URL variable usually has', () => {
    expect(normalizeBase('api.example.test')).toBe('https://api.example.test');
  });

  it.each(['http://', 'https://', 'not a url', '', '   '])(
    'refuses %o rather than silently pointing the demo somewhere else',
    (raw) => {
      expect(() => normalizeBase(raw)).toThrow(/not a usable API base URL/);
    },
  );

  it('keeps an explicit port, so a local server is addressable', () => {
    expect(normalizeBase('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
  });
});

describe('the remote world, against a real server', () => {
  it('provisions students through GET /v1/me, exactly as a phone does', async () => {
    const { school } = await seedClassroom(db, 'remote-a');
    // Only the teacher is seeded — the student must not exist yet.
    await db.insert(users).values({
      cognitoId: 'demo-teacher',
      role: 'teacher',
      schoolId: school.id,
      displayName: 'Ms. Rivera',
    });

    const world = createRemoteWorld(remoteConfig(), { cognitoFetch: stubCognito() });
    const actors = await world.provision([TEACHER, ANA]);

    expect(actors.get('teacher')?.userId).toMatch(/^[0-9a-f-]{36}$/);
    // Ana had no row before this call; her first /v1/me created it as a student.
    expect(actors.get('ana')?.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(actors.get('ana')?.userId).not.toBe(actors.get('teacher')?.userId);
  });

  it('fails with the role-flip fix when the demo teacher was never flipped', async () => {
    // No teacher row seeded: the first /v1/me provisions a *student*, which is
    // the single most likely misconfiguration of a fresh deployment.
    const world = createRemoteWorld(remoteConfig(), { cognitoFetch: stubCognito() });

    const err = await world.provision([TEACHER]).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('signed in as "student"');
    expect(err?.message).toContain("UPDATE users SET role = 'teacher'");
  });

  it('runs the sweep itself when given the key', async () => {
    const world = createRemoteWorld(remoteConfig({ internalKey: testEnv.INTERNAL_API_KEY }), {
      cognitoFetch: stubCognito(),
    });

    await expect(world.sweep()).resolves.toEqual({ expired: 0, wentSilent: 0 });
  });

  it('leaves the sweep to the deployment when no key is configured', async () => {
    const world = createRemoteWorld(remoteConfig(), { cognitoFetch: stubCognito() });

    // null is the signal to wait for the cron's effect rather than a count.
    await expect(world.sweep()).resolves.toBeNull();
  });

  it('reads last contact from the server snapshot, and waits no longer than it must', async () => {
    const { teacher, student, klass } = await seedClassroom(db, 'remote-b');
    const started = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 600_000),
    });
    await tapIn(db, {
      sessionId: started.session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    // Already quiet for longer than the threshold, so there is nothing to wait for.
    await backdateLastSeen(
      db,
      { sessionId: started.session.id, studentId: student.id },
      new Date(Date.now() - SILENCE_THRESHOLD_MS - 30_000),
    );

    const world = createRemoteWorld(remoteConfig(), { cognitoFetch: stubCognito() });
    const teacherToken = await issuer.sign({ sub: teacher.cognitoId });

    const before = Date.now();
    await world.compressSilence({
      sessionId: started.session.id,
      studentId: student.id,
      teacherToken,
    });

    expect(Date.now() - before).toBeLessThan(3_000);
  });
});
