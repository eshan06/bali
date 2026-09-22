import { type Database, schools, startSession, tapIn, users } from '@bali/db';
import { backdateLastSeen } from '@bali/db/testing';
import { SILENCE_THRESHOLD_MS } from '@bali/shared';
import { eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  /** The one wording of the "run both" guidance, shared by the recipe and the README. */
  const RUN_BOTH =
    '-- Run both: with no live school the UPDATE attaches nothing and reports "UPDATE 0".';

  /**
   * The statements as an operator meets them: one paste at a time, which is
   * also the only way to paste just one half of the recipe.
   *
   * Splitting on a bare `;` is exact for what the builder emits today — the only
   * literals are a minted UUID, `'Demo School'` and `'teacher'`. Put a semicolon
   * inside a literal (a configurable school name) and this hands fragments to
   * the database, and these tests fail as syntax errors instead of as the
   * assertions they are: split on `;\n` if that day comes.
   */
  function statementsOf(recipe: string): string[] {
    return recipe
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
  }

  async function run(recipe: string): Promise<void> {
    for (const statement of statementsOf(recipe)) await db.execute(sql.raw(statement));
  }

  async function makeUser(cognitoId: string, role: 'student' | 'teacher') {
    const [row] = await db.insert(users).values({ cognitoId, role }).returning();
    if (row === undefined) throw new Error('expected a row');
    return row;
  }

  async function reread(id: string) {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    if (row === undefined) throw new Error('expected a row');
    return row;
  }

  it('supplies an id, because schools.id has no database default', () => {
    const sql = provisioningSql(USER, 'role-and-school');

    expect(sql).toContain('INSERT INTO schools (id, name)');
    const minted = /SELECT '([0-9a-f-]{36})'/.exec(sql)?.[1];
    expect(minted?.[14]).toBe('7'); // UUIDv7, like every other row (decision 2)
  });

  it('guards the insert so re-running leaves an existing school alone', () => {
    expect(provisioningSql(USER, 'school')).toContain('WHERE NOT EXISTS (SELECT 1 FROM schools');
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

  it('skips soft-removed schools, since nothing is really deleted', () => {
    // A database whose only school was retired would otherwise fail the guard,
    // skip the insert, and attach the teacher to the retired school (decision 3).
    const sql = provisioningSql(USER, 'role-and-school');

    expect(sql).toContain('FROM schools WHERE removed_at IS NULL)');
    expect(sql).toContain('WHERE removed_at IS NULL ORDER BY created_at LIMIT 1');
  });

  it('is the same recipe the README prints — the fourth copy cannot drift', async () => {
    // Consolidating the three in-code copies left the README hand-maintained,
    // which is the same drift this builder exists to end. This pins it.
    const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
    const fence = [...readme.matchAll(/```sql\n([\s\S]*?)```/g)]
      .map((m) => m[1] ?? '')
      .find((block) => block.includes('INSERT INTO schools'));
    expect(fence).toBeDefined();

    const normalize = (sql: string) =>
      sql
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const built = provisioningSql('<their id>', 'role-and-school').replace(
      /'[0-9a-f-]{36}'/,
      "'<uuidv7>'",
    );

    expect(normalize(fence ?? '')).toBe(normalize(built));
  });

  it('tells the operator to run both, since a lone UPDATE is now a no-op', () => {
    // The guard made the half-paste honest but silent. Operator-facing guidance
    // that nothing pins is how this whole line of fixes started, so: pinned —
    // and pinned as the whole sentence, because the earlier draft promised
    // `UPDATE 0` unconditionally. On the `school` path a deployment may already
    // have a live school, where a lone UPDATE correctly reports `UPDATE 1`, and
    // a hint that contradicts what the operator just saw is worse than none.
    for (const what of ['role-and-school', 'school'] as const) {
      expect(provisioningSql(USER, what)).toContain(RUN_BOTH);
      // The claim is conditional, never a flat promise about the row count.
      expect(RUN_BOTH).toContain('with no live school');
    }
  });

  it('prints the very same sentence the README does', async () => {
    // The README-parity test below strips `--` comments from both sides, so the
    // guidance itself is the one part of this recipe it cannot cover. Two copies
    // of an instruction with nothing holding them together is the drift that
    // started all of this, so the sentence is compared verbatim.
    const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');

    expect(provisioningSql(USER, 'role-and-school')).toContain(RUN_BOTH);
    expect(readme).toContain(RUN_BOTH);
  });

  it('flips the role only when the role is what is missing', () => {
    expect(provisioningSql(USER, 'role-and-school')).toContain("role = 'teacher'");
    expect(provisioningSql(USER, 'school')).not.toContain("role = 'teacher'");
  });

  /*
   * Everything above reads the statements; everything below runs them. The
   * premise of this builder is that a statement can look right and still fail at
   * the database — the original hint omitted `id` and every string match passed
   * while the operator got `null value in column "id" ... violates not-null`.
   * These execute both halves against the real migrated schema (PGlite, or real
   * Postgres under TEST_DATABASE_URL), so that class of bug cannot pass again.
   */
  describe('run against a real database', () => {
    it('provisions the teacher: role flipped, attached to a live school', async () => {
      const teacher = await makeUser('demo-teacher-runs', 'student');

      await run(provisioningSql(teacher.id, 'role-and-school'));

      const after = await reread(teacher.id);
      const [school] = await db.select().from(schools);
      expect(after.role).toBe('teacher');
      expect(after.schoolId).toBe(school?.id);
      expect(school?.removedAt).toBeNull();
    });

    it('is safe to paste twice — no second school, no re-pointing', async () => {
      const teacher = await makeUser('demo-teacher-rerun', 'student');
      await run(provisioningSql(teacher.id, 'role-and-school'));
      const first = (await reread(teacher.id)).schoolId;

      // A second call mints a different id, so a missing guard shows up here.
      await run(provisioningSql(teacher.id, 'role-and-school'));

      expect(await db.select().from(schools)).toHaveLength(1);
      expect((await reread(teacher.id)).schoolId).toBe(first);
    });

    it("attaches to the operator's own school, and writes nothing else", async () => {
      const [existing] = await db.insert(schools).values({ name: 'Real School' }).returning();
      // A student on purpose: the `school` recipe is the one that must not touch
      // `role`, and against a row that is already a teacher an accidental
      // `role = 'teacher'` would be an invisible no-op.
      const teacher = await makeUser('demo-teacher-existing', 'student');

      await run(provisioningSql(teacher.id, 'school'));

      const after = await reread(teacher.id);
      expect(await db.select().from(schools)).toHaveLength(1);
      expect(after.schoolId).toBe(existing?.id);
      expect(after.role).toBe('student');
    });

    it('skips a retired school and creates a live one', async () => {
      // Nothing is really deleted (decision 3). A retired school must not
      // satisfy the guard, or the teacher — and every class the demo creates —
      // lands on a school that is supposed to be gone.
      const [retired] = await db
        .insert(schools)
        .values({ name: 'Closed School', removedAt: new Date() })
        .returning();
      const teacher = await makeUser('demo-teacher-retired', 'student');

      await run(provisioningSql(teacher.id, 'role-and-school'));

      const after = await reread(teacher.id);
      const live = await db.select().from(schools).where(isNull(schools.removedAt));
      expect(after.schoolId).not.toBe(retired?.id);
      expect(live).toHaveLength(1);
      expect(after.schoolId).toBe(live[0]?.id);
    });

    it('changes nothing when only the UPDATE half is pasted', async () => {
      // Without the EXISTS guard this reports `UPDATE 1`, sets school_id to
      // NULL, and the operator believes they complied — the real failure then
      // arrives a demo run later, as a class that cannot be created.
      const teacher = await makeUser('demo-teacher-half', 'student');
      const statements = statementsOf(provisioningSql(teacher.id, 'role-and-school'));
      expect(statements).toHaveLength(2);
      expect(statements[1]).toMatch(/^UPDATE users/);

      await db.execute(sql.raw(statements[1] ?? ''));

      const after = await reread(teacher.id);
      expect(after.schoolId).toBeNull();
      expect(after.role).toBe('student'); // nothing applied at all
    });

    it('changes nothing on the UPDATE half when the only school is retired', async () => {
      // The fixture above cannot tell a correct guard from a plausible wrong
      // one: against an empty table `EXISTS (SELECT 1 FROM schools)` is false
      // too. A retired school separates them — it satisfies an unscoped guard
      // while the value subquery still finds nothing, which is the original
      // silent-NULL failure wearing the fix's clothes. Nothing is really
      // deleted (decision 3), so this is a database the demo really meets.
      //
      // Both variants run, because the guard has to be on both: for `school`
      // the recipe never touches `role`, so a blanked `school_id` is the only
      // trace a missing guard leaves — hence starting attached, not NULL.
      const [retired] = await db
        .insert(schools)
        .values({ name: 'Closed School', removedAt: new Date() })
        .returning();
      const teacher = await makeUser('demo-teacher-half-retired', 'student');
      await db.update(users).set({ schoolId: retired?.id }).where(eq(users.id, teacher.id));

      for (const what of ['role-and-school', 'school'] as const) {
        const statements = statementsOf(provisioningSql(teacher.id, what));
        expect(statements).toHaveLength(2);
        expect(statements[1]).toMatch(/^UPDATE users/);

        await db.execute(sql.raw(statements[1] ?? ''));

        const after = await reread(teacher.id);
        expect(after.schoolId).toBe(retired?.id); // not blanked
        expect(after.role).toBe('student'); // nothing applied at all
      }
    });
  });
});
