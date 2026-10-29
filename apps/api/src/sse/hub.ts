import { type Database, getEventsSince } from '@bali/db';
import { EVENT_PAGE_LIMIT, EVENT_RESUME_OVERLAP, STREAM_HEARTBEAT_MS } from '@bali/shared';

import { frameFor } from './frame.js';
import { type SettledCursor, settledCursorFor } from './settled.js';

export interface StreamHubOptions {
  /**
   * How often each stream re-reads the table regardless of NOTIFY (~20s in prod), its caller's
   * access read again first.
   */
  repollMs?: number;
  /** How often to send an SSE comment so idle connections and proxies stay open (~20s). */
  heartbeatMs?: number;
  /** Live streams one teacher may hold at once. */
  maxPerTeacher?: number;
  /** Where the streams' settled point comes from: the database's own unless a test gives one. */
  settled?: SettledCursor;
}

export interface Subscriber {
  close(): void;
}

export interface SubscribeInput {
  sessionId: string;
  teacherId: string;
  /** Resume point: only events with seq greater than this are delivered. */
  after: number;
  /**
   * When the caller's access token expires, in ms since the epoch on the clock the verifier reads;
   * null for a token that carries no expiry. The stream ends then: a token's reach ends at its
   * expiry (ARCHITECTURE, Auth decision 2).
   */
  expiresAtMs: number | null;
  /**
   * Whether the caller may still read this stream, read again before the first read after each
   * re-poll. False, or a rejection (the check could not be read), ends the stream.
   */
  stillAllowed: () => Promise<boolean>;
  /** Write an SSE chunk to the client. May throw if the socket is gone. */
  write: (chunk: string) => void;
  /**
   * Called when the stream ends here (a write throws, a read errors, its token expires or its
   * caller's access is gone) so the route ends the response.
   */
  onClose: () => void;
}

/** The longest delay a Node timer holds: past it, a timer fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface StreamHub {
  countForTeacher(teacherId: string): number;
  /** Attach a stream. The caller must have checked the per-teacher cap first. */
  subscribe(input: SubscribeInput): Subscriber;
  /**
   * The settled point as the grid's read takes it (`SettledCursor.fresh`): every event at or below
   * it shows by the time it returns.
   */
  settledSeq(): Promise<number>;
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
 * becomes visible after a higher one) are caught by re-reading from the
 * `EVENT_RESUME_OVERLAP` below the stream's settled point, or below the newest
 * seq it sent when that is lower, and de-duping by event id (decision 2). A
 * settled point is a seq every write handed one at or below it has finished
 * (`SettledCursor`), so no event yet to show sits under where a read starts.
 *
 * A stream lasts no longer than the access that opened it: it ends at its token's expiry, and on
 * the first read after a re-poll once its caller's access, read again, is gone or can't be read.
 */
