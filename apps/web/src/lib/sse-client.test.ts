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

  it('reports a heartbeat as activity, though it delivers no event', async () => {
    /*
     * The signal the grid's staleness banner runs on, and it cannot come from
     * events: a quiet class emits none for minutes (decision 7 — a heartbeat
     * that changes nothing writes no history), so event traffic would mark a
     * perfectly healthy stream stale. The server's heartbeat is the liveness
     * proof, and it arrives as a comment frame with no `data:` line.
     */
    const e1 = evt(5, 'a');
    const fetchImpl = vi.fn((): Promise<Response> =>
      Promise.resolve(streamResponse([': open\n\n', ': ping\n\n', frame(e1)])),
    );
    const activity: number[] = [];
    const received: FeedEvent[] = [];
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: (e) => received.push(e),
      onActivity: () => activity.push(Date.now()),
      fetchImpl,
      baseBackoffMs: 5_000, // do not reconnect inside this test
    });

    await wait(30);
    client.close();
    // One event, three frames, and the open itself — the two comments count
    // as life, and so does a connection that has just come up (see the test
    // below, which pins that half on its own).
    expect(received.map((e) => e.eventId)).toEqual(['a']);
    expect(activity.length, 'heartbeat comments must report activity').toBe(1 + 3);
  });

  it('reports the open itself, before the server has sent anything', async () => {
    /*
     * The server's first heartbeat is a whole interval away, so between a
     * connection coming up and that frame landing the only thing a caller
     * knows is the silence from BEFORE the reconnect. A reconnect that
     * succeeds after a three-minute outage would then have the grid report
     * "gone quiet, last updated 180s ago" over a connection working perfectly.
     *
     * So: a stream that opens and delivers nothing at all still reports once.
     */
    const body = new ReadableStream<Uint8Array>({
      start() {
        /* open, and silent — no frames, ever */
      },
    });
    const activity: number[] = [];
    const statuses: string[] = [];
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: () => {},
      onActivity: () => activity.push(Date.now()),
      onStatus: (s) => statuses.push(s),
      fetchImpl: () => Promise.resolve(new Response(body, { status: 200 })),
      baseBackoffMs: 5_000, // do not reconnect inside this test
    });

    await wait(30);
    client.close();
    expect(statuses, 'the stream really did open').toContain('open');
    expect(activity.length, 'an open connection is itself a sign of life').toBe(1);
  });

  it('backs off against a server that accepts and immediately drops', async () => {
    /*
     * The reset used to fire on the 200, not on the connection lasting. A
     * server that accepts and drops — a session that has ended, a hub draining
     * on deploy — answers 200 every time, so every retry went back to the base
     * delay and the client knocked forever at that rate. Measured before the
     * fix: 16 attempts in 600ms with baseBackoffMs 50, no growth at all; at
     * the shipped default that is a browser hitting the API twice a second,
     * per open tab, indefinitely.
     *
     * `stableAfterMs` is what makes the difference, so it is set above the
     * window here: nothing in this test can ever qualify as stable.
     */
    const at: number[] = [];
    const fetchImpl = vi.fn((): Promise<Response> => {
      at.push(Date.now());
      return Promise.resolve(streamResponse([])); // accepted, then over
    });
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: () => {},
      fetchImpl,
      baseBackoffMs: 50,
      maxBackoffMs: 5_000,
      stableAfterMs: 60_000,
    });

    await wait(600);
    client.close();

    // Bounded rather than exact, because the delay carries jitter: unbounded
    // retries put 16 here, a doubling one puts 5 or 6.
    expect(at.length, `attempts in 600ms: ${at.length}`).toBeLessThanOrEqual(8);
    expect(at.length).toBeGreaterThan(2); // it must still be retrying
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps[gaps.length - 1], `gaps: ${gaps.join(', ')}`).toBeGreaterThan(gaps[0]);
  });

  it('a connection that lasts brings an ESCALATED backoff back to the base delay', async () => {
    /*
     * The other half of the same fix, and the first version of this test did
     * not reach it: it exercised only the FIRST connection, where `attempt` is
     * already 0, so `attempt = 0` was a no-op for it. Deleting the reset
     * outright left the whole file green — checked.
     *
     * So drive the backoff UP first. Four instant drops take `attempt` to 4
     * (40ms base doubling: ~20-40, ~40-80, ~80-160, ~160-320), then one
     * stream that outlives `stableAfterMs`. The gap after THAT is the
     * assertion: ~20-40ms if the reset fired, ~320-640ms if it did not, which
     * is a separation no jitter can close.
     */
    const at: number[] = [];
    let call = 0;
    const fetchImpl = vi.fn((): Promise<Response> => {
      at.push(Date.now());
      call += 1;
      if (call !== 5) return Promise.resolve(streamResponse([])); // accepted, then over
      // The healthy one: stays open well past stableAfterMs, then ends.
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          setTimeout(() => ctrl.close(), 40);
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const client = createSseClient({
      url: 'http://api/stream',
      getToken: () => 't',
      after: 0,
      onEvent: () => {},
      fetchImpl,
      baseBackoffMs: 40,
      maxBackoffMs: 5_000,
      stableAfterMs: 20,
    });

    await wait(900);
    client.close();

    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(
      at.length,
      `only ${at.length} attempts in 900ms — an un-reset backoff never gets here. gaps: ${gaps.join(', ')}`,
    ).toBeGreaterThanOrEqual(6);
    // It really did escalate first, or the assertion below proves nothing.
    expect(gaps[3], `gaps: ${gaps.join(', ')}`).toBeGreaterThan(120);
    // 40ms of stream plus a BASE delay (20-40), not an escalated one (320-640).
    expect(gaps[4], `reconnect after the stable stream. gaps: ${gaps.join(', ')}`).toBeLessThan(
      160,
    );
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
