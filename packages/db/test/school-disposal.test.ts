import { execFileSync } from 'node:child_process';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordAgeCheck } from '../src/age-checks.js';
import { registerPushToken } from '../src/device-tokens.js';
import { newUuidV7 } from '../src/ids.js';
import { createBlock, updateClass } from '../src/management.js';
import { findOrCreateStudent } from '../src/queries.js';
import { parseSchoolCommand, shellQuote } from '../src/school-command.js';
import * as schema from '../src/schema.js';
import {
  ageChecks,
  armedTaps,
  blocks,
  classes,
  decks,
  deviceTokens,
  enrollments,
  events,
  participations,
  questions,
  responses,
  savedQuestions,
  schools,
  sessionPresentations,
  sessions,
  teacherInvites,
  users,
} from '../src/schema.js';
import { mintTeacherInvite, recordAgreement, redeemTeacherInvite } from '../src/schools.js';
import { makeTestDb } from '../src/testing.js';
import {
  answerQuestion,
  armTap,
  completeDeck,
  createDeck,
  createSavedQuestion,
  deletedCognitoId,
  disposeSchool,
  endEnrollment,
  endSession,
  joinClassByCode,
  openQuestion,
  removeDeck,
  removeSavedQuestion,
  renameStudent,
  SCHOOL_DISPOSAL_COVERAGE,
  showSlide,
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
 * unlock in it, and Ben's tap waiting for the teacher's next Start; both
 * students' phones registered for pushes, and both past the 13+ check. In the
 * running lesson, a question whose words name both students, answered by Ana;
 * and the teacher's drafts naming each, Ben's removed already. The teacher's
 * decks: one shown in the running lesson, and two naming each student, Ben's
 * removed already.
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
  const { question } = await openQuestion(db, {
    sessionId: lesson.session.id,
    teacherId: teacher.id,
    eventId: newUuidV7(),
    prompt: `Who helped Ben ${tag}?`,
    options: [`Ana ${tag}`, `Ben ${tag}`, 'No one'],
    correctOption: 0,
  });
  await answerQuestion(db, {
    questionId: question.id,
    studentId: ana.id,
    eventId: newUuidV7(),
    option: 0,
  });
  // The teacher's drafts for next week, naming both, one of them removed already.
  for (const name of [`Ana ${tag}`, `Ben ${tag}`]) {
    const drafted = await createSavedQuestion(db, {
      teacherId: teacher.id,
      eventId: newUuidV7(),
      prompt: `Is ${name} back?`,
      options: ['Yes', 'No'],
    });
    if (drafted.outcome !== 'created') throw new Error('seed: draft');
    if (name.startsWith('Ben')) {
      await removeSavedQuestion(db, {
        savedQuestionId: drafted.savedQuestion.id,
        eventId: newUuidV7(),
        now: fromNow(-MIN),
      });
    }
  }
  for (const title of [`Cells ${tag}`, `Ana ${tag}’s essay`, `Ben ${tag}’s retake`]) {
    const { deck } = await createDeck(db, {
      teacherId: teacher.id,
      schoolId: school.id,
      eventId: newUuidV7(),
      title,
      bytes: 1_000,
      sha256: 'c'.repeat(64),
    });
    if (title.startsWith('Cells')) {
      const verdict = { status: 'ready', pageCount: 3 } as const;
      await completeDeck(db, { deckId: deck.id, eventId: newUuidV7(), verdict });
      await showSlide(db, {
        sessionId: lesson.session.id,
        teacherId: teacher.id,
        eventId: newUuidV7(),
        deckId: deck.id,
        page: 2,
      });
    }
    if (title.startsWith('Ben')) {
      await removeDeck(db, { deckId: deck.id, eventId: newUuidV7(), now: fromNow(-MIN) });
    }
  }
  for (const student of [ana, ben]) {
    await registerPushToken(db, {
      userId: student.id,
      token: newUuidV7().replace(/-/g, '').repeat(2),
      environment: 'sandbox',
      eventId: newUuidV7(),
    });
    await recordAgeCheck(db, { userId: student.id, eventId: newUuidV7() });
  }
  return {
    school,
    teacher,
    block,
    ana,
    ben,
    first,
    second,
    past: session,
    lesson: lesson.session,
    question,
  };
}

