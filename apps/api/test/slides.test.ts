import {
  completeDeck,
  createDeck,
  type Database,
  type DeckRow,
  decks,
  endEnrollment,
  endSession,
  enrollments,
  events,
  newUuidV7,
  removeDeck,
  sessionPresentations,
  startSession,
  tapIn,
} from '@bali/db';
import type {
  ApiErrorBody,
  DeckDownload,
  Presentation,
  SessionSnapshot,
  SlideResponse,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type MemoryDeckStorage, memoryDeckStorage } from '../src/deck-storage.js';
import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * What a running session shows, through the API (Phase 7, M3; ARCHITECTURE, "Live lesson",
 * decisions 4–6): the teacher's slide changes, and a deck's removal refused while a running session
 * shows it; the slide in what students poll and the teacher's snapshot, and a deck's download
 * (M3b). Who else is refused is the authorization matrix's too; the engine's own rules and races
 * are packages/db's (slides.test.ts, races.test.ts).
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** Decks' storage, in memory, on the server's clock. */
let storage: MemoryDeckStorage;
/** The server's clock: 09:10 in a 09:00–09:25 lesson unless a test moves it. */
let now: Date;

const at = (minute: number) => new Date(`2026-10-11T09:${String(minute).padStart(2, '0')}:00Z`);

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  now = at(10);
  storage = memoryDeckStorage(() => now);
  ctx = await makeAuthedApp(db, () => now, storage);
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

/** A GET as `token`, with its `If-None-Match` when given. */
const read = (token: string, url: string, ifNoneMatch?: string) =>
  ctx.app.inject({
    method: 'GET',
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch }),
    },
  });
const poll = (token: string, sessionId: string, ifNoneMatch?: string) =>
  read(token, `/v1/sessions/${sessionId}/presentation`, ifNoneMatch);
async function slideOf(token: string, sessionId: string) {
  const res = await poll(token, sessionId);
  expect(res.statusCode).toBe(200);
  return res.json<Presentation>().slide;
}
async function snapshotOf(token: string, sessionId: string) {
  const res = await read(token, `/v1/sessions/${sessionId}`);
  expect(res.statusCode).toBe(200);
  return res.json<SessionSnapshot>().presentation;
}
const download = (token: string, deckId: string) => read(token, `/v1/decks/${deckId}/download`);
/** The lesson's student's token. */
const phoneOf = (l: { student: { cognitoId: string } }) => ctx.tokenFor(l.student.cognitoId);
/** Ends the lesson at 09:12, the clock with it. */
async function endAt12(sessionId: string) {
  now = at(12);
  await endSession(db, { sessionId, at: at(12), reason: 'ended' });
}

