import { classes, type Database, schools, sessions, users } from '@bali/db';
import type { EnrollmentJoinResponse, TapResponse, UnlockResponse } from '@bali/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailOf } from '../scripts/demo/cognito.js';
import { runDevTeacher, USAGE } from '../scripts/demo/dev-teacher.js';
import { createCall } from '../scripts/demo/http.js';
import { buildApp } from '../src/app.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer } from './helpers/test-issuer.js';

/*
 * The dev-teacher helper (Phase 3 · T1), run as the owner runs it against dev —
 * here against an in-process server on a real socket, as the demo's local mode
 * runs: PGlite (real Postgres on that lane) and the in-process issuer. Only the
 * Cognito sign-in is a stand-in; every request the helper makes is real, and
 * the phone is played over HTTP the way the app sends it.
 */

const PASSWORD = 'correct horse battery staple';
const TEACHER_USERNAME = 'dev-teacher@example.test';

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let base: string;
let issuer: Awaited<ReturnType<typeof makeTestIssuer>>;
/** Every token the stand-in Cognito handed out, and every line any run printed. */
let issued: string[];
let printed: string[];

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  app = buildApp(testEnv, { db, verifyToken: issuer.verifier });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
  issued = [];
  printed = [];
  // The teacher as the README's one-time provisioning leaves them: the role and a school.
  const [school] = await db.insert(schools).values({ name: 'Dev School' }).returning();
  await db.insert(users).values({
    cognitoId: 'dev-teacher',
    role: 'teacher',
    schoolId: school!.id,
    displayName: 'Ms. Dev',
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await closeDb();
});

/**
 * Cognito's USER_PASSWORD_AUTH, stood in: a token for the username's local part
 * when the password is right, Cognito's own refusal when it is not. `forged`
 * hands out a token the API does not trust, for its 401.
 */
