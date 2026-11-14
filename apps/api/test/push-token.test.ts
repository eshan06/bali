import {
  type Database,
  deviceTokens,
  newUuidV7,
  PUSH_TOKENS_PER_STUDENT,
  registerPushToken,
  users,
} from '@bali/db';
import {
  type ApiErrorBody,
  FCM_TOKEN_MAX_LENGTH,
  type RegisterPushTokenResponse,
  type RemovePushTokenResponse,
} from '@bali/shared';
import { asc, eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthedApp, makeAuthedApp } from './helpers/app.js';
import { makeTestDb } from './helpers/db.js';

/*
 * PUT and DELETE /v1/me/push-token (N3): a student registers and removes its
 * phone's APNs token, idempotent on its eventId — or, naming the service
 * `fcm`, an Android phone's FCM token (AN11a). Each test makes its own
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
/** An FCM token no phone has registered yet, shaped as FCM's are: mixed case, `:`, `-` and `_`. */
const newFcmToken = () =>
  `fAb${randomBytes(8).toString('base64url')}:APA91b-${randomBytes(100).toString('base64url')}_Q`;

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
    const eventId = newUuidV7();
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
    const sent = { token, environment: 'production', eventId: newUuidV7() };
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
    await register(sub, { token, environment: 'sandbox', eventId: newUuidV7() });
    const eventId = newUuidV7();
    const res = await register(sub, { token, environment: 'production', eventId });
    expect(res.body).toEqual({ outcome: 'registered', environment: 'production' });
    expect(await rowOf(token)).toMatchObject({ environment: 'production', eventId });
    expect(await db.select().from(deviceTokens).where(eq(deviceTokens.token, token))).toHaveLength(
      1,
    );
  });

  it('applies only a register newer than the row’s: an older retry is a replay of the truth now', async () => {
    const first = fresh('ola');
    const second = fresh('pia');
    const token = newToken();
    // Minted in this order: the first account's register is the older, but the
    // newer one lands first, and the older one's retry after it.
    const older = { token, environment: 'sandbox', eventId: newUuidV7() };
    const newer = { token, environment: 'production', eventId: newUuidV7() };
    expect((await register(second, newer)).body.outcome).toBe('registered');
    const before = await rowOf(token);
    const late = await register(first, older);
    expect(late).toEqual({ status: 200, body: { outcome: 'replay', environment: 'production' } });
    // Nothing written: the token stays the newer register's, the second account's.
    expect(await rowOf(token)).toEqual(before);
    expect(before?.userId).toBe((await userOf(second)).id);

    // The same account, too: an older register never takes back the newer environment.
    const own = fresh('quin');
    const mine = newToken();
    const stale = newUuidV7();
    await register(own, { token: mine, environment: 'production', eventId: newUuidV7() });
    const res = await register(own, { token: mine, environment: 'sandbox', eventId: stale });
    expect(res.body).toEqual({ outcome: 'replay', environment: 'production' });
    expect((await rowOf(mine))?.environment).toBe('production');
  });

  it('moves a token another account registered to the caller: one phone, one owner', async () => {
    const first = fresh('dan');
    const second = fresh('eve');
    const token = newToken();
    await register(first, { token, environment: 'production', eventId: newUuidV7() });
    const res = await register(second, {
      token,
      environment: 'production',
      eventId: newUuidV7(),
    });
    expect(res.body.outcome).toBe('registered');
    expect((await rowOf(token))?.userId).toBe((await userOf(second)).id);
    // The first account no longer holds it: its removal touches nothing.
    const gone = await remove(first, { token, eventId: newUuidV7() });
    expect(gone.body).toEqual({ outcome: 'not_registered' });
    expect((await rowOf(token))?.userId).toBe((await userOf(second)).id);
  });

  it('refuses an eventId another token’s or another account’s register holds: 409, nothing written', async () => {
    const sub = fresh('fay');
    const token = newToken();
    const eventId = newUuidV7();
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
    const res = await register(sub, { token, environment: 'sandbox', eventId: newUuidV7() });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('forbidden');
    expect(await rowOf(token)).toBeUndefined();
  });

  it('refuses a call with no bearer token: 401', async () => {
    const res = await register(null, {
      token: newToken(),
      environment: 'sandbox',
      eventId: newUuidV7(),
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
      eventId: newUuidV7(),
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
    await register(sub, { token: newToken(), environment: 'sandbox', eventId: newUuidV7() });
    const user = await userOf(sub);
    await db.update(users).set({ removedAt: new Date() }).where(eq(users.id, user.id));
    const result = await registerPushToken(db, {
      userId: user.id,
      token: newToken(),
      environment: 'sandbox',
      eventId: newUuidV7(),
    });
    expect(result).toEqual({ outcome: 'account_deleted' });
  });
});

