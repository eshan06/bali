import { type Database, findUserByCognitoId, getHistoryPage, type HistoryRow } from '@bali/db';
import { HISTORY_PAGE_LIMIT, type HistoryEvent, type HistoryPage } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { ApiError, parse } from '../errors.js';

const HistoryQuery = z.object({
  /** The last event id of the page before: the cursor is a row, never an offset. */
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_LIMIT).default(HISTORY_PAGE_LIMIT),
});

function toHistoryEvent(row: HistoryRow): HistoryEvent {
  return {
    eventId: row.eventId,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    class: { id: row.classId, name: row.className },
    teacher: { displayName: row.teacherDisplayName },
    session:
      row.sessionId === null
        ? null
        : {
            id: row.sessionId,
            startedAt: row.startedAt!.toISOString(),
            endsAt: row.endsAt!.toISOString(),
            endedAt: row.endedAt?.toISOString() ?? null,
          },
    reason: row.reason,
    recordedAs: row.recordedAs,
    countedIn: row.countedIn,
  };
}

/**
 * GET /v1/me/history — the student's own timeline (A7): the moments recorded
 * about them that a teacher sees, in every class they have been in, newest
 * first, a page at a time (`getHistoryPage`). A read: it creates and writes
 * nothing, so someone signing in for the first time has an empty history, not
 * a new row. Only ever the caller's own — and a teacher has none to read (403).
 */
export function registerHistoryRoute(app: FastifyInstance, db: Database): void {
  app.get(
    '/v1/me/history',
    { preHandler: app.authenticate },
    async (request): Promise<HistoryPage> => {
      const identity = requireAuth(request);
      // A malformed query is a client bug; a cursor this history does not
      // hold is the phone's cue to reload from the top — a reason each.
      const { before, limit } = parse(HistoryQuery, request.query, 'invalid_request');

      // Looked up, never created: no row yet is no history yet.
      const caller = await findUserByCognitoId(db, identity.sub);
      if (caller?.role === 'teacher') {
        throw ApiError.forbidden('a history is a student’s own timeline');
      }
      if (!caller && before === undefined) return { events: [], nextBefore: null };
      const page = caller && (await getHistoryPage(db, caller.id, { before, limit }));
      // A cursor this history does not hold — another account's, say: the
      // phone reloads from the top.
      if (!page) {
        throw ApiError.badInput(
          'before is not an event of this history',
          undefined,
          'unknown_cursor',
        );
      }
      return { events: page.events.map(toHistoryEvent), nextBefore: page.nextBefore };
    },
  );
}
