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

  it("is a 409 when the event_id belongs to another student's armed tap", async () => {
    // The status a phone actually sees, which no engine test can assert. The
    // engine refuses a stranger's id with EVENT_ID_CONFLICT, and that has to
    // reach the client as a 409 — a 500 reads to any outbox as a transient
    // server fault (`unlockDisposition`'s rule: non-401 4xx retries AND
    // surfaces), so the phone would retry the same poisoned id forever with
    // nothing ever shown. The route gets this right for `tapIn` and got it
    // wrong for `armTap`, which is the half with no session running.
    const a = await seedClassroom(db, 'tap-conflict-a');
    const b = await seedClassroom(db, 'tap-conflict-b');
    const eventId = randomUUID();

    // Nothing running, so both of these arm rather than join.
    const mine = await tap(await ctx.tokenFor(a.student.cognitoId), {
      tagId: a.block.tagId,
      eventId,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.outcome).toBe('armed');

    const stranger = await tap(await ctx.tokenFor(b.student.cognitoId), {
      tagId: a.block.tagId,
      eventId,
    });
    expect(stranger.status).toBe(409);
    expect(stranger.body).toMatchObject({ error: { code: 'conflict' } });
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