describe('the slide in what students read (M3b)', () => {
  it('shows the page the teacher shows, never a URL, and none before it or once presenting stopped', async () => {
    const l = await lesson('read-slide');
    const phone = await phoneOf(l);
    expect(await slideOf(phone, l.session.id)).toBeNull();

    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    const res = await poll(phone, l.session.id);
    expect(res.json<Presentation>().slide).toEqual({
      deckId: l.cells.id,
      sha256: l.cells.sha256,
      page: 3,
      pageCount: 12,
    });
    expect(res.body).not.toMatch(/https?:/);

    await slide(l.token, l.session.id, showing(null));
    expect(await slideOf(phone, l.session.id)).toBeNull();
  });

  it('answers 304 while the slide is unchanged, a late older change and a retry included, and anew once it moves', async () => {
    const l = await lesson('read-etag');
    const phone = await phoneOf(l);
    // Minted in this order, as one teacher's two clicks; the later lands first.
    const [older, later] = [showing(l.cells.id, 2), showing(l.cells.id, 3)];
    await slide(l.token, l.session.id, later);
    const etag = String((await poll(phone, l.session.id)).headers.etag);
    expect((await poll(phone, l.session.id, etag)).statusCode).toBe(304);

    expect(answered(await slide(l.token, l.session.id, older)).outcome).toBe('replay');
    expect(answered(await slide(l.token, l.session.id, later)).outcome).toBe('replay');
    expect((await poll(phone, l.session.id, etag)).statusCode).toBe(304);

    await slide(l.token, l.session.id, showing(l.cells.id, 4));
    const moved = await poll(phone, l.session.id, etag);
    expect(moved.statusCode).toBe(200);
    expect(moved.headers.etag).not.toBe(etag);
    expect(moved.json<Presentation>().slide).toMatchObject({ page: 4 });
  });

  it('never shows an ended session’s slide: past the bell before the sweep, ended, and once its deck is removed', async () => {
    const l = await lesson('read-over');
    const phone = await phoneOf(l);
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    const over = { running: false, question: null, slide: null, phone: null };

    now = at(25);
    expect((await poll(phone, l.session.id)).json()).toEqual(over);
    await endAt12(l.session.id);
    expect((await poll(phone, l.session.id)).json()).toEqual(over);
    await removeDeck(db, { deckId: l.cells.id, eventId: newUuidV7(), now: at(13) });
    expect((await poll(phone, l.session.id)).json()).toEqual(over);
    // The row still names the deck, as the history of what was shown (decision 4).
    expect(await presentationOf(l.session.id)).toMatchObject({ deckId: l.cells.id, page: 3 });
  });

  it('never names a removed deck, should a running session’s row still name one', async () => {
    const l = await lesson('read-removed');
    const phone = await phoneOf(l);
    const third = showing(l.cells.id, 3);
    await slide(l.token, l.session.id, third);
    // Staged: the removal itself refuses while a running session shows the deck (deck_in_use).
    await db.update(decks).set({ removedAt: at(9) }).where(eq(decks.id, l.cells.id));

    expect(await slideOf(phone, l.session.id)).toBeNull();
    expect(await snapshotOf(l.token, l.session.id)).toEqual({ slide: null, eventId: third.eventId });
    const res = await download(phone, l.cells.id);
    expect(res.statusCode).toBe(404);
    expect(reasonOf(res)).toBe('deck_not_found');
  });
});

describe('the boot snapshot’s presentation (M3b)', () => {
  it('carries the slide and the slide change that set it; none before the first, nor once the session is over', async () => {
    const l = await lesson('snapshot');
    expect(await snapshotOf(l.token, l.session.id)).toBeNull();

    const third = showing(l.cells.id, 3);
    await slide(l.token, l.session.id, third);
    const shown = { deckId: l.cells.id, sha256: l.cells.sha256, page: 3, pageCount: 12 };
    expect(await snapshotOf(l.token, l.session.id)).toEqual({
      slide: shown,
      eventId: third.eventId,
    });

    const stop = showing(null);
    await slide(l.token, l.session.id, stop);
    expect(await snapshotOf(l.token, l.session.id)).toEqual({ slide: null, eventId: stop.eventId });

    now = at(25);
    expect(await snapshotOf(l.token, l.session.id)).toBeNull();
  });
});

