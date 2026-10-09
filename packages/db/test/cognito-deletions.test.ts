import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimCognitoDeletions,
  type CognitoSignIn,
  finishCognitoDeletion,
  queueCognitoDeletion,
} from '../src/cognito-deletions.js';
import { newUuidV7 } from '../src/ids.js';
import { blocks, cognitoDeletions, users } from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import { deleteAccount } from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * A deleted account's Cognito sign-in, queued for the API to delete from its pool (2026-10-09):
 * queued by the deletion in its own transaction, once per sign-in, and claimed by one try at a
 * time, each claim putting the next try off longer. Each test keeps to a pool of its own, so the
 * rows of one never fall due in another.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

const MIN = 60_000;
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);
const poolOf = (tag: string) => `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_${tag}`;
const signIn = (sub: string, issuer = poolOf('main')): CognitoSignIn => ({
  issuer,
  username: `Google_${sub}`,
  sub,
});
const rowsOf = (sub: string) =>
  db.select().from(cognitoDeletions).where(eq(cognitoDeletions.sub, sub));
const subsOf = (rows: { sub: string }[]) => rows.map((row) => row.sub);

describe('queueCognitoDeletion', () => {
  it('queues a sign-in once, however often its deletion is sent: the first stays as it is', async () => {
    const at = new Date('2026-10-09T12:00:00Z');
    await queueCognitoDeletion(db, signIn('once'), at);
    await queueCognitoDeletion(db, { ...signIn('once'), username: 'another' }, later(at, MIN));

    expect(await rowsOf('once')).toMatchObject([
      { issuer: poolOf('main'), username: 'Google_once', attempts: 0, nextAttemptAt: at },
    ]);
  });
});

describe('deleteAccount queues the sign-in (2026-10-09)', () => {
  it('in its own transaction: a deletion queues it, and one rolled back queues nothing', async () => {
    const [ana, ben] = await db
      .insert(users)
      .values([
        { cognitoId: 'queued-ana', role: 'student' },
        { cognitoId: 'queued-ben', role: 'student' },
      ])
      .returning();
    const at = new Date();

    await deleteAccount(db, { userId: ana!.id, eventId: newUuidV7(), at, signIn: signIn('ana') });
    expect(await rowsOf('ana')).toMatchObject([{ username: 'Google_ana', nextAttemptAt: at }]);

    await expect(
      db.transaction(async (tx) => {
        await deleteAccount(tx, {
          userId: ben!.id,
          eventId: newUuidV7(),
          at,
          signIn: signIn('ben'),
        });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await rowsOf('ben')).toEqual([]);
  });

  it('a refused deletion, or one of an account deleted already, queues nothing', async () => {
    const [teacher, cara] = await db
      .insert(users)
      .values([
        { cognitoId: 'queued-teacher', role: 'teacher' },
        { cognitoId: 'queued-cara', role: 'student' },
      ])
      .returning();
    await db.insert(blocks).values({ tagId: 'TAG-queued', teacherId: teacher!.id });
    const at = new Date();

    await expect(
      deleteAccount(db, { userId: teacher!.id, eventId: newUuidV7(), at, signIn: signIn('t') }),
    ).rejects.toThrow(/class or block/);
    expect(await rowsOf('t')).toEqual([]);

    await deleteAccount(db, { userId: cara!.id, eventId: newUuidV7(), at });
    expect(
      await deleteAccount(db, { userId: cara!.id, eventId: newUuidV7(), at, signIn: signIn('c') }),
    ).toEqual({ outcome: 'already_deleted' });
    expect(await rowsOf('c')).toEqual([]);
  });
});

describe('claimCognitoDeletions', () => {
  it('claims what is due in its pool, oldest first, as many as asked', async () => {
    const pool = poolOf('claims');
    const now = new Date('2026-10-09T13:00:00Z');
    await queueCognitoDeletion(db, signIn('not-yet', pool), later(now, 1));
    await queueCognitoDeletion(db, signIn('now', pool), now);
    await queueCognitoDeletion(db, signIn('older', pool), later(now, -2 * MIN));
    await queueCognitoDeletion(db, signIn('elsewhere', poolOf('elsewhere')), later(now, -3 * MIN));

    expect(subsOf(await claimCognitoDeletions(db, { issuer: pool, now, limit: 1 }))).toEqual([
      'older',
    ]);
    expect(subsOf(await claimCognitoDeletions(db, { issuer: pool, now, limit: 10 }))).toEqual([
      'now',
    ]);
    // Another pool's row is never this deploy's to try.
    expect(await rowsOf('elsewhere')).toMatchObject([{ attempts: 0 }]);
  });

  it('counts each try and puts the next off: a minute, doubling, at most an hour', async () => {
    const pool = poolOf('backoff');
    let now = new Date('2026-10-09T14:00:00Z');
    await queueCognitoDeletion(db, signIn('backoff', pool), now);
    const waits: number[] = [];

    for (let tries = 1; tries <= 8; tries += 1) {
      const [row] = await claimCognitoDeletions(db, { issuer: pool, now, limit: 10 });
      expect(row?.attempts).toBe(tries);
      const next = row!.nextAttemptAt;
      // Not tried again, by anyone, until then.
      expect(
        await claimCognitoDeletions(db, { issuer: pool, now: later(next, -1), limit: 10 }),
      ).toEqual([]);
      waits.push((next.getTime() - now.getTime()) / MIN);
      now = next;
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });

  it('still claims a row that has failed for weeks, an hour apart: the wait never overflows', async () => {
    // A wrong policy left for weeks fails a row hourly: a doubling with no cap passes interval's
    // range near the 47th try, and that one row would make every claim in the pool an error.
    const pool = poolOf('weeks');
    const now = new Date('2026-10-09T15:00:00Z');
    await queueCognitoDeletion(db, signIn('weeks', pool), now);
    await db
      .update(cognitoDeletions)
      .set({ attempts: 1000 })
      .where(eq(cognitoDeletions.sub, 'weeks'));

    const [row] = await claimCognitoDeletions(db, { issuer: pool, now, limit: 1 });
    expect(row).toMatchObject({ attempts: 1001, nextAttemptAt: later(now, 60 * MIN) });
  });

  it('a finished row is gone', async () => {
    const pool = poolOf('finish');
    const now = new Date();
    await queueCognitoDeletion(db, signIn('finished', pool), now);
    const [row] = await claimCognitoDeletions(db, { issuer: pool, now, limit: 1 });

    await finishCognitoDeletion(db, row!.id);
    expect(await rowsOf('finished')).toEqual([]);
  });
});
