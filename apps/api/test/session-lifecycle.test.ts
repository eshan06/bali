import { type Database, events, startSession, tapIn } from '@bali/db';
import { and, eq } from 'drizzle-orm';
import type {
  CheckInResponse,
  EndSessionResponse,
  ExtendSessionResponse,
  RefocusResponse,
  UnlockResponse,
} from '@bali/shared';
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

async function tap(sessionId: string, studentId: string) {
  await tapIn(db, { sessionId, studentId, eventId: randomUUID(), deviceTime: new Date() });
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
      },
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<ExtendSessionResponse>();
    expect(body.outcome).toBe('extended');
    expect(new Date(body.session.endsAt).getTime()).toBeGreaterThan(session.endsAt.getTime());
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

  it('a non-owner teacher cannot extend (403)', async () => {
    const { session } = await seedRunning('extend-owner');
    const other = await seedClassroom(db, 'extend-other');
    const res = await post(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/sessions/${session.id}/extend`,
      {
        durationMinutes: 10,
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('cannot extend an ended session (409)', async () => {
    const { teacher, session } = await seedRunning('extend-ended');
    const token = await ctx.tokenFor(teacher.cognitoId);
    await post(token, `/v1/sessions/${session.id}/end`);
    const res = await post(token, `/v1/sessions/${session.id}/extend`, { durationMinutes: 10 });
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
