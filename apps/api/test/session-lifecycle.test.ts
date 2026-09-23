import { type Database, events, startSession, tapIn } from '@bali/db';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  CheckInResponse,
  EndSessionResponse,
  ExtendSessionResponse,
  ProtectionOffResponse,
  RefocusResponse,
  UnlockResponse,
} from '@bali/shared';
import { unlockDisposition } from '@bali/shared';
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

async function tap(sessionId: string, studentId: string, eventId: string = randomUUID()) {
  await tapIn(db, { sessionId, studentId, eventId, deviceTime: new Date() });
}

function post(token: string, url: string, body: object = {}) {
  return authedInject(ctx.app, token, { method: 'POST', url, payload: body });
}
const now = () => new Date().toISOString();

describe('POST /v1/sessions/:id/end', () => {
  it('the owning teacher ends a running session, then it is idempotent', async () => {
    const { teacher, student, session } = await seedRunning('end-ok');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(teacher.cognitoId);

    const first = await post(token, `/v1/sessions/${session.id}/end`);
    expect(first.statusCode).toBe(200);
    const body = first.json<EndSessionResponse>();
    expect(body.outcome).toBe('ended');
    expect(body.endedParticipations).toBe(1);

    const again = await post(token, `/v1/sessions/${session.id}/end`);
    expect(again.json<EndSessionResponse>().outcome).toBe('already_ended');
    expect(again.json<EndSessionResponse>().endedParticipations).toBe(0);
  });

  it("a non-owner teacher cannot end someone else's session (403)", async () => {
    const { session } = await seedRunning('end-owner');
    const other = await seedClassroom(db, 'end-other');
    const res = await post(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/end`,
    );
    expect(res.statusCode).toBe(403);
  });

  it('a student cannot end a session (403)', async () => {
    const { student, session } = await seedRunning('end-student');
    const res = await post(await ctx.tokenFor(student.cognitoId), `/v1/sessions/${session.id}/end`);
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'end-404');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${randomUUID()}/end`,
    );
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('end-auth');
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/end` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/sessions/:id/extend', () => {
  it('the owning teacher moves the end time later', async () => {
    const { teacher, session } = await seedRunning('extend-ok');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 10,
        eventId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<ExtendSessionResponse>();
    expect(body.outcome).toBe('extended');
    expect(new Date(body.session.endsAt).getTime()).toBeGreaterThan(session.endsAt.getTime());
  });

  it('reusing an event id already spent on another event is a 409, not a phantom extend', async () => {
    const { teacher, student, session } = await seedRunning('extend-id-reuse');
    const eventId = randomUUID();
    await tap(session.id, student.id, eventId);
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 10, eventId },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('conflict');
  });

  it('a retried extend with the same event id adds the time once (rule 4)', async () => {
    // The new end is relative to the current one, so a retry after a lost
    // response would shield the class a second increment past the bell and
    // write a second session_extended into permanent history.
    const { teacher, session } = await seedRunning('extend-replay');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const eventId = randomUUID();

    const first = await post(token, `/v1/sessions/${session.id}/extend`, {
      durationMinutes: 10,
      eventId,
    });
    expect(first.statusCode).toBe(200);
    const firstEnd = first.json<ExtendSessionResponse>().session.endsAt;

    const replayed = await post(token, `/v1/sessions/${session.id}/extend`, {
      durationMinutes: 10,
      eventId,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json<ExtendSessionResponse>().session.endsAt).toBe(firstEnd);

    const extended = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'session_extended')));
    expect(extended).toHaveLength(1);
  });

  it('rejects an extend with no event id (400) — rule 4 is not optional', async () => {
    const { teacher, session } = await seedRunning('extend-no-id');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 10 },
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duration outside the zod bound, and no longer says "end time"', async () => {
    /*
     * A JOINT drift detector, and worth being precise about what it can and
     * cannot see. `INVALID_EXTENSION` is unreachable through /v1 — the route's
     * `int().positive().max(480)` accepts only durations the engine never
     * refuses — so no wire test can assert the engine's message. What this
     * pins is the pair: zod still rejects the shape, AND the message the
     * mapper would produce no longer talks about an end time the route does
     * not send. Measured: reverting the mapper's message alone leaves this
     * green, relaxing `.positive()` alone leaves it green, doing both turns it
     * red.
     */
    const { teacher, session } = await seedRunning('extend-bad-duration');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 0, eventId: randomUUID() },
    );
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('bad_input');
    expect(body.error.message).not.toContain('end time');
  });

  it('a non-owner teacher cannot extend (403)', async () => {
    const { session } = await seedRunning('extend-owner');
    const other = await seedClassroom(db, 'extend-other');
    const res = await post(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 10,
        eventId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('cannot extend an ended session (409)', async () => {
    const { teacher, session } = await seedRunning('extend-ended');
    const token = await ctx.tokenFor(teacher.cognitoId);
    await post(token, `/v1/sessions/${session.id}/end`);
    const res = await post(token, `/v1/sessions/${session.id}/extend`, {
      durationMinutes: 10,
      eventId: randomUUID(),
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a bad duration (400)', async () => {
    const { teacher, session } = await seedRunning('extend-baddur');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 0,
      },
    );
    expect(res.statusCode).toBe(400);
  });

  it('a student cannot extend (403)', async () => {
    const { student, session } = await seedRunning('extend-student');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      { durationMinutes: 10 },
    );
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('extend-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/extend`,
      payload: { durationMinutes: 10 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is a 404 for an unknown session', async () => {
    const { teacher } = await seedClassroom(db, 'extend-404');
    const res = await post(
      await ctx.tokenFor(teacher.cognitoId),
      `/v1/sessions/${randomUUID()}/extend`,
      {
        durationMinutes: 10,
        eventId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /v1/sessions/:id/checkin', () => {
  it('a live student checks in and reads live with their state', async () => {
    const { student, session } = await seedRunning('checkin-live');
    await tap(session.id, student.id);
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/checkin`,
      {
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<CheckInResponse>();
    expect(body.status).toBe('live');
    expect(body.state).toBe('focused');
    expect(body.session?.id).toBe(session.id);
  });

  it('a student not in the session reads gone', async () => {
    const { student, session } = await seedRunning('checkin-gone');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/checkin`,
      {
        deviceTime: now(),
      },
    );
    expect(res.json<CheckInResponse>().status).toBe('gone');
    expect(res.json<CheckInResponse>().state).toBeNull();
    // Knowing a session id must not reveal that class's id and bell window.
    expect(res.json<CheckInResponse>().session).toBeNull();
  });

  it('is a 404 for an unknown session', async () => {
    const { student } = await seedClassroom(db, 'checkin-404');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${randomUUID()}/checkin`,
      {
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('checkin-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/checkin`,
      payload: { deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/sessions/:id/unlock', () => {
  it('flips a live participation to unlocked (applied)', async () => {
    const { student, session } = await seedRunning('unlock-live');
    await tap(session.id, student.id);
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('applied');
    expect(body.state).toBe('unlocked');
    expect(body).toHaveProperty('reason', null);
  });

  it('records the reason the phone sends, and says so', async () => {
    const { student, session } = await seedRunning('unlock-reason');
    await tap(session.id, student.id);
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      { eventId: randomUUID(), deviceTime: now(), reason: 'nurse' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<UnlockResponse>()).toMatchObject({ outcome: 'applied', reason: 'nurse' });

    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(recorded.map((e) => e.payload)).toEqual([{ reason: 'nurse' }]);
  });

  it('an unrecognised reason is recorded as none instead of refusing the unlock', async () => {
    // The standing rule for the unlock body (docs/PLAN.md, 2026-09-20): a 400
    // here keeps the record out forever, because the outbox retries the
    // identical body. A newer app's reason, a wrong type or plain garbage must
    // all still land — without a reason, and the response says none landed.
    // (Fastify's whole-body guards — the 1 MiB limit, prototype-poisoning keys
    // — run before any route and predate this field; no honest client trips them.)
    const { student, session } = await seedRunning('unlock-reason-unknown');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const odd: unknown[] = [
      'skateboard',
      'BATHROOM',
      '',
      42,
      true,
      null,
      { why: 'nurse' },
      ['nurse'],
      'x'.repeat(10_000),
    ];
    for (const reason of odd) {
      const res = await post(token, `/v1/sessions/${session.id}/unlock`, {
        eventId: randomUUID(),
        deviceTime: now(),
        reason,
      });
      expect(res.statusCode, JSON.stringify(reason).slice(0, 40)).toBe(200);
      const body = res.json<UnlockResponse>();
      expect(unlockDisposition(res.statusCode, body)).toBe('recorded');
      expect(body.reason).toBeNull();
    }

    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(recorded.map((e) => e.payload)).toEqual(odd.map(() => null));
  });

  it('a retried unlock answers with the reason on record, not the one it carries', async () => {
    const { student, session } = await seedRunning('unlock-reason-replay');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId,
      deviceTime: now(),
      reason: 'bathroom',
    });
    const retry = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId,
      deviceTime: now(),
      reason: 'other',
    });
    expect(retry.json<UnlockResponse>()).toMatchObject({ outcome: 'replay', reason: 'bathroom' });
  });

  it('records with a note when there is no live participation (ISSUES #2)', async () => {
    const { student, session } = await seedRunning('unlock-note');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('recorded');
    expect(body.recordedAs).toBe('no_live_participation');
  });

  it('records an unknown session id rather than 404ing (never discards)', async () => {
    await seedClassroom(db, 'unlock-unknown');
    const res = await post(
      await ctx.tokenFor('some-student'),
      `/v1/sessions/${randomUUID()}/unlock`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('recorded');
    expect(body.recordedAs).toBe('unknown_session');
  });

  it('a reused event_id is a 409 the outbox keeps retrying, never a swallowed unlock', async () => {
    // insertEvent de-dupes on event_id alone, so an unlock carrying an id the
    // phone already spent on its own tap_in used to come back outcome
    // 'replay' — a recorded outcome — telling the outbox to delete a record
    // that was never written. A 409 maps to 'retry_and_surface', so the phone
    // keeps the record and the client bug is visible instead.
    const { student, session } = await seedRunning('unlock-id-reuse-api');
    const eventId = randomUUID();
    await tap(session.id, student.id, eventId);

    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/unlock`,
      { eventId, deviceTime: now() },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('conflict');
    expect(unlockDisposition(res.statusCode, res.json())).toBe('retry_and_surface');

    const unlocks = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(unlocks).toHaveLength(0);
  });

  it("records a stranger's unlock as an orphan rather than writing into a foreign session", async () => {
    const { session } = await seedRunning('unlock-stranger');
    // A valid, fully authenticated account with no enrollment in this class —
    // it has only learned (or guessed) the session id, which is a plain path
    // parameter. Without an authorization check this wrote permanent rows into
    // another teacher's history and put a phantom chip on their live grid.
    const res = await post(await ctx.tokenFor('outsider'), `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
      reason: 'nurse',
    });

    // Never a refusal (rule 6) — but not attached, and no session handed back.
    expect(res.statusCode).toBe(200);
    const body = res.json<UnlockResponse>();
    expect(body.outcome).toBe('recorded');
    expect(body.recordedAs).toBe('not_enrolled');
    expect(body.session).toBeNull();
    // The orphan keeps the reason like any other unlock.
    expect(body.reason).toBe('nurse');
    const orphans = await db
      .select()
      .from(events)
      .where(and(isNull(events.sessionId), eq(events.type, 'unlock')));
    expect(orphans.map((e) => e.payload)).toEqual([
      expect.objectContaining({ recorded_as: 'not_enrolled', reason: 'nurse' }),
    ]);

    // The teacher's session feed never sees it.
    const attached = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'unlock')));
    expect(attached).toHaveLength(0);
  });

  it('a retried unlock replays', async () => {
    const { student, session } = await seedRunning('unlock-replay');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    await post(token, `/v1/sessions/${session.id}/unlock`, { eventId, deviceTime: now() });
    const second = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId,
      deviceTime: now(),
    });
    expect(second.json<UnlockResponse>().outcome).toBe('replay');
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('unlock-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/unlock`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/sessions/:id/protection-off', () => {
  it('marks a live student as protection off, and a retry replays', async () => {
    const { student, session } = await seedRunning('protoff-live');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const body = { eventId: randomUUID(), deviceTime: now() };

    const res = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
    expect(res.statusCode).toBe(200);
    const first = res.json<ProtectionOffResponse>();
    expect(first.outcome).toBe('applied');
    expect(first.state).toBe('protection_off');
    expect(first.session.id).toBe(session.id);

    const retry = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
    expect(retry.json<ProtectionOffResponse>()).toMatchObject({
      outcome: 'replay',
      state: 'protection_off',
    });
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(1);
  });

  it('is a 409 for a caller with nothing live here, and records nothing', async () => {
    // Strict like refocus: another account that merely knows the session id
    // cannot mark anyone, and a student who never tapped has nothing to mark.
    const { student, session } = await seedRunning('protoff-none');
    for (const sub of [student.cognitoId, 'outsider']) {
      const res = await post(await ctx.tokenFor(sub), `/v1/sessions/${session.id}/protection-off`, {
        eventId: randomUUID(),
        deviceTime: now(),
      });
      expect(res.statusCode).toBe(409);
    }
    const recorded = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, session.id), eq(events.type, 'protection_off')));
    expect(recorded).toHaveLength(0);
  });

  it('is a 404 for an unknown session', async () => {
    await seedClassroom(db, 'protoff-404');
    const res = await post(
      await ctx.tokenFor('lost-student'),
      `/v1/sessions/${randomUUID()}/protection-off`,
      { eventId: randomUUID(), deviceTime: now() },
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects a malformed body (400)', async () => {
    const { student, session } = await seedRunning('protoff-400');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    for (const body of [
      { eventId: 'not-a-uuid', deviceTime: now() },
      { eventId: randomUUID() },
      { eventId: randomUUID(), deviceTime: '2026-09-20T09:15:00' },
    ]) {
      const res = await post(token, `/v1/sessions/${session.id}/protection-off`, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('requires authentication', async () => {
    const { session } = await seedRunning('protoff-auth');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/protection-off`,
      payload: { eventId: randomUUID(), deviceTime: now() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('afterwards, refocus is refused and an unlock is recorded without softening it', async () => {
    const { student, session } = await seedRunning('protoff-after');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/protection-off`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });

    const refocused = await post(token, `/v1/sessions/${session.id}/refocus`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    expect(refocused.statusCode).toBe(409);
    expect(refocused.json<{ error: { message: string } }>().error.message).toBe(
      'Screen Time permission is off: tap the block to rejoin',
    );

    const unlocked = await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    expect(unlocked.statusCode).toBe(200);
    const body = unlocked.json<UnlockResponse>();
    expect(body).toMatchObject({
      outcome: 'recorded',
      recordedAs: 'protection_off',
      state: 'protection_off',
    });
    expect(unlockDisposition(unlocked.statusCode, body)).toBe('recorded');
  });
});

describe('POST /v1/sessions/:id/refocus', () => {
  it('returns an unlocked student to focus', async () => {
    const { student, session } = await seedRunning('refocus-ok');
    await tap(session.id, student.id);
    const token = await ctx.tokenFor(student.cognitoId);
    await post(token, `/v1/sessions/${session.id}/unlock`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    const res = await post(token, `/v1/sessions/${session.id}/refocus`, {
      eventId: randomUUID(),
      deviceTime: now(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<RefocusResponse>();
    expect(body.outcome).toBe('applied');
    expect(body.state).toBe('focused');
  });

  it('is a 409 with no live participation to refocus', async () => {
    const { student, session } = await seedRunning('refocus-none');
    const res = await post(
      await ctx.tokenFor(student.cognitoId),
      `/v1/sessions/${session.id}/refocus`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(409);
  });

  it('is a 404 for an unknown session', async () => {
    await seedClassroom(db, 'refocus-404');
    const res = await post(
      await ctx.tokenFor('lost-student'),
      `/v1/sessions/${randomUUID()}/refocus`,
      {
        eventId: randomUUID(),
        deviceTime: now(),
      },
    );
    expect(res.statusCode).toBe(404);
  });
});
