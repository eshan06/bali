import { afterEach, describe, expect, it } from 'vitest';

import { createDb } from '../src/client.js';

/*
 * The pool's size (#336): what `max` reaches postgres.js as. No query runs, so no connection is
 * made: postgres.js connects lazily, and its options say the size it will open.
 */
describe('createDb', () => {
  const url = 'postgres://bali@127.0.0.1:1/unused';
  const made: ReturnType<typeof createDb>[] = [];
  const db = (...args: Parameters<typeof createDb>) => {
    const created = createDb(...args);
    made.push(created);
    return created;
  };

  afterEach(async () => {
    await Promise.all(made.splice(0).map((created) => created.$client.end()));
  });

  it("keeps postgres.js's own 10 connections when the caller names no size, the API's deploys", () => {
    expect(db(url).$client.options.max).toBe(10);
    // Passed undefined, postgres.js would make it one connection: the key never goes.
    expect(db(url, {}).$client.options.max).toBe(10);
    expect(db(url, { max: undefined }).$client.options.max).toBe(10);
  });

  it('sizes the pool to the number it is given', () => {
    expect(db(url, { max: 20 }).$client.options.max).toBe(20);
    expect(db(url, { max: 1 }).$client.options.max).toBe(1);
  });
});
