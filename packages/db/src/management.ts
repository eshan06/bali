import { randomInt } from 'node:crypto';

import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '@bali/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { findClassById } from './queries.js';
import { blocks, classes, schools, users } from './schema.js';
import { isUniqueViolation } from './sql-errors.js';
import { TransitionError } from './transitions.js';
import type { Database } from './types.js';

/*
 * Class and block administration — the teacher-facing writes that create and
 * rename classes and register and remove NFC tags. These deliberately sit
 * BESIDE the transition engine, not inside it: they never touch
 * `participations` or `events`, so they need none of the engine's session
 * locking or event bookkeeping. The engine stays the sole writer of those two
 * tables.
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
export { JOIN_CODE_ALPHABET };
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

/**
 * A 23505 out of the regenerate UPDATE is always a join-code collision.
 * Besides the primary key on `id` and the unique `event_id` (which that UPDATE
 * never sets), the active join-code index is the only unique constraint on
 * `classes`, so the loop can safely read one as "try a fresh code". (INSERT
 * uses ON CONFLICT DO NOTHING instead and never throws here.)
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
 * Hold the teacher's row while a class or block is made for them (C3). FOR
 * SHARE waits out a deletion holding the row (`deleteAccount` takes it FOR NO
 * KEY UPDATE, which a foreign key's KEY SHARE never waits for) and keeps one
 * from starting, so the deletion either sees the new row and refuses
 * `TEACHER_HAS_CLASSES`, or has removed the teacher and this refuses
 * `ACCOUNT_DELETED`: never a class or block owned by no one.
 */
async function holdLiveTeacher(tx: Database, teacherId: string): Promise<void> {
  const [row] = await tx
    .select({ removedAt: users.removedAt })
    .from(users)
    .where(eq(users.id, teacherId))
    .for('share');
  if (row?.removedAt) throw new TransitionError('ACCOUNT_DELETED', 'this account was deleted');
}

/**
 * Create a class for a teacher with a unique, server-generated join code. The
 * insert uses ON CONFLICT DO NOTHING: a code collision on the active join-code
 * index returns no row and we try a fresh code — so two concurrent creates
 * that happen to mint the same code can never both win (the index arbitrates,
 * not a read-then-write). Exhausting the bounded attempts is effectively
 * impossible and surfaces as a 500 rather than a silent bad state.
 *
 * Idempotent on `eventId` when the request carries one (rule 4; 2026-10-23):
 * the class that id made, the caller's own, is the replay, returned as it is
 * now and never made twice; another teacher's is `EVENT_ID_CONFLICT`. Its
 * unique index arbitrates here too, so the same create racing itself waits for
 * the first to commit and then reads its class. Postgres compares the uuid, so
 * an id resent in another letter case is the same id. Only `classes` is read
 * for it: a writer beside the engine checks its own table (the owner's ruling
 * on #317, 2026-10-12). Without one, every call makes a class, as before.
 */
export async function createClass(
  db: Database,
  input: { teacherId: string; schoolId: string; name: string; eventId?: string },
  // Injection point for deterministic tests (force a collision); defaults to the
  // real generator, so every production caller behaves identically.
  gen: () => string = generateJoinCode,
): Promise<ClassRow> {
  return db.transaction(async (tx) => {
    // The school before the teacher, in a disposal's order (school, then its
    // people): the insert's foreign key takes the school's KEY SHARE, and
    // taking it only there, after the teacher, could deadlock with a disposal
    // (C6a's review). A disposal ahead of this then leaves the teacher removed.
    await tx
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.id, input.schoolId))
      .for('key share');
    await holdLiveTeacher(tx, input.teacherId);
    for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
      const [row] = await tx
        .insert(classes)
        .values({
          teacherId: input.teacherId,
          schoolId: input.schoolId,
          name: input.name,
          joinCode: gen(),
          eventId: input.eventId,
        })
        // No target: either unique key may meet a row, the live join code or the eventId.
        .onConflictDoNothing()
        .returning();
      if (row) return row;
      if (input.eventId === undefined) continue;
      // Nothing written: the code was taken, or this eventId's class is made already. Read whether
      // or not it was removed since: unreachable today, as only a disposal removes a class, and it
      // de-identifies its teacher with it, so a resend is refused before this read (the route's
      // 403 for a sign-in that is no teacher now, or ACCOUNT_DELETED above for one already under
      // way). A route that removes a class while its teacher stays must settle what a resend of
      // its create answers.
      const [made] = await tx.select().from(classes).where(eq(classes.eventId, input.eventId));
      if (made?.teacherId === input.teacherId) return made;
      if (made) {
        throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another class');
      }
    }
    throw new Error('createClass: could not allocate a unique join code');
  });
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
 * A registration's tries at a tag (`registerBlock`): another is needed only when the block its
 * insert met was removed before its read, so a third means two blocks of the tag registered and
 * removed inside one registration. Bounded so a broken database can never spin here forever.
 */
