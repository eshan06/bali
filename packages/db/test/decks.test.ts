import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { claimDecksToDrop, stampObjectDeleted } from '../src/queries.js';
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
  completeDeck,
  createDeck,
  createSavedQuestion,
  DECK_PENDING_LIMIT_MS,
  deleteAccount,
  type DeckResult,
  eventIdSpent,
  openQuestion,
  refocus,
  rejectUnfinishedDecks,
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
 * A teacher's slide decks in the engine (Phase 7, M2; ARCHITECTURE, "Live lesson", decisions 4, 5
 * and 6): a create, a removal and a complete's verdict, each idempotent on the deck's eventId, and
 * that id spent both ways with every other mutation's. The routes and the stored object are apps/api's, the races
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
      rejection: null,
      eventId,
      createdAt: at(5),
      uploadUrlMintedAt: at(5),
      removedAt: null,
      objectDeletedAt: null,
      objectDeleteAttempts: 0,
      objectNextAttemptAt: null,
    });
    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
  });

  it('answers a create’s replay with the deck now, its fresh upload URL’s mint recorded, and its id with another file or teacher as taken', async () => {
    const { teacher, other } = await school('k-replay');
    const eventId = newUuidV7();
    const deck = await written(add(teacher, 5, eventId));
    const minted = { ...deck, uploadUrlMintedAt: at(9) };

    expect(await add(teacher, 9, eventId)).toEqual({ outcome: 'replay', deck: minted });
    await expect(add(other, 9, eventId)).rejects.toMatchObject(conflict);
    const same = { teacherId: teacher.id, schoolId: teacher.schoolId!, eventId };
    for (const file of [{ title: 'Atoms' }, { bytes: 999 }, { sha256: 'd'.repeat(64) }]) {
      await expect(
        createDeck(db, { ...same, title: 'Cells', bytes: 1_000, sha256: SHA256, ...file }),
      ).rejects.toMatchObject(conflict);
    }

    expect(await decksOf(teacher.id)).toEqual([minted]);
    expect(await decksOf(other.id)).toEqual([]);
  });

  it('makes a second pending deck of a create retried once its deck was removed or checked: left, the sweep’s 24 hours take it (#323’s review)', async () => {
    const { teacher } = await school('k-retry-after');
    const verdict = { status: 'ready', pageCount: 1 } as const;
    for (const write of [
      (deckId: string) => removeDeck(db, { deckId, eventId: newUuidV7() }),
      (deckId: string) => completeDeck(db, { deckId, eventId: newUuidV7(), verdict }),
    ]) {
      const eventId = newUuidV7();
      const first = await written(add(teacher, 5, eventId));
      await write(first.id);

      const retry = await add(teacher, 9, eventId);

      expect(retry).toMatchObject({ outcome: 'created', deck: { status: 'pending', eventId } });
      expect(retry.deck.id).not.toBe(first.id);
    }
    expect(await decksOf(teacher.id)).toHaveLength(4);
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

  it('reads a removal’s eventId in any case as one id: its retry is its replay, never deck_not_found (#442, part 3)', async () => {
    // Postgres keeps a uuid lower-case and matches one sent in any case. A client minting its ids in
    // upper case, as Foundation's `uuidString` writes them, resends a removal whose answer never came.
    const { teacher } = await school('k-remove-case');
    for (const loud of [true, false]) {
      const deck = await written(add(teacher, 5));
      // Its create's id, in upper case, is still the create's: never this removal's replay.
      await expect(
        removeDeck(db, { deckId: deck.id, eventId: deck.eventId.toUpperCase() }),
      ).rejects.toMatchObject(conflict);
      const id = newUuidV7();
      const removal = { deckId: deck.id, eventId: loud ? id.toUpperCase() : id, now: at(8) };

      const removed = await written(removeDeck(db, removal));

      expect(removed).toEqual({ ...deck, eventId: id, removedAt: at(8) });
      for (const eventId of [id.toUpperCase(), id]) {
        expect(await removeDeck(db, { ...removal, eventId, now: at(9) })).toEqual({
          outcome: 'replay',
          deck: removed,
        });
      }
      const later = { ...removal, eventId: newUuidV7().toUpperCase() };
      expect(await removeDeck(db, later)).toEqual(notFound);
    }
    expect(await decksOf(teacher.id)).toHaveLength(2);
  });

  it('stamps its object deleted once: a later stamp keeps the first time (decision 5)', async () => {
    const { teacher } = await school('k-stamp');
    const deck = await written(add(teacher, 5));

    await stampObjectDeleted(db, deck.id, at(9));
    await stampObjectDeleted(db, deck.id, at(12));

    expect(await decksOf(teacher.id)).toEqual([{ ...deck, objectDeletedAt: at(9) }]);
  });
});

