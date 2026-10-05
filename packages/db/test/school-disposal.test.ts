import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { createBlock } from '../src/management.js';
import { findOrCreateStudent } from '../src/queries.js';
import { parseSchoolCommand } from '../src/school-command.js';
import * as schema from '../src/schema.js';
import {
  armedTaps,
  blocks,
  classes,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  teacherInvites,
  users,
} from '../src/schema.js';
import { mintTeacherInvite, recordAgreement, redeemTeacherInvite } from '../src/schools.js';
import { makeTestDb } from '../src/testing.js';
import {
  armTap,
  deletedCognitoId,
  disposeSchool,
  joinClassByCode,
  renameStudent,
  SCHOOL_DISPOSAL_COVERAGE,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * C6a: one school's data disposed of on its written request. Every person of
 * it de-identified, its classes, blocks, open invites and pre-bell taps gone,
 * logged by counts alone; another school untouched.
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

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/**
 * A school whose teacher came by an invite, with a block, a second invite still
 * open, two classes, Ana (renamed) and Ben in a lesson that is over, Ana's
 * unlock in it, and Ben's tap waiting for the teacher's next Start.
 */
async function seed(tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `School ${tag}` })
      .returning(),
  );
  await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-01' });
  const minted = await mintTeacherInvite(db, { schoolId: school.id });
  if (minted.outcome !== 'minted') throw new Error('seed: mint');
  const signedUp = one(
    await db
      .insert(users)
      .values({ cognitoId: `teacher-${tag}`, role: 'student', displayName: `Ms Rivera ${tag}` })
      .returning(),
  );
  const redeemed = await redeemTeacherInvite(db, {
    userId: signedUp.id,
    code: minted.code,
    eventId: newUuidV7(),
  });
  if (redeemed.outcome !== 'redeemed') throw new Error('seed: redeem');
  const teacher = redeemed.user;
  const open = await mintTeacherInvite(db, { schoolId: school.id });
  if (open.outcome !== 'minted') throw new Error('seed: mint open');
  const registered = await createBlock(db, { teacherId: teacher.id, tagId: `tag-${tag}` });
  if (registered.outcome === 'tag_taken') throw new Error('seed: block');
  const block = registered.block;

  const [ana, ben] = await db
    .insert(users)
    .values([
      { cognitoId: `ana-${tag}`, role: 'student', displayName: `Ana ${tag}` },
      { cognitoId: `ben-${tag}`, role: 'student', displayName: `Ben ${tag}` },
    ])
    .returning();
  const [first, second] = await db
    .insert(classes)
    .values([
      { teacherId: teacher.id, schoolId: school.id, name: `Biology ${tag}`, joinCode: `${tag}-1` },
      { teacherId: teacher.id, schoolId: school.id, name: `Chem ${tag}`, joinCode: `${tag}-2` },
    ])
    .returning();
  if (!ana || !ben || !first || !second) throw new Error('seed');
  await db.insert(enrollments).values([
    { classId: first.id, studentId: ana.id },
    { classId: second.id, studentId: ana.id },
    { classId: first.id, studentId: ben.id },
  ]);
  await renameStudent(db, { studentId: ana.id, displayName: `Ana P ${tag}`, eventId: newUuidV7() });
  // A lesson whose bell has rung, not yet swept, with no one in it; and one running.
  const { session } = await startSession(db, {
    classId: first.id,
    startedAt: fromNow(-50 * MIN),
    endsAt: fromNow(-5 * MIN),
  });
  const lesson = await startSession(db, {
    classId: second.id,
    startedAt: fromNow(-10 * MIN),
    endsAt: fromNow(30 * MIN),
  });
  await tapIn(db, {
    sessionId: lesson.session.id,
    studentId: ana.id,
    eventId: newUuidV7(),
    deviceTime: new Date(),
    order: { install: newUuidV7(), seq: 1 },
  });
  await unlock(db, {
    sessionId: lesson.session.id,
    studentId: ana.id,
    eventId: newUuidV7(),
    deviceTime: new Date(),
    reason: 'nurse',
  });
  return { school, teacher, block, ana, ben, first, second, past: session, lesson: lesson.session };
}

/** End a lesson the seed left running, by moving its bell into the past (the sweep's case). */
async function pastBell(sessionId: string) {
  const { backdateSessionEnd } = await import('../src/testing.js');
  await backdateSessionEnd(db, { sessionId }, fromNow(-1 * MIN));
}