describe('DELETE /v1/me/push-token', () => {
  it('removes the caller’s token for good, and its retry answers not_registered', async () => {
    const sub = fresh('ida');
    const token = newToken();
    await register(sub, { token, environment: 'sandbox', eventId: newUuidV7() });
    const removal = { token: token.toUpperCase(), eventId: newUuidV7() };
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
    await register(owner, { token, environment: 'sandbox', eventId: newUuidV7() });
    const res = await remove(fresh('kim'), { token, eventId: newUuidV7() });
    expect(res.body).toEqual({ outcome: 'not_registered' });
    expect((await rowOf(token))?.userId).toBe((await userOf(owner)).id);
  });

  it('answers a caller the server has no account for: not_registered, and makes none', async () => {
    const sub = fresh('new');
    const res = await remove(sub, { token: newToken(), eventId: newUuidV7() });
    expect(res.body).toEqual({ outcome: 'not_registered' });
    expect(await db.select().from(users).where(eq(users.cognitoId, sub))).toEqual([]);
  });

  it('refuses an eventId a register holds: 409, nothing removed', async () => {
    const sub = fresh('lee');
    const token = newToken();
    const eventId = newUuidV7();
    await register(sub, { token, environment: 'sandbox', eventId });
    const res = await remove(sub, { token, eventId });
    expect(res.status).toBe(409);
    expect(res.body.error?.reason).toBe('event_id_conflict');
    expect(await rowOf(token)).toBeDefined();
  });

  it('refuses a teacher: 403', async () => {
    const sub = fresh('teacher');
    await db.insert(users).values({ cognitoId: sub, role: 'teacher' });
    const res = await remove(sub, { token: newToken(), eventId: newUuidV7() });
    expect(res.status).toBe(403);
  });

  it.each([
    ['a token that is not hex', { token: 'not-a-token' }],
    ['an eventId that is no UUID', { eventId: 'x' }],
    ['no body', undefined],
  ])('refuses %s: 400', async (_, change) => {
    const payload =
      change === undefined ? undefined : { token: newToken(), eventId: newUuidV7(), ...change };
    const res = await remove(fresh('mo'), payload as object);
    expect(res.status).toBe(400);
  });
});

describe('no service named: APNs’s, as every shipped iPhone sends it (AN11a)', () => {
  it('reads a register naming no service as APNs’s, and one naming apns the same', async () => {
    const sub = fresh('nia');
    const silent = newToken();
    await register(sub, { token: silent, environment: 'sandbox', eventId: newUuidV7() });
    expect(await rowOf(silent)).toMatchObject({ service: 'apns', environment: 'sandbox' });

    const named = newToken();
    const res = await register(sub, {
      service: 'apns',
      token: named.toUpperCase(),
      environment: 'production',
      eventId: newUuidV7(),
    });
    expect(res).toEqual({
      status: 200,
      body: { outcome: 'registered', environment: 'production' },
    });
    expect(await rowOf(named)).toMatchObject({ service: 'apns', environment: 'production' });
    const removal = { service: 'apns', token: named.toUpperCase(), eventId: newUuidV7() };
    expect((await remove(sub, removal)).body).toEqual({ outcome: 'removed' });
  });
});

