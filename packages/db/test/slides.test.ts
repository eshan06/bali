import { sessionReport } from '@bali/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { getHistoryPage, getSessionEvents, getSessionRoster } from '../src/queries.js';
import {
  classes,
  decks,
  enrollments,
  events,
  schools,
  sessionPresentations,
  sessions,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  answerQuestion,
  completeDeck,
  createDeck,
  createSavedQuestion,
  type DeckRow,
  endSession,
  openQuestion,
  removeDeck,
  showSlide,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * What a running session shows (Phase 7, M3; ARCHITECTURE, "Live lesson", decisions 4–6): the
 * teacher's slide changes, each recorded as `slide_shown`, a later one never undone by an older one
 * landing late, and a deck's removal refused while a running session shows it. The races, against
 * the session's end and the deck's removal, are races.test.ts's; the route is apps/api's.
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

/** Ms Rivera's 09:00–09:25 lesson, Ana enrolled and not tapped in; Mr Other at her school. */
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
  /** A deck of `teacherId`'s, checked `ready` with `pages` pages unless left pending. */
  const deck = async (teacherId = teacher!.id, pages: number | 'pending' = 12) => {
    const { deck: made } = await createDeck(db, {
      teacherId,
      schoolId: school!.id,
      eventId: newUuidV7(),
      title: 'Cells',
      bytes: 1_000,
      sha256: 'c'.repeat(64),
    });
    if (pages === 'pending') return made;
    const verdict = { status: 'ready', pageCount: pages } as const;
    const checked = await completeDeck(db, { deckId: made.id, eventId: newUuidV7(), verdict });
    if (checked.outcome === 'deck_not_found') throw new Error(checked.outcome);
    return checked.deck;
  };
  /** Ms Rivera shows `page` of `deckId` (null: stops presenting) at 09:mm. */
  const show = (
    deckId: string | null,
    page: number | null,
    minute: number,
    eventId = newUuidV7(),
  ) =>
    showSlide(db, {
      sessionId: session.id,
      teacherId: teacher!.id,
      eventId,
      deckId,
      page,
      now: at(minute),
    });
  return {
    school: school!,
    teacher: teacher!,
    other: other!,
    ana: ana!,
    klass: klass!,
    session,
    deck,
    show,
  };
}

const presentationOf = async (sessionId: string) =>
  (
    await db
      .select()
      .from(sessionPresentations)
      .where(eq(sessionPresentations.sessionId, sessionId))
  )[0];

const slidesShown = (sessionId: string) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, 'slide_shown')))
    .orderBy(asc(events.seq));

const deckNow = async (deck: DeckRow) =>
  (await db.select().from(decks).where(eq(decks.id, deck.id)))[0]!;

