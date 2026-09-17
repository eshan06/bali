import { type Database, armTap } from '@bali/db';
import type { StartSessionResponse } from '@bali/shared';
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

async function start(
  token: string,
  classId: string,
  durationMinutes: unknown = 25,
): Promise<{ status: number; body: StartSessionResponse }> {
  const res = await authedInject(ctx.app, token, {
    method: 'POST',
    url: `/v1/classes/${classId}/sessions`,
    payload: { durationMinutes },
  });
  return { status: res.statusCode, body: res.json<StartSessionResponse>() };
}

describe('POST /v1/classes/:id/sessions', () => {
  it("starts a session for the teacher's own class", async () => {
    const { teacher, klass } = await seedClassroom(db, 'start-ok');
    const { status, body } = await start(await ctx.tokenFor(teacher.cognitoId), klass.id);
    expect(status).toBe(200);
    expect(body.outcome).toBe('created');
    expect(body.session.classId).toBe(klass.id);
    expect(body.armedConverted).toBe(0);
  });

  it('converts a waiting armed tap into a participation at start (decision 5)', async () => {
    const { teacher, student, klass } = await seedClassroom(db, 'start-armed');
    await armTap(db, {
      studentId: student.id,
      teacherId: teacher.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60_000),
    });
    const { body } = await start(await ctx.tokenFor(teacher.cognitoId), klass.id);
    expect(body.armedConverted).toBe(1);
  });

  it('returns the already-running session instead of a duplicate', async () => {
    const { teacher, klass } = await seedClassroom(db, 'start-dup');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const first = await start(token, klass.id);
    const again = await start(token, klass.id);
    expect(again.body.outcome).toBe('existing');
    expect(again.body.session.id).toBe(first.body.session.id);
  });

  it("forbids starting another teacher's class", async () => {
    const a = await seedClassroom(db, 'start-mine');
    const b = await seedClassroom(db, 'start-theirs');
    const res = await authedInject(ctx.app, await ctx.tokenFor(a.teacher.cognitoId), {
      method: 'POST',
      url: `/v1/classes/${b.klass.id}/sessions`,
      payload: { durationMinutes: 25 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids a student from starting a session', async () => {
    const { student, klass } = await seedClassroom(db, 'start-student');
    const res = await authedInject(ctx.app, await ctx.tokenFor(student.cognitoId), {
      method: 'POST',
      url: `/v1/classes/${klass.id}/sessions`,
      payload: { durationMinutes: 25 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for a class that does not exist', async () => {
    const { teacher } = await seedClassroom(db, 'start-nocls');
    const res = await authedInject(ctx.app, await ctx.tokenFor(teacher.cognitoId), {
      method: 'POST',
      url: `/v1/classes/${randomUUID()}/sessions`,
      payload: { durationMinutes: 25 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a bad duration', async () => {
    const { teacher, klass } = await seedClassroom(db, 'start-baddur');
    const { status } = await start(await ctx.tokenFor(teacher.cognitoId), klass.id, -5);
    expect(status).toBe(400);
  });
});
