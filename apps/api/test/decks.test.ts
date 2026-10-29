import {
  applyRetention,
  createSavedQuestion,
  type Database,
  DECK_PENDING_LIMIT_MS,
  decks,
  disposeSchool,
  newUuidV7,
  savedQuestions,
  schools,
  users,
} from '@bali/db';
import {
  type ApiErrorBody,
  type CreateDeckResponse,
  DECK_MAX_BYTES,
  DECK_MAX_PAGES,
  DECK_TITLE_MAX_LENGTH,
  type DeckRejection,
  type DeckResponse,
  type DecksResponse,
} from '@bali/shared';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { CHECKS_AT_ONCE, parsePdf } from '../src/deck-check.js';
import { captureFailure } from '../src/monitoring.js';

vi.mock('../src/monitoring.js', async (actual) => ({
  ...(await actual<typeof import('../src/monitoring.js')>()),
  captureFailure: vi.fn(),
}));

/**
 * The gap between a complete's two reads, the deck and its `eventId` (santa's round 1 on M2b2): once
 * armed, the next of either read answers only after `between` has run, so a test commits another
 * write right there. Unarmed, both reads are the engine's own.
 */
const gap = vi.hoisted(() => ({ between: undefined as (() => Promise<unknown>) | undefined }));
vi.mock('@bali/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@bali/db')>();
  const paused =
    <A extends unknown[], R>(read: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      const answer = await read(...args);
      const between = gap.between;
      gap.between = undefined;
      await between?.();
      return answer;
    };
  return { ...real, findDeck: paused(real.findDeck), eventIdSpent: paused(real.eventIdSpent) };
});
import {
  type DeckStorage,
  type MemoryDeckStorage,
  memoryDeckStorage,
  StorageError,
} from '../src/deck-storage.js';
import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { encryptedPdf, pdf, swapped } from './helpers/pdf.js';

/*
 * A teacher's slide decks through the API (Phase 7, M2; ARCHITECTURE, "Live lesson", decisions 4,
 * 5, 6 and 8): create, list, remove and complete, against the in-memory bucket, the check with real
 * and hostile PDFs, and every deck route's answer while storage is off. Who else is refused is the authorization matrix's too; the engine's
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

const complete = (
  token: string,
  id: string,
  payload: object = { eventId: newUuidV7() },
  app = ctx.app,
) => authedInject(app, token, { method: 'POST', url: `/v1/decks/${id}/complete`, payload });

/** PUT `body` to an upload URL, as the browser does. */
const upload = (url: string, body = PDF) =>
  storage.fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body });

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

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

/** Add a deck for `bytes` and upload them through its URL, as the portal does: the deck. */
async function uploaded(token: string, bytes: Uint8Array<ArrayBuffer>) {
  const { deck, uploadUrl } = await added(token, {
    bytes: bytes.byteLength,
    sha256: sha256Of(bytes),
  });
  expect((await upload(uploadUrl, bytes)).status).toBe(200);
  return deck;
}