/** End a lesson the seed left running, by moving its bell into the past (the sweep's case). */
async function pastBell(sessionId: string) {
  const { backdateSessionEnd } = await import('../src/testing.js');
  await backdateSessionEnd(db, { sessionId }, fromNow(-1 * MIN));
}

/** The types of the events recorded in a lesson, in the order recorded. */
async function typesIn(sessionId: string) {
  const rows = await db
    .select({ type: events.type })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(events.seq);
  return rows.map((e) => e.type);
}

/** What the owner's command prints, line by line. */
async function run(argv: string[]) {
  const lines: string[] = [];
  await must(parseSchoolCommand(argv) ?? undefined)({ db, print: (l) => lines.push(l) });
  return lines;
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
  const lessons = await db.select().from(sessions).where(inArray(sessions.classId, classIds));
  return {
    school: await db.select().from(schools).where(eq(schools.id, s.school.id)),
    users: await db.select().from(users).where(inArray(users.id, peopleIds)),
    classes: classRows,
    enrollments: enrolled,
    sessions: lessons,
    questions: await db
      .select()
      .from(questions)
      .where(
        inArray(
          questions.sessionId,
          lessons.map((l) => l.id),
        ),
      ),
    responses: await db.select().from(responses).where(inArray(responses.studentId, peopleIds)),
    participations: await db
      .select()
      .from(participations)
      .where(inArray(participations.studentId, peopleIds)),
    events: await db.select().from(events).where(inArray(events.userId, peopleIds)),
    blocks: await db.select().from(blocks).where(eq(blocks.teacherId, s.teacher.id)),
    invites: await db.select().from(teacherInvites).where(eq(teacherInvites.schoolId, s.school.id)),
    armed: await db.select().from(armedTaps).where(eq(armedTaps.teacherId, s.teacher.id)),
    tokens: await db.select().from(deviceTokens).where(inArray(deviceTokens.userId, peopleIds)),
    ageChecks: await db.select().from(ageChecks).where(inArray(ageChecks.userId, peopleIds)),
    drafts: await db
      .select()
      .from(savedQuestions)
      .where(eq(savedQuestions.teacherId, s.teacher.id))
      .orderBy(savedQuestions.createdAt, savedQuestions.id),
    decks: await db
      .select()
      .from(decks)
      .where(eq(decks.schoolId, s.school.id))
      .orderBy(decks.createdAt, decks.id),
    presentations: await db
      .select()
      .from(sessionPresentations)
      .where(
        inArray(
          sessionPresentations.sessionId,
          lessons.map((l) => l.id),
        ),
      ),
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
      // No lesson of it running, none ended.
      ended: [],
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
    // Its people's phones' tokens are gone (N4).
    expect(before.tokens).toHaveLength(2);
    expect(after.tokens).toEqual([]);
    // And their 13+ yes (C7-server).
    expect(before.ageChecks).toHaveLength(2);
    expect(after.ageChecks).toEqual([]);
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
    // The lesson's question loses its words and keeps its count of options and its correct
    // one; Ana's answer stays as it was, so the totals by option still add up.
    expect(after.questions).toMatchObject([
      { prompt: '', options: ['', '', ''], correctOption: 0 },
    ]);
    expect(after.responses).toEqual(before.responses);
    expect(after.responses).toMatchObject([{ studentId: s.ana.id, option: 0 }]);
    // The teacher's drafts are removed and lose their words; the one removed already keeps when.
    const [live, dropped] = before.drafts;
    expect(after.drafts).toEqual([
      { ...live, prompt: '', options: ['', ''], removedAt: at },
      { ...dropped, prompt: '', options: ['', ''] },
    ]);
    // Its decks are removed and lose their titles, the one removed already keeping when; each
    // stored object is the API's sweep's (M4). The lesson that showed one keeps showing it, as the
    // history of what was shown.
    const [cells, essay, retake] = before.decks;
    expect(after.decks).toEqual([
      { ...cells, title: '', removedAt: at },
      { ...essay, title: '', removedAt: at },
      { ...retake, title: '' },
    ]);
    expect(after.presentations).toEqual(before.presentations);
    expect(after.presentations).toMatchObject([{ deckId: cells!.id, page: 2 }]);

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
    const first = await disposeSchool(db, {
      schoolId: s.school.id,
      at,
      confirmName: s.school.name,
    });
    if (first.outcome !== 'disposed') throw new Error(first.outcome);
    const before = await rowsOf(s);
    const disposals = () => db.$count(events, eq(events.type, 'school_disposed'));
    const logged = await disposals();

    expect(
      await disposeSchool(db, { schoolId: s.school.id, at: new Date(), confirmName: 'anything' }),
    ).toEqual({
      outcome: 'already_disposed',
      school: { id: s.school.id, name: s.school.name },
      disposedAt: at,
      // Its counts, read back from its school_disposed event.
      counts: first.counts,
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

  it('is refused while a lesson of the school runs, naming each; one past its bell is ended as the sweep would', async () => {
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
      // What the owner needs to end it, or to wait for it: its session, its class and its bell.
      running: [
        {
          sessionId: s.lesson.id,
          classId: s.second.id,
          className: s.second.name,
          endsAt: s.lesson.endsAt,
        },
      ],
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

  it('told to end its lessons, ends each one running as its teacher’s End would, in the same transaction, and a Start behind it is refused', async () => {
    const s = await seed('c6a-end-lessons');
    const at = new Date();

    const done = await disposeSchool(db, {
      schoolId: s.school.id,
      at,
      confirmName: s.school.name,
      endLessons: true,
    });

    expect(done).toEqual({
      outcome: 'disposed',
      school: { id: s.school.id, name: s.school.name },
      counts: {
        teachers: 1,
        students: 2,
        classes: 2,
        sessions: 2,
        blocks: 1,
        openInvites: 1,
        armedTaps: 0,
      },
      ended: [
        {
          sessionId: s.lesson.id,
          classId: s.second.id,
          className: s.second.name,
          endsAt: s.lesson.endsAt,
        },
      ],
    });
    const after = await rowsOf(s);
    // The running lesson ended now, as an End ends it: Ana's turn in it with it, its question
    // closed. The one past its bell ended as the sweep ends it, at its bell.
    expect(after.sessions.find((x) => x.id === s.lesson.id)?.endedAt).toEqual(at);
    expect(after.participations.filter((p) => p.sessionId === s.lesson.id)).toMatchObject([
      { studentId: s.ana.id, endedAt: at, endedReason: 'session_ended' },
    ]);
    expect(await typesIn(s.lesson.id)).toEqual(
      expect.arrayContaining(['session_ended', 'question_closed']),
    );
    expect(await typesIn(s.lesson.id)).not.toContain('session_expired');
    expect(await typesIn(s.past.id)).toContain('session_expired');
    expect(after.questions).toMatchObject([{ closedAt: at }]);
    // Disposed of whole, in that same transaction: no one named, every class removed.
    expect(after.school[0]?.removedAt).toEqual(at);
    expect(after.classes.every((c) => c.name === '' && c.removedAt !== null)).toBe(true);
    expect(after.users.every((u) => u.displayName === null && u.removedAt !== null)).toBe(true);

    // Its teacher can't start the class again: there is no class to start.
    await expect(
      startSession(db, { classId: s.second.id, startedAt: new Date(), endsAt: fromNow(40 * MIN) }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_FOUND' });
  });

  it('a preview told to end its lessons ends none and writes nothing, and names the ones it would end', async () => {
    const s = await seed('c6a-end-preview');
    const before = await rowsOf(s);
    const total = () => db.$count(events);
    const count = await total();

    const preview = await disposeSchool(db, {
      schoolId: s.school.id,
      at: new Date(),
      endLessons: true,
    });

    expect(preview).toMatchObject({
      outcome: 'preview',
      counts: { sessions: 2 },
      ended: [{ sessionId: s.lesson.id, classId: s.second.id, className: s.second.name }],
    });
    expect(await rowsOf(s)).toEqual(before);
    expect(await total()).toBe(count);
    // The lesson runs on, so a disposal not told to end it is still refused.
    expect(
      await disposeSchool(db, {
        schoolId: s.school.id,
        at: new Date(),
        confirmName: s.school.name,
      }),
    ).toMatchObject({ outcome: 'in_session' });
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

  it('empties the questions of a school with more lessons than one statement can bind', async () => {
    const s = await seed('c6a-many');
    await pastBell(s.lesson.id);
    // More lessons than one statement binds (postgres.js refuses 65,534 parameters), made in one.
    const lessons = 65_600;
    await db.execute(sql`insert into ${sessions} (id, class_id, started_at, ends_at, ended_at)
      select gen_random_uuid(), ${s.first.id}, now() - interval '2 days',
        now() - interval '2 days', now() - interval '2 days'
      from generate_series(1, ${lessons})`);

    const done = await disposeSchool(db, {
      schoolId: s.school.id,
      at: new Date(),
      confirmName: s.school.name,
    });

    expect(done).toMatchObject({ outcome: 'disposed', counts: { sessions: lessons + 2 } });
    expect(
      one(await db.select().from(questions).where(eq(questions.id, s.question.id))),
    ).toMatchObject({ prompt: '', options: ['', '', ''] });
  }, 120_000);

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
    expect(await mintTeacherInvite(db, { schoolId: s.school.id })).toMatchObject({
      outcome: 'disposed',
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

    const preview = await run(['dispose', s.school.id]);
    expect(preview[0]).toContain(`"${s.school.name}"`);
    expect(preview.join('\n')).toContain('Nothing was written');
    expect(preview.at(-1)).toBe(
      `To go ahead: npm run school -- dispose ${s.school.id} --confirm '${s.school.name}'`,
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
      expect.stringMatching(
        new RegExp(
          `^school \\S+ was disposed of already, on \\S+: teachers 1, students 2, classes 2, ` +
            'sessions 2, blocks 1, open invites 1, pre-bell taps 0; nothing more to do$',
        ),
      ),
    ]);
  });

  it('quotes the name it suggests as one shell word, whatever it holds', () => {
    expect(shellQuote('School')).toBe("'School'");
    expect(shellQuote(`St. Mary's "Upper" $HOME \\`)).toBe(`'St. Mary'\\''s "Upper" $HOME \\'`);
    // What a POSIX shell makes of it is the name, exactly.
    const name = `O'Brien's "Prep" $(echo x) \`back\``;
    expect(execFileSync('sh', ['-c', `printf %s ${shellQuote(name)}`], { encoding: 'utf8' })).toBe(
      name,
    );
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
    // --end-lessons goes last, after the name when there is one.
    expect(() =>
      parseSchoolCommand(['dispose', stranger, '--end-lessons', '--confirm', 'A']),
    ).toThrow(/--confirm "<name>" \[--end-lessons\]/);
    expect(() => parseSchoolCommand(['dispose', stranger, '--end-lessons', 'A'])).toThrow(
      /--confirm "<name>" \[--end-lessons\]/,
    );
    expect(() =>
      parseSchoolCommand(['dispose', stranger, '--confirm', 'A', '--end-lessons', 'B']),
    ).toThrow(/unexpected/);
  });

  it('names each lesson that holds it up, and how to end them', async () => {
    const s = await seed('c6a-names');
    const refusal = await run(['dispose', s.school.id, '--confirm', s.school.name]).then(
      () => 'disposed',
      (err: Error) => err.message,
    );

    expect(refusal).toContain(`"${s.school.name}" has 1 lesson(s) running; nothing was written.`);
    expect(refusal).toContain(
      `Session ${s.lesson.id}, in class "${s.second.name}" (${s.second.id}), its bell at ` +
        `${s.lesson.endsAt.toISOString()}.`,
    );
    expect(refusal).toContain('npm run school -- end-session <session-id>');
    expect(refusal).toContain(`npm run school -- dispose ${s.school.id} --end-lessons`);
    expect(one(await db.select().from(schools).where(eq(schools.id, s.school.id))).removedAt).toBe(
      null,
    );
  });

  it('prints a class’s name with each character a terminal would act on written as its code', async () => {
    const s = await seed('c6a-escaped');
    // Its teacher names the class as they like (a rename checks only its length): here an ESC
    // that clears the screen, an 8-bit CSI, a bidi override and a line separator.
    await updateClass(db, { classId: s.second.id, name: 'Chem\u001b[2J\u009b8m\u202eend\u2028x' });

    const refusal = await run(['dispose', s.school.id]).then(
      () => 'disposed',
      (err: Error) => err.message,
    );
    const preview = await run(['dispose', s.school.id, '--end-lessons']);

    const shown = `in class "Chem\\u001b[2J\\u{9b}8m\\u{202e}end\\u{2028}x" (${s.second.id})`;
    expect(refusal).toContain(shown);
    expect(preview.join('\n')).toContain(shown);
    for (const line of [refusal, ...preview]) {
      expect(line.search(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u)).toBe(-1);
    }
  });

  it('a name that doesn’t match keeps --end-lessons in the line it suggests', async () => {
    const s = await seed('c6a-mismatch-end');
    await expect(
      run(['dispose', s.school.id, '--confirm', 'Nope', '--end-lessons']),
    ).rejects.toThrow(
      `To confirm: dispose ${s.school.id} --confirm '${s.school.name}' --end-lessons`,
    );
  });

  it('with --end-lessons, previews the lessons it would end, then ends them as it disposes', async () => {
    const s = await seed('c6a-command-end');
    const running = () => db.select().from(sessions).where(eq(sessions.id, s.lesson.id));

    const preview = await run(['dispose', s.school.id, '--end-lessons']);
    expect(preview).toContain(
      `It would end 1 lesson(s) still running, as their teacher's End would: Session ` +
        `${s.lesson.id}, in class "${s.second.name}" (${s.second.id}), its bell at ` +
        `${s.lesson.endsAt.toISOString()}.`,
    );
    expect(preview.join('\n')).toContain('Nothing was written');
    expect(preview.at(-1)).toBe(
      `To go ahead: npm run school -- dispose ${s.school.id} --confirm '${s.school.name}' --end-lessons`,
    );
    expect(one(await running()).endedAt).toBeNull();

    const done = await run(['dispose', s.school.id, '--confirm', s.school.name, '--end-lessons']);
    expect(done).toEqual([
      expect.stringMatching(
        new RegExp(
          `^disposed of school ${s.school.id} on \\S+: teachers 1, students 2, classes 2, ` +
            `sessions 2, blocks 1, open invites 1, pre-bell taps 0; it ended 1 lesson\\(s\\) ` +
            `still running: ${s.lesson.id}$`,
        ),
      ),
    ]);
    expect(one(await running()).endedAt).not.toBeNull();
  });
});

describe('npm run school -- end-session', () => {
  it('ends a running lesson as its teacher’s End would; then a student may leave, and the school be disposed of', async () => {
    const s = await seed('end-session');
    const anaInLesson = one(
      await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.classId, s.second.id), eq(enrollments.studentId, s.ana.id))),
    );
    const leave = () =>
      endEnrollment(db, {
        enrollmentId: anaInLesson.id,
        reason: 'left_class',
        at: new Date(),
        eventId: newUuidV7(),
      });
    // While it runs, she can't leave its class (A19), and the school can't be disposed of.
    await expect(leave()).rejects.toMatchObject({ code: 'CLASS_IN_SESSION' });
    await expect(run(['dispose', s.school.id, '--confirm', s.school.name])).rejects.toThrow(
      '1 lesson(s) running',
    );

    const said = await run(['end-session', s.lesson.id]);

    expect(said).toEqual([
      expect.stringMatching(
        new RegExp(
          `^ended session ${s.lesson.id} on \\S+, as its teacher's End would: ` +
            '1 student\\(s\\) were in it$',
        ),
      ),
    ]);
    // Through the engine, as an End: the lesson and Ana's turn in it ended together, and recorded.
    const lesson = one(await db.select().from(sessions).where(eq(sessions.id, s.lesson.id)));
    expect(lesson.endedAt).not.toBeNull();
    expect(said[0]).toContain(` on ${lesson.endedAt?.toISOString()},`);
    expect(
      one(
        await db
          .select()
          .from(participations)
          .where(
            and(eq(participations.sessionId, s.lesson.id), eq(participations.studentId, s.ana.id)),
          ),
      ),
    ).toMatchObject({ endedAt: lesson.endedAt, endedReason: 'session_ended' });
    expect((await typesIn(s.lesson.id)).filter((t) => t.startsWith('session_'))).toEqual([
      'session_started',
      'session_ended',
    ]);
    // Its open question closed with it, at its end.
    expect(await typesIn(s.lesson.id)).toContain('question_closed');
    expect(
      one(await db.select().from(questions).where(eq(questions.id, s.question.id))).closedAt,
    ).toEqual(lesson.endedAt);

    await expect(leave()).resolves.toMatchObject({ outcome: 'ended' });
    expect(await run(['dispose', s.school.id, '--confirm', s.school.name])).toEqual([
      expect.stringMatching(new RegExp(`^disposed of school ${s.school.id} on `)),
    ]);
  });

  it('leaves a lesson already over as it is, ended or past its bell, and says so', async () => {
    const s = await seed('end-session-over');
    await endSession(db, { sessionId: s.lesson.id, at: new Date(), reason: 'ended' });
    const endedAt = one(
      await db.select().from(sessions).where(eq(sessions.id, s.lesson.id)),
    ).endedAt;
    const before = await rowsOf(s);
    const total = () => db.$count(events);
    const count = await total();

    // Its teacher ended it.
    expect(await run(['end-session', s.lesson.id])).toEqual([
      `session ${s.lesson.id} was over already: it ended on ${endedAt?.toISOString()}; ` +
        'nothing changed',
    ]);
    // Past its bell, not yet swept: over by the server's clock (A17), and the sweep's to mark.
    expect(await run(['end-session', s.past.id])).toEqual([
      `session ${s.past.id} was over already: its bell rang at ${s.past.endsAt.toISOString()}, ` +
        'and the sweep marks it so; nothing changed',
    ]);
    expect(await rowsOf(s)).toEqual(before);
    expect(await total()).toBe(count);
  });

  it('checks the id before connecting, and says when no session has it', async () => {
    expect(() => parseSchoolCommand(['end-session'])).toThrow(/needs the session's id/);
    expect(() => parseSchoolCommand(['end-session', 'nope'])).toThrow(/"nope" is not a session id/);
    const stranger = newUuidV7();
    expect(() => parseSchoolCommand(['end-session', stranger, 'more'])).toThrow(
      /unexpected "more"/,
    );
    await expect(run(['end-session', stranger])).rejects.toThrow(
      `no session on record has the id ${stranger}`,
    );
  });
});
