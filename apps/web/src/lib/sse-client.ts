import { EVENT_RESUME_OVERLAP, type FeedEvent } from '@bali/shared';

/**
 * A tiny fetch-based SSE client for the live grid. It uses `fetch` + a
 * ReadableStream (never `EventSource`) so it can send the Authorization header —
 * no token in the query string. It:
 *   - resumes with `?after=lastSeq − overlap` and de-dupes by `event_id`, so a
 *     reconnect (or the server's own late-committer re-read) never double-applies
 *     an event and never misses the boundary (decision 2);
 *   - reconnects with exponential backoff on any drop, resetting on a clean open;
 *   - treats only a 401 as a sign-out (like the API client), reconnecting on
 *     everything else so a blip shows "reconnecting", not "signed out".
 */
export type SseStatus = 'connecting' | 'open' | 'reconnecting';

export interface SseClientOptions {
  /** The stream URL (without the `after` query — the client appends it). */
  url: string;
  getToken: () => string | null;
  /** The resume point from the boot snapshot (its `latestSeq`). */
  after: number;
  onEvent: (event: FeedEvent) => void;
  onStatus?: (status: SseStatus) => void;
  /** A 401 on the stream — the one sign-out trigger. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  overlap?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface SseClient {
  close(): void;
}

export function createSseClient(opts: SseClientOptions): SseClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const overlap = opts.overlap ?? EVENT_RESUME_OVERLAP;
  const baseBackoff = opts.baseBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 10_000;

  let lastSeq = opts.after;
  const delivered = new Map<string, number>(); // eventId -> seq, pruned to the window
  let closed = false;
  let attempt = 0;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReconnect(): void {
    if (closed) return;
    opts.onStatus?.('reconnecting');
    const backoff = Math.min(maxBackoff, baseBackoff * 2 ** attempt);
    const delay = backoff * (0.5 + Math.random() * 0.5); // jitter
    attempt += 1;
    retryTimer = setTimeout(() => void connect(), delay);
  }

  function handleEvent(event: FeedEvent): void {
    if (delivered.has(event.eventId)) return; // already applied on this client
    delivered.set(event.eventId, event.seq);
    if (event.seq > lastSeq) lastSeq = event.seq;
    const cutoff = lastSeq - overlap;
    for (const [id, seq] of delivered) if (seq <= cutoff) delivered.delete(id);
    opts.onEvent(event);
  }

  function parseFrame(frame: string): void {
    let data: string | null = null;
    for (const line of frame.split('\n')) {
      if (line.startsWith('data:')) data = line.slice(line.startsWith('data: ') ? 6 : 5);
      // `id:` and comment (`:`) lines carry no payload; the event_id inside
      // `data` is the dedupe key, so they need no handling.
    }
    if (data === null) return; // a comment/heartbeat frame
    let event: FeedEvent;
    try {
      event = JSON.parse(data) as FeedEvent;
    } catch {
      return; // ignore a malformed frame rather than tear down the stream
    }
    handleEvent(event);
  }

  async function readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        parseFrame(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
  }

  async function connect(): Promise<void> {
    if (closed) return;
    controller = new AbortController();
    const resumeFrom = Math.max(0, lastSeq - overlap);
    const sep = opts.url.includes('?') ? '&' : '?';
    const token = opts.getToken();
    opts.onStatus?.(attempt === 0 ? 'connecting' : 'reconnecting');

    let res: Response;
    try {
      res = await doFetch(`${opts.url}${sep}after=${resumeFrom}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
    } catch {
      if (!closed) scheduleReconnect(); // network failure — retry, never sign out
      return;
    }

    if (res.status === 401) {
      opts.onUnauthorized?.();
      close();
      return;
    }
    if (res.status !== 200 || !res.body) {
      scheduleReconnect(); // transient/unexpected — the banner shows "reconnecting"
      return;
    }

    attempt = 0; // a clean open resets the backoff
    opts.onStatus?.('open');
    try {
      await readStream(res.body);
    } catch {
      // aborted or errored mid-stream — fall through to reconnect
    }
    if (!closed) scheduleReconnect(); // the stream ended; resume from lastSeq − overlap
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
  }

  void connect();
  return { close };
}
