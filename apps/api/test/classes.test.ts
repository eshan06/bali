import { type Database, users } from '@bali/db';
import type { ClassDetail, EnrollmentJoinResponse } from '@bali/shared';
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