describe('a session’s slide (decision 6)', () => {
  it('shows a page of a ready deck of the teacher’s, recorded as slide_shown naming no one', async () => {
    const { session, deck, show } = await lesson('s-show');
    const cells = await deck();
    const eventId = newUuidV7();

    const result = await show(cells.id, 3, 5, eventId);

    const presentation = { sessionId: session.id, deckId: cells.id, page: 3, eventId };
    expect(await presentationOf(session.id)).toEqual({ ...presentation, updatedAt: at(5) });
    expect(result).toMatchObject({ outcome: 'shown', presentation, deck: cells, session });
    expect(await slidesShown(session.id)).toMatchObject([
      {
        eventId,
        classId: session.classId,
        userId: null,
        occurredAt: at(5),
        payload: { deck_id: cells.id, page: 3 },
      },
    ]);
  });

  it('keeps one row a session: another page, another deck, and stopping each recorded', async () => {
    const { session, deck, show } = await lesson('s-move');
    const [cells, atoms] = [await deck(), await deck()];

    await show(cells.id, 3, 5);
    await show(cells.id, 4, 6);
    await show(atoms.id, 1, 7);
    const stop = newUuidV7();
    const stopped = await show(null, null, 8, stop);

    expect(stopped).toMatchObject({ outcome: 'shown', deck: null });
    expect(await presentationOf(session.id)).toEqual({
      sessionId: session.id,
      deckId: null,
      page: null,
      eventId: stop,
      updatedAt: at(8),
    });
    expect((await slidesShown(session.id)).map((e) => e.payload)).toEqual([
      { deck_id: cells.id, page: 3 },
      { deck_id: cells.id, page: 4 },
      { deck_id: atoms.id, page: 1 },
      { deck_id: null, page: null },
    ]);
  });

  it('stops presenting before anything was shown: a row that shows nothing', async () => {
    const { session, show } = await lesson('s-stop-first');

    expect(await show(null, 4, 5)).toMatchObject({ outcome: 'shown', deck: null });

    expect(await presentationOf(session.id)).toMatchObject({ deckId: null, page: null });
  });

  it('answers its replay with what is shown now, past the session’s end too, recording nothing more', async () => {
    const { session, deck, show } = await lesson('s-replay');
    const cells = await deck();
    const first = newUuidV7();
    await show(cells.id, 3, 5, first);
    const later = await show(cells.id, 5, 6);
    if (later.outcome !== 'shown') throw new Error(later.outcome);

    const again = await show(cells.id, 3, 7, first);
    await endSession(db, { sessionId: session.id, at: at(8), reason: 'ended' });
    const afterEnd = await show(cells.id, 3, 9, first);

    for (const replay of [again, afterEnd]) {
      expect(replay).toMatchObject({
        outcome: 'replay',
        presentation: later.presentation,
        deck: cells,
      });
    }
    expect(await slidesShown(session.id)).toHaveLength(2);
  });

  it('never lets an older slide change undo a later one: it changes nothing and records nothing (decision 4’s order)', async () => {
    const { session, teacher, deck, show } = await lesson('s-order');
    const cells = await deck();
    // Minted in this order, as one teacher's two clicks; the later lands first.
    const [older, later] = [newUuidV7(), newUuidV7()];
    await show(cells.id, 5, 5, later);

    const late = await show(cells.id, 4, 5, older);

    expect(late).toMatchObject({ outcome: 'replay', presentation: { page: 5, eventId: later } });
    expect(await slidesShown(session.id)).toMatchObject([{ eventId: later }]);
    // Its id was never kept: as a replaced answer's, it is no one's.
    const draft = await createSavedQuestion(db, {
      teacherId: teacher.id,
      eventId: older,
      prompt: 'Q?',
      options: ['a', 'b'],
    });
    expect(draft.outcome).toBe('created');
  });

  it('refuses a deck not the teacher’s, removed, unknown, not checked yet or rejected, and a page it lacks, recording nothing', async () => {
    const { session, other, deck, show } = await lesson('s-refused');
    const theirs = await deck(other.id);
    const removed = await deck();
    await removeDeck(db, { deckId: removed.id, eventId: newUuidV7(), now: at(4) });
    const pending = await deck(undefined, 'pending');
    const rejected = await completeDeck(db, {
      deckId: (await deck(undefined, 'pending')).id,
      eventId: newUuidV7(),
      verdict: { status: 'rejected', rejection: 'encrypted' },
    });
    if (rejected.outcome === 'deck_not_found') throw new Error(rejected.outcome);
    const cells = await deck();

    for (const deckId of [theirs.id, removed.id, newUuidV7()]) {
      expect(await show(deckId, 1, 5)).toEqual({ outcome: 'deck_not_found' });
    }
    expect(await show(pending.id, 1, 5)).toEqual({ outcome: 'deck_not_ready' });
    expect(await show(rejected.deck.id, 1, 5)).toEqual({ outcome: 'deck_rejected' });
    for (const page of [0, -1, 13, 2.5, null]) {
      expect(await show(cells.id, page, 5)).toEqual({ outcome: 'page_out_of_range' });
    }

    expect(await presentationOf(session.id)).toBeUndefined();
    expect(await slidesShown(session.id)).toEqual([]);
  });

  it('refuses a session not running by the server’s clock, past the bell or ended, and an unknown one', async () => {
    const { session, teacher, deck, show } = await lesson('s-over');
    const cells = await deck();

    await expect(show(cells.id, 1, 25)).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
    await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });
    for (const deckId of [cells.id, null]) {
      await expect(show(deckId, 1, 10)).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
    }
    await expect(
      showSlide(db, {
        sessionId: newUuidV7(),
        teacherId: teacher.id,
        eventId: newUuidV7(),
        deckId: cells.id,
        page: 1,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });

    expect(await presentationOf(session.id)).toBeUndefined();
    expect(await slidesShown(session.id)).toEqual([]);
  });
});

