import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newUuidV7 } from '@bali/db';
import { dropDatabase } from '@bali/db/testing';
import type { MeResponse, SessionSnapshot, StartSessionResponse, TapResponse } from '@bali/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCall } from '../scripts/demo/http.js';
import { harnessServer, type SchoolFile, seedSchool } from '../scripts/load/school.js';

/*
 * The load harness (Phase 4, L2a), end to end: the school seeded into a database of its own on the
 * real Postgres, `npm run load:serve`'s entry booted as a process of its own on it — trusting the
 * seed's issuer through env alone — and driven over HTTP as L2b's load script will drive it. The
 * API runs L1's real budgets, and every answer must be a 200, so a 429 fails the run. Real Postgres
 * only: the API serves a database another process made.
 */

const REAL_PG = Boolean(process.env.TEST_DATABASE_URL);
const apiDir = fileURLToPath(new URL('..', import.meta.url));

/** The API's base URL, once its log says it listens; a process gone first fails with its output. */
function listeningAt(child: ChildProcess, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`never listened:\n${output}`)), timeoutMs);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const found = /Server listening at (http:\/\/[^\s"]+)/.exec(output);
      if (found) {
        clearTimeout(timer);
        resolve(found[1]!);
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`exited (${code}) before listening:\n${output}`));
    });
  });
}

describe('harnessServer', () => {
  it('takes a Postgres server on this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const url = `postgres://postgres:postgres@${host}:5432/postgres`;
      expect(harnessServer({ TEST_DATABASE_URL: url })).toBe(url);
    }
  });

  it('refuses one anywhere else, a list of hosts, no host (the driver would read PGHOST) and none', () => {
    for (const url of [
      'postgres://app:secret@containers-us-west-1.railway.app:5432/railway',
      'postgres://postgres@localhost,db.example.com:5432/postgres',
      'postgres:///postgres',
    ]) {
      expect(() => harnessServer({ TEST_DATABASE_URL: url })).toThrow(/on this machine/);
    }
    expect(() => harnessServer({})).toThrow(/TEST_DATABASE_URL/);
  });
});

describe.runIf(REAL_PG)('the load harness', () => {
  const database = `bali_load_${randomUUID().replace(/-/g, '')}`;
  let server: string | undefined;
  let dir: string | undefined;
  let api: ChildProcess | undefined;
  let closed: Promise<unknown> | undefined;
  let school: SchoolFile;
  let base: string;

  beforeAll(async () => {
    server = harnessServer(process.env);
    dir = mkdtempSync(join(tmpdir(), 'bali-load-'));
    school = await seedSchool(server, database);
    const file = join(dir, 'school.json');
    writeFileSync(file, JSON.stringify(school));
    api = spawn(process.execPath, ['--import', 'tsx', 'scripts/load/serve.ts'], {
      cwd: apiDir,
      env: {
        ...process.env,
        LOAD_SCHOOL_FILE: file,
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = once(api, 'close');
    base = await listeningAt(api);
  }, 60_000);

  afterAll(async () => {
    api?.kill('SIGTERM');
    await closed;
    if (server) await dropDatabase(server, database);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('seeds a bell: 20 teachers, and 600 students who each tap the block of the class they are in', () => {
    expect(school.teachers).toHaveLength(20);
    expect(school.students).toHaveLength(600);
    const tagOf = new Map(school.teachers.map((t) => [t.classId, t.tagId]));
    expect(school.students.every((s) => tagOf.get(s.classId) === s.tagId)).toBe(true);
    for (const t of school.teachers) {
      expect(school.students.filter((s) => s.classId === t.classId)).toHaveLength(30);
    }
  });

  it('serves it: taps before the bell wait, the Start joins them, a late tap joins — all 200s', async () => {
    // Any answer but a 200 throws, with its body — a 429 from L1's budgets among them.
    const call = createCall(base);
    const teacher = school.teachers[0]!;
    const [late, ...early] = school.students.filter((s) => s.classId === teacher.classId);
    const tap = (s: SchoolFile['students'][number]) =>
      call<TapResponse>('POST', '/v1/taps', {
        token: s.token,
        body: { tagId: s.tagId, eventId: newUuidV7(), deviceTime: new Date().toISOString() },
      });

    const waiting = early.slice(0, 5);
    for (const s of waiting) expect((await tap(s)).outcome).toBe('armed');
    const started = await call<StartSessionResponse>(
      'POST',
      `/v1/classes/${teacher.classId}/sessions`,
      { token: teacher.token, body: { durationMinutes: 50 } },
    );
    expect(started).toMatchObject({ outcome: 'created', armedConverted: waiting.length });
    expect(await tap(late!)).toMatchObject({
      outcome: 'joined',
      state: 'focused',
      session: { id: started.session.id },
    });

    const grid = await call<SessionSnapshot>('GET', `/v1/sessions/${started.session.id}`, {
      token: teacher.token,
    });
    expect(grid.students.filter((s) => s.state === 'focused')).toHaveLength(waiting.length + 1);

    // The second classes: the next teacher teaches two, and this room takes the second of them
    // at another bell, so its students are in two classes, one of them in session now.
    const next = await call<MeResponse>('GET', '/v1/me', { token: school.teachers[1]!.token });
    expect(next.classes).toHaveLength(2);
    const me = await call<MeResponse>('GET', '/v1/me', { token: late!.token });
    expect(me.session?.id).toBe(started.session.id);
    const live = new Map(me.classes.map((c) => [c.id, c.liveSession?.id ?? null]));
    expect(live.size).toBe(2);
    expect(live.get(teacher.classId)).toBe(started.session.id);
    expect([...live.values()].filter((id) => id === null)).toHaveLength(1);
  });
});
