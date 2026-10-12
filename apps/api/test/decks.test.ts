import {
  createSavedQuestion,
  type Database,
  decks,
  newUuidV7,
  savedQuestions,
  users,
} from '@bali/db';
import {
  type ApiErrorBody,
  type CreateDeckResponse,
  DECK_MAX_BYTES,
  DECK_TITLE_MAX_LENGTH,
  type DeckResponse,
  type DecksResponse,
} from '@bali/shared';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type MemoryDeckStorage, memoryDeckStorage, StorageError } from '../src/deck-storage.js';
import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * A teacher's slide decks through the API (Phase 7, M2; ARCHITECTURE, "Live lesson", decisions 4,
 * 5, 6 and 8): create, list and remove, against the in-memory bucket, and every deck route's
 * answer while storage is off. Who else is refused is the authorization matrix's too; the engine's
 * own rules and races are packages/db's.
 */

let db: Database;
let closeDb: () => Promise<void>;
let storage: MemoryDeckStorage;
let ctx: AuthedApp;
/** The server's clock, which the bucket's URLs keep too. */
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

/** A PDF's bytes, and the SHA-256 a browser declares for them. */
const PDF = new TextEncoder().encode('%PDF-1.7 a deck');
const SHA256 = createHash('sha256').update(PDF).digest('hex');

/** A create's body: "Cells", the PDF above, unless said. */
const adding = (over: Record<string, unknown> = {}) => ({
  eventId: newUuidV7(),
  title: 'Cells',
  bytes: PDF.byteLength,
  sha256: SHA256,
  ...over,
});

const create = (token: string, payload: object, app = ctx.app) =>
  authedInject(app, token, { method: 'POST', url: '/v1/decks', payload });
const list = (token: string, app = ctx.app) =>
  authedInject(app, token, { method: 'GET', url: '/v1/decks' });
const remove = (
  token: string,
  id: string,
  payload: object = { eventId: newUuidV7() },
  app = ctx.app,
) => authedInject(app, token, { method: 'DELETE', url: `/v1/decks/${id}`, payload });

/** PUT `body` to an upload URL, as the browser does. */
const upload = (url: string, body = PDF) =>
  storage.fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body });

const reasonOf = (res: { json: () => unknown }) => (res.json() as ApiErrorBody).error.reason;
const decksOf = (teacherId: string) =>
  db.select().from(decks).where(eq(decks.teacherId, teacherId));

/** A classroom's teacher, student and their tokens. */
async function people(tag: string) {
  const c = await seedClassroom(db, tag);
  const token = await ctx.tokenFor(c.teacher.cognitoId);
  return { ...c, token, studentToken: await ctx.tokenFor(c.student.cognitoId) };
}

/** Add a deck through the route: the answer. */
async function added(token: string, over: Record<string, unknown> = {}) {
  const res = await create(token, adding(over));
  expect(res.statusCode).toBe(200);
  return res.json<CreateDeckResponse>();
}

