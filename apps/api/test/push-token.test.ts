import { type Database, deviceTokens, registerPushToken, users } from '@bali/db';
import type {
  ApiErrorBody,
  RegisterPushTokenResponse,
  RemovePushTokenResponse,
} from '@bali/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthedApp, makeAuthedApp } from './helpers/app.js';
import { makeTestDb } from './helpers/db.js';

/*
 * PUT and DELETE /v1/me/push-token (N3): a student registers and removes its
 * phone's APNs token, idempotent on its eventId. Each test makes its own
 * accounts and tokens, so they share one database. Who may call each, against
 * every caller: authorization-matrix.test.ts; that no log line holds a token:
 * log-redaction.test.ts.
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterAll(async () => {
  await ctx.close();
  await closeDb();
});

let made = 0;
/** A Cognito id no account has yet: a student on their first call. */
const fresh = (who: string) => `n3-${who}-${(made += 1)}`;
/** A token no phone has registered yet: 64 hex digits. */
const newToken = () => randomUUID().replace(/-/g, '').repeat(2);

/** Either route's answer: an outcome (and a register's environment), or the error shape. */
type Answer = {
  outcome?: RegisterPushTokenResponse['outcome'] | RemovePushTokenResponse['outcome'];
  environment?: RegisterPushTokenResponse['environment'];
  error?: ApiErrorBody['error'];
};

async function call(
  method: 'PUT' | 'DELETE',
  sub: string | null,
  payload?: object,
): Promise<{ status: number; body: Answer }> {
  const headers = sub === null ? {} : { authorization: `Bearer ${await ctx.issuer.sign({ sub })}` };
  const res = await ctx.app.inject({ method, url: '/v1/me/push-token', headers, payload });
  return { status: res.statusCode, body: res.json() };
}
const register = (sub: string | null, payload: object) => call('PUT', sub, payload);
const remove = (sub: string | null, payload: object) => call('DELETE', sub, payload);

const rowOf = async (token: string) =>
  (await db.select().from(deviceTokens).where(eq(deviceTokens.token, token)))[0];
const userOf = async (sub: string) =>
  (await db.select().from(users).where(eq(users.cognitoId, sub)))[0]!;

