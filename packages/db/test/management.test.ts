import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBlock, createClass, generateJoinCode, updateClass } from '../src/management.js';
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
  it('registers a tag, then refuses the same active tag', async () => {
    const { teacherId } = await makeTeacher('cb-basic');
    const first = await createBlock(db, { teacherId, tagId: 'CB-TAG-1' });
    expect(first.outcome).toBe('registered');

    const again = await createBlock(db, { teacherId, tagId: 'CB-TAG-1' });
    expect(again.outcome).toBe('tag_taken');

    // Exactly one active block owns the tag.
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
});
