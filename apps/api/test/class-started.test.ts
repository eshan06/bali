import {
  type Database,
  deviceTokens,
  enrollments,
  newUuidV7,
  registerPushToken,
  users,
} from '@bali/db';
import type { PushEnvironment, StartSessionResponse } from '@bali/shared';
import type { FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import type { ApnsRequest, ApnsResponse, ApnsTransport } from '../src/push/apns.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

/*
 * The "class started" push (N5): after a Start commits, one alert per token of
 * each student whose waiting tap it converted — through a fake APNs transport,
 * so nothing leaves the process.
 */

const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const pushOn: Env = {
  ...testEnv,
  LOG_LEVEL: 'info',
  APNS_KEY_P8: pem,
  APNS_KEY_ID: 'ABC123DEFG',
  APNS_TEAM_ID: 'H535678UF8',
};

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let issuer: TestIssuer;
let sent: ApnsRequest[];
let answer: (r: ApnsRequest) => Promise<ApnsResponse>;
let lines: string[];

function build(env: Env): FastifyInstance {
  lines = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const transport: ApnsTransport = {
    send: (request) => {
      sent.push(request);
      return answer(request);
    },
    close: () => undefined,
  };
  return buildApp(env, { db, verifyToken: issuer.verifier, logStream, apnsTransport: transport });
}

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  sent = [];
  answer = () => Promise.resolve({ status: 200 });
  app = build(pushOn);
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

let tokens = 0;
const newToken = () => `${(tokens += 1).toString(16).padStart(4, '0')}${'c'.repeat(60)}`;

async function as(sub: string, method: 'POST', url: string, payload: object) {
  const authorization = `Bearer ${await issuer.sign({ sub })}`;
  return app.inject({ method, url, headers: { authorization }, payload });
}

/** A classroom whose student has registered `envs`' tokens; returns them too. */
async function classroom(tag: string, envs: PushEnvironment[] = ['sandbox']) {
  const room = await seedClassroom(db, tag);
  const tokensOf = await registerAll(room.student.id, envs);
  return { ...room, tokens: tokensOf };
}

async function registerAll(userId: string, envs: PushEnvironment[]) {
  const made: { token: string; environment: PushEnvironment }[] = [];
  for (const environment of envs) {
    const token = newToken();
    await registerPushToken(db, { userId, token, environment, eventId: newUuidV7() });
    made.push({ token, environment });
  }
  return made;
}

/** Another student enrolled in `room`'s class with a sandbox token; returns the token. */
async function classmate(room: { school: { id: string }; klass: { id: string } }, sub: string) {
  const [student] = await db
    .insert(users)
    .values({ cognitoId: sub, role: 'student', schoolId: room.school.id })
    .returning();
  await db.insert(enrollments).values({ classId: room.klass.id, studentId: student!.id });
  return (await registerAll(student!.id, ['sandbox']))[0]!.token;
}

const tap = (sub: string, tagId: string) =>
  as(sub, 'POST', '/v1/taps', {
    tagId,
    eventId: newUuidV7(),
    deviceTime: new Date().toISOString(),
  });

async function start(sub: string, classId: string) {
  const res = await as(sub, 'POST', `/v1/classes/${classId}/sessions`, { durationMinutes: 25 });
  expect(res.statusCode).toBe(200);
  return res.json<StartSessionResponse>();
}

/** Wait out the background sends — app.close() drains them, as shutdown does. */
async function settle() {
  await app.close();
}

const tokenIn = (r: ApnsRequest) => r.path.replace('/3/device/', '');

describe('the "class started" push', () => {
  it('goes to every token of each student this Start joined, by its environment', async () => {
    const room = await classroom('n5-who', ['sandbox', 'production']);
    // A classmate who armed no tap gets nothing, tokens or not.
    await classmate(room, 'n5-idle');

    expect((await tap(room.student.cognitoId, room.block.tagId)).json()).toMatchObject({
      outcome: 'armed',
    });
    const started = await start(room.teacher.cognitoId, room.klass.id);
    expect(started.armedConverted).toBe(1);
    await settle();

    expect(sent.map((r) => [tokenIn(r), r.origin]).sort()).toEqual(
      [
        [room.tokens[0]!.token, 'https://api.sandbox.push.apple.com'],
        [room.tokens[1]!.token, 'https://api.push.apple.com'],
      ].sort(),
    );
    for (const request of sent) {
      expect(JSON.parse(request.json)).toEqual({
        aps: {
          alert: { title: 'Class n5-who has started', body: 'Open Bali to lock your apps.' },
          sound: 'default',
          'interruption-level': 'time-sensitive',
        },
      });
      expect(request.headers).toMatchObject({
        'apns-topic': 'com.bali.Bali',
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': started.session.id,
        'apns-expiration': String(
          Math.floor((Date.parse(started.session.startedAt) + 10 * 60_000) / 1000),
        ),
      });
    }
  });

  it('is not sent again on a Start replay, nor to a student who taps after the Start', async () => {
    const room = await classroom('n5-replay');
    await tap(room.student.cognitoId, room.block.tagId);
    const first = await start(room.teacher.cognitoId, room.klass.id);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const late = await classmate(room, 'n5-late');
    expect((await tap('n5-late', room.block.tagId)).json()).toMatchObject({ outcome: 'joined' });

    const again = await start(room.teacher.cognitoId, room.klass.id);
    expect(again.outcome).toBe('existing');
    expect(again.session.id).toBe(first.session.id);
    await settle();
    expect(sent.map(tokenIn)).toEqual([room.tokens[0]!.token]);
    expect(sent.map(tokenIn)).not.toContain(late);
  });

  it('never fails or delays the Start: a hung or throwing transport', async () => {
    const room = await classroom('n5-fail', ['sandbox', 'production']);
    await tap(room.student.cognitoId, room.block.tagId);
    let release!: () => void;
    const hung = new Promise<void>((resolve) => (release = resolve));
    answer = (r) =>
      r.origin.includes('sandbox')
        ? hung.then(() => ({ status: 200 }))
        : Promise.reject(new Error(`socket hang up on ${tokenIn(r)}`));

    const started = await start(room.teacher.cognitoId, room.klass.id);
    expect(started.outcome).toBe('created');
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    release();
    await settle();

    const log = lines.join('');
    expect(log).toContain('class-started push not sent');
    expect(log).toContain(room.student.id);
    for (const { token } of room.tokens) expect(log).not.toContain(token);
  });

  it('deletes a token APNs reports gone — only that row, and only while it is still the student’s', async () => {
    const room = await classroom('n5-gone', ['sandbox', 'sandbox', 'production', 'production']);
    const [gone410, badToken, alive, moved] = room.tokens.map((t) => t.token) as [
      string,
      string,
      string,
      string,
    ];
    const [other] = await db
      .insert(users)
      .values({ cognitoId: 'n5-other', role: 'student', schoolId: room.school.id })
      .returning();
    answer = async (r) => {
      const token = tokenIn(r);
      if (token === gone410) return { status: 410, reason: 'Unregistered' };
      if (token === badToken) return { status: 400, reason: 'BadDeviceToken' };
      if (token === moved) {
        // The phone changed hands while the send was in flight (N4's order).
        await registerPushToken(db, {
          userId: other!.id,
          token,
          environment: 'production',
          eventId: newUuidV7(),
        });
        return { status: 410, reason: 'Unregistered' };
      }
      return { status: 400, reason: 'BadCollapseId' };
    };
    await tap(room.student.cognitoId, room.block.tagId);
    await start(room.teacher.cognitoId, room.klass.id);
    await settle();

    const left = await db.select().from(deviceTokens);
    const owners = Object.fromEntries(left.map((row) => [row.token, row.userId]));
    expect(owners[gone410]).toBeUndefined();
    expect(owners[badToken]).toBeUndefined();
    expect(owners[alive]).toBe(room.student.id);
    expect(owners[moved]).toBe(other!.id);

    const log = lines.join('');
    expect(log).toContain('class-started push refused');
    for (const token of room.tokens) expect(log).not.toContain(token.token);
  });

  it('is off, with one line saying so, when the APNs key is unset', async () => {
    await app.close();
    app = build({ ...testEnv, LOG_LEVEL: 'info' });
    const room = await classroom('n5-off');
    await tap(room.student.cognitoId, room.block.tagId);
    expect((await start(room.teacher.cognitoId, room.klass.id)).armedConverted).toBe(1);
    await settle();
    expect(sent).toEqual([]);
    expect(lines.filter((line) => line.includes('push is off'))).toHaveLength(1);
  });

  it('says it is on when configured', () => {
    expect(lines.filter((line) => line.includes('push is on'))).toHaveLength(1);
  });

  it('sends nothing when the Start joined no one', async () => {
    const room = await classroom('n5-none');
    expect((await start(room.teacher.cognitoId, room.klass.id)).armedConverted).toBe(0);
    await settle();
    expect(sent).toEqual([]);
  });

  it('sends nothing for a converted student with no token, and the Start stands', async () => {
    const room = await seedClassroom(db, 'n5-tokenless');
    await tap(room.student.cognitoId, room.block.tagId);
    expect((await start(room.teacher.cognitoId, room.klass.id)).armedConverted).toBe(1);
    await settle();
    expect(sent).toEqual([]);
  });
});
