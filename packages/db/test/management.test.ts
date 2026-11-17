import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createBlock,
  createClass,
  findBlock,
  generateJoinCode,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  listBlocks,
  removeBlock,
  updateClass,
} from '../src/management.js';
import { newUuidV7 } from '../src/ids.js';
import { blocks, classes, schools, users } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

const JOIN_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('expected exactly one row');
  return row;
}

async function makeTeacher(tag: string): Promise<{ schoolId: string; teacherId: string }> {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `S ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `t-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  return { schoolId: school.id, teacherId: teacher.id };
}

async function classById(id: string) {
  return one(await db.select().from(classes).where(eq(classes.id, id)));
}

/**
 * A deterministic stand-in for `generateJoinCode`, so a test can force the exact
 * collision-then-success sequence the retry loops are meant to survive.
 */
function sequence(...values: string[]): () => string {
  const iter = values[Symbol.iterator]();
  return () => {
    const next = iter.next();
    if (next.done) throw new Error('join-code sequence exhausted');
    return next.value;
  };
}

describe('generateJoinCode', () => {
  it('is six characters from the unambiguous alphabet, never 0/O/1/I/L', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateJoinCode();
      expect(code).toMatch(JOIN_CODE);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('mints upper-case only, so every stored code is one a route can match', () => {
    // The routes upper-case a typed code and match it exactly; this generator
    // is the only writer of `classes.join_code`, so its alphabet is the
    // invariant — asserted whole, not sampled.
    expect(JOIN_CODE_ALPHABET).toBe(JOIN_CODE_ALPHABET.toUpperCase());
    expect(JOIN_CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
    expect(JOIN_CODE_LENGTH).toBe(6);
  });
});

describe('createClass', () => {
  it('creates a class with a valid, server-set join code', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-basic');
    const klass = await createClass(db, { teacherId, schoolId, name: 'Algebra' });
    expect(klass.name).toBe('Algebra');
    expect(klass.teacherId).toBe(teacherId);
    expect(klass.joinCode).toMatch(JOIN_CODE);
    expect(klass.removedAt).toBeNull();
  });

  it('hands out distinct active join codes across many creates', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-many');
    const codes = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const klass = await createClass(db, { teacherId, schoolId, name: `C${i}` });
      codes.add(klass.joinCode);
    }
    expect(codes.size).toBe(25);
  });

  it('retries past a taken join code and never duplicates it', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-retry');
    const taken = 'ZZZZ22';
    await createClass(db, { teacherId, schoolId, name: 'holder' }, () => taken);
    // The next create mints the taken code first (a forced collision), then a free one.
    const klass = await createClass(
      db,
      { teacherId, schoolId, name: 'newcomer' },
      sequence(taken, 'ZZZZ33'),
    );
    expect(klass.joinCode).toBe('ZZZZ33');
    // The collision produced no second live class holding the taken code.
    const live = await db
      .select()
      .from(classes)
      .where(and(eq(classes.joinCode, taken), isNull(classes.removedAt)));
    expect(live).toHaveLength(1);
  });
});

describe('createClass with an eventId (2026-10-23)', () => {
  const classesOf = (teacherId: string) =>
    db.select().from(classes).where(eq(classes.teacherId, teacherId));

  it('keeps the id, and a resend of it, in either letter case, is the class it made, never a second', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-id-replay');
    const eventId = newUuidV7();
    const made = await createClass(db, { teacherId, schoolId, name: 'Algebra', eventId });
    expect(made.eventId).toBe(eventId);
    const again = await createClass(db, { teacherId, schoolId, name: 'Algebra', eventId });
    const upper = eventId.toUpperCase();
    const shouted = await createClass(db, { teacherId, schoolId, name: 'Algebra', eventId: upper });
    expect(again).toEqual(made);
    expect(shouted).toEqual(made);
    expect(await classesOf(teacherId)).toEqual([made]);
  });

  it('answers a resend with the class as it is now, whatever name the resend carries', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-id-now');
    const eventId = newUuidV7();
    const made = await createClass(db, { teacherId, schoolId, name: 'Old', eventId });
    const now = await updateClass(db, { classId: made.id, name: 'New', regenerateCode: true });
    const again = await createClass(db, { teacherId, schoolId, name: 'Typed again', eventId });
    expect(again).toEqual(now);
    expect(again.name).toBe('New');
    expect(await classesOf(teacherId)).toHaveLength(1);
  });

  it('refuses another teacher’s id as EVENT_ID_CONFLICT, making nothing', async () => {
    const owner = await makeTeacher('cc-id-owner');
    const other = await makeTeacher('cc-id-other');
    const eventId = newUuidV7();
    await createClass(db, { ...owner, name: 'Mine', eventId });
    for (const id of [eventId, eventId.toUpperCase()]) {
      await expect(
        createClass(db, { ...other, name: 'Theirs', eventId: id }),
      ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    }
    expect(await classesOf(other.teacherId)).toEqual([]);
  });

  it('still takes a fresh join code past a taken one, the id kept', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-id-code');
    await createClass(db, { teacherId, schoolId, name: 'holder' }, () => 'XXXX22');
    const eventId = newUuidV7();
    const input = { teacherId, schoolId, name: 'newcomer', eventId };
    const klass = await createClass(db, input, sequence('XXXX22', 'XXXX33'));
    expect(klass).toMatchObject({ joinCode: 'XXXX33', eventId });
  });

  it('without one, makes a class at every call, as before', async () => {
    const { teacherId, schoolId } = await makeTeacher('cc-no-id');
    const first = await createClass(db, { teacherId, schoolId, name: 'Same' });
    const second = await createClass(db, { teacherId, schoolId, name: 'Same' });
    expect(first.eventId).toBeNull();
    expect(second.id).not.toBe(first.id);
    expect(await classesOf(teacherId)).toHaveLength(2);
  });
});