describe('a deck’s verdict (decision 6)', () => {
  it('records ready with its pages, or rejected with why, under the complete’s eventId; never another', async () => {
    const { teacher } = await school('k-complete');
    const taken = await written(add(teacher, 5));
    const refused = await written(add(teacher, 5));
    const first = newUuidV7();

    const ready = await written(
      completeDeck(db, {
        deckId: taken.id,
        eventId: first,
        verdict: { status: 'ready', pageCount: 12 },
      }),
    );
    const rejected = await written(
      completeDeck(db, {
        deckId: refused.id,
        eventId: newUuidV7(),
        verdict: { status: 'rejected', rejection: 'encrypted' },
      }),
    );

    expect(ready).toEqual({ ...taken, status: 'ready', pageCount: 12, eventId: first });
    expect(rejected).toMatchObject({ status: 'rejected', rejection: 'encrypted', pageCount: null });
    // One-way: its replay, and a later complete with another verdict, answer the first.
    for (const again of [
      { eventId: first, verdict: { status: 'rejected', rejection: 'too_slow' } as const },
      { eventId: newUuidV7(), verdict: { status: 'ready', pageCount: 3 } as const },
    ]) {
      expect(await completeDeck(db, { deckId: taken.id, ...again })).toEqual({
        outcome: 'replay',
        deck: ready,
      });
    }
    expect(await db.select().from(events).where(eq(events.eventId, first))).toEqual([]);
    expect(await decksOf(teacher.id)).toEqual(expect.arrayContaining([ready, rejected]));
  });

  it('finds none once removed, and refuses its own create’s id: it is the create’s, never this', async () => {
    const { teacher } = await school('k-complete-refused');
    const deck = await written(add(teacher, 5));
    const verdict = { status: 'ready', pageCount: 1 } as const;

    await expect(
      completeDeck(db, { deckId: deck.id, eventId: deck.eventId, verdict }),
    ).rejects.toMatchObject(conflict);
    await removeDeck(db, { deckId: deck.id, eventId: newUuidV7() });
    for (const deckId of [deck.id, newUuidV7()]) {
      expect(await completeDeck(db, { deckId, eventId: newUuidV7(), verdict })).toEqual(notFound);
    }

    expect(await decksOf(teacher.id)).toMatchObject([{ status: 'pending', pageCount: null }]);
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

    const verdict = { status: 'ready', pageCount: 3 } as const;
    for (const eventId of [tap, question.eventId, answer, draft, theirs.eventId]) {
      await expect(add(teacher, 8, eventId)).rejects.toMatchObject(conflict);
      await expect(removeDeck(db, { deckId: mine.id, eventId })).rejects.toMatchObject(conflict);
      await expect(completeDeck(db, { deckId: mine.id, eventId, verdict })).rejects.toMatchObject(
        conflict,
      );
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

  it('is found spent by one read, whatever record holds it (#324’s review)', async () => {
    const { teacher } = await school('k-spent-read');
    const deck = await written(add(teacher, 5));
    const draft = newUuidV7();
    await createSavedQuestion(db, {
      teacherId: teacher.id,
      eventId: draft,
      prompt: 'Q?',
      options: ['a', 'b'],
    });

    expect(await eventIdSpent(db, deck.eventId)).toBe(true);
    expect(await eventIdSpent(db, draft)).toBe(true);
    expect(await eventIdSpent(db, newUuidV7())).toBe(false);
  });
});

// Last in the file: the sweep's rejection reads every deck in this file's database.
describe('the sweep’s decks (decision 6, M2b2)', () => {
  /** 09:mm a day later: 24 hours after 09:mm, to the millisecond. */
  const dayAfter = (minute: number, ms = 0) =>
    new Date(at(minute).getTime() + DECK_PENDING_LIMIT_MS + ms);

  it('rejects a live deck left pending 24 hours unfinished, keeping its eventId; never a younger, a checked or a removed one', async () => {
    const { teacher } = await school('k-unfinished');
    const left = await written(add(teacher, 5));
    const younger = await written(add(teacher, 6));
    const checked = await written(
      completeDeck(db, {
        deckId: (await written(add(teacher, 5))).id,
        eventId: newUuidV7(),
        verdict: { status: 'ready', pageCount: 2 },
      }),
    );
    const removed = await written(
      removeDeck(db, { deckId: (await written(add(teacher, 5))).id, eventId: newUuidV7() }),
    );

    expect(await rejectUnfinishedDecks(db, dayAfter(5, -1))).not.toContain(left.id);
    const rejected = await rejectUnfinishedDecks(db, dayAfter(5));
    const again = await rejectUnfinishedDecks(db, dayAfter(5));

    expect(rejected).toContain(left.id);
    for (const spared of [younger, checked, removed]) expect(rejected).not.toContain(spared.id);
    expect(again).toEqual([]);
    const unfinished = { ...left, status: 'rejected', rejection: 'unfinished' };
    expect(await decksOf(teacher.id)).toEqual(
      expect.arrayContaining([unfinished, younger, checked, removed]),
    );
    // A complete meeting it answers the sweep's verdict, as any of a checked deck.
    const verdict = { status: 'ready', pageCount: 1 } as const;
    expect(await completeDeck(db, { deckId: left.id, eventId: newUuidV7(), verdict })).toEqual({
      outcome: 'replay',
      deck: unfinished,
    });
  });

  it('claims the removed and rejected decks no upload can write, the oldest mint first; never a live one, a stamped one, one minted since or one not due', async () => {
    const { teacher } = await school('k-drop');
    const verdict = (status: 'ready' | 'rejected') =>
      status === 'ready'
        ? ({ status, pageCount: 1 } as const)
        : ({ status, rejection: 'encrypted' } as const);
    const check = async (minute: number, status: 'ready' | 'rejected') =>
      written(
        completeDeck(db, {
          deckId: (await written(add(teacher, minute))).id,
          eventId: newUuidV7(),
          verdict: verdict(status),
        }),
      );
    const remove = async (deck: { id: string }) =>
      written(removeDeck(db, { deckId: deck.id, eventId: newUuidV7() }));
    const rejected = await check(6, 'rejected');
    const removed = await remove(await written(add(teacher, 5)));
    await check(4, 'ready');
    await written(add(teacher, 4));
    const stamped = await remove(await written(add(teacher, 3)));
    await stampObjectDeleted(db, stamped.id, at(4));
    // Its create retried at 09:09, so its upload URL then.
    const remint = newUuidV7();
    await add(teacher, 5, remint);
    const reminted = await remove(await written(add(teacher, 9, remint)));
    const now = at(40);
    const theirs = async (mintedBy: Date, when = now) =>
      (await claimDecksToDrop(db, { mintedBy, now: when, limit: 100 }))
        .filter((deck) => deck.teacherId === teacher.id)
        .map((deck) => deck.id)
        .sort();

    expect(await theirs(at(8))).toEqual([removed.id, rejected.id].sort());
    // Claimed, each is due again only a minute on: until then only the one minted since is new.
    expect(await theirs(at(9))).toEqual([reminted.id]);
    expect(await theirs(at(9), new Date(at(41).getTime() - 1))).toEqual([]);
    expect(await theirs(at(9), at(41))).toEqual([removed.id, rejected.id, reminted.id].sort());
  });

  it('claims as many as asked, the oldest mint first, and no deck twice', async () => {
    const { teacher } = await school('k-drop-limit');
    // A day before every other deck in this file's database, so these are the oldest it holds.
    const early = (minute: number) => new Date(at(minute).getTime() - 24 * 60 * 60_000);
    const removedAt = async (minute: number) => {
      const made = await written(
        createDeck(db, {
          teacherId: teacher.id,
          schoolId: teacher.schoolId!,
          eventId: newUuidV7(),
          title: 'Cells',
          bytes: 1_000,
          sha256: SHA256,
          now: early(minute),
        }),
      );
      return written(removeDeck(db, { deckId: made.id, eventId: newUuidV7() }));
    };
    const second = await removedAt(6);
    const first = await removedAt(5);
    const claim = (limit: number) =>
      claimDecksToDrop(db, { mintedBy: early(9), now: at(40), limit });

    expect((await claim(1)).map((deck) => deck.id)).toEqual([first.id]);
    expect((await claim(10)).map((deck) => deck.id)).toEqual([second.id]);
    expect(await claim(10)).toEqual([]);
  });

  it('counts each try and puts the next off: a minute, doubling, at most an hour, never overflowing', async () => {
    const { teacher } = await school('k-drop-backoff');
    const removed = await written(
      removeDeck(db, { deckId: (await written(add(teacher, 5))).id, eventId: newUuidV7() }),
    );
    const claimed = async (now: Date) =>
      (await claimDecksToDrop(db, { mintedBy: at(5), now, limit: 100 })).find(
        (deck) => deck.id === removed.id,
      );
    let now = at(40);
    const waits: number[] = [];

    for (let tries = 1; tries <= 8; tries += 1) {
      const deck = await claimed(now);
      expect(deck?.objectDeleteAttempts).toBe(tries);
      const next = deck!.objectNextAttemptAt!;
      // Not tried again, by any sweep, until then.
      expect(await claimed(new Date(next.getTime() - 1))).toBeUndefined();
      waits.push((next.getTime() - now.getTime()) / 60_000);
      now = next;
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);

    // A wrong policy left for weeks fails a delete hourly: the wait stays an hour, never past
    // interval's range, which would make every claim an error.
    await db.update(decks).set({ objectDeleteAttempts: 1000 }).where(eq(decks.id, removed.id));
    expect(await claimed(now)).toMatchObject({
      objectDeleteAttempts: 1001,
      objectNextAttemptAt: new Date(now.getTime() + 60 * 60_000),
    });
  });
});