async function armBen(s: Awaited<ReturnType<typeof seed>>) {
  await armTap(db, {
    studentId: s.ben.id,
    teacherId: s.teacher.id,
    blockId: s.block.id,
    eventId: newUuidV7(),
    deviceTime: new Date(),
    expiresAt: fromNow(60 * MIN),
  });
}

/** Every row of the tables a disposal could touch, for the school's people and classes. */
async function rowsOf(s: { school: { id: string }; teacher: { id: string } }) {
  const classRows = await db.select().from(classes).where(eq(classes.schoolId, s.school.id));
  const classIds = classRows.map((c) => c.id);
  const enrolled = await db
    .select()
    .from(enrollments)
    .where(inArray(enrollments.classId, classIds));
  const peopleIds = [s.teacher.id, ...enrolled.map((e) => e.studentId)];
  return {
    school: await db.select().from(schools).where(eq(schools.id, s.school.id)),
    users: await db.select().from(users).where(inArray(users.id, peopleIds)),
    classes: classRows,
    enrollments: enrolled,
    sessions: await db.select().from(sessions).where(inArray(sessions.classId, classIds)),
    participations: await db
      .select()
      .from(participations)
      .where(inArray(participations.studentId, peopleIds)),
    events: await db.select().from(events).where(inArray(events.userId, peopleIds)),
    blocks: await db.select().from(blocks).where(eq(blocks.teacherId, s.teacher.id)),
    invites: await db.select().from(teacherInvites).where(eq(teacherInvites.schoolId, s.school.id)),
    armed: await db.select().from(armedTaps).where(eq(armedTaps.teacherId, s.teacher.id)),
  };
}

describe('the disposal’s coverage of the schema', () => {
  it('handles every foreign key to users or schools', () => {
    const keyed: string[] = [];
    for (const table of Object.values(schema)) {
      if (!(table instanceof PgTable)) continue;
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        const ref = fk.reference();
        if (!['users', 'schools'].includes(getTableConfig(ref.foreignTable).name)) continue;
        for (const column of ref.columns) keyed.push(`${config.name}.${column.name}`);
      }
    }
    expect(Object.keys(SCHOOL_DISPOSAL_COVERAGE).sort()).toEqual(keyed.sort());
  });
});

