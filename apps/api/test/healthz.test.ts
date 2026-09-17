import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Env } from '../src/env.js';

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  SHUTDOWN_DEADLINE_MS: 8000,
};

describe('GET /healthz', () => {
  it('answers ok with the API version, fully in-process', async () => {
    const app = buildApp(testEnv);

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'v1' });

    await app.close();
  });
});
