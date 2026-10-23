import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';

import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { ignoredPoolSizes, sayDatabasePool } from '../src/database-pool.js';
import { initMonitoring } from '../src/monitoring.js';
import { testEnv } from './helpers/env.js';

/*
 * The boot's word on the database pool (DECISIONS 2026-10-22): the pool sizes postgres.js would
 * have read, PGMAX and a `max` in DATABASE_URL, are ignored and named, in the log and to
 * monitoring, never with the URL: it holds the database's password.
 */

// A deploy's URL, its parts made afresh each run: none is in this file's text, which Sentry sends
// beside a stack's frames, so a part found in what was said leaked from the URL itself.
const fresh = () => randomBytes(8).toString('hex');
const USER = `user_${fresh()}`;
const PASSWORD = `pw_${fresh()}`;
const HOST = `db-${fresh()}.railway.internal.example`;
const urlWith = (query: string) => `postgresql://${USER}:${PASSWORD}@${HOST}:5432/railway${query}`;

const BOTH = 'PGMAX and the max parameter in DATABASE_URL are ignored';

describe('ignoredPoolSizes', () => {
  it('names nothing when neither is set: a deploy today', () => {
    expect(ignoredPoolSizes(urlWith(''), undefined)).toEqual([]);
    expect(ignoredPoolSizes(urlWith('?sslmode=require'), undefined)).toEqual([]);
  });

  it('names PGMAX when set, whatever its value, and not when blank, which postgres.js reads as unset', () => {
    for (const value of ['20', '1', ' ', 'twenty']) {
      expect(ignoredPoolSizes(urlWith(''), value)).toEqual(['PGMAX']);
    }
    expect(ignoredPoolSizes(urlWith(''), '')).toEqual([]);
  });

  it('names a max in the URL wherever it is in the query, valued or not', () => {
    for (const query of ['?max=20', '?sslmode=require&max=20', '?max', '?max=', '?%6Dax=5']) {
      expect(ignoredPoolSizes(urlWith(query), undefined)).toEqual([
        'the max parameter in DATABASE_URL',
      ]);
    }
    // A list of hosts, which the WHATWG URL refuses and postgres.js reads.
    expect(
      ignoredPoolSizes(`postgresql://${USER}:${PASSWORD}@a:5432,b:5432/railway?max=20`, '20'),
    ).toEqual(['PGMAX', 'the max parameter in DATABASE_URL']);
  });

  it('names no max that postgres.js would not read: another name, or one past a #', () => {
    for (const query of ['?MAX=20', '?max_lifetime=60', '?maximum=3', '#?max=20', '?x=1#max=2']) {
      expect(ignoredPoolSizes(urlWith(query), undefined)).toEqual([]);
    }
  });

  it('never throws, whatever the URL, so it can never stop a boot', () => {
    for (const url of ['', '?', 'not a url', 'postgres://%%%@/?max=%E0%A4%A']) {
      expect(() => ignoredPoolSizes(url, undefined)).not.toThrow();
    }
  });
});

interface LogLine {
  level: number;
  msg: string;
  connections?: number;
}

/** A logger whose lines are kept, as pino writes them. */
function captured() {
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      raw.push(chunk.toString('utf8'));
      done();
    },
  });
  const app = Fastify({ logger: { level: 'info', stream } });
  return { log: app.log, raw, lines: () => raw.map((line) => JSON.parse(line) as LogLine) };
}

const INFO = 30;
const WARN = 40;

describe('sayDatabasePool', () => {
  const sent: string[] = [];
  const decoder = new TextDecoder();
  const events = () => sent.filter((body) => body.includes('"type":"event"'));

  afterAll(async () => {
    await Sentry.close();
  });

  it('says the size, once, at info, when nothing is ignored', () => {
    const { log, lines } = captured();
    sayDatabasePool(log, 10, ignoredPoolSizes(urlWith(''), undefined));
    expect(lines()).toEqual([
      expect.objectContaining({
        level: INFO,
        connections: 10,
        msg: 'database pool: 10 connections',
      }),
    ]);
  });

  it('warns, once, naming each ignored size, in the log and to monitoring, with no part of the URL', async () => {
    initMonitoring(
      { ...testEnv, SENTRY_DSN: 'https://publickey@o0.ingest.example.invalid/1' },
      {
        transport: (options) =>
          Sentry.createTransport(options, (request) => {
            sent.push(
              typeof request.body === 'string' ? request.body : decoder.decode(request.body),
            );
            return Promise.resolve({ statusCode: 200 });
          }),
      },
    );
    const { log, raw, lines } = captured();
    const url = urlWith('?sslmode=require&max=20');
    sayDatabasePool(log, 10, ignoredPoolSizes(url, '20'));
    await Sentry.flush(5000);

    const [line, ...more] = lines();
    expect(more).toEqual([]);
    expect(line).toMatchObject({ level: WARN, connections: 10 });
    expect(line!.msg).toBe(
      `${BOTH}: the API sizes its own database pool, 10 connections (docs/DECISIONS.md, 2026-10-22)`,
    );

    const [event, ...others] = events();
    expect(others).toEqual([]);
    expect(event).toContain(`"message":"${line!.msg}"`);
    expect(event).toContain('"level":"warning"');
    expect(event).toContain('"route":"boot"');

    // The message above holds no value; and no part of the URL rides anywhere else.
    for (const said of [raw.join(''), ...sent]) {
      for (const secret of [url, USER, PASSWORD, HOST]) expect(said).not.toContain(secret);
    }
  });

  it('names one ignored size alone', () => {
    const { log, lines } = captured();
    sayDatabasePool(log, 2, ignoredPoolSizes(urlWith('?max=20'), undefined));
    expect(lines()[0]!.msg).toBe(
      'the max parameter in DATABASE_URL is ignored: the API sizes its own database pool, 2 connections (docs/DECISIONS.md, 2026-10-22)',
    );
  });
});
