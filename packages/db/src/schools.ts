import { createHash, randomInt } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { JOIN_CODE_ALPHABET } from './management.js';
import { schools, teacherInvites } from './schema.js';
import type { Database } from './types.js';

/*
 * Schools and teacher invites: the owner's writes, made by the owner's command
 * (`npm run school`, ./school-command.ts), never by a route. Like management.ts
 * they sit beside the transition engine: they never touch `participations` or
 * `events`.
 */

type SchoolRow = typeof schools.$inferSelect;
type InviteRow = typeof teacherInvites.$inferSelect;

/**
 * An invite code's length: 25 symbols of the join code's unambiguous alphabet
 * (no 0/O, no 1/I/L), so 25 × log2(31) ≈ 124 bits of chance. That is past the
 * 112 bits at which NIST SP 800-63B (§5.1.2.2) stores a look-up secret under a
 * plain approved hash, with no salt and no slow hash: no search of a stolen
 * table's hashes finds a code, let alone within the 14 days one lives.
 */
export const INVITE_CODE_LENGTH = 25;
/** An invite is good for 14 days from its minting (the owner's ruling, 2026-10-04). */
export const INVITE_LIFETIME_DAYS = 14;
/** Bounded, as a join code's are, so a broken database can never spin here forever. */
const INVITE_MINT_ATTEMPTS = 8;

/** A fresh code: `INVITE_CODE_LENGTH` symbols, each drawn without bias. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/** A code as it is shown: in groups of five, the dashes only separating them. */
export function formatInviteCode(code: string): string {
  return code.replace(/(.{5})(?=.)/g, '$1-');
}

/**
 * What is stored for a code: its SHA-256, in hex. Taken over the code as it is
 * minted — upper-case, no dashes — so a redeem (T1b) hashes what a teacher
 * types once it is put back in that form.
 */
export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Add a school. No data agreement is on record for it yet, so no invite is minted for it. */
export async function createSchool(db: Database, input: { name: string }): Promise<SchoolRow> {
  const [row] = await db.insert(schools).values({ name: input.name }).returning();
  if (!row) throw new Error('createSchool: the insert returned no row');
  return row;
}

const liveSchool = (schoolId: string) => and(eq(schools.id, schoolId), isNull(schools.removedAt));

/**
 * Record the school's data agreement as signed on `signedOn`, a day written
 * YYYY-MM-DD (the command checks it). Recording it again replaces the day — the
 * owner correcting a mistyped one — and `before` is the day it replaced.
 * Undefined when no live school has the id.
 */
export async function recordAgreement(
  db: Database,
  input: { schoolId: string; signedOn: string },
): Promise<{ school: SchoolRow; before: string | null } | undefined> {
  const [current] = await db.select().from(schools).where(liveSchool(input.schoolId));
  if (!current) return undefined;
  const [school] = await db
    .update(schools)
    .set({ agreementSignedAt: input.signedOn })
    .where(liveSchool(input.schoolId))
    .returning();
  if (!school) return undefined;
  return { school, before: current.agreementSignedAt };
}

export type MintInviteResult =
  /** `code` is the only copy of the code there is: the invite holds its hash alone. */
  | { outcome: 'minted'; code: string; invite: InviteRow; school: SchoolRow }
  | { outcome: 'unknown_school' }
  | { outcome: 'no_agreement'; school: SchoolRow };

/**
 * Mint a teacher invite for a school whose data agreement is on record — a
 * prerequisite of FERPA and the state's law (docs/ISSUES.md, Phase 6): one code,
 * for one teacher, good for 14 days. Only its hash is stored; the code comes
 * back here, once, for the owner to hand on. ON CONFLICT DO NOTHING on the
 * unique hash makes a code another invite holds a fresh draw, never a second
 * invite with it — a draw that at 124 bits never comes, bounded all the same.
 *
 * The agreement is read before the invite is written, and nothing comes between
 * the two: nothing takes an agreement back off the record.
 */
export async function mintTeacherInvite(
  db: Database,
  input: { schoolId: string },
  // Injection point for deterministic tests (force a collision); defaults to the
  // real generator, so every production caller behaves identically.
  gen: () => string = generateInviteCode,
): Promise<MintInviteResult> {
  const [school] = await db.select().from(schools).where(liveSchool(input.schoolId));
  if (!school) return { outcome: 'unknown_school' };
  if (school.agreementSignedAt === null) return { outcome: 'no_agreement', school };
  for (let attempt = 0; attempt < INVITE_MINT_ATTEMPTS; attempt += 1) {
    const code = gen();
    const [invite] = await db
      .insert(teacherInvites)
      .values({
        schoolId: school.id,
        codeHash: hashInviteCode(code),
        // The database's clock, which `created_at` reads in the same statement,
        // so the two are exactly the lifetime apart. In hours, because a day of
        // the database's zone can be 23 or 25 of them.
        expiresAt: sql`now() + make_interval(hours => ${INVITE_LIFETIME_DAYS * 24}::int)`,
      })
      .onConflictDoNothing({ target: teacherInvites.codeHash })
      .returning();
    if (invite) return { outcome: 'minted', code, invite, school };
  }
  throw new Error('mintTeacherInvite: could not draw a code no other invite holds');
}
