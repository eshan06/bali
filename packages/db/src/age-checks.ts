import { eq } from 'drizzle-orm';

import { ageChecks, users } from './schema.js';
import type { Database } from './types.js';

/*
 * The 13+ check's yes, kept per account (C7-server; ARCHITECTURE, Auth, "Under 13"): only that the
 * account confirmed 13 or older, never a birth date or an age. Like device-tokens.ts these sit
 * beside the transition engine: they never touch `participations` or `events`. A teacher's account
 * always counts as passed: it comes from the school's invite, and a teacher is never asked.
 */

/**
 * Whether the account Cognito knows as `cognitoId` has passed: a teacher's always, a student's once
 * its yes is recorded, and no account here never. A read that creates nothing, so the app can ask
 * right after any sign-in and an under-13 leaves no record in Bali.
 */
export async function ageCheckPassed(db: Database, cognitoId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role, recorded: ageChecks.userId })
    .from(users)
    .leftJoin(ageChecks, eq(ageChecks.userId, users.id))
    .where(eq(users.cognitoId, cognitoId));
  return row !== undefined && (row.role === 'teacher' || row.recorded !== null);
}

export type RecordAgeCheckResult = 'passed' | 'event_id_conflict' | 'account_deleted';

/**
 * Record that the account `userId` confirmed 13 or older. Idempotent on `eventId`: the yes it
 * recorded is a replay, answered `passed`; an eventId another account's yes holds is
 * `event_id_conflict`. An account that passed already, under any eventId, is answered `passed` and
 * keeps the row it has; a teacher's records nothing and is answered `passed`.
 *
 * The caller's row is held FOR SHARE first, so a deletion (C3, which deletes the yes) runs wholly
 * before or after it: one that went first is `account_deleted`, nothing recorded.
 */
export function recordAgeCheck(
  db: Database,
  input: { userId: string; eventId: string },
): Promise<RecordAgeCheckResult> {
  return db.transaction(async (tx): Promise<RecordAgeCheckResult> => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('share');
    if (!user) throw new Error('recordAgeCheck: no account has that id');
    const [held] = await tx
      .select({ userId: ageChecks.userId })
      .from(ageChecks)
      .where(eq(ageChecks.eventId, input.eventId));
    if (held) return held.userId === user.id ? 'passed' : 'event_id_conflict';
    if (user.removedAt !== null) return 'account_deleted';
    if (user.role !== 'student') return 'passed';

    // Either key may meet a row: this account's yes (a second phone's, or this one's own retry
    // racing it), or another account's taking this eventId since the read above.
    const written = await tx
      .insert(ageChecks)
      .values({ userId: user.id, eventId: input.eventId })
      .onConflictDoNothing()
      .returning({ userId: ageChecks.userId });
    if (written.length > 0) return 'passed';
    const [mine] = await tx
      .select({ userId: ageChecks.userId })
      .from(ageChecks)
      .where(eq(ageChecks.userId, user.id));
    return mine ? 'passed' : 'event_id_conflict';
  });
}
