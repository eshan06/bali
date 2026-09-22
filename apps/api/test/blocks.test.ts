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

  it('re-registering your own tag returns your block, not a 409', async () => {
    // The ordinary way to get here is a retry of a request whose response was
    // lost: the block exists, the teacher never saw it. A 409 would be advice
    // they cannot act on, since they cannot free a tag they already hold.
    // A /v1 409 -> 200, ruled in by the owner on 2026-09-22 (ARCHITECTURE,
    // API decision 2: a wrong answer may be corrected in place).
    const { teacher } = await seedClassroom(db, 'block-dup');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const first = await register(token, 'DUP-TAG');
    expect(first.statusCode).toBe(200);

    const retry = await register(token, 'DUP-TAG');
    expect(retry.statusCode).toBe(200);
    // The same block, not a second one — the replay registered nothing.
    expect(retry.json<BlockDetail>().id).toBe(first.json<BlockDetail>().id);
    expect(retry.json<BlockDetail>()).toEqual(first.json<BlockDetail>());
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

  it('re-registering a seeded tag hands its own teacher the seeded block back', async () => {
    const { teacher, block } = await seedClassroom(db, 'block-seeded');
    const res = await register(await ctx.tokenFor(teacher.cognitoId), block.tagId);
    expect(res.statusCode).toBe(200);
    expect(res.json<BlockDetail>().id).toBe(block.id);
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
