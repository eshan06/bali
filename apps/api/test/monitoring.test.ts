import type { Database } from '@bali/db';
import * as Sentry from '@sentry/node';
import { DrizzleQueryError } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { captureFailure, initMonitoring } from '../src/monitoring.js';
import { SWEEP_INTERVAL_MS, startSweeping } from '../src/sweep.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

// Everything below is personal data or a secret; none of it may reach Sentry.
const SECRETS = {
  name: 'Ada Lovelace',
  email: 'ada.lovelace@school.example',
  cognitoId: 'us-east-1:6f1c2d3e-cognito-sub',
  reason: 'left my inhaler in the locker',
  pathCode: 'PATHCODE42',
  queryCode: 'QUERYCODE99',
  bearer: 'secret-bearer-token-xyz',
  internalKey: 'internal-key-abc-0123456789',
  cookie: 'session-cookie-value',
};

const sent: string[] = [];
const decoder = new TextDecoder();

/** A transport that records each envelope instead of sending it. */
const fakeTransport = (options: Parameters<typeof Sentry.makeNodeTransport>[0]) =>
  Sentry.createTransport(options, (request) => {
    sent.push(typeof request.body === 'string' ? request.body : decoder.decode(request.body));
    return Promise.resolve({ statusCode: 200 });
  });

const eventEnvelopes = (): string[] => sent.filter((body) => body.includes('"type":"event"'));

let app: FastifyInstance | undefined;
let db: Database;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterAll(async () => {
  await app?.close();
  await Sentry.close();
  await closeDb();
});

describe('error monitoring', () => {
  it('is off without SENTRY_DSN', () => {
    expect(initMonitoring(testEnv)).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
    // Reporting with monitoring off does nothing and throws nothing.
    captureFailure(new Error('nowhere to go'), 'GET /healthz');
    expect(sent).toEqual([]);
  });

  it('sends a 500 scrubbed of student data, and no 4xx refusal', async () => {
    const started = initMonitoring(
      {
        ...testEnv,
        SENTRY_DSN: 'https://publickey@o0.ingest.example.invalid/1',
        SENTRY_ENVIRONMENT: 'dev',
        RAILWAY_GIT_COMMIT_SHA: 'abc123def',
      },
      { transport: fakeTransport },
    );
    expect(started).toBe(true);
    // Uncaught exceptions and rejections are reported by Sentry's own handlers.
    expect(Sentry.getClient()?.getIntegrationByName('OnUncaughtException')).toBeDefined();
    expect(Sentry.getClient()?.getIntegrationByName('OnUnhandledRejection')).toBeDefined();

    const server = buildApp(testEnv, {
      db,
      verifyToken: () => Promise.reject(ApiError.unauthorized()),
    });
    app = server;
    server.post('/v1/refuse', () => {
      throw ApiError.forbidden();
    });
    // For the next test: routes can't be added once the first request has run.
    server.get('/v1/unavailable', () => {
      throw ApiError.unavailable('could not verify token');
    });
    server.post('/v1/join-codes/:code/boom', () => {
      // What Drizzle throws when a query fails: the SQL, its parameters in the
      // message, and the driver's error (which echoes the row) as the cause.
      const cause = new Error(
        `insert violates foreign key constraint; Key (cognito_sub, name)=(${SECRETS.cognitoId}, Ada) ${SECRETS.name}) is not present\n` +
          `invalid input syntax for type uuid: "${SECRETS.reason}"`,
      );
      throw new DrizzleQueryError(
        'insert into "unlocks" ("name", "email", "cognito_sub", "reason") values ($1, $2, $3, $4)',
        [SECRETS.name, SECRETS.email, SECRETS.cognitoId, SECRETS.reason],
        cause,
      );
    });

    const headers = {
      authorization: `Bearer ${SECRETS.bearer}`,
      'x-internal-key': SECRETS.internalKey,
      cookie: `session=${SECRETS.cookie}`,
    };
    const payload = { name: SECRETS.name, email: SECRETS.email, reason: SECRETS.reason };
    const refused = await server.inject({ method: 'POST', url: '/v1/refuse', headers, payload });
    expect(refused.statusCode).toBe(403);
    const failed = await server.inject({
      method: 'POST',
      url: `/v1/join-codes/${SECRETS.pathCode}/boom?code=${SECRETS.queryCode}`,
      headers,
      payload,
    });
    expect(failed.statusCode).toBe(500);
    await Sentry.flush(5000);

    const events = eventEnvelopes();
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toContain('Key (cognito_sub, name)=([scrubbed])');
    expect(event).toContain('invalid input syntax for type uuid: [scrubbed]');
    for (const secret of Object.values(SECRETS)) expect(event).not.toContain(secret);
    expect(event).toContain('Failed query: insert into');
    expect(event).toContain('params: [scrubbed]');
    expect(event).toContain('"route":"POST /v1/join-codes/:code/boom"');
    expect(event).toContain('"release":"abc123def"');
    expect(event).toContain('"environment":"dev"');
    // Reported by the error handler, not by an auto-instrumentation.
    expect(event).toContain('"handled":true');
    expect(event).not.toContain('"Fastify"');
    // No performance tracing.
    expect(sent.some((body) => body.includes('"type":"transaction"'))).toBe(false);
  });

  it('reports a 503 and a failed sweep, each tagged where it failed', async () => {
    sent.length = 0;
    const server = app!;
    // A 503 is the API failing (Cognito's keys out of reach), not a refusal.
    const res = await server.inject({ method: 'GET', url: '/v1/unavailable' });
    expect(res.statusCode).toBe(503);

    const sweeper = Fastify({ logger: false });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      startSweeping(sweeper, () => Promise.reject(new Error('the expiry pass failed')));
      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
      await sweeper.close();
    } finally {
      vi.useRealTimers();
    }
    await Sentry.flush(5000);

    const events = eventEnvelopes();
    expect(events).toHaveLength(2);
    expect(events.some((e) => e.includes('"route":"GET /v1/unavailable"'))).toBe(true);
    expect(events.some((e) => e.includes('"route":"sweep"'))).toBe(true);
  });
});
