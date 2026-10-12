import {
  completeDeck,
  createDeck,
  type Database,
  type DeckRow,
  findDeck,
  listDecks,
  removeDeck,
  stampObjectDeleted,
} from '@bali/db';
import {
  type CreateDeckResponse,
  type Deck,
  DECK_MAX_BYTES,
  DECK_TITLE_MAX_LENGTH,
  type DeckResponse,
  type DecksResponse,
} from '@bali/shared';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireTeacher } from '../auth/teacher.js';
import { checkDeck, type ParsePdf } from '../deck-check.js';
import type { DeckStorage } from '../deck-storage.js';
import { ApiError, parseRequest } from '../errors.js';
import { mapTransitionError } from './errors.js';
import { Text } from './questions.js';

const Params = z.object({ id: z.string().uuid() });
const CreateBody = z.object({
  eventId: z.uuidv7(),
  title: Text(DECK_TITLE_MAX_LENGTH),
  // More than 25 MB is refused here, before any URL is minted (decision 6).
  bytes: z.number().int().positive().max(DECK_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'is not a lowercase hex SHA-256'),
});
const EventBody = z.object({ eventId: z.uuidv7() });

const deckNotFound = () => ApiError.notFound('deck not found', 'deck_not_found');

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
 * The caller, a teacher, and decks' storage. While storage is off, no bucket set up (M1), every
 * deck route is `503 deck_storage_off`, before anything is read or written: the server's lack,
 * never the request's.
 */
async function requireDecks(app: FastifyInstance, db: Database, request: FastifyRequest) {
  const teacher = await requireTeacher(db, request);
  const storage = app.deckStorage;
  if (!storage) {
    throw new ApiError(
      'unavailable',
      'slides are off on this server',
      undefined,
      'deck_storage_off',
    );
  }
  return { teacher, storage };
}

/** The caller's own deck, removed or not: none is `404 deck_not_found`, another teacher's `403`. */
async function requireOwnDeck(db: Database, id: string, teacherId: string) {
  const found = await findDeck(db, id);
  if (!found) throw deckNotFound();
  if (found.teacherId !== teacherId) throw ApiError.forbidden('not your deck');
  return found;
}

/**
 * After the commit that removed or rejected it (decision 4): its stored object deleted, and stamped
 * so (decision 5's one exception) unless the deck is still `pending`, whose upload URL may yet write
 * it (5 minutes, M1): the sweep's retry stamps that one once its URL has lapsed (M4). A failed
 * delete is said and left unstamped for the same retry; the removal or the verdict stands.
 */
async function dropObject(
  db: Database,
  storage: DeckStorage,
  log: FastifyBaseLogger,
  dropped: DeckRow,
  now: Date,
) {
  try {
    await storage.delete(dropped.storageKey);
  } catch (err) {
    log.warn({ err, deck: dropped.id }, 'a deck’s object was not deleted: left for the sweep');
    return;
  }
  if (dropped.status !== 'pending') await stampObjectDeleted(db, dropped.id, now);
}

/**
 * A teacher's slide decks (Phase 7, M2; "Live lesson", decisions 4, 5, 6 and 8), their own only.
 * Thin over the engine, which writes them; the PDF goes to the bucket by a presigned PUT, never
 * through the API.
 *
 * GET    /v1/decks               the caller's decks, newest first, none removed
 * POST   /v1/decks               a pending deck and the URL its PDF is uploaded to
 * DELETE /v1/decks/:id           remove it, then its stored object
 * POST   /v1/decks/:id/complete  its upload checked: ready, or rejected and its object deleted
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
      // A fresh URL for a replay too: the first answer, and its URL, never reached the caller.
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
      const found = await requireOwnDeck(db, id, teacher.id);
      const { eventId } = parseRequest(request, 'body', EventBody);
      if (found.removedAt) throw deckNotFound();
      // One-way: a deck checked already is answered with its verdict, never checked again.
      if (found.status !== 'pending') return { outcome: 'replay', deck: deck(found) };
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
}