describe('disposeSchool (C6a)', () => {
  it('de-identifies every person of the school and removes what names them, keeping the counts', async () => {
    const s = await seed('c6a-whole');
    await pastBell(s.lesson.id);
    await armBen(s);
    const before = await rowsOf(s);
    const at = new Date();

    const result = await disposeSchool(db, {
      schoolId: s.school.id,
      at,
      confirmName: s.school.name,
    });

    expect(result).toEqual({
      outcome: 'disposed',
      school: { id: s.school.id, name: s.school.name },
      counts: {
        teachers: 1,
        students: 2,
        classes: 2,
        sessions: 2,
        blocks: 1,
        openInvites: 1,
        armedTaps: 1,
      },
    });
    const after = await rowsOf(s);
    expect(after.school[0]?.removedAt).toEqual(at);
    for (const person of after.users) {
      expect(person).toMatchObject({
        cognitoId: deletedCognitoId(person.id),
        displayName: null,
        removedAt: at,
      });
    }
    expect(after.classes.every((c) => c.name === '' && c.removedAt !== null)).toBe(true);
    expect(after.enrollments.every((e) => e.removedAt !== null)).toBe(true);
    expect(after.blocks.every((b) => b.removedAt !== null)).toBe(true);
    expect(after.armed).toEqual([]);
    // The redeemed invite stays, the record of who became a teacher; the open one goes.
    expect(after.invites).toHaveLength(1);
    expect(after.invites[0]?.redeemedBy).toBe(s.teacher.id);
    // The lessons stay, ended, and no one is left in one.
    expect(after.sessions).toHaveLength(2);
    expect(after.sessions.every((x) => x.endedAt !== null)).toBe(true);
    expect(after.participations.every((p) => p.endedAt !== null)).toBe(true);
    expect(after.participations).toHaveLength(before.participations.length);
    // Every event of theirs stays, but a rename names no one.
    expect(after.events.map((e) => e.eventId).sort()).toEqual(
      before.events.map((e) => e.eventId).sort(),
    );
    const renames = after.events.filter((e) => e.type === 'display_name_changed');
    expect(renames).toHaveLength(1);
    expect(renames[0]?.payload).toBeNull();
    expect(after.events.find((e) => e.type === 'unlock')?.payload).toMatchObject({
      reason: 'nurse',
    });

    // Nothing of any of it names a person any more.
    const text = JSON.stringify(after);
    for (const name of ['Ana', 'Ben', 'Rivera', 'Biology', 'Chem', `ana-c6a`, 'teacher-c6a']) {
      expect(text).not.toContain(name);
    }
  });

  it('logs it as one school_disposed event of ids and counts, naming no one', async () => {
    const s = await seed('c6a-log');
    await pastBell(s.lesson.id);
    const at = new Date();
    await disposeSchool(db, { schoolId: s.school.id, at, confirmName: s.school.name });

    const logged = one(
      await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.type, 'school_disposed'),
            eq(events.occurredAt, at),
            isNull(events.userId),
            isNull(events.classId),
            isNull(events.sessionId),
          ),
        ),
    );
    expect(logged.payload).toEqual({
      school_id: s.school.id,
      teachers: 1,
      students: 2,
      classes: 2,
      sessions: 2,
      blocks: 1,
      open_invites: 1,
      armed_taps: 0,
    });
    expect(logged.orderInstall).toBeNull();
    const text = JSON.stringify(logged);
    for (const named of [s.school.name, 'Ana', 'Ben', 'Rivera', s.ana.cognitoId]) {
      expect(text).not.toContain(named);
    }
  });

  it('a second run says it is disposed of already, and writes nothing', async () => {
    const s = await seed('c6a-again');
    await pastBell(s.lesson.id);
    const at = new Date();
    await disposeSchool(db, { schoolId: s.school.id, at, confirmName: s.school.name });
    const before = await rowsOf(s);
    const disposals = () => db.$count(events, eq(events.type, 'school_disposed'));
    const logged = await disposals();

    expect(
      await disposeSchool(db, { schoolId: s.school.id, at: new Date(), confirmName: 'anything' }),
    ).toEqual({
      outcome: 'already_disposed',
      school: { id: s.school.id, name: s.school.name },
      disposedAt: at,
    });
    expect(await rowsOf(s)).toEqual(before);
    expect(await disposals()).toBe(logged);
  });

  it('leaves another school, its people and its lessons exactly as they were', async () => {
    const s = await seed('c6a-mine');
    const other = await seed('c6a-theirs');
    await pastBell(s.lesson.id);
    await armBen(other);
    const before = await rowsOf(other);

    await disposeSchool(db, { schoolId: s.school.id, at: new Date(), confirmName: s.school.name });

    expect(await rowsOf(other)).toEqual(before);
  });

  it('without the name it is a preview: the same counts, and nothing written', async () => {
    const s = await seed('c6a-preview');
    await pastBell(s.lesson.id);
    const before = await rowsOf(s);
    const total = () => db.$count(events);
    const count = await total();

    const preview = await disposeSchool(db, { schoolId: s.school.id, at: new Date() });
    expect(preview.outcome).toBe('preview');
    expect(await rowsOf(s)).toEqual(before);
    expect(await total()).toBe(count);

    const wrong = await disposeSchool(db, {
      schoolId: s.school.id,
      at: new Date(),
      confirmName: 'Some Other School',
    });
    expect(wrong).toEqual({
      outcome: 'name_mismatch',
      school: { id: s.school.id, name: s.school.name },
    });
    expect(await rowsOf(s)).toEqual(before);

    const done = await disposeSchool(db, {
      schoolId: s.school.id,
      at: new Date(),
      confirmName: s.school.name,
    });
    if (preview.outcome !== 'preview' || done.outcome !== 'disposed') throw new Error('outcome');
    expect(done.counts).toEqual(preview.counts);
  });

  it('is refused while a lesson of the school runs; one past its bell is ended as the sweep would', async () => {
    const s = await seed('c6a-live');
    const before = await rowsOf(s);

    expect(
      await disposeSchool(db, {
        schoolId: s.school.id,
        at: new Date(),
        confirmName: s.school.name,
      }),
    ).toEqual({
      outcome: 'in_session',
      school: { id: s.school.id, name: s.school.name },
      sessions: 1,
    });
    expect(await rowsOf(s)).toEqual(before);

    // The bell rings; the sweep hasn't run yet.
    await pastBell(s.lesson.id);
    const done = await disposeSchool(db, {
      schoolId: s.school.id,
      at: new Date(),
      confirmName: s.school.name,
    });
    expect(done.outcome).toBe('disposed');
    const ends = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, s.lesson.id), eq(events.type, 'session_expired')));
    expect(ends).toHaveLength(1);
    const ana = one(
      await db
        .select()
        .from(participations)
        .where(
          and(eq(participations.sessionId, s.lesson.id), eq(participations.studentId, s.ana.id)),
        ),
    );
    expect(ana.endedReason).toBe('session_expired');
  });

  it('is refused, by id, while a person of the school has records at another school', async () => {
    const s = await seed('c6a-shared');
    const other = await seed('c6a-shared-other');
    await pastBell(s.lesson.id);
    await db.insert(enrollments).values({ classId: other.first.id, studentId: s.ben.id });
    const before = await rowsOf(s);

    expect(
      await disposeSchool(db, {
        schoolId: s.school.id,
        at: new Date(),
        confirmName: s.school.name,
      }),
    ).toEqual({
      outcome: 'shared_accounts',
      school: { id: s.school.id, name: s.school.name },
      userIds: [s.ben.id],
    });
    expect(await rowsOf(s)).toEqual(before);
  });

  it('a student the school already deleted (C3) is counted out, and nothing of theirs moves', async () => {
    const s = await seed('c6a-deleted');
    await pastBell(s.lesson.id);
    const { deleteAccount } = await import('../src/transitions.js');
    await deleteAccount(db, { userId: s.ben.id, eventId: newUuidV7(), at: new Date() });
    const ben = one(await db.select().from(users).where(eq(users.id, s.ben.id)));

    const done = await disposeSchool(db, {
      schoolId: s.school.id,
      at: new Date(),
      confirmName: s.school.name,
    });
    if (done.outcome !== 'disposed') throw new Error(done.outcome);
    expect(done.counts.students).toBe(1);
    expect(one(await db.select().from(users).where(eq(users.id, s.ben.id)))).toEqual(ben);
  });
});

