import { type Database, refocus, startSession, tapIn, unlock } from '@bali/db';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
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
 * read keeps handing over lands on a response that is already finished. Fastify
 * still holds an 'error' listener on the hijacked response, so today those
 * writes are absorbed rather than fatal — but they are writes into a closed
 * stream, and nothing about that is the hub's to keep doing.
 *
 * No NOTIFY here, so this runs on both lanes (stream.test.ts covers the
 * real-Postgres fan-out).
 */

let db: Database;
let closeDb: () => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(10);
  }
  throw new Error('waitFor timed out');
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

  beforeEach(async () => {
    const issuer = await makeTestIssuer();
    tokenFor = (sub) => issuer.sign({ sub });
    app = buildApp(testEnv, {
      db,
      verifyToken: issuer.verifier,
      stream: { repollMs: 60_000, heartbeatMs: 60_000, maxPerTeacher: 2 },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    port = address.port;
  });

  afterEach(async () => {
    await app.close();
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
    app.server.on('request', (req, r) => {
      if (req.url?.includes('/stream') === true) res = r;
    });

    const sock = net.connect(port, '127.0.0.1');
    await once(sock, 'connect');
    sock.resume(); // an ordinary, draining client — no backpressure needed
    sock.write(
      `GET /v1/sessions/${session.id}/stream HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\n` +
        `Authorization: Bearer ${token}\r\n\r\n`,
    );
    await waitFor(() => res !== null);
    const raw = res as unknown as ServerResponse;
    await waitFor(() => raw.headersSent);

    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      // Exactly what onClose does, then exactly what a resuming read does.
      raw.end();
      raw.write('id: 1\ndata: {}\n\n');
      await sleep(250);
    } finally {
      process.off('uncaughtException', onUncaught);
      sock.destroy();
    }

    expect(uncaught).toEqual([]);
  });
});
