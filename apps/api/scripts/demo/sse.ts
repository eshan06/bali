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
 * The parsing half is pure and unit-tested; the socket half is exercised against
 * a real listening server.
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
  const from = Math.max(0, opts.after - overlap);
  const controller = new AbortController();

  const res = await doFetch(`${opts.base}/v1/sessions/${opts.sessionId}/stream?after=${from}`, {
    headers: { authorization: `Bearer ${opts.token}` },
    signal: controller.signal,
  });
  if (!res.ok) {
    throw new Error(`SSE stream → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    throw new Error(
      `SSE stream returned content-type "${contentType}", expected text/event-stream`,
    );
  }
  const body = res.body;
  if (!body) throw new Error('SSE stream returned no body');

  const events: FeedEvent[] = [];
  const seen = new Map<string, number>(); // eventId -> seq, pruned to the window
  const waiters = new Set<Waiter>();
  let comments = 0;
  let lastSeq = from;
  let failure: Error | null = null;
  let closed = false;

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

  function fail(err: Error): void {
    failure = err;
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    waiters.clear();
  }

  // `lib` is ES2023 + node types, so the web-stream generics land as `any`
  // here; naming the chunk shape keeps the read path typed.
  const reader = body.getReader() as {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
  const decoder = new TextDecoder();
  let buffer = '';

  // A promise that resolves on the first chunk — the `: open` comment — so the
  // caller knows the subscription is registered server-side before it acts.
  let markOpen: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    markOpen = resolve;
  });

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

  await opened;

  return {
    received: () => [...events],
    commentCount: () => comments,
    waitFor: (predicate, waitOpts = {}) => {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      if (failure) return Promise.reject(failure);
      const timeoutMs = waitOpts.timeoutMs ?? 10_000;
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
      for (const w of waiters) clearTimeout(w.timer);
      waiters.clear();
      controller.abort();
    },
  };
}
