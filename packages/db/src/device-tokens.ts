import type { PushEnvironment, PushService } from '@bali/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { deviceTokens, users } from './schema.js';
import { isUniqueViolation } from './sql-errors.js';
import type { Database } from './types.js';

/*
 * A student's phone's push token (N3; ARCHITECTURE, "Push: a doorbell for
 * students"), APNs's or FCM's (AN11a): registered and removed by the student.
 * Like management.ts and schools.ts these sit beside the transition engine:
 * they never touch `participations` or `events`, and the token's row is its
 * own record. A call that names no service is APNs's, as the column is.
 *
 * Each takes the caller's row FOR SHARE first, so a role change (a redeem, T1b)
 * or a deletion (C3, which deletes the account's tokens) runs wholly before or
 * after it, and is judged in the same transaction as the write.
 */

type UserRow = typeof users.$inferSelect;

export type RegisterPushTokenResult =
  | { outcome: 'registered' | 'replay'; environment: PushEnvironment }
  | { outcome: 'event_id_conflict' | 'not_a_student' | 'account_deleted' };

interface RegisterPushTokenInput {
  userId: string;
  token: string;
  service?: PushService;
  environment: PushEnvironment;
  eventId: string;
}

/**
 * Register `token`, of `service` (APNs's if none), as the student `userId`'s,
 * issued for `environment`: one phone, one current owner, so a token another
 * account holds moves to this one. Idempotent on `eventId`: the row that
 * eventId wrote, still as it wrote it, is a replay, written again by nothing;
 * an eventId another token's or another account's row holds is
 * `event_id_conflict`.
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
  input: RegisterPushTokenInput,
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
  input: RegisterPushTokenInput,
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

    // A token is one service's (the formats never meet), so its row keeps its service.
    const row = {
      userId: user.id,
      service: input.service ?? 'apns',
      environment: input.environment,
      eventId: input.eventId,
    };
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
 * Remove `token`, of `service` (APNs's if none), from the student `userId`, if
 * it is theirs: 'removed', or 'not_registered' when they hold no such token — a
 * removal's retry, or a token that moved to another account, which is never
 * touched. The row goes for good, so a retry re-reads the truth: not theirs. An
 * eventId a register holds is `event_id_conflict`, nothing removed.
 */
export function removePushToken(
  db: Database,
  input: { userId: string; token: string; service?: PushService; eventId: string },
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
      .where(
        and(
          eq(deviceTokens.token, input.token),
          eq(deviceTokens.userId, user.id),
          eq(deviceTokens.service, input.service ?? 'apns'),
        ),
      )
      .returning({ token: deviceTokens.token });
    return { outcome: removed.length > 0 ? 'removed' : 'not_registered' };
  });
}

export interface PushTarget {
  token: string;
  userId: string;
  service: PushService;
  environment: PushEnvironment;
  /** The register that wrote the row as read: a gone token's deletion names it (N5). */
  eventId: string;
}

/**
 * Every token of `service` these students hold — a sender's addressees for the
 * "class started" push (N5): each sender reads its own service's tokens only (AN11a).
 */
export function pushTargetsOf(
  db: Database,
  service: PushService,
  userIds: readonly string[],
): Promise<PushTarget[]> {
  if (userIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      token: deviceTokens.token,
      userId: deviceTokens.userId,
      service: deviceTokens.service,
      environment: deviceTokens.environment,
      eventId: deviceTokens.eventId,
    })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.service, service), inArray(deviceTokens.userId, [...userIds])));
}

/**
 * Delete a token its service reported gone (N5) — only the row as it was read:
 * still that service's, still this student's, still written by the same
 * register. A token that moved to another account, or was registered again
 * since, is left alone (N4's order). Returns whether a row went.
 */
export async function deleteGonePushToken(db: Database, target: PushTarget): Promise<boolean> {
  const gone = await db
    .delete(deviceTokens)
    .where(
      and(
        eq(deviceTokens.token, target.token),
        eq(deviceTokens.service, target.service),
        eq(deviceTokens.userId, target.userId),
        eq(deviceTokens.eventId, target.eventId),
      ),
    )
    .returning({ token: deviceTokens.token });
  return gone.length > 0;
}

/** The caller's row, held FOR SHARE to the end of `tx`. */
async function lockUser(tx: Database, userId: string): Promise<UserRow> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('share');
  if (!user) throw new Error('device tokens: no account has that id');
  return user;
}
