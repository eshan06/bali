import { sessionReport } from '@bali/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordAgeCheck } from '../src/age-checks.js';
import { registerPushToken } from '../src/device-tokens.js';
import { newUuidV7 } from '../src/ids.js';
import { createBlock } from '../src/management.js';
import { getSessionEvents } from '../src/queries.js';
import { parseSchoolCommand } from '../src/school-command.js';
import * as schema from '../src/schema.js';
import {
  ageChecks,
  armedTaps,
  blocks,
  classes,
  deviceTokens,
  enrollments,
  events,
  schools,
  sessions,
  teacherInvites,
  users,
} from '../src/schema.js';
import { hashInviteCode, recordYearEnd } from '../src/schools.js';
import { makeTestDb } from '../src/testing.js';
import {
  applyRetention,
  armTap,
  disposeSchool,
  endSession,
  RETENTION_COVERAGE,
  renameStudent,
  startSession,
  tapIn,
  unlock,
  yearOverAt,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * C6b: a school year's retention run. Past the school's recorded year end,
 * everyone whose records all lie in that year is de-identified; anyone with a
 * record after it, at another school, or a teacher with a live class or block
 * is kept named and reported; the lessons stay and still add up.
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
const DAY = 24 * 60 * MIN;
const fromNow = (ms: number) => new Date(Date.now() + ms);

/** The day `offset` days from today, YYYY-MM-DD in this machine's zone. */
function localDay(offset: number): string {
  const d = new Date(Date.now() + offset * DAY);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

/** The year ends tomorrow; the run happens three days on, so everything seeded now lies in it. */
const LATER = () => fromNow(3 * DAY);

/**
 * A school whose year ends tomorrow. Ms Rivera teaches Biology, still live,
 * with a block; Mr Old's only class is removed. Ana (renamed) was in a lesson
 * that is over, unlocked in it, and has a tap waiting; Ben is in a lesson
 * running past the year's end; Cara is in a class at another school too; Eve's
 * account was made after the year ended. Another school's Dan is untouched.
 * Ana's, Ben's and Dan's phones are registered for pushes, and the three passed the 13+ check.
 */
async function seed(tag: string) {
  const [school, other] = await db
    .insert(schools)
    .values([
      { name: `School ${tag}`, schoolYearEndsOn: localDay(1) },
      { name: `Other ${tag}`, schoolYearEndsOn: localDay(1) },
    ])
    .returning();
  if (!school || !other) throw new Error('seed');
  const [rivera, old, otherTeacher, ana, ben, cara, dan, eve] = await db
    .insert(users)
    .values([
      { cognitoId: `rivera-${tag}`, role: 'teacher', schoolId: school.id, displayName: 'Rivera' },
      { cognitoId: `old-${tag}`, role: 'teacher', schoolId: school.id, displayName: 'Mr Old' },
      { cognitoId: `t-${tag}`, role: 'teacher', schoolId: other.id, displayName: 'Ms Other' },
      { cognitoId: `ana-${tag}`, role: 'student', displayName: `Ana ${tag}` },
      { cognitoId: `ben-${tag}`, role: 'student', displayName: `Ben ${tag}` },
      { cognitoId: `cara-${tag}`, role: 'student', displayName: `Cara ${tag}` },
      { cognitoId: `dan-${tag}`, role: 'student', displayName: `Dan ${tag}` },
      {
        cognitoId: `eve-${tag}`,
        role: 'student',
        displayName: `Eve ${tag}`,
        createdAt: fromNow(2 * DAY + 12 * 60 * MIN),
      },
    ])
    .returning();
  if (!rivera || !old || !otherTeacher || !ana || !ben || !cara || !dan || !eve) {
    throw new Error('seed');
  }
  const [bio, art, elsewhere] = await db
    .insert(classes)
    .values([
      { teacherId: rivera.id, schoolId: school.id, name: `Biology ${tag}`, joinCode: `${tag}-1` },
      {
        teacherId: old.id,
        schoolId: school.id,
        name: `Mr Old's Art ${tag}`,
        joinCode: `${tag}-2`,
        removedAt: new Date(),
      },
      {
        teacherId: otherTeacher.id,
        schoolId: other.id,
        name: `Elsewhere ${tag}`,
        joinCode: `${tag}-3`,
      },
    ])
    .returning();
  if (!bio || !art || !elsewhere) throw new Error('seed');
  await db.insert(enrollments).values([
    { classId: bio.id, studentId: ana.id },
    { classId: bio.id, studentId: ben.id },
    { classId: bio.id, studentId: cara.id },
    { classId: bio.id, studentId: eve.id },
    { classId: elsewhere.id, studentId: cara.id },
    { classId: elsewhere.id, studentId: dan.id },
  ]);
  const registered = await createBlock(db, { teacherId: rivera.id, tagId: `tag-${tag}` });
  if (registered.outcome === 'tag_taken') throw new Error('seed: block');
  await renameStudent(db, { studentId: ana.id, displayName: `Ana P ${tag}`, eventId: newUuidV7() });

  const past = await startSession(db, {
    classId: bio.id,
    startedAt: fromNow(-50 * MIN),
    endsAt: fromNow(10 * MIN),
  });
  for (const student of [ana, ben]) {
    await tapIn(db, {
      sessionId: past.session.id,
      studentId: student.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
  }
  await unlock(db, {
    sessionId: past.session.id,
    studentId: ana.id,
    eventId: newUuidV7(),
    deviceTime: new Date(),
    reason: 'nurse',
  });
  await endSession(db, { sessionId: past.session.id, at: new Date(), reason: 'ended' });

  // A lesson still running when the year is over: Ben is in it.
  const running = await startSession(db, {
    classId: bio.id,
    startedAt: new Date(),
    endsAt: fromNow(30 * MIN),
  });
  await tapIn(db, {
    sessionId: running.session.id,
    studentId: ben.id,
    eventId: newUuidV7(),
    deviceTime: new Date(),
  });
  await armTap(db, {
    studentId: ana.id,
    teacherId: rivera.id,
    blockId: registered.block.id,
    eventId: newUuidV7(),
    deviceTime: new Date(),
    expiresAt: fromNow(60 * MIN),
  });
  for (const student of [ana, ben, dan]) {
    await registerPushToken(db, {
      userId: student.id,
      token: newUuidV7().replace(/-/g, '').repeat(2),
      environment: 'production',
      eventId: newUuidV7(),
    });
    await recordAgeCheck(db, { userId: student.id, eventId: newUuidV7() });
  }
  return { school, other, rivera, old, ana, ben, cara, dan, eve, bio, art, past: past.session };
}

const userRow = async (id: string) => one(await db.select().from(users).where(eq(users.id, id)));
const tokensOf = (userId: string) =>
  db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));
const ageChecksOf = (userId: string) =>
  db.select().from(ageChecks).where(eq(ageChecks.userId, userId));

describe('the retention run’s coverage of the schema', () => {
  it('handles every foreign key to users', () => {
    const keyed: string[] = [];
    for (const table of Object.values(schema)) {
      if (!(table instanceof PgTable)) continue;
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        const ref = fk.reference();
        if (getTableConfig(ref.foreignTable).name !== 'users') continue;
        for (const column of ref.columns) keyed.push(`${config.name}.${column.name}`);
      }
    }
    expect(Object.keys(RETENTION_COVERAGE).sort()).toEqual(keyed.sort());
  });
});

describe('yearOverAt', () => {
  it('is the midnight after the last day, in this machine’s zone', () => {
    expect(yearOverAt('2026-12-18')).toEqual(new Date(2026, 11, 19));
    expect(yearOverAt('2026-12-31')).toEqual(new Date(2027, 0, 1));
  });
});

describe('applyRetention (C6b)', () => {
  it('de-identifies who the year ended for, keeps everyone else named, and the lessons add up', async () => {
    const s = await seed('c6b-whole');
    const at = LATER();
    const ended = { ...s.past, endedAt: new Date() };
    const before = sessionReport(ended, await getSessionEvents(db, s.past.id), at);

    const result = await applyRetention(db, {
      schoolId: s.school.id,
      at,
      confirmName: s.school.name,
    });

    expect(result).toEqual({
      outcome: 'applied',
      school: { id: s.school.id, name: s.school.name },
      yearEndsOn: localDay(1),
      counts: { students: 1, teachers: 1, enrollments: 1, armedTaps: 1, continuing: 4 },
      continuing: [s.rivera.id, s.ben.id, s.cara.id, s.eve.id].sort(),
    });

    // Ana and Mr Old: as a deletion leaves an account.
    for (const gone of [s.ana, s.old]) {
      expect(await userRow(gone.id)).toMatchObject({
        displayName: null,
        cognitoId: `deleted:${gone.id}`,
        removedAt: at,
      });
    }
    const renames = await db
      .select()
      .from(events)
      .where(and(eq(events.userId, s.ana.id), eq(events.type, 'display_name_changed')));
    expect(renames).toHaveLength(1);
    expect(renames[0]?.payload).toBeNull();
    // Her class ended as a removal ends it, on the class's feed; her waiting tap is gone.
    const removal = one(
      await db
        .select()
        .from(events)
        .where(and(eq(events.userId, s.ana.id), eq(events.type, 'enrollment_removed'))),
    );
    expect(removal).toMatchObject({ classId: s.bio.id, sessionId: null });
    expect(
      await db.select().from(enrollments).where(eq(enrollments.studentId, s.ana.id)),
    ).toMatchObject([{ removedAt: at }]);
    expect(await db.select().from(armedTaps).where(eq(armedTaps.studentId, s.ana.id))).toHaveLength(
      0,
    );
    // Her phone's token goes too (N4); Ben, kept named, and Dan, elsewhere, keep theirs.
    expect(await tokensOf(s.ana.id)).toEqual([]);
    expect(await tokensOf(s.ben.id)).toHaveLength(1);
    expect(await tokensOf(s.dan.id)).toHaveLength(1);
    // And her 13+ yes (C7-server); theirs stay.
    expect(await ageChecksOf(s.ana.id)).toEqual([]);
    expect(await ageChecksOf(s.ben.id)).toHaveLength(1);
    expect(await ageChecksOf(s.dan.id)).toHaveLength(1);
    // Mr Old's removed class loses its name; Biology, still taught, keeps its.
    expect(one(await db.select().from(classes).where(eq(classes.id, s.art.id))).name).toBe('');
    expect(one(await db.select().from(classes).where(eq(classes.id, s.bio.id))).name).toBe(
      s.bio.name,
    );

    // Everyone else as they were.
    for (const kept of [s.rivera, s.ben, s.cara, s.eve, s.dan]) {
      expect(await userRow(kept.id)).toMatchObject({
        displayName: kept.displayName,
        cognitoId: kept.cognitoId,
        removedAt: null,
      });
    }

    // The lesson's report is exactly as it was: her unlock still counts.
    const after = sessionReport(ended, await getSessionEvents(db, s.past.id), at);
    expect(after).toEqual(before);
    expect(after.unlocks).toMatchObject([{ studentId: s.ana.id, reason: 'nurse' }]);
  });

  it('logs one retention_applied event of ids, the day and counts, naming no one', async () => {
    const s = await seed('c6b-log');
    await applyRetention(db, { schoolId: s.school.id, at: LATER(), confirmName: s.school.name });
    const logged = one(
      await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.type, 'retention_applied'),
            sql`${events.payload}->>'school_id' = ${s.school.id}`,
          ),
        ),
    );
    expect(logged).toMatchObject({ userId: null, classId: null, sessionId: null });
    expect(logged.payload).toEqual({
      school_id: s.school.id,
      year_ends_on: localDay(1),
      students: 1,
      teachers: 1,
      enrollments: 1,
      armed_taps: 1,
      continuing: 4,
    });
    const text = JSON.stringify(logged);
    for (const named of [s.school.name, 'Ana', 'Ben', 'Rivera', 'Old', s.ana.cognitoId]) {
      expect(text).not.toContain(named);
    }
    for (const person of [s.ana, s.ben, s.cara, s.eve, s.rivera, s.old]) {
      expect(text).not.toContain(person.id);
    }
  });

  it('previews the whole run, writing nothing, with the counts it then applies', async () => {
    const s = await seed('c6b-preview');
    const at = LATER();
    const people = [s.ana.id, s.old.id, s.rivera.id, s.ben.id];
    const snapshot = async () => ({
      users: await db.select().from(users).where(inArray(users.id, people)),
      events: await db.$count(events),
      armed: await db.$count(armedTaps),
      tokens: await db.$count(deviceTokens),
      ageChecks: await db.$count(ageChecks),
      classes: await db.select().from(classes).where(eq(classes.schoolId, s.school.id)),
    });
    const before = await snapshot();

    const preview = await applyRetention(db, { schoolId: s.school.id, at });
    expect(preview).toMatchObject({ outcome: 'preview' });
    expect(await snapshot()).toEqual(before);

    const applied = await applyRetention(db, {
      schoolId: s.school.id,
      at,
      confirmName: ' ' + s.school.name,
    });
    if (preview.outcome !== 'preview' || applied.outcome !== 'applied') throw new Error('outcome');
    expect(applied.counts).toEqual(preview.counts);
    expect(applied.continuing).toEqual(preview.continuing);
  });

  it('a second run for the same year answers with the first one’s counts and writes nothing', async () => {
    const s = await seed('c6b-again');
    const at = LATER();
    const first = await applyRetention(db, {
      schoolId: s.school.id,
      at,
      confirmName: s.school.name,
    });
    if (first.outcome !== 'applied') throw new Error(first.outcome);
    const logged = await db.$count(events);
    const named = await db.select().from(users).where(eq(users.id, s.ben.id));

    const again = await applyRetention(db, {
      schoolId: s.school.id,
      at: fromNow(4 * DAY),
      confirmName: s.school.name,
    });
    expect(again).toEqual({
      outcome: 'already_applied',
      school: { id: s.school.id, name: s.school.name },
      yearEndsOn: localDay(1),
      appliedAt: at,
      counts: first.counts,
    });
    expect(await db.$count(events)).toBe(logged);
    expect(await db.select().from(users).where(eq(users.id, s.ben.id))).toEqual(named);
  });

  it('a later year is judged afresh: who has stopped since goes then', async () => {
    const s = await seed('c6b-next');
    await applyRetention(db, { schoolId: s.school.id, at: LATER(), confirmName: s.school.name });
    // Ben's lesson ends; the next year ends with nothing more of his.
    await db.execute(
      sql`update sessions set ended_at = now(), ends_at = now() where class_id = ${s.bio.id} and ended_at is null`,
    );
    await recordYearEnd(db, { schoolId: s.school.id, endsOn: localDay(5) });
    const next = await applyRetention(db, {
      schoolId: s.school.id,
      at: fromNow(7 * DAY),
      confirmName: s.school.name,
    });
    expect(next).toMatchObject({ outcome: 'applied', yearEndsOn: localDay(5) });
    expect((await userRow(s.ben.id)).removedAt).not.toBeNull();
    // Eve, made after the first year ended, has nothing after the second: she goes now.
    expect((await userRow(s.eve.id)).removedAt).not.toBeNull();
    // Rivera still teaches; Cara is shared.
    for (const kept of [s.rivera, s.cara]) {
      expect((await userRow(kept.id)).removedAt).toBeNull();
    }
  });

  it('keeps each person whose one record after the year is an event, a block, their class’s lesson or a tap on them', async () => {
    const [school] = await db
      .insert(schools)
      .values({ name: 'Keeps High', schoolYearEndsOn: localDay(1) })
      .returning();
    if (!school) throw new Error('seed');
    const old = fromNow(-30 * DAY);
    const after = fromNow(2 * DAY + 12 * 60 * MIN);
    const [teacher, blocker, lessoned, tapped, student] = await db
      .insert(users)
      .values([
        { cognitoId: 'keeps-t', role: 'teacher', schoolId: school.id, createdAt: old },
        { cognitoId: 'keeps-block', role: 'teacher', schoolId: school.id, createdAt: old },
        { cognitoId: 'keeps-lesson', role: 'teacher', schoolId: school.id, createdAt: old },
        { cognitoId: 'keeps-tapped', role: 'teacher', schoolId: school.id, createdAt: old },
        { cognitoId: 'keeps-s', role: 'student', displayName: 'Keeps S', createdAt: old },
      ])
      .returning();
    if (!teacher || !blocker || !lessoned || !tapped || !student) throw new Error('seed');
    const [live, gone] = await db
      .insert(classes)
      .values([
        { teacherId: teacher.id, schoolId: school.id, name: 'Live', joinCode: 'KEEP-1' },
        {
          teacherId: lessoned.id,
          schoolId: school.id,
          name: 'Gone',
          joinCode: 'KEEP-2',
          removedAt: after,
          createdAt: old,
        },
      ])
      .returning();
    if (!live || !gone) throw new Error('seed');
    await db
      .insert(enrollments)
      .values({ classId: live.id, studentId: student.id, createdAt: old });
    // The student: an event after the year, nothing else.
    await db.insert(events).values({
      eventId: newUuidV7(),
      type: 'enrollment_left',
      userId: student.id,
      classId: gone.id,
      occurredAt: after,
    });
    // A block made after the year, removed since.
    await db
      .insert(blocks)
      .values({ tagId: 'keeps-tag', teacherId: blocker.id, createdAt: after, removedAt: after });
    // A lesson of the teacher's own (removed) class, ended after the year.
    await db
      .insert(sessions)
      .values({ classId: gone.id, startedAt: old, endsAt: after, endedAt: after });
    // A tap on a teacher with no block left, made after the year.
    await db.insert(armedTaps).values({
      studentId: student.id,
      teacherId: tapped.id,
      eventId: newUuidV7(),
      deviceTime: after,
      expiresAt: fromNow(3 * DAY),
      createdAt: after,
    });

    const result = await applyRetention(db, {
      schoolId: school.id,
      at: LATER(),
      confirmName: school.name,
    });
    if (result.outcome !== 'applied') throw new Error(result.outcome);
    expect(result.continuing).toEqual(
      [teacher.id, blocker.id, lessoned.id, tapped.id, student.id].sort(),
    );
    expect(result.counts).toMatchObject({ students: 0, teachers: 0, armedTaps: 0 });
    expect(
      await db.select().from(armedTaps).where(eq(armedTaps.teacherId, tapped.id)),
    ).toHaveLength(1);
  });

  it('keeps a teacher who came in by an invite after the year, with no class yet, or a student who joined since', async () => {
    const s = await seed('c6b-newcomer');
    const [hire, joiner] = await db
      .insert(users)
      .values([
        { cognitoId: 'hire-c6b', role: 'teacher', schoolId: s.school.id, displayName: 'New Hire' },
        { cognitoId: 'joiner-c6b', role: 'student', displayName: 'Joiner' },
      ])
      .returning();
    if (!hire || !joiner) throw new Error('seed');
    // Their accounts are old; what is new is the redeem, and an enrollment with no event of its own.
    await db
      .update(users)
      .set({ createdAt: fromNow(-30 * DAY) })
      .where(inArray(users.id, [hire.id, joiner.id]));
    const after = fromNow(2 * DAY + 12 * 60 * MIN);
    await db.insert(teacherInvites).values({
      schoolId: s.school.id,
      codeHash: hashInviteCode(newUuidV7()),
      expiresAt: fromNow(10 * DAY),
      redeemedAt: after,
      redeemedBy: hire.id,
      redeemEventId: newUuidV7(),
    });
    await db
      .insert(enrollments)
      .values({ classId: s.bio.id, studentId: joiner.id, createdAt: after });

    const result = await applyRetention(db, {
      schoolId: s.school.id,
      at: LATER(),
      confirmName: s.school.name,
    });
    if (result.outcome !== 'applied') throw new Error(result.outcome);
    expect(result.continuing).toEqual(expect.arrayContaining([hire.id, joiner.id]));
    for (const kept of [hire, joiner]) {
      expect((await userRow(kept.id)).removedAt).toBeNull();
    }
  });

  it('refuses, writing nothing, with no year end on record, before it is over, or under another name', async () => {
    const s = await seed('c6b-refuse');
    const school = { id: s.school.id, name: s.school.name };
    const logged = await db.$count(events);

    expect(await applyRetention(db, { schoolId: s.school.id, at: new Date() })).toEqual({
      outcome: 'year_not_over',
      school,
      yearEndsOn: localDay(1),
      overAt: yearOverAt(localDay(1)),
    });
    expect(
      await applyRetention(db, { schoolId: s.school.id, at: LATER(), confirmName: 'Another' }),
    ).toEqual({ outcome: 'name_mismatch', school });
    await db.update(schools).set({ schoolYearEndsOn: null }).where(eq(schools.id, s.school.id));
    expect(
      await applyRetention(db, { schoolId: s.school.id, at: LATER(), confirmName: s.school.name }),
    ).toEqual({ outcome: 'no_year_end', school });
    expect(await applyRetention(db, { schoolId: newUuidV7(), at: LATER() })).toEqual({
      outcome: 'unknown_school',
    });

    expect(await db.$count(events)).toBe(logged);
    expect((await userRow(s.ana.id)).displayName).toBe('Ana P c6b-refuse');
  });

  it('a disposed school has nothing left to retain', async () => {
    const [school] = await db
      .insert(schools)
      .values({ name: 'Disposed High', schoolYearEndsOn: localDay(1) })
      .returning();
    if (!school) throw new Error('seed');
    const disposed = await disposeSchool(db, {
      schoolId: school.id,
      at: new Date(),
      confirmName: school.name,
    });
    expect(disposed.outcome).toBe('disposed');
    expect(await applyRetention(db, { schoolId: school.id, at: LATER() })).toEqual({
      outcome: 'school_disposed',
      school: { id: school.id, name: school.name },
    });
  });
});

