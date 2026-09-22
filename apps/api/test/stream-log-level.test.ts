import { type Database, startSession } from '@bali/db';
import type { FastifyInstance } from 'fastify';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer } from './helpers/test-issuer.js';

/*
 * The last unpinned link in the stream route's log decision, and BOTH
 * directions of it.
 *
 * `streamErrorLog` has its own table test, but the line that CONSUMES it —
 * `request.log[level]({ err }, msg)` — is ordinary code. Hardcoding it either
 * way leaves that table test green:
 *
 *   - to `.warn`, and every ordinary tab-close is noise in production;
 *   - to `.debug`, and the "something reached this listener that we have never
 *     seen" case is swallowed entirely by LOG_LEVEL's `info` default.
 *
 * The second is the more dangerous one, and the first version of this file
 * missed it — it asserted only that the teardown race lands at `debug`, so the
 * `.debug` hardcode passed. Both cases are here now.
 *
 * The `warn` case synthesises its error with `raw.emit('error', …)`, because
 * measured (see feed.ts) nothing but ERR_STREAM_WRITE_AFTER_END actually
 * reaches this listener. So it pins the DISPATCH, not that some real condition
 * takes the `warn` branch — which is the right thing to pin, since the
 * dispatch is what keeps being got wrong.
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

describe('an injected log stream wins over the dev transport', () => {
  /*
   * The one source change here, which shipped with nothing pinning it.
   *
   * pino refuses both at once — "only one of option.transport or
   * option.stream can be specified" — and the first version spread the stream
   * on top of the transport, so a caller in development got an opaque
   * construction error instead of a captured log. Nothing caught that: every
   * test builds with NODE_ENV 'test', so the transport branch is never taken.
   * Here it is, taken deliberately.
   */
  it('constructs in development and writes to the injected stream', async () => {
    const lines: string[] = [];
    const capture = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const issuer = await makeTestIssuer();
    const app = buildApp(
      { ...testEnv, NODE_ENV: 'development', LOG_LEVEL: 'debug' },
      { db, verifyToken: issuer.verifier, logStream: capture },
    );
    try {
      app.log.debug({ probe: true }, 'hello from the injected stream');
      await waitFor(
        () => lines.some((l) => l.includes('hello from the injected stream')),
        3000,
        'the injected stream to receive the line',
      );
      // Proof it is the STREAM and not pino-pretty's transport: the line is
      // the raw JSON pino writes, not a prettified one.
      const line = lines.find((l) => l.includes('hello from the injected stream'));
      expect(JSON.parse(line?.trim() ?? '{}')).toMatchObject({ probe: true, level: 20 });
    } finally {
      await app.close();
    }
  });
});

