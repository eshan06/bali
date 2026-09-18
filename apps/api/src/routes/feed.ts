import { type Database, getEventsSince, getLatestSeq, getSessionRoster } from '@bali/db';
import { EVENT_PAGE_LIMIT, type EventsPage, type SessionSnapshot } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSessionOwner } from '../auth/teacher.js';
import { ApiError, parse } from '../errors.js';
import { toFeedEvent } from '../sse/frame.js';
import { createStreamHub, type StreamHubOptions } from '../sse/hub.js';

const Params = z.object({ id: z.string().uuid() });
const AfterQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Ask nginx and similar proxies not to buffer the stream.
  'x-accel-buffering': 'no',
};

/**
 * The teacher grid's read + live sides (decision 5), all owner-only:
 * - GET /v1/sessions/:id — boot snapshot (session, roster, latest seq).
 * - GET /v1/sessions/:id/events?after=seq — catch-up page, seq-ascending.
 * - GET /v1/sessions/:id/stream — SSE live feed (Authorization header only, no
 *   token in the query string; the portal uses fetch, never EventSource).
 */
export function registerFeedRoutes(
  app: FastifyInstance,
  db: Database,
  streamOptions: StreamHubOptions = {},
): void {
  const hub = createStreamHub(db, streamOptions);
  const maxPerTeacher = streamOptions.maxPerTeacher ?? 5;
  // Tear every stream down when the server shuts down (drains cleanly, releases
  // the LISTEN connection).
  app.addHook('onClose', () => hub.close());

  app.get(
    '/v1/sessions/:id',
    { preHandler: app.authenticate },
    async (request): Promise<SessionSnapshot> => {
      const { id } = parse(Params, request.params);
      const { session } = await requireSessionOwner(db, request, id);

      const [roster, latestSeq] = await Promise.all([
        getSessionRoster(db, session.id, session.classId),
        getLatestSeq(db, session.id),
      ]);

      return {
        session: {
          id: session.id,
          classId: session.classId,
          startedAt: session.startedAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
        },
        ended: session.endedAt !== null,
        latestSeq,
        students: roster.map((r) => ({
          enrollmentId: r.enrollmentId,
          studentId: r.studentId,
          displayName: r.displayName,
          state: r.state,
          joinedAt: r.joinedAt?.toISOString() ?? null,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
          endedAt: r.endedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.get(
    '/v1/sessions/:id/events',
    { preHandler: app.authenticate },
    async (request): Promise<EventsPage> => {
      const { id } = parse(Params, request.params);
      const { after } = parse(AfterQuery, request.query);
      const { session } = await requireSessionOwner(db, request, id);

      const rows = await getEventsSince(db, session.id, after, EVENT_PAGE_LIMIT);
      const events = rows.map(toFeedEvent);
      const nextAfter = events.length > 0 ? events[events.length - 1]!.seq : after;
      return { events, nextAfter };
    },
  );

  app.get('/v1/sessions/:id/stream', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = parse(Params, request.params);
    const { after } = parse(AfterQuery, request.query);
    const { teacher, session } = await requireSessionOwner(db, request, id);

    // Enforce the per-teacher cap before hijacking, so it returns the standard
    // 429 shape. The check and the subscribe below run without an await between
    // them, so the count can't drift under a concurrent open.
    if (hub.countForTeacher(teacher.id) >= maxPerTeacher) {
      throw ApiError.rateLimited('too many live streams for this teacher');
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, SSE_HEADERS);
    raw.write(': open\n\n'); // flush headers and confirm the stream is live

    const sub = hub.subscribe({
      sessionId: session.id,
      teacherId: teacher.id,
      after,
      write: (chunk) => raw.write(chunk),
      onClose: () => raw.end(),
    });

    // A client disconnect (tab closed, network drop) tears the stream down.
    request.raw.on('close', () => sub.close());
  });
}
