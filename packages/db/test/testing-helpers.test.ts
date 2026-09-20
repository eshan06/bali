import { describe, expect, it } from 'vitest';

import { backdateLastSeen } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * `@bali/db/testing` is a public subpath and the production image runs this
 * package's TypeScript straight from source, so "only tests call it" is a
 * convention, not a mechanism. backdateLastSeen writes `participations` behind
 * the transition engine, so it carries its own guard — these pin it.
 */
describe('backdateLastSeen', () => {
  // An unusable handle: the guard must reject before anything touches the
  // database, so no query can be attempted on it.
  const unusable = {} as Database;
  const where = { sessionId: 'session', studentId: 'student' };

  it('refuses to run with NODE_ENV=production', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateLastSeen(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('refuses to run with NODE_ENV unset — the image default, so it denies by default', async () => {
    const saved = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      await expect(backdateLastSeen(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
