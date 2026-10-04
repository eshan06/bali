import type { Database } from '@bali/db';
import type { ApiErrorBody } from '@bali/shared';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  type LightMyRequestResponse,
} from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../src/app.js';
import { ApiError, parse, parseRequest, routerRefusal } from '../src/errors.js';
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

  it('parses a request part with the schema its route declares, and refuses as parse does', async () => {
    const Body = z.object({ minutes: z.number().int().positive() });
    app.post('/declared', { config: { parses: { body: Body } } }, (request) => ({
      minutes: parseRequest(request, 'body', Body).minutes,
    }));
    const ok = await app.inject({ method: 'POST', url: '/declared', payload: { minutes: 25 } });
    expect(ok.json()).toEqual({ minutes: 25 });
    const bad = await app.inject({ method: 'POST', url: '/declared', payload: { minutes: -3 } });
    expect(bad.statusCode).toBe(400);
    const details = bodyOf(bad).error.details as { path: string }[];
    expect(details.map((d) => d.path)).toEqual(['minutes']);
  });

  it('refuses, as a bug, a parse its route does not declare: the API snapshot would miss it', async () => {
    const Body = z.object({ minutes: z.number() });
    const Other = z.object({ minutes: z.number() });
    app.post('/undeclared', (request) => parseRequest(request, 'body', Body));
    app.post('/another', { config: { parses: { body: Other } } }, (request) =>
      parseRequest(request, 'body', Body),
    );
    app.post('/elsewhere', { config: { parses: { query: Body } } }, (request) =>
      parseRequest(request, 'body', Body),
    );
    for (const url of ['/undeclared', '/another', '/elsewhere']) {
      const res = await app.inject({ method: 'POST', url, payload: { minutes: 1 } });
      expect(res.statusCode, url).toBe(500);
    }
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

describe('a refusal from the router, before any route runs (S7)', () => {
  it('an async route constraint that fails is a 500 in the one shape, never Fastify’s', async () => {
    // No route of the API has one; this pins the branch that would answer it.
    const bare = Fastify({
      logger: false,
      frameworkErrors: routerRefusal,
      constraints: {
        tenant: {
          name: 'tenant',
          storage: () => {
            const routes = new Map<string, unknown>();
            return {
              get: (key: string) => routes.get(key) ?? null,
              set: (key: string, value: unknown) => void routes.set(key, value),
            };
          },
          deriveConstraint: (_req: unknown, _ctx: unknown, done: (err: Error | null) => void) =>
            done(new Error('constraint down')),
          mustMatchWhenDerived: true,
          validate: () => true,
        },
      } as unknown as FastifyServerOptions['constraints'],
    });
    bare.get('/x', { constraints: { tenant: 'a' } }, () => ({}));
    const res = await bare.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(500);
    expect(bodyOf(res)).toEqual({ error: { code: 'internal', message: 'internal error' } });
    await bare.close();
  });
});
