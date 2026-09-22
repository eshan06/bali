import { type Database, startSession, tapIn, users } from '@bali/db';
import { backdateLastSeen } from '@bali/db/testing';
import { SILENCE_THRESHOLD_MS } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  createRemoteWorld,
  type DemoActorSpec,
  provisioningSql,
  type RemoteConfig,
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

  it('prints an INSERT that actually runs — schools.id has no DB default', async () => {
    // The hint used to omit `id`, so an operator following it hit
    // `null value in column "id" ... violates not-null constraint` — the exact
    // trap the message exists to prevent. Pinning the column list and a real
    // UUIDv7 keeps the instruction runnable.
    const world = createRemoteWorld(remoteConfig(), { cognitoFetch: stubCognito() });

    const err = await world.provision([TEACHER]).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('INSERT INTO schools (id, name)');
    const minted = /SELECT '([0-9a-f-]{36})'/.exec(err?.message ?? '')?.[1];
    expect(minted).toBeDefined();
    // Version nibble 7: the id must be a UUIDv7 like every other row (decision 2).
    expect(minted?.[14]).toBe('7');
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

  it('refuses a non-finite wait rather than spinning on sleep(NaN)', async () => {
    const world = createRemoteWorld(remoteConfig(), { cognitoFetch: stubCognito() });

    // An unparseable timestamp makes the computed duration NaN, which slips past
    // both a `<= 0` and a `> max` guard and would otherwise spin forever.
    await expect(
      world.compressSessionEnd({
        sessionId: 'session-1',
        startedAt: new Date(),
        endsAt: new Date('not a date'),
      }),
    ).rejects.toThrow(/non-finite/);
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

describe('provisioningSql', () => {
  const USER = '01a0bb08-563f-7050-8d19-48b7b3150865';

  it('supplies an id, because schools.id has no database default', () => {
    const sql = provisioningSql(USER, 'role-and-school');

    expect(sql).toContain('INSERT INTO schools (id, name)');
    const minted = /SELECT '([0-9a-f-]{36})'/.exec(sql)?.[1];
    expect(minted?.[14]).toBe('7'); // UUIDv7, like every other row (decision 2)
  });

  it('guards the insert so re-running leaves an existing school alone', () => {
    expect(provisioningSql(USER, 'school')).toContain('WHERE NOT EXISTS (SELECT 1 FROM schools)');
  });

  it('never emits a bare UPDATE that would silently set NULL', () => {
    // `SET school_id = (SELECT …)` with no INSERT reports "UPDATE 1" against an
    // empty table and leaves the operator believing they had complied.
    for (const what of ['role-and-school', 'school'] as const) {
      const sql = provisioningSql(USER, what);
      expect(sql.indexOf('INSERT INTO schools')).toBeLessThan(sql.indexOf('UPDATE users'));
      expect(sql).toContain('ORDER BY created_at LIMIT 1');
      expect(sql).toContain(USER);
    }
  });

  it('flips the role only when the role is what is missing', () => {
    expect(provisioningSql(USER, 'role-and-school')).toContain("role = 'teacher'");
    expect(provisioningSql(USER, 'school')).not.toContain("role = 'teacher'");
  });
});