describe('an FCM token: PUT and DELETE naming the service fcm (AN11a)', () => {
  /** A register of `token` as FCM's, under a fresh eventId unless one is given. */
  const fcm = (token: string, eventId = newUuidV7()) => ({
    service: 'fcm',
    token,
    environment: 'production',
    eventId,
  });

  it('registers it as the caller’s, kept as sent, never lower-cased, its environment production', async () => {
    const sub = fresh('fia');
    const token = newFcmToken();
    const eventId = newUuidV7();
    const res = await register(sub, fcm(token, eventId));
    expect(res).toEqual({
      status: 200,
      body: { outcome: 'registered', environment: 'production' },
    });
    expect(await rowOf(token)).toMatchObject({
      userId: (await userOf(sub)).id,
      service: 'fcm',
      environment: 'production',
      eventId,
    });
    // FCM's tokens tell case apart: lower-cased, it would be another phone's.
    expect(await rowOf(token.toLowerCase())).toBeUndefined();
  });

  it('answers a replay with the token now, and writes nothing again', async () => {
    const sub = fresh('gia');
    const token = newFcmToken();
    const sent = fcm(token);
    await register(sub, sent);
    const before = await rowOf(token);
    expect(await register(sub, sent)).toEqual({
      status: 200,
      body: { outcome: 'replay', environment: 'production' },
    });
    expect(await rowOf(token)).toEqual(before);
  });

  it('moves a token another account registered to the caller: one phone, one owner', async () => {
    const first = fresh('hugo');
    const second = fresh('iris');
    const token = newFcmToken();
    await register(first, fcm(token));
    expect((await register(second, fcm(token))).body.outcome).toBe('registered');
    expect((await rowOf(token))?.userId).toBe((await userOf(second)).id);
    // The first account no longer holds it: its removal touches nothing.
    const gone = await remove(first, { service: 'fcm', token, eventId: newUuidV7() });
    expect(gone.body).toEqual({ outcome: 'not_registered' });
    expect((await rowOf(token))?.userId).toBe((await userOf(second)).id);
  });

  it('removes the caller’s token as sent, case and all, and its retry answers not_registered', async () => {
    const sub = fresh('jade');
    const token = newFcmToken();
    await register(sub, fcm(token));
    // Another case is another token: nothing of the caller's is removed.
    const lower = { service: 'fcm', token: token.toLowerCase(), eventId: newUuidV7() };
    expect((await remove(sub, lower)).body).toEqual({ outcome: 'not_registered' });
    expect(await rowOf(token)).toBeDefined();

    const removal = { service: 'fcm', token, eventId: newUuidV7() };
    expect(await remove(sub, removal)).toEqual({ status: 200, body: { outcome: 'removed' } });
    expect(await rowOf(token)).toBeUndefined();
    expect(await remove(sub, removal)).toEqual({
      status: 200,
      body: { outcome: 'not_registered' },
    });
  });

  it('never removes another account’s token', async () => {
    const owner = fresh('kai');
    const token = newFcmToken();
    await register(owner, fcm(token));
    const res = await remove(fresh('lou'), { service: 'fcm', token, eventId: newUuidV7() });
    expect(res.body).toEqual({ outcome: 'not_registered' });
    expect((await rowOf(token))?.userId).toBe((await userOf(owner)).id);
  });

  it('refuses a teacher, 403, and a call with no bearer token, 401, both ways', async () => {
    const sub = fresh('teacher');
    await db.insert(users).values({ cognitoId: sub, role: 'teacher' });
    const token = newFcmToken();
    const put = await register(sub, fcm(token));
    expect(put.status).toBe(403);
    expect(put.body.error?.code).toBe('forbidden');
    const removal = { service: 'fcm', token, eventId: newUuidV7() };
    expect((await remove(sub, removal)).status).toBe(403);
    expect((await register(null, fcm(token))).status).toBe(401);
    expect((await remove(null, removal)).status).toBe(401);
    expect(await rowOf(token)).toBeUndefined();
  });

  it('takes the longest FCM token the API reads', async () => {
    const sub = fresh('max');
    const token = randomBytes((FCM_TOKEN_MAX_LENGTH / 4) * 3).toString('base64url');
    expect(token).toHaveLength(FCM_TOKEN_MAX_LENGTH);
    expect((await register(sub, fcm(token))).body.outcome).toBe('registered');
    expect((await rowOf(token))?.service).toBe('fcm');
  });

  it.each([
    ['a token with a character FCM’s have not', { token: 'fAb:APA91b.x' }],
    ['a token with a space', { token: 'fAb:APA91b x' }],
    ['a token too long', { token: 'A'.repeat(FCM_TOKEN_MAX_LENGTH + 1) }],
    ['an empty token', { token: '' }],
    ['a token an APNs token could be', { token: 'ab'.repeat(32) }],
    ['a token an APNs token could be, in capitals', { token: 'AB'.repeat(32) }],
    ['a service the API has not', { service: 'gcm' }],
    ['a service in capitals', { service: 'FCM' }],
    ['the sandbox, which FCM has not', { environment: 'sandbox' }],
    ['no environment', { environment: undefined }],
    ['an environment FCM has not', { environment: 'staging' }],
  ])('refuses a register with %s: 400, nothing written', async (_, change) => {
    const token = newFcmToken();
    const res = await register(fresh('wes'), { ...fcm(token), ...change });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('bad_input');
    // The refusal names the field, never echoes its value.
    const sent = 'token' in change && change.token ? change.token : token;
    expect(JSON.stringify(res.body)).not.toContain(sent);
    expect(await rowOf(token)).toBeUndefined();
    if ('token' in change) expect(await rowOf(change.token)).toBeUndefined();
  });

  it.each([
    ['a token with a character FCM’s have not', { token: 'fAb:APA91b/x' }],
    ['a token an APNs token could be', { token: 'cd'.repeat(32) }],
    ['a service the API has not', { service: 'gcm' }],
  ])('refuses a removal with %s: 400, nothing removed', async (_, change) => {
    const sub = fresh('xia');
    const token = newFcmToken();
    await register(sub, fcm(token));
    const res = await remove(sub, { service: 'fcm', token, eventId: newUuidV7(), ...change });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('bad_input');
    expect(await rowOf(token)).toBeDefined();
  });

  it('refuses an APNs token named FCM’s, and an FCM token sent as APNs’s: one token, one service', async () => {
    const sub = fresh('yan');
    const apns = newToken();
    const token = newFcmToken();
    expect((await register(sub, fcm(apns))).status).toBe(400);
    const asApns = await register(sub, { token, environment: 'production', eventId: newUuidV7() });
    expect(asApns.status).toBe(400);
    expect(await rowOf(apns)).toBeUndefined();
    expect(await rowOf(token)).toBeUndefined();
  });

  it('answers an FCM register that reached an account deleted on its way: 409 account_deleted', async () => {
    const sub = fresh('zed');
    await register(sub, fcm(newFcmToken()));
    const user = await userOf(sub);
    await db.update(users).set({ removedAt: new Date() }).where(eq(users.id, user.id));
    const result = await registerPushToken(db, {
      userId: user.id,
      service: 'fcm',
      token: newFcmToken(),
      environment: 'production',
      eventId: newUuidV7(),
    });
    expect(result).toEqual({ outcome: 'account_deleted' });
  });
});

