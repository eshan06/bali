import {
  claimDecksToDrop,
  completeDeck,
  createDeck,
  type Database,
  type DeckRow,
  eventIdSpent,
  findDeck,
  findUserByCognitoId,
  listDecks,
  rejectUnfinishedDecks,
  removeDeck,
  sessionRunning,
  sessionsShowingDeck,
  showSlide,
  stampObjectDeleted,
} from '@bali/db';
import {
  type CreateDeckResponse,
  type Deck,
  type DeckDownload,
  DECK_MAX_BYTES,
  DECK_TITLE_MAX_LENGTH,
  type DeckResponse,
  type DecksResponse,
  type SlideResponse,
} from '@bali/shared';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { requireSessionOwner, requireTeacher } from '../auth/teacher.js';
import { PERSISTENT_FAILURE_TRIES } from '../cognito/sign-in-deletion.js';
import { checkDeck, type ParsePdf } from '../deck-check.js';
import { type DeckStorage, URL_LIFETIME_S } from '../deck-storage.js';
import { ApiError, parseRequest } from '../errors.js';
import { captureFailure } from '../monitoring.js';
import { mapTransitionError, refusal } from './errors.js';
import { slide, Text } from './questions.js';

const Params = z.object({ id: z.string().uuid() });
const CreateBody = z.object({
  eventId: z.uuidv7(),
  title: Text(DECK_TITLE_MAX_LENGTH),
  // More than 25 MB is refused here, before any URL is minted (decision 6).
  bytes: z.number().int().positive().max(DECK_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'is not a lowercase hex SHA-256'),
});
const EventBody = z.object({ eventId: z.uuidv7() });
const SlideBody = z
  .object({
    eventId: z.uuidv7(),
    deckId: z.string().uuid().nullable(),
    // Any whole number: a page the deck lacks is the engine's `page_out_of_range`.
    page: z.number().int().nullish(),
  })
  .refine((b) => b.deckId === null || b.page != null, { message: 'names no page', path: ['page'] });

const deckNotFound = () => ApiError.notFound('deck not found', 'deck_not_found');

/** A slide change the engine refused (M3), or a deck no download serves (M3b): nothing written. */
const slideRefused = {
  deck_not_found: deckNotFound,
  deck_not_ready: () => ApiError.conflict('the deck is not checked yet', 'deck_not_ready'),
  deck_rejected: () => ApiError.conflict('the deck was rejected', 'deck_rejected'),
  page_out_of_range: () =>
    ApiError.badInput('the deck has no such page', undefined, 'page_out_of_range'),
};

