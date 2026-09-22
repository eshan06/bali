import { classes, type Database, enrollments, startSession } from '@bali/db';
import type { TapResponse } from '@bali/shared';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

async function tap(
  token: string,
  payload: { tagId: string; eventId?: string; deviceTime?: string },
): Promise<{ status: number; body: TapResponse }> {
  const res = await authedInject(ctx.app, token, {
    method: 'POST',
    url: '/v1/taps',
    payload: {
      tagId: payload.tagId,
      eventId: payload.eventId ?? randomUUID(),
      deviceTime: payload.deviceTime ?? new Date().toISOString(),
    },
  });
  return { status: res.statusCode, body: res.json<TapResponse>() };
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
}

describe('POST /v1/taps', () => {
  it('joins the running session and returns the end time', async () => {
    const { student, klass, block } = await seedClassroom(db, 'tap-join');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });

    const { status, body } = await tap(await ctx.tokenFor(student.cognitoId), {
      tagId: block.tagId,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('joined');
    expect(body.state).toBe('focused');
    expect(body.session?.id).toBe(session.id);
  });

  it('arms the tap when no session is running yet', async () => {
    const { student, block } = await seedClassroom(db, 'tap-arm');
    const { status, body } = await tap(await ctx.tokenFor(student.cognitoId), {
      tagId: block.tagId,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('armed');
    expect(body.session).toBeNull();
  });

  it('a non-enrolled student cannot join — the tap arms, never joins someone else class', async () => {
    // Teacher A runs a session; an outsider student (enrolled elsewhere) taps A's block.
    const a = await seedClassroom(db, 'tap-idor-a');
    const outsider = await seedClassroom(db, 'tap-idor-b');
    await startSession(db, {
      classId: a.klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });

    const { status, body } = await tap(await ctx.tokenFor(outsider.student.cognitoId), {
      tagId: a.block.tagId,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('armed'); // NOT 'joined' — outsider isn't enrolled in A's class
    expect(body.session).toBeNull();
  });

  it('is idempotent on eventId (a retried join counts once)', async () => {
    const { student, klass, block } = await seedClassroom(db, 'tap-retry');
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    const first = await tap(token, { tagId: block.tagId, eventId });
    const retry = await tap(token, { tagId: block.tagId, eventId });
    expect(first.body.outcome).toBe('joined');
    expect(retry.body.outcome).toBe('replay');
  });

  it('a retry the server re-resolves elsewhere replays the session it recorded', async () => {
    /*
     * The wire shape of the engine's cross-session replay, which the engine
     * tests pin only as a result object. One physical tap, one event id, and
     * the SERVER picks the session: the retry resolves at the teacher's newer
     * session, and the answer must still be 200 naming the session that
     * actually recorded the tap — not the 409 that used to send the phone
     * round the retry loop forever.
     */
    const { student, teacher, school, klass, block } = await seedClassroom(db, 'tap-reresolve');
    const second = one(
      await db
        .insert(classes)
        .values({
          teacherId: teacher.id,
          schoolId: school.id,
          name: 'Second period',
          joinCode: 'JOIN-tap-reresolve-2',
        })
        .returning(),
    );
    await db.insert(enrollments).values({ classId: second.id, studentId: student.id });

    const token = await ctx.tokenFor(student.cognitoId);
    const first = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const eventId = randomUUID();
    const landed = await tap(token, { tagId: block.tagId, eventId });
    expect(landed.body.outcome).toBe('joined');

    // The same teacher starts a second session the student is also in, so
    // resolveTapTarget (newest running session of the block's teacher) now
    // points the retry somewhere new.
    const later = await startSession(db, {
      classId: second.id,
      startedAt: new Date(),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const retry = await tap(token, { tagId: block.tagId, eventId });

    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('replay');
    expect(retry.body.session?.id).toBe(first.session.id);
    expect(retry.body.session?.id).not.toBe(later.session.id);
    expect(retry.body.state).toBe('focused');
  });

  it('is a 404 for an unknown tag', async () => {
    const { student } = await seedClassroom(db, 'tap-unknown');
    const res = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: '/v1/taps',
      payload: {
        tagId: 'NOT-A-REAL-TAG',
        eventId: randomUUID(),
        deviceTime: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is a 400 for a malformed body', async () => {
    const { student } = await seedClassroom(db, 'tap-bad');
    const res = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: '/v1/taps',
      payload: { tagId: '', eventId: 'not-a-uuid', deviceTime: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/taps', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
