import type { Database } from '@bali/db';
import type { BlockDetail } from '@bali/shared';
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

function register(token: string, tagId: string) {
  return authedInject(ctx.app, token, { method: 'POST', url: '/v1/blocks', payload: { tagId } });
}

describe('POST /v1/blocks', () => {
  it('a teacher registers a tag to themselves', async () => {
    const { teacher } = await seedClassroom(db, 'block');
    const res = await register(await ctx.tokenFor(teacher.cognitoId), 'NEW-TAG-1');
    expect(res.statusCode).toBe(200);
    const body = res.json<BlockDetail>();
    expect(body.tagId).toBe('NEW-TAG-1');
    expect(typeof body.id).toBe('string');
  });

  it('registering an already-active tag is a 409 (same teacher)', async () => {
    const { teacher } = await seedClassroom(db, 'block-dup');
    const token = await ctx.tokenFor(teacher.cognitoId);
    expect((await register(token, 'DUP-TAG')).statusCode).toBe(200);
    expect((await register(token, 'DUP-TAG')).statusCode).toBe(409);
  });

  it("a tag is owned globally: another teacher can't claim a live one (409)", async () => {
    const a = await seedClassroom(db, 'block-owner');
    const b = await seedClassroom(db, 'block-thief');
    expect((await register(await ctx.tokenFor(a.teacher.cognitoId), 'SHARED-TAG')).statusCode).toBe(
      200,
    );
    expect((await register(await ctx.tokenFor(b.teacher.cognitoId), 'SHARED-TAG')).statusCode).toBe(
      409,
    );
  });

  it('the seeded block reserves its tag (409 on re-register)', async () => {
    const { teacher, block } = await seedClassroom(db, 'block-seeded');
    const res = await register(await ctx.tokenFor(teacher.cognitoId), block.tagId);
    expect(res.statusCode).toBe(409);
  });

  it('a student cannot register a block (403)', async () => {
    const { student } = await seedClassroom(db, 'block-student');
    const res = await register(await ctx.tokenFor(student.cognitoId), 'STUDENT-TAG');
    expect(res.statusCode).toBe(403);
  });

  it('an unknown caller cannot register a block (403)', async () => {
    const res = await register(await ctx.tokenFor('ghost'), 'GHOST-TAG');
    expect(res.statusCode).toBe(403);
  });

  it('rejects a blank tag (400)', async () => {
    const { teacher } = await seedClassroom(db, 'block-blank');
    const res = await register(await ctx.tokenFor(teacher.cognitoId), '   ');
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/blocks',
      payload: { tagId: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});
