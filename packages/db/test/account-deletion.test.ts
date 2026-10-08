import { sessionReport } from '@bali/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordAgeCheck } from '../src/age-checks.js';
import { registerPushToken } from '../src/device-tokens.js';
import { newUuidV7 } from '../src/ids.js';
import { createBlock, createClass } from '../src/management.js';
import { mintTeacherInvite, recordAgreement, redeemTeacherInvite } from '../src/schools.js';
import { getSessionEvents, getSessionRoster } from '../src/queries.js';
import {
  ageChecks,
  armedTaps,
  blocks,
  classes,
  deviceTokens,
  enrollments,
  events,
  participations,
  schools,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  armTap,
  deleteAccount,
  deletedCognitoId,
  endSession,
  joinClassByCode,
  renameStudent,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * C3: an account deletes itself through the engine. Each class is left as a
 * leave leaves it, in session too; the row keeps its id, so every event of
 * theirs still counts in its class's reports, but loses its name and its
 * Cognito subject; a rename's payload, the one place an event named them, is
 * emptied — the single rewrite migration 0015 lets through.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

const MIN = 60_000;
const fromNow = (ms: number) => new Date(Date.now() + ms);

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** A teacher with two classes, a student in both, and a classmate in the first. */
async function seed(tag: string) {
  const school = one(await db.insert(schools).values({ name: tag }).returning());
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const [ana, ben] = await db
    .insert(users)
    .values([
      { cognitoId: `ana-${tag}`, role: 'student', displayName: 'Ana' },
      { cognitoId: `ben-${tag}`, role: 'student', displayName: 'Ben' },
    ])
    .returning();
  const [first, second] = await db
    .insert(classes)
    .values([
      { teacherId: teacher.id, schoolId: school.id, name: '1', joinCode: `${tag}-1` },
      { teacherId: teacher.id, schoolId: school.id, name: '2', joinCode: `${tag}-2` },
    ])
    .returning();
  if (!ana || !ben || !first || !second) throw new Error('seed');
  await db.insert(enrollments).values([
    { classId: first.id, studentId: ana.id },
    { classId: second.id, studentId: ana.id },
    { classId: first.id, studentId: ben.id },
  ]);
  return { teacher, ana, ben, first, second };
}

/** A lesson in `classId`, 10 minutes in, both students tapped in, Ana unlocked at 5. */
async function lesson(classId: string, ana: string, ben: string) {
  const { session } = await startSession(db, {
    classId,
    startedAt: fromNow(-10 * MIN),
    endsAt: fromNow(30 * MIN),
  });
  for (const studentId of [ana, ben]) {
    await tapIn(db, {
      sessionId: session.id,
      studentId,
      eventId: newUuidV7(),
      deviceTime: fromNow(-10 * MIN),
    });
  }
  await unlock(db, {
    sessionId: session.id,
    studentId: ana,
    eventId: newUuidV7(),
    deviceTime: fromNow(-5 * MIN),
    reason: 'nurse',
  });
  return session;
}

const eventsOf = (userId: string) =>
  db.select().from(events).where(eq(events.userId, userId)).orderBy(events.seq);

describe('deleteAccount (C3)', () => {
  it('leaves every class, ends the lesson the student is in, and names them nowhere', async () => {
    const { ana, ben, first, second } = await seed('c3-live');
    await renameStudent(db, { studentId: ana.id, displayName: 'Ana P.', eventId: newUuidV7() });
    const session = await lesson(first.id, ana.id, ben.id);
    const eventId = newUuidV7();

    expect(await deleteAccount(db, { userId: ana.id, eventId, at: new Date() })).toEqual({
      outcome: 'deleted',
    });

    const row = one(await db.select().from(users).where(eq(users.id, ana.id)));
    expect(row).toMatchObject({ cognitoId: deletedCognitoId(ana.id), displayName: null });
    expect(row.removedAt).not.toBeNull();
    const left = await db.select().from(enrollments).where(eq(enrollments.studentId, ana.id));
    expect(left.map((e) => e.removedAt === null)).toEqual([false, false]);
    // In session, and still left: the participation ends on the lesson's feed.
    const part = one(
      await db
        .select()
        .from(participations)
        .where(and(eq(participations.sessionId, session.id), eq(participations.studentId, ana.id))),
    );
    expect(part.endedReason).toBe('left_class');

    const mine = await eventsOf(ana.id);
    const leaves = mine.filter((e) => e.type === 'enrollment_left');
    expect(leaves.map((e) => [e.classId, e.sessionId]).sort()).toEqual(
      [
        [first.id, session.id],
        [second.id, null],
      ].sort(),
    );
    const rename = one(mine.filter((e) => e.type === 'display_name_changed'));
    expect(rename.payload).toBeNull();
    const deleted = one(mine.filter((e) => e.type === 'account_deleted'));
    expect(deleted).toMatchObject({ eventId, payload: null, sessionId: null, classId: null });
    // No event anywhere still carries a name of theirs.
    const named = await db
      .select({ id: events.id })
      .from(events)
      .where(sql`${events.payload}::text ilike '%Ana%'`);
    expect(named).toHaveLength(0);

    // The grid still shows the lesson's record of them, named to no one.
    const roster = await getSessionRoster(db, session.id, first.id);
    expect(roster.find((r) => r.studentId === ana.id)).toMatchObject({ displayName: null });
    expect(roster.find((r) => r.studentId === ben.id)).toMatchObject({ displayName: 'Ben' });
  });

  it('leaves a finished lesson’s report exactly as it was', async () => {
    const { ana, ben, first } = await seed('c3-report');
    const session = await lesson(first.id, ana.id, ben.id);
    await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });
    const later = fromNow(60 * MIN);
    const ended = { ...session, endedAt: new Date() };
    const before = sessionReport(ended, await getSessionEvents(db, session.id), later);

    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at: new Date() });

    const after = sessionReport(ended, await getSessionEvents(db, session.id), later);
    expect(after).toEqual(before);
    expect(after.joined).toEqual([ana.id, ben.id]);
    expect(after.unlocks).toMatchObject([{ studentId: ana.id, reason: 'nurse' }]);
  });

  it('answers its retry, and nothing is written twice', async () => {
    const { ana } = await seed('c3-replay');
    const input = { userId: ana.id, eventId: newUuidV7(), at: new Date() };
    await deleteAccount(db, input);
    const written = (await eventsOf(ana.id)).length;

    expect(await deleteAccount(db, input)).toEqual({ outcome: 'already_deleted' });
    expect(await deleteAccount(db, { ...input, eventId: newUuidV7() })).toEqual({
      outcome: 'already_deleted',
    });
    expect(await eventsOf(ana.id)).toHaveLength(written);
  });

  it('takes a retry reaching an account the same sign-in made since: that one goes too', async () => {
    const { ana } = await seed('c3-reborn');
    const eventId = newUuidV7();
    await deleteAccount(db, { userId: ana.id, eventId, at: new Date() });
    // A boot call between the deletion and its retry made the sign-in a new row —
    // made after the deletion was recorded, stated outright: PGlite's clock is
    // coarse enough for the two stamps to tie, which the check reads as before.
    const recorded = one(
      await db.select().from(events).where(eq(events.eventId, eventId)),
    ).recordedAt;
    const reborn = one(
      await db
        .insert(users)
        .values({
          cognitoId: 'ana-c3-reborn',
          role: 'student',
          displayName: 'Ana',
          createdAt: new Date(recorded.getTime() + 1000),
        })
        .returning(),
    );

    expect(await deleteAccount(db, { userId: reborn.id, eventId, at: new Date() })).toEqual({
      outcome: 'deleted',
    });
    const row = one(await db.select().from(users).where(eq(users.id, reborn.id)));
    expect(row).toMatchObject({ cognitoId: deletedCognitoId(reborn.id), displayName: null });
    const deletion = one((await eventsOf(reborn.id)).filter((e) => e.type === 'account_deleted'));
    expect(deletion.eventId).not.toBe(eventId);
  });

  it('refuses another account’s deletion id when this account was there before it', async () => {
    const { ana, ben } = await seed('c3-foreign');
    const bens = newUuidV7();
    await deleteAccount(db, { userId: ben.id, eventId: bens, at: new Date() });

    await expect(
      deleteAccount(db, { userId: ana.id, eventId: bens, at: new Date() }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    const row = one(await db.select().from(users).where(eq(users.id, ana.id)));
    expect(row).toMatchObject({ cognitoId: 'ana-c3-foreign', displayName: 'Ana', removedAt: null });
  });

  it('refuses an id another event holds, and changes nothing', async () => {
    const { ana, ben } = await seed('c3-conflict');
    const taken = newUuidV7();
    await renameStudent(db, { studentId: ben.id, displayName: 'Ben B.', eventId: taken });

    await expect(
      deleteAccount(db, { userId: ana.id, eventId: taken, at: new Date() }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    const row = one(await db.select().from(users).where(eq(users.id, ana.id)));
    expect(row).toMatchObject({
      cognitoId: 'ana-c3-conflict',
      displayName: 'Ana',
      removedAt: null,
    });
  });

  it('consumes a tap of theirs still waiting for a Start, and leaves a classmate’s waiting', async () => {
    const { teacher, ana, ben, first } = await seed('c3-armed');
    for (const studentId of [ana.id, ben.id]) {
      await armTap(db, {
        studentId,
        teacherId: teacher.id,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        expiresAt: fromNow(60 * MIN),
      });
    }
    const at = new Date();
    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at });

    const waiting = (studentId: string) =>
      db.select().from(armedTaps).where(eq(armedTaps.studentId, studentId));
    expect(one(await waiting(ana.id)).consumedAt).toEqual(at);
    expect(one(await waiting(ben.id)).consumedAt).toBeNull();
    // The Start takes Ben's and weighs nothing of hers.
    const { session } = await startSession(db, {
      classId: first.id,
      startedAt: new Date(),
      endsAt: fromNow(30 * MIN),
    });
    const joined = await db
      .select({ studentId: participations.studentId })
      .from(participations)
      .where(eq(participations.sessionId, session.id));
    expect(joined).toEqual([{ studentId: ben.id }]);
  });

  it('deletes the device tokens of its phones, and leaves a classmate’s (N4)', async () => {
    const { ana, ben } = await seed('c3-tokens');
    const token = () => newUuidV7().replace(/-/g, '').repeat(2);
    const held = { ana: [token(), token()], ben: [token()] };
    for (const [student, tokens] of [
      [ana, held.ana],
      [ben, held.ben],
    ] as const) {
      for (const t of tokens) {
        await registerPushToken(db, {
          userId: student.id,
          token: t,
          environment: 'sandbox',
          eventId: newUuidV7(),
        });
      }
    }
    const tokensOf = async (userId: string) =>
      (await db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId))).map(
        (r) => r.token,
      );
    expect(await tokensOf(ana.id)).toHaveLength(2);

    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at: new Date() });

    expect(await tokensOf(ana.id)).toEqual([]);
    expect(await tokensOf(ben.id)).toEqual(held.ben);
    // A register that reaches the deleted account writes none back.
    const late = await registerPushToken(db, {
      userId: ana.id,
      token: token(),
      environment: 'sandbox',
      eventId: newUuidV7(),
    });
    expect(late).toEqual({ outcome: 'account_deleted' });
    expect(await tokensOf(ana.id)).toEqual([]);
  });

  it('deletes its 13+ yes, and leaves a classmate’s (C7-server)', async () => {
    const { ana, ben } = await seed('c3-age');
    for (const student of [ana, ben]) {
      expect(await recordAgeCheck(db, { userId: student.id, eventId: newUuidV7() })).toBe('passed');
    }
    const checksOf = (userId: string) =>
      db.select().from(ageChecks).where(eq(ageChecks.userId, userId));

    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at: new Date() });

    expect(await checksOf(ana.id)).toEqual([]);
    expect(await checksOf(ben.id)).toHaveLength(1);
    // A yes that reaches the deleted account records none back.
    const late = await recordAgeCheck(db, { userId: ana.id, eventId: newUuidV7() });
    expect(late).toBe('account_deleted');
    expect(await checksOf(ana.id)).toEqual([]);
  });

  it('refuses a teacher with a class or a block, and deletes one with neither', async () => {
    const { teacher } = await seed('c3-teacher');
    const refused = { code: 'TEACHER_HAS_CLASSES' };
    await expect(
      deleteAccount(db, { userId: teacher.id, eventId: newUuidV7(), at: new Date() }),
    ).rejects.toMatchObject(refused);

    const [blocked, bare] = await db
      .insert(users)
      .values([
        { cognitoId: 'c3-blocked', role: 'teacher' },
        { cognitoId: 'c3-bare', role: 'teacher' },
      ])
      .returning();
    await createBlock(db, { teacherId: blocked!.id, tagId: 'c3-tag' });
    await expect(
      deleteAccount(db, { userId: blocked!.id, eventId: newUuidV7(), at: new Date() }),
    ).rejects.toMatchObject(refused);
    expect(
      await deleteAccount(db, { userId: bare!.id, eventId: newUuidV7(), at: new Date() }),
    ).toEqual({ outcome: 'deleted' });
  });

  it('refuses a join, a rename or a tap that reaches the deleted account, and keeps a late unlock', async () => {
    const { ana, ben, first } = await seed('c3-after');
    const session = await lesson(first.id, ana.id, ben.id);
    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at: new Date() });
    const gone = { code: 'ACCOUNT_DELETED' };

    await expect(
      joinClassByCode(db, {
        studentId: ana.id,
        joinCode: first.joinCode,
        eventId: newUuidV7(),
        occurredAt: new Date(),
      }),
    ).rejects.toMatchObject(gone);
    await expect(
      renameStudent(db, { studentId: ana.id, displayName: 'Ana', eventId: newUuidV7() }),
    ).rejects.toMatchObject(gone);
    // A tap whose route found the class before the deletion joins no lesson as no one.
    await expect(
      tapIn(db, {
        sessionId: session.id,
        studentId: ana.id,
        eventId: newUuidV7(),
        deviceTime: new Date(),
      }),
    ).rejects.toMatchObject(gone);
    expect(
      await db
        .select()
        .from(participations)
        .where(and(eq(participations.studentId, ana.id), isNull(participations.endedAt))),
    ).toHaveLength(0);

    // Nor is one armed for no one: the route found the caller, then found no lesson.
    await expect(
      armTap(db, {
        studentId: ana.id,
        teacherId: first.teacherId,
        eventId: newUuidV7(),
        deviceTime: new Date(),
        expiresAt: fromNow(60 * MIN),
      }),
    ).rejects.toMatchObject(gone);
    expect(await db.select().from(armedTaps).where(eq(armedTaps.studentId, ana.id))).toHaveLength(
      0,
    );

    // A redeem that waited on the row spends no code on it.
    const school = one(await db.insert(schools).values({ name: 'c3-after-school' }).returning());
    await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-01' });
    const minted = await mintTeacherInvite(db, { schoolId: school.id });
    if (minted.outcome !== 'minted') throw new Error(minted.outcome);
    const redeem = { userId: ana.id, code: minted.code, eventId: newUuidV7() };
    expect(await redeemTeacherInvite(db, redeem)).toEqual({ outcome: 'account_deleted' });
    expect(one(await db.select().from(users).where(eq(users.id, ana.id))).role).toBe('student');

    // An unlock still on its way is never lost (ISSUES #2): recorded, moving no one.
    const late = await unlock(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    expect(late.outcome).toBe('recorded');
  });
});

