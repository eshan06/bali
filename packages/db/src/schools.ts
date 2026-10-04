import { createHash, randomInt } from 'node:crypto';

import { INVITE_CODE_LENGTH, JOIN_CODE_ALPHABET } from '@bali/shared';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';

import { classes, enrollments, schools, teacherInvites, users } from './schema.js';
import { isUniqueViolation } from './sql-errors.js';
import type { Database } from './types.js';

/*
 * Schools and teacher invites: the owner's writes and reads, made by the owner's
 * command (`npm run school`, ./school-command.ts), and the redeem of an invite,
 * the one a route makes (T1b). Like management.ts they sit beside the transition
 * engine: they never touch `participations` or `events`.
 */

type SchoolRow = typeof schools.$inferSelect;
type InviteRow = typeof teacherInvites.$inferSelect;
type UserRow = typeof users.$inferSelect;

/**
 * An invite code's length: 25 symbols of the join code's unambiguous alphabet
 * (no 0/O, no 1/I/L), so 25 × log2(31) ≈ 124 bits of chance. That is past the
 * 112 bits at which NIST SP 800-63B (§5.1.2.2) stores a look-up secret under a
 * plain approved hash, with no salt and no slow hash: no search of a stolen
 * table's hashes finds a code, let alone within the 14 days one lives. Kept in
 * `@bali/shared` with a code's other rules, so the portal checks one as the redeem does.
 */
export {
  formatInviteCode,
  INVITE_CODE_LENGTH,
  INVITE_CODE_PATTERN,
  inviteCodeSymbols,
} from '@bali/shared';
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

/** The schools on record under `name`, its case set aside: what a second `add` of one says. */
export async function schoolsNamed(db: Database, name: string): Promise<SchoolRow[]> {
  return db
    .select()
    .from(schools)
    .where(and(isNull(schools.removedAt), sql`lower(${schools.name}) = lower(${name})`))
    .orderBy(asc(schools.createdAt));
}

export interface SchoolListing {
  id: string;
  name: string;
  agreementSignedAt: string | null;
  /** Its invites still open: neither redeemed nor past their expiry by the database's clock. */
  openInvites: number;
}

/** Every school on record, by name: never a code, nor a code's hash. */
export async function listSchools(db: Database): Promise<SchoolListing[]> {
  return db
    .select({
      id: schools.id,
      name: schools.name,
      agreementSignedAt: schools.agreementSignedAt,
      openInvites: sql<number>`count(${teacherInvites.id})::int`,
    })
    .from(schools)
    .leftJoin(
      teacherInvites,
      and(
        eq(teacherInvites.schoolId, schools.id),
        isNull(teacherInvites.redeemedAt),
        gt(teacherInvites.expiresAt, sql`now()`),
      ),
    )
    .where(isNull(schools.removedAt))
    .groupBy(schools.id)
    .orderBy(asc(schools.name), asc(schools.createdAt));
}

/**
 * Record the school's data agreement as signed on `signedOn`, a day written
 * YYYY-MM-DD (the command checks it). Recording it again replaces the day — the
 * owner correcting a mistyped one — and `before` is the day it replaced: the
 * row is locked from its read to its write, so two runs at once each name the
 * day their own write replaced. Undefined when no live school has the id.
 */
export async function recordAgreement(
  db: Database,
  input: { schoolId: string; signedOn: string },
): Promise<{ school: SchoolRow; before: string | null } | undefined> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schools)
      .where(liveSchool(input.schoolId))
      .for('update');
    if (!current) return undefined;
    const [school] = await tx
      .update(schools)
      .set({ agreementSignedAt: input.signedOn })
      .where(eq(schools.id, current.id))
      .returning();
    if (!school) return undefined;
    return { school, before: current.agreementSignedAt };
  });
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
 * The school's row is held (FOR SHARE) from the read of its agreement to the
 * invite's write, so nothing that takes an agreement back off the record or
 * removes the school can come between the two; nothing does yet.
 */
export async function mintTeacherInvite(
  db: Database,
  input: { schoolId: string },
  // Injection point for deterministic tests (force a collision); defaults to the
  // real generator, so every production caller behaves identically.
  gen: () => string = generateInviteCode,
): Promise<MintInviteResult> {
  return db.transaction(async (tx): Promise<MintInviteResult> => {
    const [school] = await tx.select().from(schools).where(liveSchool(input.schoolId)).for('share');
    if (!school) return { outcome: 'unknown_school' };
    if (school.agreementSignedAt === null) return { outcome: 'no_agreement', school };
    for (let attempt = 0; attempt < INVITE_MINT_ATTEMPTS; attempt += 1) {
      const code = gen();
      const [invite] = await tx
        .insert(teacherInvites)
        .values({
          schoolId: school.id,
          codeHash: hashInviteCode(code),
          // The database's clock, whose now() also fills `created_at`, so the
          // two are exactly the lifetime apart. In hours, because a day of the
          // database's zone can be 23 or 25 of them.
          expiresAt: sql`now() + make_interval(hours => ${INVITE_LIFETIME_DAYS * 24}::int)`,
        })
        .onConflictDoNothing({ target: teacherInvites.codeHash })
        .returning();
      if (invite) return { outcome: 'minted', code, invite, school };
    }
    throw new Error('mintTeacherInvite: could not draw a code no other invite holds');
  });
}

