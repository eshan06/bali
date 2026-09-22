import { type Database, refocus, startSession, tapIn, unlock } from '@bali/db';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createStreamHub, type Subscriber } from '../src/sse/hub.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer } from './helpers/test-issuer.js';

/*
 * What the hub does to a stream that goes away while it is mid-delivery.
 *
 * `close()` is not a request the hub gets to finish its sentence after: the
 * route's onClose ends the HTTP response the moment it runs, so every frame a
 * read keeps handing over lands on a response that is already finished. Those
 * writes are not benign: Fastify's own 'error' listener removes itself on the
 * first 'finish', so a late write emits an 'error' nobody is listening for and
 * the process dies. That is why the route now owns a listener of its own — and
 * why the hub should not be writing there in the first place.
 *
 * No NOTIFY here, so this runs on both lanes (stream.test.ts covers the
 * real-Postgres fan-out).
 */

let db: Database;
let closeDb: () => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(10);
  }
  throw new Error(`waitFor timed out waiting for ${what}`);
}

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
});

afterEach(async () => {
  await closeDb();
});

async function seedRunning(tag: string) {
  const c = await seedClassroom(db, tag);
  const session = (
    await startSession(db, {
      classId: c.klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    })
  ).session;
  return { ...c, session };
}

describe('live stream teardown', () => {
  it('stops writing to a subscriber that closes mid-page', async () => {
    // A teacher closing the tab fires 'close' on the request, which closes the
    // subscription — but a read may already be in flight holding a page of
    // rows. Every row it keeps writing goes to a response the route has
    // already ended.
    const { session, student, teacher } = await seedRunning('hub-midpage');
    const at = new Date();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: at,
    });
    await unlock(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: at,
    });
    await refocus(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: at,
    });

    // Long timers: this test is about the first read, not a re-poll.
    const hub = createStreamHub(db, { repollMs: 60_000, heartbeatMs: 60_000 });
    const chunks: string[] = [];
    let closes = 0;
    let sub: Subscriber | null = null;
    sub = hub.subscribe({
      sessionId: session.id,
      teacherId: teacher.id,
      after: 0,
      // The client vanishes while the very first frame is being written — the
      // subscription is torn down with three more rows still in hand.
      write: (chunk) => {
        chunks.push(chunk);
        sub?.close();
      },
      onClose: () => {
        closes += 1;
      },
    });

    await waitFor(() => closes > 0);
    await sleep(100); // let the in-flight read finish, if it is going to

    expect(chunks).toHaveLength(1);
    await hub.close();
  });

  it('does not start a new read after close, even on a doorbell or re-poll', async () => {
    // The other half of the same contract: once closed, nothing wakes it.
    const { session, student, teacher } = await seedRunning('hub-after-close');
    const hub = createStreamHub(db, { repollMs: 20, heartbeatMs: 20 });
    const chunks: string[] = [];
    let closes = 0;

    const sub = hub.subscribe({
      sessionId: session.id,
      teacherId: teacher.id,
      after: 0,
      write: (chunk) => chunks.push(chunk),
      onClose: () => {
        closes += 1;
      },
    });

    await waitFor(() => chunks.length > 0); // the session_started frame
    sub.close();
    expect(closes).toBe(1);
    const delivered = chunks.length;

    // New events and several re-poll ticks later, a closed stream stays silent.
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await sleep(150);

    expect(chunks).toHaveLength(delivered);
    expect(hub.countForTeacher(teacher.id)).toBe(0);
    await hub.close();
  });
});

