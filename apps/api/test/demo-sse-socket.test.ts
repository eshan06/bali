import type { FeedEvent } from '@bali/shared';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { openSseRecorder } from '../scripts/demo/sse.js';

/*
 * The socket half of the demo's SSE client, against a real listening server.
 *
 * These exist because the live-delivery assertions in the exit demo are only
 * worth as much as this function's failure behaviour. A stream that dies before
 * it ever opens must THROW: if opening merely never settles, `npm run demo`
 * either hangs or — with nothing else holding the event loop, which is exactly
 * remote mode — exits 0 having asserted nothing, and leaves the live session it
 * created behind. A green run that proves nothing is the worst outcome there is.
 */

type Handler = Parameters<typeof createServer>[1];

const servers: Server[] = [];
const sockets = new Set<import('node:net').Socket>();

async function listen(handler: Handler): Promise<string> {
  const s = createServer(handler);
  s.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const { port } = s.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  // A half-open SSE connection would keep close() pending forever.
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

const SSE_HEADERS = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' };

const event = (seq: number, eventId: string, type = 'unlock'): FeedEvent => ({
  seq,
  eventId,
  type: type as FeedEvent['type'],
  userId: 'user-1',
  occurredAt: '2026-09-20T08:05:00.000Z',
  payload: null,
});

const frame = (e: FeedEvent): string => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;

const open = (base: string, extra: Partial<Parameters<typeof openSseRecorder>[0]> = {}) =>
  openSseRecorder({ base, sessionId: 'session-1', token: 'tok', after: 0, ...extra });

describe('openSseRecorder over a real socket', () => {
  it('opens on the comment frame and delivers events live', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.write(': open\n\n');
      setTimeout(() => res.write(frame(event(1, 'first'))), 10);
    });

    const rec = await open(base);
    const got = await rec.waitFor((e) => e.eventId === 'first', { timeoutMs: 5_000 });

    expect(got.seq).toBe(1);
    expect(rec.commentCount()).toBe(1);
    rec.close();
  });

  // The regression test for the defect these tests were written for.
  it('rejects — never hangs — when the response ends before any frame', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.end(); // headers, then nothing at all
    });

    await expect(open(base)).rejects.toThrow(/ended unexpectedly/);
  });

  it('rejects when the socket is destroyed before any frame', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      setTimeout(() => res.destroy(), 20);
    });

    await expect(open(base)).rejects.toThrow();
  });

  it('gives up on a stream that opens but never sends anything', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      // Headers flushed, no body — a buffering proxy that withholds the frame.
    });

    await expect(open(base, { openTimeoutMs: 300 })).rejects.toThrow(/did not open within 300ms/);
  });

  it('rejects a pending waitFor when the stream drops mid-run', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.write(': open\n\n');
      setTimeout(() => res.destroy(), 30);
    });

    const rec = await open(base);

    await expect(
      rec.waitFor((e) => e.type === 'refocus', { timeoutMs: 5_000, label: 'a refocus' }),
    ).rejects.toThrow();
  });

  it('surfaces a non-200 with the body, and an unexpected content-type', async () => {
    const forbidden = await listen((_req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"error":"not your session"}');
    });
    await expect(open(forbidden)).rejects.toThrow(/403.*not your session/s);

    const html = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html></html>');
    });
    await expect(open(html)).rejects.toThrow(/expected text\/event-stream/);
  });

  it('counts an event re-sent inside the overlap window only once', async () => {
    const repeated = event(5, 'same-id');
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.write(': open\n\n');
      // The server's own sliding re-read legitimately re-sends recent events.
      res.write(frame(repeated));
      setTimeout(() => res.write(frame(repeated)), 10);
      setTimeout(() => res.write(frame(event(6, 'next'))), 20);
    });

    const rec = await open(base);
    await rec.waitFor((e) => e.eventId === 'next', { timeoutMs: 5_000 });

    expect(rec.received().filter((e) => e.eventId === 'same-id')).toHaveLength(1);
    rec.close();
  });

  it('delivers a frame split across two writes', async () => {
    const whole = frame(event(9, 'split'));
    const base = await listen((_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      res.write(': open\n\n');
      res.write(whole.slice(0, 12));
      setTimeout(() => res.write(whole.slice(12)), 15);
    });

    const rec = await open(base);
    await expect(
      rec.waitFor((e) => e.eventId === 'split', { timeoutMs: 5_000 }),
    ).resolves.toMatchObject({ seq: 9 });
    rec.close();
  });
});
