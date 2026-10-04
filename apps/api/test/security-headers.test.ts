import { type Database, startSession } from '@bali/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, type AuthedApp, makeAuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * Phase 6 S3: every response carries HSTS and `nosniff`, every /v1 one
 * `Cache-Control: no-store` — success, error and the hijacked live stream alike.
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

const HSTS = 'max-age=31536000; includeSubDomains';

function expectSecurityHeaders(headers: Record<string, unknown>): void {
  expect(headers['strict-transport-security']).toBe(HSTS);
  expect(headers['x-content-type-options']).toBe('nosniff');
}

describe('security headers', () => {
  it('a /v1 answer, and a /v1 error, carry both and no-store', async () => {
    const { student } = await seedClassroom(db, 'hdr-v1');
    const ok = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'GET',
      url: '/v1/me',
    });
    expect(ok.statusCode).toBe(200);
    expectSecurityHeaders(ok.headers);
    expect(ok.headers['cache-control']).toBe('no-store');

    const refused = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(refused.statusCode).toBe(401);
    expectSecurityHeaders(refused.headers);
    expect(refused.headers['cache-control']).toBe('no-store');

    const bad = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: '/v1/taps',
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['cache-control']).toBe('no-store');
  });

  it('/healthz, /internal and an unknown route carry both, and are not /v1’s no-store', async () => {
    for (const [method, url] of [
      ['GET', '/healthz'],
      ['POST', '/internal/sweep'],
      ['GET', '/nowhere'],
    ] as const) {
      const res = await ctx.app.inject({ method, url });
      expectSecurityHeaders(res.headers);
      expect(res.headers['cache-control'], url).toBeUndefined();
    }
  });

  it('the live stream carries both and no-store, and still streams', async () => {
    const { klass, teacher } = await seedClassroom(db, 'hdr-sse');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const address = ctx.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');

    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/v1/sessions/${session.id}/stream`, {
        headers: { authorization: `Bearer ${await ctx.tokenFor(teacher.cognitoId)}` },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-store, no-transform');
      expect(res.headers.get('strict-transport-security')).toBe(HSTS);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toContain(': open');
    } finally {
      controller.abort();
    }
  });
});