describe('npm run school -- year-end / retention', () => {
  const run = async (argv: string[]) => {
    const lines: string[] = [];
    const command = parseSchoolCommand(argv);
    if (!command) throw new Error('usage');
    await command({ db, print: (l) => lines.push(l) });
    return lines;
  };

  it('checks its arguments before anything connects', () => {
    const id = newUuidV7();
    expect(() => parseSchoolCommand(['year-end', id])).toThrow(/year-end <school-id> YYYY-MM-DD/);
    expect(() => parseSchoolCommand(['year-end', id, '2026-02-30'])).toThrow(/not a day/);
    expect(() => parseSchoolCommand(['year-end', 'nope', '2026-12-18'])).toThrow(/not a school id/);
    expect(() => parseSchoolCommand(['retention'])).toThrow(/retention <school-id>/);
    expect(() => parseSchoolCommand(['retention', id, '--yes'])).toThrow(/--confirm "<name>"/);
    expect(() => parseSchoolCommand(['retention', id, '--confirm', 'A', 'B'])).toThrow(
      /unexpected/,
    );
    // A year's end may be in the future, unlike an agreement's day.
    expect(parseSchoolCommand(['year-end', id, '2099-06-01'])).toBeTypeOf('function');
  });

  it('records the year end, refuses before it, and says so when none is on record', async () => {
    const [school] = await db.insert(schools).values({ name: 'Command High' }).returning();
    if (!school) throw new Error('seed');
    await expect(run(['retention', school.id])).rejects.toThrow(
      /no year end on record, so nothing was written.*year-end/,
    );
    expect(await run(['year-end', school.id, '2099-06-01'])).toEqual([
      `"Command High": its year's last day is on record as 2099-06-01`,
      `after it, preview its retention run: npm run school -- retention ${school.id}`,
    ]);
    expect((await run(['year-end', school.id, '2099-06-02']))[0]).toContain('(it said 2099-06-01)');
    await expect(run(['retention', school.id])).rejects.toThrow(
      /ends on 2099-06-02, so it isn't over until .*nothing was written/,
    );
    await expect(run(['year-end', newUuidV7(), '2099-06-01'])).rejects.toThrow(/no school/);
  });

  it('previews, then runs once confirmed by name, and a re-run says it ran', async () => {
    const [school] = await db
      .insert(schools)
      .values({ name: "St. Mary's", schoolYearEndsOn: '2020-06-01' })
      .returning();
    if (!school) throw new Error('seed');
    const [kim] = await db
      .insert(users)
      .values({
        cognitoId: 'kim-cmd',
        role: 'student',
        displayName: 'Kim',
        createdAt: new Date('2020-01-01'),
      })
      .returning();
    const [teacher] = await db
      .insert(users)
      .values({ cognitoId: 't-cmd', role: 'teacher', schoolId: school.id, displayName: 'T' })
      .returning();
    if (!kim || !teacher) throw new Error('seed');
    const [klass] = await db
      .insert(classes)
      .values({ teacherId: teacher.id, schoolId: school.id, name: 'Old', joinCode: 'CMD-1' })
      .returning();
    if (!klass) throw new Error('seed');
    await db
      .insert(enrollments)
      .values({ classId: klass.id, studentId: kim.id, createdAt: new Date('2020-01-02') });

    const preview = await run(['retention', school.id]);
    expect(preview[0]).toBe(
      `the retention run for "St. Mary's" (${school.id}), its year ending 2020-06-01, would ` +
        'de-identify: students 1, teachers 0, enrollments 1, pre-bell taps 0; kept named 1',
    );
    expect(preview[1]).toContain(teacher.id);
    expect(preview.join('\n')).toContain('Nothing was written');
    expect(preview.at(-1)).toBe(
      `To go ahead: npm run school -- retention ${school.id} --confirm 'St. Mary'\\''s'`,
    );
    expect((await userRow(kim.id)).removedAt).toBeNull();

    const done = await run(['retention', school.id, '--confirm', "St. Mary's"]);
    expect(done).toEqual([
      expect.stringMatching(
        new RegExp(
          `^retention run for school ${school.id}, year ending 2020-06-01, on \\S+: ` +
            'students 1, teachers 0, enrollments 1, pre-bell taps 0; kept named 1$',
        ),
      ),
    ]);
    expect(done[0]).not.toContain('Mary');
    expect((await userRow(kim.id)).displayName).toBeNull();
    expect(await run(['retention', school.id])).toEqual([
      expect.stringMatching(
        /^the retention run for "St. Mary's"'s year ending 2020-06-01 ran on \S+: students 1, .*nothing more to do\. For its next year: npm run school -- year-end/,
      ),
    ]);
  });
  it('refuses another name, saying the right one and writing nothing; a disposed school, says so', async () => {
    const [school] = await db
      .insert(schools)
      .values({ name: "O'Neil Prep", schoolYearEndsOn: '2020-06-01' })
      .returning();
    if (!school) throw new Error('seed');
    const logged = await db.$count(events);
    await expect(run(['retention', school.id, '--confirm', 'ONeil Prep'])).rejects.toThrow(
      `school ${school.id} is named "O'Neil Prep"; nothing was written. ` +
        `To confirm: retention ${school.id} --confirm 'O'\\''Neil Prep'`,
    );
    expect(await db.$count(events)).toBe(logged);
    expect(
      (await db.select().from(schools).where(eq(schools.id, school.id)))[0]?.removedAt,
    ).toBeNull();

    const disposed = await disposeSchool(db, {
      schoolId: school.id,
      at: new Date(),
      confirmName: school.name,
    });
    expect(disposed.outcome).toBe('disposed');
    expect(await run(['retention', school.id, '--confirm', school.name])).toEqual([
      `school ${school.id} was disposed of: its people are de-identified already`,
    ]);
  });
});
