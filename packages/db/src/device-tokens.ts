import type { PushEnvironment } from '@bali/shared';
import { and, eq, sql } from 'drizzle-orm';

import { deviceTokens, users } from './schema.js';
import { isUniqueViolation } from './sql-errors.js';
import type { Database } from './types.js';

/*
 * A student's phone's APNs device token (N3; ARCHITECTURE, "Push: a doorbell
 * for students"): registered and removed by the student. Like management.ts
 * and schools.ts these sit beside the transition engine: they never touch
 * `participations` or `events`, and the token's row is its own record.
 *
 * Each takes the caller's row FOR SHARE first, so a role change (a redeem, T1b)
 * or a deletion (C3, which deletes the account's tokens) runs wholly before or
 * after it, and is judged in the same transaction as the write.
 */

type UserRow = typeof users.$inferSelect;

export type RegisterPushTokenResult =
  | { outcome: 'registered' | 'replay'; environment: PushEnvironment }
  | { outcome: 'event_id_conflict' | 'not_a_student' | 'account_deleted' };

/**
 * Register `token` as the student `userId`'s, issued for `environment`: one
 * phone, one current owner, so a token another account holds moves to this
 * one. Idempotent on `eventId`: the row that eventId wrote, still as it wrote
 * it, is a replay, written again by nothing; an eventId another token's or
 * another account's row holds is `event_id_conflict`.
 *
 * Later wins, by the eventIds' UUIDv7 order (the phone's own, as a quiz answer
 * replaces an earlier one): a register rewrites the token's row only when its
 * eventId sorts after the one the row holds, so an old retry landing after a
 * newer register — this account's or another's — writes nothing and is
 * answered as a replay, with the token's environment now. A removal deletes
 * the row and keeps no eventId, so a stale register after it registers again
 * (DECISIONS, N4).
 */
export async function registerPushToken(
  db: Database,
  input: { userId: string; token: string; environment: PushEnvironment; eventId: string },
): Promise<RegisterPushTokenResult> {
  try {
    return await registerOnce(db, input);
  } catch (err) {
    // Another register took this eventId while this one ran: read again, as a
    // replay or a conflict — `event_id` is the only unique key the upsert can
    // break (the token's own conflict is its ON CONFLICT).
    if (!isUniqueViolation(err)) throw err;
    return registerOnce(db, input);
  }
}

function registerOnce(
  db: Database,
  input: { userId: string; token: string; environment: PushEnvironment; eventId: string },
): Promise<RegisterPushTokenResult> {
  return db.transaction(async (tx): Promise<RegisterPushTokenResult> => {
    const user = await lockUser(tx, input.userId);
    const [held] = await tx
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.eventId, input.eventId));
    if (held) {
      return held.token === input.token && held.userId === user.id
        ? { outcome: 'replay', environment: held.environment }
        : { outcome: 'event_id_conflict' };
    }
    if (user.removedAt !== null) return { outcome: 'account_deleted' };
    if (user.role !== 'student') return { outcome: 'not_a_student' };

    const row = { userId: user.id, environment: input.environment, eventId: input.eventId };
    const written = await tx
      .insert(deviceTokens)
      .values({ token: input.token, ...row })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: { ...row, updatedAt: sql`now()` },
        // Postgres orders uuids by their bytes: a UUIDv7's leading timestamp first.
        setWhere: sql`${deviceTokens.eventId} < excluded.event_id`,
      })
      .returning({ token: deviceTokens.token });
    if (written.length > 0) return { outcome: 'registered', environment: input.environment };
    // A newer register holds the row: this one is older, a replay of the truth now.
    const [now] = await tx
      .select({ environment: deviceTokens.environment })
      .from(deviceTokens)
      .where(eq(deviceTokens.token, input.token));
    if (!now) throw new Error('registerPushToken: the newer row is gone');
    return { outcome: 'replay', environment: now.environment };
  });
}

export type RemovePushTokenResult = {
  outcome: 'removed' | 'not_registered' | 'event_id_conflict' | 'not_a_student';
};

/**
 * Remove `token` from the student `userId`, if it is theirs: 'removed', or
 * 'not_registered' when they hold no such token — a removal's retry, or a
 * token that moved to another account, which is never touched. The row goes
 * for good, so a retry re-reads the truth: not theirs. An eventId a register
 * holds is `event_id_conflict`, nothing removed.
 */
export function removePushToken(
  db: Database,
  input: { userId: string; token: string; eventId: string },
): Promise<RemovePushTokenResult> {
  return db.transaction(async (tx): Promise<RemovePushTokenResult> => {
    const user = await lockUser(tx, input.userId);
    const [held] = await tx
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.eventId, input.eventId));
    if (held) return { outcome: 'event_id_conflict' };
    if (user.role !== 'student') return { outcome: 'not_a_student' };

    const removed = await tx
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.token, input.token), eq(deviceTokens.userId, user.id)))
      .returning({ token: deviceTokens.token });
    return { outcome: removed.length > 0 ? 'removed' : 'not_registered' };
  });
}

/** The caller's row, held FOR SHARE to the end of `tx`. */
async function lockUser(tx: Database, userId: string): Promise<UserRow> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('share');
  if (!user) throw new Error('device tokens: no account has that id');
  return user;
}
