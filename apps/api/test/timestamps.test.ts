import {
  type Database,
  events,
  markSilentParticipations,
  participations,
  startSession,
} from '@bali/db';
import type {
  CheckInResponse,
  EnrollmentJoinResponse,
  ProtectionOffResponse,
  RefocusResponse,
  TapResponse,
  UnlockResponse,
} from '@bali/shared';
import { SILENCE_THRESHOLD_MS } from '@bali/shared';
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
 * taps, check-ins and joins, so the whole blast radius is covered here rather
 * than a stray assertion per route file.
 *
 * A 200 alone is a weak assertion: a parser that took the wall-clock digits at
 * face value and dropped the `+02:00` would also return 200, having silently
 * moved the event two hours. So every case here reaches for whatever the route
 * actually persisted from `deviceTime` and asserts it is the instant the `Z`
 * form would have produced:
 *
 *   tap / unlock / refocus / protection-off
 *                           the event's `occurred_at` (clamped device time)
 *   check-in                the `came_back` event's `occurred_at` — the one
 *                           place check-in uses the device clock at all, since
 *                           `last_seen_at` is server-stamped (rule 1)
 *   join                    the event's `payload.device_time`, since the
 *                           enrolment event's `occurred_at` is server-stamped
 *
 * The accept/reject table for the schema itself lives in schemas.test.ts.
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
 * real Date so the two spellings are provably the same moment — which is what
 * makes the assertions below able to catch a face-value parse: reading the
 * digits and ignoring the offset lands two hours out.
 */
function withOffset(at: Date): string {
  const shifted = new Date(at.getTime() + 2 * 60 * 60_000);
  return `${shifted.toISOString().replace(/\.\d+Z$/, '')}+02:00`;
}

/** The single event of this type in the session, or unattached (`sessionId: null`). */
async function oneEvent(
  sessionId: string | null,
  type: 'tap_in' | 'unlock' | 'refocus' | 'protection_off' | 'came_back' | 'enrollment_joined',
) {
  const rows = await db
    .select()
    .from(events)
    .where(
      sessionId === null
        ? eq(events.type, type)
        : and(eq(events.sessionId, sessionId), eq(events.type, type)),
    );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/**
 * Within a second of the intended instant. The tolerance covers only the
 * offset form's dropped milliseconds: a face-value parse is 7.2e6 ms out and a
 * clamp to the window's edge ~1.5e6 ms out, so neither can hide in here.
 */
function sameInstant(actual: Date, expected: Date) {
  expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(1000);
}

async function joinSession(token: string, tagId: string) {
  const res = await post(token, '/v1/taps', {
    tagId,
    eventId: randomUUID(),
    deviceTime: new Date().toISOString(),
  });
  expect(res.statusCode).toBe(200);
}

describe('ISO 8601 timestamps with a UTC offset', () => {
  it('records a tap at the instant its offset deviceTime names', async () => {
    const { student, block, session } = await seedRunning('ts-tap');
    const at = new Date(Date.now() - 5_000);

    const res = await post(await ctx.tokenFor(student.cognitoId), '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<TapResponse>().outcome).toBe('joined');
    sameInstant((await oneEvent(session.id, 'tap_in')).occurredAt, at);
  });

  it('records an unlock at the instant its offset deviceTime names', async () => {
    // The headline case. A 400 here reads as `retry_and_surface`, so the phone
    // retries the identical body forever and the record is never saved.
    const { student, block, session } = await seedRunning('ts-unlock');
    const token = await ctx.tokenFor(student.cognitoId);
    await joinSession(token, block.tagId);
    const at = new Date(Date.now() - 3_000);

    const res = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<UnlockResponse>().outcome).toBe('applied');
    sameInstant((await oneEvent(session.id, 'unlock')).occurredAt, at);
    const [row] = await db
      .select()
      .from(participations)
      .where(
        and(eq(participations.sessionId, session.id), eq(participations.studentId, student.id)),
      );
    expect(row?.state).toBe('unlocked');
  });

  it('records a refocus at the instant its offset deviceTime names', async () => {
    const { student, block, session } = await seedRunning('ts-refocus');
    const token = await ctx.tokenFor(student.cognitoId);
    await joinSession(token, block.tagId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: new Date().toISOString(),
    });
    const at = new Date(Date.now() - 2_000);

    const res = await post(token, `/v1/sessions/${session.id}/refocus`, {
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<RefocusResponse>().state).toBe('focused');
    sameInstant((await oneEvent(session.id, 'refocus')).occurredAt, at);
  });

  it('records a protection-off at the instant its offset deviceTime names', async () => {
    // A 400 here and the report never lands: the phone resends the identical
    // body, and the grid keeps showing a phone whose shields iOS already dropped.
    const { student, block, session } = await seedRunning('ts-protoff');
    const token = await ctx.tokenFor(student.cognitoId);
    await joinSession(token, block.tagId);
    const at = new Date(Date.now() - 2_000);

    const res = await post(token, `/v1/sessions/${session.id}/protection-off`, {
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<ProtectionOffResponse>().state).toBe('protection_off');
    sameInstant((await oneEvent(session.id, 'protection_off')).occurredAt, at);
  });

  it("records a check-in's came_back at the instant its offset deviceTime names", async () => {
    // A plain heartbeat writes no history and stamps `last_seen_at` from the
    // server's clock (rule 1), so it persists nothing from `deviceTime` to
    // assert against. Closing a silence episode is the one place check-in does
    // use the device clock — so open one first, and the came_back it earns
    // carries the instant.
    const { student, block, session } = await seedRunning('ts-checkin');
    const token = await ctx.tokenFor(student.cognitoId);
    await joinSession(token, block.tagId);
    const silenced = await markSilentParticipations(
      db,
      new Date(Date.now() + SILENCE_THRESHOLD_MS + 5_000),
    );
    expect(silenced).toBe(1);
    const at = new Date(Date.now() - 1_000);

    const res = await post(token, `/v1/sessions/${session.id}/checkin`, {
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<CheckInResponse>().status).toBe('live');
    sameInstant((await oneEvent(session.id, 'came_back')).occurredAt, at);
  });

  it('records a join at the instant its offset deviceTime names', async () => {
    const { klass } = await seedClassroom(db, 'ts-join');
    const other = await seedClassroom(db, 'ts-join-other');
    const at = new Date(Date.now() - 4_000);

    const res = await post(await ctx.tokenFor(other.student.cognitoId), '/v1/enrollments', {
      joinCode: klass.joinCode,
      eventId: randomUUID(),
      deviceTime: withOffset(at),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<EnrollmentJoinResponse>().class.id).toBe(klass.id);
    // A join has no session window to clamp to, so the event's own occurred_at
    // is the server's clock and the device's claim is kept beside it.
    const joined = await oneEvent(null, 'enrollment_joined');
    const claimed = (joined.payload as { device_time: string }).device_time;
    sameInstant(new Date(claimed), at);
  });

  it('still refuses a timestamp with no zone at all — offsets are allowed, guessing is not', async () => {
    // Proves the refusal still reaches the wire in the one error shape. The
    // rest of the reject table is in schemas.test.ts.
    const { student, block } = await seedRunning('ts-naive');

    const res = await post(await ctx.tokenFor(student.cognitoId), '/v1/taps', {
      tagId: block.tagId,
      eventId: randomUUID(),
      deviceTime: '2026-09-20T09:15:00',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('bad_input');
  });
});