describe('a slide change’s eventId, spent both ways (settled 2026-10-10)', () => {
  it('a slide change under an id a tap, an answer, a draft, a deck or another session’s slide holds is refused, recording nothing', async () => {
    const l = await lesson('s-spent');
    const elsewhere = await lesson('s-spent-elsewhere');
    const cells = await l.deck();
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: l.session.id,
      studentId: l.ana.id,
      eventId: tap,
      deviceTime: at(2),
      now: at(2),
    });
    const { question } = await openQuestion(db, {
      sessionId: l.session.id,
      teacherId: l.teacher.id,
      eventId: newUuidV7(),
      prompt: 'Which?',
      options: ['a', 'b'],
      now: at(3),
    });
    const answer = newUuidV7();
    await answerQuestion(db, {
      questionId: question.id,
      studentId: l.ana.id,
      eventId: answer,
      option: 0,
      now: at(3),
    });
    const draft = newUuidV7();
    await createSavedQuestion(db, {
      teacherId: l.teacher.id,
      eventId: draft,
      prompt: 'Q?',
      options: ['a', 'b'],
    });
    const theirs = await elsewhere.show((await elsewhere.deck()).id, 1, 4);
    if (theirs.outcome !== 'shown') throw new Error(theirs.outcome);

    for (const eventId of [tap, answer, draft, cells.eventId, theirs.presentation.eventId]) {
      await expect(l.show(cells.id, 1, 5, eventId)).rejects.toMatchObject(conflict);
    }

    expect(await presentationOf(l.session.id)).toBeUndefined();
    expect(await slidesShown(l.session.id)).toEqual([]);
  });

  it('a tap, an unlock, an answer, a draft or a deck under a slide change’s id is refused, recording nothing', async () => {
    const { school, session, teacher, ana, deck, show } = await lesson('s-held');
    const cells = await deck();
    const shown = await show(cells.id, 1, 5);
    if (shown.outcome !== 'shown') throw new Error(shown.outcome);
    const { eventId } = shown.presentation;
    const { question } = await openQuestion(db, {
      sessionId: session.id,
      teacherId: teacher.id,
      eventId: newUuidV7(),
      prompt: 'Which?',
      options: ['a', 'b'],
      now: at(6),
    });
    const own = {
      sessionId: session.id,
      studentId: ana.id,
      eventId,
      deviceTime: at(7),
      now: at(7),
    };

    for (const reuse of [
      () => tapIn(db, own),
      () => unlock(db, own),
      () =>
        answerQuestion(db, {
          questionId: question.id,
          studentId: ana.id,
          eventId,
          option: 1,
          now: at(7),
        }),
      () =>
        createSavedQuestion(db, { teacherId: teacher.id, eventId, prompt: 'Q?', options: ['a'] }),
      () =>
        createDeck(db, {
          teacherId: teacher.id,
          schoolId: school.id,
          eventId,
          title: 'Atoms',
          bytes: 9,
          sha256: 'd'.repeat(64),
        }),
    ]) {
      await expect(reuse()).rejects.toMatchObject(conflict);
    }
    expect(await slidesShown(session.id)).toHaveLength(1);
  });
});

describe('a deck’s removal while a session shows it (decision 5)', () => {
  it('is refused deck_in_use, naming the class, while a running session shows it, and goes once it shows another, stops, or rings its bell', async () => {
    const { klass, deck, show } = await lesson('s-in-use');
    const [cells, atoms, ions] = [await deck(), await deck(), await deck()];
    const remove = (shown: DeckRow, minute: number) =>
      removeDeck(db, { deckId: shown.id, eventId: newUuidV7(), now: at(minute) });
    const inUse = { outcome: 'deck_in_use', classes: [{ id: klass.id, name: 's-in-use' }] };
    await show(cells.id, 2, 5);

    expect(await remove(cells, 6)).toEqual(inUse);
    expect(await deckNow(cells)).toEqual(cells);

    await show(atoms.id, 1, 7);
    expect(await remove(cells, 8)).toMatchObject({ outcome: 'removed' });
    await show(null, null, 9);
    expect(await remove(atoms, 10)).toMatchObject({ outcome: 'removed' });
    // Past the bell, though the sweep has not ended it, the session shows nothing (A17).
    await show(ions.id, 1, 11);
    expect(await remove(ions, 24)).toEqual(inUse);
    expect(await remove(ions, 25)).toMatchObject({ outcome: 'removed' });
  });

  it('goes once the session showing it has ended; its presentation keeps naming it', async () => {
    const { session, deck, show } = await lesson('s-in-use-ended');
    const cells = await deck();
    await show(cells.id, 2, 5);
    await endSession(db, { sessionId: session.id, at: at(6), reason: 'ended' });

    expect(
      await removeDeck(db, { deckId: cells.id, eventId: newUuidV7(), now: at(7) }),
    ).toMatchObject({ outcome: 'removed' });
    expect(await presentationOf(session.id)).toMatchObject({ deckId: cells.id, page: 2 });
  });
});

describe('the report, the grid and the history ignore a session’s slides', () => {
  it('read the same with its slide_shown events as without them', async () => {
    const { session, klass, ana, deck, show } = await lesson('s-ignored');
    const act = (minute: number) => ({
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: at(minute),
      now: at(minute),
    });
    await tapIn(db, act(1));
    await unlock(db, act(3));
    const grid = await getSessionRoster(db, session.id, klass.id);
    const history = await getHistoryPage(db, ana.id, { limit: 50 });

    const cells = await deck();
    await show(cells.id, 1, 5);
    await show(cells.id, 2, 6);
    await show(null, null, 7);
    expect(await getSessionRoster(db, session.id, klass.id)).toEqual(grid);
    expect(await getHistoryPage(db, ana.id, { limit: 50 })).toEqual(history);

    await endSession(db, { sessionId: session.id, at: at(12), reason: 'ended' });
    const all = await getSessionEvents(db, session.id);
    const without = all.filter((e) => e.type !== 'slide_shown');
    expect(all.length - without.length).toBe(3);
    const [ended] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(sessionReport(ended!, all, at(30))).toEqual(sessionReport(ended!, without, at(30)));
  });
});