describe('POST /v1/decks', () => {
  it('adds a pending deck and the URL its PDF goes to; its retry is answered with a fresh one', async () => {
    const { teacher, token } = await people('deck-create');
    const body = adding({ title: '  Cells, part 2 ' });

    const res = await create(token, body);

    expect(res.statusCode).toBe(200);
    const [row] = await decksOf(teacher.id);
    const answer = res.json<CreateDeckResponse>();
    expect(answer).toEqual({
      outcome: 'created',
      deck: {
        id: row!.id,
        title: 'Cells, part 2',
        status: 'pending',
        bytes: PDF.byteLength,
        sha256: SHA256,
        pageCount: null,
        createdAt: now.toISOString(),
      },
      uploadUrl: answer.uploadUrl,
    });
    expect(row).toMatchObject({ eventId: body.eventId, storageKey: `decks/${row!.id}.pdf` });
    // For exactly that file: another length is refused, as S3 refuses it.
    expect((await upload(answer.uploadUrl, new Uint8Array(PDF.byteLength + 1))).status).toBe(403);
    expect((await upload(answer.uploadUrl)).status).toBe(200);
    expect(await storage.read(row!.storageKey, DECK_MAX_BYTES)).toEqual(PDF);

    now = at(12);
    const retry = (await create(token, body)).json<CreateDeckResponse>();
    expect(retry).toEqual({ ...answer, outcome: 'replay', uploadUrl: retry.uploadUrl });
    expect(retry.uploadUrl).not.toBe(answer.uploadUrl);
    expect((await upload(retry.uploadUrl)).status).toBe(200);
    expect(await decksOf(teacher.id)).toHaveLength(1);
  });

  it('refuses more than 25 MB before any URL is minted, and every malformed body: 400, nothing written', async () => {
    const { teacher, token } = await people('deck-invalid');

    for (const wrong of [
      { bytes: DECK_MAX_BYTES + 1 },
      { bytes: 0 },
      { bytes: 1.5 },
      { sha256: SHA256.toUpperCase() },
      { sha256: SHA256.slice(1) },
      { title: ' ' },
      { title: 'x'.repeat(DECK_TITLE_MAX_LENGTH + 1) },
      { title: 'Cells\npart 2' },
      { title: 'Cells‮' },
      { eventId: randomUUID() },
    ]) {
      const res = await create(token, adding(wrong));
      expect(res.statusCode, JSON.stringify(wrong)).toBe(400);
      expect(res.json<ApiErrorBody>().error.code).toBe('bad_input');
    }

    expect(await decksOf(teacher.id)).toEqual([]);
    // 25 MB itself is a deck.
    expect((await create(token, adding({ bytes: DECK_MAX_BYTES }))).statusCode).toBe(200);
  });

  it('refuses a teacher with no school, as a class’s create does: 409', async () => {
    const { teacher, token } = await people('deck-no-school');
    await db.update(users).set({ schoolId: null }).where(eq(users.id, teacher.id));

    const res = await create(token, adding());

    expect(res.statusCode).toBe(409);
    expect(await decksOf(teacher.id)).toEqual([]);
  });

  it('refuses an eventId another write holds: 409 event_id_conflict, nothing written', async () => {
    const { teacher, token } = await people('deck-spent');
    const draft = newUuidV7();
    const words = { prompt: 'Which?', options: ['a', 'b'] };
    await createSavedQuestion(db, { teacherId: teacher.id, eventId: draft, ...words });
    const mine = adding();
    const { deck } = (await create(token, mine)).json<CreateDeckResponse>();

    for (const res of [
      await create(token, adding({ eventId: draft })),
      // Its own create's id, for another file.
      await create(token, adding({ eventId: mine.eventId, title: 'Atoms' })),
      await remove(token, deck.id, { eventId: draft }),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('event_id_conflict');
    }

    expect(await decksOf(teacher.id)).toMatchObject([{ eventId: mine.eventId, removedAt: null }]);
    const drafts = await db.select().from(savedQuestions).where(eq(savedQuestions.eventId, draft));
    expect(drafts).toHaveLength(1);
  });
});

describe('GET /v1/decks', () => {
  it('lists the caller’s own, newest first, never a removed one', async () => {
    const { token } = await people('deck-list');
    const other = await people('deck-list-elsewhere');
    expect((await list(token)).json<DecksResponse>()).toEqual({ decks: [] });
    const first = (await added(token, { title: 'First' })).deck;
    now = at(11);
    const second = (await added(token, { title: 'Second' })).deck;
    now = at(12);
    const third = (await added(token, { title: 'Third' })).deck;
    await added(other.token, { title: 'Theirs' });

    await remove(token, second.id);

    expect((await list(token)).json<DecksResponse>()).toEqual({ decks: [third, first] });
  });
});

describe('DELETE /v1/decks/:id', () => {
  it('removes one, then its stored object; its retry answers it removed, and anything else finds none', async () => {
    const { teacher, token } = await people('deck-remove');
    const { deck, uploadUrl } = await added(token);
    await upload(uploadUrl);
    const body = { eventId: newUuidV7() };
    now = at(12);

    const res = await remove(token, deck.id, body);

    expect(res.statusCode).toBe(200);
    expect(res.json<DeckResponse>()).toEqual({ outcome: 'removed', deck });
    const [row] = await decksOf(teacher.id);
    expect(await storage.read(row!.storageKey, DECK_MAX_BYTES)).toBe('missing');
    // Pending, its upload URL may still write it: the sweep's to stamp (M4).
    expect(row).toMatchObject({ removedAt: at(12), eventId: body.eventId, objectDeletedAt: null });

    expect((await remove(token, deck.id, body)).json<DeckResponse>()).toEqual({
      outcome: 'replay',
      deck,
    });
    for (const res of [await remove(token, deck.id), await remove(token, newUuidV7())]) {
      expect(res.statusCode).toBe(404);
      expect(reasonOf(res)).toBe('deck_not_found');
    }
  });

  it('stamps a decided deck’s object deleted once it is gone (decision 5)', async () => {
    const { teacher, token } = await people('deck-remove-ready');
    const { deck, uploadUrl } = await added(token);
    await upload(uploadUrl);
    // As the check marks it (M2b).
    await db.update(decks).set({ status: 'ready', pageCount: 3 }).where(eq(decks.id, deck.id));
    now = at(12);

    expect((await remove(token, deck.id)).statusCode).toBe(200);

    const [row] = await decksOf(teacher.id);
    expect(row).toMatchObject({ removedAt: at(12), objectDeletedAt: at(12) });
    expect(await storage.read(row!.storageKey, DECK_MAX_BYTES)).toBe('missing');
  });

  it('keeps the removal when the object’s delete fails, leaving it unstamped for the sweep', async () => {
    const failing = {
      ...storage,
      delete: () => Promise.reject(new StorageError('InternalError', 500)),
    };
    const broken = await makeAuthedApp(db, () => now, failing);
    try {
      const { teacher, token } = await people('deck-remove-fails');
      const { deck } = await added(token);
      await db.update(decks).set({ status: 'ready', pageCount: 3 }).where(eq(decks.id, deck.id));

      const own = await broken.tokenFor(teacher.cognitoId);
      const res = await remove(own, deck.id, undefined, broken.app);

      expect(res.statusCode).toBe(200);
      expect(res.json<DeckResponse>().outcome).toBe('removed');
      const [row] = await decksOf(teacher.id);
      expect(row!.removedAt).not.toBeNull();
      expect(row!.objectDeletedAt).toBeNull();
    } finally {
      await broken.close();
    }
  });

  it('refuses another teacher’s deck: 403, nothing changed', async () => {
    const { teacher, token } = await people('deck-remove-theirs');
    const other = await people('deck-remove-theirs-elsewhere');
    const { deck } = await added(token);

    expect((await remove(other.token, deck.id)).statusCode).toBe(403);

    expect(await decksOf(teacher.id)).toMatchObject([{ removedAt: null }]);
  });
});

describe('while decks’ storage is off (no bucket set up)', () => {
  it('answers every deck route 503 deck_storage_off, writing nothing; a student is still 403', async () => {
    const off = await makeAuthedApp(db, () => now);
    try {
      const { teacher, student, token } = await people('deck-off');
      // Added while storage was on.
      const { deck } = await added(token);
      const own = await off.tokenFor(teacher.cognitoId);

      for (const res of [
        await list(own, off.app),
        await create(own, adding(), off.app),
        await remove(own, deck.id, undefined, off.app),
      ]) {
        expect(res.statusCode).toBe(503);
        expect(res.json<ApiErrorBody>().error).toMatchObject({
          code: 'unavailable',
          reason: 'deck_storage_off',
        });
      }
      expect((await list(await off.tokenFor(student.cognitoId), off.app)).statusCode).toBe(403);
      expect(await decksOf(teacher.id)).toMatchObject([{ removedAt: null }]);
    } finally {
      await off.close();
    }
  });
});
