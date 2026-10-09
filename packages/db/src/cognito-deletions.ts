import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { cognitoDeletions } from './schema.js';
import type { Database } from './types.js';

/*
 * A deleted account's Cognito sign-in, queued for the API to delete from its pool (the owner's
 * decision, 2026-10-09; the API's half is apps/api/src/cognito/). Like device-tokens.ts these sit
 * beside the transition engine: they never touch `participations` or `events`.
 */

/** From the caller's verified access token: its `iss` (the pool), `username` and `sub`. */
export interface CognitoSignIn {
  issuer: string;
  username: string;
  sub: string;
}

export type CognitoDeletion = typeof cognitoDeletions.$inferSelect;

/** Queue `signIn`'s deletion, due at `at`. One already queued is left as it is. */
export async function queueCognitoDeletion(
  db: Database,
  signIn: CognitoSignIn,
  at: Date,
): Promise<void> {
  await db
    .insert(cognitoDeletions)
    .values({ ...signIn, nextAttemptAt: at })
    .onConflictDoNothing();
}

/**
 * Claim up to `limit` of `issuer`'s rows due at `now`, oldest first. The claim counts the try and
 * puts the next one off — a minute, doubling, at most an hour — in one statement, so a crash
 * mid-try is retried then, and no row is tried by two at once: SKIP LOCKED passes over a row
 * another claim holds, and a claimed row is no longer due.
 */
export function claimCognitoDeletions(
  db: Database,
  input: { issuer: string; now: Date; limit: number },
): Promise<CognitoDeletion[]> {
  const due = db
    .select({ id: cognitoDeletions.id })
    .from(cognitoDeletions)
    .where(
      and(
        eq(cognitoDeletions.issuer, input.issuer),
        lte(cognitoDeletions.nextAttemptAt, input.now),
      ),
    )
    .orderBy(asc(cognitoDeletions.nextAttemptAt))
    .limit(input.limit)
    .for('update', { skipLocked: true });
  return db
    .update(cognitoDeletions)
    .set({
      attempts: sql`${cognitoDeletions.attempts} + 1`,
      // The exponent capped too: uncapped, a row failing for days passes interval's range.
      nextAttemptAt: sql`${input.now.toISOString()}::timestamptz + least(interval '1 minute' * power(2, least(${cognitoDeletions.attempts}, 6)), interval '1 hour')`,
    })
    .where(inArray(cognitoDeletions.id, due))
    .returning();
}

/** A claimed row whose sign-in is gone, or was never the one queued: deleted. */
export async function finishCognitoDeletion(db: Database, id: string): Promise<void> {
  await db.delete(cognitoDeletions).where(eq(cognitoDeletions.id, id));
}
