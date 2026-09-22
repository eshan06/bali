import { type Database, getEventsSince } from '@bali/db';
import { EVENT_PAGE_LIMIT, EVENT_RESUME_OVERLAP, STREAM_HEARTBEAT_MS } from '@bali/shared';

import { frameFor } from './frame.js';

export interface StreamHubOptions {
  /** How often each stream re-reads the table regardless of NOTIFY (~20s in prod). */
  repollMs?: number;
  /** How often to send an SSE comment so idle connections and proxies stay open (~20s). */
  heartbeatMs?: number;
  /** Live streams one teacher may hold at once. */
  maxPerTeacher?: number;
}

export interface Subscriber {
  close(): void;
}

export interface SubscribeInput {
  sessionId: string;
  teacherId: string;
  /** Resume point: only events with seq greater than this are delivered. */
  after: number;
  /** Write an SSE chunk to the client. May throw if the socket is gone. */
  write: (chunk: string) => void;
  /** Called when the stream fails (a write throws or a read errors) so the route ends the response. */
  onClose: () => void;
}

export interface StreamHub {
  countForTeacher(teacherId: string): number;
  /** Attach a stream. The caller must have checked the per-teacher cap first. */
  subscribe(input: SubscribeInput): Subscriber;
  close(): Promise<void>;
}

interface Internal {
  sessionId: string;
  wake(): void;
  close(): void;
}

/**
 * The per-app live-updates fan-out. One postgres.js LISTEN connection (lazily
 * opened on the first stream, if the driver supports it — production and the
 * real-Postgres test lane) delivers `bali_events` doorbells, and each stream
 * re-reads the events table (the only source of truth) on a doorbell, on an
 * unconditional slow re-poll, and once at start. Correctness rests on the
 * re-poll; NOTIFY only cuts latency. Late-committing events (a low seq that
 * becomes visible after a higher one) are caught by re-reading a sliding
 * `EVENT_RESUME_OVERLAP` window and de-duping by event id (decision 2).
 */
