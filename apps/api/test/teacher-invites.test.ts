import {
  classes,
  createSchool,
  type Database,
  enrollments,
  findUserByCognitoId,
  formatInviteCode,
  mintTeacherInvite,
  recordAgreement,
  teacherInvites,
  users,
} from '@bali/db';
import type {
  ApiErrorBody,
  ClassDetail,
  MeResponse,
  RedeemTeacherInviteResponse,
} from '@bali/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthedApp, makeAuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * POST /v1/teacher-invites/redeem (Phase 4 · T1b): a signed-in account redeems
 * the invite code the owner minted for a school and becomes a teacher there, in
 * one step, idempotent on its eventId. Each test makes its own school, code and
 * accounts, so they share one database. The rate limits on it, with small
 * budgets: rate-limits.test.ts; two accounts racing for one code, on real
 * Postgres: packages/db/test/races.test.ts.
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

let accounts = 0;
/** A Cognito id no account has yet. */
const fresh = (who: string) => `t1b-${who}-${(accounts += 1)}`;

/** A school with its data agreement on record, and a code minted for it, as the command prints it. */
async function invite(name = 'Lincoln High') {
  const school = await createSchool(db, { name });
  await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-30' });
  const minted = await mintTeacherInvite(db, { schoolId: school.id });
  if (minted.outcome !== 'minted') throw new Error(`no invite: ${minted.outcome}`);
  return { school, invite: minted.invite, code: formatInviteCode(minted.code) };
}

/** No invite has it, though it is shaped as one: 25 symbols of the alphabet. */
const NO_INVITE = 'ABCDE-FGHJK-MNPQR-STUVW-XYZ23';

async function redeem(
  sub: string,
  payload?: object,
  claims?: Record<string, unknown>,
): Promise<{ status: number; body: RedeemTeacherInviteResponse & ApiErrorBody }> {
  const token = await ctx.issuer.sign({ sub, extraClaims: claims });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/teacher-invites/redeem',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  return { status: res.statusCode, body: res.json() };
}

const inviteRow = async (id: string) =>
  (await db.select().from(teacherInvites).where(eq(teacherInvites.id, id)))[0];

/** An account as the database has it: what a refusal must leave as it was. */
const accountOf = (sub: string) => findUserByCognitoId(db, sub);

