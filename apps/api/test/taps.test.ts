import { type Database, startSession } from '@bali/db';
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
