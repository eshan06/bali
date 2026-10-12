import {
  completeDeck,
  createDeck,
  type Database,
  type DeckRow,
  endSession,
  events,
  newUuidV7,
  removeDeck,
  sessionPresentations,
  startSession,
  tapIn,
} from '@bali/db';
import type { ApiErrorBody, SlideResponse } from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryDeckStorage } from '../src/deck-storage.js';
import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * What a running session shows, through the API (Phase 7, M3; ARCHITECTURE, "Live lesson",
 * decisions 4–6): the teacher's slide changes, and a deck's removal refused while a running session
 * shows it. Who else is refused is the authorization matrix's too; the engine's own rules and races
 * are packages/db's (slides.test.ts, races.test.ts).
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** The server's clock: 09:10 in a 09:00–09:25 lesson unless a test moves it. */
let now: Date;

const at = (minute: number) => new Date(`2026-10-11T09:${String(minute).padStart(2, '0')}:00Z`);

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  now = at(10);
  ctx = await makeAuthedApp(
    db,
    () => now,
    memoryDeckStorage(() => now),
  );
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

/** A 09:00–09:25 lesson, its teacher's token, and a deck of theirs, ready with 12 pages. */
async function lesson(tag: string) {
  const c = await seedClassroom(db, tag);
  const { session } = await startSession(db, {
    classId: c.klass.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  const cells = await deck(c.teacher.id, c.school.id);
  return { ...c, session, cells, token: await ctx.tokenFor(c.teacher.cognitoId) };
}

/** A deck "Cells" of `teacherId`'s, checked `ready` with 12 pages, unless pending or rejected. */
async function deck(
  teacherId: string,
  schoolId: string,
  status: 'ready' | 'pending' | 'rejected' = 'ready',
): Promise<DeckRow> {
  const { deck: made } = await createDeck(db, {
    teacherId,
    schoolId,
    eventId: newUuidV7(),
    title: 'Cells',
    bytes: 1_000,
    sha256: 'c'.repeat(64),
    now: at(1),
  });
  if (status === 'pending') return made;
  const checked = await completeDeck(db, {
    deckId: made.id,
    eventId: newUuidV7(),
    verdict:
      status === 'ready' ? { status, pageCount: 12 } : { status, rejection: 'too_many_pages' },
  });
  if (checked.outcome === 'deck_not_found') throw new Error(checked.outcome);
  return checked.deck;
}

/** A slide change's body: `page` of `deckId` (null: stop presenting), under a fresh id. */
const showing = (deckId: string | null, page?: unknown, over: Record<string, unknown> = {}) => ({
  eventId: newUuidV7(),
  deckId,
  page,
  ...over,
});

const slide = (token: string, sessionId: string, payload: object) =>
  authedInject(ctx.app, token, { method: 'POST', url: `/v1/sessions/${sessionId}/slide`, payload });

const answered = (res: { json: () => unknown }) => res.json() as SlideResponse;
const reasonOf = (res: { json: () => unknown }) => (res.json() as ApiErrorBody).error.reason;

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
    .where(and(eq(events.sessionId, sessionId), eq(events.type, 'slide_shown')));

describe('POST /v1/sessions/:id/slide', () => {
  it('shows a page of the teacher’s ready deck, answered with it and never a URL; its retry answers the same', async () => {
    const l = await lesson('slide-show');
    const body = showing(l.cells.id, 3);

    const res = await slide(l.token, l.session.id, body);

    expect(res.statusCode).toBe(200);
    const shown = { deckId: l.cells.id, sha256: l.cells.sha256, page: 3, pageCount: 12 };
    expect(answered(res)).toEqual({ outcome: 'shown', slide: shown, eventId: body.eventId });
    expect(res.body).not.toMatch(/https?:/);
    expect(await presentationOf(l.session.id)).toMatchObject({ deckId: l.cells.id, page: 3 });

    now = at(11);
    const retry = await slide(l.token, l.session.id, body);
    expect(retry.statusCode).toBe(200);
    expect(answered(retry)).toEqual({ outcome: 'replay', slide: shown, eventId: body.eventId });
    expect(await slidesShown(l.session.id)).toHaveLength(1);
  });

  it('stops presenting: no slide, recorded', async () => {
    const l = await lesson('slide-stop');
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    const stop = showing(null);

    const res = await slide(l.token, l.session.id, stop);

    expect(res.statusCode).toBe(200);
    expect(answered(res)).toEqual({ outcome: 'shown', slide: null, eventId: stop.eventId });
    expect(await slidesShown(l.session.id)).toHaveLength(2);
  });

  it('answers an older slide change landing late with the slide now and its id, changing nothing', async () => {
    const l = await lesson('slide-order');
    // Minted in this order, as one teacher's two clicks; the later lands first.
    const [older, later] = [showing(l.cells.id, 2), showing(l.cells.id, 5)];
    await slide(l.token, l.session.id, later);

    const res = await slide(l.token, l.session.id, older);

    expect(res.statusCode).toBe(200);
    expect(answered(res)).toMatchObject({
      outcome: 'replay',
      slide: { page: 5 },
      eventId: later.eventId,
    });
    expect(await presentationOf(l.session.id)).toMatchObject({ page: 5 });
  });

  it('refuses a deck not the teacher’s, removed or unknown (404), not checked yet or rejected (409), and a page it lacks (400), recording nothing', async () => {
    const l = await lesson('slide-refused');
    const elsewhere = await seedClassroom(db, 'slide-refused-elsewhere');
    const theirs = await deck(elsewhere.teacher.id, elsewhere.school.id);
    const removed = await deck(l.teacher.id, l.school.id);
    await removeDeck(db, { deckId: removed.id, eventId: newUuidV7(), now: at(5) });
    const pending = await deck(l.teacher.id, l.school.id, 'pending');
    const rejected = await deck(l.teacher.id, l.school.id, 'rejected');

    const refusals: [object, number, string][] = [
      [showing(theirs.id, 1), 404, 'deck_not_found'],
      [showing(removed.id, 1), 404, 'deck_not_found'],
      [showing(randomUUID(), 1), 404, 'deck_not_found'],
      [showing(pending.id, 1), 409, 'deck_not_ready'],
      [showing(rejected.id, 1), 409, 'deck_rejected'],
      [showing(l.cells.id, 0), 400, 'page_out_of_range'],
      [showing(l.cells.id, 13), 400, 'page_out_of_range'],
      [showing(l.cells.id, -2), 400, 'page_out_of_range'],
    ];
    for (const [body, status, reason] of refusals) {
      const res = await slide(l.token, l.session.id, body);
      expect(res.statusCode, reason).toBe(status);
      expect(reasonOf(res)).toBe(reason);
    }

    expect(await presentationOf(l.session.id)).toBeUndefined();
    expect(await slidesShown(l.session.id)).toEqual([]);
  });

  it.each([
    ['an eventId that is no UUIDv7', { eventId: randomUUID() }],
    ['no eventId', { eventId: undefined }],
    ['a deck that is no id', { deckId: 'cells' }],
    ['no deck, not even none', { deckId: undefined }],
    ['a deck and no page', { page: undefined }],
    ['a page that is no whole number', { page: 1.5 }],
    ['a page that is text', { page: '1' }],
  ])('refuses %s as a malformed request, recording nothing', async (_, over) => {
    const l = await lesson(`slide-bad-${randomUUID()}`);

    const res = await slide(l.token, l.session.id, showing(l.cells.id, 1, over));

    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('invalid_request');
    expect(await presentationOf(l.session.id)).toBeUndefined();
  });

  it('refuses a session past its bell or ended, 409 session_not_running, where a replay shows nothing', async () => {
    const l = await lesson('slide-over');
    const first = showing(l.cells.id, 3);
    await slide(l.token, l.session.id, first);

    now = at(25);
    const pastBell = await slide(l.token, l.session.id, showing(l.cells.id, 4));
    now = at(12);
    await endSession(db, { sessionId: l.session.id, at: at(12), reason: 'ended' });
    const ended = await slide(l.token, l.session.id, showing(null));
    const replay = await slide(l.token, l.session.id, first);

    for (const res of [pastBell, ended]) {
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('session_not_running');
    }
    expect(replay.statusCode).toBe(200);
    expect(answered(replay)).toEqual({ outcome: 'replay', slide: null, eventId: first.eventId });
    expect(await slidesShown(l.session.id)).toHaveLength(1);
  });

  it('refuses an eventId spent elsewhere, 409 event_id_conflict, and an unknown session, 404', async () => {
    const l = await lesson('slide-spent');
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: l.session.id,
      studentId: l.student.id,
      eventId: tap,
      deviceTime: at(2),
      now: at(2),
    });

    const spent = await slide(l.token, l.session.id, showing(l.cells.id, 1, { eventId: tap }));
    const unknown = await slide(l.token, randomUUID(), showing(l.cells.id, 1));

    expect(spent.statusCode).toBe(409);
    expect(reasonOf(spent)).toBe('event_id_conflict');
    expect(unknown.statusCode).toBe(404);
    expect(reasonOf(unknown)).toBe('session_not_found');
    expect(await presentationOf(l.session.id)).toBeUndefined();
  });

  it('answers 503 deck_storage_off while storage is off, once the caller is found its teacher', async () => {
    const l = await lesson('slide-storage-off');
    const off = await makeAuthedApp(db, () => now);
    try {
      const send = async (sub: string) =>
        authedInject(off.app, await off.tokenFor(sub), {
          method: 'POST',
          url: `/v1/sessions/${l.session.id}/slide`,
          payload: showing(l.cells.id, 1),
        });

      const teacher = await send(l.teacher.cognitoId);
      expect(teacher.statusCode).toBe(503);
      expect(reasonOf(teacher)).toBe('deck_storage_off');
      expect((await send(l.student.cognitoId)).statusCode).toBe(403);
    } finally {
      await off.close();
    }
    expect(await presentationOf(l.session.id)).toBeUndefined();
  });
});

describe('DELETE /v1/decks/:id while a session shows it (M3)', () => {
  const remove = (token: string, id: string) =>
    authedInject(ctx.app, token, {
      method: 'DELETE',
      url: `/v1/decks/${id}`,
      payload: { eventId: newUuidV7() },
    });

  it('refuses 409 deck_in_use while the running session shows it, and removes it once it no longer does', async () => {
    const l = await lesson('slide-in-use');
    await slide(l.token, l.session.id, showing(l.cells.id, 3));

    const inUse = await remove(l.token, l.cells.id);
    expect(inUse.statusCode).toBe(409);
    expect(reasonOf(inUse)).toBe('deck_in_use');

    await slide(l.token, l.session.id, showing(null));
    const gone = await remove(l.token, l.cells.id);
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toMatchObject({ outcome: 'removed' });
  });

  it('removes a deck shown by a session past its bell, though the sweep has not ended it', async () => {
    const l = await lesson('slide-in-use-bell');
    await slide(l.token, l.session.id, showing(l.cells.id, 3));

    now = at(25);
    const res = await remove(l.token, l.cells.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'removed' });
  });
});
