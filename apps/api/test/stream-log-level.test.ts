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
 * The last unpinned link in the stream route's log decision.
 *
 * `streamErrorLog` has its own table test, but the line that CONSUMES it —
 * `request.log[level]({ err }, msg)` — is ordinary code: hardcode it to
 * `.warn` and every tab-close goes to `warn` in production while all five
 * helper cases stay green. That is the same shape of hole twice over now (an
 * inverted branch, then a hardcodable call), so it gets an assertion that
 * reads the log the route actually wrote.
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

describe('the stream route logs its teardown race where it said it would', () => {
  let app: FastifyInstance;
  let port: number;
  const lines: { level: number; msg: string }[] = [];
  const sockets: net.Socket[] = [];
  let tokenFor: (sub: string) => Promise<string>;

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
    app = buildApp(
      // debug, so the level under test is not filtered out before it is written.
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
    // The token has to be minted from the same issuer the app verifies against.
    tokenFor = (sub) => issuer.sign({ sub });
  });

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    sockets.length = 0;
    await app.close();
  });

  it('sends the write-after-end race to debug, not warn', async () => {
    const { klass, teacher } = await seedClassroom(db, 'stream-log-level');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const token = await tokenFor(teacher.cognitoId);

    let res: ServerResponse | null = null;
    const onRequest = (req: IncomingMessage, r: ServerResponse) => {
      if (req.url?.includes('/stream') === true) res = r;
    };
    app.server.on('request', onRequest);
    const sock = net.connect(port, '127.0.0.1');
    sockets.push(sock);
    await once(sock, 'connect');
    sock.resume();
    sock.write(
      `GET /v1/sessions/${session.id}/stream HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\n` +
        `Authorization: Bearer ${token}\r\n\r\n`,
    );
    await waitFor(() => res !== null, 3000, 'the stream request');
    app.server.off('request', onRequest);
    const raw = res as unknown as ServerResponse;
    await waitFor(() => raw.headersSent, 3000, 'headers');

    // Exactly what onClose does, then exactly what a resuming read does.
    raw.end();
    expect(raw.writableEnded, 'ended').toBe(true);
    expect(raw.destroyed, 'not detached — the window is open').toBe(false);
    raw.write('id: 1\ndata: {}\n\n');
    await waitFor(
      () => lines.some((l) => l.msg === 'live stream ended mid-write'),
      3000,
      'the teardown log line',
    );

    // pino: debug is 20, warn is 40. The level is the whole point — a route
    // that logs the right words at the wrong level is the bug this pins.
    const written = lines.filter((l) => l.msg === 'live stream ended mid-write');
    expect(written).toHaveLength(1);
    expect(written[0]?.level).toBe(20);
    expect(lines.filter((l) => l.level >= 40)).toEqual([]);
  });
});