describe('the stream route logs its teardown race where it said it would', () => {
  let app: FastifyInstance;
  let port: number;
  let tokenFor: (sub: string) => Promise<string>;
  const lines: { level: number; msg: string }[] = [];
  const sockets: net.Socket[] = [];
  /** Teardown that must run even when an assertion or a waitFor throws first. */
  const cleanups: (() => void)[] = [];

  beforeEach(async () => {
    lines.length = 0;
    const capture = new Writable({
      write(chunk: Buffer, _enc, done) {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim() === '') continue;
          try {
            lines.push(JSON.parse(line) as { level: number; msg: string });
          } catch {
            // pino writes one JSON object per line; anything else is not ours.
          }
        }
        done();
      },
    });
    const issuer = await makeTestIssuer();
    tokenFor = (sub) => issuer.sign({ sub });
    app = buildApp(
      // debug, so neither level under test is filtered out before it is written.
      { ...testEnv, LOG_LEVEL: 'debug' },
      {
        db,
        verifyToken: issuer.verifier,
        stream: { repollMs: 60_000, heartbeatMs: 60_000 },
        logStream: capture,
      },
    );
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    port = address.port;
  });

  afterEach(async () => {
    for (const undo of cleanups) undo();
    cleanups.length = 0;
    for (const s of sockets) s.destroy();
    sockets.length = 0;
    await app.close();
  });

  /**
   * Open a live stream and hand back the raw response the route hijacked,
   * once it is genuinely idle.
   *
   * Waiting on `headersSent` is not enough, and CI proved it: that fires at
   * `writeHead`, BEFORE the route calls `hub.subscribe()`, so a test that acts
   * on it ends the response while the subscription's first `getEventsSince` is
   * still in flight. The read then outlives the test and the pool closes under
   * it — `write CONNECTION_ENDED localhost:5432`, an unhandled rejection that
   * fails the run with every test green. Waiting for the opening frame to
   * reach the client is the proof that read has finished.
   */
  async function openStream(tag: string): Promise<ServerResponse> {
    const { klass, teacher } = await seedClassroom(db, tag);
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const token = await tokenFor(teacher.cognitoId);

    let res: ServerResponse | null = null;
    const onRequest = (req: IncomingMessage, r: ServerResponse) => {
      // First match only: a later /stream on this app must not reassign it.
      if (res === null && req.url?.includes('/stream') === true) res = r;
    };
    app.server.on('request', onRequest);
    cleanups.push(() => app.server.off('request', onRequest));

    const sock = net.connect(port, '127.0.0.1');
    sockets.push(sock);
    await once(sock, 'connect');
    let received = '';
    sock.on('data', (d: Buffer) => {
      received += d.toString('latin1');
    });
    sock.write(
      `GET /v1/sessions/${session.id}/stream HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\n` +
        `Authorization: Bearer ${token}\r\n\r\n`,
    );
    await waitFor(() => res !== null, 3000, 'the stream request');
    const raw = res as unknown as ServerResponse;
    await waitFor(
      () => received.includes('session_started'),
      3000,
      'the opening frame — the first read has finished',
    );
    return raw;
  }

  it('sends the write-after-end race to debug, not warn', async () => {
    const raw = await openStream('stream-log-debug');

    // The same window the crash regression uses, so the same net: an emitter
    // that emits 'error' with no listener throws from an I/O callback, and
    // without this a regression in the route's own listener would take the
    // worker down instead of reporting a failed assertion.
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      raw.end();
      expect(raw.writableEnded, 'ended').toBe(true);
      expect(raw.destroyed, 'not detached — the window is open').toBe(false);
      raw.write('id: 1\ndata: {}\n\n');
      await waitFor(
        () => lines.some((l) => l.msg === 'live stream ended mid-write'),
        3000,
        'the teardown log line',
      );
    } finally {
      process.off('uncaughtException', onUncaught);
      // Inside the finally, so a waitFor timeout above reports what the
      // process actually threw instead of "timed out waiting for the log line".
      expect(uncaught).toEqual([]);
    }

    // pino: debug is 20, warn is 40.
    const written = lines.filter((l) => l.msg === 'live stream ended mid-write');
    expect(written).toHaveLength(1);
    expect(written[0]?.level).toBe(20);
    expect(lines.filter((l) => l.level >= 40)).toEqual([]);
  });

  it('sends a code it has never seen to warn, not debug', async () => {
    /*
     * The direction that actually costs something. `warn` here does not mean
     * "a proxy is resetting connections" — measured, nothing else reaches this
     * listener — it means "we have never seen this", and production runs at
     * `info`, so logging it at `debug` discards it silently.
     */
    const raw = await openStream('stream-log-warn');
    raw.emit('error', Object.assign(new Error('unheard of'), { code: 'ECONNRESET' }));

    await waitFor(
      () => lines.some((l) => l.msg === 'unexpected error on a live stream'),
      3000,
      'the unexpected-error log line',
    );
    const written = lines.filter((l) => l.msg === 'unexpected error on a live stream');
    expect(written).toHaveLength(1);
    expect(written[0]?.level).toBe(40);
    expect(lines.filter((l) => l.msg === 'live stream ended mid-write')).toEqual([]);
  });
});
