import { type Database, deviceTokens, users } from '@bali/db';
import { DrizzleQueryError, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { serializeError } from '../src/redact.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

// Phase 6, S2: none of this may reach a log line.
const SECRETS = {
  name: 'Ada Lovelace',
  cognitoId: 'us-east-1:6f1c2d3e-cognito-sub',
  reason: 'left my inhaler in the locker',
  bearer: 'secret-bearer-token-xyz',
  internalKey: 'internal-key-abc-0123456789',
  cookie: 'session-cookie-value',
};

const lines: string[] = [];
const logStream = new Writable({
  write(chunk: Buffer, _encoding, done) {
    lines.push(chunk.toString());
    done();
  },
});
const logged = (): string => lines.join('');

const headers = {
  authorization: `Bearer ${SECRETS.bearer}`,
  'x-internal-key': SECRETS.internalKey,
  cookie: `session=${SECRETS.cookie}`,
};

let app: FastifyInstance;
let db: Database;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  app = buildApp(
    { ...testEnv, LOG_LEVEL: 'info' },
    {
      db,
      verifyToken: () => Promise.reject(ApiError.unauthorized()),
      logStream,
    },
  );
  // A real database failure: a unique violation, whose detail Postgres fills
  // with the row's value, with the other secrets riding as parameters.
  app.post('/v1/real-failure', async () => {
    await db.execute(sql`create temp table if not exists redact_probe (name text primary key)`);
    const insert = sql`insert into redact_probe (name) select ${SECRETS.name}
      where ${SECRETS.cognitoId} <> ${SECRETS.reason}`;
    await db.execute(insert);
    await db.execute(insert);
  });
  // The shape Drizzle throws, with every place a driver puts a value.
  app.post('/v1/drizzle-failure', () => {
    const cause = Object.assign(
      new Error(`invalid input syntax for type uuid: "${SECRETS.reason}"`),
      {
        code: '22P02',
        detail: `Failing row contains (${SECRETS.name}, ${SECRETS.cognitoId}).`,
        parameters: [SECRETS.name],
      },
    );
    throw new DrizzleQueryError(
      'insert into "unlocks" ("name", "cognito_sub", "reason") values ($1, $2, $3)',
      [SECRETS.name, SECRETS.cognitoId, SECRETS.reason],
      cause,
    );
  });
  // A handler that logs the whole headers object, as a careless one might.
  app.get('/v1/log-headers', (request) => {
    request.log.warn({ headers: request.headers }, 'headers seen');
    request.log.warn({ request: { headers: request.headers } }, 'nested headers seen');
    return { ok: true };
  });
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('log redaction', () => {
  it('logs a real database failure without its values, keeping the SQL and the class', async () => {
    lines.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/real-failure', headers });
    expect(res.statusCode).toBe(500);
    const out = logged();
    for (const secret of Object.values(SECRETS)) expect(out).not.toContain(secret);
    expect(out).toContain('"type":"DrizzleQueryError"');
    expect(out).toContain('insert into redact_probe (name) select $1');
    expect(out).toContain('params: [scrubbed]');
    expect(out).toContain('Key (name)=([scrubbed])');
    expect(out).toContain('"url":"/v1/real-failure"');
    expect(out).toContain('unhandled error');
  });

  it('drops params, driver parameters and echoed values from a Drizzle-style error', async () => {
    lines.length = 0;
    const res = await app.inject({ method: 'POST', url: '/v1/drizzle-failure', headers });
    expect(res.statusCode).toBe(500);
    const out = logged();
    for (const secret of Object.values(SECRETS)) expect(out).not.toContain(secret);
    const errLine = JSON.parse(lines.find((line) => line.includes('unhandled error'))!) as {
      err: Record<string, unknown> & { cause: Record<string, unknown> };
    };
    expect(errLine.err.type).toBe('DrizzleQueryError');
    expect(errLine.err.query).toBe(
      'insert into "unlocks" ("name", "cognito_sub", "reason") values ($1, $2, $3)',
    );
    expect(errLine.err).not.toHaveProperty('params');
    // The stack keeps its frames below the scrubbed message.
    expect(errLine.err.stack).toMatch(/params: \[scrubbed\]\n\s+at /);
    expect(errLine.err.cause).not.toHaveProperty('parameters');
    expect(errLine.err.cause.code).toBe('22P02');
    expect(errLine.err.cause.detail).toBe('Failing row contains ([scrubbed])');
    expect(errLine.err.cause.message).toBe('invalid input syntax for type uuid: [scrubbed]');
  });

  it('never logs the Authorization header, the internal key or a cookie', async () => {
    lines.length = 0;
    const res = await app.inject({ method: 'GET', url: '/v1/log-headers', headers });
    expect(res.statusCode).toBe(200);
    const out = logged();
    for (const secret of [SECRETS.bearer, SECRETS.internalKey, SECRETS.cookie]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('"authorization":"[redacted]"');
    expect(out).toContain('"x-internal-key":"[redacted]"');
    // The rest of the headers stay useful.
    expect(out).toContain('"host":"localhost:80"');
  });

  it('scrubs an error logged outside a request, and anything that is not an Error', () => {
    lines.length = 0;
    // As server.ts logs a failed start.
    app.log.error(
      new DrizzleQueryError('select $1', [SECRETS.cognitoId], new Error('connect failed')),
      'failed to start',
    );
    expect(logged()).not.toContain(SECRETS.cognitoId);
    expect(logged()).toContain('connect failed');
    expect(
      serializeError({
        params: [SECRETS.name],
        note: `params: ${SECRETS.name}`,
      } as unknown as Error),
    ).toEqual({
      note: 'params: [scrubbed]',
    });
  });

  it('cuts the other ways Postgres echoes a value, and never logs raw bytes', () => {
    const value = SECRETS.name;
    expect(
      serializeError({
        range: `value "${value}" is out of range for type integer`,
        date: `date/time field value out of range: "${value}"`,
        json: `invalid input syntax for type json`,
        detail: `Token "${value}" is invalid.`,
        where: `JSON data, line 1: ${value}`,
        bytes: Buffer.from(value),
      } as unknown as Error),
    ).toEqual({
      range: 'value [scrubbed] is out of range for type integer',
      date: 'date/time field value out of range: [scrubbed]',
      json: 'invalid input syntax for type json',
      detail: 'Token [scrubbed] is invalid.',
      where: 'JSON data, line 1: [scrubbed]',
      bytes: '[binary]',
    });
  });
});

// N3: a phone's APNs device token is personal data, and no log line holds one —
// not a request's, at the chattiest level, nor a database failure's.
describe('a device token', () => {
  const token = 'c0ffee'.repeat(10) + 'beef';
  let tokenApp: FastifyInstance;
  let issuer: TestIssuer;

  beforeAll(async () => {
    issuer = await makeTestIssuer();
    tokenApp = buildApp(
      { ...testEnv, LOG_LEVEL: 'trace' },
      { db, verifyToken: issuer.verifier, logStream },
    );
  });

  afterAll(async () => {
    await tokenApp.close();
  });

  it('never reaches a log line, registered, refused or removed', async () => {
    lines.length = 0;
    const authorization = `Bearer ${await issuer.sign({ sub: 'n3-log-redaction' })}`;
    const send = (method: 'PUT' | 'DELETE', payload: object) =>
      tokenApp.inject({ method, url: '/v1/me/push-token', headers: { authorization }, payload });
    const registered = await send('PUT', { token, environment: 'sandbox', eventId: randomUUID() });
    expect(registered.statusCode).toBe(200);
    const refused = await send('PUT', { token, environment: 'staging', eventId: randomUUID() });
    expect(refused.statusCode).toBe(400);
    expect((await send('DELETE', { token, eventId: randomUUID() })).statusCode).toBe(200);
    expect(logged()).toContain('"url":"/v1/me/push-token"');
    expect(logged()).not.toContain(token);
  });

  it('is cut from a database failure that names it', async () => {
    const [user] = await db
      .insert(users)
      .values({ cognitoId: 'n3-log-redaction-db', role: 'student' })
      .returning();
    const row = { token, userId: user!.id, environment: 'sandbox' as const };
    await db.insert(deviceTokens).values({ ...row, eventId: randomUUID() });
    const failure = await db
      .insert(deviceTokens)
      .values({ ...row, eventId: randomUUID() })
      .then(
        () => undefined,
        (err: unknown) => err as Error,
      );
    // Unscrubbed, it carries the token: as a parameter, and echoed in Postgres's detail.
    expect((failure as Error & { params: unknown[] }).params).toContain(token);
    expect(String((failure?.cause as { detail?: string }).detail)).toContain(token);
    lines.length = 0;
    tokenApp.log.error({ err: failure }, 'device token failure');
    expect(logged()).toContain('device_tokens_pkey');
    expect(logged()).not.toContain(token);
  });
});
