import { blocks, type Database, newUuidV7, startSession } from '@bali/db';
import type {
  BlockDetail,
  BlockListResponse,
  CheckInResponse,
  RemoveBlockResponse,
  SessionSnapshot,
  TapResponse,
  UnlockResponse,
} from '@bali/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** The server's clock: now, unless a test moves it. */
let now: Date | undefined;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  now = undefined;
  ctx = await makeAuthedApp(db, () => now ?? new Date());
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

function register(token: string, tagId: string) {
  return authedInject(ctx.app, token, { method: 'POST', url: '/v1/blocks', payload: { tagId } });
}

function list(token: string, url = '/v1/blocks') {
  return authedInject(ctx.app, token, { method: 'GET', url });
}

/** `DELETE /v1/blocks/:id`, under a fresh eventId unless the body says otherwise. */
function remove(token: string, id: string, payload: object = { eventId: newUuidV7() }) {
  return authedInject(ctx.app, token, { method: 'DELETE', url: `/v1/blocks/${id}`, payload });
}

/** The block's row as it stands. */
async function rowOf(id: string) {
  const [row] = await db.select().from(blocks).where(eq(blocks.id, id));
  if (!row) throw new Error(`no block ${id}`);
  return row;
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

describe('GET /v1/blocks', () => {
  it("lists the teacher's own live blocks, oldest first, with what a register answers", async () => {
    const { teacher, block } = await seedClassroom(db, 'list');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const added = (await register(token, 'LIST-TAG-2')).json<BlockDetail>();

    const res = await list(token);
    expect(res.statusCode).toBe(200);
    expect(res.json<BlockListResponse>()).toEqual({
      blocks: [
        { id: block.id, tagId: block.tagId, createdAt: block.createdAt.toISOString() },
        added,
      ],
    });
  });

  it("never lists another teacher's block, nor a removed one", async () => {
    const mine = await seedClassroom(db, 'list-mine');
    const theirs = await seedClassroom(db, 'list-theirs');
    const token = await ctx.tokenFor(mine.teacher.cognitoId);
    expect((await remove(token, mine.block.id)).statusCode).toBe(200);

    const res = await list(token);
    expect(res.statusCode).toBe(200);
    expect(res.json<BlockListResponse>()).toEqual({ blocks: [] });
    expect(res.body).not.toContain(theirs.block.id);
  });

  it('a stray query changes nothing: the read takes no input', async () => {
    const { teacher, block } = await seedClassroom(db, 'list-query');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const res = await list(token, `/v1/blocks?teacherId=${block.teacherId}&tagId=OTHER`);
    expect(res.statusCode).toBe(200);
    expect(res.json<BlockListResponse>().blocks.map((b) => b.id)).toEqual([block.id]);
  });

  it('a student has no blocks to read (403), nor does an unknown caller', async () => {
    const { student } = await seedClassroom(db, 'list-student');
    expect((await list(await ctx.tokenFor(student.cognitoId))).statusCode).toBe(403);
    expect((await list(await ctx.tokenFor('ghost'))).statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/blocks' })).statusCode).toBe(401);
  });
});

describe('DELETE /v1/blocks/:id (LO10b)', () => {
  it('a teacher removes their own block: answered removed, listed no more, its row kept', async () => {
    const { teacher, block } = await seedClassroom(db, 'remove');
    const token = await ctx.tokenFor(teacher.cognitoId);
    now = new Date('2026-11-17T15:00:00Z');
    const eventId = newUuidV7();

    const res = await remove(token, block.id, { eventId });
    expect(res.statusCode).toBe(200);
    const detail = { id: block.id, tagId: block.tagId, createdAt: block.createdAt.toISOString() };
    expect(res.json<RemoveBlockResponse>()).toEqual({ outcome: 'removed', block: detail });
    // Marked removed at the server's clock, under the removal's id, never deleted (decision 3).
    expect(await rowOf(block.id)).toEqual({ ...block, removedAt: now, removedEventId: eventId });
    expect((await list(token)).json<BlockListResponse>()).toEqual({ blocks: [] });
  });

  it('resent under its eventId, in either case, is a replay: the block as it is, nothing written', async () => {
    const { teacher, block } = await seedClassroom(db, 'remove-replay');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const eventId = newUuidV7();
    const first = await remove(token, block.id, { eventId });
    expect(first.statusCode).toBe(200);
    const removed = await rowOf(block.id);

    for (const resent of [eventId, eventId.toUpperCase()]) {
      now = new Date(Date.now() + 60_000);
      const again = await remove(token, block.id, { eventId: resent });
      expect(again.statusCode).toBe(200);
      expect(again.json<RemoveBlockResponse>()).toEqual({
        ...first.json<RemoveBlockResponse>(),
        outcome: 'replay',
      });
    }
    expect(await rowOf(block.id)).toEqual(removed);
  });

  it('removed twice, the second under a new id: a replay, the truth now, the first kept', async () => {
    // Remove pressed in two tabs: the second finds the block removed already.
    const { teacher, block } = await seedClassroom(db, 'remove-twice');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const first = await remove(token, block.id);
    const removed = await rowOf(block.id);

    const second = await remove(token, block.id);
    expect(second.statusCode).toBe(200);
    expect(second.json<RemoveBlockResponse>()).toEqual({
      ...first.json<RemoveBlockResponse>(),
      outcome: 'replay',
    });
    expect(await rowOf(block.id)).toEqual(removed);
  });

  it("another teacher's block is 403, live or removed, and is left as it was", async () => {
    const owner = await seedClassroom(db, 'remove-owner');
    const colleague = await seedClassroom(db, 'remove-colleague', owner.school);
    const stranger = await seedClassroom(db, 'remove-stranger');
    for (const other of [colleague, stranger]) {
      const res = await remove(await ctx.tokenFor(other.teacher.cognitoId), owner.block.id);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(owner.block.tagId);
    }
    expect(await rowOf(owner.block.id)).toEqual(owner.block);

    // Removed by its teacher, it is still not theirs to replay or to read.
    const ownerToken = await ctx.tokenFor(owner.teacher.cognitoId);
    expect((await remove(ownerToken, owner.block.id)).statusCode).toBe(200);
    const removed = await rowOf(owner.block.id);
    const late = await remove(await ctx.tokenFor(colleague.teacher.cognitoId), owner.block.id);
    expect(late.statusCode).toBe(403);
    expect(late.body).not.toContain(owner.block.tagId);
    expect(await rowOf(owner.block.id)).toEqual(removed);
  });

  it('a student, or a caller with no account, is 403, and removes nothing', async () => {
    const { student, block } = await seedClassroom(db, 'remove-student');
    expect((await remove(await ctx.tokenFor(student.cognitoId), block.id)).statusCode).toBe(403);
    expect((await remove(await ctx.tokenFor('ghost'), block.id)).statusCode).toBe(403);
    expect(await rowOf(block.id)).toEqual(block);
  });

  it('requires authentication', async () => {
    const { block } = await seedClassroom(db, 'remove-anon');
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/blocks/${block.id}`,
      payload: { eventId: newUuidV7() },
    });
    expect(res.statusCode).toBe(401);
    expect(await rowOf(block.id)).toEqual(block);
  });

  it('an id no block has is 404', async () => {
    const { teacher } = await seedClassroom(db, 'remove-unknown');
    const res = await remove(await ctx.tokenFor(teacher.cognitoId), newUuidV7());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it.each([
    ['an id that is no uuid', 'not-a-uuid', { eventId: 'x' }],
    ['no eventId', undefined, {}],
    ['an eventId that is no uuid', undefined, { eventId: 'nope' }],
    ['an eventId that is no UUIDv7', undefined, { eventId: randomUUID() }],
  ] as const)('%s is 400, and removes nothing', async (_, id, payload) => {
    const { teacher, block } = await seedClassroom(db, 'remove-invalid');
    const res = await remove(await ctx.tokenFor(teacher.cognitoId), id ?? block.id, payload);
    expect(res.statusCode).toBe(400);
    expect(await rowOf(block.id)).toEqual(block);
  });

  it("an eventId another block's removal holds is 409 event_id_conflict, and removes nothing", async () => {
    const { teacher, block } = await seedClassroom(db, 'remove-spent');
    const token = await ctx.tokenFor(teacher.cognitoId);
    const second = (await register(token, 'REMOVE-SPENT-2')).json<BlockDetail>();
    const eventId = newUuidV7();
    expect((await remove(token, block.id, { eventId })).statusCode).toBe(200);

    for (const spent of [eventId, eventId.toUpperCase()]) {
      const res = await remove(token, second.id, { eventId: spent });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: { code: 'conflict', reason: 'event_id_conflict' },
      });
    }
    expect((await rowOf(second.id)).removedAt).toBeNull();
    expect((await list(token)).json<BlockListResponse>()).toEqual({ blocks: [second] });
  });

  it('frees its code: registered again at once, by its teacher or by another, as a new block', async () => {
    // The owner's "Free the code" (2026-11-17).
    const a = await seedClassroom(db, 'remove-free-a');
    const b = await seedClassroom(db, 'remove-free-b');
    const tokenA = await ctx.tokenFor(a.teacher.cognitoId);
    const tokenB = await ctx.tokenFor(b.teacher.cognitoId);
    // Taken while live: another teacher's claim is the 409 it always was.
    expect((await register(tokenB, a.block.tagId)).statusCode).toBe(409);
    expect((await remove(tokenA, a.block.id)).statusCode).toBe(200);

    const again = await register(tokenA, a.block.tagId);
    expect(again.statusCode).toBe(200);
    const mine = again.json<BlockDetail>();
    expect(mine.tagId).toBe(a.block.tagId);
    expect(mine.id).not.toBe(a.block.id);
    expect((await list(tokenA)).json<BlockListResponse>()).toEqual({ blocks: [mine] });

    // Removed again, and another teacher registers the code: theirs now.
    expect((await remove(tokenA, mine.id)).statusCode).toBe(200);
    const taken = await register(tokenB, a.block.tagId);
    expect(taken.statusCode).toBe(200);
    const theirs = taken.json<BlockDetail>();
    expect(theirs.id).not.toBe(mine.id);
    expect((await list(tokenB)).json<BlockListResponse>().blocks).toContainEqual(theirs);
    expect((await list(tokenA)).json<BlockListResponse>()).toEqual({ blocks: [] });
    // And the first teacher's claim on it is the 409 another teacher's live block gets.
    expect((await register(tokenA, a.block.tagId)).statusCode).toBe(409);
  });

  it("a session of the teacher's running is no refusal: removed, the session runs on to its bell", async () => {
    // A session is its class's, never its block's: the students in it stay in it, their phones'
    // calls naming the session, and only a new tap at the tag finds no block (the plainest answer
    // that strands no one; DECISIONS 2026-11-17, LO10b).
    const { teacher, student, klass, block } = await seedClassroom(db, 'remove-live');
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 25 * 60_000),
    });
    const studentToken = await ctx.tokenFor(student.cognitoId);
    const deviceTime = new Date().toISOString();
    const sent = { tagId: block.tagId, eventId: randomUUID(), deviceTime };
    const tap = (payload: object) =>
      authedInject(ctx.app, studentToken, { method: 'POST', url: '/v1/taps', payload });
    expect((await tap(sent)).json<TapResponse>().outcome).toBe('joined');

    const teacherToken = await ctx.tokenFor(teacher.cognitoId);
    const res = await remove(teacherToken, block.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<RemoveBlockResponse>().outcome).toBe('removed');

    const sessionView = { id: session.id, classId: klass.id, endsAt: session.endsAt.toISOString() };
    // The phone's check-in still finds it live in the session, to its bell.
    const checkIn = await authedInject(ctx.app, studentToken, {
      method: 'POST',
      url: `/v1/sessions/${session.id}/checkin`,
      payload: { deviceTime: new Date().toISOString() },
    });
    expect(checkIn.json<CheckInResponse>()).toEqual({
      status: 'live',
      state: 'focused',
      session: sessionView,
    });
    // The tap's retry is still its retry (tap step 9; LO10a), naming the session it is live in.
    const retried = await tap(sent);
    expect(retried.statusCode).toBe(200);
    expect(retried.json<TapResponse>()).toEqual({
      outcome: 'replay',
      session: sessionView,
      state: 'focused',
    });
    // Emergency Unlock is always allowed, and recorded.
    const unlocked = await authedInject(ctx.app, studentToken, {
      method: 'POST',
      url: `/v1/sessions/${session.id}/unlock`,
      payload: { eventId: randomUUID(), deviceTime: new Date().toISOString() },
    });
    expect(unlocked.statusCode).toBe(200);
    expect(unlocked.json<UnlockResponse>()).toMatchObject({
      outcome: 'applied',
      state: 'unlocked',
    });
    // A new tap at the tag finds no block: the unknown block it would be anywhere.
    expect((await tap({ ...sent, eventId: randomUUID() })).statusCode).toBe(404);
    // And the session itself is untouched: running, to the bell it had.
    const snapshot = await authedInject(ctx.app, teacherToken, {
      method: 'GET',
      url: `/v1/sessions/${session.id}`,
    });
    expect(snapshot.json<SessionSnapshot>()).toMatchObject({ ended: false, session: sessionView });
  });
});