describe('updateClass', () => {
  it('renames without touching the join code', async () => {
    const { teacherId, schoolId } = await makeTeacher('uc-rename');
    const klass = await createClass(db, { teacherId, schoolId, name: 'Old' });
    const updated = await updateClass(db, { classId: klass.id, name: 'New' });
    expect(updated?.name).toBe('New');
    expect(updated?.joinCode).toBe(klass.joinCode);
    expect((await classById(klass.id)).name).toBe('New');
  });

  it('regenerates the join code without touching the name', async () => {
    const { teacherId, schoolId } = await makeTeacher('uc-regen');
    const klass = await createClass(db, { teacherId, schoolId, name: 'Keep' });
    const updated = await updateClass(db, { classId: klass.id, regenerateCode: true });
    expect(updated?.name).toBe('Keep');
    expect(updated?.joinCode).not.toBe(klass.joinCode);
    expect(updated?.joinCode).toMatch(JOIN_CODE);
  });

  it('renames and regenerates in one write', async () => {
    const { teacherId, schoolId } = await makeTeacher('uc-both');
    const klass = await createClass(db, { teacherId, schoolId, name: 'Before' });
    const updated = await updateClass(db, {
      classId: klass.id,
      name: 'After',
      regenerateCode: true,
    });
    expect(updated?.name).toBe('After');
    expect(updated?.joinCode).not.toBe(klass.joinCode);
  });

  it('a no-op update leaves the class unchanged', async () => {
    const { teacherId, schoolId } = await makeTeacher('uc-noop');
    const klass = await createClass(db, { teacherId, schoolId, name: 'Same' });
    const updated = await updateClass(db, { classId: klass.id });
    expect(updated?.name).toBe('Same');
    expect(updated?.joinCode).toBe(klass.joinCode);
  });

  it('returns undefined for a class that does not exist', async () => {
    const updated = await updateClass(db, { classId: newUuidV7(), name: 'Ghost' });
    expect(updated).toBeUndefined();
  });

  it('regenerate retries past a taken join code', async () => {
    const { teacherId, schoolId } = await makeTeacher('uc-retry');
    const holder = await createClass(db, { teacherId, schoolId, name: 'holder' }, () => 'YYYY22');
    const target = await createClass(db, { teacherId, schoolId, name: 'target' });
    // Regenerate mints the holder's code first (a forced collision -> 23505 -> retry),
    // then a free one.
    const updated = await updateClass(
      db,
      { classId: target.id, regenerateCode: true },
      sequence('YYYY22', 'YYYY33'),
    );
    expect(updated?.joinCode).toBe('YYYY33');
    // The holder still owns the contested code.
    expect((await classById(holder.id)).joinCode).toBe('YYYY22');
  });
});

