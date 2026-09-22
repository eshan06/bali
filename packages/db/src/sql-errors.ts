/**
 * Reading Postgres SQLSTATEs off an error, in one place.
 *
 * Two call sites grew the same six-line loop independently — the engine's
 * deadlock retry and management's join-code collision retry — and both had to
 * learn the same non-obvious thing to get there: **drizzle wraps the driver
 * error**, so the SQLSTATE sits on a nested `cause` and a plain
 * `err.code === '23505'` check silently never matches.
 *
 * Silently is the word that earns this module. Nothing throws and nothing
 * logs; the retry simply stops retrying, and the failure it existed to absorb
 * surfaces as a 500 at a bell. So the walk lives here rather than being
 * re-derived a third time.
 */

/**
 * Does `err`, or anything in its `cause` chain, carry this SQLSTATE?
 *
 * The chain walk is the whole point — see above. It stops at the first link
 * that is not an `Error`, which also bounds a cause chain that loops.
 */
export function hasSqlState(err: unknown, state: string): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: string }).code === state) return true;
  }
  return false;
}

/** 40P01 — Postgres aborted this transaction to break a deadlock. */
export function isDeadlock(err: unknown): boolean {
  return hasSqlState(err, '40P01');
}

/** 23505 — a unique constraint refused the write. */
export function isUniqueViolation(err: unknown): boolean {
  return hasSqlState(err, '23505');
}
