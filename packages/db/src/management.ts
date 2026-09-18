import { randomInt } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { findClassById } from './queries.js';
import { blocks, classes } from './schema.js';
import type { Database } from './types.js';

/*
 * Class and block administration — the teacher-facing writes that create and
 * rename classes and register NFC tags. These deliberately sit BESIDE the
 * transition engine, not inside it: they never touch `participations` or
 * `events`, so they need none of the engine's session locking or event
 * bookkeeping. The engine stays the sole writer of those two tables.
 */

type ClassRow = typeof classes.$inferSelect;
type BlockRow = typeof blocks.$inferSelect;

/**
 * Join codes are short and human-typed, so the alphabet drops every visually
 * ambiguous character: no 0/O, no 1/I/L. 31 symbols over 6 places is ~887M
 * codes — collisions are rare, and the active-unique index plus the retry below
 * make a collision a no-op rather than a failure.
 */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
/** Bounded so a broken database can never spin here forever. */
const JOIN_CODE_ATTEMPTS = 8;

/** A fresh random join code from the unambiguous alphabet (unbiased selection). */
export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/** Only live classes reserve their join code, so ON CONFLICT arbitrates on the partial index. */
const activeClass = sql`${classes.removedAt} is null`;

/**
 * A Postgres unique violation (SQLSTATE 23505). `classes` has exactly one unique
 * constraint — the active join-code index — so a 23505 from an UPDATE that set a
 * new join code is always a code collision, and the regenerate loop retries with
 * a fresh code. (INSERT uses ON CONFLICT DO NOTHING instead and never throws
 * here.) Drizzle wraps the driver error, so the code sits on a nested cause.
 */
function isJoinCodeCollision(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

/**
 * Create a class for a teacher with a unique, server-generated join code. The
 * insert uses ON CONFLICT DO NOTHING on the active join-code index: a code
 * collision returns no row and we try a fresh code — so two concurrent creates
 * that happen to mint the same code can never both win (the index arbitrates,
 * not a read-then-write). Exhausting the bounded attempts is effectively
 * impossible and surfaces as a 500 rather than a silent bad state.
 */
export async function createClass(
  db: Database,
  input: { teacherId: string; schoolId: string; name: string },
): Promise<ClassRow> {
  for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
    const [row] = await db
      .insert(classes)
      .values({
        teacherId: input.teacherId,
        schoolId: input.schoolId,
        name: input.name,
        joinCode: generateJoinCode(),
      })
      .onConflictDoNothing({ target: classes.joinCode, where: activeClass })
      .returning();
    if (row) return row;
  }
  throw new Error('createClass: could not allocate a unique join code');
}

/**
 * Rename a class and/or regenerate its join code. The caller (the route) has
 * already loaded the class and checked ownership, so a missing/removed row here
 * returns undefined for the route to 404. A regenerate retries on the rare
 * join-code collision; a rename-only update is a single write.
 */
export async function updateClass(
  db: Database,
  input: { classId: string; name?: string; regenerateCode?: boolean },
): Promise<ClassRow | undefined> {
  const rename: { name?: string } = {};
  if (input.name !== undefined) rename.name = input.name;

  if (input.regenerateCode !== true) {
    // Nothing to change (the route guarantees at least one field, but stay honest).
    if (rename.name === undefined) return findClassById(db, input.classId);
    const [row] = await db
      .update(classes)
      .set(rename)
      .where(and(eq(classes.id, input.classId), isNull(classes.removedAt)))
      .returning();
    return row;
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const [row] = await db
        .update(classes)
        .set({ ...rename, joinCode: generateJoinCode() })
        .where(and(eq(classes.id, input.classId), isNull(classes.removedAt)))
        .returning();
      return row;
    } catch (err) {
      if (!isJoinCodeCollision(err) || attempt >= JOIN_CODE_ATTEMPTS - 1) throw err;
    }
  }
}

export type CreateBlockResult =
  { outcome: 'registered'; block: BlockRow } | { outcome: 'tag_taken' };

/**
 * Register a physical NFC tag to a teacher. One active block owns a tag at a
 * time (a tag can be re-registered only after its block is soft-removed), so a
 * tag already held by a live block returns `tag_taken` for the route to 409.
 * ON CONFLICT DO NOTHING on the active-tag index makes this race-safe: two
 * simultaneous registrations of the same tag yield exactly one live block.
 */
export async function createBlock(
  db: Database,
  input: { teacherId: string; tagId: string },
): Promise<CreateBlockResult> {
  const [row] = await db
    .insert(blocks)
    .values({ tagId: input.tagId, teacherId: input.teacherId })
    .onConflictDoNothing({ target: blocks.tagId, where: sql`${blocks.removedAt} is null` })
    .returning();
  if (!row) return { outcome: 'tag_taken' };
  return { outcome: 'registered', block: row };
}
