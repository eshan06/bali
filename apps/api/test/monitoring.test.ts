import type { Database } from '@bali/db';
import * as Sentry from '@sentry/node';
import { DrizzleQueryError } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { initMonitoring } from '../src/monitoring.js';
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

let app: FastifyInstance;
let db: Database;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterAll(async () => {
  await app.close();
  await Sentry.close();
  await closeDb();
});

describe('error monitoring', () => {
  it('is off without SENTRY_DSN', () => {
    expect(initMonitoring(testEnv)).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
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

    app = buildApp(testEnv, { db, verifyToken: () => Promise.reject(ApiError.unauthorized()) });
    app.post('/v1/refuse', () => {
      throw ApiError.forbidden();
    });
    app.post('/v1/join-codes/:code/boom', () => {
      // What Drizzle throws when a query fails: the SQL, its parameters in the
      // message, and the driver's error (which echoes the row) as the cause.
      const cause = new Error(
        `insert violates foreign key constraint; Key (cognito_sub)=(${SECRETS.cognitoId}) is not present`,
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
    const refused = await app.inject({ method: 'POST', url: '/v1/refuse', headers, payload });
    expect(refused.statusCode).toBe(403);
    const failed = await app.inject({
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
});
