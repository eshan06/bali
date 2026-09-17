import { type Database, startSession } from '@bali/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

const KEY = testEnv.INTERNAL_API_KEY;

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  // No user JWT needed for the internal route, so no verifier is exercised.
  app = buildApp(testEnv, { db, verifyToken: () => Promise.reject(new Error('unused')) });
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

function expire(headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/internal/sessions/expire', headers });
}

describe('POST /internal/sessions/expire', () => {
  it('rejects a missing internal key', async () => {
    const res = await expire({});
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong internal key', async () => {
    const res = await expire({ 'x-internal-key': 'wrong-key-wrong-key-wrong' });
    expect(res.statusCode).toBe(401);
  });

  it('with the right key, ends sessions past their end time and is idempotent', async () => {
    const { klass } = await seedClassroom(db, 'sweep');
    // A session whose window is already in the past.
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60 * 60_000),
      endsAt: new Date(Date.now() - 30 * 60_000),
    });

    const first = await expire({ 'x-internal-key': KEY });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ expired: number }>().expired).toBe(1);

    // Running again ends nothing new (idempotent, decision 6).
    const second = await expire({ 'x-internal-key': KEY });
    expect(second.json<{ expired: number }>().expired).toBe(0);
  });
});