describe('createBlock', () => {
  it('registers a tag, and hands the same teacher back their own block on a retry', async () => {
    // A lost response is the ordinary way here: the teacher's block WAS
    // registered, they just never saw the 200. Answering `tag_taken` to the
    // holder of the tag is advice they cannot act on — they cannot free a tag
    // they already own — so the retry re-reads and returns it, the way
    // startSession hands back the running session instead of refusing a
    // duplicate start.
    const { teacherId } = await makeTeacher('cb-basic');
    const first = await createBlock(db, { teacherId, tagId: 'CB-TAG-1' });
    if (first.outcome !== 'registered') throw new Error(`registered, got ${first.outcome}`);

    const again = await createBlock(db, { teacherId, tagId: 'CB-TAG-1' });
    expect(again.outcome).toBe('already_registered');
    if (again.outcome !== 'already_registered') throw new Error('unreachable');
    expect(again.block.id).toBe(first.block.id);

    // Still exactly one block owning the tag — the replay created none.
    const rows = await db.select().from(blocks).where(eq(blocks.tagId, 'CB-TAG-1'));
    expect(rows).toHaveLength(1);
  });

  it('a tag is owned globally, not per teacher', async () => {
    const a = await makeTeacher('cb-a');
    const b = await makeTeacher('cb-b');
    expect((await createBlock(db, { teacherId: a.teacherId, tagId: 'CB-SHARED' })).outcome).toBe(
      'registered',
    );
    expect((await createBlock(db, { teacherId: b.teacherId, tagId: 'CB-SHARED' })).outcome).toBe(
      'tag_taken',
    );
  });

  it('never hands a teacher their own REMOVED block while another teacher holds the tag', async () => {
    // The re-read after a lost insert must look at the LIVE holder only. A
    // tag can be re-registered once its block is soft-removed, so teacher A's
    // dead block and teacher B's live one can share it; without the
    // `removed_at IS NULL` filter the read could pick A's dead row and answer
    // `already_registered`, handing A a removed block and hiding B's claim.
    const a = await makeTeacher('cb-dead-a');
    const b = await makeTeacher('cb-dead-b');
    const dead = await createBlock(db, { teacherId: a.teacherId, tagId: 'CB-TAG-DEAD' });
    if (dead.outcome !== 'registered') throw new Error(`registered, got ${dead.outcome}`);
    await removeBlock(db, { blockId: dead.block.id, eventId: newUuidV7() });
    expect((await createBlock(db, { teacherId: b.teacherId, tagId: 'CB-TAG-DEAD' })).outcome).toBe(
      'registered',
    );

    expect((await createBlock(db, { teacherId: a.teacherId, tagId: 'CB-TAG-DEAD' })).outcome).toBe(
      'tag_taken',
    );
  });
});

describe('listBlocks', () => {
  it("lists a teacher's live blocks, oldest first, and no one else's", async () => {
    const a = await makeTeacher('lb-a');
    const b = await makeTeacher('lb-b');
    const first = await createBlock(db, { teacherId: a.teacherId, tagId: 'LB-TAG-1' });
    const second = await createBlock(db, { teacherId: a.teacherId, tagId: 'LB-TAG-2' });
    const gone = await createBlock(db, { teacherId: a.teacherId, tagId: 'LB-TAG-3' });
    await createBlock(db, { teacherId: b.teacherId, tagId: 'LB-TAG-B' });
    if (first.outcome !== 'registered' || second.outcome !== 'registered') throw new Error('seed');
    if (gone.outcome !== 'registered') throw new Error('seed');
    await removeBlock(db, { blockId: gone.block.id, eventId: newUuidV7() });

    const listed = await listBlocks(db, a.teacherId);
    expect(listed.map((block) => block.tagId)).toEqual(['LB-TAG-1', 'LB-TAG-2']);
    expect(await listBlocks(db, (await makeTeacher('lb-none')).teacherId)).toEqual([]);
  });
});