export function createStreamHub(db: Database, options: StreamHubOptions = {}): StreamHub {
  const repollMs = options.repollMs ?? 20_000;
  const heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  // Every stream here shares it: seqs are counted across all sessions' events together.
  const cursor = options.settled ?? settledCursorFor(db);
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
    // Every event of the session above `after` and at or below this has been sent here: the
    // newest settled point a whole read of the session got past.
    let settledHere = input.after;
    // The settled point last sent to the client. Never above `highSeq`, so it names no seq beyond
    // this session's own events.
    let said = input.after;
    const delivered = new Map<string, number>(); // eventId -> seq, pruned to where reads start
    // A read of the session's events, page by page: where its next page starts, and the settled
    // point taken before its first page.
    let pass: { from: number; settled: number } | null = null;
    // A doorbell or re-poll since the read under way began: its event may sit under the page that
    // read has reached, so a fresh read follows it.
    let woken = false;
    let running = false;
    let pending = false;
    let removed = false;
    // Set by each re-poll: the caller's access is read again before the next read.
    let recheck = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    /**
     * Where a read starts: the overlap below the settled point, or below the newest seq sent when
     * that is lower. Never past the settled point, so an event still committing under a seq below
     * the ones sent is read when it shows. It never moves back, so what is pruned below it is never
     * read again.
     */
    const floor = (): number => Math.max(0, Math.min(highSeq, settledHere) - EVENT_RESUME_OVERLAP);

    async function readOnce(): Promise<boolean> {
      if (pass === null) {
        woken = false;
        // Read before the first page, so each page sees every event up to it.
        const settled = await cursor.now();
        pass = { from: floor(), settled };
      }
      const current = pass;
      const rows = await getEventsSince(db, input.sessionId, current.from, EVENT_PAGE_LIMIT);
      for (const row of rows) {
        // The stream can be torn down while this read is in flight — a closed
        // tab, or the shutdown hook — and close() ends the HTTP response as it
        // runs. Every remaining row would then be written into a response that
        // is already finished. Checked per row, not once per page: close() can
        // land inside this loop, which is exactly what a client disconnecting
        // mid-delivery looks like.
        if (removed || closed) return false;
        current.from = row.seq;
        if (row.seq <= input.after) continue; // at/below the resume point; the client has it
        if (delivered.has(row.eventId)) continue; // already sent on this stream
        input.write(frameFor(row));
        delivered.set(row.eventId, row.seq);
        if (row.seq > highSeq) highSeq = row.seq;
      }
      if (rows.length >= EVENT_PAGE_LIMIT) return true; // a full page: the read goes on
      pass = null;
      if (removed || closed) return false;
      settledHere = Math.max(settledHere, current.settled);
      const point = Math.min(settledHere, highSeq);
      if (point > said) {
        said = point;
        // Sent after every event up to it, as a comment line: an older portal passes over it as
        // it passes over the heartbeat, and a current one resumes from below it (sse-client.ts).
        input.write(`: settled ${point}\n\n`);
      }
      const cutoff = floor();
      for (const [id, seq] of delivered) if (seq <= cutoff) delivered.delete(id);
      return woken;
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
          if (recheck) {
            // Inside the loop, so a check and a read never overlap and a re-poll that lands
            // mid-read is checked before the read after it, a doorbell's included.
            recheck = false;
            if (!(await input.stillAllowed())) {
              close();
              return;
            }
            if (removed || closed) return;
          }
          const more = await readOnce();
          if (more) pending = true; // keep draining a backlog, or read again after a wake
        } while (pending && !removed && !closed);
      } catch {
        close();
      } finally {
        running = false;
      }
    }

    function wake(): void {
      if (removed || closed) return;
      woken = true;
      void run();
    }

    const repoll = setInterval(() => {
      recheck = true;
      wake();
    }, repollMs);
    const heartbeat = setInterval(() => {
      try {
        input.write(': keepalive\n\n');
      } catch {
        close();
      }
    }, heartbeatMs);

    /**
     * End the stream once its token has expired, on the verifier's clock, which refuses a token
     * from the millisecond its `exp` names. An expiry further off than a timer holds is waited out
     * in steps.
     */
    function armExpiry(expiresAtMs: number): void {
      if (removed) return;
      const left = expiresAtMs - Date.now();
      if (left <= 0) close();
      else expiry = setTimeout(() => armExpiry(expiresAtMs), Math.min(left, MAX_TIMER_MS));
    }

    function close(): void {
      if (removed) return;
      removed = true;
      clearInterval(repoll);
      clearInterval(heartbeat);
      clearTimeout(expiry);
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

    // Armed once the stream is registered, so a token that expired on its way here ends it, its
    // slot given back, before any read.
    if (input.expiresAtMs !== null) armExpiry(input.expiresAtMs);
    if (!removed) {
      ensureListening();
      void run(); // initial catch-up from `after`
    }

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

  return { countForTeacher, subscribe, settledSeq: () => cursor.fresh(), close };
}