export type RedeemInviteResult =
  | { outcome: 'redeemed' | 'replay'; user: UserRow }
  | {
      outcome:
        | 'event_id_conflict'
        | 'already_teacher'
        | 'student_in_class'
        | 'invite_not_found'
        | 'invite_used'
        | 'invite_expired';
    };

/**
 * Redeem a teacher invite (T1b): the account `userId` becomes a teacher at the
 * invite's school, and the invite is marked redeemed by it under `eventId`, in
 * one transaction. `code` is the code's symbols (`inviteCodeSymbols`), looked
 * up by its hash.
 *
 * Idempotent on `eventId`: a replay by the same account redeems nothing again
 * and answers `replay` with the account now; one another account's redeem
 * holds is `event_id_conflict`. The account is judged before any code is
 * looked up — a teacher already, or a student in a live class (the owner's
 * ruling, 2026-10-04) — so an account that can redeem nothing learns nothing
 * of codes. Then the invite: none with the code, used, or past its expiry by
 * the database's clock, the one that set it. Every refusal changes nothing.
 *
 * Single use under contention: the caller's row is held to the end, so one
 * account's redeems run one at a time and it never takes two invites; and the
 * invite is taken by one UPDATE guarded by `redeemed_at IS NULL`, so of two
 * accounts taking it at once the second finds it gone (`invite_used`), never a
 * second redeem. Nothing goes to `participations` or `events`: the invite row
 * is the record.
 */
export async function redeemTeacherInvite(
  db: Database,
  input: { userId: string; code: string; eventId: string },
): Promise<RedeemInviteResult> {
  try {
    return await db.transaction(async (tx): Promise<RedeemInviteResult> => {
      const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
      if (!user) throw new Error('redeemTeacherInvite: no account has that id');

      const [own] = await tx
        .select({ redeemedBy: teacherInvites.redeemedBy })
        .from(teacherInvites)
        .where(eq(teacherInvites.redeemEventId, input.eventId));
      if (own) {
        return own.redeemedBy === user.id
          ? { outcome: 'replay', user }
          : { outcome: 'event_id_conflict' };
      }

      if (user.role === 'teacher') return { outcome: 'already_teacher' };
      const [enrolled] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .innerJoin(classes, eq(classes.id, enrollments.classId))
        .where(
          and(
            eq(enrollments.studentId, user.id),
            isNull(enrollments.removedAt),
            isNull(classes.removedAt),
          ),
        )
        .limit(1);
      if (enrolled) return { outcome: 'student_in_class' };

      const [invite] = await tx
        .select({
          id: teacherInvites.id,
          schoolId: teacherInvites.schoolId,
          redeemedAt: teacherInvites.redeemedAt,
          expired: sql<boolean>`${teacherInvites.expiresAt} <= now()`,
        })
        .from(teacherInvites)
        .where(eq(teacherInvites.codeHash, hashInviteCode(input.code)));
      if (!invite) return { outcome: 'invite_not_found' };
      if (invite.redeemedAt !== null) return { outcome: 'invite_used' };
      if (invite.expired) return { outcome: 'invite_expired' };

      // `now()` is the transaction's start, so the guard's expiry agrees with
      // the read's; a row the guard skips — taken since — is never updated.
      const [taken] = await tx
        .update(teacherInvites)
        .set({ redeemedAt: sql`now()`, redeemedBy: user.id, redeemEventId: input.eventId })
        .where(
          and(
            eq(teacherInvites.id, invite.id),
            isNull(teacherInvites.redeemedAt),
            gt(teacherInvites.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: teacherInvites.id });
      if (!taken) return { outcome: 'invite_used' };

      const [teacher] = await tx
        .update(users)
        .set({ role: 'teacher', schoolId: invite.schoolId })
        .where(eq(users.id, user.id))
        .returning();
      if (!teacher) throw new Error('redeemTeacherInvite: the account went missing');
      return { outcome: 'redeemed', user: teacher };
    });
  } catch (err) {
    // Another account's redeem took this eventId while this one waited on it:
    // a client bug, as the read above would have said had it come second. The
    // only unique column this transaction writes is `redeem_event_id`; a write
    // added here that could break another must tell its 23505 apart first.
    if (isUniqueViolation(err)) return { outcome: 'event_id_conflict' };
    throw err;
  }
}