describe('a deleted teacher (C3)', () => {
  it('is never given a class or a block', async () => {
    const school = one(await db.insert(schools).values({ name: 'c3-gone-teacher' }).returning());
    const teacher = one(
      await db
        .insert(users)
        .values({ cognitoId: 'c3-gone-teacher', role: 'teacher', schoolId: school.id })
        .returning(),
    );
    await deleteAccount(db, { userId: teacher.id, eventId: newUuidV7(), at: new Date() });
    const gone = { code: 'ACCOUNT_DELETED' };

    await expect(
      createClass(db, { teacherId: teacher.id, schoolId: school.id, name: 'late' }),
    ).rejects.toMatchObject(gone);
    await expect(
      createBlock(db, { teacherId: teacher.id, tagId: 'c3-gone-tag' }),
    ).rejects.toMatchObject(gone);
    expect(await db.select().from(classes).where(eq(classes.teacherId, teacher.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(blocks).where(eq(blocks.teacherId, teacher.id))).toHaveLength(0);
  });
});

describe('the history after migration 0015', () => {
  it('lets through only a deleted account’s rename losing its payload', async () => {
    const { ana, ben } = await seed('c3-trigger');
    for (const studentId of [ana.id, ben.id]) {
      await renameStudent(db, { studentId, displayName: `N-${studentId}`, eventId: newUuidV7() });
    }
    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at: new Date() });
    const rewrite = (userId: string, set: ReturnType<typeof sql>) =>
      db.execute(sql`update ${events} set ${set} where ${events.userId} = ${userId}
        and ${events.type} = 'display_name_changed'`);
    /** The database's own refusal, which the driver wraps in its error's `cause`. */
    async function refused(write: Promise<unknown>) {
      const err = await write.then(
        () => null,
        (e: unknown) => e,
      );
      const messages: string[] = [];
      for (let e = err; e instanceof Error; e = e.cause) messages.push(e.message);
      expect(messages.join('\n')).toMatch(/events is append-only/);
    }

    // A live account's rename keeps its names.
    await refused(rewrite(ben.id, sql`payload = null`));
    // A deleted one's: nothing but the payload, and only emptied.
    await refused(rewrite(ana.id, sql`payload = '{"x":1}'::jsonb`));
    await refused(rewrite(ana.id, sql`user_id = ${ben.id}, payload = null`));
    await refused(rewrite(ana.id, sql`occurred_at = now()`));
    await expect(rewrite(ana.id, sql`payload = null`)).resolves.toBeDefined();
    // Any other event of theirs, and any DELETE, as before.
    await refused(
      db.execute(sql`update ${events} set payload = null where ${events.userId} = ${ana.id}
        and ${events.type} = 'account_deleted'`),
    );
    await refused(db.execute(sql`delete from ${events} where ${events.userId} = ${ana.id}`));
  });
});
