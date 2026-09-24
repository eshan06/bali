import { sql, type SQLWrapper } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { type HistoryKey, historyReads } from '../src/queries.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * GET /v1/me/history reads a page through two indexes, so a page costs its
 * own size however long a student's history grows (Phase 3 · A7). Its
 * behaviour is tested through the endpoint (apps/api/test/history.test.ts);
 * this pins the plan, on both lanes.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

/** The plan Postgres chooses for `query`, as text. */
async function planOf(query: SQLWrapper): Promise<string> {
  return db.transaction(async (tx) => {
    // On a near-empty table a sequential scan is the cheap plan whatever the
    // indexes, so it is priced out: a table no index can serve still shows
    // one, and that is what this looks for.
    await tx.execute(sql`set local enable_seqscan = off`);
    const result = await tx.execute(sql`explain ${query}`);
    // postgres.js answers with the rows, PGlite with an object holding them.
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<
      string,
      string
    >[];
    return rows.map((row) => Object.values(row).join(' ')).join('\n');
  });
}

describe('the history reads', () => {
  const later: HistoryKey = { at: '2026-03-02T09:00:00.000000Z', tie: 1, seq: 42 };

  it.each([
    ['a first page', undefined],
    ['a later page', later],
  ])('range over their own index on %s, and scan no table', async (_page, key) => {
    const { own, ended } = historyReads(db, newUuidV7(), key, 51);
    const ownPlan = await planOf(own);
    expect(ownPlan, ownPlan).toContain('events_user_occurred_idx');
    expect(ownPlan, ownPlan).not.toContain('Seq Scan');
    const endedPlan = await planOf(ended);
    expect(endedPlan, endedPlan).toContain('participations_student_ended_idx');
    expect(endedPlan, endedPlan).not.toContain('Seq Scan');
  });
});
