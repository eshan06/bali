import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordAgeCheck } from '../src/age-checks.js';
import { registerPushToken } from '../src/device-tokens.js';
import { newUuidV7 } from '../src/ids.js';
import { parseSchoolCommand } from '../src/school-command.js';
import * as schema from '../src/schema.js';
import {
  armedTaps,
  classes,
  enrollments,
  events,
  participations,
  schools,
  users,
} from '../src/schema.js';
import {
  exportStudentRecord,
  STUDENT_RECORD_COVERAGE,
  STUDENT_RECORD_FORMAT,
  type StudentRecord,
} from '../src/student-record.js';
import { makeTestDb } from '../src/testing.js';
import {
  answerQuestion,
  armTap,
  deleteAccount,
  endSession,
  extendSession,
  openQuestion,
  renameStudent,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * C5: one student's whole record, for a parent's inspection request. Every
 * row keyed to the person, and nothing keyed to anyone else.
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

/** A device token no phone has registered yet: 64 hex digits. */
const newToken = () => newUuidV7().replace(/-/g, '').repeat(2);

/**
 * Ana in two classes, renamed, in a lesson she unlocked in, armed for the next,
 * her phone registered for pushes, past the 13+ check; Ben beside her, his too.
 */
async function seed(tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `School ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({
        cognitoId: `teacher-${tag}`,
        role: 'teacher',
        schoolId: school.id,
        displayName: 'Ms Rivera',
      })
      .returning(),
  );
  const [ana, ben] = await db
    .insert(users)
    .values([
      { cognitoId: newUuidV7(), role: 'student', displayName: `Ana ${tag}` },
      { cognitoId: newUuidV7(), role: 'student', displayName: `Ben ${tag}` },
    ])
    .returning();
  const [first, second] = await db
    .insert(classes)
    .values([
      { teacherId: teacher.id, schoolId: school.id, name: 'Biology', joinCode: `${tag}-1` },
      { teacherId: teacher.id, schoolId: school.id, name: 'Chemistry', joinCode: `${tag}-2` },
    ])
    .returning();
  if (!ana || !ben || !first || !second) throw new Error('seed');
  await db.insert(enrollments).values([
    { classId: first.id, studentId: ana.id },
    { classId: second.id, studentId: ana.id },
    { classId: first.id, studentId: ben.id },
  ]);
  await renameStudent(db, { studentId: ana.id, displayName: `Ana P ${tag}`, eventId: newUuidV7() });
  const { session } = await startSession(db, {
    classId: first.id,
    startedAt: fromNow(-10 * MIN),
    endsAt: fromNow(30 * MIN),
  });
  for (const studentId of [ana.id, ben.id]) {
    await tapIn(db, {
      sessionId: session.id,
      studentId,
      eventId: newUuidV7(),
      deviceTime: new Date(),
    });
    await unlock(db, {
      sessionId: session.id,
      studentId,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      reason: studentId === ana.id ? 'nurse' : 'bathroom',
    });
  }
  // A tap on the block before another teacher's lesson: waiting for its Start.
  const other = one(
    await db
      .insert(users)
      .values({ cognitoId: `other-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  for (const studentId of [ana.id, ben.id]) {
    await armTap(db, {
      studentId,
      teacherId: other.id,
      eventId: newUuidV7(),
      deviceTime: new Date(),
      expiresAt: fromNow(60 * MIN),
    });
  }
  const tokens = { ana: newToken(), ben: newToken() };
  for (const [student, token] of [
    [ana, tokens.ana],
    [ben, tokens.ben],
  ] as const) {
    await registerPushToken(db, {
      userId: student.id,
      token,
      environment: 'production',
      eventId: newUuidV7(),
    });
  }
  const ages = { ana: newUuidV7(), ben: newUuidV7() };
  await recordAgeCheck(db, { userId: ana.id, eventId: ages.ana });
  await recordAgeCheck(db, { userId: ben.id, eventId: ages.ben });
  return { school, teacher, ana, ben, first, second, session, tokens, ages };
}

async function exported(who: string, now = new Date()): Promise<StudentRecord> {
  const record = await exportStudentRecord(db, who, now);
  if (!record) throw new Error(`no record for ${who}`);
  return record;
}

describe('the export’s coverage of the schema', () => {
  it('names every foreign key to users: exported, or argued not theirs', () => {
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
    const covered = [
      ...Object.keys(STUDENT_RECORD_COVERAGE.exported),
      ...Object.keys(STUDENT_RECORD_COVERAGE.notTheirs),
    ];
    expect(covered.sort()).toEqual(keyed.sort());
  });

  it('carries a section for every key it exports', async () => {
    const { ana } = await seed('c5-sections');
    const record = await exported(ana.id);
    for (const section of Object.values(STUDENT_RECORD_COVERAGE.exported)) {
      expect(record).toHaveProperty(section);
    }
  });
});

describe('exportStudentRecord (C5)', () => {
  it('holds the student’s whole record, and names the classes and lesson it points at', async () => {
    const { ana, first, second, session, school, tokens, ages } = await seed('c5-whole');
    const record = await exported(ana.id);

    expect(record.format).toBe(STUDENT_RECORD_FORMAT);
    expect(record.deleted).toBe(false);
    expect(record.account).toMatchObject({
      id: ana.id,
      cognitoId: ana.cognitoId,
      displayName: 'Ana P c5-whole',
      removedAt: null,
    });
    expect(record.enrollments.map((e) => e.classId).sort()).toEqual([first.id, second.id].sort());
    expect(record.participations).toMatchObject([{ sessionId: session.id, state: 'unlocked' }]);
    expect(record.events.map((e) => e.type)).toEqual(['display_name_changed', 'tap_in', 'unlock']);
    expect(record.events[2]?.payload).toMatchObject({ reason: 'nurse' });
    expect(record.armedTaps).toHaveLength(1);
    expect(record.armedTaps[0]).toMatchObject({ studentId: ana.id, consumedAt: null });
    expect(record.invitesRedeemed).toEqual([]);
    expect(record.deviceTokens).toMatchObject([
      { token: tokens.ana, userId: ana.id, environment: 'production' },
    ]);
    expect(record.ageCheck).toMatchObject({ userId: ana.id, eventId: ages.ana });
    expect(record.classes).toMatchObject([
      { id: first.id, name: 'Biology', teacherDisplayName: 'Ms Rivera' },
      { id: second.id, name: 'Chemistry', teacherDisplayName: 'Ms Rivera' },
    ]);
    expect(record.sessions).toMatchObject([{ id: session.id, classId: first.id }]);
    expect(record.sessionEvents).toMatchObject([
      { type: 'session_started', sessionId: session.id, userId: null },
    ]);
    expect(record.schools).toEqual([{ id: school.id, name: school.name }]);
  });

  it('carries nothing of another student’s', async () => {
    const { ana, ben, tokens, ages } = await seed('c5-others');
    const text = JSON.stringify(await exported(ana.id));
    expect(text).not.toContain(tokens.ben);
    expect(text).not.toContain(ages.ben);
    expect(text).not.toContain(ben.id);
    expect(text).not.toContain(ben.cognitoId);
    expect(text).not.toContain('Ben c5-others');
    expect(text).not.toContain('bathroom');
  });

  it('carries when the student’s lesson ended, which its end records under no one (#219)', async () => {
    const { ana, session } = await seed('c5-ended');
    await extendSession(db, { sessionId: session.id, durationMinutes: 5, at: new Date() });
    await endSession(db, { sessionId: session.id, at: new Date(), reason: 'ended' });
    const record = await exported(ana.id);
    expect(record.sessionEvents.map((e) => e.type)).toEqual([
      'session_started',
      'session_extended',
      'session_ended',
    ]);
    expect(record.participations).toMatchObject([{ endedReason: 'session_ended' }]);
  });

  it('carries each answer of theirs with the question it answers, and names its lesson (Live lesson)', async () => {
    const { ana, ben, teacher, second, session } = await seed('c5-answers');
    const { session: chemistry } = await startSession(db, {
      classId: second.id,
      startedAt: fromNow(-5 * MIN),
      endsAt: fromNow(30 * MIN),
    });
    const ask = async (sessionId: string, prompt: string) =>
      (
        await openQuestion(db, {
          sessionId,
          teacherId: teacher.id,
          eventId: newUuidV7(),
          prompt,
          options: ['yes', 'no'],
        })
      ).question;
    const hers = await ask(chemistry.id, 'Ready?');
    const his = await ask(session.id, 'Done?');
    const eventId = newUuidV7();
    await answerQuestion(db, { questionId: hers.id, studentId: ana.id, eventId, option: 1 });
    await answerQuestion(db, {
      questionId: his.id,
      studentId: ben.id,
      eventId: newUuidV7(),
      option: 0,
    });

    const record = await exported(ana.id);
    expect(record.responses).toMatchObject([
      {
        questionId: hers.id,
        studentId: ana.id,
        option: 1,
        eventId,
        question: { sessionId: chemistry.id, prompt: 'Ready?', options: ['yes', 'no'] },
      },
    ]);
    // She never tapped into Chemistry's lesson, and answered in it: it is named all the same.
    expect(record.sessions.map((s) => s.id)).toContain(chemistry.id);
    expect(JSON.stringify(record)).not.toContain('Done?');
  });

  it('finds the account by its Cognito subject too, and none for a stranger', async () => {
    const { ana } = await seed('c5-sub');
    expect((await exported(ana.cognitoId)).account.id).toBe(ana.id);
    expect(await exportStudentRecord(db, newUuidV7())).toBeNull();
    expect(await exportStudentRecord(db, 'not-a-subject')).toBeNull();
  });

  it('answers a student with nothing recorded with the account alone', async () => {
    const fresh = one(
      await db.insert(users).values({ cognitoId: newUuidV7(), role: 'student' }).returning(),
    );
    const record = await exported(fresh.id);
    expect(record.account.id).toBe(fresh.id);
    for (const section of [
      record.enrollments,
      record.participations,
      record.events,
      record.armedTaps,
      record.invitesRedeemed,
      record.deviceTokens,
      record.responses,
      record.classes,
      record.sessions,
      record.sessionEvents,
      record.schools,
    ]) {
      expect(section).toEqual([]);
    }
    expect(record.ageCheck).toBeNull();
  });

  it('exports a deleted account as the deletion left it, by its id only', async () => {
    const { ana } = await seed('c5-deleted');
    await deleteAccount(db, { userId: ana.id, eventId: newUuidV7(), at: new Date() });

    expect(await exportStudentRecord(db, ana.cognitoId)).toBeNull();
    const record = await exported(ana.id);
    expect(record.deleted).toBe(true);
    expect(record.account).toMatchObject({ displayName: null, cognitoId: `deleted:${ana.id}` });
    expect(record.events.map((e) => e.type)).toContain('account_deleted');
    expect(record.events.find((e) => e.type === 'display_name_changed')?.payload).toBeNull();
    expect(record.enrollments.every((e) => e.removedAt !== null)).toBe(true);
    // Its phone's token went with it (N4), and its 13+ yes (C7-server).
    expect(record.deviceTokens).toEqual([]);
    expect(record.ageCheck).toBeNull();
    expect(JSON.stringify(record)).not.toContain('Ana');
  });

  it('reads, and writes nothing: two exports agree, and every table keeps its rows', async () => {
    const { ana } = await seed('c5-read');
    const counts = () =>
      Promise.all(
        [events, participations, armedTaps, enrollments, users].map((table) => db.$count(table)),
      );
    const before = await counts();
    const at = new Date('2026-10-04T12:00:00Z');
    expect(await exported(ana.id, at)).toEqual(await exported(ana.id, at));
    expect(await counts()).toEqual(before);
  });
});

describe('npm run school -- export-student', () => {
  it('prints the record as one JSON document and nothing else', async () => {
    const { ana } = await seed('c5-command');
    const command = parseSchoolCommand(['export-student', ana.id]);
    const lines: string[] = [];
    await command!({ db, print: (line) => lines.push(line) });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as StudentRecord;
    expect(record.account.id).toBe(ana.id);
    expect(record.events).toHaveLength(3);
  });

  it('says so when no account has the id, refuses a teacher’s, and checks its arguments first', async () => {
    const stranger = newUuidV7();
    const command = parseSchoolCommand(['export-student', stranger]);
    await expect(command!({ db, print: () => undefined })).rejects.toThrow(
      `no account on record has the id or Cognito subject ${stranger}`,
    );
    const { teacher } = await seed('c5-teacher');
    const printed: string[] = [];
    await expect(
      parseSchoolCommand(['export-student', teacher.id])!({
        db,
        print: (line) => printed.push(line),
      }),
    ).rejects.toThrow(`${teacher.id} is a teacher's account, not a student's`);
    expect(printed).toEqual([]);
    expect(() => parseSchoolCommand(['export-student'])).toThrow(/needs the account's id/);
    expect(() => parseSchoolCommand(['export-student', stranger, 'more'])).toThrow(/unexpected/);
  });
});