describe('at most PUSH_TOKENS_PER_STUDENT tokens a student, both services together, the oldest let go (AN11a2)', () => {
  /**
   * Tokens in the order they are made, so a tie on `updated_at` (PGlite's clock counts whole
   * milliseconds) falls the way the registers went: the oldest is let go by `updated_at`, then
   * by token.
   */
  let order = 0;
  const nth = () => (order += 1).toString().padStart(8, '0');
  const apnsToken = () => `${nth()}${randomBytes(28).toString('hex')}`;
  const fcmToken = () => `${nth()}:APA91b-${randomBytes(30).toString('base64url')}`;
  const apns = (token: string, environment = 'sandbox') => ({
    token,
    environment,
    eventId: newUuidV7(),
  });
  const fcm = (token: string) => ({
    service: 'fcm',
    token,
    environment: 'production',
    eventId: newUuidV7(),
  });
  /** The account's tokens, in token order: the order they were made. */
  const tokensOf = async (sub: string) =>
    (
      await db
        .select({ token: deviceTokens.token })
        .from(deviceTokens)
        .where(eq(deviceTokens.userId, (await userOf(sub)).id))
        .orderBy(asc(deviceTokens.token))
    ).map((row) => row.token);
  /** `count` new APNs tokens, registered one after another as `sub`'s. */
  async function holding(sub: string, count = PUSH_TOKENS_PER_STUDENT) {
    const tokens = Array.from({ length: count }, apnsToken);
    for (const token of tokens) {
      expect((await register(sub, apns(token))).body.outcome).toBe('registered');
    }
    return tokens;
  }

  it('lets the oldest go when a register would make one more, each answer as it always was', async () => {
    const sub = fresh('cap');
    const tokens = Array.from({ length: PUSH_TOKENS_PER_STUDENT + 1 }, apnsToken);
    for (const token of tokens) {
      expect(await register(sub, apns(token))).toEqual({
        status: 200,
        body: { outcome: 'registered', environment: 'sandbox' },
      });
    }
    expect(await tokensOf(sub)).toEqual(tokens.slice(1));
    expect(await rowOf(tokens[0]!)).toBeUndefined();
  });

  it('refreshes a token the student holds when it is registered again, and lets nothing go', async () => {
    const sub = fresh('cap-again');
    const tokens = await holding(sub);
    const [oldest] = tokens as [string];
    const eventId = newUuidV7();
    const again = await register(sub, { token: oldest, environment: 'production', eventId });
    expect(again).toEqual({
      status: 200,
      body: { outcome: 'registered', environment: 'production' },
    });
    expect(await tokensOf(sub)).toEqual(tokens);
    expect(await rowOf(oldest)).toMatchObject({ environment: 'production', eventId });
    // Refreshed, it is the newest: the next new token lets the next oldest go instead.
    const next = apnsToken();
    await register(sub, apns(next));
    expect(await tokensOf(sub)).toEqual([oldest, ...tokens.slice(2), next]);
  });

  it('lets nothing go on a replay: the same eventId again, or an older register of a token that moved on', async () => {
    const sub = fresh('cap-replay');
    const other = fresh('cap-replay-other');
    const tokens = Array.from({ length: PUSH_TOKENS_PER_STUDENT }, apnsToken);
    const sent = tokens.map((token) => apns(token));
    for (const body of sent) await register(sub, body);
    expect(await register(sub, sent.at(-1)!)).toEqual({
      status: 200,
      body: { outcome: 'replay', environment: 'sandbox' },
    });
    expect(await tokensOf(sub)).toEqual(tokens);

    // The oldest changes hands, and a new token takes its place: the student at the cap again.
    await register(other, apns(tokens[0]!, 'production'));
    const next = apnsToken();
    await register(sub, apns(next));
    const atCap = [...tokens.slice(1), next];
    expect(await tokensOf(sub)).toEqual(atCap);
    // That token's first register, retried: older than the other account's, a replay of the truth.
    expect(await register(sub, sent[0]!)).toEqual({
      status: 200,
      body: { outcome: 'replay', environment: 'production' },
    });
    expect(await tokensOf(sub)).toEqual(atCap);
    expect(await tokensOf(other)).toEqual([tokens[0]]);
  });

  it('counts a token moved from another account against the caller, and leaves that account one fewer', async () => {
    const sub = fresh('cap-mover');
    const other = fresh('cap-moved');
    const theirs = await holding(other, 2);
    const mine = await holding(sub);
    expect(await register(sub, apns(theirs[1]!))).toEqual({
      status: 200,
      body: { outcome: 'registered', environment: 'sandbox' },
    });
    expect(await tokensOf(sub)).toEqual([theirs[1], ...mine.slice(1)]);
    expect(await tokensOf(other)).toEqual([theirs[0]]);
  });

  it('counts both services’ tokens together, letting the oldest go whichever its service', async () => {
    const sub = fresh('cap-both');
    const first = fcmToken();
    await register(sub, fcm(first));
    const held = await holding(sub, PUSH_TOKENS_PER_STUDENT - 1);
    // An APNs register past the cap lets the FCM token go…
    const nextApns = apnsToken();
    expect((await register(sub, apns(nextApns))).body).toEqual({
      outcome: 'registered',
      environment: 'sandbox',
    });
    expect(await tokensOf(sub)).toEqual([...held, nextApns]);
    expect(await rowOf(first)).toBeUndefined();
    // …and an FCM register past it, the oldest APNs token.
    const nextFcm = fcmToken();
    expect((await register(sub, fcm(nextFcm))).body).toEqual({
      outcome: 'registered',
      environment: 'production',
    });
    expect(await tokensOf(sub)).toEqual([...held.slice(1), nextApns, nextFcm]);
    expect(await rowOf(nextFcm)).toMatchObject({ service: 'fcm' });
  });
});
