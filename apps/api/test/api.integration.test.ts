import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDb } from '@bali/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

/**
 * Integration tests for the teacher API, driven through Fastify's `app.inject()` against a
 * throwaway Postgres (TEST_DATABASE_URL). Covers auth, the addendum endpoints (overview,
 * recap, student history, roster, membership), pagination, and an IDOR ownership check.
 *
 * Skips entirely without TEST_DATABASE_URL so a plain `npm test` never reaches a real DB.
 */
const HAS_DB = !!process.env.TEST_DATABASE_URL;
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const RIVERA = 'dev:rivera:teacher@example.com:Ms. Rivera';
const OTHER = 'dev:other:other@example.com:Other Teacher';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

describe.skipIf(!HAS_DB)('teacher API integration', () => {
  let app: FastifyInstance;
  const auth = (t = RIVERA) => ({ authorization: `Bearer ${t}` });
  const get = (url: string, t?: string) => app.inject({ method: 'GET', url, headers: auth(t) });
  const send = (method: 'POST' | 'PATCH', url: string, body?: unknown, t?: string) =>
    app.inject({
      method,
      url,
      headers: { ...auth(t), 'content-type': 'application/json' },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });

  let p3 = '';
  let p1 = '';
  let lastSession = '';
  let samId = '';
  let marcusMembership = '';

  beforeAll(async () => {
    await migrate(getDb(), { migrationsFolder: resolve(repoRoot, 'packages/db/migrations') });
    execSync('node --import tsx packages/db/src/seed.ts --reset', {
      cwd: repoRoot,
      env: process.env,
      stdio: 'ignore',
    });
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/classes' });
    expect(res.statusCode).toBe(401);
  });

  it('liveness + readiness + security headers', async () => {
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    const ready = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().ready).toBe(true);
  });

  it('bootstraps + adopts the seed teacher', async () => {
    const res = await send('POST', '/v1/auth/bootstrap', { role: 'teacher' });
    expect([200, 201]).toContain(res.statusCode);
  });

  it('lists classes with the addendum card fields', async () => {
    const res = await get('/v1/classes');
    expect(res.statusCode).toBe(200);
    const classes: Json[] = res.json().classes;
    expect(classes).toHaveLength(4);
    const c3 = classes.find((c) => c.name.startsWith('Period 3'));
    p3 = c3.id;
    p1 = classes.find((c) => c.name.startsWith('Period 1')).id;
    for (const key of ['autoApprove', 'archived', 'lastMetLabel']) expect(c3).toHaveProperty(key);
  });

  it('portal home: 3 Period 1 approvals carrying classId', async () => {
    const home = (await get('/v1/portal/home')).json();
    expect(home.teacher.displayName).toBe('Ms. Rivera');
    expect(home.approvals).toHaveLength(3);
    expect(home.approvals.every((a: Json) => a.classId && a.className.startsWith('Period 1'))).toBe(true);
  });

  it('class overview: members + last session 26/28', async () => {
    const ov = (await get(`/v1/classes/${p3}/overview`)).json();
    expect(ov.memberCount).toBe(28);
    expect(ov.lastSession.focusedCount).toBe(26);
    expect(ov.lastSession.totalMembers).toBe(28);
    lastSession = ov.lastSession.sessionId;
    expect(ov.medianFocusMinutes).toBeGreaterThanOrEqual(35);
    expect(ov.medianFocusMinutes).toBeLessThanOrEqual(47);
  });

  it('session recap: neutral counts + Sam emergency + Diego permission-off', async () => {
    const r = (await get(`/v1/sessions/${lastSession}/recap`)).json();
    expect(r.focusedCount).toBe(26);
    expect(r.emergencyCount).toBe(1);
    expect(r.emergencies[0].studentName).toBe('Sam Torres');
    expect(r.permissionOffCount).toBe(1);
    expect(r.clean).toBe(false);
    expect(r.framing).toBe('Patterns are conversation starters, not verdicts.');
    expect(r.emergencies[0].nudge).toMatch(/check-in with Sam/);
  });

  it('student history: Sam reads the spec outcome rows', async () => {
    const roster = (await get(`/v1/classes/${p3}/roster`)).json();
    samId = roster.members.find((m: Json) => m.name === 'Sam Torres').studentId;
    marcusMembership = roster.members.find((m: Json) => m.name === 'Marcus Jones').membershipId;
    expect(roster.members.find((m: Json) => m.name === 'Priya Shah').defaultNoDevice).toBe(true);

    const h = (await get(`/v1/classes/${p3}/students/${samId}/history`)).json();
    expect(h.rows).toHaveLength(5);
    expect(h.boundary).toMatch(/Bali never sees Sam.s screen, apps, messages, or location/);
    expect(h.rows.some((x: Json) => x.state === 'pass')).toBe(true);
    expect(h.rows.some((x: Json) => x.state === 'revoked')).toBe(true);
    expect(h.rows.some((x: Json) => x.state === 'no_device')).toBe(true);
  });

  it('membership default-no-device patch persists', async () => {
    const res = await send('PATCH', `/v1/memberships/${marcusMembership}`, { defaultNoDevice: true });
    expect(res.json().defaultNoDevice).toBe(true);
    const roster = (await get(`/v1/classes/${p3}/roster`)).json();
    expect(roster.members.find((m: Json) => m.name === 'Marcus Jones').defaultNoDevice).toBe(true);
    await send('PATCH', `/v1/memberships/${marcusMembership}`, { defaultNoDevice: false });
  });

  it('per-class events: time-ordered + cursor pagination', async () => {
    const all = (await get(`/v1/events?classId=${p3}&limit=100`)).json();
    expect(all.events.length).toBeGreaterThan(0);
    const first = new Date(all.events[0].at).getTime();
    const last = new Date(all.events[all.events.length - 1].at).getTime();
    expect(first).toBeGreaterThanOrEqual(last); // newest first
    const page = (await get(`/v1/events?classId=${p3}&limit=5`)).json();
    expect(page.events.length).toBe(5);
    expect(page.nextCursor).toBeTruthy();
  });

  it('enforces class ownership (IDOR): another teacher cannot read this overview', async () => {
    await send('POST', '/v1/auth/bootstrap', { role: 'teacher' }, OTHER);
    const res = await get(`/v1/classes/${p3}/overview`, OTHER);
    expect(res.statusCode).toBe(404);
  });

  it('enforces session ownership (IDOR): another teacher cannot read/end/inspect a session', async () => {
    await send('POST', '/v1/auth/bootstrap', { role: 'teacher' }, OTHER);
    expect((await get(`/v1/sessions/${lastSession}`, OTHER)).statusCode).toBe(404);
    expect((await get(`/v1/sessions/${lastSession}/recap`, OTHER)).statusCode).toBe(404);
    expect((await get(`/v1/sessions/${lastSession}/students/${samId}/timeline`, OTHER)).statusCode).toBe(404);
    expect((await send('POST', `/v1/sessions/${lastSession}/end`, undefined, OTHER)).statusCode).toBe(404);
    // The owner is unaffected.
    expect((await get(`/v1/sessions/${lastSession}`)).statusCode).toBe(200);
  });
});
