import { EVENT_RESUME_OVERLAP, type FeedEvent } from '@bali/shared';

/*
 * The demo's live-grid client: the teacher's SSE stream, read the way the portal
 * reads it (apps/web/src/lib/sse-client.ts) — `fetch` with an Authorization
 * header, never `EventSource`, because the stream takes no token in the query
 * string.
 *
 * The demo needs less than the portal: no reconnect-with-backoff, because a drop
 * during the demo is a finding, not something to paper over. What it keeps is the
 * part the exit demo exists to prove — events arrive live, in order, de-duped by
 * `event_id` across the server's own overlap re-read (decision 2).
 *
 * Both halves are tested: the parser directly, and the socket half against a
 * real listening server — including the ways a stream dies (an immediate close,
 * a mid-run drop), because a live-delivery assertion that silently proves
 * nothing is worse than no assertion at all.
 */

/** Split a buffer into complete SSE frames, returning the unterminated remainder. */
export function parseSseFrames(buffer: string): { frames: string[]; rest: string } {
  // Normalize CRLF so a proxy that rewrites line endings can't hide a boundary.
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  // The last part is whatever follows the final blank line — still incomplete.
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((f) => f.length > 0), rest };
}

/**
 * The event carried by one frame, or null when the frame carries none — a
 * heartbeat (`: keep-alive`) or the server's opening `: open` comment. Returning
 * null rather than throwing is deliberate: comment frames are normal traffic.
 */
export function eventFromFrame(frame: string): FeedEvent | null {
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // comment — heartbeat or the open marker
    if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
  }
  if (data.length === 0) return null;
  return JSON.parse(data.join('\n')) as FeedEvent;
}

export interface SseRecorderOptions {
  /** The API base URL, no trailing slash. */
  base: string;
  sessionId: string;
  token: string;
  /** Resume point — the boot snapshot's `latestSeq`. */
  after: number;
  fetchImpl?: typeof fetch;
  overlap?: number;
  /** How long to wait for the server's opening frame before giving up. */
  openTimeoutMs?: number;
}

export interface SseRecorder {
  /** Every event delivered so far, in arrival order. */
  received(): FeedEvent[];
  /** Resolve when a matching event arrives (or has already arrived). */
  waitFor(
    predicate: (event: FeedEvent) => boolean,
    opts?: { timeoutMs?: number; label?: string },
  ): Promise<FeedEvent>;
  /** Frames that carried no event — the heartbeats and the open marker. */
  commentCount(): number;
  close(): void;
}