export function createStreamHub(db: Database, options: StreamHubOptions = {}): StreamHub {
  const repollMs = options.repollMs ?? 20_000;
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  // The per-teacher cap is enforced at the route (before hijacking, so it returns
  // the standard 429); the hub only tracks counts via countForTeacher.

  const bySession = new Map<string, Set<Internal>>();
  const byTeacher = new Map<string, number>();
  let listenSetup: Promise<void> | null = null;
  let unlisten: (() => Promise<void>) | null = null;
  let closed = false;

  // Both postgres.js and PGlite expose `.listen`; only the resolve shape differs
  // (postgres.js → `{ unlisten }`, PGlite → a bare unsubscribe fn), which
  // normalizeUnlisten smooths over. A driver with no `.listen` (none today) would
  // fall back to the re-poll alone — NOTIFY is a latency optimization, never a
  // correctness dependency.
  function listenClient(): {
    listen: (ch: string, cb: (payload: string) => void) => Promise<unknown>;
  } | null {
    const client = (db as unknown as { $client?: { listen?: unknown } }).$client;
    return client && typeof client.listen === 'function'
      ? (client as { listen: (ch: string, cb: (payload: string) => void) => Promise<unknown> })
      : null;
  }

  function normalizeUnlisten(handle: unknown): () => Promise<void> {
    if (typeof handle === 'function') {
      const stop = handle as () => unknown;
      return async () => {
        await stop();
      };
    }
    const h = handle as { unlisten?: () => unknown } | null;
    if (h && typeof h.unlisten === 'function') {
      const stop = h.unlisten;
      return async () => {
        await stop();
      };
    }
    return () => Promise.resolve();
  }

  function ensureListening(): void {
    if (listenSetup || closed) return;
    const client = listenClient();
    if (!client) return;
    listenSetup = client
      .listen('bali_events', (sessionId: string) => {
        const subs = bySession.get(sessionId);
        if (subs) for (const s of subs) s.wake();
      })
      .then(async (handle) => {
        const stop = normalizeUnlisten(handle);
        // Awaited, not fired and forgotten. Two reasons, and the second is
        // the one that was actually costing us runs:
        //  - `close()` awaits this promise, so resolving it before the
        //    unlisten lands hands the caller "safe to tear the pool down"
        //    one query too early — the race below, reopened here.
        //  - a floating `stop()` has no handler, and unlistening on a pool
        //    that has just been ended rejects. Awaited, that rejection goes
        //    to the `.catch` below; voided, it is an unhandled rejection
        //    that fails the run with every test green.
        if (closed) await stop();
        else unlisten = stop;
      })
      .catch(() => {
        // A failed listen is non-fatal: the re-poll still delivers everything.
        listenSetup = null;
      });
  }

  function countForTeacher(teacherId: string): number {
    return byTeacher.get(teacherId) ?? 0;
  }

  function subscribe(input: SubscribeInput): Subscriber {
    let highSeq = input.after;
    const delivered = new Map<string, number>(); // eventId -> seq, pruned to the window
    let running = false;
    let pending = false;
    let removed = false;

    async function readOnce(): Promise<boolean> {
      const from = Math.max(0, highSeq - EVENT_RESUME_OVERLAP);
      const rows = await getEventsSince(db, input.sessionId, from, EVENT_PAGE_LIMIT);
      for (const row of rows) {
        // The stream can be torn down while this read is in flight — a closed
        // tab, or the shutdown hook — and close() ends the HTTP response as it
        // runs. Every remaining row would then be written into a response that
        // is already finished. Checked per row, not once per page: close() can
        // land inside this loop, which is exactly what a client disconnecting
        // mid-delivery looks like.
        if (removed || closed) return false;
        if (row.seq <= input.after) continue; // at/below the resume point; the client has it
        if (delivered.has(row.eventId)) continue; // already sent on this stream
        input.write(frameFor(row));
        delivered.set(row.eventId, row.seq);
        if (row.seq > highSeq) highSeq = row.seq;
      }
      const cutoff = highSeq - EVENT_RESUME_OVERLAP;
      for (const [id, seq] of delivered) if (seq <= cutoff) delivered.delete(id);
      return rows.length >= EVENT_PAGE_LIMIT; // a full page — a backlog may remain
    }

    async function run(): Promise<void> {
      if (running) {
        pending = true; // coalesce: never two reads for one stream at once
        return;
      }
      running = true;
      try {
        do {
          pending = false;
          const more = await readOnce();
          if (more) pending = true; // keep draining a backlog
        } while (pending && !removed && !closed);
      } catch {
        close();
      } finally {
        running = false;
      }
    }

    function wake(): void {
      if (!removed && !closed) void run();
    }

    const repoll = setInterval(wake, repollMs);
    const heartbeat = setInterval(() => {
      try {
        input.write(': keepalive\n\n');
      } catch {
        close();
      }
    }, heartbeatMs);

    function close(): void {
      if (removed) return;
      removed = true;
      clearInterval(repoll);
      clearInterval(heartbeat);
      const set = bySession.get(input.sessionId);
      set?.delete(sub);
      if (set && set.size === 0) bySession.delete(input.sessionId);
      byTeacher.set(input.teacherId, Math.max(0, countForTeacher(input.teacherId) - 1));
      input.onClose();
    }

    const sub: Internal = { sessionId: input.sessionId, wake, close };

    let set = bySession.get(input.sessionId);
    if (!set) {
      set = new Set();
      bySession.set(input.sessionId, set);
    }
    set.add(sub);
    byTeacher.set(input.teacherId, countForTeacher(input.teacherId) + 1);

    ensureListening();
    void run(); // initial catch-up from `after`

    return { close };
  }

  async function close(): Promise<void> {
    closed = true;
    for (const set of [...bySession.values()]) for (const s of [...set]) s.close();
    bySession.clear();
    // Wait for a LISTEN that is still being established. `unlisten` is only
    // assigned once `client.listen()` RESOLVES, so closing during setup used
    // to await nothing and return — and whatever tears the pool down next
    // (a test's closeDb, the server's shutdown after app.close()) did so with
    // that query still in flight. With the `.then` above voiding its stop()
    // too, that surfaced on the real-Postgres lane as an unhandled `write
    // CONNECTION_ENDED`, 5 runs out of 5, failing the run with every test
    // green.
    //
    // Be precise about which half earned that number, because the comment
    // above and this one do different jobs: isolating them showed the awaited
    // stop() is what stops the rejection being unhandled, and this await is
    // what makes `close()` mean "the LISTEN is settled and unlistened" —
    // which is the promise the onClose shutdown hook is built on, and the one
    // hub-close.test.ts pins. Removing either one turns that test red, with a
    // different message for each.
    if (listenSetup) {
      const setup = listenSetup;
      listenSetup = null;
      try {
        await setup;
      } catch {
        // a failed listen is non-fatal — the re-poll delivers everything
      }
    }
    if (unlisten) {
      const u = unlisten;
      unlisten = null;
      try {
        await u();
      } catch {
        // ignore — the connection is going away anyway
      }
    }
  }

  return { countForTeacher, subscribe, close };
}
