import type { Database } from '@bali/db';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer } from './helpers/test-issuer.js';

// CORS is opt-in: the browser portal is the only cross-origin caller, so the API
// adds Access-Control-Allow-Origin only when CORS_ORIGINS is set, and only for a
// listed origin — never a wildcard, never a reflected stranger. These run on the
// fast lane (app.inject, no socket, no real Postgres needed).

let db: Database;
let closeDb: () => Promise<void>;
let issuer: Awaited<ReturnType<typeof makeTestIssuer>>;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
});

afterAll(async () => {
  await closeDb();
});

/** Build an app with CORS unset (undefined) or set to the given origin list. */
function buildWithCors(corsOrigins?: string): FastifyInstance {
  const env = corsOrigins === undefined ? testEnv : { ...testEnv, CORS_ORIGINS: corsOrigins };
  return buildApp(env, { db, verifyToken: issuer.verifier });
}

describe('CORS (opt-in via CORS_ORIGINS)', () => {
  it('adds no Access-Control-Allow-Origin when CORS_ORIGINS is unset', async () => {
    const app = buildWithCors();
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('reflects only a listed origin — never a wildcard, never a stranger, no credentials', async () => {
    const app = buildWithCors('http://localhost:3000');

    const allowed = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    // Bearer-only, no cookies: credentials mode must stay off (which is also what
    // makes a wildcard safe to never emit).
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();

    const stranger = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://evil.example' },
    });
    const acao = stranger.headers['access-control-allow-origin'];
    expect(acao === undefined || acao === '').toBe(true);
    expect(acao).not.toBe('*');

    await app.close();
  });

  it('answers a preflight without a bearer — CORS runs before auth, so the portal can POST', async () => {
    const app = buildWithCors('http://localhost:3000');
    // A real guarded route (POST /v1/sessions/:id/end). The preflight carries no
    // Authorization; if auth ran first this would 401 and the browser could never
    // send the actual POST.
    const res = await app.inject({
      method: 'OPTIONS',
      url: `/v1/sessions/${randomUUID()}/end`,
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.statusCode).not.toBe(401);
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    await app.close();
  });

  // The portal's api-client sends GET, POST, PATCH and DELETE. @fastify/cors's
  // default allows only GET,HEAD,POST, so a browser refused the PATCH behind
  // New code (P11) before sending it. PUT (/v1/me/push-token) is iOS-only.
  it.each(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'])(
    'allows a %s preflight from a listed origin (P11)',
    async (method) => {
      const app = buildWithCors('http://localhost:3000');
      const res = await app.inject({
        method: 'OPTIONS',
        url: `/v1/classes/${randomUUID()}`,
        headers: { origin: 'http://localhost:3000', 'access-control-request-method': method },
      });
      expect([200, 204]).toContain(res.statusCode);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      const allowed = String(res.headers['access-control-allow-methods'] ?? '')
        .split(',')
        .map((m) => m.trim());
      expect(allowed).toContain(method);
      expect(allowed).not.toContain('PUT');
      await app.close();
    },
  );

  it('gives a stranger origin no CORS allow headers on a PATCH preflight', async () => {
    const app = buildWithCors('http://localhost:3000');
    const res = await app.inject({
      method: 'OPTIONS',
      url: `/v1/classes/${randomUUID()}`,
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'PATCH' },
    });
    const acao = res.headers['access-control-allow-origin'];
    expect(acao === undefined || acao === '').toBe(true);
    await app.close();
  });

  it('lets the portal read a 429’s Retry-After: exposed to its fetch, not only sent (L1)', async () => {
    const app = buildApp(
      { ...testEnv, CORS_ORIGINS: 'http://localhost:3000' },
      {
        db,
        verifyToken: issuer.verifier,
        limits: { unsigned: { burst: 1, perMinute: 1 }, now: () => 0 },
      },
    );
    const send = () =>
      app.inject({ method: 'GET', url: '/v1/me', headers: { origin: 'http://localhost:3000' } });

    expect((await send()).statusCode).toBe(401);
    const over = await send();
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBe('60');
    expect(over.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(over.headers['access-control-expose-headers']).toBe('retry-after');
    await app.close();
  });

  it('parses the origin list — trims entries, drops blanks, treats whitespace as unset', async () => {
    // Trailing comma, interior spaces, and an empty entry must not produce a
    // surprising allowlist (e.g. an empty-string origin that matches everything).
    const app = buildWithCors(' http://a.test , , http://b.test ,');
    const a = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://a.test' },
    });
    expect(a.headers['access-control-allow-origin']).toBe('http://a.test');
    const b = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://b.test' },
    });
    expect(b.headers['access-control-allow-origin']).toBe('http://b.test');
    await app.close();

    // A whitespace-only value collapses to [] — identical to unset (no CORS).
    const blank = buildWithCors('   ');
    const res = await blank.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'http://a.test' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await blank.close();
  });
});
