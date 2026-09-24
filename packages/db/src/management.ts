import { randomInt } from 'node:crypto';

import { JOIN_CODE_LENGTH } from '@bali/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { findClassById } from './queries.js';
import { blocks, classes } from './schema.js';
import { isUniqueViolation } from './sql-errors.js';
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
 *
 * Upper-case only, and load-bearing: the routes upper-case the code a student
 * types (`JoinCode`) and match it exactly, so a stored code is found only if
 * it is upper-case — and this generator is the only thing that stores one.
 * Pinned by a test rather than a CHECK constraint.
 */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/**
 * Every code's length — and so the longest one a route accepts. Its source is
 * `@bali/shared`, where the phone and the portal read the same limit.
 */
export { JOIN_CODE_LENGTH };
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
 * A 23505 out of the regenerate UPDATE is always a join-code collision.
 * Besides the primary key on `id` (which that UPDATE never sets), the active
 * join-code index is the only unique constraint on `classes`, so the loop can
 * safely read one as "try a fresh code". (INSERT uses ON CONFLICT DO NOTHING
 * instead and never throws here.)
 *
 * The cause-chain walk this used to carry is in `sql-errors.ts` now, because
 * the engine had grown its own copy of the same loop for 40P01 and the trap it
 * exists for had to be learned twice. Kept as a named wrapper rather than
 * inlined: the reasoning above is about the unique indexes on `classes`, not
 * about 23505 in general, and it belongs at the loop that depends on it.
 */
function isJoinCodeCollision(err: unknown): boolean {
  return isUniqueViolation(err);
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
  // Injection point for deterministic tests (force a collision); defaults to the
  // real generator, so every production caller behaves identically.
  gen: () => string = generateJoinCode,
): Promise<ClassRow> {
  for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
    const [row] = await db
      .insert(classes)
      .values({
        teacherId: input.teacherId,
        schoolId: input.schoolId,
        name: input.name,
        joinCode: gen(),
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
  // Injection point for deterministic tests (force a collision); defaults to the
  // real generator, so every production caller behaves identically.
  gen: () => string = generateJoinCode,
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
        .set({ ...rename, joinCode: gen() })
        .where(and(eq(classes.id, input.classId), isNull(classes.removedAt)))
        .returning();
      return row;
    } catch (err) {
      if (!isJoinCodeCollision(err) || attempt >= JOIN_CODE_ATTEMPTS - 1) throw err;
    }
  }
}

export type CreateBlockResult =
  | { outcome: 'registered'; block: BlockRow }
  /** A replay: the tag is already registered to THIS teacher, so their own block comes back. */
  | { outcome: 'already_registered'; block: BlockRow }
  | { outcome: 'tag_taken' };

/**
 * Register a physical NFC tag to a teacher. One active block owns a tag at a
 * time (a tag can be re-registered only after its block is soft-removed), so a
 * tag held by ANOTHER teacher's live block returns `tag_taken` for the route to
 * 409. ON CONFLICT DO NOTHING on the active-tag index makes this race-safe: two
 * simultaneous registrations of the same tag yield exactly one live block.
 *
 * A conflict with the caller's OWN block is not a refusal. The usual way to
 * reach it is a retry of a request whose response was lost: the block was
 * registered, the teacher just never saw it. `tag_taken` is advice they cannot
 * act on — they cannot free a tag they already hold — so the second call
 * re-reads and hands back their block, the way `startSession` hands back the
 * running session rather than refusing a duplicate start. On `/v1` that is a
 * 409 -> 200, ruled in by the owner on 2026-09-22 (ARCHITECTURE, API decision
 * 2: a wrong answer may be corrected in place).
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
  if (row) return { outcome: 'registered', block: row };

  // Read the block that won the tag. Not the caller's: the tag really is
  // taken. Nothing at all: the winner was soft-removed between the insert and
  // this read, so the tag is free again and `tag_taken` is briefly false —
  // unreachable today, since nothing outside tests writes `blocks.removed_at`,
  // and settled with the endpoint that removes blocks, next to the
  // block-reassignment follow-up PLAN.md already records.
  const [existing] = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.tagId, input.tagId), isNull(blocks.removedAt)))
    .limit(1);
  if (existing && existing.teacherId === input.teacherId) {
    return { outcome: 'already_registered', block: existing };
  }
  return { outcome: 'tag_taken' };
}
