import postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    vi.unstubAllEnvs();
    await Promise.all(made.splice(0).map((created) => created.$client.end()));
  });

  it("keeps postgres.js's own 10 connections when the caller names no size, the API's deploys", () => {
    expect(db(url).$client.options.max).toBe(10);
    // Passed undefined, postgres.js would make it one connection: it is passed 10 instead.
    expect(db(url, {}).$client.options.max).toBe(10);
    expect(db(url, { max: undefined }).$client.options.max).toBe(10);
  });

  it('sizes the pool to the number it is given', () => {
    expect(db(url, { max: 20 }).$client.options.max).toBe(20);
    expect(db(url, { max: 1 }).$client.options.max).toBe(1);
  });

  /*
   * The trap a deploy stood on (DECISIONS 2026-10-22): passed no size, postgres.js 3.4.9 sizes the
   * pool by PGMAX or a `max` in the URL, as text, and a pool of "20" is one connection
   * (`[...Array("20")]`). The first case is the control: both reach postgres.js here.
   */
  describe('PGMAX and a max in the URL', () => {
    it('are what postgres.js sizes the pool by, as text, when it is passed no size', async () => {
      vi.stubEnv('PGMAX', '20');
      const fromEnv = postgres(url);
      const fromUrl = postgres(`${url}?max=30`);
      try {
        expect(fromEnv.options.max).toBe('20');
        expect(fromUrl.options.max).toBe('30');
      } finally {
        await Promise.all([fromEnv.end(), fromUrl.end()]);
      }
    });

    it("never size createDb's pool: an explicit max overrides both, its own 10 or the number it is given", () => {
      vi.stubEnv('PGMAX', '20');
      for (const each of [url, `${url}?max=30`, `${url}?sslmode=disable&max=30`]) {
        expect(db(each).$client.options.max).toBe(10);
        expect(db(each, { max: 2 }).$client.options.max).toBe(2);
      }
    });

    it('go nowhere else: the URL keeps its max, which postgres.js never sends to the server', () => {
      // A startup parameter Postgres doesn't know would refuse every connection: none goes.
      expect(db(`${url}?max=30`).$client.options.connection).not.toHaveProperty('max');
    });
  });
});