describe('PUT /v1/me/push-token', () => {
  it('registers the token as the caller’s, lower-cased, with its environment', async () => {
    const sub = fresh('ana');
    const token = newToken();
    const eventId = randomUUID();
    const res = await register(sub, {
      token: token.toUpperCase(),
      environment: 'sandbox',
      eventId,
    });
    expect(res).toEqual({ status: 200, body: { outcome: 'registered', environment: 'sandbox' } });
    const row = await rowOf(token);
    expect(row).toMatchObject({ userId: (await userOf(sub)).id, environment: 'sandbox', eventId });
  });

  it('answers a replay with the token now, and writes nothing again', async () => {
    const sub = fresh('ben');
    const token = newToken();
    const sent = { token, environment: 'production', eventId: randomUUID() };
    await register(sub, sent);
    const before = await rowOf(token);
    const again = await register(sub, sent);
    expect(again).toEqual({
      status: 200,
      body: { outcome: 'replay', environment: 'production' },
    });
    expect(await rowOf(token)).toEqual(before);
  });

  it('re-registers the caller’s own token under a new eventId, in its new environment', async () => {
    const sub = fresh('cara');
    const token = newToken();
    await register(sub, { token, environment: 'sandbox', eventId: randomUUID() });
    const eventId = randomUUID();
    const res = await register(sub, { token, environment: 'production', eventId });
    expect(res.body).toEqual({ outcome: 'registered', environment: 'production' });
    expect(await rowOf(token)).toMatchObject({ environment: 'production', eventId });
    expect(await db.select().from(deviceTokens).where(eq(deviceTokens.token, token))).toHaveLength(
      1,
    );
  });

  it('moves a token another account registered to the caller: one phone, one owner', async () => {
    const first = fresh('dan');
    const second = fresh('eve');
    const token = newToken();
    await register(first, { token, environment: 'production', eventId: randomUUID() });
    const res = await register(second, {
      token,
      environment: 'production',
      eventId: randomUUID(),
    });
    expect(res.body.outcome).toBe('registered');
    expect((await rowOf(token))?.userId).toBe((await userOf(second)).id);
    // The first account no longer holds it: its removal touches nothing.
    const gone = await remove(first, { token, eventId: randomUUID() });
    expect(gone.body).toEqual({ outcome: 'not_registered' });
    expect((await rowOf(token))?.userId).toBe((await userOf(second)).id);
  });

  it('refuses an eventId another token’s or another account’s register holds: 409, nothing written', async () => {
    const sub = fresh('fay');
    const token = newToken();
    const eventId = randomUUID();
    await register(sub, { token, environment: 'sandbox', eventId });

    const other = newToken();
    const sameId = await register(sub, { token: other, environment: 'sandbox', eventId });
    expect(sameId.status).toBe(409);
    expect(sameId.body.error).toMatchObject({ code: 'conflict', reason: 'event_id_conflict' });
    expect(await rowOf(other)).toBeUndefined();

    const someoneElse = await register(fresh('gus'), { token, environment: 'sandbox', eventId });
    expect(someoneElse.status).toBe(409);
    expect((await rowOf(token))?.userId).toBe((await userOf(sub)).id);
  });

  it('refuses a teacher: 403, nothing written', async () => {
    const sub = fresh('teacher');
    await db.insert(users).values({ cognitoId: sub, role: 'teacher' });
    const token = newToken();
    const res = await register(sub, { token, environment: 'sandbox', eventId: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('forbidden');
    expect(await rowOf(token)).toBeUndefined();
  });

  it('refuses a call with no bearer token: 401', async () => {
    const res = await register(null, {
      token: newToken(),
      environment: 'sandbox',
      eventId: randomUUID(),
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ['a token that is not hex', { token: 'z'.repeat(64) }],
    ['a token too short', { token: 'ab'.repeat(16) }],
    ['a token too long', { token: 'ab'.repeat(101) }],
    ['no token', { token: undefined }],
    ['an environment APNs has not', { environment: 'staging' }],
    ['an eventId that is no UUID', { eventId: 'x' }],
  ])('refuses %s: 400, nothing written', async (_, change) => {
    const token = newToken();
    const res = await register(fresh('val'), {
      token,
      environment: 'sandbox',
      eventId: randomUUID(),
      ...change,
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('bad_input');
    // The refusal names the field, never echoes its value.
    const sent = 'token' in change && change.token !== undefined ? change.token : token;
    expect(JSON.stringify(res.body)).not.toContain(sent);
    expect(await rowOf(token)).toBeUndefined();
  });

  it('answers a register that reached an account deleted on its way: 409 account_deleted', async () => {
    const sub = fresh('hal');
    await register(sub, { token: newToken(), environment: 'sandbox', eventId: randomUUID() });
    const user = await userOf(sub);
    await db.update(users).set({ removedAt: new Date() }).where(eq(users.id, user.id));
    const result = await registerPushToken(db, {
      userId: user.id,
      token: newToken(),
      environment: 'sandbox',
      eventId: randomUUID(),
    });
    expect(result).toEqual({ outcome: 'account_deleted' });
  });
});

describe('DELETE /v1/me/push-token', () => {
  it('removes the caller’s token for good, and its retry answers not_registered', async () => {
    const sub = fresh('ida');
    const token = newToken();
    await register(sub, { token, environment: 'sandbox', eventId: randomUUID() });
    const removal = { token: token.toUpperCase(), eventId: randomUUID() };
    expect((await remove(sub, removal)).body).toEqual({ outcome: 'removed' });
    expect(await rowOf(token)).toBeUndefined();
    expect(await remove(sub, removal)).toEqual({
      status: 200,
      body: { outcome: 'not_registered' },
    });
  });

  it('never removes another account’s token', async () => {
    const owner = fresh('jo');
    const token = newToken();
    await register(owner, { token, environment: 'sandbox', eventId: randomUUID() });
    const res = await remove(fresh('kim'), { token, eventId: randomUUID() });
    expect(res.body).toEqual({ outcome: 'not_registered' });
    expect((await rowOf(token))?.userId).toBe((await userOf(owner)).id);
  });

  it('answers a caller the server has no account for: not_registered, and makes none', async () => {
    const sub = fresh('new');
    const res = await remove(sub, { token: newToken(), eventId: randomUUID() });
    expect(res.body).toEqual({ outcome: 'not_registered' });
    expect(await db.select().from(users).where(eq(users.cognitoId, sub))).toEqual([]);
  });

  it('refuses an eventId a register holds: 409, nothing removed', async () => {
    const sub = fresh('lee');
    const token = newToken();
    const eventId = randomUUID();
    await register(sub, { token, environment: 'sandbox', eventId });
    const res = await remove(sub, { token, eventId });
    expect(res.status).toBe(409);
    expect(res.body.error?.reason).toBe('event_id_conflict');
    expect(await rowOf(token)).toBeDefined();
  });

  it('refuses a teacher: 403', async () => {
    const sub = fresh('teacher');
    await db.insert(users).values({ cognitoId: sub, role: 'teacher' });
    const res = await remove(sub, { token: newToken(), eventId: randomUUID() });
    expect(res.status).toBe(403);
  });

  it.each([
    ['a token that is not hex', { token: 'not-a-token' }],
    ['an eventId that is no UUID', { eventId: 'x' }],
    ['no body', undefined],
  ])('refuses %s: 400', async (_, change) => {
    const payload =
      change === undefined ? undefined : { token: newToken(), eventId: randomUUID(), ...change };
    const res = await remove(fresh('mo'), payload as object);
    expect(res.status).toBe(400);
  });
});
