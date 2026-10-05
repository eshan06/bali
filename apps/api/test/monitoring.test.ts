import type { Database } from '@bali/db';
import * as Sentry from '@sentry/node';
import { DrizzleQueryError } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { SWEEP_MONITOR_SLUG, captureFailure, initMonitoring } from '../src/monitoring.js';
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
const checkIns = (): string[] => sent.filter((body) => body.includes('"type":"check_in"'));

/** Run `startSweeping` with `run` for `ticks` minutes, then close it. */
async function sweepTicks(run: () => Promise<unknown>, ticks = 1): Promise<void> {
  const sweeper = Fastify({ logger: false });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    startSweeping(sweeper, run);
    for (let i = 0; i < ticks; i++) await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    await sweeper.close();
  } finally {
    vi.useRealTimers();
  }
}

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
  it('is off without SENTRY_DSN', async () => {
    expect(initMonitoring(testEnv)).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
    // Reporting with monitoring off does nothing and throws nothing.
    captureFailure(new Error('nowhere to go'), 'GET /healthz');
    // The sweep still runs, and checks in nowhere.
    const run = vi.fn(() => Promise.resolve({ expired: 0, wentSilent: 0 }));
    await sweepTicks(run);
    expect(run).toHaveBeenCalledTimes(1);
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

    await sweepTicks(() => Promise.reject(new Error('the expiry pass failed')));
    await Sentry.flush(5000);

    const events = eventEnvelopes();
    expect(events).toHaveLength(2);
    expect(events.some((e) => e.includes('"route":"GET /v1/unavailable"'))).toBe(true);
    expect(events.some((e) => e.includes('"route":"sweep"'))).toBe(true);
  });

  it('checks each sweep in to its cron monitor: in progress, then ok or error', async () => {
    sent.length = 0;
    let calls = 0;
    // The first run succeeds, the second fails.
    await sweepTicks(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ expired: 0, wentSilent: 0 })
        : Promise.reject(new Error('the silence pass failed'));
    }, 2);
    await Sentry.flush(5000);

    const sentCheckIns = checkIns().map((body) => {
      const payload = JSON.parse(body.trim().split('\n').at(-1)!) as {
        check_in_id: string;
        monitor_slug: string;
        status: string;
        duration?: number;
        environment?: string;
        monitor_config?: { schedule: unknown; checkin_margin: number; max_runtime: number };
      };
      return payload;
    });
    expect(sentCheckIns.map((c) => c.status)).toEqual([
      'in_progress',
      'ok',
      'in_progress',
      'error',
    ]);
    expect(new Set(sentCheckIns.map((c) => c.monitor_slug))).toEqual(new Set([SWEEP_MONITOR_SLUG]));
    // Each run's closing check-in names its opening one, with a duration.
    expect(sentCheckIns[1]!.check_in_id).toBe(sentCheckIns[0]!.check_in_id);
    expect(sentCheckIns[3]!.check_in_id).toBe(sentCheckIns[2]!.check_in_id);
    expect(sentCheckIns[0]!.check_in_id).not.toBe(sentCheckIns[2]!.check_in_id);
    expect(typeof sentCheckIns[1]!.duration).toBe('number');
    expect(sentCheckIns[0]!.environment).toBe('dev');
    // The monitor's schedule rides along, so Sentry makes the monitor itself.
    expect(sentCheckIns[0]!.monitor_config).toMatchObject({
      schedule: { type: 'interval', value: 1, unit: 'minute' },
      checkin_margin: 2,
      max_runtime: 5,
    });
    // The failed run is still reported as an error, as before.
    expect(eventEnvelopes().some((e) => e.includes('"route":"sweep"'))).toBe(true);
  });
});
