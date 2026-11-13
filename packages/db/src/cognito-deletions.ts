import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { cognitoDeletions } from './schema.js';
import type { Database } from './types.js';

/*
 * A deleted account's Cognito sign-in, queued for the API to delete from its pool (the owner's
 * decision, 2026-10-09; the API's half is apps/api/src/cognito/), and since 2026-10-28 the sign-in
 * of each person a retention run de-identifies, queued the same way. Since C3d (the owner,
 * 2026-11-11: "Now, on the server") the row is also the mark by which the server refuses that
 * sign-in's old tokens (`signInDeleted`), kept for a day once its try finishes. Like
 * device-tokens.ts these sit beside the transition engine: they never touch `participations` or
 * `events`.
 */

/** From the caller's verified access token: its `iss` (the pool), `username` and `sub`. */
export interface CognitoSignIn {
  issuer: string;
  username: string;
  sub: string;
}

/**
 * Who a request's verified access token says signed in (C3d): its pool, its `sub`, and when its
 * person signed in, Cognito's `auth_time`, which a refresh keeps. None when the token carries none,
 * which Cognito never issues.
 */
export interface SignedIn {
  issuer: string;
  sub: string;
  at: Date | undefined;
}

export type CognitoDeletion = typeof cognitoDeletions.$inferSelect;

/**
 * How long a row is kept once its try finishes, as its sign-in's mark (C3d): 24 hours, Cognito's
 * longest access-token life, so every token issued before the deletion has expired by then.
 */
export const SIGN_IN_MARK_MS = 24 * 60 * 60_000;

/**
 * Queue `signIn`'s deletion, made at `at` by the server's clock. A sign-in queued already keeps its
 * row, its tries and their backoff; the row takes the newest deletion's time, so every token issued
 * before it is refused (C3d). One whose try had finished, its person come back and deleted again,
 * is queued anew, due at `at`, its username taken back.
 */
export async function queueCognitoDeletion(
  db: Database,
  signIn: CognitoSignIn,
  at: Date,
): Promise<void> {
  const queued = sql`${cognitoDeletions.finishedAt} is null`;
  await db
    .insert(cognitoDeletions)
    .values({ ...signIn, nextAttemptAt: at, deletedAt: at })
    .onConflictDoUpdate({
      target: [cognitoDeletions.issuer, cognitoDeletions.sub],
      set: {
        deletedAt: sql`greatest(${cognitoDeletions.deletedAt}, excluded.deleted_at)`,
        username: sql`coalesce(${cognitoDeletions.username}, excluded.username)`,
        attempts: sql`case when ${queued} then ${cognitoDeletions.attempts} else 0 end`,
        nextAttemptAt: sql`case when ${queued} then ${cognitoDeletions.nextAttemptAt} else excluded.next_attempt_at end`,
        finishedAt: null,
      },
    });
}

/** A row claimed for a try: a queued one, so it holds the username its try takes. */
export type ClaimedDeletion = CognitoDeletion & { username: string };

/**
 * Claim up to `limit` of `issuer`'s rows due at `now`, oldest first. The claim counts the try and
 * puts the next one off — a minute, doubling, at most an hour — in one statement, so a crash
 * mid-try is retried then, and no row is tried by two at once: SKIP LOCKED passes over a row
 * another claim holds, and a claimed row is no longer due. A finished row is never due.
 */
export function claimCognitoDeletions(
  db: Database,
  input: { issuer: string; now: Date; limit: number },
): Promise<ClaimedDeletion[]> {
  const due = db
    .select({ id: cognitoDeletions.id })
    .from(cognitoDeletions)
    .where(
      and(
        eq(cognitoDeletions.issuer, input.issuer),
        lte(cognitoDeletions.nextAttemptAt, input.now),
        isNull(cognitoDeletions.finishedAt),
        isNotNull(cognitoDeletions.username),
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
    .returning() as Promise<ClaimedDeletion[]>;
}

/**
 * A claimed row whose try finished at `at`, whatever the outcome: kept as its sign-in's mark (C3d),
 * the username dropped, since nothing needs it now. A deletion queued since the claim moved its
 * `deletedAt`, and keeps it queued for a try of its own, due when the claim put the next one off (a
 * queued row keeps its backoff): this try may have kept a sign-in the person had come back to, then
 * deleted with that account.
 */
export async function finishCognitoDeletion(
  db: Database,
  row: Pick<CognitoDeletion, 'id' | 'deletedAt'>,
  at: Date,
): Promise<void> {
  await db
    .update(cognitoDeletions)
    .set({ finishedAt: at, username: null })
    .where(
      and(
        eq(cognitoDeletions.id, row.id),
        // Both written from the server's clock, to the millisecond, so equal when unmoved.
        row.deletedAt === null
          ? isNull(cognitoDeletions.deletedAt)
          : eq(cognitoDeletions.deletedAt, row.deletedAt),
      ),
    );
}

/** The rows finished a day before `now` or earlier, deleted: every old token has expired (C3d). */
export async function forgetFinishedCognitoDeletions(db: Database, now: Date): Promise<void> {
  await db
    .delete(cognitoDeletions)
    .where(lte(cognitoDeletions.finishedAt, new Date(now.getTime() - SIGN_IN_MARK_MS)));
}

/**
 * Whether `signedIn`'s token is a deleted sign-in's (C3d): its sign-in was deleted here after its
 * person signed in, and the mark is kept still. A token with no sign-in time counts as before.
 */
export async function signInDeleted(db: Database, { issuer, sub, at }: SignedIn): Promise<boolean> {
  const deletedAt = sql`coalesce(${cognitoDeletions.deletedAt}, ${cognitoDeletions.createdAt})`;
  const [mark] = await db
    .select({ id: cognitoDeletions.id })
    .from(cognitoDeletions)
    .where(
      and(
        eq(cognitoDeletions.issuer, issuer),
        eq(cognitoDeletions.sub, sub),
        at && sql`${deletedAt} > ${at.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return mark !== undefined;
}