describe('removeBlock (LO10b)', () => {
  /** A teacher's block, registered: its row. */
  async function aBlock(tag: string, teacherId?: string) {
    teacherId ??= (await makeTeacher(tag)).teacherId;
    const made = await createBlock(db, { teacherId, tagId: `RB-${tag}` });
    if (made.outcome !== 'registered') throw new Error(`registered, got ${made.outcome}`);
    return made.block;
  }

  const rowOf = async (id: string) => one(await db.select().from(blocks).where(eq(blocks.id, id)));

  it('marks the block removed, never deleted, at the clock it is given, under its eventId', async () => {
    const block = await aBlock('rb-basic');
    const now = new Date('2026-11-17T15:00:00Z');
    const eventId = newUuidV7();

    const removed = await removeBlock(db, { blockId: block.id, eventId, now });
    expect(removed).toEqual({
      outcome: 'removed',
      block: { ...block, removedAt: now, removedEventId: eventId },
    });
    expect(await rowOf(block.id)).toEqual({ ...block, removedAt: now, removedEventId: eventId });
    expect(await listBlocks(db, block.teacherId)).toEqual([]);
  });

  it('a resend under its id, in either case, is a replay: the block as it is, nothing written', async () => {
    const block = await aBlock('rb-replay');
    const eventId = newUuidV7();
    const first = await removeBlock(db, { blockId: block.id, eventId });
    if (first.outcome !== 'removed') throw new Error(`removed, got ${first.outcome}`);

    for (const resent of [eventId, eventId.toUpperCase()]) {
      const later = new Date(Date.now() + 60_000);
      expect(await removeBlock(db, { blockId: block.id, eventId: resent, now: later })).toEqual({
        outcome: 'replay',
        block: first.block,
      });
    }
    expect(await rowOf(block.id)).toEqual(first.block);
  });

  it('removed twice, under a new id: a replay too, the first removal kept as it was', async () => {
    // Two tabs of the portal, each pressing Remove: the second finds it removed already, the truth.
    const block = await aBlock('rb-twice');
    const first = await removeBlock(db, { blockId: block.id, eventId: newUuidV7() });
    if (first.outcome !== 'removed') throw new Error(`removed, got ${first.outcome}`);

    const second = await removeBlock(db, { blockId: block.id, eventId: newUuidV7() });
    expect(second).toEqual({ outcome: 'replay', block: first.block });
    expect(await rowOf(block.id)).toEqual(first.block);
  });

  it("an id another block's removal holds is EVENT_ID_CONFLICT, in either case, and removes nothing", async () => {
    const teacher = await makeTeacher('rb-spent');
    const gone = await aBlock('rb-spent-1', teacher.teacherId);
    const live = await aBlock('rb-spent-2', teacher.teacherId);
    const eventId = newUuidV7();
    await removeBlock(db, { blockId: gone.id, eventId });

    for (const spent of [eventId, eventId.toUpperCase()]) {
      await expect(removeBlock(db, { blockId: live.id, eventId: spent })).rejects.toMatchObject({
        code: 'EVENT_ID_CONFLICT',
      });
    }
    expect(await rowOf(live.id)).toEqual(live);
  });

  it('no block with the id is block_not_found, and writes nothing', async () => {
    expect(await removeBlock(db, { blockId: newUuidV7(), eventId: newUuidV7() })).toEqual({
      outcome: 'block_not_found',
    });
  });

  it('frees the tag: registered again at once, by its teacher or another, as a new block', async () => {
    // The owner's "Free the code" (2026-11-17): `blocks_tag_active_unique` holds live rows only.
    const a = await makeTeacher('rb-free-a');
    const b = await makeTeacher('rb-free-b');
    const lost = await aBlock('rb-free', a.teacherId);
    await removeBlock(db, { blockId: lost.id, eventId: newUuidV7() });

    const again = await createBlock(db, { teacherId: a.teacherId, tagId: lost.tagId });
    if (again.outcome !== 'registered') throw new Error(`registered, got ${again.outcome}`);
    expect(again.block.id).not.toBe(lost.id);
    expect((await rowOf(lost.id)).removedAt).not.toBeNull();
    expect(await listBlocks(db, a.teacherId)).toEqual([again.block]);

    // Removed again, and another teacher's now: their own new block, a third row with the tag.
    await removeBlock(db, { blockId: again.block.id, eventId: newUuidV7() });
    const theirs = await createBlock(db, { teacherId: b.teacherId, tagId: lost.tagId });
    if (theirs.outcome !== 'registered') throw new Error(`registered, got ${theirs.outcome}`);
    expect(await listBlocks(db, b.teacherId)).toEqual([theirs.block]);
    expect(await listBlocks(db, a.teacherId)).toEqual([]);
    expect(await db.select().from(blocks).where(eq(blocks.tagId, lost.tagId))).toHaveLength(3);
    expect(
      await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.tagId, lost.tagId), isNull(blocks.removedAt))),
    ).toEqual([theirs.block]);
  });

  it('findBlock reads a block live or removed, and none for an id no block has', async () => {
    const block = await aBlock('rb-find');
    expect(await findBlock(db, block.id)).toEqual(block);
    const removed = await removeBlock(db, { blockId: block.id, eventId: newUuidV7() });
    if (removed.outcome !== 'removed') throw new Error(`removed, got ${removed.outcome}`);
    expect(await findBlock(db, block.id)).toEqual(removed.block);
    expect(await findBlock(db, newUuidV7())).toBeUndefined();
  });
});