describe('GET /v1/decks/:id/download (M3b)', () => {
  it('gives a student a presigned GET while the running session shows the deck, its teacher always; nothing kept', async () => {
    const l = await lesson('download');
    const phone = await phoneOf(l);
    // The teacher's browser uploads it (M2): the bytes the URL then serves.
    const put = await storage.fetch(storage.uploadUrl(l.cells.storageKey, l.cells.bytes), {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array(l.cells.bytes),
    });
    expect(put.status).toBe(200);
    expect((await download(l.token, l.cells.id)).statusCode).toBe(200);
    expect((await download(phone, l.cells.id)).statusCode).toBe(403);

    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    const res = await download(phone, l.cells.id);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const fetched = await storage.fetch(res.json<DeckDownload>().url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('cache-control')).toBe('no-store');
    expect((await fetched.arrayBuffer()).byteLength).toBe(l.cells.bytes);
  });

  it('refuses a student once the session shows it no more: another deck, none, past the bell, ended', async () => {
    const l = await lesson('download-not-shown');
    const phone = await phoneOf(l);
    const other = await deck(l.teacher.id, l.school.id);
    const status = async (deckId: string) => (await download(phone, deckId)).statusCode;
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    expect(await status(l.cells.id)).toBe(200);

    await slide(l.token, l.session.id, showing(other.id, 1));
    expect([await status(l.cells.id), await status(other.id)]).toEqual([403, 200]);
    await slide(l.token, l.session.id, showing(null));
    expect(await status(other.id)).toBe(403);
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    now = at(25);
    expect(await status(l.cells.id)).toBe(403);
    await endAt12(l.session.id);
    expect(await status(l.cells.id)).toBe(403);
    expect((await download(l.token, l.cells.id)).statusCode).toBe(200);
  });

  it('refuses anyone else: another class’s student, one removed from this class, another teacher, no account', async () => {
    const l = await lesson('download-who');
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    const elsewhere = await seedClassroom(db, 'download-who-elsewhere');
    // Removed from this class, and in another, whose teacher shows nothing.
    await db.insert(enrollments).values({ classId: elsewhere.klass.id, studentId: l.student.id });
    const [gone] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.classId, l.klass.id), eq(enrollments.studentId, l.student.id)));
    await endEnrollment(db, { enrollmentId: gone!.id, reason: 'removed_from_class', at: at(5) });

    for (const sub of [
      elsewhere.student.cognitoId,
      l.student.cognitoId,
      elsewhere.teacher.cognitoId,
      'student-download-who-new',
    ]) {
      const res = await download(await ctx.tokenFor(sub), l.cells.id);
      expect(res.statusCode, sub).toBe(403);
    }
  });

  it('answers a removed deck 404 deck_not_found, to its teacher and the students of the lesson that showed it', async () => {
    const l = await lesson('download-removed');
    const phone = await phoneOf(l);
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    await endAt12(l.session.id);
    const removed = await authedInject(ctx.app, l.token, {
      method: 'DELETE',
      url: `/v1/decks/${l.cells.id}`,
      payload: { eventId: newUuidV7() },
    });
    expect(removed.statusCode).toBe(200);

    for (const res of [
      await download(l.token, l.cells.id),
      await download(phone, l.cells.id),
      await download(phone, randomUUID()),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(reasonOf(res)).toBe('deck_not_found');
    }
    expect((await download(phone, 'cells')).statusCode).toBe(400);
  });

  it('refuses its teacher a deck not checked yet or rejected (409), which no slide shows', async () => {
    const l = await lesson('download-unchecked');
    const pending = await deck(l.teacher.id, l.school.id, 'pending');
    const rejected = await deck(l.teacher.id, l.school.id, 'rejected');

    for (const [found, reason] of [
      [pending, 'deck_not_ready'],
      [rejected, 'deck_rejected'],
    ] as const) {
      const res = await download(l.token, found.id);
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe(reason);
    }
  });

  it('answers 503 deck_storage_off while storage is off, to a caller who may see the deck; anyone else 403', async () => {
    const l = await lesson('download-storage-off');
    await slide(l.token, l.session.id, showing(l.cells.id, 3));
    const elsewhere = await seedClassroom(db, 'download-storage-off-elsewhere');
    const off = await makeAuthedApp(db, () => now);
    try {
      const send = async (sub: string) =>
        authedInject(off.app, await off.tokenFor(sub), {
          method: 'GET',
          url: `/v1/decks/${l.cells.id}/download`,
        });

      for (const sub of [l.teacher.cognitoId, l.student.cognitoId]) {
        const res = await send(sub);
        expect(res.statusCode, sub).toBe(503);
        expect(reasonOf(res)).toBe('deck_storage_off');
      }
      expect((await send(elsewhere.student.cognitoId)).statusCode).toBe(403);
    } finally {
      await off.close();
    }
  });
});