const rowOf = async (deckId: string) =>
  (await db.select().from(decks).where(eq(decks.id, deckId)))[0]!;

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
        rejection: null,
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
  it('removes one; its retry answers it removed, and anything else finds none', async () => {
    const { teacher, token } = await people('deck-remove');
    const { deck, uploadUrl } = await added(token);
    await upload(uploadUrl);
    const body = { eventId: newUuidV7() };
    now = at(12);

    const res = await remove(token, deck.id, body);

    expect(res.statusCode).toBe(200);
    expect(res.json<DeckResponse>()).toEqual({ outcome: 'removed', deck });
    const [row] = await decksOf(teacher.id);
    // Its upload URL, minted at 09:10, may still write it: the sweep's (M2b2).
    expect(await storage.read(row!.storageKey, DECK_MAX_BYTES)).toEqual(PDF);
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

  it('answers its retry in either letter case as its replay, never 404 (#442, part 3)', async () => {
    // A client minting its ids in upper case, as Foundation's `uuidString` writes them, resends a
    // removal whose answer never came. Postgres keeps a uuid lower-case, and the answers name it so.
    const { teacher, token } = await people('deck-remove-case');
    for (const loud of [true, false]) {
      const { deck } = await added(token);
      const id = newUuidV7();
      const cased = (s: string, upper: boolean) => (upper ? s.toUpperCase() : s);

      const res = await remove(token, cased(deck.id, loud), { eventId: cased(id, loud) });

      expect(res.json<DeckResponse>()).toEqual({ outcome: 'removed', deck });
      for (const upper of [loud, !loud]) {
        const retry = await remove(token, cased(deck.id, upper), { eventId: cased(id, upper) });
        expect(retry.statusCode).toBe(200);
        expect(retry.json<DeckResponse>()).toEqual({ outcome: 'replay', deck });
      }
      expect(await rowOf(deck.id)).toMatchObject({ eventId: id, removedAt: now });
    }
    expect(await decksOf(teacher.id)).toHaveLength(2);
  });

  it('deletes its object at once, stamped so, once no upload can write it (decision 5)', async () => {
    const { teacher, token } = await people('deck-remove-ready');
    const deck = await uploaded(token, pdf(3));
    await complete(token, deck.id);
    // 09:10's upload URL lapsed at 09:15, and an upload begun by then has had 25 minutes.
    now = at(40);

    expect((await remove(token, deck.id)).statusCode).toBe(200);

    const row = await rowOf(deck.id);
    expect(row).toMatchObject({ status: 'ready', removedAt: at(40), objectDeletedAt: at(40) });
    expect(await storage.read(row.storageKey, DECK_MAX_BYTES)).toBe('missing');
    expect(await decksOf(teacher.id)).toHaveLength(1);
  });

  it('keeps the removal when the object’s delete fails, leaving it unstamped for the sweep', async () => {
    const failing = {
      ...storage,
      delete: () => Promise.reject(new StorageError('InternalError', 500)),
    };
    const broken = await makeAuthedApp(db, () => now, failing);
    try {
      const { teacher, token } = await people('deck-remove-fails');
      const deck = await uploaded(token, pdf(1));
      now = at(40);

      const own = await broken.tokenFor(teacher.cognitoId);
      const res = await remove(own, deck.id, undefined, broken.app);

      expect(res.statusCode).toBe(200);
      expect(res.json<DeckResponse>().outcome).toBe('removed');
      const row = await rowOf(deck.id);
      expect(row.removedAt).not.toBeNull();
      expect(row.objectDeletedAt).toBeNull();
      expect(await storage.read(row.storageKey, DECK_MAX_BYTES)).not.toBe('missing');

      await ctx.app.sweep(at(41));

      expect(await storage.read(row.storageKey, DECK_MAX_BYTES)).toBe('missing');
      expect((await rowOf(deck.id)).objectDeletedAt).toEqual(at(41));
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
        await complete(own, deck.id, undefined, off.app),
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

describe('POST /v1/decks/:id/complete', () => {
  it('marks an uploaded PDF ready with its page count; its retry and any later complete answer that, never checking again', async () => {
    const { token } = await people('deck-check');
    const bytes = pdf(3);
    const { deck, uploadUrl } = await added(token, {
      bytes: bytes.byteLength,
      sha256: sha256Of(bytes),
    });
    await upload(uploadUrl, bytes);
    const body = { eventId: newUuidV7() };
    now = at(11);

    const res = await complete(token, deck.id, body);

    expect(res.statusCode).toBe(200);
    const ready = { ...deck, status: 'ready', pageCount: 3 };
    expect(res.json<DeckResponse>()).toEqual({ outcome: 'checked', deck: ready });
    expect(await rowOf(deck.id)).toMatchObject({ eventId: body.eventId, objectDeletedAt: null });
    // One-way: other bytes PUT by its URL since are never checked; every client checks the sha256.
    await upload(uploadUrl, swapped(bytes, '/Count 3', '/Count 2'));
    for (const again of [body, { eventId: newUuidV7() }]) {
      const answer = await complete(token, deck.id, again);
      expect(answer.json<DeckResponse>()).toEqual({ outcome: 'replay', deck: ready });
    }
    expect((await list(token)).json<DecksResponse>()).toEqual({ decks: [ready] });
    expect(await rowOf(deck.id)).toMatchObject({ eventId: body.eventId, status: 'ready' });
  });

  it('takes 200 pages, and rejects 201: too_many_pages', async () => {
    const { token } = await people('deck-pages');
    const most = await uploaded(token, pdf(DECK_MAX_PAGES));
    const over = await uploaded(token, pdf(DECK_MAX_PAGES + 1));

    const taken = (await complete(token, most.id)).json<DeckResponse>();
    const refused = (await complete(token, over.id)).json<DeckResponse>();

    expect(taken.deck).toMatchObject({
      status: 'ready',
      pageCount: DECK_MAX_PAGES,
      rejection: null,
    });
    expect(refused).toEqual({
      outcome: 'checked',
      deck: { ...over, status: 'rejected', rejection: 'too_many_pages' },
    });
  });

  it('rejects each upload that can be no deck, saying why; the sweep deletes each object once no upload can write it', async () => {
    const { token } = await people('deck-hostile');
    const three = pdf(3);
    const cases: [string, Uint8Array<ArrayBuffer>, DeckRejection][] = [
      // PDF.js would read this one: the magic alone refuses it.
      ['another format’s magic', swapped(three, '%PDF-', '%PNG-'), 'not_pdf'],
      [
        '%PDF- and nothing a PDF has',
        new TextEncoder().encode('%PDF-1.7\nno objects\n'),
        'not_pdf',
      ],
      ['no pages', pdf(0), 'not_pdf'],
      ['a password to open it', encryptedPdf(false), 'encrypted'],
      ['an owner’s password only, which opens with none', encryptedPdf(true), 'encrypted'],
    ];
    const rejected: string[] = [];
    for (const [why, bytes, rejection] of cases) {
      const deck = await uploaded(token, bytes);

      const res = await complete(token, deck.id);

      expect(res.statusCode, why).toBe(200);
      expect(res.json<DeckResponse>().deck, why).toEqual({
        ...deck,
        status: 'rejected',
        rejection,
      });
      rejected.push(deck.id);
    }

    // Other bytes of the declared length, which its URL takes: not the file declared.
    const { deck, uploadUrl } = await added(token, {
      bytes: three.byteLength,
      sha256: sha256Of(three),
    });
    await upload(uploadUrl, swapped(three, '/Count 3', '/Count 2'));
    expect((await complete(token, deck.id)).json<DeckResponse>().deck.rejection).toBe('mismatch');
    rejected.push(deck.id);
    // Nothing uploaded at all.
    const never = (await added(token)).deck;
    expect((await complete(token, never.id)).json<DeckResponse>().deck.rejection).toBe(
      'unfinished',
    );

    // Their upload URLs, minted at 09:10, lapsed at 09:15; an upload begun by then had 25 minutes.
    await ctx.app.sweep(at(40));

    for (const id of rejected) {
      const row = await rowOf(id);
      expect(row.objectDeletedAt).toEqual(at(40));
      expect(await storage.read(row.storageKey, DECK_MAX_BYTES)).toBe('missing');
    }
  });

  it('reads no further than 25 MB: an object past it is too_large, one of another length a mismatch', async () => {
    const asked: number[] = [];
    let answer: Awaited<ReturnType<DeckStorage['read']>> = 'too_large';
    const sized = await makeAuthedApp(db, () => now, {
      ...storage,
      read: (_key, maxBytes) => {
        asked.push(maxBytes);
        return Promise.resolve(answer);
      },
    });
    try {
      const { teacher, token } = await people('deck-sized');
      const own = await sized.tokenFor(teacher.cognitoId);
      const big = await uploaded(token, pdf(3));
      const short = await uploaded(token, pdf(3));

      const refused = await complete(own, big.id, undefined, sized.app);
      answer = pdf(2);
      const mismatched = await complete(own, short.id, undefined, sized.app);

      expect(refused.json<DeckResponse>().deck.rejection).toBe('too_large');
      expect(mismatched.json<DeckResponse>().deck.rejection).toBe('mismatch');
      expect(asked).toEqual([DECK_MAX_BYTES, DECK_MAX_BYTES]);
    } finally {
      await sized.close();
    }
  });

  it('stops a parse that stalls past its time limit, rejecting too_slow, while the API keeps answering', async () => {
    const limitMs = 500;
    const stalls = new URL('./helpers/stalling-parser.mjs', import.meta.url);
    const stalling = await makeAuthedApp(db, () => now, storage, {
      parsePdf: (bytes) => parsePdf(bytes, stalls, limitMs),
    });
    try {
      const { teacher, token } = await people('deck-stall');
      const own = await stalling.tokenFor(teacher.cognitoId);
      const deck = await uploaded(token, pdf(3));
      const answered: string[] = [];
      const started = performance.now();

      const checking = complete(own, deck.id, undefined, stalling.app).finally(() =>
        answered.push('complete'),
      );
      const listed = await list(own, stalling.app);
      answered.push('list');
      const health = await stalling.app.inject({ url: '/healthz' });
      answered.push('healthz');
      const res = await checking;

      expect([listed.statusCode, health.statusCode]).toEqual([200, 200]);
      expect(answered).toEqual(['list', 'healthz', 'complete']);
      expect(performance.now() - started).toBeGreaterThanOrEqual(limitMs - 5);
      expect(res.statusCode).toBe(200);
      expect(res.json<DeckResponse>().deck).toMatchObject({
        status: 'rejected',
        rejection: 'too_slow',
      });
    } finally {
      await stalling.close();
    }
  });

  it('checks two at a time; the rest wait their turn, and each is answered', async () => {
    let live = 0;
    let most = 0;
    const counting = await makeAuthedApp(db, () => now, storage, {
      parsePdf: async () => {
        most = Math.max(most, (live += 1));
        await new Promise((resolve) => setTimeout(resolve, 200));
        live -= 1;
        return { pages: 1 };
      },
    });
    try {
      const { teacher, token } = await people('deck-turns');
      const own = await counting.tokenFor(teacher.cognitoId);
      const pending = [];
      for (let i = 0; i < 5; i += 1) pending.push(await uploaded(token, pdf(1)));

      const answers = await Promise.all(
        pending.map((deck) => complete(own, deck.id, undefined, counting.app)),
      );

      const statuses = answers.map((res) => res.json<DeckResponse>().deck.status);
      expect(statuses).toEqual(Array<string>(5).fill('ready'));
      expect(most).toBe(CHECKS_AT_ONCE);
    } finally {
      await counting.close();
    }
  });

  it('ends a parse that runs out of its heap too_slow, and answers a crash or an exit with no answer 500, the deck pending; the API answers on', async () => {
    const { teacher, token } = await people('deck-endings');
    /** A parser that is `code` alone: what a hostile file could make PDF.js do. */
    const parser = (code: string) => new URL(`data:text/javascript,${encodeURIComponent(code)}`);
    const endings: [string, string, number][] = [
      ['out of its heap', 'const kept = []; for (;;) kept.push(new Array(1e6).fill(1.5));', 200],
      ['a crash', "throw new Error('the parser broke');", 500],
      ['an exit with no answer', 'process.exit(0);', 500],
    ];
    for (const [why, code, status] of endings) {
      const ending = await makeAuthedApp(db, () => now, storage, {
        parsePdf: (bytes) => parsePdf(bytes, parser(code)),
      });
      try {
        const deck = await uploaded(token, pdf(1));
        const { eventId: created } = await rowOf(deck.id);
        const own = await ending.tokenFor(teacher.cognitoId);

        const res = await complete(own, deck.id, undefined, ending.app);

        expect(res.statusCode, why).toBe(status);
        if (status === 200) {
          expect(res.json<DeckResponse>().deck, why).toMatchObject({
            status: 'rejected',
            rejection: 'too_slow',
          });
        } else {
          expect(await rowOf(deck.id), why).toMatchObject({ status: 'pending', eventId: created });
          expect((await complete(token, deck.id)).json<DeckResponse>().deck.status).toBe('ready');
        }
        expect((await ending.app.inject({ url: '/healthz' })).statusCode, why).toBe(200);
      } finally {
        await ending.close();
      }
    }
  });

  it('answers a retry whose first delivery records the verdict between its two reads with that verdict, never a conflict (santa’s round 1)', async () => {
    let parked!: () => void;
    const parking = new Promise<void>((resolve) => (parked = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = await makeAuthedApp(db, () => now, storage, {
      parsePdf: async () => {
        parked();
        await gate;
        return { pages: 1 };
      },
    });
    try {
      const { teacher, token } = await people('deck-retry-race');
      const own = await held.tokenFor(teacher.cognitoId);
      const deck = await uploaded(token, pdf(1));
      const body = { eventId: newUuidV7() };
      // The first delivery, parked in its parse with both its reads done.
      const first = complete(own, deck.id, body, held.app);
      await parking;
      // Its retry: between its two reads, the first delivery's verdict commits.
      gap.between = () => {
        release();
        return first;
      };

      const retry = await complete(own, deck.id, body, held.app);

      expect(gap.between).toBeUndefined();
      const ready = { ...deck, status: 'ready', pageCount: 1 };
      expect((await first).json<DeckResponse>()).toEqual({ outcome: 'checked', deck: ready });
      expect(retry.statusCode).toBe(200);
      expect(retry.json<DeckResponse>()).toEqual({ outcome: 'replay', deck: ready });
    } finally {
      release();
      await held.close();
    }
  });

  it('refuses an eventId another record holds after one read, before reading or parsing anything (#324’s review)', async () => {
    let reads = 0;
    let parses = 0;
    const counting = await makeAuthedApp(
      db,
      () => now,
      {
        ...storage,
        read: (key, maxBytes) => {
          reads += 1;
          return storage.read(key, maxBytes);
        },
      },
      {
        parsePdf: (bytes) => {
          parses += 1;
          return parsePdf(bytes);
        },
      },
    );
    try {
      const { teacher, token } = await people('deck-spent-early');
      const own = await counting.tokenFor(teacher.cognitoId);
      const deck = await uploaded(token, pdf(1));
      const draft = newUuidV7();
      const words = { prompt: 'Which?', options: ['a', 'b'] };
      await createSavedQuestion(db, { teacherId: teacher.id, eventId: draft, ...words });

      // A draft's id, and the deck's own create's.
      for (const eventId of [draft, (await rowOf(deck.id)).eventId]) {
        const res = await complete(own, deck.id, { eventId }, counting.app);
        expect(res.statusCode).toBe(409);
        expect(reasonOf(res)).toBe('event_id_conflict');
      }

      expect([reads, parses]).toEqual([0, 0]);
      const checked = await complete(own, deck.id, undefined, counting.app);
      expect(checked.json<DeckResponse>().deck.status).toBe('ready');
      expect([reads, parses]).toEqual([1, 1]);
    } finally {
      await counting.close();
    }
  });

  it('keeps the deck pending when the bucket fails its read: a 500, checked on the next complete', async () => {
    const failing = await makeAuthedApp(db, () => now, {
      ...storage,
      read: () => Promise.reject(new StorageError('InternalError', 500)),
    });
    try {
      const { teacher, token } = await people('deck-read-fails');
      const own = await failing.tokenFor(teacher.cognitoId);
      const deck = await uploaded(token, pdf(1));
      const { eventId: created } = await rowOf(deck.id);

      const res = await complete(own, deck.id, undefined, failing.app);

      expect(res.statusCode).toBe(500);
      expect(await rowOf(deck.id)).toMatchObject({ status: 'pending', eventId: created });
      expect((await complete(token, deck.id)).json<DeckResponse>().deck.status).toBe('ready');
    } finally {
      await failing.close();
    }
  });

  it('refuses another teacher’s deck, a removed or unknown one, a spent eventId and a malformed body, deciding nothing', async () => {
    const { teacher, token } = await people('deck-check-refused');
    const other = await people('deck-check-refused-elsewhere');
    const deck = await uploaded(token, pdf(1));
    const gone = await uploaded(token, pdf(1));
    await remove(token, gone.id);
    const draft = newUuidV7();
    const words = { prompt: 'Which?', options: ['a', 'b'] };
    await createSavedQuestion(db, { teacherId: teacher.id, eventId: draft, ...words });
    const created = (await rowOf(deck.id)).eventId;

    expect((await complete(other.token, deck.id)).statusCode).toBe(403);
    for (const res of [await complete(token, gone.id), await complete(token, newUuidV7())]) {
      expect(res.statusCode).toBe(404);
      expect(reasonOf(res)).toBe('deck_not_found');
    }
    // A draft's id, and the deck's own create's.
    for (const eventId of [draft, created]) {
      const res = await complete(token, deck.id, { eventId });
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('event_id_conflict');
    }
    expect((await complete(token, deck.id, { eventId: randomUUID() })).statusCode).toBe(400);

    expect(await rowOf(deck.id)).toMatchObject({ status: 'pending', eventId: created });
    expect((await complete(token, deck.id)).json<DeckResponse>().deck.status).toBe('ready');
  });
});

describe('a removed or rejected deck’s object, and the sweep (M2b2)', () => {
  it('is deleted only once its last upload URL can write it no more, a retried create’s included: 5 minutes, and 25 for an upload in flight', async () => {
    const { token } = await people('deck-rule');
    const body = adding();
    const { deck } = (await create(token, body)).json<CreateDeckResponse>();
    // Its create retried at 09:13: a fresh URL, good until 09:18.
    now = at(13);
    const retry = (await create(token, body)).json<CreateDeckResponse>();
    expect(retry.outcome).toBe('replay');
    now = at(14);
    expect((await remove(token, deck.id)).statusCode).toBe(200);
    // An upload begun on the retry's URL lands after the removal.
    now = at(16);
    expect((await upload(retry.uploadUrl)).status).toBe(200);
    const { storageKey } = await rowOf(deck.id);

    // 09:40 is 30 minutes after the first URL, 09:42:59.999 short of the retry's.
    for (const sweptAt of [at(40), new Date(at(43).getTime() - 1)]) {
      await ctx.app.sweep(sweptAt);
      expect(await storage.read(storageKey, DECK_MAX_BYTES)).toEqual(PDF);
      expect((await rowOf(deck.id)).objectDeletedAt).toBeNull();
    }
    await ctx.app.sweep(at(43));

    expect(await storage.read(storageKey, DECK_MAX_BYTES)).toBe('missing');
    expect((await rowOf(deck.id)).objectDeletedAt).toEqual(at(43));
  });

  it('keeps a rejected deck’s object by the same rule, then the sweep deletes it', async () => {
    const { token } = await people('deck-rule-rejected');
    const over = await uploaded(token, pdf(DECK_MAX_PAGES + 1));
    now = at(11);
    const refused = (await complete(token, over.id)).json<DeckResponse>();
    expect(refused.deck.rejection).toBe('too_many_pages');
    const { storageKey } = await rowOf(over.id);

    await ctx.app.sweep(new Date(at(40).getTime() - 1));
    expect(await storage.read(storageKey, DECK_MAX_BYTES)).not.toBe('missing');
    expect((await rowOf(over.id)).objectDeletedAt).toBeNull();
    await ctx.app.sweep(at(40));

    expect(await storage.read(storageKey, DECK_MAX_BYTES)).toBe('missing');
    expect((await rowOf(over.id)).objectDeletedAt).toEqual(at(40));
  });

  it('deletes a rejected deck’s object at once, stamped so, when its check comes 30 minutes after its last upload URL', async () => {
    const { token } = await people('deck-rule-late-check');
    // Uploaded by 09:10's URL, which lapsed at 09:15; checked at 09:40.
    const over = await uploaded(token, pdf(DECK_MAX_PAGES + 1));
    now = at(40);

    const refused = (await complete(token, over.id)).json<DeckResponse>();

    expect(refused.deck.rejection).toBe('too_many_pages');
    const row = await rowOf(over.id);
    expect(row.objectDeletedAt).toEqual(at(40));
    expect(await storage.read(row.storageKey, DECK_MAX_BYTES)).toBe('missing');
  });

  it('rejects a deck left pending 24 hours unfinished, and deletes its object by the same rule', async () => {
    const { token } = await people('deck-unfinished');
    // Uploaded at 09:10, never checked; another added at 09:11, nothing uploaded.
    const left = await uploaded(token, pdf(1));
    now = at(11);
    const younger = (await added(token)).deck;
    const dayAfter = (ms: number) => new Date(at(10).getTime() + DECK_PENDING_LIMIT_MS + ms);
    const { storageKey } = await rowOf(left.id);

    now = dayAfter(-1);
    await ctx.app.sweep(now);
    expect(await rowOf(left.id)).toMatchObject({ status: 'pending', objectDeletedAt: null });
    now = dayAfter(0);
    await ctx.app.sweep(now);

    const unfinished = { ...left, status: 'rejected', rejection: 'unfinished' };
    expect(await rowOf(left.id)).toMatchObject({
      status: 'rejected',
      rejection: 'unfinished',
      objectDeletedAt: now,
    });
    expect(await storage.read(storageKey, DECK_MAX_BYTES)).toBe('missing');
    expect((await list(token)).json<DecksResponse>()).toEqual({ decks: [younger, unfinished] });
    // A complete now answers the sweep's verdict.
    expect((await complete(token, left.id)).json<DeckResponse>()).toEqual({
      outcome: 'replay',
      deck: unfinished,
    });
  });
});

describe('decks in the privacy paths, and a delete that keeps failing (M4)', () => {
  /** A teacher with no class and no block, alone at a school whose year ended on 2026-10-11. */
  async function loneTeacher(tag: string) {
    const [school] = await db
      .insert(schools)
      .values({ name: `School ${tag}`, schoolYearEndsOn: '2026-10-11' })
      .returning();
    const [teacher] = await db
      .insert(users)
      .values({
        cognitoId: `teacher-${tag}`,
        role: 'teacher',
        schoolId: school!.id,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      })
      .returning();
    return { school: school!, teacher: teacher!, token: await ctx.tokenFor(teacher!.cognitoId) };
  }

  /** `token`'s two decks, each checked: one uploaded by 09:10's URL, one by 09:20's. */
  async function twoDecks(token: string) {
    const checked = async (minute: number, pages: number) => {
      now = at(minute);
      const deck = await uploaded(token, pdf(pages));
      expect((await complete(token, deck.id)).json<DeckResponse>().deck.status).toBe('ready');
      return deck;
    };
    return [await checked(10, 2), await checked(20, 1)] as const;
  }

  const stored = async (deck: { id: string }) =>
    storage.read((await rowOf(deck.id)).storageKey, DECK_MAX_BYTES);

  it('an account’s deletion removes its decks, their titles emptied; the sweep deletes each object once no upload can write it', async () => {
    const { token } = await loneTeacher('deck-c3');
    const [early, late] = await twoDecks(token);
    now = at(41);

    const res = await authedInject(ctx.app, token, {
      method: 'DELETE',
      url: '/v1/me',
      payload: { eventId: newUuidV7() },
    });

    expect(res.json()).toEqual({ outcome: 'deleted' });
    for (const deck of [early, late]) {
      expect(await rowOf(deck.id)).toMatchObject({ title: '', removedAt: at(41) });
      // Nothing reached the bucket inside the deletion.
      expect(await stored(deck)).not.toBe('missing');
    }
    // 09:10's upload URL can write its deck no more from 09:40; 09:20's from 09:50.
    await ctx.app.sweep(at(41));
    expect(await stored(early)).toBe('missing');
    expect((await rowOf(early.id)).objectDeletedAt).toEqual(at(41));
    expect(await stored(late)).not.toBe('missing');
    await ctx.app.sweep(at(50));
    expect(await stored(late)).toBe('missing');
    expect((await rowOf(late.id)).objectDeletedAt).toEqual(at(50));
  });

  for (const [tag, path] of [
    ['deck-c6a', 'a disposal'],
    ['deck-c6b', 'a retention run'],
  ] as const) {
    it(`${path} removes the decks it reaches, their titles emptied, and the sweep deletes each object; its preview touches neither`, async () => {
      const { school, token } = await loneTeacher(tag);
      const theirs = await twoDecks(token);
      // The day after the school's year ended, past that midnight in any zone.
      now = new Date('2026-10-12T15:00:00Z');
      const run = (confirmName?: string) => {
        const input = { schoolId: school.id, at: now, confirmName };
        return path === 'a disposal'
          ? disposeSchool(db, input)
          : applyRetention(db, { ...input, issuer: testEnv.AUTH_ISSUER });
      };
      const rows = () => Promise.all(theirs.map((deck) => rowOf(deck.id)));
      const before = await rows();

      expect((await run()).outcome).toBe('preview');
      await ctx.app.sweep(now);
      expect(await rows()).toEqual(before);
      for (const deck of theirs) expect(await stored(deck)).not.toBe('missing');

      expect((await run(school.name)).outcome).toBe(path === 'a disposal' ? 'disposed' : 'applied');
      expect(await rows()).toEqual(before.map((row) => ({ ...row, title: '', removedAt: now })));
      await ctx.app.sweep(now);
      for (const deck of theirs) {
        expect(await stored(deck)).toBe('missing');
        expect((await rowOf(deck.id)).objectDeletedAt).toEqual(now);
      }
    });
  }

  it('puts off a delete the bucket keeps refusing, a minute then two, said at error and reported from its third failure in a row; deleted once the bucket takes it', async () => {
    const { token } = await people('deck-refused');
    const deck = await uploaded(token, pdf(1));
    expect((await remove(token, deck.id)).statusCode).toBe(200);
    const { storageKey } = await rowOf(deck.id);
    let refusing = true;
    const refused: DeckStorage = {
      ...storage,
      delete: (key) =>
        refusing ? Promise.reject(new StorageError('AccessDenied', 403)) : storage.delete(key),
    };
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const sweeping = buildApp(
      { ...testEnv, LOG_LEVEL: 'warn' },
      { db, verifyToken: ctx.issuer.verifier, clock: () => now, deckStorage: refused, logStream },
    );
    vi.mocked(captureFailure).mockClear();
    try {
      // Its 09:10 upload URL can write it no more from 09:40; each try puts the next off.
      for (const minute of [40, 41, 43]) {
        await sweeping.sweep(at(minute));
        // Not due again a moment later: not tried.
        await sweeping.sweep(new Date(at(minute).getTime() + 59_000));
      }

      const failures = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter(
          (line) => line.msg === 'a deck’s object was not deleted: the sweep tries it again later',
        );
      // pino: warn is 40, error 50.
      expect(failures.map((line) => [line.level, line.attempts])).toEqual([
        [40, 1],
        [40, 2],
        [50, 3],
      ]);
      expect(captureFailure).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith(expect.any(StorageError), 'deck object deletion');
      expect(lines.join('')).not.toContain('Cells');
      expect(await rowOf(deck.id)).toMatchObject({
        objectDeletedAt: null,
        objectDeleteAttempts: 3,
        objectNextAttemptAt: at(47),
      });
      expect(await storage.read(storageKey, DECK_MAX_BYTES)).toEqual(pdf(1));

      refusing = false;
      await sweeping.sweep(at(47));

      expect(await storage.read(storageKey, DECK_MAX_BYTES)).toBe('missing');
      expect((await rowOf(deck.id)).objectDeletedAt).toEqual(at(47));
    } finally {
      await sweeping.close();
    }
  });
});