describe('POST /v1/teacher-invites/redeem', () => {
  it('makes a fresh account a teacher at the code’s school, as /v1/me then says, able to make a class', async () => {
    const { school, invite: minted, code } = await invite();
    const sub = fresh('rivera');
    const eventId = randomUUID();

    // The account's first call: its row is made as the boot call makes it, name included.
    const { status, body } = await redeem(sub, { code, eventId }, { name: 'Ms. Rivera' });

    expect(status).toBe(200);
    const teacher = await accountOf(sub);
    expect(body).toEqual({
      outcome: 'redeemed',
      user: { id: teacher!.id, role: 'teacher', displayName: 'Ms. Rivera' },
    });
    expect(teacher).toMatchObject({ role: 'teacher', schoolId: school.id });
    const row = await inviteRow(minted.id);
    expect(row).toMatchObject({ redeemedBy: teacher!.id, redeemEventId: eventId });
    expect(row?.redeemedAt).toBeInstanceOf(Date);

    const token = await ctx.tokenFor(sub);
    const headers = { authorization: `Bearer ${token}` };
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers });
    expect(me.json<MeResponse>().user).toEqual(body.user);
    const made = await ctx.app.inject({
      method: 'POST',
      url: '/v1/classes',
      headers,
      payload: { name: 'Period 1' },
    });
    expect(made.statusCode).toBe(200);
    const [klass] = await db
      .select()
      .from(classes)
      .where(eq(classes.id, made.json<ClassDetail>().id));
    expect(klass).toMatchObject({ teacherId: teacher!.id, schoolId: school.id });
  });

  it.each([
    ['lower case', (code: string) => code.toLowerCase()],
    ['in groups split by spaces', (code: string) => code.replaceAll('-', ' ')],
    ['run together', (code: string) => code.replaceAll('-', '')],
    ['with en dashes, pasted from a document', (code: string) => code.replaceAll('-', '–')],
    ['with a paste’s space around it', (code: string) => ` \t${code}\n `],
  ])('matches the code typed %s', async (_, typed) => {
    const { code } = await invite();
    const { status, body } = await redeem(fresh('typed'), {
      code: typed(code),
      eventId: randomUUID(),
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('redeemed');
  });

  it('answers a replay with the account now, and never redeems again — whatever code it carries', async () => {
    const first = await invite();
    const second = await invite();
    const sub = fresh('replay');
    const sent = { code: first.code, eventId: randomUUID() };
    const redeemed = await redeem(sub, sent);
    const takenAt = (await inviteRow(first.invite.id))?.redeemedAt;

    const replayed = await redeem(sub, sent);
    expect(replayed).toEqual({ status: 200, body: { ...redeemed.body, outcome: 'replay' } });
    expect((await inviteRow(first.invite.id))?.redeemedAt).toEqual(takenAt);

    // The same eventId with another code is the same redeem, retried: the second stays free.
    const again = await redeem(sub, { ...sent, code: second.code });
    expect(again.body.outcome).toBe('replay');
    expect((await inviteRow(second.invite.id))?.redeemedAt).toBeNull();
    expect((await accountOf(sub))?.schoolId).toBe(first.school.id);
  });

  it('refuses a code another account redeemed: 409 invite_used, nothing changed', async () => {
    const { code } = await invite();
    await redeem(fresh('first'), { code, eventId: randomUUID() });
    const sub = fresh('second');

    const { status, body } = await redeem(sub, { code, eventId: randomUUID() });

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'conflict', reason: 'invite_used' });
    expect(await accountOf(sub)).toMatchObject({ role: 'student', schoolId: null });
  });

  it('refuses a code past its 14 days: 409 invite_expired, nothing changed', async () => {
    const { invite: minted, code } = await invite();
    // Staged: an hour past its expiry, by the database's clock that judges it.
    const ago = new Date(Date.now() - 60 * 60 * 1000);
    await db.update(teacherInvites).set({ expiresAt: ago }).where(eq(teacherInvites.id, minted.id));
    const sub = fresh('late');

    const { status, body } = await redeem(sub, { code, eventId: randomUUID() });

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'conflict', reason: 'invite_expired' });
    expect(await accountOf(sub)).toMatchObject({ role: 'student', schoolId: null });
    expect((await inviteRow(minted.id))?.redeemedAt).toBeNull();
  });

  it('refuses a code no invite has: 404 invite_not_found, nothing changed', async () => {
    const sub = fresh('unknown');
    const { status, body } = await redeem(sub, { code: NO_INVITE, eventId: randomUUID() });
    expect(status).toBe(404);
    expect(body.error).toMatchObject({ code: 'not_found', reason: 'invite_not_found' });
    expect(await accountOf(sub)).toMatchObject({ role: 'student', schoolId: null });
  });

  it('refuses a student in a live class, telling them to use a separate account: 409 student_in_class, nothing changed', async () => {
    const { student } = await seedClassroom(db, fresh('enrolled'));
    const { invite: minted, code } = await invite();

    const { status, body } = await redeem(student.cognitoId, { code, eventId: randomUUID() });

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'conflict', reason: 'student_in_class' });
    expect(body.error.message).toMatch(/use a separate account for teaching/);
    expect(await accountOf(student.cognitoId)).toEqual(student);
    expect((await inviteRow(minted.id))?.redeemedAt).toBeNull();
  });

  it('lets a student whose classes are behind them redeem: left, or the class archived', async () => {
    const left = await seedClassroom(db, fresh('left'));
    await db
      .update(enrollments)
      .set({ removedAt: new Date() })
      .where(eq(enrollments.studentId, left.student.id));
    const archived = await seedClassroom(db, fresh('archived'));
    await db
      .update(classes)
      .set({ removedAt: new Date() })
      .where(eq(classes.id, archived.klass.id));

    for (const { student } of [left, archived]) {
      const { school, code } = await invite();
      const { status, body } = await redeem(student.cognitoId, { code, eventId: randomUUID() });
      expect(status).toBe(200);
      expect(body.user.role).toBe('teacher');
      expect((await accountOf(student.cognitoId))?.schoolId).toBe(school.id);
    }
  });

  it('refuses an account that is a teacher already: 409 already_teacher, the code left free', async () => {
    const { teacher } = await seedClassroom(db, fresh('teacher'));
    const { invite: minted, code } = await invite();

    const { status, body } = await redeem(teacher.cognitoId, { code, eventId: randomUUID() });

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'conflict', reason: 'already_teacher' });
    expect(await accountOf(teacher.cognitoId)).toEqual(teacher);
    expect((await inviteRow(minted.id))?.redeemedAt).toBeNull();
  });

  it('refuses an eventId another account’s redeem holds: 409 event_id_conflict, nothing changed', async () => {
    const eventId = randomUUID();
    await redeem(fresh('holder'), { code: (await invite()).code, eventId });
    const { invite: minted, code } = await invite();
    const sub = fresh('reuser');

    const { status, body } = await redeem(sub, { code, eventId });

    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'conflict', reason: 'event_id_conflict' });
    expect(await accountOf(sub)).toMatchObject({ role: 'student', schoolId: null });
    expect((await inviteRow(minted.id))?.redeemedAt).toBeNull();
  });

  it.each([
    ['too short', 'ABCDE-FGHJK-MNPQR-STUVW'],
    ['too long', `${NO_INVITE}-ABCDE`],
    ['with a symbol no code has', NO_INVITE.replace('B', 'O')],
    ['far too long to be one', 'A'.repeat(65)],
    ['blank', '  '],
  ])('refuses a code %s: 400 invite_code_invalid, before anything is made', async (_, code) => {
    const sub = fresh('typo');
    const { status, body } = await redeem(sub, { code, eventId: randomUUID() });
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: 'bad_input', reason: 'invite_code_invalid' });
    expect(await accountOf(sub)).toBeUndefined();
  });

  it.each([
    ['an eventId that is no UUID', { code: NO_INVITE, eventId: 'not-a-uuid' }],
    ['no eventId', { code: NO_INVITE }],
    ['no code', { eventId: randomUUID() }],
    ['a code that is no string', { code: 12345, eventId: randomUUID() }],
    ['no body', undefined],
  ])('refuses %s: 400 invalid_request, before anything is made', async (_, payload) => {
    const sub = fresh('malformed');
    const { status, body } = await redeem(sub, payload);
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: 'bad_input', reason: 'invalid_request' });
    expect(await accountOf(sub)).toBeUndefined();
  });

  it('refuses a request with no token: 401, the code left free', async () => {
    const { invite: minted, code } = await invite();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/teacher-invites/redeem',
      payload: { code, eventId: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
    expect((await inviteRow(minted.id))?.redeemedAt).toBeNull();
  });

  it('keeps an account a teacher at its first school: a second code is already_teacher', async () => {
    const first = await invite();
    const second = await invite();
    const sub = fresh('twice');
    await redeem(sub, { code: first.code, eventId: randomUUID() });

    const { status, body } = await redeem(sub, { code: second.code, eventId: randomUUID() });

    expect(status).toBe(409);
    expect(body.error.reason).toBe('already_teacher');
    const [row] = await db.select().from(users).where(eq(users.cognitoId, sub));
    expect(row?.schoolId).toBe(first.school.id);
    expect((await inviteRow(second.invite.id))?.redeemedAt).toBeNull();
  });
});
