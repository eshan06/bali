import { classes, type Database, newUuidV7, users } from '@bali/db';
import type { ApiErrorBody, ClassDetail, EnrollmentJoinResponse } from '@bali/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { routeTable } from './helpers/openapi.js';

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

const JOIN_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

function post(token: string, url: string, body: object) {
  return authedInject(ctx.app, token, { method: 'POST', url, payload: body });
}
function get(token: string, url: string) {
  return authedInject(ctx.app, token, { method: 'GET', url });
}
function patch(token: string, url: string, body: object) {
  return ctx.app.inject({
    method: 'PATCH',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}
function join(token: string, joinCode: string) {
  return post(token, '/v1/enrollments', {
    joinCode,
    eventId: randomUUID(),
    deviceTime: new Date().toISOString(),
  });
}

describe('POST /v1/classes', () => {
  it('a teacher creates a class with a fresh, unique join code', async () => {
    const { teacher } = await seedClassroom(db, 'create');
    const res = await post(await ctx.tokenFor(teacher.cognitoId), '/v1/classes', {
      name: 'Period 1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ClassDetail>();
    expect(body.name).toBe('Period 1');
    expect(body.joinCode).toMatch(JOIN_CODE);
    expect(typeof body.id).toBe('string');
  });

  it('the created class is real: it can be fetched and joined by its code', async () => {
    const { teacher } = await seedClassroom(db, 'create-join');
    const created = (
      await post(await ctx.tokenFor(teacher.cognitoId), '/v1/classes', { name: 'Chemistry' })
    ).json<ClassDetail>();

    const fetched = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/classes/${created.id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<ClassDetail>().joinCode).toBe(created.joinCode);

    const joined = await join(await ctx.tokenFor('a-new-student'), created.joinCode);
    expect(joined.statusCode).toBe(200);
    expect(joined.json<EnrollmentJoinResponse>().class.id).toBe(created.id);
  });

  it('two classes get distinct join codes', async () => {
    const { teacher } = await seedClassroom(db, 'create-two');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const resA = await post(token, '/v1/classes', { name: 'A' });
    const resB = await post(token, '/v1/classes', { name: 'B' });
    // Both must actually succeed — otherwise a `undefined !== undefined-or-value`
    // comparison could pass vacuously and mask a broken generator.
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.json<ClassDetail>().joinCode).not.toBe(resB.json<ClassDetail>().joinCode);
  });

  it('a student cannot create a class (403)', async () => {
    const { student } = await seedClassroom(db, 'create-student');
    const res = await post(await ctx.tokenFor(student.cognitoId), '/v1/classes', { name: 'X' });
    expect(res.statusCode).toBe(403);
  });

  it('an unknown caller cannot create a class (403)', async () => {
    const res = await post(await ctx.tokenFor('nobody-here'), '/v1/classes', { name: 'X' });
    expect(res.statusCode).toBe(403);
  });

  it('a teacher with no school gets a clear 409', async () => {
    const [schoolless] = await db
      .insert(users)
      .values({ cognitoId: 'schoolless-teacher', role: 'teacher' })
      .returning();
    const res = await post(await ctx.tokenFor(schoolless!.cognitoId), '/v1/classes', { name: 'X' });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a blank name (400)', async () => {
    const { teacher } = await seedClassroom(db, 'create-blank');
    const res = await post(await ctx.tokenFor(teacher.cognitoId), '/v1/classes', { name: '   ' });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/classes',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/classes with an eventId (2026-10-23)', () => {
  /** The rows `classes` holds for `teacherId`. */
  const classesOf = (teacherId: string) =>
    db.select().from(classes).where(eq(classes.teacherId, teacherId));

  it('makes the class under it: a real one, its code joinable', async () => {
    const { teacher } = await seedClassroom(db, 'id-create');
    const eventId = newUuidV7();
    const res = await post(await ctx.tokenFor(teacher.cognitoId), '/v1/classes', {
      name: 'Period 1',
      eventId,
    });
    expect(res.statusCode).toBe(200);
    const made = res.json<ClassDetail>();
    expect(made).toMatchObject({ name: 'Period 1', liveSessionId: null });
    expect(made.joinCode).toMatch(JOIN_CODE);
    const [row] = await db.select().from(classes).where(eq(classes.id, made.id));
    expect(row?.eventId).toBe(eventId);
    expect((await join(await ctx.tokenFor('id-joiner'), made.joinCode)).statusCode).toBe(200);
  });

  it('answers a resend of it, in either letter case, with the class it made: one class', async () => {
    const { teacher } = await seedClassroom(db, 'id-replay');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const eventId = newUuidV7();
    const first = await post(token, '/v1/classes', { name: 'Period 2', eventId });
    const again = await post(token, '/v1/classes', { name: 'Period 2', eventId });
    const upper = await post(token, '/v1/classes', {
      name: 'Period 2',
      eventId: eventId.toUpperCase(),
    });
    expect([first.statusCode, again.statusCode, upper.statusCode]).toEqual([200, 200, 200]);
    expect(again.json()).toEqual(first.json());
    expect(upper.json()).toEqual(first.json());
    // The seeded class and this one: no second.
    expect(await classesOf(teacher.id)).toHaveLength(2);
  });

  it('answers a resend with the class as it is now: renamed, a new code, a session running', async () => {
    const { teacher } = await seedClassroom(db, 'id-now');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const eventId = newUuidV7();
    const made = (await post(token, '/v1/classes', { name: 'Old', eventId })).json<ClassDetail>();
    const renamed = await patch(token, `/v1/classes/${made.id}`, {
      name: 'New',
      regenerateCode: true,
    });
    const started = await post(token, `/v1/classes/${made.id}/sessions`, { durationMinutes: 25 });
    const sessionId = started.json<{ session: { id: string } }>().session.id;

    // The resend carries the name the teacher typed again; the class is the one its id made.
    const again = await post(token, '/v1/classes', { name: 'Typed again', eventId });
    expect(again.statusCode).toBe(200);
    expect(again.json<ClassDetail>()).toEqual({
      ...made,
      name: 'New',
      joinCode: renamed.json<ClassDetail>().joinCode,
      liveSessionId: sessionId,
    });
    expect(await classesOf(teacher.id)).toHaveLength(2);
  });

  it('refuses another teacher’s id, in either case, as 409 event_id_conflict, making nothing', async () => {
    const owner = await seedClassroom(db, 'id-owner');
    const other = await seedClassroom(db, 'id-other');
    const eventId = newUuidV7();
    const made = await post(await ctx.tokenFor(owner.teacher.cognitoId), '/v1/classes', {
      name: 'Mine',
      eventId,
    });
    expect(made.statusCode).toBe(200);
    const token = await ctx.tokenFor(other.teacher.cognitoId);
    for (const id of [eventId, eventId.toUpperCase()]) {
      const res = await post(token, '/v1/classes', { name: 'Theirs', eventId: id });
      expect(res.statusCode, id).toBe(409);
      expect(res.json<ApiErrorBody>().error).toMatchObject({
        code: 'conflict',
        reason: 'event_id_conflict',
      });
    }
    expect(await classesOf(other.teacher.id)).toHaveLength(1);
  });

  it('refuses an id that is no UUIDv7 (400), making nothing', async () => {
    const { teacher } = await seedClassroom(db, 'id-bad');
    const token = await ctx.tokenFor(teacher.cognitoId);
    for (const eventId of ['not-an-id', randomUUID(), 42, null, '']) {
      const res = await post(token, '/v1/classes', { name: 'X', eventId });
      expect(res.statusCode, String(eventId)).toBe(400);
    }
    expect(await classesOf(teacher.id)).toHaveLength(1);
  });

  it('a student is refused (403) and a caller with no token (401), under an id too', async () => {
    const { student } = await seedClassroom(db, 'id-authz');
    const body = { name: 'X', eventId: newUuidV7() };
    const studentRes = await post(await ctx.tokenFor(student.cognitoId), '/v1/classes', body);
    expect(studentRes.statusCode).toBe(403);
    const anonymous = await ctx.app.inject({ method: 'POST', url: '/v1/classes', payload: body });
    expect(anonymous.statusCode).toBe(401);
    expect(await db.select().from(classes).where(eq(classes.eventId, body.eventId))).toEqual([]);
  });

  it('without one, makes a class at every call, as today', async () => {
    const { teacher } = await seedClassroom(db, 'id-none');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const a = await post(token, '/v1/classes', { name: 'Same' });
    const b = await post(token, '/v1/classes', { name: 'Same' });
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json<ClassDetail>().id).not.toBe(b.json<ClassDetail>().id);
    expect(await classesOf(teacher.id)).toHaveLength(3);
  });
});

describe('GET /v1/classes/:id', () => {
  it('the owning teacher sees their class', async () => {
    const { teacher, klass } = await seedClassroom(db, 'get');
    const res = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/classes/${klass.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<ClassDetail>().id).toBe(klass.id);
  });

  it("reports the class's running session so a reload can recover the grid", async () => {
    const { teacher, klass } = await seedClassroom(db, 'get-live');
    const token = await ctx.tokenFor(teacher.cognitoId);

    const before = await get(token, `/v1/classes/${klass.id}`);
    expect(before.json<ClassDetail>().liveSessionId).toBeNull();

    const started = await authedInject(ctx.app, token, {
      method: 'POST',
      url: `/v1/classes/${klass.id}/sessions`,
      payload: { durationMinutes: 25 },
    });
    expect(started.statusCode).toBe(200);
    const sessionId = started.json<{ session: { id: string } }>().session.id;

    const during = await get(token, `/v1/classes/${klass.id}`);
    expect(during.json<ClassDetail>().liveSessionId).toBe(sessionId);

    await authedInject(ctx.app, token, {
      method: 'POST',
      url: `/v1/sessions/${sessionId}/end`,
      payload: {},
    });
    const after = await get(token, `/v1/classes/${klass.id}`);
    expect(after.json<ClassDetail>().liveSessionId).toBeNull();
  });

  it('another teacher cannot see it (403)', async () => {
    const { klass } = await seedClassroom(db, 'get-a');
    const other = await seedClassroom(db, 'get-b');
    const res = await get(await ctx.tokenFor(other.teacher.cognitoId), `/v1/classes/${klass.id}`);
    expect(res.statusCode).toBe(403);
  });

  it('a student cannot see it (403)', async () => {
    const { klass, student } = await seedClassroom(db, 'get-student');
    const res = await get(await ctx.tokenFor(student.cognitoId), `/v1/classes/${klass.id}`);
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown class', async () => {
    const { teacher } = await seedClassroom(db, 'get-404');
    const res = await get(await ctx.tokenFor(teacher.cognitoId), `/v1/classes/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /v1/classes/:id', () => {
  it('renames a class without changing its join code', async () => {
    const { teacher, klass } = await seedClassroom(db, 'rename');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const before = (await get(token, `/v1/classes/${klass.id}`)).json<ClassDetail>();

    const res = await patch(token, `/v1/classes/${klass.id}`, { name: 'Renamed' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ClassDetail>();
    expect(body.name).toBe('Renamed');
    expect(body.joinCode).toBe(before.joinCode);
  });

  it('regenerates the join code: the old one stops working, the new one joins', async () => {
    const { teacher, klass } = await seedClassroom(db, 'regen');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const before = (await get(token, `/v1/classes/${klass.id}`)).json<ClassDetail>();

    const res = await patch(token, `/v1/classes/${klass.id}`, { regenerateCode: true });
    expect(res.statusCode).toBe(200);
    const after = res.json<ClassDetail>();
    expect(after.joinCode).not.toBe(before.joinCode);
    expect(after.joinCode).toMatch(JOIN_CODE);
    expect(after.name).toBe(before.name);

    // The old code now matches no active class; the new one joins.
    expect((await join(await ctx.tokenFor('regen-old'), before.joinCode)).statusCode).toBe(404);
    expect((await join(await ctx.tokenFor('regen-new'), after.joinCode)).statusCode).toBe(200);
  });

  it('renames and regenerates in one call', async () => {
    const { teacher, klass } = await seedClassroom(db, 'regen-rename');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const before = (await get(token, `/v1/classes/${klass.id}`)).json<ClassDetail>();

    const res = await patch(token, `/v1/classes/${klass.id}`, {
      name: 'Both',
      regenerateCode: true,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ClassDetail>();
    expect(body.name).toBe('Both');
    expect(body.joinCode).not.toBe(before.joinCode);
  });

  it('rejects an empty patch (400)', async () => {
    const { teacher, klass } = await seedClassroom(db, 'patch-empty');
    const res = await patch(await ctx.tokenFor(teacher.cognitoId), `/v1/classes/${klass.id}`, {});
    expect(res.statusCode).toBe(400);
  });

  it('another teacher cannot patch it (403)', async () => {
    const { klass } = await seedClassroom(db, 'patch-a');
    const other = await seedClassroom(db, 'patch-b');
    const res = await patch(
      await ctx.tokenFor(other.teacher.cognitoId),
      `/v1/classes/${klass.id}`,
      {
        name: 'Nope',
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('a student cannot patch a class (403)', async () => {
    const { klass, student } = await seedClassroom(db, 'patch-student');
    const res = await patch(await ctx.tokenFor(student.cognitoId), `/v1/classes/${klass.id}`, {
      name: 'Nope',
    });
    expect(res.statusCode).toBe(403);
  });

  it('is a 404 for an unknown class', async () => {
    const { teacher } = await seedClassroom(db, 'patch-404');
    const res = await patch(await ctx.tokenFor(teacher.cognitoId), `/v1/classes/${randomUUID()}`, {
      name: 'Nope',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('every route under /v1/classes/:id', () => {
  /** What a route must be sent, beside the class's id, to reach its class. */
  const BODIES: Record<string, object> = {
    'PATCH /v1/classes/:id': { name: 'Renamed' },
    'POST /v1/classes/:id/sessions': { durationMinutes: 25 },
  };

  it('answers an unknown class 404 class_not_found: one condition, one shape (R3)', async () => {
    const { teacher } = await seedClassroom(db, 'unknown-class');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const routes = (await routeTable())
      .map((route) => `${String(route.method)} ${route.url}`)
      .filter((key) => key.includes(' /v1/classes/:id') && !key.startsWith('HEAD '));
    // The filter matches the routes there are today, so it can't quietly match none.
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /v1/classes/:id',
        'PATCH /v1/classes/:id',
        'GET /v1/classes/:id/roster',
        'POST /v1/classes/:id/sessions',
        'GET /v1/classes/:id/reports/sessions',
        'GET /v1/classes/:id/reports/sessions/:sessionId',
      ]),
    );
    for (const key of routes) {
      const [method, url] = key.split(' ') as [InjectOptions['method'], string];
      const res = await ctx.app.inject({
        method,
        // Every id in the path unknown, the class's included.
        url: url.replace(/:\w+/g, () => randomUUID()),
        headers: { authorization: `Bearer ${token}` },
        payload: BODIES[key],
      });
      expect(res.statusCode, `${key} (a 400: the route needs a body in BODIES)`).toBe(404);
      expect(res.json<ApiErrorBody>().error, key).toMatchObject({
        code: 'not_found',
        reason: 'class_not_found',
      });
    }
  });
});
