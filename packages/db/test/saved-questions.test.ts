import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import {
  armedTaps,
  classes,
  enrollments,
  events,
  participations,
  questions,
  responses,
  savedQuestions,
  schools,
  sessions,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  answerQuestion,
  armTap,
  closeQuestion,
  createSavedQuestion,
  extendSession,
  openQuestion,
  refocus,
  removeSavedQuestion,
  renameStudent,
  replaceSavedQuestion,
  type SavedQuestionResult,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * A teacher's saved questions (Phase 7, L3b; ARCHITECTURE, "Live lesson", decision 12): drafts
 * written ahead of class, outside any session, each write idempotent on the draft's eventId, and
 * that id spent both ways with every other mutation's. The privacy paths' handling is in
 * account-deletion, school-disposal and retention's tests, the races in races.test.ts.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

/** 09:mm on the lesson's day: its window is 09:00–09:25. */
const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);

const conflict = { code: 'EVENT_ID_CONFLICT' };
const notFound = { outcome: 'saved_question_not_found' };

/** Ms Rivera's 09:00–09:25 lesson with Ana enrolled, not tapped in; Mr Other teaches elsewhere. */
async function lesson(tag: string) {
  const [school] = await db
    .insert(schools)
    .values({ name: `School ${tag}` })
    .returning();
  const [teacher, other, ana] = await db
    .insert(users)
    .values([
      { cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school!.id },
      { cognitoId: `other-${tag}`, role: 'teacher', schoolId: school!.id },
      { cognitoId: `ana-${tag}`, role: 'student', schoolId: school!.id },
    ])
    .returning();
  const [klass] = await db
    .insert(classes)
    .values({ teacherId: teacher!.id, schoolId: school!.id, name: tag, joinCode: tag })
    .returning();
  await db.insert(enrollments).values({ classId: klass!.id, studentId: ana!.id });
  const { session } = await startSession(db, {
    classId: klass!.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  /** Ms Rivera asks "Which?" at 09:mm. */
  const ask = (minute: number, eventId = newUuidV7()) =>
    openQuestion(db, {
      sessionId: session.id,
      teacherId: teacher!.id,
      eventId,
      prompt: 'Which?',
      options: ['a', 'b'],
      now: at(minute),
    });
  return { teacher: teacher!, other: other!, ana: ana!, klass: klass!, session, ask };
}

/** A teacher's draft "Which?", b correct, written at 09:mm. */
const write = (teacherId: string, minute: number, eventId = newUuidV7()) =>
  createSavedQuestion(db, {
    teacherId,
    eventId,
    prompt: 'Which?',
    options: ['a', 'b'],
    correctOption: 1,
    now: at(minute),
  });

/** The draft a write answered with. */
async function written(result: Promise<SavedQuestionResult>) {
  const answered = await result;
  if (!('savedQuestion' in answered)) throw new Error(answered.outcome);
  return answered.savedQuestion;
}

const draftsOf = (teacherId: string) =>
  db.select().from(savedQuestions).where(eq(savedQuestions.teacherId, teacherId));

describe('a teacher’s drafts (decision 12)', () => {
  it('writes one outside any session, under its eventId, recording no event', async () => {
    const { teacher } = await lesson('d-create');
    const eventId = newUuidV7();

    const result = await write(teacher.id, 5, eventId);

    const [row] = await draftsOf(teacher.id);
    expect(result).toEqual({ outcome: 'created', savedQuestion: row });
    expect(row).toEqual({
      id: row!.id,
      teacherId: teacher.id,
      prompt: 'Which?',
      options: ['a', 'b'],
      correctOption: 1,
      eventId,
      createdAt: at(5),
      updatedAt: at(5),
      removedAt: null,
    });
    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
  });

  it('answers a create’s replay with the draft now, and its id with other words or another teacher’s as taken', async () => {
    const { teacher, other } = await lesson('d-create-replay');
    const eventId = newUuidV7();
    const draft = await written(write(teacher.id, 5, eventId));

    expect(await write(teacher.id, 9, eventId)).toEqual({
      outcome: 'replay',
      savedQuestion: draft,
    });
    await expect(write(other.id, 9, eventId)).rejects.toMatchObject(conflict);
    for (const words of [{ prompt: 'Why?' }, { options: ['a', 'c'] }, { correctOption: null }]) {
      const reuse = { teacherId: teacher.id, eventId, prompt: 'Which?', options: ['a', 'b'] };
      await expect(
        createSavedQuestion(db, { ...reuse, correctOption: 1, ...words }),
      ).rejects.toMatchObject(conflict);
    }

    expect(await draftsOf(teacher.id)).toEqual([draft]);
    expect(await draftsOf(other.id)).toEqual([]);
  });

  it('replaces one whole under its own id, and answers that write’s replay with the draft as it left it', async () => {
    const { teacher } = await lesson('d-replace');
    const draft = await written(write(teacher.id, 5));
    const replace = {
      savedQuestionId: draft.id,
      eventId: newUuidV7(),
      prompt: 'Why?',
      options: ['x', 'y', 'z'],
      now: at(8),
    };

    const replaced = await replaceSavedQuestion(db, replace);

    const now = {
      ...draft,
      prompt: 'Why?',
      options: ['x', 'y', 'z'],
      correctOption: null,
      eventId: replace.eventId,
      updatedAt: at(8),
    };
    expect(replaced).toEqual({ outcome: 'replaced', savedQuestion: now });
    expect(await replaceSavedQuestion(db, { ...replace, now: at(9) })).toEqual({
      outcome: 'replay',
      savedQuestion: now,
    });
    expect(await draftsOf(teacher.id)).toEqual([now]);
  });

  it('lets no save undo a later one: an older save landing after it changes nothing and answers the draft now (decision 4’s order)', async () => {
    const { teacher } = await lesson('d-order');
    const beforeIt = newUuidV7();
    const draft = await written(write(teacher.id, 5));
    // Minted in this order, as a teacher's two saves; landing the other way round.
    const [older, newer] = [newUuidV7(), newUuidV7()];
    const save = (eventId: string, prompt: string, minute: number) =>
      replaceSavedQuestion(db, {
        savedQuestionId: draft.id,
        eventId,
        prompt,
        options: ['a', 'b'],
        now: at(minute),
      });

    const kept = await written(save(newer, 'Later?', 7));
    const late = await save(older, 'Earlier?', 8);

    expect(kept).toMatchObject({ prompt: 'Later?', eventId: newer, updatedAt: at(7) });
    expect(late).toEqual({ outcome: 'replay', savedQuestion: kept });
    // Nor a save minted before the draft itself, nor the later save's own retry.
    expect(await save(beforeIt, 'First?', 9)).toEqual({ outcome: 'replay', savedQuestion: kept });
    expect(await save(newer, 'Later?', 9)).toEqual({ outcome: 'replay', savedQuestion: kept });
    expect(await draftsOf(teacher.id)).toEqual([kept]);
  });

  it('removes one, keeping its words; its replay answers so, and any later write finds none', async () => {
    const { teacher } = await lesson('d-remove');
    const draft = await written(write(teacher.id, 5));
    const replace = {
      savedQuestionId: draft.id,
      eventId: newUuidV7(),
      prompt: 'Why?',
      options: ['a', 'b'],
      now: at(6),
    };
    await replaceSavedQuestion(db, replace);
    const remove = { savedQuestionId: draft.id, eventId: newUuidV7(), now: at(8) };

    const removed = await written(removeSavedQuestion(db, remove));

    expect(removed).toEqual({
      ...draft,
      prompt: 'Why?',
      correctOption: null,
      eventId: remove.eventId,
      updatedAt: at(8),
      removedAt: at(8),
    });
    expect(await removeSavedQuestion(db, { ...remove, now: at(9) })).toEqual({
      outcome: 'replay',
      savedQuestion: removed,
    });
    // Another removal, a replace, the replace's own retry: the draft is gone. And none by that id.
    expect(await removeSavedQuestion(db, { ...remove, eventId: newUuidV7() })).toEqual(notFound);
    expect(await replaceSavedQuestion(db, { ...replace, eventId: newUuidV7() })).toEqual(notFound);
    expect(await replaceSavedQuestion(db, replace)).toEqual(notFound);
    const unknown = { savedQuestionId: newUuidV7(), eventId: newUuidV7() };
    expect(await removeSavedQuestion(db, unknown)).toEqual(notFound);
    expect(await replaceSavedQuestion(db, { ...replace, ...unknown })).toEqual(notFound);
    expect(await draftsOf(teacher.id)).toEqual([removed]);
  });

  it('refuses the id the draft holds from another write: never that write’s replay', async () => {
    const { teacher } = await lesson('d-other-write');
    const draft = await written(write(teacher.id, 5));
    const words = { prompt: 'Which?', options: ['a', 'b'], correctOption: 1 };

    // A removal, or a replace with other words, under the create's id.
    const reuse = { savedQuestionId: draft.id, eventId: draft.eventId };
    await expect(removeSavedQuestion(db, reuse)).rejects.toMatchObject(conflict);
    await expect(
      replaceSavedQuestion(db, { ...reuse, ...words, prompt: 'Why?' }),
    ).rejects.toMatchObject(conflict);
    // The very words it holds, under its id, are a write it already made: answered so.
    expect(await replaceSavedQuestion(db, { ...reuse, ...words })).toEqual({
      outcome: 'replay',
      savedQuestion: draft,
    });
    // A replace under its removal's id.
    const removal = newUuidV7();
    await removeSavedQuestion(db, { savedQuestionId: draft.id, eventId: removal, now: at(7) });
    await expect(
      replaceSavedQuestion(db, { savedQuestionId: draft.id, eventId: removal, ...words }),
    ).rejects.toMatchObject(conflict);

    expect(await draftsOf(teacher.id)).toEqual([
      { ...draft, eventId: removal, updatedAt: at(7), removedAt: at(7) },
    ]);
  });
});

describe('a draft’s eventId, spent both ways (settled 2026-10-10)', () => {
  it('a tap, an unlock, an arm, an answer or any other writer reusing it is refused: 409, nothing recorded', async () => {
    const { session, ana, teacher, ask } = await lesson('d-reuse');
    const { question } = await ask(5);
    const { eventId } = await written(write(teacher.id, 6));
    const studentId = ana.id;

    await expect(
      tapIn(db, { sessionId: session.id, studentId, eventId, deviceTime: at(7), now: at(7) }),
    ).rejects.toMatchObject(conflict);
    // A refusal, never an answer meaning "recorded": the phone keeps the unlock and says so.
    await expect(
      unlock(db, { sessionId: session.id, studentId, eventId, deviceTime: at(7) }),
    ).rejects.toMatchObject(conflict);
    await expect(
      armTap(db, {
        studentId,
        teacherId: teacher.id,
        eventId,
        deviceTime: at(7),
        expiresAt: at(59),
        now: at(7),
      }),
    ).rejects.toMatchObject(conflict);
    await expect(
      answerQuestion(db, { questionId: question.id, studentId, eventId, option: 0, now: at(7) }),
    ).rejects.toMatchObject(conflict);
    // Every other writer records an event under it, which `insertEvent` refuses first.
    for (const reuse of [
      () =>
        refocus(db, { sessionId: session.id, studentId, eventId, deviceTime: at(7), now: at(7) }),
      () => extendSession(db, { sessionId: session.id, durationMinutes: 5, at: at(7), eventId }),
      () => ask(8, eventId),
      () => closeQuestion(db, { questionId: question.id, eventId, now: at(8) }),
      () => renameStudent(db, { studentId, displayName: 'Ana', eventId }),
    ]) {
      await expect(reuse()).rejects.toMatchObject(conflict);
    }

    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
    expect(await db.select().from(armedTaps).where(eq(armedTaps.eventId, eventId))).toEqual([]);
    expect(await db.select().from(responses).where(eq(responses.eventId, eventId))).toEqual([]);
    expect(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(questions).where(eq(questions.sessionId, session.id)),
    ).toMatchObject([{ id: question.id, closedAt: null }]);
    const [now] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(now!.endsAt).toEqual(at(25));
    const [named] = await db.select().from(users).where(eq(users.id, studentId));
    expect(named!.displayName).toBeNull();
  });

  it('a draft write reusing an id an event, an answer or another draft holds is refused, writing nothing', async () => {
    const { session, ana, teacher, other, ask } = await lesson('d-spent');
    const { question } = await ask(5);
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: tap,
      deviceTime: at(6),
      now: at(6),
    });
    const answer = newUuidV7();
    await answerQuestion(db, {
      questionId: question.id,
      studentId: ana.id,
      eventId: answer,
      option: 0,
      now: at(6),
    });
    const mine = await written(write(teacher.id, 7));
    const theirs = await written(write(other.id, 7));

    for (const eventId of [tap, answer, question.eventId, theirs.eventId]) {
      await expect(write(teacher.id, 8, eventId)).rejects.toMatchObject(conflict);
      const words = { prompt: 'Why?', options: ['a', 'b'] };
      await expect(
        replaceSavedQuestion(db, { savedQuestionId: mine.id, eventId, ...words }),
      ).rejects.toMatchObject(conflict);
      await expect(
        removeSavedQuestion(db, { savedQuestionId: mine.id, eventId }),
      ).rejects.toMatchObject(conflict);
    }

    expect(await draftsOf(teacher.id)).toEqual([mine]);
    expect(await draftsOf(other.id)).toEqual([theirs]);
  });

  it('spends only the id a draft holds now: one a later write replaced is free again', async () => {
    const { session, ana, teacher } = await lesson('d-replaced-id');
    const draft = await written(write(teacher.id, 5));
    await replaceSavedQuestion(db, {
      savedQuestionId: draft.id,
      eventId: newUuidV7(),
      prompt: 'Why?',
      options: ['a', 'b'],
      now: at(6),
    });

    // As a replaced answer's id is (decision 4): the draft no longer holds it.
    const tapped = await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: draft.eventId,
      deviceTime: at(7),
      now: at(7),
    });

    expect(tapped.outcome).toBe('joined');
  });

  it('a waiting tap whose id a draft took since still joins at its Start, under a fresh id', async () => {
    // Its Start is refused the spent id before writing anything under it, so the conversion's
    // collided-id branch runs as for an id another event holds.
    const { ana, teacher } = await lesson('d-armed');
    const [later] = await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: ana.schoolId!,
        name: 'later',
        joinCode: 'd-later',
      })
      .returning();
    await db.insert(enrollments).values({ classId: later!.id, studentId: ana.id });
    const eventId = newUuidV7();
    await armTap(db, {
      studentId: ana.id,
      teacherId: teacher.id,
      eventId,
      deviceTime: at(6),
      expiresAt: at(59),
      now: at(6),
    });
    await write(teacher.id, 7, eventId);

    const started = await startSession(db, {
      classId: later!.id,
      startedAt: at(8),
      endsAt: at(50),
    });

    expect(started.convertedStudentIds).toEqual([ana.id]);
    const [tap] = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, started.session.id), eq(events.type, 'tap_in')));
    expect(tap).toMatchObject({ userId: ana.id, payload: { armed_tap_event_id: eventId } });
    expect(tap!.eventId).not.toBe(eventId);
  });
});
