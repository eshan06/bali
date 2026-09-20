import { type Database, events, participations, startSession } from '@bali/db';
import type {
  CheckInResponse,
  EnrollmentJoinResponse,
  RefocusResponse,
  TapResponse,
  UnlockResponse,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * Every device timestamp the API takes is ISO 8601, and ISO 8601 spells an
 * instant two equivalent ways: `…Z` and `…+02:00`. Both name the same moment,
 * so both must be accepted — a phone in a school on Central European Time
 * formatting its own local offset is not malformed input.
 *
 * This suite exists because rejecting the offset form is not a cosmetic 400.
 * `unlockDisposition` maps a non-401 4xx to `retry_and_surface`: the outbox
 * KEEPS the record and retries it forever, and every retry is formatted the
 * same way, so it 400s forever. The unlock is never recorded server-side —
 * ISSUES #2's lost-record class through a validation schema (ARCHITECTURE.md,
 * "For unlock records, no response ever means discard"). The same schema gates
 * taps, check-ins and joins, so the whole blast radius is covered here in one
 * place rather than a stray assertion per route file.
 *
 * Each case sends the offset form and asserts the server stored the same
 * instant the `Z` form would have produced — parsing it is not enough if the
 * wall-clock digits were taken at face value.
 */

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

function post(token: string, url: string, body: object) {
  return authedInject(ctx.app, token, { method: 'POST', url, payload: body });
}

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

/**
 * The same instant written with a `+02:00` offset instead of `Z`. Built from a
 * real Date so the two forms are provably the same moment, which is what the
 * "stored at the right instant" assertions below compare against.
 */
function withOffset(at: Date): string {
  const shifted = new Date(at.getTime() + 2 * 60 * 60_000);
  return `${shifted.toISOString().replace(/\.\d+Z$/, '')}+02:00`;
}

/** The single event this session recorded of the given type. */
async function oneEvent(sessionId: string, type: 'tap_in' | 'unlock' | 'refocus') {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, type)));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('ISO 8601 timestamps with a UTC offset', () => {
  it('accepts an offset deviceTime on a tap and records the right instant', async () => {
    const { student, block, session } = await seedRunning('ts-tap');
    const at = new Date(Date.now() - 5_000);

    const res = await post(await ctx.tokenFor(student.cognitoId), '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<TapResponse>().outcome).toBe('joined');
    // Inside the window, so the clamp is a no-op and the stored instant is the
    // one the phone named — to the second, since the offset form drops millis.
    const tapIn = await oneEvent(session.id, 'tap_in');
    expect(Math.abs(tapIn.occurredAt.getTime() - at.getTime())).toBeLessThan(1000);
  });

  it('accepts an offset deviceTime on a check-in', async () => {
    const { student, block, session } = await seedRunning('ts-checkin');
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });

    const res = await post(token, `/v1/sessions/${session.id}/checkin`, {
      deviceTime: withOffset(new Date()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<CheckInResponse>().status).toBe('live');
  });

  it('records an unlock sent with an offset deviceTime instead of 400ing it away', async () => {
    // The headline case. A 400 here is read as `retry_and_surface`, so the
    // phone retries the identical body forever and the record is never saved.
    const { student, block, session } = await seedRunning('ts-unlock');
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    const at = new Date(Date.now() - 3_000);

    const res = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<UnlockResponse>().outcome).toBe('applied');
    const unlock = await oneEvent(session.id, 'unlock');
    expect(Math.abs(unlock.occurredAt.getTime() - at.getTime())).toBeLessThan(1000);
    const [row] = await db
      .select()
      .from(participations)
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );
    expect(row?.state).toBe('unlocked');
  });

  it('accepts an offset deviceTime on a refocus', async () => {
    const { student, block, session } = await seedRunning('ts-refocus');
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });

    const res = await post(token, `/v1/sessions/${session.id}/refocus`, {
      eventId: randomUUID(),
      deviceTime: withOffset(new Date()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<RefocusResponse>().state).toBe('focused');
  });

  it('accepts an offset deviceTime when joining a class by code', async () => {
    const { klass } = await seedClassroom(db, 'ts-join');
    const other = await seedClassroom(db, 'ts-join-other');

    const res = await post(await ctx.tokenFor(other.student.cognitoId), '/v1/enrollments', {
      joinCode: klass.joinCode,
      eventId: randomUUID(),
      deviceTime: withOffset(new Date()),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<EnrollmentJoinResponse>().class.id).toBe(klass.id);
  });

  it('still rejects a timestamp with no zone at all — offsets are allowed, guessing is not', async () => {
    // `2026-09-20T09:15:00` names no instant: read as UTC or as the server's
    // zone it is a different moment, and rule 1's clamp would order the event
    // against a window it was never measured against. Loosening the schema to
    // accept offsets must not quietly accept this.
    const { student, block } = await seedRunning('ts-naive');

    const res = await post(await ctx.tokenFor(student.cognitoId), '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: '2026-09-20T09:15:00',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('bad_input');
  });

  it('still rejects a non-timestamp', async () => {
    const { student, block } = await seedRunning('ts-junk');

    const res = await post(await ctx.tokenFor(student.cognitoId), '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: 'yesterday',
    });

    expect(res.statusCode).toBe(400);
  });
});
