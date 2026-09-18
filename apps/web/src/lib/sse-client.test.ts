import type { FeedEvent } from '@bali/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSseClient } from './sse-client';

function evt(seq: number, eventId: string): FeedEvent {
  return {
    seq,
    eventId,
    type: 'tap_in',
    userId: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: null,
  };
}
function frame(e: FeedEvent): string {
  return `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
}
function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const enc = new TextEncoder();
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
  return new Response(body, { status });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('sse-client', () => {
  it('parses frames, dedupes by event_id, and delivers new events in order', async () => {
    const e1 = evt(5, 'a');
    const e2 = evt(6, 'b');
    // ': open' is a heartbeat comment; e1 is sent twice.
    const fetchImpl = vi.fn((): Promise<Response> =>
      Promise.resolve(streamResponse([': open\n\n', frame(e1), frame(e2), frame(e1)])),
    );
    const received: FeedEvent[] = [];
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: (e) => received.push(e),
      fetchImpl,
      baseBackoffMs: 5,
      overlap: 2,
    });

    await wait(20);
    client.close();
    expect(received.map((e) => e.eventId)).toEqual(['a', 'b']); // duplicate dropped, order kept
  });

  it('reconnects and resumes from lastSeq minus the overlap', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn((url: string | URL | Request): Promise<Response> => {
      urls.push(url instanceof Request ? url.url : String(url));
      // First connect delivers seq 5 then ends; the reconnect stays quiet.
      return Promise.resolve(
        streamResponse(urls.length === 1 ? [frame(evt(5, 'a'))] : [': open\n\n']),
      );
    });
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: () => {},
      fetchImpl,
      baseBackoffMs: 5,
      maxBackoffMs: 20,
      overlap: 2,
    });

    await wait(40);
    client.close();
    expect(urls[0]).toContain('after=0'); // first: max(0, 0 - 2)
    expect(urls[1]).toContain('after=3'); // reconnect: 5 - 2
  });

  it('signs out and stops reconnecting on a 401', async () => {
    const onUnauthorized = vi.fn();
    let calls = 0;
    const fetchImpl = vi.fn((): Promise<Response> => {
      calls += 1;
      return Promise.resolve(streamResponse([], 401));
    });
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: () => {},
      onUnauthorized,
      fetchImpl,
      baseBackoffMs: 5,
    });

    await wait(30);
    client.close();
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(calls).toBe(1); // no reconnect after a 401
  });

  it('reconnects on a non-200 (e.g. 503) and never signs out', async () => {
    // SSE streams drop constantly (LB idle timeouts → 502/503, restarts → 500).
    // Only a 401 ends the session; every other status must reconnect so a blip
    // shows "reconnecting", never ejects the teacher.
    const onUnauthorized = vi.fn();
    let calls = 0;
    const fetchImpl = vi.fn((): Promise<Response> => {
      calls += 1;
      // First a transient 503, then a quiet clean stream so it settles.
      return Promise.resolve(
        calls === 1 ? streamResponse([], 503) : streamResponse([': open\n\n']),
      );
    });
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: () => {},
      onUnauthorized,
      fetchImpl,
      baseBackoffMs: 5,
    });

    await wait(40);
    client.close();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(calls).toBeGreaterThan(1); // it retried the 503 rather than giving up
  });

  it('backs off exponentially — each reconnect waits longer than the last', async () => {
    // A regression to a constant (or zero) delay is a reconnect storm hammering
    // the API during an outage. Pin that the gap between attempts grows.
    vi.useFakeTimers();
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic jitter = 0.5
    try {
      const at: number[] = [];
      const fetchImpl = vi.fn((): Promise<Response> => {
        at.push(Date.now());
        return Promise.resolve(streamResponse([], 503)); // always fails → keeps backing off
      });
      const client = createSseClient({
        url: 'http://api/stream',
        getToken: () => 't',
        after: 0,
        onEvent: () => {},
        fetchImpl,
        baseBackoffMs: 100,
        maxBackoffMs: 100_000,
      });

      await vi.advanceTimersByTimeAsync(1000);
      client.close();

      // at[0] is the initial connect; each later gap is a backoff (≈50, 100, 200…).
      const gaps = at.slice(1).map((t, i) => t - at[i]);
      expect(gaps.length).toBeGreaterThanOrEqual(3);
      expect(gaps[1]).toBeGreaterThan(gaps[0]);
      expect(gaps[2]).toBeGreaterThan(gaps[1]);
    } finally {
      randSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
