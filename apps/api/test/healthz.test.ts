import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { testEnv } from './helpers/env.js';

describe('GET /healthz', () => {
  it('answers ok with the API version, fully in-process', async () => {
    const app = buildApp(testEnv);

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'v1' });

    await app.close();
  });
});