describe('after a disposal', () => {
  it('a redeem that reaches an open invite of a removed school is refused, and changes nothing', async () => {
    // The disposal deletes its open invites, so this is the redeem's own guard:
    // it holds the code's school only while that school is live.
    const s = await seed('c6a-redeem');
    const open = await mintTeacherInvite(db, { schoolId: s.school.id });
    if (open.outcome !== 'minted') throw new Error('mint');
    await db.update(schools).set({ removedAt: new Date() }).where(eq(schools.id, s.school.id));
    const newcomer = await findOrCreateStudent(db, newUuidV7(), 'Newcomer');

    expect(
      await redeemTeacherInvite(db, { userId: newcomer.id, code: open.code, eventId: newUuidV7() }),
    ).toEqual({ outcome: 'invite_not_found' });
    expect(one(await db.select().from(users).where(eq(users.id, newcomer.id)))).toEqual(newcomer);
    expect(
      one(await db.select().from(teacherInvites).where(eq(teacherInvites.id, open.invite.id))),
    ).toMatchObject({ redeemedAt: null, redeemedBy: null });
  });

  it('an emergency unlock still on its way is recorded, by the old account or a new one', async () => {
    const s = await seed('c6a-unlock');
    await pastBell(s.lesson.id);
    await disposeSchool(db, { schoolId: s.school.id, at: new Date(), confirmName: s.school.name });

    // A request that found Ana's account before the disposal: recorded in its lesson.
    const late = await unlock(db, {
      sessionId: s.lesson.id,
      studentId: s.ana.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    expect(late).toMatchObject({ outcome: 'recorded', recordedAs: 'after_session_end' });

    // Her sign-in now matches no account: the next call makes a fresh one, whose unlock is kept.
    const reborn = await findOrCreateStudent(db, s.ana.cognitoId);
    expect(reborn.id).not.toBe(s.ana.id);
    const orphan = await unlock(db, {
      sessionId: s.lesson.id,
      studentId: reborn.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    expect(orphan).toMatchObject({ outcome: 'recorded', recordedAs: 'not_enrolled' });
  });

  it('nothing of the school can start, join, register or redeem again', async () => {
    const s = await seed('c6a-after');
    await pastBell(s.lesson.id);
    const open = await mintTeacherInvite(db, { schoolId: s.school.id });
    if (open.outcome !== 'minted') throw new Error('mint');
    await disposeSchool(db, { schoolId: s.school.id, at: new Date(), confirmName: s.school.name });

    await expect(
      startSession(db, { classId: s.first.id, startedAt: new Date(), endsAt: fromNow(40 * MIN) }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_FOUND' });
    const stranger = await findOrCreateStudent(db, newUuidV7());
    await expect(
      joinClassByCode(db, {
        studentId: stranger.id,
        joinCode: `c6a-after-1`,
        eventId: newUuidV7(),
        occurredAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_FOUND' });
    expect(await mintTeacherInvite(db, { schoolId: s.school.id })).toEqual({
      outcome: 'unknown_school',
    });
    expect(
      await redeemTeacherInvite(db, {
        userId: stranger.id,
        code: open.code,
        eventId: newUuidV7(),
      }),
    ).toEqual({ outcome: 'invite_not_found' });
    // The block's tag is free for another school's teacher.
    const theirs = await seed('c6a-after-other');
    const again = await createBlock(db, { teacherId: theirs.teacher.id, tagId: 'tag-c6a-after' });
    expect(again).toMatchObject({ outcome: 'registered', block: { teacherId: theirs.teacher.id } });
  });
});

describe('npm run school -- dispose', () => {
  it('previews, then disposes once confirmed by name, and logs no name', async () => {
    const s = await seed('c6a-command');
    await pastBell(s.lesson.id);
    const run = async (argv: string[]) => {
      const lines: string[] = [];
      await must(parseSchoolCommand(argv) ?? undefined)({ db, print: (l) => lines.push(l) });
      return lines;
    };

    const preview = await run(['dispose', s.school.id]);
    expect(preview[0]).toContain(`"${s.school.name}"`);
    expect(preview.join('\n')).toContain('Nothing was written');
    expect(preview.at(-1)).toBe(
      `To go ahead: npm run school -- dispose ${s.school.id} --confirm "${s.school.name}"`,
    );
    expect(one(await db.select().from(schools).where(eq(schools.id, s.school.id))).removedAt).toBe(
      null,
    );

    const done = await run(['dispose', s.school.id, '--confirm', s.school.name]);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatch(
      new RegExp(
        `^disposed of school ${s.school.id} on \\S+: teachers 1, students 2, classes 2, ` +
          'sessions 2, blocks 1, open invites 1, pre-bell taps 0$',
      ),
    );
    expect(await run(['dispose', s.school.id])).toEqual([
      expect.stringMatching(/^school \S+ was disposed of already, on \S+: nothing more to do$/),
    ]);
  });

  it('says why it refuses, and checks its arguments before connecting', async () => {
    const s = await seed('c6a-refuse');
    const fail = (argv: string[]) =>
      must(parseSchoolCommand(argv) ?? undefined)({ db, print: () => undefined });
    await expect(fail(['dispose', s.school.id, '--confirm', 'Nope'])).rejects.toThrow(
      `is named "${s.school.name}"; nothing was written`,
    );
    await expect(fail(['dispose', s.school.id, '--confirm', s.school.name])).rejects.toThrow(
      '1 lesson(s) running; nothing was written',
    );
    const other = await seed('c6a-refuse-other');
    await db.insert(enrollments).values({ classId: other.first.id, studentId: s.ben.id });
    await pastBell(s.lesson.id);
    await expect(fail(['dispose', s.school.id])).rejects.toThrow(
      `1 account(s) of "${s.school.name}" have records at another school too`,
    );
    const stranger = newUuidV7();
    await expect(fail(['dispose', stranger])).rejects.toThrow(
      `no school on record has the id ${stranger}`,
    );
    expect(() => parseSchoolCommand(['dispose'])).toThrow(/needs the school's id/);
    expect(() => parseSchoolCommand(['dispose', 'nope'])).toThrow(/is not a school id/);
    expect(() => parseSchoolCommand(['dispose', stranger, '--yes'])).toThrow(/--confirm "<name>"/);
    expect(() => parseSchoolCommand(['dispose', stranger, '--confirm'])).toThrow(
      /--confirm "<name>"/,
    );
    expect(() => parseSchoolCommand(['dispose', stranger, '--confirm', 'A', 'B'])).toThrow(
      /unexpected/,
    );
  });
});
