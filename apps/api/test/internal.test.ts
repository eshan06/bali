import { type Database, participations, startSession, tapIn } from '@bali/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

const KEY = testEnv.INTERNAL_API_KEY;

let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  // No user JWT needed for the internal route, so no verifier is exercised.
  app = buildApp(testEnv, { db, verifyToken: () => Promise.reject(new Error('unused')) });
});

afterEach(async () => {
  await app.close();
  await closeDb();
});

function sweep(headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/internal/sweep', headers });
}

describe('POST /internal/sweep', () => {
  it('rejects a missing internal key', async () => {
    const res = await sweep({});
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong internal key', async () => {
    const res = await sweep({ 'x-internal-key': 'wrong-key-wrong-key-wrong' });
    expect(res.statusCode).toBe(401);
  });

  it('with the right key, ends sessions past their end time and is idempotent', async () => {
    const { klass } = await seedClassroom(db, 'sweep');
    // A session whose window is already in the past.
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60 * 60_000),
      endsAt: new Date(Date.now() - 30 * 60_000),
    });

    const first = await sweep({ 'x-internal-key': KEY });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ expired: number }>().expired).toBe(1);

    // Running again ends nothing new (idempotent, decision 6).
    const second = await sweep({ 'x-internal-key': KEY });
    expect(second.json<{ expired: number }>().expired).toBe(0);
  });

  it('opens a silence episode for a focused phone gone quiet, exactly once', async () => {
    const { klass, student } = await seedClassroom(db, 'silence-route');
    const session = (
      await startSession(db, {
        classId: klass.id,
        startedAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 25 * 60_000),
      })
    ).session;
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: randomUUID(),
      deviceTime: new Date(),
    });
    // Backdate last contact well past the 90s silence threshold.
    await db
      .update(participations)
      .set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) })
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );

    const first = await sweep({ 'x-internal-key': KEY });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ wentSilent: number }>().wentSilent).toBe(1);

    // The episode is already open — a second sweep opens nothing new.
    const second = await sweep({ 'x-internal-key': KEY });
    expect(second.json<{ wentSilent: number }>().wentSilent).toBe(0);
  });
});
