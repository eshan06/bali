import { ageChecks, type Database, newUuidV7, recordAgeCheck, users } from '@bali/db';
import type { AgeCheckResponse, ApiErrorBody } from '@bali/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthedApp, makeAuthedApp } from './helpers/app.js';
import { makeTestDb } from './helpers/db.js';

/*
 * GET and PUT /v1/me/age-check (C7-server): the 13+ yes, kept per account. Each
 * test makes its own accounts, so they share one database. Who may call each,
 * against every caller: authorization-matrix.test.ts.
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
/** A Cognito id no account has yet: someone on their first call. */
const fresh = (who: string) => `c7-${who}-${(made += 1)}`;

type Answer = Partial<AgeCheckResponse> & { outcome?: string; error?: ApiErrorBody['error'] };

async function call(
  method: 'GET' | 'PUT' | 'DELETE',
  url: string,
  sub: string | null,
  payload?: object,
): Promise<{ status: number; body: Answer }> {
  const headers = sub === null ? {} : { authorization: `Bearer ${await ctx.issuer.sign({ sub })}` };
  const res = await ctx.app.inject({ method, url, headers, payload });
  return { status: res.statusCode, body: res.json() };
}
const read = (sub: string | null) => call('GET', '/v1/me/age-check', sub);
const record = (sub: string | null, payload?: object) =>
  call('PUT', '/v1/me/age-check', sub, payload);
/** The boot call, which makes the account. */
const boot = (sub: string) => call('GET', '/v1/me', sub);

const accountOf = async (sub: string) =>
  (await db.select().from(users).where(eq(users.cognitoId, sub)))[0];
const checksOf = (userId: string) =>
  db.select().from(ageChecks).where(eq(ageChecks.userId, userId));
const passed = { status: 200, body: { passed: true } };

describe('GET /v1/me/age-check', () => {
  it('answers a sign-in with no account here false, and creates nothing', async () => {
    const sub = fresh('new');
    expect(await read(sub)).toEqual({ status: 200, body: { passed: false } });
    expect(await accountOf(sub)).toBeUndefined();
  });

  it('answers a student who has not passed false, and one who has true', async () => {
    const sub = fresh('ana');
    await boot(sub);
    expect((await read(sub)).body).toEqual({ passed: false });
    await record(sub, { eventId: newUuidV7() });
    expect(await read(sub)).toEqual(passed);
  });

  it('answers a teacher true, though no yes is recorded: never asked', async () => {
    const sub = fresh('teacher');
    await db.insert(users).values({ cognitoId: sub, role: 'teacher' });
    expect(await read(sub)).toEqual(passed);
  });

  it('answers a deleted account false, and makes no new one', async () => {
    const sub = fresh('gone');
    await record(sub, { eventId: newUuidV7() });
    const account = await accountOf(sub);
    const deletion = await call('DELETE', '/v1/me', sub, { eventId: newUuidV7() });
    expect(deletion.body).toEqual({ outcome: 'deleted' });
    expect(await checksOf(account!.id)).toEqual([]);

    expect(await read(sub)).toEqual({ status: 200, body: { passed: false } });
    expect(await accountOf(sub)).toBeUndefined();
  });

  it('refuses a call with no bearer token: 401', async () => {
    expect((await read(null)).status).toBe(401);
  });
});

describe('PUT /v1/me/age-check', () => {
  it('records the yes, making the account as the boot call would', async () => {
    const sub = fresh('ben');
    const eventId = newUuidV7();
    expect(await record(sub, { eventId })).toEqual(passed);
    const account = await accountOf(sub);
    expect(account).toMatchObject({ role: 'student', removedAt: null });
    expect(await checksOf(account!.id)).toMatchObject([{ userId: account!.id, eventId }]);
  });

  it('answers a replay passed, and writes nothing again', async () => {
    const sub = fresh('cara');
    const sent = { eventId: newUuidV7() };
    await record(sub, sent);
    const account = await accountOf(sub);
    const before = await checksOf(account!.id);
    expect(await record(sub, sent)).toEqual(passed);
    expect(await checksOf(account!.id)).toEqual(before);
  });

  it('answers a second yes under a new eventId passed, keeping the first', async () => {
    const sub = fresh('dan');
    const first = newUuidV7();
    await record(sub, { eventId: first });
    expect(await record(sub, { eventId: newUuidV7() })).toEqual(passed);
    expect(await checksOf((await accountOf(sub))!.id)).toMatchObject([{ eventId: first }]);
  });

  it('refuses an eventId another account’s yes holds: 409, nothing recorded', async () => {
    const owner = fresh('eve');
    const eventId = newUuidV7();
    await record(owner, { eventId });
    const other = fresh('fay');
    const res = await record(other, { eventId });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'conflict', reason: 'event_id_conflict' });
    expect(await checksOf((await accountOf(other))!.id)).toEqual([]);
    expect((await read(other)).body).toEqual({ passed: false });
  });

  it('answers a teacher passed, and records nothing', async () => {
    const sub = fresh('teacher');
    const [teacher] = await db
      .insert(users)
      .values({ cognitoId: sub, role: 'teacher' })
      .returning();
    expect(await record(sub, { eventId: newUuidV7() })).toEqual(passed);
    expect(await checksOf(teacher!.id)).toEqual([]);
  });

  it('refuses a call with no bearer token: 401', async () => {
    expect((await record(null, { eventId: newUuidV7() })).status).toBe(401);
  });

  it.each([
    ['an eventId that is no UUID', { eventId: 'x' }],
    ['no eventId', {}],
    ['no body', undefined],
  ])('refuses %s: 400, and makes no account', async (_, payload) => {
    const sub = fresh('val');
    const res = await record(sub, payload);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('bad_input');
    expect(await accountOf(sub)).toBeUndefined();
  });

  it('answers a yes that reached an account deleted on its way: account_deleted, nothing recorded', async () => {
    const sub = fresh('hal');
    await boot(sub);
    const account = (await accountOf(sub))!;
    await db.update(users).set({ removedAt: new Date() }).where(eq(users.id, account.id));
    expect(await recordAgeCheck(db, { userId: account.id, eventId: newUuidV7() })).toBe(
      'account_deleted',
    );
    expect(await checksOf(account.id)).toEqual([]);
  });
});