function stubCognito(opts: { forged?: boolean } = {}): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const { AuthParameters } = JSON.parse(init.body as string) as {
      AuthParameters: { USERNAME: string; PASSWORD: string };
    };
    if (AuthParameters.PASSWORD !== PASSWORD) {
      const refusal = {
        __type: 'NotAuthorizedException',
        message: 'Incorrect username or password.',
      };
      return new Response(JSON.stringify(refusal), { status: 400 });
    }
    const token = await issuer.sign({
      sub: AuthParameters.USERNAME.split('@')[0],
      issuer: opts.forged ? 'https://forged.example.test/pool' : undefined,
    });
    issued.push(token);
    return new Response(JSON.stringify({ AuthenticationResult: { AccessToken: token } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

function devEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DEMO_API_URL: base,
    DEMO_COGNITO_CLIENT_ID: 'app-client-id',
    DEMO_USER_TEACHER: TEACHER_USERNAME,
    DEMO_PASSWORD: PASSWORD,
    // Never used by the helper, and so never printed either.
    DEMO_INTERNAL_KEY: testEnv.INTERNAL_API_KEY,
    ...overrides,
  };
}

/** Start one run of the helper, its lines kept apart from any other run's. */
function launch(
  argv: string[],
  opts: { env?: NodeJS.ProcessEnv; cognito?: typeof fetch } = {},
): { lines: string[]; done: Promise<void> } {
  const lines: string[] = [];
  const done = runDevTeacher(argv, {
    env: opts.env ?? devEnv(),
    print: (line) => {
      lines.push(line);
      printed.push(line);
    },
    cognitoFetch: opts.cognito ?? stubCognito(),
    pollMs: 20,
  });
  return { lines, done };
}

async function run(...argv: string[]): Promise<string[]> {
  const { lines, done } = launch(argv);
  await done;
  return lines;
}

/** What a failed run printed and threw, as the entry script reports it. */
async function failure(argv: string[], opts: Parameters<typeof launch>[1] = {}): Promise<string> {
  const { lines, done } = launch(argv, opts);
  const err = await done.then(
    () => null,
    (e: unknown) => e,
  );
  if (err === null)
    throw new Error(`${argv.join(' ')} should have failed; printed:\n${lines.join('\n')}`);
  printed.push(inspect(err));
  return detailOf(err);
}

/** Wait for a line a running command prints. */
async function waitForLine(lines: string[], wanted: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const hit = lines.find((line) => line.includes(wanted));
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(`no line with "${wanted}"; printed:\n${lines.join('\n')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const iso = (): string => new Date().toISOString();
const local = (at: Date): string => at.toLocaleTimeString();

/** A student's phone, signed in and in the class, as the app sends it. */
async function studentJoins(
  joinCode: string,
): Promise<{ token: string; call: ReturnType<typeof createCall> }> {
  const call = createCall(base);
  const token = await issuer.sign({ sub: 'ana', extraClaims: { username: 'Ana' } });
  await call('GET', '/v1/me', { token }); // the app's boot call names her
  const joined = await call<EnrollmentJoinResponse>('POST', '/v1/enrollments', {
    token,
    body: { joinCode, eventId: randomUUID(), deviceTime: iso() },
  });
  expect(joined.outcome).toBe('joined');
  return { token, call };
}

async function theSession(): Promise<typeof sessions.$inferSelect> {
  const rows = await db.select().from(sessions);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

// A PGlite per test and a dozen runs each, so more than the default five seconds.
describe('npm run dev:teacher', { timeout: 30_000 }, () => {
  it('makes a class and a block, starts a session and watches a student tap in, until the end', async () => {
    const made = await run('class');
    const joinCode = /^class "Device check" \(made\): join code (\S+)$/.exec(made[0] ?? '')?.[1];
    expect(made, 'one line with the join code').toHaveLength(1);
    expect(joinCode).toBeDefined();
    // A re-run finds the class it made rather than making another.
    expect(await run('class')).toEqual([
      `class "Device check" (yours already): join code ${joinCode}`,
    ]);

    const block = ["block DEVICE-CHECK-1 is yours — type it into the phone's Tap field"];
    expect(await run('block')).toEqual(block);
    expect(await run('block'), 'a re-run is the same block').toEqual(block);

    const started = await run('start');
    const session = await theSession();
    expect(session.endsAt.getTime() - session.startedAt.getTime()).toBe(20 * 60_000);
    expect(started).toEqual([
      `session ${session.id} started in "Device check"; it ends at ${local(session.endsAt)}`,
    ]);

    // On the phone: Join (the code), then Tap (the tag).
    const ana = await studentJoins(joinCode!);
    const tap = await ana.call<TapResponse>('POST', '/v1/taps', {
      token: ana.token,
      body: { tagId: 'DEVICE-CHECK-1', eventId: randomUUID(), deviceTime: iso() },
    });
    expect(tap.outcome).toBe('joined');

    const watch = launch(['watch']);
    expect(await waitForLine(watch.lines, 'watching')).toBe(
      `watching "Device check", session ${session.id} (Ctrl-C stops)`,
    );
    await waitForLine(watch.lines, `the session ends at ${local(session.endsAt)}`);
    await waitForLine(watch.lines, 'Ana: focused · last seen ');

    // Emergency Unlock, with its reason — the portal's chip, as a line.
    const unlock = await ana.call<UnlockResponse>('POST', `/v1/sessions/${session.id}/unlock`, {
      token: ana.token,
      body: { eventId: randomUUID(), deviceTime: iso(), reason: 'bathroom' },
    });
    expect(unlock.outcome).toBe('applied');
    await waitForLine(watch.lines, 'Ana: unlocked · bathroom · last seen ');

    const extended = await run('extend', '5');
    const later = await theSession();
    expect(later.endsAt.getTime() - session.endsAt.getTime()).toBe(5 * 60_000);
    expect(extended).toEqual([`session ${session.id} now ends at ${local(later.endsAt)}`]);
    await waitForLine(watch.lines, `the session ends at ${local(later.endsAt)}`);

    expect(await run('end')).toEqual([`session ${session.id} ended; 1 participation(s) closed`]);
    // The end ends the watch: Ana left while unlocked, the grid's loud chip.
    await watch.done;
    expect(watch.lines).toContainEqual(expect.stringContaining('Ana: left · unlocked · bathroom'));
    expect(watch.lines.at(-1)).toMatch(/ {2}the session is over$/);
    expect(await run('end')).toEqual(['no session is running in "Device check" — nothing to end']);
  });

  it('starts, extends and ends in the class --class names', async () => {
    expect(await run('class', 'Period 2')).toEqual([
      expect.stringMatching(/^class "Period 2" \(made\): join code \S+$/),
    ]);
    expect(await failure(['start'])).toMatch(/you have no class named "Device check"/);

    const started = await run('start', '45', '--class', 'Period 2');
    const session = await theSession();
    expect(session.endsAt.getTime() - session.startedAt.getTime()).toBe(45 * 60_000);
    expect(started[0]).toBe(
      `session ${session.id} started in "Period 2"; it ends at ${local(session.endsAt)}`,
    );
    // A second start answers with the session already running.
    expect(await run('start', '--class', 'Period 2')).toEqual([
      `a session was already running in "Period 2": ${session.id}, until ${local(session.endsAt)} (extend adds time)`,
    ]);
    // extend's default is ten minutes.
    const extended = await run('extend', '--class', 'Period 2');
    const later = await theSession();
    expect(later.endsAt.getTime() - session.endsAt.getTime()).toBe(10 * 60_000);
    expect(extended).toEqual([`session ${session.id} now ends at ${local(later.endsAt)}`]);
    expect(await run('end', '--class', 'Period 2')).toEqual([
      `session ${session.id} ended; 0 participation(s) closed`,
    ]);
  });

  it('says a tap made before the start joined it', async () => {
    const joinCode = /join code (\S+)$/.exec((await run('class'))[0] ?? '')?.[1];
    await run('block');
    const ana = await studentJoins(joinCode!);
    const tap = await ana.call<TapResponse>('POST', '/v1/taps', {
      token: ana.token,
      body: { tagId: 'DEVICE-CHECK-1', eventId: randomUUID(), deviceTime: iso() },
    });
    expect(tap.outcome).toBe('armed');

    const started = await run('start');
    expect(started[1]).toBe('1 tap(s) made before the start joined it');
  });

  it('refuses honestly, and checks what it was given before signing in', async () => {
    expect(await failure(['watch'])).toMatch(
      /you have no class named "Device check" — make it first/,
    );
    await run('class');
    expect(await failure(['watch'])).toMatch(
      /no session is running in "Device check" — start one: npm run dev:teacher -- start/,
    );
    expect(await failure(['extend'])).toMatch(/no session is running in "Device check"/);

    // Nothing signs in for a command line it cannot run.
    const before = issued.length;
    for (const argv of [
      ['start', '0'],
      ['start', 'soon'],
      ['extend', '481'],
      ['watch', 'Period 2'],
      ['teach'],
      ['--nope'],
    ]) {
      const { lines, done } = launch(argv);
      await expect(done).rejects.toThrow();
      expect(lines, `${argv.join(' ')} prints the usage`).toEqual([USAGE]);
    }
    expect(await failure(['start', 'soon'])).toBe(
      'minutes must be a whole number from 1 to 480, not "soon"',
    );
    expect(issued.length).toBe(before);
    expect(await run('help')).toEqual([USAGE]);
    expect(await run()).toEqual([USAGE]);

    // Two of the teacher's classes by one name: which one is not guessed.
    const [teacher] = await db.select().from(users).where(eq(users.cognitoId, 'dev-teacher'));
    await db.insert(classes).values({
      teacherId: teacher!.id,
      schoolId: teacher!.schoolId!,
      name: 'Device check',
      joinCode: 'ZZZZZZ',
    });
    expect(await failure(['start'])).toMatch(
      /you have 2 classes named "Device check" — use another with --class/,
    );
  });

  it('says a failed read of the session once and keeps watching; an expired sign-in ends it', async () => {
    await run('class');
    await run('start');
    const session = await theSession();
    const snapshot = `${base}/v1/sessions/${session.id}`;
    const realFetch = globalThis.fetch;
    let answer: 'refuse' | 'unreachable' | 'real' = 'unreachable';
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== snapshot || answer === 'real') return realFetch(input, init);
      if (answer === 'refuse') {
        const body = { error: { code: 'unauthorized', message: 'invalid token' } };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 401 }));
      }
      return Promise.reject(
        new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:443') }),
      );
    });

    const watch = launch(['watch']);
    await waitForLine(watch.lines, 'could not read the session');
    await new Promise((resolve) => setTimeout(resolve, 100)); // several failed reads
    answer = 'real';
    await waitForLine(watch.lines, 'reading the session again');
    expect(watch.lines.filter((line) => line.includes('could not read'))).toEqual([
      expect.stringMatching(
        / {2}could not read the session \(fetch failed — connect ECONNREFUSED 127\.0\.0\.1:443\); trying again$/,
      ),
    ]);
    await waitForLine(watch.lines, 'no students in the class yet');

    answer = 'refuse';
    const err = await watch.done.then(
      () => null,
      (e: unknown) => e,
    );
    expect(detailOf(err)).toMatch(/^the teacher's sign-in has expired; run watch again — GET /);
  });

  it('never prints a credential — not the password, a token or the sweep key', async () => {
    // Anything the helper — or a module it reuses — writes to the console counts too.
    const consoleOut: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleOut.push(args);
      });
    }

    // Every command, as the device check runs them.
    const joinCode = /join code (\S+)$/.exec((await run('class'))[0] ?? '')?.[1];
    await run('block');
    await run('start');
    const ana = await studentJoins(joinCode!);
    await ana.call<TapResponse>('POST', '/v1/taps', {
      token: ana.token,
      body: { tagId: 'DEVICE-CHECK-1', eventId: randomUUID(), deviceTime: iso() },
    });
    const watch = launch(['watch']);
    await waitForLine(watch.lines, 'Ana: focused');
    await run('extend');
    await run('end');
    await watch.done;

    // And the ways it fails: a wrong password, a token the API refuses, and a
    // tag another teacher holds.
    const refused = await failure(['class'], { env: devEnv({ DEMO_PASSWORD: 'wrong password' }) });
    expect(refused).toContain('NotAuthorizedException');
    expect(await failure(['class'], { cognito: stubCognito({ forged: true }) })).toContain(
      'GET /v1/me → 401',
    );
    await db.insert(users).values({ cognitoId: 'other-teacher', role: 'teacher' });
    await createCall(base)('POST', '/v1/blocks', {
      token: await issuer.sign({ sub: 'other-teacher' }),
      body: { tagId: 'TAKEN-1' },
    });
    expect(await failure(['block', 'TAKEN-1'])).toContain('POST /v1/blocks → 409');

    const secrets = [PASSWORD, 'wrong password', testEnv.INTERNAL_API_KEY, ...issued];
    expect(issued.length).toBeGreaterThan(5);
    const everything = [...printed, ...consoleOut.map((args) => inspect(args))].join('\n');
    for (const secret of secrets) expect(everything).not.toContain(secret);
  });
});
