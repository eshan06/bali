import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { stampObjectDeleted } from '../src/queries.js';
import {
  armedTaps,
  classes,
  decks,
  enrollments,
  events,
  participations,
  responses,
  savedQuestions,
  schools,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  answerQuestion,
  armTap,
  closeQuestion,
  createDeck,
  createSavedQuestion,
  deleteAccount,
  type DeckResult,
  openQuestion,
  refocus,
  removeDeck,
  removeSavedQuestion,
  renameStudent,
  replaceSavedQuestion,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * A teacher's slide decks in the engine (Phase 7, M2; ARCHITECTURE, "Live lesson", decisions 4
 * and 5): a create and a removal, each idempotent on the deck's eventId, and that id spent both
 * ways with every other mutation's. The routes and the stored object are apps/api's, the races
 * races.test.ts's.
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
const notFound = { outcome: 'deck_not_found' };
const SHA256 = 'c'.repeat(64);

/** Ms Rivera's 09:00–09:25 lesson with Ana enrolled, not tapped in; Mr Other, no class, at her school. */
async function school(tag: string) {
  const [place] = await db
    .insert(schools)
    .values({ name: `School ${tag}` })
    .returning();
  const [teacher, other, ana] = await db
    .insert(users)
    .values([
      { cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: place!.id },
      { cognitoId: `other-${tag}`, role: 'teacher', schoolId: place!.id },
      { cognitoId: `ana-${tag}`, role: 'student', schoolId: place!.id },
    ])
    .returning();
  const [klass] = await db
    .insert(classes)
    .values({ teacherId: teacher!.id, schoolId: place!.id, name: tag, joinCode: tag })
    .returning();
  await db.insert(enrollments).values({ classId: klass!.id, studentId: ana!.id });
  const { session } = await startSession(db, {
    classId: klass!.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  return { schoolId: place!.id, teacher: teacher!, other: other!, ana: ana!, session };
}

/** `teacherId`'s deck "Cells", 1,000 bytes, added at 09:mm. */
const add = (
  teacher: { id: string; schoolId: string | null },
  minute: number,
  eventId = newUuidV7(),
) =>
  createDeck(db, {
    teacherId: teacher.id,
    schoolId: teacher.schoolId!,
    eventId,
    title: 'Cells',
    bytes: 1_000,
    sha256: SHA256,
    now: at(minute),
  });

/** The deck a write answered with. */
async function written(result: Promise<DeckResult | typeof notFound>) {
  const answered = await result;
  if (!('deck' in answered)) throw new Error(answered.outcome);
  return answered.deck;
}

const decksOf = (teacherId: string) =>
  db.select().from(decks).where(eq(decks.teacherId, teacherId));

describe('a teacher’s decks (decision 4)', () => {
  it('adds one, pending, under its eventId and a key of the API’s own, recording no event', async () => {
    const { schoolId, teacher } = await school('k-create');
    const eventId = newUuidV7();

    const result = await add(teacher, 5, eventId);

    const [row] = await decksOf(teacher.id);
    expect(result).toEqual({ outcome: 'created', deck: row });
    expect(row).toEqual({
      id: row!.id,
      teacherId: teacher.id,
      schoolId,
      title: 'Cells',
      storageKey: `decks/${row!.id}.pdf`,
      sha256: SHA256,
      bytes: 1_000,
      pageCount: null,
      status: 'pending',
      eventId,
      createdAt: at(5),
      removedAt: null,
      objectDeletedAt: null,
    });
    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
  });

  it('answers a create’s replay with the deck now, and its id with another file or teacher as taken', async () => {
    const { teacher, other } = await school('k-replay');
    const eventId = newUuidV7();
    const deck = await written(add(teacher, 5, eventId));

    expect(await add(teacher, 9, eventId)).toEqual({ outcome: 'replay', deck });
    await expect(add(other, 9, eventId)).rejects.toMatchObject(conflict);
    const same = { teacherId: teacher.id, schoolId: teacher.schoolId!, eventId };
    for (const file of [{ title: 'Atoms' }, { bytes: 999 }, { sha256: 'd'.repeat(64) }]) {
      await expect(
        createDeck(db, { ...same, title: 'Cells', bytes: 1_000, sha256: SHA256, ...file }),
      ).rejects.toMatchObject(conflict);
    }

    expect(await decksOf(teacher.id)).toEqual([deck]);
    expect(await decksOf(other.id)).toEqual([]);
  });

  it('refuses a deck to a teacher whose account was deleted on its way, writing nothing', async () => {
    const { other } = await school('k-deleted');
    await deleteAccount(db, { userId: other.id, eventId: newUuidV7(), at: at(4) });

    await expect(add(other, 5)).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });

    expect(await decksOf(other.id)).toEqual([]);
  });

  it('removes one, keeping it; its replay answers so, and any later removal finds none', async () => {
    const { teacher } = await school('k-remove');
    const deck = await written(add(teacher, 5));
    const removal = { deckId: deck.id, eventId: newUuidV7(), now: at(8) };

    const removed = await written(removeDeck(db, removal));

    expect(removed).toEqual({ ...deck, eventId: removal.eventId, removedAt: at(8) });
    expect(await removeDeck(db, { ...removal, now: at(9) })).toEqual({
      outcome: 'replay',
      deck: removed,
    });
    expect(await removeDeck(db, { ...removal, eventId: newUuidV7() })).toEqual(notFound);
    expect(await removeDeck(db, { deckId: newUuidV7(), eventId: newUuidV7() })).toEqual(notFound);
    expect(await decksOf(teacher.id)).toEqual([removed]);
  });

  it('refuses a removal under the id the deck holds from its create: never that create’s replay', async () => {
    const { teacher } = await school('k-other-write');
    const deck = await written(add(teacher, 5));

    await expect(removeDeck(db, { deckId: deck.id, eventId: deck.eventId })).rejects.toMatchObject(
      conflict,
    );

    expect(await decksOf(teacher.id)).toEqual([deck]);
  });

  it('stamps its object deleted once: a later stamp keeps the first time (decision 5)', async () => {
    const { teacher } = await school('k-stamp');
    const deck = await written(add(teacher, 5));

    await stampObjectDeleted(db, deck.id, at(9));
    await stampObjectDeleted(db, deck.id, at(12));

    expect(await decksOf(teacher.id)).toEqual([{ ...deck, objectDeletedAt: at(9) }]);
  });
});

