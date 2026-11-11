import {
  type Database,
  findOrCreateStudent,
  type SignedIn,
  unlockAsNoOne,
  type UserRow,
} from '@bali/db';

import { refusal } from '../routes/errors.js';
import type { AuthedIdentity } from './verify.js';

/*
 * The caller's account, for the routes that make a student's by its first call (auth decision 3),
 * and the one place a deleted sign-in's old token is refused (C3d; the owner, 2026-11-11: "Now, on
 * the server"): issued before its sign-in's deletion, it makes no account, for as long as any token
 * of it can still work.
 */

/**
 * The sign-in the verified token names: its pool, its `sub`, and when its person signed in,
 * Cognito's `auth_time`, which a refresh keeps. None when the token carries none a date can hold.
 */
export function signedInOf({ sub, claims }: AuthedIdentity): SignedIn {
  const at = typeof claims.auth_time === 'number' ? new Date(claims.auth_time * 1000) : undefined;
  return { issuer: claims.iss ?? '', sub, at: at && !Number.isNaN(at.getTime()) ? at : undefined };
}

/**
 * The caller's account, a student's made by its first call (`findOrCreateStudent`). Under a deleted
 * sign-in's old token, `409 account_deleted` with nothing made, as a request still on its way
 * under a deleted account is answered.
 */
export async function accountOf(
  db: Database,
  identity: AuthedIdentity,
  displayName?: string,
): Promise<UserRow> {
  const account = await findOrCreateStudent(db, signedInOf(identity), displayName);
  if (!account) throw refusal('ACCOUNT_DELETED');
  return account;
}

/**
 * An Emergency Unlock's sender, for `record` to file it under: the caller's account, or under a
 * deleted sign-in's old token a student born removed (`unlockAsNoOne`). Recorded, never refused.
 */
export async function asUnlocker<T>(
  db: Database,
  identity: AuthedIdentity,
  unlock: { eventId: string; at: Date },
  record: (on: Database, studentId: string) => Promise<T>,
): Promise<T> {
  const account = await findOrCreateStudent(db, signedInOf(identity));
  return account ? record(db, account.id) : unlockAsNoOne(db, unlock, record);
}