const deck = (row: DeckRow): Deck => ({
  id: row.id,
  title: row.title,
  status: row.status,
  bytes: row.bytes,
  sha256: row.sha256,
  pageCount: row.pageCount,
  rejection: row.rejection,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Decks' storage. While it is off, no bucket set up (M1), every deck route, the slide's too, is
 * `503 deck_storage_off` once its caller is found (the download's: allowed to see the deck), before
 * anything is written: the server's lack, never the request's.
 */
function requireStorage(app: FastifyInstance): DeckStorage {
  if (app.deckStorage) return app.deckStorage;
  throw new ApiError('unavailable', 'slides are off on this server', undefined, 'deck_storage_off');
}

/** The caller, a teacher, and decks' storage (`requireStorage`). */
async function requireDecks(app: FastifyInstance, db: Database, request: FastifyRequest) {
  const teacher = await requireTeacher(db, request);
  return { teacher, storage: requireStorage(app) };
}

/** The caller's own deck, removed or not: none is `404 deck_not_found`, another teacher's `403`. */
async function requireOwnDeck(db: Database, id: string, teacherId: string) {
  const found = await findDeck(db, id);
  if (!found) throw deckNotFound();
  if (found.teacherId !== teacherId) throw ApiError.forbidden('not your deck');
  return found;
}

/**
 * The margin for an upload in flight (M2b2): S3 checks a presigned PUT's expiry when the upload
 * starts, so one begun as its URL lapses streams on. 25 MB at 140 kbit/s, a link no teacher waits
 * on, takes 25 minutes (`docs/DECISIONS.md`, 2026-10-11, M2b2).
 */
export const UPLOAD_IN_FLIGHT_MS = 25 * 60_000;
/** From its last upload URL's mint, how long until no upload can write a deck's object (M2b2). */
export const OBJECT_WRITABLE_MS = URL_LIFETIME_S * 1000 + UPLOAD_IN_FLIGHT_MS;
/** Objects one sweep deletes at once, together: each delete is bounded (M1), so the pass is too. */
export const DROPS_PER_PASS = 50;

/**
 * After the commit that removed or rejected it (decision 4), and only once no upload can write it
 * (the 5-minute rule, M2b2: its last upload URL's mint, the URL's 5 minutes, and an upload in
 * flight): its stored object deleted, and stamped so (decision 5's one exception). Before then it is
 * left for the sweep, which comes back for it; no route serves a removed or rejected deck. A failed
 * delete is said and left unstamped for the sweep too; the removal or the verdict stands. From the
 * sweep's third failed try in a row it is said at error and reported (M4), as the Cognito sign-in
 * deleter's: a bucket or key mistake fails every delete, and is seen.
 */
async function dropObject(
  db: Database,
  storage: DeckStorage,
  log: FastifyBaseLogger,
  dropped: DeckRow,
  now: Date,
) {
  if (now.getTime() < dropped.uploadUrlMintedAt.getTime() + OBJECT_WRITABLE_MS) return;
  try {
    await storage.delete(dropped.storageKey);
  } catch (err) {
    // Its words name no one: a StorageError carries S3's code and status, never its message.
    const attempts = dropped.objectDeleteAttempts;
    const persistent = attempts >= PERSISTENT_FAILURE_TRIES;
    log[persistent ? 'error' : 'warn'](
      { err, deck: dropped.id, attempts },
      'a deck’s object was not deleted: the sweep tries it again later',
    );
    if (persistent) captureFailure(err, 'deck object deletion');
    return;
  }
  await stampObjectDeleted(db, dropped.id, now);
}

/**
 * The sweep's decks (decision 6, M2b2): every deck pending 24 hours rejected `unfinished`, then the
 * objects of removed and rejected decks no upload can write any more, deleted and stamped, the
 * oldest first: those that waited out their upload URL, whatever removed them (a teacher, or an
 * account's deletion, a disposal or a retention run, M4), and any a failed delete or a crash left
 * unstamped, once due again (`claimDecksToDrop`). Each settled before the pass ends.
 */
export async function sweepDecks(
  db: Database,
  storage: DeckStorage,
  log: FastifyBaseLogger,
  now: Date,
): Promise<void> {
  await rejectUnfinishedDecks(db, now);
  const mintedBy = new Date(now.getTime() - OBJECT_WRITABLE_MS);
  const due = await claimDecksToDrop(db, { mintedBy, now, limit: DROPS_PER_PASS });
  const dropped = await Promise.allSettled(
    due.map((deck) => dropObject(db, storage, log, deck, now)),
  );
  for (const tried of dropped) if (tried.status === 'rejected') throw tried.reason;
}

/**
 * A teacher's slide decks (Phase 7, M2; "Live lesson", decisions 4, 5, 6 and 8), their own only.
 * Thin over the engine, which writes them; the PDF goes to the bucket by a presigned PUT, never
 * through the API.
 *
 * GET    /v1/decks               the caller's decks, newest first, none removed
 * POST   /v1/decks               a pending deck and the URL its PDF is uploaded to
 * DELETE /v1/decks/:id           remove it; its stored object goes once no upload can write it
 * POST   /v1/decks/:id/complete  its upload checked: ready, or rejected, its object deleted as a
 *                                removed deck's is
 * GET    /v1/decks/:id/download  a presigned GET of its PDF: for its teacher, or a student while a
 *                                running session of their class shows it (M3b)
 * POST   /v1/sessions/:id/slide  show a page of one in the class's running session, or stop (M3)
 *
 * The sweep's part is `sweepDecks`.
 */
export function registerDecksRoutes(
  app: FastifyInstance,
  db: Database,
  clock: () => Date,
  parse: ParsePdf,
): void {
  app.get(
    '/v1/decks',
    { preHandler: app.authenticate },
    async (request): Promise<DecksResponse> => {
      const { teacher } = await requireDecks(app, db, request);
      return { decks: (await listDecks(db, teacher.id)).map(deck) };
    },
  );

  app.post(
    '/v1/decks',
    { preHandler: app.authenticate, config: { parses: { body: CreateBody } } },
    async (request): Promise<CreateDeckResponse> => {
      const { teacher, storage } = await requireDecks(app, db, request);
      const body = parseRequest(request, 'body', CreateBody);
      // A deck is kept with its teacher's school, as a class is.
      const schoolId = teacher.schoolId;
      if (!schoolId) throw ApiError.conflict('teacher is not assigned to a school');
      const { outcome, deck: made } = await mapTransitionError(() =>
        createDeck(db, { ...body, teacherId: teacher.id, schoolId, now: clock() }),
      );
      // A fresh URL for a replay too: the first answer, and its URL, never reached the caller. The
      // engine recorded its mint at `now`, before it; the margin covers the commit between (M2b2).
      const uploadUrl = storage.uploadUrl(made.storageKey, made.bytes);
      return { outcome, deck: deck(made), uploadUrl };
    },
  );

  app.delete(
    '/v1/decks/:id',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: EventBody } } },
    async (request): Promise<DeckResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      const { teacher, storage } = await requireDecks(app, db, request);
      // A removed one passes, for its removal's retry; the engine answers any other write `404`.
      await requireOwnDeck(db, id, teacher.id);
      const { eventId } = parseRequest(request, 'body', EventBody);
      const now = clock();
      const result = await mapTransitionError(() => removeDeck(db, { deckId: id, eventId, now }));
      if (result.outcome === 'deck_not_found') throw deckNotFound();
      if (result.outcome === 'deck_in_use') {
        throw ApiError.conflict('a running session shows the deck', 'deck_in_use');
      }
      if (!result.deck.objectDeletedAt)
        await dropObject(db, storage, request.log, result.deck, now);
      return { outcome: result.outcome, deck: deck(result.deck) };
    },
  );

  app.post(
    '/v1/decks/:id/complete',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: EventBody } } },
    async (request): Promise<DeckResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      const { teacher, storage } = await requireDecks(app, db, request);
      const { eventId } = parseRequest(request, 'body', EventBody);
      // Read before the deck: a verdict this complete's own first delivery records in between then
      // reads below as the deck checked, its replay, never as the id spent (santa's round 1).
      const spent = await eventIdSpent(db, eventId);
      const found = await requireOwnDeck(db, id, teacher.id);
      if (found.removedAt) throw deckNotFound();
      // One-way: a deck checked already is answered with its verdict, never checked again.
      if (found.status !== 'pending') return { outcome: 'replay', deck: deck(found) };
      // A spent eventId never takes a check's turn: refused by that one read, before anything is
      // read or parsed (#324's review). The engine asks again as it records the verdict.
      if (spent) throw refusal('EVENT_ID_CONFLICT');
      // Outside any transaction: the read and the parse take seconds, never under a row lock.
      const verdict = await checkDeck(storage, found, parse);
      const result = await mapTransitionError(() =>
        completeDeck(db, { deckId: id, eventId, verdict }),
      );
      if (result.outcome === 'deck_not_found') throw deckNotFound();
      if (result.outcome === 'checked' && result.deck.status === 'rejected')
        await dropObject(db, storage, request.log, result.deck, clock());
      return { outcome: result.outcome, deck: deck(result.deck) };
    },
  );

  app.get(
    '/v1/decks/:id/download',
    { preHandler: app.authenticate, config: { parses: { params: Params } } },
    async (request): Promise<DeckDownload> => {
      const { id } = parseRequest(request, 'params', Params);
      const caller = await findUserByCognitoId(db, requireAuth(request).sub);
      const found = await findDeck(db, id);
      // Removed is gone for everyone: its teacher, and the students of a lesson that showed it.
      if (!found || found.removedAt) throw deckNotFound();
      const now = clock();
      // A student only while a running session shows it, never by a presentation's row alone.
      const allowed =
        caller !== undefined &&
        (found.teacherId === caller.id ||
          (await sessionsShowingDeck(db, found.id, caller.id)).some((s) => sessionRunning(s, now)));
      if (!allowed) throw ApiError.forbidden('no running session of yours shows this deck');
      const storage = requireStorage(app);
      // Only its teacher reaches one unchecked or rejected: a slide shows a ready deck alone.
      if (found.status !== 'ready')
        throw slideRefused[found.status === 'pending' ? 'deck_not_ready' : 'deck_rejected']();
      return { url: storage.downloadUrl(found.storageKey) };
    },
  );

  app.post(
    '/v1/sessions/:id/slide',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: SlideBody } } },
    async (request): Promise<SlideResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      const { teacher, session } = await requireSessionOwner(db, request, id);
      requireStorage(app);
      // A 400 here can also be `page_out_of_range`, so a malformed body says which it is.
      const body = parseRequest(request, 'body', SlideBody, 'invalid_request');
      const now = clock();
      const result = await mapTransitionError(() =>
        showSlide(db, {
          ...body,
          page: body.page ?? null,
          sessionId: session.id,
          teacherId: teacher.id,
          now,
        }),
      );
      if (!('presentation' in result)) throw slideRefused[result.outcome]();
      const { presentation, deck: shown } = result;
      // Nothing is shown outside a running session (decision 2): a replay past the bell, none.
      const running = sessionRunning(result.session, now);
      return {
        outcome: result.outcome,
        slide: shown && running ? slide(presentation, shown) : null,
        eventId: presentation.eventId,
      };
    },
  );
}
