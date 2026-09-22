import { describe, expect, it } from 'vitest';

import { hasSqlState, isDeadlock, isUniqueViolation } from '../src/sql-errors.js';

/*
 * The one thing this module exists for is the WALK, and it is the one thing a
 * database test cannot show you is missing — a retry that stops retrying looks
 * exactly like a retry that had nothing to retry. Two call sites learned that
 * independently (the engine's 40P01 loop, management's 23505 loop), so it is
 * pinned here directly: `err.code` alone turns the wrapped cases red, and
 * wrapped is the shape every real driver error arrives in.
 */

/** What drizzle hands a caller: its own error with the driver's on `cause`. */
function wrapped(code: string, depth = 1): Error {
  let err: Error = Object.assign(new Error('driver'), { code });
  for (let i = 0; i < depth; i += 1) err = new Error('drizzle', { cause: err });
  return err;
}

describe('hasSqlState', () => {
  it('finds a code on the error itself', () => {
    expect(hasSqlState(Object.assign(new Error('raw'), { code: '23505' }), '23505')).toBe(true);
  });

  it('finds a code drizzle wrapped — the case a plain err.code check misses', () => {
    expect(hasSqlState(wrapped('23505'), '23505')).toBe(true);
  });

  it('keeps walking past the first wrapper', () => {
    expect(hasSqlState(wrapped('40P01', 3), '40P01')).toBe(true);
  });

  it('is false for a different code, at any depth', () => {
    expect(hasSqlState(wrapped('23505'), '40P01')).toBe(false);
    expect(hasSqlState(wrapped('23505', 3), '40P01')).toBe(false);
  });

  it('stops at a link that is not an Error, rather than throwing', () => {
    expect(hasSqlState(new Error('drizzle', { cause: { code: '23505' } }), '23505')).toBe(false);
    expect(hasSqlState(undefined, '23505')).toBe(false);
    expect(hasSqlState('23505', '23505')).toBe(false);
  });

  it('names the two codes this repo retries on, and only those', () => {
    // Inverted as well as paired: asserting only the positives would leave
    // `isDeadlock` answering true for a unique violation, and withDeadlockRetry
    // would then loop on a collision it can never resolve.
    expect(isDeadlock(wrapped('40P01'))).toBe(true);
    expect(isDeadlock(wrapped('23505'))).toBe(false);
    expect(isUniqueViolation(wrapped('23505'))).toBe(true);
    expect(isUniqueViolation(wrapped('40P01'))).toBe(false);
  });
});
