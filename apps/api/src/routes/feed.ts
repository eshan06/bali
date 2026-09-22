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

      // Read the cursor BEFORE the roster, never concurrently. Two independent
      // snapshots can straddle a commit: a roster read just before an unlock
      // paired with a latestSeq read just after would let the client's
      // freshness guard accept a stale roster and paint the green chip back
      // over a streamed unlock. Sequenced this way latestSeq can only
      // under-state the roster, which the guard handles safely.
      const latestSeq = await getLatestSeq(db, session.id);
      const roster = await getSessionRoster(db, session.id, session.classId);

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

    // Watch for the client going away BEFORE the first await. A tab closed
    // while the ownership queries run fires 'close' immediately; a listener
    // attached afterwards never sees it, and the subscription's repoll and
    // heartbeat timers would then run forever while the per-teacher slot is
    // never released (write() on a destroyed socket returns false rather than
    // throwing, so the hub never notices either) — the teacher ends up
    // permanently 429'd by the cap.
    let clientGone = false;
    let sub: { close: () => void } | null = null;
    request.raw.on('close', () => {
      clientGone = true;
      sub?.close();
    });

    /**
     * Take the response over, and put OUR OWN 'error' listener on it before the
     * first byte — one we never remove.
     *
     * A write after `end()` does not throw. It returns false and emits 'error'
     * a tick later, so the hub's try/catch never sees it; an EventEmitter that
     * emits 'error' with no listener throws, and from an I/O callback that is
     * an uncaughtException. Fastify does attach a listener that would absorb
     * it, but only when a logger, an `onResponse` hook, or a handler timeout is
     * configured (`fastify/lib/route.js`), and it removes itself from both
     * 'finish' and 'error' the first time either fires (`lib/reply.js`).
     *
     * Measured on this route, as it is configured today: a late write resuming
     * from an awaited `getEventsSince` — the hub's own path when a tab closes
     * mid-read — lands after that removal and takes the whole process down with
     * an uncaught ERR_STREAM_WRITE_AFTER_END. One teacher closing a tab at the
     * wrong moment ends every other class's live grid in the process. A
     * listener we own survives all of it (verified: borrowed -> crash, own ->
     * survives), so the grid's crash-safety stops being a side effect of the
     * logger being switched on.
     */
    const hijack = (): typeof reply.raw => {
      reply.hijack();
      const res = reply.raw;
      res.on('error', (err: NodeJS.ErrnoException) => {
        // Measured: ERR_STREAM_WRITE_AFTER_END is the only code that actually
        // reaches here. A peer reset arrives as ECONNRESET on the socket and
        // on the server's 'clientError', never on a hijacked response, and a
        // write after destroy is routed to the (nop) write callback rather
        // than emitted. So the teardown race is the expected case and goes to
        // `debug`, and `warn` is not a proxy-reset alarm — it is "something
        // reached this listener that we have never seen", which LOG_LEVEL's
        // `info` default would otherwise swallow entirely.
        if (err.code === 'ERR_STREAM_WRITE_AFTER_END') {
          request.log.debug({ err }, 'live stream ended mid-write');
        } else {
          request.log.warn({ err }, 'unexpected error on a live stream');
        }
        sub?.close();
      });
      return res;
    };

    const { teacher, session } = await requireSessionOwner(db, request, id);

    if (clientGone || request.raw.destroyed) {
      hijack().end();
      return;
    }

    // Enforce the per-teacher cap before hijacking, so it returns the standard
    // 429 shape. The check and the subscribe below run without an await between
    // them, so the count can't drift under a concurrent open.
    if (hub.countForTeacher(teacher.id) >= maxPerTeacher) {
      throw ApiError.rateLimited('too many live streams for this teacher');
    }

    // The cors plugin set Access-Control-Allow-Origin on `reply` in its
    // onRequest hook, but hijacking bypasses reply's header flush — mirror it
    // onto the raw response, or the browser blocks the cross-origin stream.
    const acao = reply.getHeader('access-control-allow-origin');
    const headers: Record<string, string> =
      typeof acao === 'string'
        ? { ...SSE_HEADERS, 'access-control-allow-origin': acao, vary: 'Origin' }
        : { ...SSE_HEADERS };

    const raw = hijack();
    raw.writeHead(200, headers);
    raw.write(': open\n\n'); // flush headers and confirm the stream is live

    sub = hub.subscribe({
      sessionId: session.id,
      teacherId: teacher.id,
      after,
      // Throw rather than write into a response onClose already ended. This
      // is what makes teardown synchronous: the hub reads a throwing write as
      // "this stream is gone" and closes on the spot, instead of the write
      // landing on a dead response and the slot coming back only once the
      // 'error' listener above fires a tick later.
      //
      // Pinned by "a resuming read into an ended response releases the
      // teacher's slot" in stream-teardown.test.ts, which holds the window
      // open by stalling the flush. Know its exact reach before editing here:
      // softening this to a silent `return` turns that test red (the slot
      // leaks and the teacher stays at their cap), but DELETING it leaves the
      // suite green, because the 'error' listener then releases the slot
      // asynchronously instead. So a green run is not permission to remove
      // it — the guard is the synchronous path, the listener is the net.
      write: (chunk) => {
        if (raw.writableEnded) throw new Error('stream already ended');
        raw.write(chunk);
      },
      onClose: () => {
        if (!raw.writableEnded) raw.end();
      },
    });

    // The disconnect may have landed between the check above and subscribe, in
    // which case the handler ran while `sub` was still null — release it here.
    // A stream error needs no term here: everything from hijack() to this line
    // is synchronous, and 'error' cannot be emitted before a later tick, so
    // the listener's own sub?.close() is what covers it. A dead disjunct that
    // reads like a guarantee is worse than none — the next reader adds an
    // await above and trusts a net that has never fired.
    if (clientGone || request.raw.destroyed) sub.close();
  });
}