interface Waiter {
  predicate: (event: FeedEvent) => boolean;
  resolve: (event: FeedEvent) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Open the live stream and start recording. Resolves once the stream is
 * confirmed live (the server's `: open` comment lands before any event), so a
 * caller can trigger an action and know the stream was already listening — the
 * difference between proving live delivery and racing it.
 */
export async function openSseRecorder(opts: SseRecorderOptions): Promise<SseRecorder> {
  const doFetch = opts.fetchImpl ?? fetch;
  const overlap = opts.overlap ?? EVENT_RESUME_OVERLAP;
  const openTimeoutMs = opts.openTimeoutMs ?? 30_000;
  const from = Math.max(0, opts.after - overlap);
  const controller = new AbortController();

  // The deadline covers the WHOLE open, headers included: a proxy that accepts
  // the connection and then withholds the response would otherwise stall here
  // forever, before any of the machinery below exists to notice.
  let openError: Error | null = null;
  const openTimer = setTimeout(() => {
    openError = new Error(`SSE stream did not open within ${openTimeoutMs}ms`);
    controller.abort();
  }, openTimeoutMs);

  let res: Response;
  try {
    res = await doFetch(`${opts.base}/v1/sessions/${opts.sessionId}/stream?after=${from}`, {
      headers: { authorization: `Bearer ${opts.token}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(openTimer);
    throw openError ?? (err instanceof Error ? err : new Error(String(err)));
  }
  if (!res.ok) {
    // Clear before reading: a body-side error here would otherwise leave the
    // deadline armed on the event loop.
    clearTimeout(openTimer);
    const body = (await res.text().catch(() => '')).slice(0, 200);
    controller.abort();
    throw new Error(`SSE stream → ${res.status}: ${body}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    clearTimeout(openTimer);
    controller.abort();
    throw new Error(
      `SSE stream returned content-type "${contentType}", expected text/event-stream`,
    );
  }
  if (!res.body) {
    clearTimeout(openTimer);
    controller.abort();
    throw new Error('SSE stream returned no body');
  }

  const events: FeedEvent[] = [];
  const seen = new Map<string, number>(); // eventId -> seq, pruned to the window
  const waiters = new Set<Waiter>();
  let comments = 0;
  let lastSeq = from;
  let failure: Error | null = null;
  let closed = false;

  // `opened` settles both ways. Resolving it only on the first chunk — and
  // leaving the failure path to reject the *waiters* — is the shape that lets a
  // stream which dies before it ever opens hang forever, or, with nothing else
  // holding the event loop, let the process exit 0 having proved nothing. A
  // stream that never opens must throw.
  let markOpen: () => void = () => {};
  let failOpen: (err: Error) => void = () => {};
  const opened = new Promise<void>((resolve, reject) => {
    markOpen = resolve;
    failOpen = reject;
  });

  function deliver(event: FeedEvent): void {
    if (seen.has(event.eventId)) return; // the overlap re-read — count it once
    seen.set(event.eventId, event.seq);
    if (event.seq > lastSeq) lastSeq = event.seq;
    const cutoff = lastSeq - overlap;
    for (const [id, seq] of seen) if (seq <= cutoff) seen.delete(id);
    events.push(event);
    for (const w of waiters) {
      if (!w.predicate(event)) continue;
      clearTimeout(w.timer);
      waiters.delete(w);
      w.resolve(event);
    }
  }

  /** Idempotent: the abort below re-enters through the reader's catch. */
  function fail(err: Error): void {
    if (failure) return;
    failure = err;
    failOpen(err); // a no-op once `opened` has resolved
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    waiters.clear();
    controller.abort(); // release the socket and the server-side stream slot
  }

  // `lib` is ES2023 + node types, so the web-stream generics land as `any`
  // here; naming the chunk shape keeps the read path typed.
  const reader = res.body.getReader() as {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
  const decoder = new TextDecoder();
  let buffer = '';

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        markOpen();
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const event = eventFromFrame(frame);
          if (event) deliver(event);
          else comments += 1;
        }
      }
      // The server ended the stream. Only a close we asked for is expected;
      // anything else must surface rather than hang a pending waiter forever.
      if (!closed) fail(new Error('SSE stream ended unexpectedly'));
    } catch (err) {
      if (!closed) fail(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  try {
    await opened;
  } catch (err) {
    // A timeout aborts the socket, which surfaces here as an abort error;
    // report the deadline that actually caused it. Abort regardless, so a
    // half-open connection never outlives the failed open.
    controller.abort();
    throw openError ?? (err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(openTimer);
  }

  return {
    received: () => [...events],
    commentCount: () => comments,
    waitFor: (predicate, waitOpts = {}) => {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      if (failure) return Promise.reject(failure);
      const timeoutMs = waitOpts.timeoutMs ?? 30_000;
      const label = waitOpts.label ?? 'a matching event';
      return new Promise<FeedEvent>((resolve, reject) => {
        const waiter: Waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(`timed out after ${timeoutMs}ms waiting for ${label} on the SSE stream`),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    close: () => {
      closed = true;
      // Reject rather than drop: a waiter left pending on close is the same
      // never-settles shape this module exists to avoid.
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.reject(new Error('SSE stream closed while still waiting'));
      }
      waiters.clear();
      controller.abort();
    },
  };
}
