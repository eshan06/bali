import type { Database } from '@bali/db';
import type { ApiErrorBody } from '@bali/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../src/app.js';
import { ApiError, parse } from '../src/errors.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

const bodyOf = (res: LightMyRequestResponse): ApiErrorBody => res.json<ApiErrorBody>();

let app: FastifyInstance;
let db: Database;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  app = buildApp(testEnv, { db, verifyToken: () => Promise.reject(ApiError.unauthorized()) });
});

afterEach(async () => {
  await app.close();
});

describe('the one error shape', () => {
  it('renders an ApiError to its code and status', async () => {
    app.get('/boom', () => {
      throw ApiError.conflict('already running');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'conflict', message: 'already running' } });
  });

  it('renders a refusal’s reason beside its code, and none where there is none', async () => {
    app.get('/refused', () => {
      throw new ApiError('conflict', 'not in this session', undefined, 'not_participating');
    });
    app.get('/plain', () => {
      throw ApiError.forbidden();
    });
    const res = await app.inject({ method: 'GET', url: '/refused' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'conflict', reason: 'not_participating', message: 'not in this session' },
    });
    // The shape without one is exactly what it was before A5.
    const plain = await app.inject({ method: 'GET', url: '/plain' });
    expect(plain.json()).toEqual({ error: { code: 'forbidden', message: 'not allowed' } });
  });

  it('includes per-field details on a validation failure, without echoing values', async () => {
    const Body = z.object({ minutes: z.number().int().positive() });
    app.post('/thing', (request) => {
      const data = parse(Body, request.body);
      return { minutes: data.minutes };
    });
    const res = await app.inject({ method: 'POST', url: '/thing', payload: { minutes: -3 } });
    expect(res.statusCode).toBe(400);
    const json = bodyOf(res);
    expect(json.error.code).toBe('bad_input');
    const details = json.error.details as { path: string; message: string }[];
    expect(details).toHaveLength(1);
    expect(details[0]!.path).toBe('minutes');
    expect(typeof details[0]!.message).toBe('string');
  });

  it('passes valid input through the parse helper', async () => {
    const Body = z.object({ minutes: z.number().int().positive() });
    app.post('/thing2', (request) => ({ minutes: parse(Body, request.body).minutes }));
    const res = await app.inject({ method: 'POST', url: '/thing2', payload: { minutes: 25 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ minutes: 25 });
  });

  it('an unknown route is a 404 in the shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(bodyOf(res).error.code).toBe('not_found');
  });

  it('an unexpected throw is an opaque 500 — no internals leak', async () => {
    app.get('/crash', () => {
      throw new Error('secret stack detail');
    });
    const res = await app.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'internal error' } });
    expect(JSON.stringify(res.json())).not.toContain('secret stack detail');
  });

  it('malformed JSON is a 400 in the shape, not a raw Fastify error', async () => {
    app.post('/thing3', () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/thing3',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(bodyOf(res).error.code).toBe('bad_input');
  });
});