describe('a hijacked stream response owns its own error handling', () => {
  let app: FastifyInstance;
  let port: number;
  let tokenFor: (sub: string) => Promise<string>;
  const extraSockets: net.Socket[] = [];

  beforeEach(async () => {
    const issuer = await makeTestIssuer();
    tokenFor = (sub) => issuer.sign({ sub });
    app = buildApp(testEnv, {
      db,
      verifyToken: issuer.verifier,
      // Short re-poll: these tests need the hub actually mid-read, not idle.
      // One stream per teacher, so a leaked slot is a single clean assertion.
      stream: { repollMs: 5, heartbeatMs: 60_000, maxPerTeacher: 1 },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    port = address.port;
  });

  afterEach(async () => {
    for (const s2 of extraSockets) s2.destroy();
    extraSockets.length = 0;
    await app.close();
  });

  /** Open a stream over a raw socket and report just its status code. */
  async function streamStatus(sessionId: string, token: string): Promise<number> {
    const s2 = net.connect(port, '127.0.0.1');
    extraSockets.push(s2);
    await once(s2, 'connect');
    let buf = '';
    s2.on('data', (d: Buffer) => {
      buf += d.toString('latin1');
    });
    s2.write(
      `GET /v1/sessions/${sessionId}/stream HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
        `Authorization: Bearer ${token}\r\n\r\n`,
    );
    await waitFor(() => /^HTTP\/1\.1 \d{3}/.test(buf), 3000, 'status line from the second stream');
    return Number(/^HTTP\/1\.1 (\d{3})/.exec(buf)?.[1]);
  }

  it("a resuming read into an ended response releases the teacher's slot", async () => {
    /*
     * The end-to-end path, and the technique that makes it reachable: STALL
     * THE FLUSH. A client that never reads leaves output queued, so 'finish'
     * cannot fire — and because Node emits the request's 'close' from the
     * response's 'finish', that never arrives either. The subscription stays
     * live with `removed` false, so neither the hub's per-row bail nor the
     * route's request-'close' handler tears it down, and the re-poll's next
     * read hands a frame to the route's write() on an already-ended response.
     *
     * That is the window the throwing guard exists for. Softened to a silent
     * `return`, the hub keeps "delivering" into a dead response forever, the
     * per-teacher slot is never released, and the teacher sits permanently at
     * their cap — which is exactly what maxPerTeacher: 1 makes visible here.
     */
    const { session, student, teacher } = await seedRunning('stream-stalled-reader');
    const token = await tokenFor(teacher.cognitoId);

    let res: ServerResponse | null = null;
    const onRequest = (req: IncomingMessage, r: ServerResponse) => {
      if (req.url?.includes('/stream') === true) res = r;
    };
    app.server.on('request', onRequest);

    const sock = net.connect(port, '127.0.0.1');
    extraSockets.push(sock); // torn down by afterEach even if this test fails
    await once(sock, 'connect');
    sock.pause(); // the stalled reader — a wedged phone or a stuck proxy
    sock.write(
      `GET /v1/sessions/${session.id}/stream HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\n` +
        `Authorization: Bearer ${token}\r\n\r\n`,
    );
    await waitFor(() => res !== null);
    app.server.off('request', onRequest);
    const raw = res as unknown as ServerResponse;
    await waitFor(() => raw.headersSent);

    let requestClosed = false;
    raw.req.on('close', () => {
      requestClosed = true;
    });

    // Queue until the bytes genuinely stop leaving, rather than trusting a pad
    // measured on one machine: a runner with larger autotuned socket buffers
    // would swallow a fixed pad, 'finish' would fire, and this test would go
    // red for an environment difference instead of a regression.
    //
    // The signal is `writableLength`, not `write()`'s return value. write()
    // flips to false at the 64 KiB stream high-water mark — on the very first
    // 1 MiB chunk, whatever the socket is doing — so it says nothing about
    // whether the kernel is still accepting, and an earlier version of this
    // loop that trusted it exited after one iteration while claiming to be
    // adaptive. `writableLength` is what has been handed over and not yet
    // accepted, so a round where it grows by the whole chunk is a round where
    // nothing drained at all.
    const MB = 'x'.repeat(1024 * 1024);
    let queued = 0;
    let stalled = false;
    for (let i = 0; i < 64 && !stalled; i += 1) {
      const before = raw.writableLength;
      raw.write(MB);
      await sleep(20); // a chance to drain whatever it still can
      stalled = raw.writableLength >= before + MB.length;
      queued = raw.writableLength;
    }
    expect(
      stalled,
      `socket never stopped draining (${queued} bytes queued) — the window cannot be staged`,
    ).toBe(true);
    raw.end();
    expect(raw.writableEnded, 'ended').toBe(true);
    expect(raw.destroyed, 'not detached — the window is open').toBe(false);
    expect(requestClosed, "the request's close has not fired").toBe(false);

    // Give the re-poll something to deliver, so it reaches write().
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    await sleep(400);
    expect(requestClosed, 'the window stayed open throughout').toBe(false);

    // maxPerTeacher is 1: a second stream opens only if the dead one was
    // actually torn down.
    expect(await streamStatus(session.id, token)).toBe(200);
    sock.destroy();
  });

  it('a write after the response ended does not take the process down', async () => {
    /*
     * The bug this exists for: `write()` after `end()` returns false instead of
     * throwing, then emits 'error' a tick later. Fastify attaches a listener
     * that would absorb it, but only under
     * `hasLogger || onResponse || handlerTimeout`, and it removes itself the
     * first time 'finish' or 'error' fires. A late write landing after that
     * removal — which is where a read resuming from an awaited getEventsSince
     * lands — is an uncaughtException that kills the API and every other
     * class's grid with it.
     *
     * The assertion is the process-level handler seeing nothing. Installing it
     * also stops an unfixed route from actually killing the worker, so the
     * regression reads as a clean failure instead of a vanished test run.
     */
    const { session, teacher } = await seedRunning('stream-own-error');
    const token = await tokenFor(teacher.cognitoId);

    let res: ServerResponse | null = null;
    const onRequest = (req: IncomingMessage, r: ServerResponse) => {
      if (req.url?.includes('/stream') === true) res = r;
    };
    app.server.on('request', onRequest);

    const sock = net.connect(port, '127.0.0.1');
    extraSockets.push(sock); // torn down by afterEach even if a waitFor below throws
    await once(sock, 'connect');
    sock.resume(); // an ordinary, draining client — no backpressure needed
    sock.write(
      `GET /v1/sessions/${session.id}/stream HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\n` +
        `Authorization: Bearer ${token}\r\n\r\n`,
    );
    await waitFor(() => res !== null);
    app.server.off('request', onRequest);
    const raw = res as unknown as ServerResponse;
    await waitFor(() => raw.headersSent);

    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      // Exactly what onClose does, then exactly what a resuming read does.
      raw.end();
      // The window this test exists for: ended, but not yet detached. Asserted
      // rather than assumed — once the response detaches, a late write is a
      // silent no-op and `uncaught` stays empty whether the fix is present or
      // not. Without this the test would pass for the wrong reason.
      expect(raw.writableEnded, 'response should be ended').toBe(true);
      expect(raw.destroyed, 'response should not be detached yet').toBe(false);
      raw.write('id: 1\ndata: {}\n\n');
      await sleep(250);
    } finally {
      process.off('uncaughtException', onUncaught);
      sock.destroy();
    }

    expect(uncaught).toEqual([]);
  });
});