describe('a deck’s eventId, spent both ways (settled 2026-10-10)', () => {
  it('a tap, an unlock, an arm, an answer, a draft or any other writer reusing it is refused: 409, nothing recorded', async () => {
    const { session, ana, teacher } = await school('k-reuse');
    const { question } = await openQuestion(db, {
      sessionId: session.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      prompt: 'Which?',
      options: ['a', 'b'],
      now: at(5),
    });
    const { eventId } = await written(add(teacher, 6));
    const studentId = ana.id;
    const own = { sessionId: session.id, studentId, eventId, deviceTime: at(7) };

    const arm = { studentId, teacherId: teacher.id, eventId, deviceTime: at(7), expiresAt: at(59) };
    const words = { prompt: 'Q?', options: ['a', 'b'] };
    const draft = await createSavedQuestion(db, {
      teacherId: teacher.id,
      eventId: newUuidV7(),
      ...words,
    });
    if (draft.outcome !== 'created') throw new Error(draft.outcome);
    const savedQuestionId = draft.savedQuestion.id;
    for (const reuse of [
      () => tapIn(db, { ...own, now: at(7) }),
      () => unlock(db, own),
      () => armTap(db, { ...arm, now: at(7) }),
      () =>
        answerQuestion(db, { questionId: question.id, studentId, eventId, option: 0, now: at(7) }),
      () => createSavedQuestion(db, { teacherId: teacher.id, eventId, ...words }),
      () => replaceSavedQuestion(db, { savedQuestionId, eventId, ...words, prompt: 'Why?' }),
      () => removeSavedQuestion(db, { savedQuestionId, eventId }),
      // Every other writer records an event under it, which `insertEvent` refuses first.
      () => refocus(db, { ...own, now: at(7) }),
      () => closeQuestion(db, { questionId: question.id, eventId, now: at(8) }),
      () => renameStudent(db, { studentId, displayName: 'Ana', eventId }),
    ]) {
      await expect(reuse()).rejects.toMatchObject(conflict);
    }

    for (const holder of [events, armedTaps, responses, savedQuestions]) {
      expect(await db.select().from(holder).where(eq(holder.eventId, eventId))).toEqual([]);
    }
    expect(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(savedQuestions).where(eq(savedQuestions.id, savedQuestionId)),
    ).toEqual([draft.savedQuestion]);
  });

  it('a deck write reusing an id an event, an answer, a draft or another deck holds is refused, writing nothing', async () => {
    const { session, ana, teacher, other } = await school('k-spent');
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: tap,
      deviceTime: at(6),
      now: at(6),
    });
    const { question } = await openQuestion(db, {
      sessionId: session.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      prompt: 'Which?',
      options: ['a', 'b'],
      now: at(6),
    });
    const answer = newUuidV7();
    const answered = await answerQuestion(db, {
      questionId: question.id,
      studentId: ana.id,
      eventId: answer,
      option: 0,
      now: at(6),
    });
    expect(answered.outcome).toBe('answered');
    const draft = newUuidV7();
    const words = { prompt: 'Q?', options: ['a', 'b'] };
    await createSavedQuestion(db, { teacherId: teacher.id, eventId: draft, ...words });
    const mine = await written(add(teacher, 7));
    const theirs = await written(add(other, 7));

    for (const eventId of [tap, question.eventId, answer, draft, theirs.eventId]) {
      await expect(add(teacher, 8, eventId)).rejects.toMatchObject(conflict);
      await expect(removeDeck(db, { deckId: mine.id, eventId })).rejects.toMatchObject(conflict);
    }

    expect(await decksOf(teacher.id)).toEqual([mine]);
    expect(await decksOf(other.id)).toEqual([theirs]);
  });

  it('spends only the id a deck holds now: its create’s is free again once it is removed', async () => {
    const { teacher } = await school('k-replaced-id');
    const deck = await written(add(teacher, 5));
    await removeDeck(db, { deckId: deck.id, eventId: newUuidV7() });

    // As a draft's create's id is (L3b): the deck no longer holds it.
    const draft = await createSavedQuestion(db, {
      teacherId: teacher.id,
      eventId: deck.eventId,
      prompt: 'Q?',
      options: ['a', 'b'],
    });

    expect(draft.outcome).toBe('created');
  });
});