const REGISTER_ATTEMPTS = 3;

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
 *
 * A removed block's tag is free (`removeBlock`): registered again, by its
 * teacher or anyone, it is a new block, never the removed one back. One
 * meeting the removal of the tag's block under way waits it out, then
 * registers (`registerBlock`).
 */
export async function createBlock(
  db: Database,
  input: { teacherId: string; tagId: string },
): Promise<CreateBlockResult> {
  return db.transaction(async (tx) => {
    await holdLiveTeacher(tx, input.teacherId);
    return registerBlock(tx, input);
  });
}

async function registerBlock(
  db: Database,
  input: { teacherId: string; tagId: string },
): Promise<CreateBlockResult> {
  for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt += 1) {
    const [row] = await db
      .insert(blocks)
      .values({ tagId: input.tagId, teacherId: input.teacherId })
      .onConflictDoNothing({ target: blocks.tagId, where: sql`${blocks.removedAt} is null` })
      .returning();
    if (row) return { outcome: 'registered', block: row };

    // Read the block that holds the tag, FOR SHARE: a removal under way holds
    // its row FOR UPDATE (`removeBlock`), so this waits it out, and none can
    // start before this answer commits, so the answer stays true until then.
    // The caller's: theirs again. Another teacher's: the tag really is taken.
    // None: the block the insert met was removed since, its tag free again
    // (LO10b; the owner's "Free the code", 2026-11-17), so the insert goes again.
    const [holder] = await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.tagId, input.tagId), isNull(blocks.removedAt)))
      .limit(1)
      .for('share');
    if (holder) {
      return holder.teacherId === input.teacherId
        ? { outcome: 'already_registered', block: holder }
        : { outcome: 'tag_taken' };
    }
  }
  throw new Error('createBlock: the tag was registered and removed again at every try');
}

/** The block with this id, live or removed, whoever's: none when no block has it. A read. */
export async function findBlock(db: Database, blockId: string): Promise<BlockRow | undefined> {
  const [row] = await db.select().from(blocks).where(eq(blocks.id, blockId)).limit(1);
  return row;
}

/**
 * A removal's answer: the block as it is now, `removed` by this call, or a `replay`, removed
 * already and nothing written; or none with that id.
 */
export type RemoveBlockResult =
  { outcome: 'removed' | 'replay'; block: BlockRow } | { outcome: 'block_not_found' };

/**
 * A teacher removes one of their own blocks, a lost one (LO10b): marked removed,
 * never deleted (data-model decision 3), which frees its tag for anyone to
 * register again, as `blocks_tag_active_unique` (live rows only) allows (the
 * owner's "Free the code", 2026-11-17). Its row alone, FOR UPDATE, then its
 * write: so it waits out its own resend, and a registration reading the tag's
 * holder (`registerBlock`, FOR SHARE) waits it out in turn.
 *
 * Idempotent on `eventId` (rule 4): a block removed already is a `replay`,
 * answered as it is, whatever removed it (this removal's resend, sent in any
 * case, or another), and nothing is written. The id another block's removal
 * holds is EVENT_ID_CONFLICT, as a class's create refuses one another class
 * holds: its column's unique constraint refuses it, two removals racing under
 * one id included, since a writer beside the engine checks only its own table
 * (the owner's ruling on #317).
 *
 * Nothing else is touched, and nothing needs to be. A session is its class's,
 * never its block's, so one of the teacher's running runs on to its bell, its
 * students' check-ins, unlocks and returns naming the session. A tap waiting
 * for the teacher's Start (decision 5: student and teacher) still waits for
 * it. And the retry of a tap made at the block is still that tap's retry (tap
 * step 9, `retryAtRemovedBlock`): only a new tap at the tag finds no block.
 */
export async function removeBlock(
  db: Database,
  input: { blockId: string; eventId: string; now?: Date },
): Promise<RemoveBlockResult> {
  try {
    return await db.transaction(async (tx): Promise<RemoveBlockResult> => {
      const [block] = await tx
        .select()
        .from(blocks)
        .where(eq(blocks.id, input.blockId))
        .for('update');
      if (!block) return { outcome: 'block_not_found' };
      if (block.removedAt) return { outcome: 'replay', block };
      const [removed] = await tx
        .update(blocks)
        .set({ removedAt: input.now ?? new Date(), removedEventId: input.eventId })
        .where(eq(blocks.id, block.id))
        .returning();
      return { outcome: 'removed', block: removed! };
    });
  } catch (err) {
    // The one unique key this write can meet: the id another block's removal holds.
    if (!isUniqueViolation(err)) throw err;
    throw new TransitionError('EVENT_ID_CONFLICT', 'event_id already used by another removal');
  }
}

/**
 * A teacher's live blocks, oldest first: theirs alone, and none soft-removed,
 * since a removed block no longer holds its tag. A read; it writes nothing.
 */
export async function listBlocks(db: Database, teacherId: string): Promise<BlockRow[]> {
  return db
    .select()
    .from(blocks)
    .where(and(eq(blocks.teacherId, teacherId), isNull(blocks.removedAt)))
    .orderBy(asc(blocks.createdAt), asc(blocks.id));
}
