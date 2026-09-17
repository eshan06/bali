import type { Database } from '@bali/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

describe('GET /healthz', () => {
  it('answers ok with the API version, fully in-process', async () => {
    const app = buildApp(testEnv, { db });

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'v1' });

    await app.close();
  });
});
